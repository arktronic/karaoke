import { guessSearchQuery } from '../core/lrclib';

/** Builds a search query from the file's artist/title tags, falling back to its name. */
export async function readSearchQuery(file: File): Promise<string> {
  try {
    const { parseBlob } = await import('music-metadata');
    const { common } = await parseBlob(file, { skipCovers: true, duration: false });
    const query = [common.artist, common.title].filter(Boolean).join(' ').trim();
    if (common.title && query) {
      return query;
    }
  } catch {
    // Unreadable or untagged files fall through to the file name.
  }
  return guessSearchQuery(file.name);
}
