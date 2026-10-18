export interface LyricsSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  lyrics: string;
}

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; cache?: RequestCache },
) => Promise<Response>;

const SEARCH_URL = 'https://lrclib.net/api/search';

/** Removes line and word timestamps from LRC text. */
export function stripLrcTimestamps(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\[\d+:\d+(?:[.:]\d+)?\]|<\d+:\d+(?:[.:]\d+)?>/g, '').trim())
    .join('\n');
}

/** Turns a file name into a starting search query. */
export function guessSearchQuery(fileName: string): string {
  return fileName
    .replace(/\.[^./\\]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim();
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function searchLyrics(
  query: string,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
  signal?: AbortSignal,
): Promise<LyricsSearchResult[]> {
  // A cached error response without CORS headers can otherwise be reused until a hard reload.
  let response: Response;
  try {
    response = await fetchFn(`${SEARCH_URL}?q=${encodeURIComponent(query)}`, {
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'Could not reach LRCLIB. It may be temporarily unavailable; try again shortly.',
        { cause: error },
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Lyrics search failed (HTTP ${response.status}); try again shortly.`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error('Unexpected response from lyrics search');
  }

  const results: LyricsSearchResult[] = [];
  for (const item of body as Record<string, unknown>[]) {
    const plain = asString(item.plainLyrics);
    const lyrics = plain || stripLrcTimestamps(asString(item.syncedLyrics));
    if (!lyrics.trim() || typeof item.id !== 'number') {
      continue;
    }
    results.push({
      id: item.id,
      trackName: asString(item.trackName),
      artistName: asString(item.artistName),
      albumName: asString(item.albumName),
      lyrics,
    });
  }
  return results;
}
