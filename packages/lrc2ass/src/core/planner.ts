import type {
  AssDocument,
  AssEvent,
  NormalizedLyrics,
  PlanOptions,
  PlanOverrideOptions,
} from '../types/index.js';
import { assertPlanOptions, PLAN_PRESETS, resolvePlanOptions } from './planning/options.js';
import { createStyle, alignmentTag, computeRowBlockTopMargin } from './planning/style.js';
import {
  escapeAssText,
  karaokeText,
  PRE_SWEEP_STATIC_PREFIX,
  fadeTag,
} from './planning/karaoke-text.js';
import {
  computeMaxConcurrentLyrics,
  computeQuietGaps,
  effectiveSungStartMs,
  lyricEndMs,
  quantizeBoundary,
  quietGapCeilingMs,
} from './planning/timing.js';
import { addInterludeEvents, INTERLUDE_STYLE_NAME } from './planning/interlude.js';
import { computeWrapBudget, splitOverlongOccurrences } from './planning/line-wrap.js';

const LYRIC_STYLE_NAME = 'Lyrics';
const PREVIEW_STYLE_NAME = 'Preview';
// Backstop for whenever the width estimate underneath splitOverlongOccurrences is wrong: forces
// libass to never auto-wrap a line into a second physical line that could collide with another
// row, bounding the worst case to (cosmetic) horizontal overflow instead.
const NO_WRAP_TAG = '{\\q2}';

/**
 * Applies karaoke, layout, style, preset, and interlude options to produce an ASS document.
 */
