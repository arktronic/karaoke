import type {
  Diagnostic,
  EnhancedSegment,
  LrcLine,
  LrcTimestamp,
  ParseOptions,
  ParseResult,
  SourceLocation,
} from '../types/index.js';

type ParsedTimestamp =
  | { kind: 'timestamp'; timeMs: number }
  | { kind: 'malformed'; code: string; message: string }
  | { kind: 'lyric-text'; code: string; message: string };

type ParsedEnhanced =
  | { ok: true; text: string; segments: EnhancedSegment[] }
  | { ok: false; code: string; message: string; location: SourceLocation };

interface LeadingTimestampResult {
  timestamps: LrcTimestamp[];
  textStartIndex: number;
  malformed: Diagnostic | null;
}

interface ParsedMetadataLine {
  entries: Record<string, string>;
  malformed: Diagnostic | null;
}

interface PreparedLine {
  raw: string;
  lineNumber: number;
  leadingWhitespaceLength: number;
  content: string;
}

function toLocation(line: number, column: number): SourceLocation {
  return { line, column };
}

function makeDiagnostic(
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  location: SourceLocation,
): Diagnostic {
  return { severity, code, message, location };
}

function pushUnknownEntry(
  document: ParseResult['document'],
  raw: string,
  lineNumber: number,
): void {
  document.unknownEntries.push({ raw, location: toLocation(lineNumber, 1) });
}

