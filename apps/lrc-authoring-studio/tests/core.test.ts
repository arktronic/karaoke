import { describe, expect, it, vi } from 'vitest';
import { guessSearchQuery, searchLyrics, stripLrcTimestamps } from '../src/core/lrclib';
import { computePeaks } from '../src/core/peaks';

describe('computePeaks', () => {
  it('takes the loudest absolute sample per bucket across channels', () => {
    const left = new Float32Array([0, 0.5, -0.25, 0, 0, 0.1, 0, 0]);
    const right = new Float32Array([0, 0, 0, -0.75, 0, 0, 0, 0]);
    // 4 samples/s with 1 peak/s -> 4 samples per bucket
    const peaks = computePeaks([left, right], 4, 1);
    expect(peaks.length).toBe(2);
    expect(peaks[0]).toBeCloseTo(0.75);
    expect(peaks[1]).toBeCloseTo(0.1);
  });

  it('handles empty input', () => {
    expect(computePeaks([], 44100).length).toBe(0);
  });
});

describe('stripLrcTimestamps', () => {
  it('removes line and word tags', () => {
    expect(stripLrcTimestamps('[00:01.00]<00:01.00>Hello <00:02.00>world\n[00:03.5]Bye')).toBe(
      'Hello world\nBye',
    );
  });
});

describe('guessSearchQuery', () => {
  it('drops the extension and underscores', () => {
    expect(guessSearchQuery('Artist_-_Song name.final.mp3')).toBe('Artist - Song name.final');
  });
});

describe('searchLyrics', () => {
  function respond(body: unknown, ok = true, status = 200) {
    return vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response);
  }

  it('maps results, falling back to stripped synced lyrics and dropping empty ones', async () => {
    const fetchFn = respond([
      { id: 1, trackName: 'A', artistName: 'B', albumName: 'C', plainLyrics: 'plain' },
      { id: 2, trackName: 'D', artistName: 'E', syncedLyrics: '[00:01.00]synced' },
      { id: 3, trackName: 'F', instrumental: true },
    ]);
    const results = await searchLyrics('a b', fetchFn);
    expect(results).toEqual([
      { id: 1, trackName: 'A', artistName: 'B', albumName: 'C', lyrics: 'plain' },
      { id: 2, trackName: 'D', artistName: 'E', albumName: '', lyrics: 'synced' },
    ]);
    expect(fetchFn.mock.calls[0][0]).toBe('https://lrclib.net/api/search?q=a%20b');
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('throws on HTTP errors and malformed bodies', async () => {
    await expect(searchLyrics('x', respond({}, false, 500))).rejects.toThrow('HTTP 500');
    await expect(searchLyrics('x', respond({ not: 'array' }))).rejects.toThrow('Unexpected');
  });

  it('maps network/CORS failures to a friendly message but passes aborts through', async () => {
    const network = vi.fn().mockRejectedValue(new TypeError('NetworkError'));
    await expect(searchLyrics('x', network)).rejects.toThrow('Could not reach LRCLIB');

    const aborted = new DOMException('aborted', 'AbortError');
    await expect(searchLyrics('x', vi.fn().mockRejectedValue(aborted))).rejects.toBe(aborted);
  });
});
