import { describe, expect, it } from 'vitest';
import {
  activeTokenAt,
  advanceCursor,
  applyEndTap,
  applyTap,
  canHaveEnd,
  clearSlotTime,
  countTimed,
  firstUntimedCursor,
  getSlotTime,
  moveSlotTime,
  previousToken,
  setSlotTime,
} from '../src/core/timing';
import { tokenizeLyrics } from '../src/core/tokenize';
import type { Cursor, Project, SlotKind } from '../src/core/types';

const start: Cursor = { line: 0, token: 0 };

function project(text = 'a b\nc'): Project {
  return tokenizeLyrics(text);
}

function set(p: Project, line: number, token: number, kind: SlotKind, ms: number): Project {
  return setSlotTime(p, { line, token, kind }, ms);
}

/** Flat [start, end] pairs for every token, for compact assertions. */
function times(p: Project): (number | undefined)[] {
  return p.lines.flatMap((l) => l.tokens.flatMap((t) => [t.startMs, t.endMs]));
}

describe('cursor movement', () => {
  it('walks tokens across lines and then finishes', () => {
    const p = project();
    let c = start;
    const seen: Cursor[] = [];
    for (let i = 0; i < 3; i += 1) {
      seen.push(c);
      c = advanceCursor(p, c);
    }
    expect(seen).toEqual([
      { line: 0, token: 0 },
      { line: 0, token: 1 },
      { line: 1, token: 0 },
    ]);
    expect(c).toEqual({ line: 2, token: 0 });
    expect(advanceCursor(p, c)).toEqual(c);
  });

  it('finds the previous token across lines', () => {
    const p = project();
    expect(previousToken(p, start)).toBeUndefined();
    expect(previousToken(p, { line: 0, token: 1 })).toEqual({ line: 0, token: 0 });
    expect(previousToken(p, { line: 1, token: 0 })).toEqual({ line: 0, token: 1 });
    expect(previousToken(p, { line: 2, token: 0 })).toEqual({ line: 1, token: 0 });
  });
});

describe('applyTap', () => {
  it('starts words in order', () => {
    let p = project();
    let c = start;
    for (const ms of [100, 200, 300]) {
      ({ project: p, cursor: c } = applyTap(p, c, ms));
    }
    expect(times(p)).toEqual([100, undefined, 200, undefined, 300, undefined]);
    expect(c).toEqual({ line: 2, token: 0 });
  });

  it('clears earlier ends that a retap overtakes across untimed tokens', () => {
    let p = project('a b c');
    p = set(p, 0, 0, 'start', 100);
    p = set(p, 0, 0, 'end', 500);
    p = set(p, 0, 1, 'start', 600);
    p = set(p, 0, 2, 'start', 700);
    p = clearSlotTime(p, { line: 0, token: 1, kind: 'start' });

    p = set(p, 0, 2, 'start', 300);
    expect(times(p)).toEqual([100, undefined, undefined, undefined, 300, undefined]);

    p = moveSlotTime(p, { line: 0, token: 1, kind: 'start' }, 550);
    const defined = times(p).filter((t): t is number => t !== undefined);
    expect(defined).toEqual([...defined].sort((x, y) => x - y));
  });

  it('does nothing once finished', () => {
    const p = project();
    const done: Cursor = { line: 2, token: 0 };
    expect(applyTap(p, done, 5)).toEqual({ project: p, cursor: done });
  });

  it('ignores a tap before an earlier start but allows retapping from an earlier word', () => {
    const p = set(set(project(), 0, 0, 'start', 500), 0, 1, 'start', 800);
    const behind = applyTap(p, { line: 1, token: 0 }, 300);
    expect(behind.project).toBe(p);
    expect(behind.cursor).toEqual({ line: 1, token: 0 });
    expect(applyTap(p, { line: 0, token: 1 }, 600).project).not.toBe(p);
    expect(applyTap(p, start, 100).project).not.toBe(p);
  });

  it('clamps a start earlier than the previous start', () => {
    let p = set(project(), 0, 0, 'start', 500);
    p = set(p, 0, 1, 'start', 100);
    expect(getSlotTime(p, { line: 0, token: 1, kind: 'start' })).toBe(500);
  });

  it('clears the previous end and later times that a re-tap overtakes', () => {
    let p = set(project(), 0, 0, 'start', 100);
    p = set(p, 0, 0, 'end', 150);
    p = set(p, 0, 1, 'start', 200);
    p = set(p, 1, 0, 'start', 300);

    p = set(p, 0, 1, 'start', 350);
    expect(times(p)).toEqual([100, 150, 350, undefined, undefined, undefined]);

    p = set(p, 0, 0, 'start', 160);
    expect(times(p)).toEqual([160, undefined, 350, undefined, undefined, undefined]);
  });
});

