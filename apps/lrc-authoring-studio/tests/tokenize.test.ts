import { describe, expect, it } from 'vitest';
import { mergeLyrics, tokenizeLine, tokenizeLyrics } from '../src/core/tokenize';

describe('tokenizeLine', () => {
  it('splits on whitespace and records spacing', () => {
    expect(tokenizeLine('Hello big  world')).toEqual([
      { text: 'Hello', spaceAfter: true },
      { text: 'big', spaceAfter: true },
      { text: 'world', spaceAfter: false },
    ]);
  });

  it('splits syllables on / without a space', () => {
    expect(tokenizeLine('Hel/lo world')).toEqual([
      { text: 'Hel', spaceAfter: false },
      { text: 'lo', spaceAfter: true },
      { text: 'world', spaceAfter: false },
    ]);
  });

  it('treats \\/ as a literal slash', () => {
    expect(tokenizeLine('and\\/or yes')).toEqual([
      { text: 'and/or', spaceAfter: true },
      { text: 'yes', spaceAfter: false },
    ]);
  });

  it('ignores leading, trailing, and doubled separators', () => {
    expect(tokenizeLine('  /a//b/  ')).toEqual([
      { text: 'a', spaceAfter: false },
      { text: 'b', spaceAfter: false },
    ]);
  });

  it('returns no tokens for blank input', () => {
    expect(tokenizeLine('   ')).toEqual([]);
  });
});

describe('tokenizeLyrics', () => {
  it('drops blank lines and handles CRLF', () => {
    const project = tokenizeLyrics('one two\r\n\r\n  \r\nthree\n');
    expect(project.lines.map((l) => l.tokens.map((t) => t.text))).toEqual([
      ['one', 'two'],
      ['three'],
    ]);
  });
});

describe('mergeLyrics', () => {
  it('keeps timings for unchanged lines and resets edited ones', () => {
    const previous = tokenizeLyrics('one two\nthree four');
    previous.lines[0].tokens[0].startMs = 100;
    previous.lines[0].tokens[0].endMs = 150;
    previous.lines[0].tokens[1].startMs = 200;
    previous.lines[1].tokens[0].startMs = 400;

    const next = mergeLyrics(previous, 'one two\nthree five\nsix');
    expect(next.lines[0].tokens.map((t) => t.startMs)).toEqual([100, 200]);
    expect(next.lines[0].tokens.map((t) => t.endMs)).toEqual([150, undefined]);
    expect(next.lines[1].tokens.map((t) => t.startMs)).toEqual([undefined, undefined]);
    expect(next.lines[2].tokens[0].startMs).toBeUndefined();
  });
});
