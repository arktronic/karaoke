import type { Occurrence } from '../../types/index.js';
import type { ResolvedPlanOptions } from './options.js';

// Rough per-character advance widths as a fraction of font size, bucketed since real glyph metrics
// aren't available to this renderer-agnostic core (see design.md: no runtime dependencies). Biased
// slightly to overestimate real Arial-ish metrics: an under-estimate risks a missed split (the
// catastrophic outcome, an overflowing/colliding row); an over-estimate only costs a slightly-early,
// harmless split. Kept modest, though — too generous a margin causes needless early wraps.
const SPACE_WIDTH_FACTOR = 0.25;
const NARROW_WIDTH_FACTOR = 0.28;
const WIDE_WIDTH_FACTOR = 0.75;
const DEFAULT_WIDTH_FACTOR = 0.5;
const NARROW_CHARS = new Set('iIl.,:;\'"`!|()[]{}ftj-');
const WIDE_CHARS = new Set('mMWw@%#&');
const SAFETY_MARGIN_FACTOR = 1.08;

export function estimateTextWidthPx(text: string, fontSizePx: number): number {
  let widthFactorSum = 0;
  for (const char of text) {
    if (char === ' ') {
      widthFactorSum += SPACE_WIDTH_FACTOR;
    } else if (NARROW_CHARS.has(char)) {
      widthFactorSum += NARROW_WIDTH_FACTOR;
    } else if (WIDE_CHARS.has(char)) {
      widthFactorSum += WIDE_WIDTH_FACTOR;
    } else {
      widthFactorSum += DEFAULT_WIDTH_FACTOR;
    }
  }
  return widthFactorSum * fontSizePx * SAFETY_MARGIN_FACTOR;
}

/** The narrower of Lyrics/Preview's effective margins and the larger of their font sizes, so a split decision is safe for whichever style actually renders the line. */
export function computeWrapBudget(options: ResolvedPlanOptions): {
  maxWidthPx: number;
  fontSizePx: number;
} {
  const lyrics = options.styles.lyrics ?? {};
  const preview = options.styles.preview ?? {};
  const fontSizePx = Math.max(lyrics.fontSize ?? 28, preview.fontSize ?? 28);
  const marginLeft = Math.max(
    lyrics.marginLeft ?? options.layout.marginLeft,
    preview.marginLeft ?? options.layout.marginLeft,
  );
  const marginRight = Math.max(
    lyrics.marginRight ?? options.layout.marginRight,
    preview.marginRight ?? options.layout.marginRight,
  );
  return { maxWidthPx: options.layout.resolutionX - marginLeft - marginRight, fontSizePx };
}

function collapseSpaces(text: string): string {
  return text.replace(/ {2,}/g, ' ');
}

// A token that's punctuation/quotes/brackets only (no letters or digits) shouldn't start a new
// line — pulled back onto the previous line instead so it reads naturally, e.g. a trailing "...".
function isPunctuationOnly(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 0 || /^[^\p{L}\p{N}]+$/u.test(trimmed);
}

interface Split {
  first: Occurrence;
  second: Occurrence;
}

// Splits at the first enhanced-segment (word-level) boundary whose cumulative width would exceed
// maxWidthPx, so text and karaoke timing stay in lockstep; segments are the same unit
// karaokeText() renders, so measuring/splitting on them can't disagree with what's actually shown.
function findSegmentSplit(
  occurrence: Occurrence,
  maxWidthPx: number,
  fontSizePx: number,
): Split | undefined {
  const segments = occurrence.segments;
  if (!segments || segments.length < 2) {
    return undefined;
  }
  let cumulativeWidthPx = 0;
  let splitIndex: number | undefined;
  for (let index = 0; index < segments.length; index++) {
    cumulativeWidthPx += estimateTextWidthPx(segments[index].text, fontSizePx);
    if (cumulativeWidthPx > maxWidthPx) {
      splitIndex = index;
      break;
    }
  }
  if (splitIndex === undefined) {
    return undefined;
  }
  // Always leave at least one word on the first line, even if it alone doesn't fit (an
  // unsplittable overflow the \q2 no-wrap tag must then absorb).
  splitIndex = Math.max(splitIndex, 1);
  while (splitIndex < segments.length && isPunctuationOnly(segments[splitIndex].text)) {
    splitIndex++;
  }
  if (splitIndex >= segments.length) {
    return undefined;
  }

  const splitAnchorMs = occurrence.startMs + segments[splitIndex].timeMs;
  if (splitAnchorMs <= occurrence.startMs || splitAnchorMs >= occurrence.endMs) {
    return undefined;
  }

  const firstSegments = segments.slice(0, splitIndex);
  const secondSegments = segments
    .slice(splitIndex)
    .map((segment) => ({ ...segment, timeMs: segment.timeMs - segments[splitIndex].timeMs }));
  return {
    first: {
      startMs: occurrence.startMs,
      endMs: splitAnchorMs,
      text: collapseSpaces(firstSegments.map((segment) => segment.text).join('')).trim(),
      segments: firstSegments,
    },
    second: {
      startMs: splitAnchorMs,
      endMs: occurrence.endMs,
      text: collapseSpaces(secondSegments.map((segment) => segment.text).join('')).trim(),
      segments: secondSegments,
    },
  };
}

