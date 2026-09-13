import { describe, expect, it } from 'vitest';
import {
  computeWrapBudget,
  estimateTextWidthPx,
  splitOverlongOccurrences,
} from '../src/core/planning/line-wrap.js';
import type { ResolvedPlanOptions } from '../src/core/planning/options.js';
import type { Occurrence } from '../src/types/index.js';

const baseOptions: ResolvedPlanOptions = {
  karaokeEffect: 'none',
  mainLinePreRollMs: 1000,
  previewLeadMs: 4000,
  fadeInMs: 0,
  fadeOutMs: 0,
  maxPreviewLines: 1,
  lingerMaxMs: 0,
  layout: {
    resolutionX: 384,
    resolutionY: 288,
    alignment: 2,
    marginLeft: 10,
    marginRight: 10,
    marginVertical: 10,
    rowHeightPx: 30,
  },
  preset: 'single-line',
  styles: {},
};

describe('estimateTextWidthPx', () => {
  it('grows with text length', () => {
    expect(estimateTextWidthPx('a', 28)).toBeGreaterThan(0);
    expect(estimateTextWidthPx('aa', 28)).toBeGreaterThan(estimateTextWidthPx('a', 28));
  });

  it('scales with font size', () => {
    expect(estimateTextWidthPx('hello', 56)).toBeCloseTo(estimateTextWidthPx('hello', 28) * 2, 5);
  });
});

describe('computeWrapBudget', () => {
  it('falls back to layout margins and a default font size when no styles are configured', () => {
    const { maxWidthPx, fontSizePx } = computeWrapBudget(baseOptions);

    expect(fontSizePx).toBe(28);
    expect(maxWidthPx).toBe(384 - 10 - 10);
  });

  it('picks the larger font size and narrower margins across lyrics/preview styles', () => {
    const { maxWidthPx, fontSizePx } = computeWrapBudget({
      ...baseOptions,
      styles: {
        lyrics: { fontSize: 40, marginLeft: 5, marginRight: 5 },
        preview: { fontSize: 28, marginLeft: 20, marginRight: 20 },
      },
    });

    expect(fontSizePx).toBe(40);
    expect(maxWidthPx).toBe(384 - 20 - 20);
  });
});

describe('splitOverlongOccurrences', () => {
  const fontSizePx = 28;

  it('leaves a short plain-text occurrence unsplit', () => {
    const occurrence: Occurrence = { startMs: 0, endMs: 1_000, text: 'Hi there' };

    expect(splitOverlongOccurrences([occurrence], 1_000, fontSizePx)).toEqual([occurrence]);
  });

  it('splits an overlong plain-text occurrence into word-boundary pieces that each fit the budget', () => {
    const occurrence: Occurrence = {
      startMs: 0,
      endMs: 10_000,
      text: 'one two three four five six seven eight nine ten',
    };
    const maxWidthPx = estimateTextWidthPx('one two three', fontSizePx);

    const result = splitOverlongOccurrences([occurrence], maxWidthPx, fontSizePx);

    expect(result.length).toBeGreaterThan(1);
    for (const piece of result) {
      expect(estimateTextWidthPx(piece.text, fontSizePx)).toBeLessThanOrEqual(maxWidthPx);
    }
    // Pieces are contiguous in time and reconstruct the original text in order.
    expect(result[0].startMs).toBe(0);
    expect(result[result.length - 1].endMs).toBe(10_000);
    for (let index = 1; index < result.length; index++) {
      expect(result[index].startMs).toBe(result[index - 1].endMs);
    }
    expect(result.map((piece) => piece.text).join(' ')).toBe(occurrence.text);
  });

  it('never puts a punctuation-only token on its own new line', () => {
    const occurrence: Occurrence = {
      startMs: 0,
      endMs: 2_000,
      text: 'AAAA BBBB CCCC DDDD EEEE ...',
    };
    // Sized to fit exactly the first four words, forcing a split before "EEEE ...".
    const maxWidthPx = estimateTextWidthPx('AAAA BBBB CCCC DDDD', fontSizePx);

    const result = splitOverlongOccurrences([occurrence], maxWidthPx, fontSizePx);

    expect(result.length).toBeGreaterThan(1);
    for (const piece of result) {
      expect(/^[^\p{L}\p{N}]+$/u.test(piece.text.trim())).toBe(false);
    }
    expect(result[result.length - 1].text.endsWith('...')).toBe(true);
  });

  it('splits enhanced segments at a word boundary and rebases the second half timing to start at 0', () => {
    const occurrence: Occurrence = {
      startMs: 1_000,
      endMs: 5_000,
      text: 'one two three four',
      segments: [
        { text: 'one ', timeMs: 0, location: { line: 1, column: 1 } },
        { text: 'two ', timeMs: 1_000, location: { line: 1, column: 5 } },
        { text: 'three ', timeMs: 2_000, location: { line: 1, column: 9 } },
        { text: 'four', timeMs: 3_000, location: { line: 1, column: 15 } },
      ],
    };
    // Sized to comfortably fit the first three segments but not a fourth, forcing exactly one
    // split before "four" (a small buffer avoids floating-point boundary flakiness).
    const maxWidthPx = estimateTextWidthPx('one two three ', fontSizePx) + 1;

    const result = splitOverlongOccurrences([occurrence], maxWidthPx, fontSizePx);

    expect(result).toHaveLength(2);
    const [first, second] = result;
    expect(first.startMs).toBe(1_000);
    expect(first.text).toBe('one two three');
    expect(first.segments?.[0].timeMs).toBe(0);
    expect(second.text).toBe('four');
    expect(second.segments?.[0].timeMs).toBe(0);
    expect(second.startMs).toBe(first.endMs);
    expect(second.endMs).toBe(occurrence.endMs);
  });

  it('splits recursively as many times as needed for a very long line', () => {
    const occurrence: Occurrence = {
      startMs: 0,
      endMs: 20_000,
      text: 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj',
    };
    const maxWidthPx = estimateTextWidthPx('aaaa bbbb', fontSizePx);

    const result = splitOverlongOccurrences([occurrence], maxWidthPx, fontSizePx);

    expect(result.length).toBeGreaterThan(2);
    for (const piece of result) {
      expect(estimateTextWidthPx(piece.text, fontSizePx)).toBeLessThanOrEqual(maxWidthPx);
    }
  });

  it('falls back to leaving an unsplittable single word as-is', () => {
    const occurrence: Occurrence = {
      startMs: 0,
      endMs: 1_000,
      text: 'Supercalifragilisticexpialidocious',
    };

    const result = splitOverlongOccurrences([occurrence], 10, fontSizePx);

    expect(result).toEqual([occurrence]);
  });
});
