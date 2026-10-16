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
 * that follows lives in a whitespace-only segment.
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
      const isWordEnd = token.spaceAfter || i === line.tokens.length - 1;
      text += `<${formatLrcTime(token.startMs!)}>${token.text}`;
      if (token.endMs !== undefined && isWordEnd) {
        text += `<${formatLrcTime(token.endMs)}>`;
      }
      if (token.spaceAfter) {
        text += ' ';
      }
    });
    out.push(text);
  });

  return { text: out.length > 0 ? `${out.join('\n')}\n` : '', skippedLines };
}