export function planEvents(
  normalized: NormalizedLyrics,
  baseOptions: PlanOptions,
  overrideOptions?: PlanOverrideOptions,
): AssDocument {
  const options = resolvePlanOptions(baseOptions, overrideOptions);
  assertPlanOptions(options);
  const wrapBudget = computeWrapBudget(options);
  const occurrences = splitOverlongOccurrences(
    normalized.occurrences,
    wrapBudget.maxWidthPx,
    wrapBudget.fontSizePx,
  );
  const events: AssEvent[] = [];
  const lyricOccurrences: Array<{
    event: AssEvent;
    occurrence: NormalizedLyrics['occurrences'][number];
    showedPreSweep: boolean;
  }> = [];
  // Events exempted from fadeInMs/fadeOutMs at a Preview->Lyrics handoff (same row, no visual gap).
  const noFadeInEvents = new Set<AssEvent>();
  const noFadeOutEvents = new Set<AssEvent>();
  const interludeStyleName = options.interlude?.style ?? INTERLUDE_STYLE_NAME;
  const lyricsStyle = createStyle(LYRIC_STYLE_NAME, options.layout, options.styles.lyrics ?? {});
  const previewStyle = createStyle(
    PREVIEW_STYLE_NAME,
    options.layout,
    options.styles.preview ?? {},
  );
  const isMultiLine = PLAN_PRESETS[options.preset].showPreview;

  const rowCount = options.maxPreviewLines + 1;
  const rowBlockTopMargin = computeRowBlockTopMargin(
    options.layout.resolutionY,
    options.layout.rowHeightPx,
    rowCount,
  );
  // ASS's alignment values can't give each row its own anchor edge, so every row shares one
  // alignment and gets its own MarginV set per-event instead.
  const rowAlignment = options.layout.rowAlignment ?? previewStyle.alignment;
  const rowMarginForIndex = (index: number): number =>
    rowBlockTopMargin + (index % rowCount) * options.layout.rowHeightPx;

  // A lyric's box may start later than its own bracket timestamp when it has a large leading
  // enhanced-segment delay, deferred to just before its first sung word (never earlier than the bracket).
  const deferredStarts = occurrences.map((occurrence) =>
    quantizeBoundary(
      Math.max(occurrence.startMs, effectiveSungStartMs(occurrence) - options.mainLinePreRollMs),
    ),
  );

  // Deferred starts can invert source order, so successors must be resolved by start, not index.
  const sortedByDeferredStart = deferredStarts
    .map((_, index) => index)
    .sort((left, right) => deferredStarts[left] - deferredStarts[right]);

  // Right-to-left pass: visibility and successor are resolved together, since a
  // trailingLyricDurationMs clamp can collapse a candidate that looked visible unclamped, so only
  // an already-resolved-visible successor may be handed further back. Tied deferred starts (e.g.
  // duet lines) share the next strictly-later visible start instead of each other.
  const isVisible: boolean[] = new Array(deferredStarts.length).fill(false);
  const resolvedEndMs: number[] = new Array(deferredStarts.length);
  let nextVisibleStartMs: number | undefined;
  let groupHasVisibleMember = false;
  let previousStartMs: number | undefined;
  for (let position = sortedByDeferredStart.length - 1; position >= 0; position--) {
    const sourceIndex = sortedByDeferredStart[position];
    const startMs = deferredStarts[sourceIndex];
    if (previousStartMs !== undefined && startMs !== previousStartMs) {
      if (groupHasVisibleMember) {
        nextVisibleStartMs = previousStartMs;
      }
      groupHasVisibleMember = false;
    }
    const endMs = quantizeBoundary(
      lyricEndMs(occurrences[sourceIndex], nextVisibleStartMs, options),
    );
    if (endMs > startMs) {
      isVisible[sourceIndex] = true;
      resolvedEndMs[sourceIndex] = endMs;
      groupHasVisibleMember = true;
    }
    previousStartMs = startMs;
  }
  const chronologicalOrder = sortedByDeferredStart.filter((index) => isVisible[index]);

  // Running max of all preceding emitted events' endMs, since overlapping lines can make an
  // earlier occurrence outlast a later, shorter one.
  let latestActiveEndMs = -Infinity;
  let groupPosition = 0;
  while (groupPosition < chronologicalOrder.length) {
    const groupStartMs = deferredStarts[chronologicalOrder[groupPosition]];
    let groupEnd = groupPosition;
    while (
      groupEnd < chronologicalOrder.length &&
      deferredStarts[chronologicalOrder[groupEnd]] === groupStartMs
    ) {
      groupEnd++;
    }

    // Tied starts (e.g. duet lines) share the same preceding dead air, so all must be judged
    // against the same prior active-end value rather than each other's endMs.
    const priorActiveEndMs = latestActiveEndMs;
    let groupMaxEndMs = latestActiveEndMs;
    for (let position = groupPosition; position < groupEnd; position++) {
      const index = chronologicalOrder[position];
      const occurrence = occurrences[index];
      const startMs = deferredStarts[index];
      const endMs = resolvedEndMs[index];

      // Pre-sweep needs genuine dead air before this line, not just no immediate predecessor.
      const showPreSweep =
        effectiveSungStartMs(occurrence) - priorActiveEndMs >= options.mainLinePreRollMs;

      const { text, showedPreSweep } = karaokeText(
        occurrence.text,
        occurrence.segments,
        occurrence.startMs,
        startMs,
        endMs,
        options.karaokeEffect,
        showPreSweep,
      );
      const event: AssEvent = {
        layer: 0,
        startMs,
        endMs,
        style: LYRIC_STYLE_NAME,
        text: NO_WRAP_TAG + text,
      };
      lyricOccurrences.push({ event, occurrence, showedPreSweep });
      events.push(event);
      groupMaxEndMs = Math.max(groupMaxEndMs, endMs);
    }
    latestActiveEndMs = groupMaxEndMs;
    groupPosition = groupEnd;
  }

  // Deferred starts can invert the source order (a line with a long leading delay may end up
  // displayed after a later, undelayed line); row assignment and addInterludeEvents below both
  // need chronological order to reason about "previous"/gaps correctly.
  lyricOccurrences.sort((left, right) => left.event.startMs - right.event.startMs);

  if (isMultiLine) {
    // Rows normally rotate in occurrence order (row = rotation % rowCount), but whenever every
    // row's most recent occupant will have already ended before an occurrence's own natural
    // preview/appearance time — i.e. the screen would otherwise go genuinely blank, regardless of
    // whether that gap is long enough to also qualify for an interlude — the rotation restarts
    // from the top row instead of continuing wherever raw occurrence order would land it. This
    // accounts for lingerMaxMs: a same-row predecessor that would linger far enough to reach this
    // occurrence's own appearance is treated as still-visible coverage, not a blank gap.
    const effectiveRow: number[] = new Array(lyricOccurrences.length);
    const sameRowPredecessorIndex: Array<number | undefined> = new Array(lyricOccurrences.length);
    const sameRowSuccessorIndex: Array<number | undefined> = new Array(lyricOccurrences.length);
    const lastIndexForRow: Array<number | undefined> = new Array(rowCount).fill(undefined);

    const maxConcurrency = computeMaxConcurrentLyrics(lyricOccurrences.map(({ event }) => event));
    if (maxConcurrency > rowCount) {
      throw new RangeError(
        `Up to ${maxConcurrency} lyric lines are on screen at once, which exceeds the ${rowCount} ` +
          `available rows (maxPreviewLines + 1 = ${options.maxPreviewLines} + 1); raise maxPreviewLines ` +
          `or remove the overlapping occurrences.`,
      );
    }

    // A row being unused for a while isn't necessarily a pause in the song — other rows may keep
    // the screen busy throughout — so lingering is only skipped where a real, song-wide quiet gap
    // overlaps, not merely because this row's own next occupant happens to be a long way off.
    // Gated on blankGapMs (falling back to, and clamped by, minGapMs) rather than minGapMs alone,
    // so a real gap too short to warrant a full Interlude can still stop rows from lingering across
    // it; the clamp keeps a blankGapMs inherited from defaults harmless when a caller lowers minGapMs.
    const quietGaps =
      options.interlude !== undefined && options.interlude.strategy !== 'none'
        ? computeQuietGaps(
            lyricOccurrences,
            Math.min(
              options.interlude.blankGapMs ?? options.interlude.minGapMs,
              options.interlude.minGapMs,
            ),
          )
        : [];
    let rotation = 0;
    let screenBusyUntilMs = -Infinity;
    for (const [index, { event, occurrence }] of lyricOccurrences.entries()) {
      if (index > 0) {
        const naturalAppearanceMs = quantizeBoundary(
          effectiveSungStartMs(occurrence) - options.previewLeadMs,
        );
        const provisionalRow = (rotation + 1) % rowCount;
        const predecessorIndex = lastIndexForRow[provisionalRow];
        // A non-mutating estimate of how far this same-row predecessor would linger if this
        // occurrence turns out to be its real successor; the actual lingering pass below applies
        // the real extension once row assignment (and thus same-row successors) are final.
        let predecessorCoverageMs = screenBusyUntilMs;
        if (predecessorIndex !== undefined) {
          const predecessorEndMs = lyricOccurrences[predecessorIndex].event.endMs;
          const gapMs = naturalAppearanceMs - predecessorEndMs;
          const lingerCeilingMs = quietGapCeilingMs(
            predecessorEndMs,
            naturalAppearanceMs,
            quietGaps,
          );
          const lingeredEndMs =
            gapMs > 0 && options.lingerMaxMs > 0
              ? Math.min(predecessorEndMs + Math.min(gapMs, options.lingerMaxMs), lingerCeilingMs)
              : predecessorEndMs;
          predecessorCoverageMs = Math.max(predecessorCoverageMs, lingeredEndMs);
        }
        rotation = naturalAppearanceMs > predecessorCoverageMs ? 0 : rotation + 1;
        // The above only decides a preferred starting row; it doesn't guarantee that row's last
        // occupant has actually finished (by real event time, not the linger estimate used above),
        // so advance past any row still genuinely in use until an actually free one is found.
        // maxConcurrency <= rowCount (checked above) guarantees one exists within rowCount attempts.
        for (let attempt = 0; attempt < rowCount; attempt++) {
          const candidateRow = rotation % rowCount;
          const occupantIndex = lastIndexForRow[candidateRow];
          if (
            occupantIndex === undefined ||
            lyricOccurrences[occupantIndex].event.endMs <= event.startMs
          ) {
            break;
          }
          rotation++;
        }
      }
      const row = rotation % rowCount;
      effectiveRow[index] = row;
      sameRowPredecessorIndex[index] = lastIndexForRow[row];
      if (lastIndexForRow[row] !== undefined) {
        sameRowSuccessorIndex[lastIndexForRow[row]] = index;
      }
      lastIndexForRow[row] = index;
      screenBusyUntilMs = Math.max(screenBusyUntilMs, event.endMs);
    }

    // Tag each Lyrics event with the row it occupies; a line's row never changes between its
    // preview and current appearance (only its styling swaps in place).
    for (const [index, { event }] of lyricOccurrences.entries()) {
      event.marginVertical = rowMarginForIndex(effectiveRow[index]);
      event.text = alignmentTag(rowAlignment) + event.text;
    }

    // Each occurrence's preview window is computed independently (not just one line ahead of
    // "current"), so up to rowCount-1 upcoming lines can preview simultaneously once their own
    // windows overlap. A row can't preview its next occupant until its previous one (its same-row
    // predecessor, per the rotation above) has finished being current, which also prevents
    // same-row visual overlap.
    // rowNeededAtMs[index] records when this occurrence's row starts being needed for it (its own
    // preview start, or its own Lyrics start if no preview shows), used below for lingering.
    const rowNeededAtMs: number[] = new Array(lyricOccurrences.length);
    // Caps concurrent Preview events across all rows at maxPreviewLines: since previewEndMs is
    // this occurrence's own (non-decreasing, per the earlier chronological sort) startMs, expired
    // windows can simply be pruned as we go rather than needing a full interval-scheduling pass.
    const activePreviewEndTimes: number[] = [];
    for (let index = 1; index < lyricOccurrences.length; index++) {
      const { event, occurrence, showedPreSweep } = lyricOccurrences[index];
      // Before a row's first use, nothing has ever occupied it, but a preview still shouldn't
      // appear before the very first Lyrics event of the whole song (e.g. during a leading
      // instrumental gap) since nothing would yet be on screen to accompany it.
      const predecessorIndex = sameRowPredecessorIndex[index];
      const rowFreeAtMs =
        predecessorIndex !== undefined
          ? lyricOccurrences[predecessorIndex].event.endMs
          : lyricOccurrences[0].event.startMs;
      let previewStartMs = Math.max(
        rowFreeAtMs,
        quantizeBoundary(effectiveSungStartMs(occurrence) - options.previewLeadMs),
      );
      const previewEndMs = event.startMs;

      for (let active = activePreviewEndTimes.length - 1; active >= 0; active--) {
        if (activePreviewEndTimes[active] <= previewStartMs) {
          activePreviewEndTimes.splice(active, 1);
        }
      }
      while (activePreviewEndTimes.length >= options.maxPreviewLines) {
        const earliestEndMs = Math.min(...activePreviewEndTimes);
        previewStartMs = Math.max(previewStartMs, earliestEndMs);
        activePreviewEndTimes.splice(activePreviewEndTimes.indexOf(earliestEndMs), 1);
      }

      rowNeededAtMs[index] = event.startMs;
      if (previewEndMs > previewStartMs) {
        activePreviewEndTimes.push(previewEndMs);
        const previewEvent: AssEvent = {
          layer: -1,
          startMs: previewStartMs,
          endMs: previewEndMs,
          style: PREVIEW_STYLE_NAME,
          marginVertical: rowMarginForIndex(effectiveRow[index]),
          // Same row this occurrence's own Lyrics event will use, so it doesn't move when promoted to current.
          // Mirrors its own Lyrics event's pre-sweep dot prefix (static here) so nothing shifts at handoff.
          text:
            alignmentTag(rowAlignment) +
            NO_WRAP_TAG +
            (showedPreSweep ? PRE_SWEEP_STATIC_PREFIX : '') +
            escapeAssText(occurrence.text),
        };
        events.push(previewEvent);
        // The preview hands off to its own Lyrics event at the same instant with no visual gap
        // (same row, same line), so fading out/in right at that handoff would be a distracting
        // flicker; only fade in when the line first appears, and out when it truly leaves the screen.
        noFadeOutEvents.add(previewEvent);
        noFadeInEvents.add(event);
        rowNeededAtMs[index] = previewStartMs;
      }
    }

    // An already-sung line can keep showing on its row to fill what would otherwise be dead time
    // before that row's next occupant needs it, capped at lingerMaxMs and skipped for gaps long
    // enough to warrant an interlude instead (mirrors addInterludeEvents' own strategy check).
    if (options.lingerMaxMs > 0) {
      for (let index = 0; index < lyricOccurrences.length; index++) {
        const successorIndex = sameRowSuccessorIndex[index];
        if (successorIndex === undefined) {
          continue;
        }
        const current = lyricOccurrences[index].event;
        const gapMs = rowNeededAtMs[successorIndex] - current.endMs;
        if (gapMs > 0) {
          const lingerCeilingMs = quietGapCeilingMs(
            current.endMs,
            rowNeededAtMs[successorIndex],
            quietGaps,
          );
          current.endMs = Math.min(
            current.endMs + Math.min(gapMs, options.lingerMaxMs),
            lingerCeilingMs,
          );
        }
      }
    }
  }

  addInterludeEvents(
    events,
    lyricOccurrences.map(({ event }) => event),
    options,
  );

  if (options.fadeInMs > 0 || options.fadeOutMs > 0) {
    for (const event of events) {
      const fadeInMs = noFadeInEvents.has(event) ? 0 : options.fadeInMs;
      const fadeOutMs = noFadeOutEvents.has(event) ? 0 : options.fadeOutMs;
      event.text = fadeTag(fadeInMs, fadeOutMs, event.endMs - event.startMs) + event.text;
    }
  }

  const orderedEvents = events
    .map((event, index) => ({ event, index }))
    .sort(
      (left, right) =>
        left.event.startMs - right.event.startMs ||
        left.event.layer - right.event.layer ||
        left.index - right.index,
    )
    .map(({ event }) => event);

  return {
    scriptInfo: {
      playResX: options.layout.resolutionX,
      playResY: options.layout.resolutionY,
    },
    styles: [
      lyricsStyle,
      previewStyle,
      createStyle(INTERLUDE_STYLE_NAME, options.layout, options.styles.interlude ?? {}),
      ...(interludeStyleName === LYRIC_STYLE_NAME ||
      interludeStyleName === PREVIEW_STYLE_NAME ||
      interludeStyleName === INTERLUDE_STYLE_NAME
        ? []
        : [createStyle(interludeStyleName, options.layout, options.styles.interlude ?? {})]),
    ],
    events: orderedEvents,
  };
}