function setMetadataValue(metadata: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(metadata, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function skipSpacesAndTabs(text: string, startIndex: number): number {
  let index = startIndex;
  while (index < text.length && (text[index] === ' ' || text[index] === '\t')) {
    index += 1;
  }
  return index;
}

function prepareLine(rawLine: string, lineNumber: number): PreparedLine {
  const raw = rawLine.replace(/^\uFEFF/, '');
  const leadingWhitespaceLength = raw.length - raw.trimStart().length;
  return {
    raw,
    lineNumber,
    leadingWhitespaceLength,
    content: raw.slice(leadingWhitespaceLength),
  };
}

function handleMalformedLine(
  options: ParseOptions,
  document: ParseResult['document'],
  diagnostics: Diagnostic[],
  diagnostic: Diagnostic,
  raw: string,
  lineNumber: number,
): ParseResult | null {
  if (options.mode === 'strict') {
    diagnostics.push(diagnostic);
    return { document, diagnostics };
  }

  diagnostics.push({ ...diagnostic, severity: 'warning' });
  pushUnknownEntry(document, raw, lineNumber);
  return null;
}

function parseTimestampToken(token: string): ParsedTimestamp {
  const dotMatch = token.match(/^(?:(\d+):)?(\d+):(\d{2})\.(\d{2}|\d{3})$/);
  const noDotMatch = token.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);

  if (dotMatch) {
    const hours = dotMatch[1] === undefined ? 0 : Number.parseInt(dotMatch[1], 10);
    const minutes = Number.parseInt(dotMatch[2], 10);
    const seconds = Number.parseInt(dotMatch[3], 10);
    if (seconds > 59) {
      return {
        kind: 'malformed',
        code: 'LRC_TIMESTAMP_SECONDS_RANGE',
        message: `Invalid timestamp seconds in "${token}". Seconds must be 00-59.`,
      };
    }

    if (dotMatch[1] !== undefined && minutes > 59) {
      return {
        kind: 'malformed',
        code: 'LRC_TIMESTAMP_MINUTES_RANGE',
        message: `Invalid timestamp minutes in "${token}". Minutes must be 00-59 when hours are present.`,
      };
    }

    const fraction = dotMatch[4];
    const fractionMs =
      fraction.length === 2 ? Number.parseInt(fraction, 10) * 10 : Number.parseInt(fraction, 10);
    const timeMs = hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + fractionMs;
    if (!Number.isSafeInteger(timeMs)) {
      return {
        kind: 'malformed',
        code: 'LRC_TIMESTAMP_OUT_OF_RANGE',
        message: `Timestamp "${token}" exceeds the supported range.`,
      };
    }
    return { kind: 'timestamp', timeMs };
  }

  if (noDotMatch) {
    const minutes = Number.parseInt(noDotMatch[1], 10);
    const seconds = Number.parseInt(noDotMatch[2], 10);
    if (seconds > 59) {
      return {
        kind: 'malformed',
        code: 'LRC_TIMESTAMP_SECONDS_RANGE',
        message: `Invalid timestamp seconds in "${token}". Seconds must be 00-59.`,
      };
    }

    const fraction = noDotMatch[3];
    const fractionMs = fraction === undefined ? 0 : Number.parseInt(fraction, 10) * 10;
    const timeMs = minutes * 60_000 + seconds * 1_000 + fractionMs;
    if (!Number.isSafeInteger(timeMs)) {
      return {
        kind: 'malformed',
        code: 'LRC_TIMESTAMP_OUT_OF_RANGE',
        message: `Timestamp "${token}" exceeds the supported range.`,
      };
    }
    return { kind: 'timestamp', timeMs };
  }

  return {
    kind: /^\d+:/.test(token) ? 'malformed' : 'lyric-text',
    code: 'LRC_TIMESTAMP_INVALID',
    message: `Invalid timestamp format: "${token}". Expected mm:ss, mm:ss.xx, mm:ss.xxx, hh:mm:ss.xx, or mm:ss:cc.`,
  };
}

function parseLeadingTimestamps(
  lineText: string,
  lineNumber: number,
  baseColumn: number,
): LeadingTimestampResult {
  const timestamps: LrcTimestamp[] = [];
  let index = 0;

  while (index < lineText.length && lineText[index] === '[') {
    const closeIndex = lineText.indexOf(']', index + 1);
    if (closeIndex === -1) {
      const location = toLocation(lineNumber, baseColumn + index);
      return {
        timestamps,
        textStartIndex: index,
        malformed: makeDiagnostic(
          'error',
          'LRC_TIMESTAMP_UNCLOSED',
          'Unclosed timestamp bracket.',
          location,
        ),
      };
    }

    const token = lineText.slice(index + 1, closeIndex);
    const parsed = parseTimestampToken(token);
    if (parsed.kind === 'lyric-text') {
      return { timestamps, textStartIndex: index, malformed: null };
    }

    if (parsed.kind === 'malformed') {
      return {
        timestamps,
        textStartIndex: index,
        malformed: makeDiagnostic(
          'error',
          parsed.code,
          parsed.message,
          toLocation(lineNumber, baseColumn + index),
        ),
      };
    }

    timestamps.push({
      timeMs: parsed.timeMs,
      location: toLocation(lineNumber, baseColumn + index),
    });

    index = skipSpacesAndTabs(lineText, closeIndex + 1);
  }

  return { timestamps, textStartIndex: index, malformed: null };
}

function hasLeadingUnclosedMetadataTag(lineText: string): boolean {
  if (!lineText.startsWith('[') || lineText.includes(']')) {
    return false;
  }

  const separator = lineText.indexOf(':', 1);
  if (separator === -1) {
    return false;
  }

  const key = lineText.slice(1, separator).trim();
  return key.length > 0 && !/^\d+$/.test(key);
}

function parseMetadataLine(
  lineText: string,
  lineNumber: number,
  baseColumn: number,
): ParsedMetadataLine | null {
  if (!lineText.startsWith('[')) {
    return null;
  }

  const entries: Record<string, string> = {};
  let index = 0;
  let parsedAny = false;

  while (index < lineText.length) {
    if (lineText[index] !== '[') {
      break;
    }

    const closeIndex = lineText.indexOf(']', index + 1);
    if (closeIndex === -1) {
      return {
        entries,
        malformed: makeDiagnostic(
          'warning',
          'LRC_METADATA_UNCLOSED',
          'Unclosed metadata bracket.',
          toLocation(lineNumber, baseColumn + index),
        ),
      };
    }

    const inner = lineText.slice(index + 1, closeIndex);
    const separator = inner.indexOf(':');
    if (separator <= 0) {
      break;
    }

    const key = inner.slice(0, separator).trim();
    if (key.length === 0) {
      break;
    }

    setMetadataValue(entries, key, inner.slice(separator + 1));
    parsedAny = true;
    index = skipSpacesAndTabs(lineText, closeIndex + 1);
  }

  if (!parsedAny) {
    return null;
  }

  if (index !== lineText.length) {
    return {
      entries,
      malformed: makeDiagnostic(
        'warning',
        'LRC_METADATA_TRAILING_TEXT',
        'Trailing text after metadata tags was ignored.',
        toLocation(lineNumber, baseColumn + index),
      ),
    };
  }

  return { entries, malformed: null };
}

function parseEnhancedSegments(
  text: string,
  lineNumber: number,
  textColumn: number,
  baseTimeMs: number,
): ParsedEnhanced {
  const tokenRegex = /<([^>]+)>/g;
  const segments: EnhancedSegment[] = [];
  let currentOffset = 0;
  let cursor = 0;
  let hasToken = false;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const parsed = parseTimestampToken(match[1]);
    if (parsed.kind === 'lyric-text') {
      continue;
    }

    if (parsed.kind === 'malformed') {
      return {
        ok: false,
        code: parsed.code,
        message: `Invalid enhanced timestamp "${match[1]}".`,
        location: toLocation(lineNumber, textColumn + match.index + 1),
      };
    }

    hasToken = true;
    const before = text.slice(cursor, match.index);
    if (before.length > 0) {
      segments.push({
        text: before,
        timeMs: currentOffset,
        location: toLocation(lineNumber, textColumn + cursor),
      });
    }

    if (parsed.timeMs < baseTimeMs) {
      return {
        ok: false,
        code: 'LRC_ENHANCED_BEFORE_LINE_TIMESTAMP',
        message: 'Enhanced segment timestamp is earlier than the line timestamp.',
        location: toLocation(lineNumber, textColumn + match.index + 1),
      };
    }

    const nextOffset = parsed.timeMs - baseTimeMs;
    if (nextOffset < currentOffset) {
      return {
        ok: false,
        code: 'LRC_ENHANCED_NON_MONOTONIC',
        message: 'Enhanced segment timestamps must be monotonic within a line.',
        location: toLocation(lineNumber, textColumn + match.index + 1),
      };
    }

    currentOffset = nextOffset;
    cursor = match.index + match[0].length;
  }

  if (!hasToken) {
    const unclosedIndex = text.search(/<\d+:/);
    if (unclosedIndex !== -1) {
      return {
        ok: false,
        code: 'LRC_ENHANCED_UNCLOSED',
        message: 'Unclosed enhanced timestamp marker.',
        location: toLocation(lineNumber, textColumn + unclosedIndex),
      };
    }

    return { ok: true, text, segments: [] };
  }

  const tail = text.slice(cursor);
  const unclosedIndex = tail.search(/<\d+:/);
  if (unclosedIndex !== -1) {
    return {
      ok: false,
      code: 'LRC_ENHANCED_UNCLOSED',
      message: 'Unclosed enhanced timestamp marker.',
      location: toLocation(lineNumber, textColumn + cursor + unclosedIndex),
    };
  }

  // A line-final tag with no text still marks where the previous segment ends.
  if (tail.length > 0 || segments.length > 0) {
    segments.push({
      text: tail,
      timeMs: currentOffset,
      location: toLocation(lineNumber, textColumn + cursor),
    });
  }

  return {
    ok: true,
    text: collapseSpaces(segments.map((segment) => segment.text).join('')).trim(),
    segments,
  };
}

