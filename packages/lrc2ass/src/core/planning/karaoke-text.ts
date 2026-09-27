import type { KaraokeEffect, NormalizedLyrics } from '../../types/index.js';
import { CENTISECOND_MS, quantizeBoundary } from './timing.js';
import { sungSegments } from './segments.js';

const PRE_SWEEP_DOT_CHAR = '\u00B7';
const PRE_SWEEP_DOT_COUNT = 4;
// Below this, one or more dots would be quantized down to a 0cs (instant-fill) tag, breaking the
// sequential count-in; fall back to the plain empty-syllable tag instead.
const PRE_SWEEP_MIN_DURATION_MS = PRE_SWEEP_DOT_COUNT * CENTISECOND_MS;
// Static (non-animated) equivalent of preSweepText's dot run, for a Preview event to match the
// character layout its own Lyrics event will show once promoted, so nothing visually shifts at handoff.
export const PRE_SWEEP_STATIC_PREFIX = `${PRE_SWEEP_DOT_CHAR.repeat(PRE_SWEEP_DOT_COUNT)} `;

export function escapeAssText(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replace(/\r\n|\r|\n/g, '\\N');
}

export function karaokeTag(effect: KaraokeEffect): string | undefined {
  switch (effect) {
    case 'instant':
      return 'k';
    case 'sweep':
      return 'kf';
    case 'sweep-outline':
      return 'ko';
    case 'none':
      return undefined;
  }
}

/** `\fad(in,out)` tag for an event of `durationMs`; empty when both durations are 0. Scaled down if their sum would exceed the event's own duration, so the line still reaches full opacity. */
export function fadeTag(fadeInMs: number, fadeOutMs: number, durationMs: number): string {
  if (fadeInMs <= 0 && fadeOutMs <= 0) {
    return '';
  }
  const totalMs = fadeInMs + fadeOutMs;
  const scale = totalMs > durationMs && totalMs > 0 ? durationMs / totalMs : 1;
  // Round fadeIn, then derive fadeOut as its complement so the rounded pair's sum can never exceed the scaled total.
  const roundedFadeInMs = Math.round(fadeInMs * scale);
  const roundedFadeOutMs = Math.round(totalMs * scale) - roundedFadeInMs;
  return `{\\fad(${roundedFadeInMs},${roundedFadeOutMs})}`;
}

// A count-in of dots, each getting its own \k slice, so they light up one by one across the
// pre-roll gap and the last one clears exactly as the first real syllable begins.
function preSweepText(tag: string, leadingDurationMs: number): string {
  let text = '';
  let allocatedMs = 0;
  for (let dotIndex = 0; dotIndex < PRE_SWEEP_DOT_COUNT; dotIndex++) {
    const targetMs = quantizeBoundary((leadingDurationMs * (dotIndex + 1)) / PRE_SWEEP_DOT_COUNT);
    const durationCentiseconds = (targetMs - allocatedMs) / CENTISECOND_MS;
    text += `{\\${tag}${durationCentiseconds}}${PRE_SWEEP_DOT_CHAR}`;
    allocatedMs = targetMs;
  }
  return `${text} `;
}

export interface KaraokeTextResult {
  text: string;
  /** Whether the pre-sweep dot count-in (not just the plain empty syllable) was rendered. */
  showedPreSweep: boolean;
}

export function karaokeText(
  text: string,
  segments: NormalizedLyrics['occurrences'][number]['segments'],
  sourceStartMs: number,
  eventStartMs: number,
  eventEndMs: number,
  effect: KaraokeEffect,
  showPreSweep: boolean,
): KaraokeTextResult {
  const tag = karaokeTag(effect);
  if (!tag || !segments || segments.length === 0) {
    return { text: escapeAssText(text), showedPreSweep: false };
  }

  // Leading whitespace-only padding is folded into leadingTag below instead of rendered as its own
  // (otherwise duplicate) invisible syllable.
  const renderedSegments = sungSegments(segments);
  const firstSegmentStartMs = Math.min(
    eventEndMs,
    Math.max(eventStartMs, quantizeBoundary(sourceStartMs + renderedSegments[0].timeMs)),
  );
  const leadingDurationMs = firstSegmentStartMs - eventStartMs;
  const showedPreSweep = leadingDurationMs >= PRE_SWEEP_MIN_DURATION_MS && showPreSweep;
  const leadingTag =
    leadingDurationMs <= 0
      ? ''
      : showedPreSweep
        ? preSweepText(tag, leadingDurationMs)
        : `{\\${tag}${leadingDurationMs / CENTISECOND_MS}}`;

  const karaokeSegments =
    leadingTag +
    renderedSegments
      .map((segment, index) => {
        const segmentStart = Math.min(
          eventEndMs,
          Math.max(eventStartMs, quantizeBoundary(sourceStartMs + segment.timeMs)),
        );
        const nextSegment = renderedSegments[index + 1];
        const segmentEnd = nextSegment
          ? Math.min(
              eventEndMs,
              Math.max(segmentStart, quantizeBoundary(sourceStartMs + nextSegment.timeMs)),
            )
          : eventEndMs;
        const durationCentiseconds = (segmentEnd - segmentStart) / CENTISECOND_MS;
        // Some enhanced-LRC generators pad tags with a space on both sides; since a {\k} tag renders invisibly,
        // a trailing space on one segment plus a leading space on the next would visually double up. Only drop
        // this segment's trailing space when there's no next segment (outer padding) or the next one also has
        // its own leading space; otherwise this is the only word separator between them. Also drop the very
        // first segment's leading space (outer padding).
        const trimTrailingSpace = nextSegment === undefined || /^\s/.test(nextSegment.text);
        let segmentText = trimTrailingSpace ? segment.text.trimEnd() : segment.text;
        if (index === 0) {
          segmentText = segmentText.trimStart();
        }
        return `{\\${tag}${durationCentiseconds}}${escapeAssText(segmentText)}`;
      })
      .join('');
  // Tags contain no spaces, so collapsing runs of 2+ spaces in the assembled string is safe.
  return { text: collapseSpaces(karaokeSegments), showedPreSweep };
}

function collapseSpaces(text: string): string {
  return text.replace(/ {2,}/g, ' ');
}
