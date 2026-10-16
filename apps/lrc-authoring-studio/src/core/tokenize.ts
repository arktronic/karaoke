import type { Line, Project, Token } from './types';

/** Splits on whitespace and on `/` (syllable marker); `\/` is a literal slash. */
export function tokenizeLine(text: string): Token[] {
  const tokens: Token[] = [];
  let current = '';

  const flush = (spaceAfter: boolean): void => {
    if (current) {
      tokens.push({ text: current, spaceAfter });
      current = '';
    } else if (spaceAfter && tokens.length > 0) {
      tokens[tokens.length - 1].spaceAfter = true;
    }
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '/') {
      current += '/';
      i += 1;
    } else if (ch === '/') {
      flush(false);
    } else if (/\s/.test(ch)) {
      flush(true);
    } else {
      current += ch;
    }
  }
  flush(false);

  if (tokens.length > 0) {
    tokens[tokens.length - 1].spaceAfter = false;
  }
  return tokens;
}

/** Blank lines are separators and produce no timed line. */
export function tokenizeLyrics(text: string): Project {
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tokens = tokenizeLine(raw);
    if (tokens.length > 0) {
      lines.push({ tokens });
    }
  }
  return { lines };
}

function sameLineText(a: Line, b: Line): boolean {
  return (
    a.tokens.length === b.tokens.length &&
    a.tokens.every((t, i) => t.text === b.tokens[i].text && t.spaceAfter === b.tokens[i].spaceAfter)
  );
}

/** Re-tokenizes edited lyrics, keeping timings of lines whose index and text are unchanged. */
export function mergeLyrics(previous: Project, text: string): Project {
  const next = tokenizeLyrics(text);
  next.lines.forEach((line, i) => {
    const old = previous.lines[i];
    if (!old || !sameLineText(old, line)) {
      return;
    }
    line.tokens.forEach((token, j) => {
      token.startMs = old.tokens[j].startMs;
      token.endMs = old.tokens[j].endMs;
    });
  });
  return next;
}