// Some enhanced-LRC generators pad tags with a space on both sides, doubling whitespace once segments are joined.
function collapseSpaces(text: string): string {
  return text.replace(/ {2,}/g, ' ');
}

/** Parses LRC source text into an editable {@link LrcDocument} plus diagnostics. */
export function parseLrc(text: string, options: ParseOptions): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const document: ParseResult['document'] = {
    metadata: {},
    lines: [],
    unknownEntries: [],
  };

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const { raw, lineNumber, leadingWhitespaceLength, content } = prepareLine(
      lines[index],
      index + 1,
    );

    if (content.trim().length === 0) {
      continue;
    }

    if (hasLeadingUnclosedMetadataTag(content)) {
      const metadata = parseMetadataLine(content, lineNumber, leadingWhitespaceLength + 1);
      if (metadata?.malformed) {
        const result = handleMalformedLine(
          options,
          document,
          diagnostics,
          { ...metadata.malformed, severity: 'error' },
          raw,
          lineNumber,
        );
        if (result) {
          return result;
        }
      }
      continue;
    }

    const parsedLeading = parseLeadingTimestamps(content, lineNumber, leadingWhitespaceLength + 1);
    if (parsedLeading.malformed) {
      const result = handleMalformedLine(
        options,
        document,
        diagnostics,
        parsedLeading.malformed,
        raw,
        lineNumber,
      );
      if (result) {
        return result;
      }
      continue;
    }

    if (parsedLeading.timestamps.length > 0) {
      const lyricText = content.slice(parsedLeading.textStartIndex);
      const line: LrcLine = {
        timestamps: parsedLeading.timestamps,
        text: lyricText,
        location: toLocation(lineNumber, leadingWhitespaceLength + 1),
      };

      const enhanced = parseEnhancedSegments(
        lyricText,
        lineNumber,
        leadingWhitespaceLength + parsedLeading.textStartIndex + 1,
        parsedLeading.timestamps[0].timeMs,
      );
      if (!enhanced.ok) {
        const result = handleMalformedLine(
          options,
          document,
          diagnostics,
          makeDiagnostic('error', enhanced.code, enhanced.message, enhanced.location),
          raw,
          lineNumber,
        );
        if (result) {
          return result;
        }
        continue;
      }

      line.text = enhanced.text;
      if (enhanced.segments.length > 0) {
        line.enhancedSegments = enhanced.segments;
      }

      document.lines.push(line);
      continue;
    }

    const metadata = parseMetadataLine(content, lineNumber, leadingWhitespaceLength + 1);
    if (metadata) {
      for (const [key, value] of Object.entries(metadata.entries)) {
        setMetadataValue(document.metadata, key, value);
      }
      if (metadata.malformed) {
        const result = handleMalformedLine(
          options,
          document,
          diagnostics,
          { ...metadata.malformed, severity: 'error' },
          raw,
          lineNumber,
        );
        if (result) {
          return result;
        }
      }
      continue;
    }

    document.lines.push({
      timestamps: [],
      text: content,
      location: toLocation(lineNumber, leadingWhitespaceLength + 1),
    });
  }

  return { document, diagnostics };
}
