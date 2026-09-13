import type { NormalizedLyrics } from '../../types/index.js';

// A leading pre-token segment (before the first enhanced tag) can be whitespace-only padding rather
// than sung text, so the first *sung* word may start later than segments[0]. Drops any such leading
// padding (falling back to the original segments if every one is whitespace-only, which shouldn't
// happen for valid lyrics) so callers consistently treat the first non-whitespace segment as the start.
export function sungSegments(
  segments: NonNullable<NormalizedLyrics['occurrences'][number]['segments']>,
): NonNullable<NormalizedLyrics['occurrences'][number]['segments']> {
  const firstSungIndex = segments.findIndex((segment) => segment.text.trim().length > 0);
  return firstSungIndex <= 0 ? segments : segments.slice(firstSungIndex);
}
