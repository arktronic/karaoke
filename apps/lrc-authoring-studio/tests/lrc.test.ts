import { describe, expect, it } from 'vitest';
import { serializeLrc } from '../src/core/lrc';
import { setSlotTime } from '../src/core/timing';
import { formatClock, formatLrcTime } from '../src/core/time';
import { tokenizeLyrics } from '../src/core/tokenize';
import type { Project } from '../src/core/types';

/** Gives every token a start, in order, from `starts`; tokens beyond `starts` stay untimed. */
function timed(text: string, starts: number[]): Project {
  let project = tokenizeLyrics(text);
  let i = 0;
  project.lines.forEach((line, lineIndex) => {
    for (let token = 0; token < line.tokens.length && i < starts.length; token += 1) {
      project = setSlotTime(project, { line: lineIndex, token, kind: 'start' }, starts[i]);
      i += 1;
    }
  });
  return project;
}

describe('formatLrcTime', () => {
  it('rounds to centiseconds', () => {
    expect(formatLrcTime(0)).toBe('00:00.00');
    expect(formatLrcTime(12344)).toBe('00:12.34');
    expect(formatLrcTime(12345)).toBe('00:12.35');
    expect(formatLrcTime(61000)).toBe('01:01.00');
    expect(formatLrcTime(6_000_000)).toBe('100:00.00');
  });

  it('clamps negatives to zero', () => {
    expect(formatLrcTime(-5)).toBe('00:00.00');
  });
});

describe('formatClock', () => {
  it('shows milliseconds', () => {
    expect(formatClock(62345)).toBe('1:02.345');
  });
});

describe('serializeLrc', () => {
  it('writes a line stamp and a tag per token, joining syllables', () => {
    const p = timed('Hel/lo world', [10000, 10300, 10600]);
    expect(serializeLrc(p)).toEqual({
      text: '[00:10.00]<00:10.00>Hel<00:10.30>lo <00:10.60>world\n',
      skippedLines: [],
    });
  });

  it('writes a word end before the space so the gap is its own segment', () => {
    let p = timed('a b', [1000, 3000]);
    p = setSlotTime(p, { line: 0, token: 0, kind: 'end' }, 1500);
    expect(serializeLrc(p).text).toBe('[00:01.00]<00:01.00>a<00:01.50> <00:03.00>b\n');
  });

  it('writes the last word end as a trailing tag followed by a space', () => {
    let p = timed('a b', [1000, 2000]);
    p = setSlotTime(p, { line: 0, token: 1, kind: 'end' }, 3000);
    expect(serializeLrc(p).text).toBe('[00:01.00]<00:01.00>a <00:02.00>b<00:03.00> \n');
  });

  it('ignores an end that sits on a syllable', () => {
    const p = timed('Hel/lo', [1000, 2000]);
    p.lines[0].tokens[0].endMs = 1500;
    expect(serializeLrc(p).text).toBe('[00:01.00]<00:01.00>Hel<00:02.00>lo\n');
  });

  it('skips lines that are not fully timed', () => {
    const p = timed('a b\nc d\ne', [1000, 2000, 3000]);
    expect(serializeLrc(p)).toEqual({
      text: '[00:01.00]<00:01.00>a <00:02.00>b\n',
      skippedLines: [1, 2],
    });
  });

  it('returns empty text for an empty project', () => {
    expect(serializeLrc({ lines: [] })).toEqual({ text: '', skippedLines: [] });
  });
});
