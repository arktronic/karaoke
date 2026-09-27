import type { AssEvent, InterludeOptions, NormalizedLyrics } from '../../types/index.js';
import type { ResolvedPlanOptions } from './options.js';
import { sungSegments } from './segments.js';

export const CENTISECOND_MS = 10;
const DEFAULT_INTERLUDE_MARGIN_MS = 0;

export function quantizeBoundary(timeMs: number): number {
  return Math.round(timeMs / CENTISECOND_MS) * CENTISECOND_MS;
}

// The actual margin-adjusted, quantized [startMs, endMs) an interlude would occupy between two
// active spans, or undefined if minGapMs or post-quantization rounding leaves no room to render
// one. Centralized so a decision to shorten a lyric in anticipation of an interlude can never
// diverge from what addInterludeEvents will actually emit for that same gap.
export function resolveInterludeBounds(
  prevEndMs: number,
  nextStartMs: number,
  interlude: InterludeOptions,
): { startMs: number; endMs: number } | undefined {
  if (nextStartMs - prevEndMs < interlude.minGapMs) {
    return undefined;
  }
  const marginMs = interlude.marginMs ?? DEFAULT_INTERLUDE_MARGIN_MS;
  const startMs = quantizeBoundary(prevEndMs + marginMs);
  const endMs = quantizeBoundary(nextStartMs - marginMs);
  return endMs > startMs ? { startMs, endMs } : undefined;
}

export function lyricEndMs(
  occurrence: NormalizedLyrics['occurrences'][number],
  nextOccurrenceStartMs: number | undefined,
  options: ResolvedPlanOptions,
): number {
  const trailingDurationMs =
    options.interlude?.strategy === 'none' ? undefined : options.interlude?.trailingLyricDurationMs;
  // Nothing follows to occupy the gap (end of file, or gap too small for an interlude), so don't create unlabeled dead air.
  if (trailingDurationMs === undefined || nextOccurrenceStartMs === undefined) {
    return occurrence.endMs;
  }

  const finalSegment = occurrence.segments?.at(-1);
  const anchorMs = finalSegment ? occurrence.startMs + finalSegment.timeMs : occurrence.startMs;
  const clampedEndMs = Math.min(occurrence.endMs, anchorMs + trailingDurationMs);
  if (!resolveInterludeBounds(clampedEndMs, nextOccurrenceStartMs, options.interlude!)) {
    return occurrence.endMs;
  }
  return clampedEndMs;
}

/** The moment a lyric's first sung word actually occurs, per its enhanced segment timing (or its own timestamp if plain). */
export function effectiveSungStartMs(occurrence: NormalizedLyrics['occurrences'][number]): number {
  const firstSegment =
    occurrence.segments && occurrence.segments.length > 0
      ? sungSegments(occurrence.segments)[0]
      : undefined;
  return firstSegment ? occurrence.startMs + firstSegment.timeMs : occurrence.startMs;
}

// Real stretches where nothing is genuinely being sung, long enough to warrant an interlude —
// mirrors addInterludeEvents' own gap detection, but checks each occurrence's actual first-sung-word
// timing rather than its (possibly pre-swept, dot-prefixed) display start, since a count-in can
// visually paper over a real gap without the song itself having stopped. Used to tell a row merely
// being unused for a while (a rotation/row-count artifact) apart from an actual pause in the song,
// since with more than one row those can diverge: other rows may keep the screen busy throughout.
export function computeQuietGaps(
  lyricOccurrences: Array<{ event: AssEvent; occurrence: NormalizedLyrics['occurrences'][number] }>,
  minGapMs: number,
): Array<{ startMs: number; endMs: number }> {
  // Callers sort this input by display start, but differing pre-roll/embedded-delay per
  // occurrence means that can diverge from actual sung order; re-sort here so a later-displayed
  // but earlier-sung occurrence can't be skipped past, which would fabricate a gap containing it.
  const bySungStart = [...lyricOccurrences].sort(
    (left, right) => effectiveSungStartMs(left.occurrence) - effectiveSungStartMs(right.occurrence),
  );
  const gaps: Array<{ startMs: number; endMs: number }> = [];
  let latestActiveEndMs = 0;
  for (const { event, occurrence } of bySungStart) {
    const sungStartMs = effectiveSungStartMs(occurrence);
    if (sungStartMs - latestActiveEndMs >= minGapMs) {
      gaps.push({ startMs: latestActiveEndMs, endMs: sungStartMs });
    }
    latestActiveEndMs = Math.max(latestActiveEndMs, event.endMs);
  }
  return gaps;
}

// Peak number of lyric events simultaneously on screen at once (half-open [startMs, endMs)
// overlap), independent of row assignment — used to catch inputs (e.g. duet lines sharing a
// timestamp) that need more rows than maxPreviewLines actually provides, before rotation silently
// reuses a still-active row.
export function computeMaxConcurrentLyrics(sortedEvents: AssEvent[]): number {
  const activeEndTimes: number[] = [];
  let maxConcurrency = 0;
  for (const event of sortedEvents) {
    for (let index = activeEndTimes.length - 1; index >= 0; index--) {
      if (activeEndTimes[index] <= event.startMs) {
        activeEndTimes.splice(index, 1);
      }
    }
    activeEndTimes.push(event.endMs);
    maxConcurrency = Math.max(maxConcurrency, activeEndTimes.length);
  }
  return maxConcurrency;
}

// Highest endMs a same-row lingering extension may reach without spilling into a real quiet gap.
// A row's own idle window can be much wider than any actual pause within it (other rows may have
// kept the screen busy for most of that window, with only its tail overlapping real silence), so
// blocking lingering outright on any overlap would wrongly suppress it for that entire window; the
// correct ceiling is the start of the earliest overlapping quiet gap, not an all-or-nothing block.
export function quietGapCeilingMs(
  startMs: number,
  endMs: number,
  quietGaps: Array<{ startMs: number; endMs: number }>,
): number {
  let ceiling = Number.POSITIVE_INFINITY;
  for (const gap of quietGaps) {
    if (gap.startMs < endMs && gap.endMs > startMs) {
      ceiling = Math.min(ceiling, gap.startMs);
    }
  }
  return ceiling;
}
