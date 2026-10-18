import type { Cursor, Project, SlotRef, TokenRef } from './types';

type Slots = (number | undefined)[];

// One flat, time-ordered sequence: every token contributes [start, end].
function toFlat(project: Project): Slots {
  const flat: Slots = [];
  for (const line of project.lines) {
    for (const token of line.tokens) {
      flat.push(token.startMs, token.endMs);
    }
  }
  return flat;
}

function fromFlat(project: Project, flat: Slots): Project {
  let i = 0;
  return {
    lines: project.lines.map((line) => ({
      tokens: line.tokens.map((token) => ({ ...token, startMs: flat[i++], endMs: flat[i++] })),
    })),
  };
}

function assertToken(project: Project, ref: TokenRef): void {
  const line = project.lines[ref.line];
  if (!line || ref.token < 0 || ref.token >= line.tokens.length) {
    throw new RangeError(`Invalid token ${ref.line}:${ref.token}`);
  }
}

function flatIndex(project: Project, ref: SlotRef): number {
  assertToken(project, ref);
  let tokens = ref.token;
  for (let i = 0; i < ref.line; i += 1) {
    tokens += project.lines[i].tokens.length;
  }
  return tokens * 2 + (ref.kind === 'end' ? 1 : 0);
}

/** Ends are only allowed after a whole word, i.e. not between syllables. */
export function canHaveEnd(project: Project, ref: TokenRef): boolean {
  assertToken(project, ref);
  const line = project.lines[ref.line];
  return line.tokens[ref.token].spaceAfter || ref.token === line.tokens.length - 1;
}

function lastDefinedBefore(flat: Slots, index: number): number | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (flat[i] !== undefined) {
      return flat[i];
    }
  }
  return undefined;
}

function firstDefinedAfter(flat: Slots, index: number): number | undefined {
  for (let i = index + 1; i < flat.length; i += 1) {
    if (flat[i] !== undefined) {
      return flat[i];
    }
  }
  return undefined;
}

function lastDefinedStartBefore(flat: Slots, index: number): number | undefined {
  for (let i = index - 2; i >= 0; i -= 2) {
    if (flat[i] !== undefined) {
      return flat[i];
    }
  }
  return undefined;
}

export function countTimed(project: Project): number {
  return toFlat(project).filter((time) => time !== undefined).length;
}

export function getSlotTime(project: Project, ref: SlotRef): number | undefined {
  return toFlat(project)[flatIndex(project, ref)];
}

/** Clearing a start also clears that word's end. */
export function clearSlotTime(project: Project, ref: SlotRef): Project {
  const flat = toFlat(project);
  const index = flatIndex(project, ref);
  flat[index] = undefined;
  if (ref.kind === 'start') {
    flat[index + 1] = undefined;
  }
  return fromFlat(project, flat);
}

/**
 * Tap semantics: a start is clamped to the previous word's start and an end to its own start.
 * Times this overtakes (earlier ends, or later times) are cleared.
 * Returns the same project when an end is not allowed there.
 */
export function setSlotTime(project: Project, ref: SlotRef, ms: number): Project {
  const flat = toFlat(project);
  const index = flatIndex(project, ref);
  let lower: number | undefined;
  if (ref.kind === 'end') {
    if (!canHaveEnd(project, ref) || flat[index - 1] === undefined) {
      return project;
    }
    lower = flat[index - 1];
  } else {
    lower = lastDefinedStartBefore(flat, index);
  }

  const time = Math.max(Math.round(ms), lower ?? 0, 0);
  flat[index] = time;
  // Earlier starts are already <= time because of the clamp, so only ends can be overtaken.
  for (let i = index - 1; i >= 0; i -= 1) {
    const earlier = flat[i];
    if (i % 2 === 1 && earlier !== undefined && earlier > time) {
      flat[i] = undefined;
    }
  }
  for (let i = index + 1; i < flat.length; i += 1) {
    const later = flat[i];
    if (later !== undefined && later < time) {
      flat[i] = undefined;
      // A cleared start takes its end with it, as in clearSlotTime.
      if (i % 2 === 0) {
        flat[i + 1] = undefined;
      }
    }
  }
  return fromFlat(project, flat);
}

