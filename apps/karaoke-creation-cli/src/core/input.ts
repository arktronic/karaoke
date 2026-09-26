import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { convert } from 'lrc2ass';

export interface ResolvedLyrics {
  text: string;
  diagnostics: ReturnType<typeof convert>['diagnostics'];
}

/** Converts LRC text to ASS via lrc2ass, or passes ASS text through unchanged. */
export function resolveAssText(text: string, extension: string): string {
  return resolveAssTextWithDiagnostics(text, extension).text;
}

/** Converts lyrics to ASS and preserves any conversion diagnostics. */
export function resolveAssTextWithDiagnostics(text: string, extension: string): ResolvedLyrics {
  const ext = extension.toLowerCase();
  if (ext === '.lrc') {
    const result = convert(text);
    return { text: result.text, diagnostics: result.diagnostics };
  }
  if (ext === '.ass') {
    return { text, diagnostics: [] };
  }
  throw new Error(`Unsupported lyrics file extension: ${extension}`);
}

/** Reads a lyrics file from disk and resolves it to ASS text, based on its extension. */
export async function resolveLyricsFile(path: string): Promise<string> {
  return (await resolveLyricsFileWithDiagnostics(path)).text;
}

/** Reads a lyrics file and preserves any conversion diagnostics. */
export async function resolveLyricsFileWithDiagnostics(path: string): Promise<ResolvedLyrics> {
  const text = await readFile(path, 'utf8');
  return resolveAssTextWithDiagnostics(text, extname(path));
}