// Plain (non-enhanced) lines have no per-word timing to split on, so the boundary's time is
// estimated proportionally by character count instead of measured directly.
function findPlainTextSplit(
  occurrence: Occurrence,
  maxWidthPx: number,
  fontSizePx: number,
): Split | undefined {
  const tokens = occurrence.text.match(/\S+\s*/g);
  if (!tokens || tokens.length < 2) {
    return undefined;
  }
  let cumulativeWidthPx = 0;
  let splitIndex: number | undefined;
  for (let index = 0; index < tokens.length; index++) {
    cumulativeWidthPx += estimateTextWidthPx(tokens[index], fontSizePx);
    if (cumulativeWidthPx > maxWidthPx) {
      splitIndex = index;
      break;
    }
  }
  if (splitIndex === undefined) {
    return undefined;
  }
  splitIndex = Math.max(splitIndex, 1);
  while (splitIndex < tokens.length && isPunctuationOnly(tokens[splitIndex])) {
    splitIndex++;
  }
  if (splitIndex >= tokens.length) {
    return undefined;
  }

  const firstText = collapseSpaces(tokens.slice(0, splitIndex).join('')).trim();
  const secondText = collapseSpaces(tokens.slice(splitIndex).join('')).trim();
  const fraction = firstText.length / (firstText.length + secondText.length);
  const splitAnchorMs =
    occurrence.startMs + Math.round((occurrence.endMs - occurrence.startMs) * fraction);
  if (splitAnchorMs <= occurrence.startMs || splitAnchorMs >= occurrence.endMs) {
    return undefined;
  }
  return {
    first: { startMs: occurrence.startMs, endMs: splitAnchorMs, text: firstText },
    second: { startMs: splitAnchorMs, endMs: occurrence.endMs, text: secondText },
  };
}

function splitOccurrence(
  occurrence: Occurrence,
  maxWidthPx: number,
  fontSizePx: number,
): Occurrence[] {
  if (estimateTextWidthPx(occurrence.text, fontSizePx) <= maxWidthPx) {
    return [occurrence];
  }
  const split =
    occurrence.segments && occurrence.segments.length > 1
      ? findSegmentSplit(occurrence, maxWidthPx, fontSizePx)
      : findPlainTextSplit(occurrence, maxWidthPx, fontSizePx);
  // No word boundary could produce a valid two-sided split (e.g. a single unsplittable word);
  // left as one occurrence for the \q2 no-wrap tag to bound to horizontal overflow instead.
  if (!split) {
    return [occurrence];
  }
  return [
    ...splitOccurrence(split.first, maxWidthPx, fontSizePx),
    ...splitOccurrence(split.second, maxWidthPx, fontSizePx),
  ];
}

// Expands any occurrence estimated too wide for one row into two or more, exactly as if the LRC
// itself had that many separate timestamped lines — every downstream stage (deferred starts, row
// rotation, lingering, previews, interludes) then schedules the pieces with no special-casing.
export function splitOverlongOccurrences(
  occurrences: Occurrence[],
  maxWidthPx: number,
  fontSizePx: number,
): Occurrence[] {
  const result: Occurrence[] = [];
  for (const occurrence of occurrences) {
    result.push(...splitOccurrence(occurrence, maxWidthPx, fontSizePx));
  }
  return result;
}