/** Edit semantics: moves a time, clamped between its neighbouring times so order is preserved. */
export function moveSlotTime(project: Project, ref: SlotRef, ms: number): Project {
  const flat = toFlat(project);
  const index = flatIndex(project, ref);
  if (ref.kind === 'end' && (!canHaveEnd(project, ref) || flat[index - 1] === undefined)) {
    return project;
  }
  const lower = lastDefinedBefore(flat, index) ?? 0;
  const upper = firstDefinedAfter(flat, index) ?? Infinity;
  flat[index] = Math.min(Math.max(Math.round(ms), lower), upper);
  return fromFlat(project, flat);
}

/** The token being sung at `ms`: the latest started one, unless its end has passed. */
export function activeTokenAt(project: Project, ms: number): TokenRef | undefined {
  let found: TokenRef | undefined;
  project.lines.forEach((line, lineIndex) => {
    line.tokens.forEach((token, tokenIndex) => {
      if (token.startMs !== undefined && token.startMs <= ms) {
        found = { line: lineIndex, token: tokenIndex };
      }
    });
  });
  if (!found) {
    return undefined;
  }
  const { endMs } = project.lines[found.line].tokens[found.token];
  return endMs !== undefined && endMs <= ms ? undefined : found;
}

export function isFinished(project: Project, cursor: Cursor): boolean {
  return cursor.line >= project.lines.length;
}

export function advanceCursor(project: Project, cursor: Cursor): Cursor {
  const line = project.lines[cursor.line];
  if (!line) {
    return cursor;
  }
  return cursor.token + 1 < line.tokens.length
    ? { line: cursor.line, token: cursor.token + 1 }
    : { line: cursor.line + 1, token: 0 };
}

/** The token before the cursor, i.e. the word that was started most recently. */
export function previousToken(project: Project, cursor: Cursor): TokenRef | undefined {
  if (cursor.token > 0) {
    return { line: cursor.line, token: cursor.token - 1 };
  }
  const previous = project.lines[cursor.line - 1];
  return previous ? { line: cursor.line - 1, token: previous.tokens.length - 1 } : undefined;
}

/** The first token without a start, or a past-the-end cursor when all have one. */
export function firstUntimedCursor(project: Project): Cursor {
  for (let line = 0; line < project.lines.length; line += 1) {
    const token = project.lines[line].tokens.findIndex((t) => t.startMs === undefined);
    if (token !== -1) {
      return { line, token };
    }
  }
  return { line: project.lines.length, token: 0 };
}

export interface TapResult {
  project: Project;
  cursor: Cursor;
}

/** Starts the cursor's word at `ms` and advances; ignored if `ms` is before an earlier start. */
export function applyTap(project: Project, cursor: Cursor, ms: number): TapResult {
  if (isFinished(project, cursor)) {
    return { project, cursor };
  }
  const floor = lastDefinedStartBefore(
    toFlat(project),
    flatIndex(project, { ...cursor, kind: 'start' }),
  );
  if (floor !== undefined && Math.round(ms) < floor) {
    return { project, cursor };
  }
  return {
    project: setSlotTime(project, { ...cursor, kind: 'start' }, ms),
    cursor: advanceCursor(project, cursor),
  };
}

/** Ends the most recently started word at `ms`; returns the same project if that is not possible. */
export function applyEndTap(project: Project, cursor: Cursor, ms: number): Project {
  const target = previousToken(project, cursor);
  if (!target) {
    return project;
  }
  const start = getSlotTime(project, { ...target, kind: 'start' });
  if (start !== undefined && Math.round(ms) < start) {
    return project;
  }
  return setSlotTime(project, { ...target, kind: 'end' }, ms);
}