describe('applyEndTap', () => {
  it('ends the most recently started word', () => {
    const tapped = applyTap(project(), start, 100);
    const p = applyEndTap(tapped.project, tapped.cursor, 180);
    expect(times(p).slice(0, 2)).toEqual([100, 180]);
  });

  it('ends the last word of the previous line when the cursor is on the next line', () => {
    let p = set(project(), 0, 0, 'start', 100);
    p = set(p, 0, 1, 'start', 200);
    p = applyEndTap(p, { line: 1, token: 0 }, 260);
    expect(getSlotTime(p, { line: 0, token: 1, kind: 'end' })).toBe(260);
  });

  it('is ignored before any word has started', () => {
    const p = project();
    expect(applyEndTap(p, start, 100)).toBe(p);
  });

  it('is ignored when earlier than the word start', () => {
    const p = set(project(), 0, 0, 'start', 500);
    expect(applyEndTap(p, { line: 0, token: 1 }, 300)).toBe(p);
  });

  it('is ignored when the previous word has no start', () => {
    const p = project();
    expect(applyEndTap(p, { line: 0, token: 1 }, 100)).toBe(p);
  });

  it('is ignored after a syllable but allowed after the whole word', () => {
    let p = project('Hel/lo world');
    p = set(p, 0, 0, 'start', 100);
    p = set(p, 0, 1, 'start', 200);
    expect(applyEndTap(p, { line: 0, token: 1 }, 150)).toBe(p);
    expect(times(applyEndTap(p, { line: 0, token: 2 }, 260)).slice(2, 4)).toEqual([200, 260]);
  });

  it('is clamped to the word start and clears later times it overtakes', () => {
    let p = set(project(), 0, 0, 'start', 100);
    p = set(p, 0, 1, 'start', 200);
    expect(getSlotTime(set(p, 0, 0, 'end', 50), { line: 0, token: 0, kind: 'end' })).toBe(100);

    p = set(p, 0, 0, 'end', 250);
    expect(times(p).slice(0, 4)).toEqual([100, 250, undefined, undefined]);
  });
});

describe('moveSlotTime', () => {
  it('clamps between neighbouring times', () => {
    let p = set(project(), 0, 0, 'start', 100);
    p = set(p, 0, 0, 'end', 150);
    p = set(p, 0, 1, 'start', 300);
    const end = { line: 0, token: 0, kind: 'end' } as const;
    expect(getSlotTime(moveSlotTime(p, end, 50), end)).toBe(100);
    expect(getSlotTime(moveSlotTime(p, end, 999), end)).toBe(300);
    expect(getSlotTime(moveSlotTime(p, end, 250), end)).toBe(250);
  });

  it('refuses ends without a start or after a syllable', () => {
    const p = set(project('Hel/lo'), 0, 0, 'start', 100);
    expect(moveSlotTime(p, { line: 0, token: 0, kind: 'end' }, 200)).toBe(p);
    const empty = project();
    expect(moveSlotTime(empty, { line: 0, token: 0, kind: 'end' }, 200)).toBe(empty);
  });

  it('rejects invalid tokens', () => {
    expect(() => moveSlotTime(project(), { line: 5, token: 0, kind: 'start' }, 1)).toThrow(
      RangeError,
    );
  });
});

describe('clearSlotTime', () => {
  it('clearing a start also clears the end', () => {
    let p = set(project(), 0, 0, 'start', 100);
    p = set(p, 0, 0, 'end', 150);
    expect(times(clearSlotTime(p, { line: 0, token: 0, kind: 'start' })).slice(0, 2)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('clearing an end keeps the start', () => {
    let p = set(project(), 0, 0, 'start', 100);
    p = set(p, 0, 0, 'end', 150);
    expect(times(clearSlotTime(p, { line: 0, token: 0, kind: 'end' })).slice(0, 2)).toEqual([
      100,
      undefined,
    ]);
  });
});

describe('canHaveEnd', () => {
  it('is true for whole words and last tokens only', () => {
    const p = project('Hel/lo big');
    expect(canHaveEnd(p, { line: 0, token: 0 })).toBe(false);
    expect(canHaveEnd(p, { line: 0, token: 1 })).toBe(true);
    expect(canHaveEnd(p, { line: 0, token: 2 })).toBe(true);
  });
});

describe('firstUntimedCursor', () => {
  it('finds the first word without a start, then reports completion', () => {
    let p = project();
    expect(firstUntimedCursor(p)).toEqual(start);
    p = set(p, 0, 0, 'start', 10);
    expect(firstUntimedCursor(p)).toEqual({ line: 0, token: 1 });
    p = set(p, 0, 1, 'start', 20);
    p = set(p, 1, 0, 'start', 30);
    expect(firstUntimedCursor(p)).toEqual({ line: 2, token: 0 });
  });
});

describe('countTimed', () => {
  it('counts starts and ends', () => {
    let p = project();
    expect(countTimed(p)).toBe(0);
    p = set(p, 0, 0, 'start', 10);
    p = set(p, 0, 0, 'end', 20);
    expect(countTimed(p)).toBe(2);
  });
});

describe('activeTokenAt', () => {
  it('follows starts and goes quiet after an end until the next start', () => {
    let p = set(project(), 0, 0, 'start', 100);
    p = set(p, 0, 0, 'end', 150);
    p = set(p, 0, 1, 'start', 300);
    expect(activeTokenAt(p, 50)).toBeUndefined();
    expect(activeTokenAt(p, 120)).toEqual({ line: 0, token: 0 });
    expect(activeTokenAt(p, 150)).toBeUndefined();
    expect(activeTokenAt(p, 250)).toBeUndefined();
    expect(activeTokenAt(p, 300)).toEqual({ line: 0, token: 1 });
    expect(activeTokenAt(p, 9999)).toEqual({ line: 0, token: 1 });
  });
});
