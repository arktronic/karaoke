import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { convert } from 'lrc2ass';

/** Converts LRC text to ASS via lrc2ass, or passes ASS text through unchanged. */
export function resolveAssText(text: string, extension: string): string {
  const ext = extension.toLowerCase();
  if (ext === '.lrc') {
    return convert(text).text;
  }
  if (ext === '.ass') {
    return text;
  }
  throw new Error(`Unsupported lyrics file extension: ${extension}`);
}

/** Reads a lyrics file from disk and resolves it to ASS text, based on its extension. */
export async function resolveLyricsFile(path: string): Promise<string> {
  const text = await readFile(path, 'utf8');
  return resolveAssText(text, extname(path));
}
