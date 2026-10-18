import { describe, expect, it } from 'vitest';
import { normalizeLyrics } from '../src/index.js';
import type { LrcDocument } from '../src/index.js';

describe('normalizeLyrics', () => {
  it('normalizes simple timed lines and infers end times from next line', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'First line',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 4000, location: { line: 2, column: 1 } }],
          text: 'Second line',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { defaultTrailingDurationMs: 2500 });
    expect(result.diagnostics).toEqual([]);
    expect(result.normalized.occurrences).toEqual([
      {
        startMs: 1000,
        endMs: 4000,
        text: 'First line',
      },
      {
        startMs: 4000,
        endMs: 6500,
        text: 'Second line',
      },
    ]);
  });

  it('applies metadata offset and caller offset', () => {
    const document: LrcDocument = {
      metadata: { offset: '500' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Hello',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    // metadata offset 500 + caller offset 200 = 700ms added
    const result = normalizeLyrics(document, { offsetMs: 200, defaultTrailingDurationMs: 2000 });
    expect(result.normalized.occurrences[0].startMs).toBe(1700);
    expect(result.normalized.occurrences[0].endMs).toBe(3700);
  });

  it('handles negative metadata offset and negative caller offset', () => {
    const document: LrcDocument = {
      metadata: { offset: '-200' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Hello',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { offsetMs: -100, defaultTrailingDurationMs: 1000 });
    expect(result.normalized.occurrences[0].startMs).toBe(700);
    expect(result.normalized.occurrences[0].endMs).toBe(1700);
  });

  it('rejects malformed offset metadata and defaults to 0 offset', () => {
    const invalidOffsets = ['500ms', '12.34', 'abc', '+', '-', '1000px', '9007199254740992'];
    for (const offset of invalidOffsets) {
      const document: LrcDocument = {
        metadata: { offset },
        lines: [
          {
            timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
            text: 'Hello',
            location: { line: 1, column: 1 },
          },
        ],
        unknownEntries: [],
      };

      const result = normalizeLyrics(document, { offsetMs: 0, defaultTrailingDurationMs: 1000 });
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: 'LRC_INVALID_TIMING_METADATA', severity: 'warning' }),
      ]);
      expect(result.normalized.occurrences[0].startMs).toBe(1000);
      expect(result.normalized.occurrences[0].endMs).toBe(2000);
    }
  });

  it('expands repeated timestamps and preserves source order for equal start times', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [
            { timeMs: 1000, location: { line: 1, column: 1 } },
            { timeMs: 5000, location: { line: 1, column: 10 } },
          ],
          text: 'Chorus line',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 3000, location: { line: 2, column: 1 } }],
          text: 'Verse line',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { defaultTrailingDurationMs: 2000 });
    expect(result.normalized.occurrences).toEqual([
      {
        startMs: 1000,
        endMs: 3000,
        text: 'Chorus line',
      },
      {
        startMs: 3000,
        endMs: 5000,
        text: 'Verse line',
      },
      {
        startMs: 5000,
        endMs: 7000,
        text: 'Chorus line',
      },
    ]);
  });

  it('preserves source order when multiple lines have identical start times', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Line 1',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 1000, location: { line: 2, column: 1 } }],
          text: 'Line 2',
          location: { line: 2, column: 1 },
        },
        {
          timestamps: [{ timeMs: 3000, location: { line: 3, column: 1 } }],
          text: 'Line 3',
          location: { line: 3, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { defaultTrailingDurationMs: 2000 });
    expect(result.normalized.occurrences[0].text).toBe('Line 1');
    expect(result.normalized.occurrences[0].startMs).toBe(1000);
    expect(result.normalized.occurrences[0].endMs).toBe(3000);

    expect(result.normalized.occurrences[1].text).toBe('Line 2');
    expect(result.normalized.occurrences[1].startMs).toBe(1000);
    expect(result.normalized.occurrences[1].endMs).toBe(3000);

    expect(result.normalized.occurrences[2].text).toBe('Line 3');
    expect(result.normalized.occurrences[2].startMs).toBe(3000);
    expect(result.normalized.occurrences[2].endMs).toBe(5000);
  });

  it('handles enhanced segments on simple and repeated lines', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [
            { timeMs: 1000, location: { line: 1, column: 1 } },
            { timeMs: 6000, location: { line: 1, column: 10 } },
          ],
          text: 'Hello world',
          enhancedSegments: [
            { text: 'Hello ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'world', timeMs: 1500, location: { line: 1, column: 10 } },
          ],
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 4000, location: { line: 2, column: 1 } }],
          text: 'Interlude',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { defaultTrailingDurationMs: 2000 });
    expect(result.normalized.occurrences).toEqual([
      {
        startMs: 1000,
        endMs: 4000,
        text: 'Hello world',
        segments: [
          { text: 'Hello ', timeMs: 0, location: { line: 1, column: 1 } },
          { text: 'world', timeMs: 1500, location: { line: 1, column: 10 } },
        ],
      },
      {
        startMs: 4000,
        endMs: 6000,
        text: 'Interlude',
      },
      {
        startMs: 6000,
        endMs: 9500,
        text: 'Hello world',
        segments: [
          { text: 'Hello ', timeMs: 0, location: { line: 1, column: 1 } },
          { text: 'world', timeMs: 1500, location: { line: 1, column: 10 } },
        ],
      },
    ]);
  });

  it('infers final line end from length metadata first, then trackEndMs, then defaultTrailingDurationMs', () => {
    const docWithLength: LrcDocument = {
      metadata: { length: '03:30' }, // 210,000 ms
      lines: [
        {
          timestamps: [{ timeMs: 200000, location: { line: 1, column: 1 } }],
          text: 'Ending',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    // 1. Length metadata wins over trackEndMs and defaultTrailingDurationMs
    const res1 = normalizeLyrics(docWithLength, {
      trackEndMs: 220000,
      defaultTrailingDurationMs: 5000,
    });
    expect(res1.normalized.occurrences[0].endMs).toBe(210000);

    // 2. trackEndMs wins over defaultTrailingDurationMs when length metadata is absent
    const docNoLength: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: 10000, location: { line: 1, column: 1 } }],
          text: 'Ending',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };
    const res2 = normalizeLyrics(docNoLength, {
      trackEndMs: 15000,
      defaultTrailingDurationMs: 2000,
    });
    expect(res2.normalized.occurrences[0].endMs).toBe(15000);

    // 3. defaultTrailingDurationMs fallback
    const res3 = normalizeLyrics(docNoLength, { defaultTrailingDurationMs: 3000 });
    expect(res3.normalized.occurrences[0].endMs).toBe(13000);
  });

  it('parses mm:ss.xx format length metadata', () => {
    const doc: LrcDocument = {
      metadata: { length: '01:15.50' }, // 75,500 ms
      lines: [
        {
          timestamps: [{ timeMs: 70000, location: { line: 1, column: 1 } }],
          text: 'Ending',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };
    const res = normalizeLyrics(doc, {});
    expect(res.normalized.occurrences[0].endMs).toBe(75500);
  });

  it('supports t_time tag (with and without parentheses) as a length fallback', () => {
    const docWithParens: LrcDocument = {
      metadata: { t_time: '(03:45)' }, // 225,000 ms
      lines: [
        {
          timestamps: [{ timeMs: 200000, location: { line: 1, column: 1 } }],
          text: 'Ending with parens',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };
    const res1 = normalizeLyrics(docWithParens, {});
    expect(res1.normalized.occurrences[0].endMs).toBe(225000);

    const docWithoutParens: LrcDocument = {
      metadata: { t_time: '02:30.50' }, // 150,500 ms
      lines: [
        {
          timestamps: [{ timeMs: 140000, location: { line: 1, column: 1 } }],
          text: 'Ending without parens',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };
    const res2 = normalizeLyrics(docWithoutParens, {});
    expect(res2.normalized.occurrences[0].endMs).toBe(150500);

    // length tag takes precedence over t_time
    const docWithBoth: LrcDocument = {
      metadata: { length: '04:00', t_time: '(03:00)' },
      lines: [
        {
          timestamps: [{ timeMs: 100000, location: { line: 1, column: 1 } }],
          text: 'Ending',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };
    const res3 = normalizeLyrics(docWithBoth, {});
    expect(res3.normalized.occurrences[0].endMs).toBe(240000);
  });

  it('rejects out-of-range seconds or minutes in length/t_time metadata and falls through', () => {
    // 03:60 has invalid seconds (> 59); should fall through to t_time or default
    const docInvalidSeconds: LrcDocument = {
      metadata: { length: '03:60', t_time: '02:00' },
      lines: [
        {
          timestamps: [{ timeMs: 50000, location: { line: 1, column: 1 } }],
          text: 'Ending',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };
    const res1 = normalizeLyrics(docInvalidSeconds, {});
    expect(res1.normalized.occurrences[0].endMs).toBe(120000);

    // 1:75:00 has invalid minutes with hours (> 59); should fall through to defaultTrailingDurationMs
    const docInvalidMinutes: LrcDocument = {
      metadata: { length: '1:75:00' },
      lines: [
        {
          timestamps: [{ timeMs: 50000, location: { line: 1, column: 1 } }],
          text: 'Ending',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };
    const res2 = normalizeLyrics(docInvalidMinutes, { defaultTrailingDurationMs: 4000 });
    expect(res2.normalized.occurrences[0].endMs).toBe(54000);

    // Oversized hours overflowing safe integer should fall through to defaultTrailingDurationMs
    const docOverflowLength: LrcDocument = {
      metadata: { length: '9999999999999999:00:00' },
      lines: [
        {
          timestamps: [{ timeMs: 50000, location: { line: 1, column: 1 } }],
          text: 'Ending',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };
    const res3 = normalizeLyrics(docOverflowLength, { defaultTrailingDurationMs: 4000 });
    expect(res3.normalized.occurrences[0].endMs).toBe(54000);
  });

  it('ignores untimed lines without emitting occurrences or errors', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [],
          text: 'Untimed line',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 1000, location: { line: 2, column: 1 } }],
          text: 'Timed line',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { defaultTrailingDurationMs: 2000 });
    expect(result.normalized.occurrences).toHaveLength(1);
    expect(result.normalized.occurrences[0].text).toBe('Timed line');
  });

  it('handles negative effective time in tolerant mode (clamps to 0 and emits warning)', () => {
    const document: LrcDocument = {
      metadata: { offset: '-2000' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Too early',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 4000, location: { line: 2, column: 1 } }],
          text: 'Normal',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { mode: 'tolerant', defaultTrailingDurationMs: 2000 });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].severity).toBe('warning');
    expect(result.diagnostics[0].code).toBe('LRC_NEGATIVE_TIME');
    expect(result.normalized.occurrences[0].startMs).toBe(0);
    expect(result.normalized.occurrences[0].endMs).toBe(2000);
  });

  it('handles negative effective time in strict mode (emits error diagnostic)', () => {
    const document: LrcDocument = {
      metadata: { offset: '-2000' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Too early',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { mode: 'strict' });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].code).toBe('LRC_NEGATIVE_TIME');
  });

  it('does not falsely report increasing negative timestamps as non-monotonic', () => {
    // Effective starts: line 1 = -1000ms, line 2 = -500ms (increasing, not decreasing)
    const document: LrcDocument = {
      metadata: { offset: '-2000' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Negative 1',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 1500, location: { line: 2, column: 1 } }],
          text: 'Negative 2',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { mode: 'tolerant', defaultTrailingDurationMs: 2000 });
    // Should have 2 LRC_NEGATIVE_TIME warnings, and 0 LRC_NON_MONOTONIC_TIMESTAMP warnings
    expect(result.diagnostics.every((d) => d.code === 'LRC_NEGATIVE_TIME')).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'LRC_NON_MONOTONIC_TIMESTAMP')).toBe(false);
  });

  it('handles overlap policy: truncate and preserve', () => {
    const document: LrcDocument = {
      metadata: { length: '00:10' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Line 1',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 3000, location: { line: 2, column: 1 } }],
          text: 'Line 2',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const resTruncate = normalizeLyrics(document, { overlapPolicy: 'truncate' });
    expect(resTruncate.normalized.occurrences[0].startMs).toBe(1000);
    expect(resTruncate.normalized.occurrences[0].endMs).toBe(3000);
  });

  it('handles simultaneous start times (duets) without squashing under truncate or flagging under error', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Singer 1: Harmony part A',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 1000, location: { line: 2, column: 1 } }],
          text: 'Singer 2: Harmony part B',
          location: { line: 2, column: 1 },
        },
        {
          timestamps: [{ timeMs: 5000, location: { line: 3, column: 1 } }],
          text: 'Both: Next line',
          location: { line: 3, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    // Under truncate: simultaneous lines at 1000ms should both end at 5000ms (not truncated against each other to 1000ms)
    const resTruncate = normalizeLyrics(document, {
      overlapPolicy: 'truncate',
      defaultTrailingDurationMs: 2000,
    });
    expect(resTruncate.normalized.occurrences[0].startMs).toBe(1000);
    expect(resTruncate.normalized.occurrences[0].endMs).toBe(5000);
    expect(resTruncate.normalized.occurrences[1].startMs).toBe(1000);
    expect(resTruncate.normalized.occurrences[1].endMs).toBe(5000);

    // Under error & strict mode: simultaneous starts are valid multi-voice lines and should not trigger LRC_OVERLAPPING_OCCURRENCE
    const resError = normalizeLyrics(document, {
      overlapPolicy: 'error',
      mode: 'strict',
      defaultTrailingDurationMs: 2000,
    });
    expect(resError.diagnostics).toEqual([]);
    expect(resError.normalized.occurrences).toHaveLength(3);
  });

  it('ensures occurrence endMs accommodates all enhanced segment timestamps under preserve', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Singer 1 singing a very long held note',
          enhancedSegments: [
            { text: 'Singer 1 ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'singing ', timeMs: 1000, location: { line: 1, column: 10 } },
            { text: 'held note', timeMs: 4500, location: { line: 1, column: 20 } },
          ],
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 3000, location: { line: 2, column: 1 } }],
          text: 'Singer 2 entering while Singer 1 is holding note',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    // Under preserve: Singer 1's last word starts at 1000 + 4500 = 5500ms.
    // Inferred end applies trailing duration fallback after the last segment: 5500 + 2000 = 7500ms.
    const resPreserve = normalizeLyrics(document, {
      overlapPolicy: 'preserve',
      defaultTrailingDurationMs: 2000,
    });
    expect(resPreserve.normalized.occurrences[0].startMs).toBe(1000);
    expect(resPreserve.normalized.occurrences[0].endMs).toBe(7500);

    // Under truncate: if explicitly requested to truncate to next line start
    const resTruncate = normalizeLyrics(document, {
      overlapPolicy: 'truncate',
      defaultTrailingDurationMs: 2000,
    });
    expect(resTruncate.normalized.occurrences[0].startMs).toBe(1000);
    expect(resTruncate.normalized.occurrences[0].endMs).toBe(3000);

    // Under error policy in tolerant mode: emits warning diagnostic for overlap but returns occurrences
    const resErrorTolerant = normalizeLyrics(document, {
      overlapPolicy: 'error',
      mode: 'tolerant',
      defaultTrailingDurationMs: 2000,
    });
    expect(resErrorTolerant.diagnostics).toHaveLength(1);
    expect(resErrorTolerant.diagnostics[0].code).toBe('LRC_OVERLAPPING_OCCURRENCE');
    expect(resErrorTolerant.diagnostics[0].severity).toBe('warning');
    expect(resErrorTolerant.normalized.occurrences).toHaveLength(2);

    // Under error policy in strict mode: emits error diagnostic and returns empty occurrences
    const resErrorStrict = normalizeLyrics(document, {
      overlapPolicy: 'error',
      mode: 'strict',
      defaultTrailingDurationMs: 2000,
    });
    expect(resErrorStrict.diagnostics).toHaveLength(1);
    expect(resErrorStrict.diagnostics[0].code).toBe('LRC_OVERLAPPING_OCCURRENCE');
    expect(resErrorStrict.diagnostics[0].severity).toBe('error');
    expect(resErrorStrict.normalized.occurrences).toEqual([]);
  });

  it('caps a preserved enhanced overlap at the t_time duration bound', () => {
    const document: LrcDocument = {
      metadata: { t_time: '00:06' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Held note',
          enhancedSegments: [
            { text: 'Held ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'note', timeMs: 4000, location: { line: 1, column: 6 } },
          ],
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 3000, location: { line: 2, column: 1 } }],
          text: 'Next line',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, {
      overlapPolicy: 'preserve',
      defaultTrailingDurationMs: 2000,
    });

    expect(result.normalized.occurrences[0].endMs).toBe(6000);
  });

  it('adjusts enhanced segment relative offsets when line start is clamped in tolerant mode', () => {
    // Line starts at 500ms, offset is -1000ms -> unclamped effective start is -500ms
    // Enhanced segments: word 1 at offset 0 (i.e. -500ms), word 2 at offset 800ms (i.e. +300ms)
    // Clamping start to 0ms shifts the line by +500ms.
    // Word 1 was at -500ms -> clamped to offset 0 (0ms).
    // Word 2 was at +300ms -> relative offset to new start 0ms is 300ms (not 800ms).
    const document: LrcDocument = {
      metadata: { offset: '-1000' },
      lines: [
        {
          timestamps: [{ timeMs: 500, location: { line: 1, column: 1 } }],
          text: 'Hello world',
          enhancedSegments: [
            { text: 'Hello ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'world', timeMs: 800, location: { line: 1, column: 10 } },
          ],
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const res = normalizeLyrics(document, { mode: 'tolerant', defaultTrailingDurationMs: 2000 });
    expect(res.normalized.occurrences[0].startMs).toBe(0);
    expect(res.normalized.occurrences[0].segments).toEqual([
      { text: 'Hello ', timeMs: 0, location: { line: 1, column: 1 } },
      { text: 'world', timeMs: 300, location: { line: 1, column: 10 } },
    ]);
  });

  it('adjusts enhanced segment relative offsets when decreasing line start is clamped in tolerant mode', () => {
    // Line 1 is at 1000ms.
    // Line 2 is at 500ms (decreasing), so in tolerant mode it is clamped to 1000ms (shift of +500ms).
    // Enhanced segments on Line 2: word 1 at 0ms (absolute 500ms), word 2 at 800ms (absolute 1300ms).
    // After clamping Line 2 start to 1000ms:
    // Word 1 relative offset becomes 0ms.
    // Word 2 relative offset becomes 800 - 500 = 300ms (absolute time remains 1000 + 300 = 1300ms).
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'First line',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 500, location: { line: 2, column: 1 } }],
          text: 'Second line with enhanced words',
          enhancedSegments: [
            { text: 'Second ', timeMs: 0, location: { line: 2, column: 1 } },
            { text: 'line', timeMs: 800, location: { line: 2, column: 10 } },
          ],
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const res = normalizeLyrics(document, { mode: 'tolerant', defaultTrailingDurationMs: 2000 });
    expect(res.diagnostics.some((d) => d.code === 'LRC_NON_MONOTONIC_TIMESTAMP')).toBe(true);
    expect(res.normalized.occurrences).toHaveLength(2);
    expect(res.normalized.occurrences[1].startMs).toBe(1000);
    expect(res.normalized.occurrences[1].segments).toEqual([
      { text: 'Second ', timeMs: 0, location: { line: 2, column: 1 } },
      { text: 'line', timeMs: 300, location: { line: 2, column: 10 } },
    ]);
  });

  it('provides trailing duration for final enhanced segment when inferring line end', () => {
    // A single isolated enhanced line with words starting at 0ms and 1500ms.
    // The final word should not have 0ms duration; the occurrence endMs should provide trailing time for the last word.
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Hello world',
          enhancedSegments: [
            { text: 'Hello ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'world', timeMs: 1500, location: { line: 1, column: 10 } },
          ],
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const res = normalizeLyrics(document, { defaultTrailingDurationMs: 2000 });
    // Line starts at 1000, last word starts at 1000 + 1500 = 2500ms.
    // With defaultTrailingDurationMs = 2000, endMs is 1000 + 1500 + 2000 = 4500ms (or 1000 + 2000 if 2000 >= 1500 + min, but specifically > last segment start).
    expect(res.normalized.occurrences[0].startMs).toBe(1000);
    expect(res.normalized.occurrences[0].endMs).toBe(4500);
  });

  it('handles decreasing timestamps: fails in strict mode and warns/clamps in tolerant mode', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: 5000, location: { line: 1, column: 1 } }],
          text: 'Line 1 at 5s',
          location: { line: 1, column: 1 },
        },
        {
          timestamps: [{ timeMs: 3000, location: { line: 2, column: 1 } }],
          text: 'Line 2 at 3s (decreasing)',
          location: { line: 2, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    // Strict mode: error diagnostic and empty occurrences
    const strictRes = normalizeLyrics(document, { mode: 'strict' });
    expect(strictRes.diagnostics).toHaveLength(1);
    expect(strictRes.diagnostics[0].severity).toBe('error');
    expect(strictRes.diagnostics[0].code).toBe('LRC_NON_MONOTONIC_TIMESTAMP');
    expect(strictRes.normalized.occurrences).toEqual([]);

    // Tolerant mode: warning diagnostic and clamped to previous timestamp (5000ms), preserving line order
    const tolerantRes = normalizeLyrics(document, {
      mode: 'tolerant',
      defaultTrailingDurationMs: 2000,
    });
    expect(tolerantRes.diagnostics).toHaveLength(1);
    expect(tolerantRes.diagnostics[0].severity).toBe('warning');
    expect(tolerantRes.diagnostics[0].code).toBe('LRC_NON_MONOTONIC_TIMESTAMP');
    expect(tolerantRes.normalized.occurrences).toHaveLength(2);
    expect(tolerantRes.normalized.occurrences[0].startMs).toBe(5000);
    expect(tolerantRes.normalized.occurrences[0].text).toBe('Line 1 at 5s');
    expect(tolerantRes.normalized.occurrences[1].startMs).toBe(5000);
    expect(tolerantRes.normalized.occurrences[1].text).toBe('Line 2 at 3s (decreasing)');
  });

  it('validates defaultTrailingDurationMs and trackEndMs in strict and tolerant modes', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Hello',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    // Strict mode rejects negative defaultTrailingDurationMs
    const strictRes = normalizeLyrics(document, {
      mode: 'strict',
      defaultTrailingDurationMs: -500,
    });
    expect(strictRes.diagnostics).toHaveLength(1);
    expect(strictRes.diagnostics[0].severity).toBe('error');
    expect(strictRes.diagnostics[0].code).toBe('LRC_INVALID_OPTION');
    expect(strictRes.normalized.occurrences).toEqual([]);

    // Strict mode rejects negative trackEndMs
    const strictTrackRes = normalizeLyrics(document, { mode: 'strict', trackEndMs: -100 });
    expect(strictTrackRes.diagnostics).toHaveLength(1);
    expect(strictTrackRes.diagnostics[0].severity).toBe('error');
    expect(strictTrackRes.diagnostics[0].code).toBe('LRC_INVALID_OPTION');
    expect(strictTrackRes.normalized.occurrences).toEqual([]);

    // Tolerant mode warns and falls back to default 5000ms
    const tolerantRes = normalizeLyrics(document, {
      mode: 'tolerant',
      defaultTrailingDurationMs: -500,
    });
    expect(tolerantRes.diagnostics).toHaveLength(1);
    expect(tolerantRes.diagnostics[0].severity).toBe('warning');
    expect(tolerantRes.diagnostics[0].code).toBe('LRC_INVALID_OPTION');
    expect(tolerantRes.normalized.occurrences[0].startMs).toBe(1000);
    expect(tolerantRes.normalized.occurrences[0].endMs).toBe(6000);

    // Tolerant mode warns and ignores negative trackEndMs, falling back to defaultTrailingDurationMs
    const tolerantTrackRes = normalizeLyrics(document, {
      mode: 'tolerant',
      trackEndMs: -100,
      defaultTrailingDurationMs: 2000,
    });
    expect(tolerantTrackRes.diagnostics).toHaveLength(1);
    expect(tolerantTrackRes.diagnostics[0].severity).toBe('warning');
    expect(tolerantTrackRes.diagnostics[0].code).toBe('LRC_INVALID_OPTION');
    expect(tolerantTrackRes.normalized.occurrences[0].startMs).toBe(1000);
    expect(tolerantTrackRes.normalized.occurrences[0].endMs).toBe(3000);
  });

  it('validates offsetMs in strict and tolerant modes', () => {
    const document: LrcDocument = {
      metadata: { offset: '500' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Hello',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    // Strict mode rejects NaN, fractions, and unsafe integers
    const invalidOffsets = [Number.NaN, 12.34, Number.POSITIVE_INFINITY, 9007199254740992];
    for (const invalidOffset of invalidOffsets) {
      const strictRes = normalizeLyrics(document, { mode: 'strict', offsetMs: invalidOffset });
      expect(strictRes.diagnostics).toHaveLength(1);
      expect(strictRes.diagnostics[0].severity).toBe('error');
      expect(strictRes.diagnostics[0].code).toBe('LRC_INVALID_OPTION');
      expect(strictRes.normalized.occurrences).toEqual([]);
    }

    // Tolerant mode warns and ignores invalid offsetMs, using metadata offset (500ms)
    for (const invalidOffset of invalidOffsets) {
      const tolerantRes = normalizeLyrics(document, {
        mode: 'tolerant',
        offsetMs: invalidOffset,
        defaultTrailingDurationMs: 1000,
      });
      expect(tolerantRes.diagnostics).toHaveLength(1);
      expect(tolerantRes.diagnostics[0].severity).toBe('warning');
      expect(tolerantRes.diagnostics[0].code).toBe('LRC_INVALID_OPTION');
      expect(tolerantRes.normalized.occurrences[0].startMs).toBe(1500); // 1000 + metadata 500
      expect(tolerantRes.normalized.occurrences[0].endMs).toBe(2500);
    }
  });

  it('reports invalid timing metadata and fails in strict mode', () => {
    const document: LrcDocument = {
      metadata: { offset: 'soon', length: 'later', t_time: 'eventually' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Hello',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const tolerant = normalizeLyrics(document, { defaultTrailingDurationMs: 1000 });
    const strict = normalizeLyrics(document, { mode: 'strict' });

    expect(tolerant.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'LRC_INVALID_TIMING_METADATA',
      'LRC_INVALID_TIMING_METADATA',
      'LRC_INVALID_TIMING_METADATA',
    ]);
    expect(tolerant.normalized.occurrences[0].endMs).toBe(2000);
    expect(strict.diagnostics).toHaveLength(3);
    expect(strict.normalized.occurrences).toEqual([]);
  });

  it('reports an impossible final duration bound and uses fallback timing in tolerant mode', () => {
    const document: LrcDocument = {
      metadata: { length: '00:01' },
      lines: [
        {
          timestamps: [{ timeMs: 2000, location: { line: 1, column: 1 } }],
          text: 'Late lyric',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const tolerant = normalizeLyrics(document, { defaultTrailingDurationMs: 1000 });
    const strict = normalizeLyrics(document, { mode: 'strict', defaultTrailingDurationMs: 1000 });

    expect(tolerant.diagnostics[0]).toMatchObject({
      code: 'LRC_FINAL_DURATION_BEFORE_LYRIC',
      severity: 'warning',
    });
    expect(tolerant.normalized.occurrences[0].endMs).toBe(3000);
    expect(strict.diagnostics[0]).toMatchObject({
      code: 'LRC_FINAL_DURATION_BEFORE_LYRIC',
      severity: 'error',
    });
    expect(strict.normalized.occurrences).toEqual([]);
  });

  it('uses the next usable final duration bound in tolerant mode', () => {
    const document: LrcDocument = {
      metadata: { length: '00:01', t_time: '00:04' },
      lines: [
        {
          timestamps: [{ timeMs: 2000, location: { line: 1, column: 1 } }],
          text: 'Late lyric',
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { mode: 'tolerant', defaultTrailingDurationMs: 1000 });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'LRC_FINAL_DURATION_BEFORE_LYRIC', severity: 'warning' }),
    ]);
    expect(result.normalized.occurrences[0].endMs).toBe(4000);
  });

  it('identifies the final enhanced segment as the invalid duration-bound anchor', () => {
    const document: LrcDocument = {
      metadata: { length: '00:04' },
      lines: [
        {
          timestamps: [{ timeMs: 1000, location: { line: 1, column: 1 } }],
          text: 'Held note',
          enhancedSegments: [
            { text: 'Held ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'note', timeMs: 4000, location: { line: 1, column: 6 } },
          ],
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const result = normalizeLyrics(document, { defaultTrailingDurationMs: 1000 });

    expect(result.diagnostics[0].message).toContain('final enhanced segment start');
    expect(result.normalized.occurrences[0].endMs).toBe(6000);
  });

  describe('line-final enhanced boundary', () => {
    const boundaryLine = (
      startMs: number,
      text: string,
      line: number,
    ): LrcDocument['lines'][0] => ({
      timestamps: [{ timeMs: startMs, location: { line, column: 1 } }],
      text,
      enhancedSegments: [
        { text, timeMs: 0, location: { line, column: 1 } },
        { text: '', timeMs: 1000, location: { line, column: 1 + text.length } },
      ],
      location: { line, column: 1 },
    });

    it.each(['strict', 'tolerant'] as const)(
      'accepts a length metadata bound equal to the boundary in %s mode',
      (mode) => {
        const document: LrcDocument = {
          metadata: { length: '00:01.00' },
          lines: [boundaryLine(0, 'Hi', 1)],
          unknownEntries: [],
        };

        const result = normalizeLyrics(document, { mode });

        expect(result.diagnostics).toEqual([]);
        expect(result.normalized.occurrences[0].endMs).toBe(1000);
      },
    );

    it.each(['strict', 'tolerant'] as const)(
      'accepts a trackEndMs bound equal to the boundary in %s mode',
      (mode) => {
        const document: LrcDocument = {
          metadata: {},
          lines: [boundaryLine(0, 'Hi', 1)],
          unknownEntries: [],
        };

        const result = normalizeLyrics(document, { mode, trackEndMs: 1000 });

        expect(result.diagnostics).toEqual([]);
        expect(result.normalized.occurrences[0].endMs).toBe(1000);
      },
    );

    it('still rejects a bound earlier than the boundary', () => {
      const document: LrcDocument = {
        metadata: { length: '00:00.50' },
        lines: [boundaryLine(0, 'Hi', 1)],
        unknownEntries: [],
      };

      const tolerant = normalizeLyrics(document, { defaultTrailingDurationMs: 1000 });
      const strict = normalizeLyrics(document, { mode: 'strict' });

      expect(tolerant.diagnostics[0]).toMatchObject({
        code: 'LRC_FINAL_DURATION_BEFORE_LYRIC',
        severity: 'warning',
      });
      expect(tolerant.diagnostics[0].message).toContain('line-final enhanced timestamp');
      expect(tolerant.normalized.occurrences[0].endMs).toBe(2000);
      expect(strict.normalized.occurrences).toEqual([]);
    });

    it('does not extend a boundary past the next line with the trailing duration', () => {
      const document: LrcDocument = {
        metadata: {},
        lines: [
          { ...boundaryLine(0, 'Hi', 1) },
          {
            timestamps: [{ timeMs: 500, location: { line: 2, column: 1 } }],
            text: 'Next',
            location: { line: 2, column: 1 },
          },
        ],
        unknownEntries: [],
      };

      const result = normalizeLyrics(document, {
        overlapPolicy: 'preserve',
        defaultTrailingDurationMs: 5000,
      });

      expect(result.normalized.occurrences[0].endMs).toBe(1000);
    });
  });

  it('handles enhanced trailing-duration overflow without storing an unsafe boundary', () => {
    const document: LrcDocument = {
      metadata: {},
      lines: [
        {
          timestamps: [{ timeMs: Number.MAX_SAFE_INTEGER - 10, location: { line: 1, column: 1 } }],
          text: 'Final note',
          enhancedSegments: [
            { text: 'Final ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'note', timeMs: 5, location: { line: 1, column: 7 } },
          ],
          location: { line: 1, column: 1 },
        },
      ],
      unknownEntries: [],
    };

    const tolerant = normalizeLyrics(document, { defaultTrailingDurationMs: 10 });
    const strict = normalizeLyrics(document, { mode: 'strict', defaultTrailingDurationMs: 10 });

    expect(tolerant.diagnostics).toEqual([
      expect.objectContaining({ code: 'LRC_TIME_OUT_OF_RANGE', severity: 'warning' }),
    ]);
    expect(tolerant.normalized.occurrences[0].endMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(strict.diagnostics).toEqual([
      expect.objectContaining({ code: 'LRC_TIME_OUT_OF_RANGE', severity: 'error' }),
    ]);
    expect(strict.normalized.occurrences).toEqual([]);
  });
});
