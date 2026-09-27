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
      preset: 'multi-line',
      styles: {
        lyrics: { fontSize: 40, marginLeft: 5, marginRight: 5 },
        preview: { fontSize: 28, marginLeft: 20, marginRight: 20 },
      },
    });

    expect(fontSizePx).toBe(40);
    expect(maxWidthPx).toBe(384 - 20 - 20);
  });

  it('uses the narrowest actual style width when left and right margins differ', () => {
    const { maxWidthPx } = computeWrapBudget({
      ...baseOptions,
      preset: 'multi-line',
      styles: {
        lyrics: { marginLeft: 300, marginRight: 10 },
        preview: { marginLeft: 10, marginRight: 300 },
      },
    });

    expect(maxWidthPx).toBe(74);
  });

  it('rejects an active style with no positive text width', () => {
    expect(() =>
      computeWrapBudget({
        ...baseOptions,
        styles: { lyrics: { marginLeft: 374, marginRight: 10 } },
      }),
    ).toThrow('styles.lyrics margins must leave a positive text width');

    expect(() =>
      computeWrapBudget({
        ...baseOptions,
        preset: 'multi-line',
        styles: { preview: { marginLeft: 200, marginRight: 184 } },
      }),
    ).toThrow('styles.preview margins must leave a positive text width');
  });

  it('ignores preview styles when the preset does not show previews', () => {
    const { maxWidthPx, fontSizePx } = computeWrapBudget({
      ...baseOptions,
      styles: {
        lyrics: { fontSize: 32, marginLeft: 5, marginRight: 8 },
        preview: { fontSize: 100, marginLeft: 384, marginRight: 0 },
      },
    });

    expect(fontSizePx).toBe(32);
    expect(maxWidthPx).toBe(384 - 5 - 8);
  });
});

describe('splitOverlongOccurrences', () => {
  const fontSizePx = 28;

  it('leaves a short plain-text occurrence unsplit', () => {
    const occurrence: Occurrence = { startMs: 0, endMs: 1_000, text: 'Hi there' };

    expect(splitOverlongOccurrences([occurrence], 1_000, fontSizePx)).toEqual([occurrence]);
  });

  it('leaves an overlong plain-text occurrence intact to overflow horizontally', () => {
    const occurrence: Occurrence = {
      startMs: 0,
      endMs: 10_000,
      text: 'one two three four five six seven eight nine ten',
    };

    const result = splitOverlongOccurrences(
      [occurrence],
      estimateTextWidthPx('one two three', fontSizePx),
      fontSizePx,
    );

    expect(result).toEqual([occurrence]);
  });

  it('leaves an overlong single-segment enhanced occurrence intact without a timed split boundary', () => {
    const occurrence: Occurrence = {
      startMs: 1_000,
      endMs: 5_000,
      text: 'one two three four',
      segments: [{ text: 'one two three four', timeMs: 0, location: { line: 1, column: 1 } }],
    };

    expect(splitOverlongOccurrences([occurrence], 10, fontSizePx)).toEqual([occurrence]);
  });

  it('does not split syllable-timed enhanced text without a timed word boundary', () => {
    const occurrence: Occurrence = {
      startMs: 1_000,
      endMs: 5_000,
      text: 'Hello!',
      segments: [
        { text: 'He', timeMs: 0, location: { line: 1, column: 1 } },
        { text: 'llo', timeMs: 500, location: { line: 1, column: 3 } },
        { text: '!', timeMs: 1_000, location: { line: 1, column: 6 } },
      ],
    };
    const maxWidthPx = estimateTextWidthPx('He', fontSizePx) + 1;

    expect(estimateTextWidthPx(occurrence.text, fontSizePx)).toBeGreaterThan(maxWidthPx);
    expect(splitOverlongOccurrences([occurrence], maxWidthPx, fontSizePx)).toEqual([occurrence]);
  });

  it('keeps punctuation with the preceding word when splitting at whitespace', () => {
    const occurrence: Occurrence = {
      startMs: 1_000,
      endMs: 5_000,
      text: 'one! two',
      segments: [
        { text: 'one! ', timeMs: 0, location: { line: 1, column: 1 } },
        { text: 'two', timeMs: 1_000, location: { line: 1, column: 6 } },
      ],
    };
    const maxWidthPx = estimateTextWidthPx('one! ', fontSizePx) + 1;

    const result = splitOverlongOccurrences([occurrence], maxWidthPx, fontSizePx);

    expect(result.map(({ text }) => text)).toEqual(['one!', 'two']);
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
});
