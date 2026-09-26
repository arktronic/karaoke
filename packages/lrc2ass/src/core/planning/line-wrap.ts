import type { Occurrence } from '../../types/index.js';
import { PLAN_PRESETS, type ResolvedPlanOptions } from './options.js';
import { quantizeBoundary } from './timing.js';

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

function availableStyleWidthPx(
  style: { marginLeft?: number; marginRight?: number },
  options: ResolvedPlanOptions,
  role: string,
): number {
  const {
    resolutionX,
    marginLeft: layoutMarginLeft,
    marginRight: layoutMarginRight,
  } = options.layout;
  const marginLeft = style.marginLeft ?? layoutMarginLeft;
  const marginRight = style.marginRight ?? layoutMarginRight;
  const widthPx = resolutionX - marginLeft - marginRight;
  if (widthPx <= 0) {
    throw new RangeError(
      `${role} margins must leave a positive text width; received ` +
        `${resolutionX} - ${marginLeft} - ${marginRight} = ${widthPx}`,
    );
  }
  return widthPx;
}

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
  const showPreview = PLAN_PRESETS[options.preset].showPreview;
  const preview = showPreview ? (options.styles.preview ?? {}) : undefined;
  const fontSizePx = preview
    ? Math.max(lyrics.fontSize ?? 28, preview.fontSize ?? 28)
    : (lyrics.fontSize ?? 28);
  const activeStyleWidths = [availableStyleWidthPx(lyrics, options, 'styles.lyrics')];
  if (preview) {
    activeStyleWidths.push(availableStyleWidthPx(preview, options, 'styles.preview'));
  }
  return { maxWidthPx: Math.min(...activeStyleWidths), fontSizePx };
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

function splitOccurrence(
  occurrence: Occurrence,
  maxWidthPx: number,
  fontSizePx: number,
): Occurrence[] {
  if (!occurrence.segments || occurrence.segments.length < 2) {
    return [occurrence];
  }
  if (estimateTextWidthPx(occurrence.text, fontSizePx) <= maxWidthPx) {
    return [occurrence];
  }

  const split = findSegmentSplit(occurrence, maxWidthPx, fontSizePx);
  // Without a usable real segment boundary, keep the occurrence intact rather than inventing timing.
  if (
    !split ||
    quantizeBoundary(split.first.startMs) >= quantizeBoundary(split.first.endMs) ||
    quantizeBoundary(split.second.startMs) >= quantizeBoundary(split.second.endMs)
  ) {
    return [occurrence];
  }
  return [
    ...splitOccurrence(split.first, maxWidthPx, fontSizePx),
    ...splitOccurrence(split.second, maxWidthPx, fontSizePx),
  ];
}

// Only enhanced occurrences split at real segment times; plain text stays on one visual line, even if it overflows.
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
