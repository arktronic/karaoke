import type {
  Diagnostic,
  EnhancedSegment,
  LrcDocument,
  NormalizeOptions,
  NormalizeResult,
  Occurrence,
  SourceLocation,
} from '../types/index.js';
import { DEFAULT_TRAILING_DURATION_MS } from './defaults.js';

interface UnresolvedOccurrence {
  startMs: number;
  text: string;
  segments?: EnhancedSegment[];
  location: SourceLocation;
  sourceIndex: number;
}

function parseLengthMetadata(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const cleanValue = value
    .trim()
    .replace(/^\(|\)$/g, '')
    .trim();
  const dotMatch = cleanValue.match(/^(?:(\d+):)?(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (dotMatch) {
    const hours = dotMatch[1] === undefined ? 0 : Number.parseInt(dotMatch[1], 10);
    const minutes = Number.parseInt(dotMatch[2], 10);
    const seconds = Number.parseInt(dotMatch[3], 10);
    if (seconds > 59 || (dotMatch[1] !== undefined && minutes > 59)) {
      return undefined;
    }
    const fraction = dotMatch[4];
    const fractionMs = fraction ? Number.parseInt(fraction.padEnd(3, '0'), 10) : 0;
    const totalMs = hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + fractionMs;
    return Number.isSafeInteger(totalMs) ? totalMs : undefined;
  }
  return undefined;
}

function parseOffsetMetadata(value: string | undefined): number | undefined {
  if (value === undefined) {
    return 0;
  }
  const trimmed = value.trim();
  if (!/^[-+]?\d+$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function shiftSegments(segments: EnhancedSegment[], shiftMs: number): EnhancedSegment[] {
  if (shiftMs <= 0) {
    return [...segments];
  }
  return segments.map((seg) => ({
    ...seg,
    timeMs: Math.max(0, seg.timeMs - shiftMs),
  }));
}

function addSafeMilliseconds(left: number, right: number): number | undefined {
  const total = left + right;
  return Number.isSafeInteger(total) ? total : undefined;
}

/**
 * Applies offsets, expands repeated timestamps, orders occurrences, and infers boundaries.
 */
export function normalizeLyrics(
  document: LrcDocument,
  options: NormalizeOptions = {},
): NormalizeResult {
  const mode = options.mode ?? 'tolerant';
  const overlapPolicy = options.overlapPolicy ?? 'preserve';
  const diagnostics: Diagnostic[] = [];
  const parsedMetadataOffsetMs = parseOffsetMetadata(document.metadata.offset);
  const metadataOffsetMs = parsedMetadataOffsetMs ?? 0;
  const metadataLengthMs = parseLengthMetadata(document.metadata.length);
  const metadataTrackTimeMs = parseLengthMetadata(document.metadata.t_time);

  const reportInvalidMetadata = (key: string, value: string): void => {
    diagnostics.push({
      code: 'LRC_INVALID_TIMING_METADATA',
      message: `Metadata ${key} has an invalid timing value: "${value}".`,
      severity: mode === 'strict' ? 'error' : 'warning',
    });
  };

  const reportTimingOverflow = (message: string, location: SourceLocation): void => {
    diagnostics.push({
      code: 'LRC_TIME_OUT_OF_RANGE',
      message,
      severity: mode === 'strict' ? 'error' : 'warning',
      location,
    });
  };

  if (document.metadata.offset !== undefined && parsedMetadataOffsetMs === undefined) {
    reportInvalidMetadata('offset', document.metadata.offset);
  }
  if (document.metadata.length !== undefined && metadataLengthMs === undefined) {
    reportInvalidMetadata('length', document.metadata.length);
  }
  if (document.metadata.t_time !== undefined && metadataTrackTimeMs === undefined) {
    reportInvalidMetadata('t_time', document.metadata.t_time);
  }

  let callerOffsetMs = 0;
  if (options.offsetMs !== undefined) {
    if (!Number.isSafeInteger(options.offsetMs)) {
      diagnostics.push({
        code: 'LRC_INVALID_OPTION',
        message: `offsetMs must be a safe integer, received ${options.offsetMs}${mode === 'tolerant' ? '; ignored.' : '.'}`,
        severity: mode === 'strict' ? 'error' : 'warning',
      });
    } else {
      callerOffsetMs = options.offsetMs;
    }
  }

  let totalOffsetMs = metadataOffsetMs + callerOffsetMs;
  if (!Number.isSafeInteger(totalOffsetMs)) {
    diagnostics.push({
      code: 'LRC_INVALID_OPTION',
      message: `Combined offset (${totalOffsetMs}) exceeds safe integer range${mode === 'tolerant' ? '; falling back to metadata offset.' : '.'}`,
      severity: mode === 'strict' ? 'error' : 'warning',
    });
    if (mode === 'tolerant') {
      totalOffsetMs = metadataOffsetMs;
    }
  }

  let defaultTrailingDurationMs = DEFAULT_TRAILING_DURATION_MS;
  if (options.defaultTrailingDurationMs !== undefined) {
    if (
      !Number.isSafeInteger(options.defaultTrailingDurationMs) ||
      options.defaultTrailingDurationMs < 0
    ) {
      diagnostics.push({
        code: 'LRC_INVALID_OPTION',
        message: `defaultTrailingDurationMs must be a non-negative safe integer, received ${options.defaultTrailingDurationMs}${mode === 'tolerant' ? `; falling back to ${DEFAULT_TRAILING_DURATION_MS}ms.` : '.'}`,
        severity: mode === 'strict' ? 'error' : 'warning',
      });
    } else {
      defaultTrailingDurationMs = options.defaultTrailingDurationMs;
    }
  }

  let validatedTrackEndMs = options.trackEndMs;
  if (options.trackEndMs !== undefined) {
    if (!Number.isSafeInteger(options.trackEndMs) || options.trackEndMs < 0) {
      diagnostics.push({
        code: 'LRC_INVALID_OPTION',
        message: `trackEndMs must be a non-negative safe integer, received ${options.trackEndMs}${mode === 'tolerant' ? '; ignored.' : '.'}`,
        severity: mode === 'strict' ? 'error' : 'warning',
      });
      if (mode === 'tolerant') {
        validatedTrackEndMs = undefined;
      }
    }
  }

  if (mode === 'strict' && diagnostics.some((d) => d.severity === 'error')) {
    return {
      normalized: { occurrences: [] },
      diagnostics,
    };
  }

  const rawOccurrences: UnresolvedOccurrence[] = [];

  let sourceIndex = 0;
  let previousLineTimeMs: number | undefined;

  for (const line of document.lines) {
    if (line.timestamps.length === 0) {
      continue;
    }

    let lineLevelPrevTs: number | undefined;

    for (let t = 0; t < line.timestamps.length; t++) {
      const ts = line.timestamps[t];
      const calculatedStartMs = addSafeMilliseconds(ts.timeMs, totalOffsetMs);
      if (calculatedStartMs === undefined) {
        reportTimingOverflow(
          `Timestamp ${ts.timeMs}ms cannot be combined with offset ${totalOffsetMs}ms without exceeding the supported range.`,
          ts.location ?? line.location,
        );
      }
      const unclampedStartMs = calculatedStartMs ?? Number.MAX_SAFE_INTEGER;
      let effectiveStartMs = unclampedStartMs;
      const prevTs = t === 0 ? previousLineTimeMs : lineLevelPrevTs;

      if (prevTs !== undefined && effectiveStartMs < prevTs) {
        const isLineLevel = t === 0;
        const msgPrefix = isLineLevel
          ? `Line timestamp ${effectiveStartMs}ms is earlier than previous line timestamp ${prevTs}ms`
          : `Timestamp ${effectiveStartMs}ms is earlier than preceding timestamp ${prevTs}ms on the same line`;

        diagnostics.push({
          code: 'LRC_NON_MONOTONIC_TIMESTAMP',
          message: mode === 'strict' ? `${msgPrefix}.` : `${msgPrefix}; clamped to ${prevTs}ms.`,
          severity: mode === 'strict' ? 'error' : 'warning',
          location: ts.location ?? line.location,
        });

        if (mode === 'tolerant') {
          effectiveStartMs = prevTs;
        }
      }

      if (t === 0) {
        previousLineTimeMs =
          previousLineTimeMs === undefined
            ? effectiveStartMs
            : Math.max(previousLineTimeMs, effectiveStartMs);
      }
      lineLevelPrevTs =
        lineLevelPrevTs === undefined
          ? effectiveStartMs
          : Math.max(lineLevelPrevTs, effectiveStartMs);

      let segments = line.enhancedSegments ? [...line.enhancedSegments] : undefined;

      if (segments && effectiveStartMs > unclampedStartMs) {
        segments = shiftSegments(segments, effectiveStartMs - unclampedStartMs);
      }

      if (effectiveStartMs < 0) {
        diagnostics.push({
          code: 'LRC_NEGATIVE_TIME',
          message:
            mode === 'strict'
              ? `Effective timestamp ${effectiveStartMs}ms is negative after applying offsets.`
              : `Effective timestamp ${effectiveStartMs}ms is negative after applying offsets; clamped to 0.`,
          severity: mode === 'strict' ? 'error' : 'warning',
          location: ts.location ?? line.location,
        });

        if (mode === 'tolerant') {
          if (segments) {
            segments = shiftSegments(segments, -effectiveStartMs);
          }
          effectiveStartMs = 0;
        }
      }

      rawOccurrences.push({
        startMs: effectiveStartMs,
        text: line.text,
        segments,
        location: ts.location ?? line.location,
        sourceIndex: sourceIndex++,
      });
    }
  }

  if (mode === 'strict' && diagnostics.some((d) => d.severity === 'error')) {
    return {
      normalized: { occurrences: [] },
      diagnostics,
    };
  }

  rawOccurrences.sort((a, b) => {
    if (a.startMs !== b.startMs) {
      return a.startMs - b.startMs;
    }
    return a.sourceIndex - b.sourceIndex;
  });

  // Backward pass avoids an O(N²) rescan per occurrence for its next distinct start time.
  const nextDistinctStarts: (number | undefined)[] = new Array(rawOccurrences.length);
  let nextDistinct: number | undefined;
  for (let i = rawOccurrences.length - 1; i >= 0; i--) {
    if (
      i < rawOccurrences.length - 1 &&
      rawOccurrences[i + 1].startMs > rawOccurrences[i].startMs
    ) {
      nextDistinct = rawOccurrences[i + 1].startMs;
    }
    nextDistinctStarts[i] = nextDistinct;
  }

  const finalDurationCandidates = [
    { name: 'length metadata', value: metadataLengthMs },
    { name: 't_time metadata', value: metadataTrackTimeMs },
    { name: 'trackEndMs', value: validatedTrackEndMs },
  ];

  const occurrences: Occurrence[] = [];

  for (let i = 0; i < rawOccurrences.length; i++) {
    const curr = rawOccurrences[i];
    let endMs: number;

    const nextStartMs = nextDistinctStarts[i];

    let finalEnhancedSegmentStartMs: number | undefined;
    let trailingEnhancedEndMs: number | undefined;
    // The parser only emits an empty segment for a line-final timestamp, which ends the previous word.
    let finalSegmentIsBoundary = false;
    if (curr.segments && curr.segments.length > 0) {
      const lastSegment = curr.segments[curr.segments.length - 1];
      finalSegmentIsBoundary = curr.segments.length > 1 && lastSegment.text === '';
      const enhancedSegmentStartMs = addSafeMilliseconds(curr.startMs, lastSegment.timeMs);
      if (enhancedSegmentStartMs === undefined) {
        reportTimingOverflow(
          `Final enhanced segment offset ${lastSegment.timeMs}ms exceeds the supported range for lyric start ${curr.startMs}ms.`,
          curr.location,
        );
      }
      finalEnhancedSegmentStartMs = enhancedSegmentStartMs ?? Number.MAX_SAFE_INTEGER;
      const enhancedTrailingEndMs = addSafeMilliseconds(
        finalEnhancedSegmentStartMs,
        defaultTrailingDurationMs,
      );
      if (enhancedTrailingEndMs === undefined) {
        reportTimingOverflow(
          `Final enhanced segment start ${finalEnhancedSegmentStartMs}ms cannot be extended by ${defaultTrailingDurationMs}ms without exceeding the supported range.`,
          curr.location,
        );
      }
      trailingEnhancedEndMs = enhancedTrailingEndMs ?? Number.MAX_SAFE_INTEGER;
    }

    if (nextStartMs !== undefined) {
      endMs = nextStartMs;
      // Under 'preserve', if enhanced segments extend to or beyond nextStartMs, allow the line to extend with trailing duration
      if (
        overlapPolicy === 'preserve' &&
        !finalSegmentIsBoundary &&
        finalEnhancedSegmentStartMs !== undefined &&
        finalEnhancedSegmentStartMs >= endMs
      ) {
        endMs = trailingEnhancedEndMs!;
        const overlapDurationBound = finalDurationCandidates.find(
          (candidate) =>
            candidate.value !== undefined && candidate.value > finalEnhancedSegmentStartMs,
        )?.value;
        if (overlapDurationBound !== undefined && endMs > overlapDurationBound) {
          endMs = overlapDurationBound;
        }
      }
    } else {
      const finalTimingAnchorMs = finalEnhancedSegmentStartMs ?? curr.startMs;
      const finalTimingAnchorName =
        finalEnhancedSegmentStartMs === undefined
          ? 'final lyric start'
          : finalSegmentIsBoundary
            ? 'line-final enhanced timestamp'
            : 'final enhanced segment start';
      const finalDurationBound = finalDurationCandidates.find((candidate) => {
        if (candidate.value === undefined) {
          return false;
        }
        // A boundary may coincide with the bound; a sung segment needs positive duration.
        const isBeforeAnchor = finalSegmentIsBoundary
          ? candidate.value < finalTimingAnchorMs
          : candidate.value <= finalTimingAnchorMs;
        if (isBeforeAnchor) {
          diagnostics.push({
            code: 'LRC_FINAL_DURATION_BEFORE_LYRIC',
            message: `${candidate.name} (${candidate.value}ms) is ${finalSegmentIsBoundary ? 'earlier than' : 'not later than'} the ${finalTimingAnchorName}.`,
            severity: mode === 'strict' ? 'error' : 'warning',
            location: curr.location,
          });
          return false;
        }
        return true;
      });
      if (finalDurationBound?.value !== undefined) {
        endMs = finalDurationBound.value;
      } else {
        const plainTrailingEndMs = addSafeMilliseconds(curr.startMs, defaultTrailingDurationMs);
        if (trailingEnhancedEndMs === undefined && plainTrailingEndMs === undefined) {
          reportTimingOverflow(
            `Final lyric start ${curr.startMs}ms cannot be extended by ${defaultTrailingDurationMs}ms without exceeding the supported range.`,
            curr.location,
          );
        }
        endMs = trailingEnhancedEndMs ?? plainTrailingEndMs ?? Number.MAX_SAFE_INTEGER;
      }
    }

    // Ensure endMs is never less than the last enhanced segment start (unless truncate explicitly requested)
    if (
      finalEnhancedSegmentStartMs !== undefined &&
      endMs < finalEnhancedSegmentStartMs &&
      overlapPolicy !== 'truncate'
    ) {
      endMs = finalEnhancedSegmentStartMs;
    }

    const occ: Occurrence = {
      startMs: curr.startMs,
      endMs,
      text: curr.text,
    };

    if (curr.segments && curr.segments.length > 0) {
      occ.segments = curr.segments;
    }

    occurrences.push(occ);
  }

  if (mode === 'strict' && diagnostics.some((d) => d.severity === 'error')) {
    return {
      normalized: { occurrences: [] },
      diagnostics,
    };
  }

  if (overlapPolicy === 'truncate') {
    for (let i = 0; i < occurrences.length - 1; i++) {
      const nextStrictlyLaterStart = nextDistinctStarts[i];
      if (nextStrictlyLaterStart !== undefined && occurrences[i].endMs > nextStrictlyLaterStart) {
        occurrences[i].endMs = nextStrictlyLaterStart;
      }
    }
  } else if (overlapPolicy === 'error') {
    for (let i = 0; i < occurrences.length - 1; i++) {
      const nextStrictlyLaterStart = nextDistinctStarts[i];
      if (nextStrictlyLaterStart !== undefined && occurrences[i].endMs > nextStrictlyLaterStart) {
        diagnostics.push({
          code: 'LRC_OVERLAPPING_OCCURRENCE',
          message: `Occurrence starting at ${occurrences[i].startMs}ms overlaps with next occurrence starting at ${nextStrictlyLaterStart}ms.`,
          severity: mode === 'strict' ? 'error' : 'warning',
          location: rawOccurrences[i].location,
        });
      }
    }
    if (mode === 'strict' && diagnostics.some((d) => d.severity === 'error')) {
      return {
        normalized: { occurrences: [] },
        diagnostics,
      };
    }
  }

  return {
    normalized: { occurrences },
    diagnostics,
  };
}
