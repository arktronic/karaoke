import { formatLrcTime } from './time';
import type { Project } from './types';

export interface LrcExport {
  text: string;
  /** Zero-based indexes of lines omitted because not every token has a start. */
  skippedLines: number[];
}

/**
 * Writes enhanced LRC; lines with any untimed token are omitted.
 * A word end is written right after the word, before its trailing space, so the silence
 * that follows lives in a whitespace-only segment. A line-final end gets a space too, so
 * parsers that only keep tags followed by text still see it.
 */
export function serializeLrc(project: Project): LrcExport {
  const out: string[] = [];
  const skippedLines: number[] = [];

  project.lines.forEach((line, index) => {
    if (line.tokens.length === 0 || line.tokens.some((t) => t.startMs === undefined)) {
      skippedLines.push(index);
      return;
    }

    let text = `[${formatLrcTime(line.tokens[0].startMs!)}]`;
    line.tokens.forEach((token, i) => {
      const isLast = i === line.tokens.length - 1;
      const isWordEnd = token.spaceAfter || isLast;
      text += `<${formatLrcTime(token.startMs!)}>${token.text}`;
      if (token.endMs !== undefined && isWordEnd) {
        text += `<${formatLrcTime(token.endMs)}>`;
      }
      if (token.spaceAfter || (isLast && token.endMs !== undefined)) {
        text += ' ';
      }
    });
    out.push(text);
  });

  return { text: out.length > 0 ? `${out.join('\n')}\n` : '', skippedLines };
}
