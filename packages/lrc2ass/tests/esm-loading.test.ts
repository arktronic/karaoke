import { describe, expect, it } from 'vitest';

describe('ESM loading', () => {
  it('loads the package via native dynamic import and exposes the public API', async () => {
    const lrc2ass = await import('../src/index.js');

    expect(typeof lrc2ass.parseLrc).toBe('function');
    expect(typeof lrc2ass.normalizeLyrics).toBe('function');
    expect(typeof lrc2ass.planEvents).toBe('function');
    expect(typeof lrc2ass.serializeAss).toBe('function');
    expect(typeof lrc2ass.convert).toBe('function');
    expect(typeof lrc2ass.assColorFromHex).toBe('function');
    expect(lrc2ass.DEFAULT_PARSE_OPTIONS).toEqual({ mode: 'tolerant' });
    expect(lrc2ass.DEFAULT_PLAN_OPTIONS).toBeDefined();
    expect(lrc2ass.DEFAULT_TRAILING_DURATION_MS).toBe(5000);
  });

  it('runs a working end-to-end conversion through the dynamically loaded module', async () => {
    const { convert } = await import('../src/index.js');

    const result = convert('[offset:0]\r\n[00:00.00]Hello world\r\n', {
      plan: { fadeInMs: 0, fadeOutMs: 0 },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.text).toContain('[Script Info]\r\n');
    expect(result.text).toContain(
      'Dialogue: 0,0:00:00.00,0:00:05.00,Lyrics,,0,0,84,,{\\an8}{\\q2}Hello world',
    );
  });
});
