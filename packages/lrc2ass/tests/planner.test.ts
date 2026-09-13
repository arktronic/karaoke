import { describe, expect, it } from 'vitest';
import { planEvents } from '../src/index.js';
import type { NormalizedLyrics, PlanOptions } from '../src/index.js';

const options: PlanOptions = {
  karaokeEffect: 'none',
  mainLinePreRollMs: 1000,
  previewLeadMs: 4000,
  fadeInMs: 0,
  fadeOutMs: 0,
  maxPreviewLines: 1,
  lingerMaxMs: 0,
  layout: {
    resolutionX: 384,
    resolutionY: 288,
    alignment: 2,
    marginLeft: 10,
    marginRight: 10,
    marginVertical: 10,
    rowHeightPx: 30,
  },
};

describe('planEvents', () => {
  it('creates a styled, escaped dialogue event from a plain lyric', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [{ startMs: 15, endMs: 1_044, text: 'a{b}\\c\nd\re\r\nf' }],
    };

    const document = planEvents(normalized, options);

    expect(document.scriptInfo).toEqual({ playResX: 384, playResY: 288 });
    expect(document.styles.map((style) => style.name)).toEqual(['Lyrics', 'Preview', 'Interlude']);
    expect(document.events).toEqual([
      {
        layer: 0,
        startMs: 20,
        endMs: 1_040,
        style: 'Lyrics',
        text: '{\\q2}a\\{b\\}\\\\c\\Nd\\Ne\\Nf',
      },
    ]);
  });

  it('preserves base values when overrides are undefined and applies defined layout overrides', () => {
    const document = planEvents({ occurrences: [] }, options, {
      karaokeEffect: undefined,
      layout: { alignment: 8, marginLeft: undefined },
    });

    expect(document.styles[0]).toMatchObject({ alignment: 8, marginLeft: 10, marginRight: 10 });
  });

  it('merges defined interlude overrides with inherited settings', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 5_000, text: 'First' },
        { startMs: 10_000, endMs: 12_000, text: 'Second' },
      ],
    };

    const document = planEvents(
      normalized,
      {
        ...options,
        interlude: {
          minGapMs: 1_000,
          strategy: 'text',
          marginMs: 500,
          style: 'Inherited',
          trailingLyricDurationMs: 5_000,
        },
      },
      { interlude: { minGapMs: 2_000, strategy: 'countdown' } },
    );

    expect(document.styles.map((style) => style.name)).toContain('Inherited');
    expect(document.events.filter((event) => event.style === 'Inherited')).toEqual([
      { layer: 0, startMs: 5_500, endMs: 6_500, style: 'Inherited', text: '4' },
      { layer: 0, startMs: 6_500, endMs: 7_500, style: 'Inherited', text: '3' },
      { layer: 0, startMs: 7_500, endMs: 8_500, style: 'Inherited', text: '2' },
      { layer: 0, startMs: 8_500, endMs: 9_500, style: 'Inherited', text: '1' },
    ]);
  });

  it('resolves preset defaults before base and caller style overrides', () => {
    const document = planEvents(
      { occurrences: [] },
      {
        ...options,
        preset: 'multi-line',
        styles: { preview: { fontName: 'Base Font', primaryColor: '#112233' } },
      },
      { styles: { preview: { fontSize: 18, primaryColor: '#445566' } } },
    );

    expect(document.styles.find((style) => style.name === 'Preview')).toMatchObject({
      fontName: 'Base Font',
      fontSize: 18,
      primaryColor: '&H00665544&',
      alignment: 8,
    });
  });

  it.each([
    ['instant', 'k'],
    ['sweep', 'kf'],
    ['sweep-outline', 'ko'],
  ] as const)(
    'uses %s karaoke tags with durations from quantized boundaries',
    (karaokeEffect, tag) => {
      const normalized: NormalizedLyrics = {
        occurrences: [
          {
            startMs: 15,
            endMs: 74,
            text: 'onetwo',
            segments: [
              { text: 'one', timeMs: 0, location: { line: 1, column: 1 } },
              { text: 'two', timeMs: 26, location: { line: 1, column: 4 } },
            ],
          },
        ],
      };

      const [event] = planEvents(normalized, { ...options, karaokeEffect }).events;

      expect(event).toMatchObject({
        startMs: 20,
        endMs: 70,
        text: `{\\q2}{\\${tag}2}one{\\${tag}3}two`,
      });
    },
  );

  it('trims outer-edge whitespace from karaoke segments and collapses any resulting double-space at word boundaries', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        {
          startMs: 0,
          endMs: 100,
          text: ' Foo  bar ',
          segments: [
            { text: ' Foo ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: ' bar ', timeMs: 50, location: { line: 1, column: 7 } },
          ],
        },
      ],
    };

    const [event] = planEvents(normalized, { ...options, karaokeEffect: 'sweep' }).events;

    expect(event.text).toBe('{\\q2}{\\kf5}Foo{\\kf5} bar');
  });

  it("keeps a segment's own trailing space as the word separator when the next segment has no leading space", () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        {
          startMs: 0,
          endMs: 100,
          text: 'Hello world',
          segments: [
            { text: 'Hello ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'world', timeMs: 50, location: { line: 1, column: 7 } },
          ],
        },
      ],
    };

    const [event] = planEvents(normalized, { ...options, karaokeEffect: 'sweep' }).events;

    // A segment's own trailing space is kept as the word separator when the next segment has no
    // leading space of its own, so adjacent segments don't fuse into one word.
    expect(event.text).toBe('{\\q2}{\\kf5}Hello {\\kf5}world');
  });

  it('encodes a leading enhanced-timestamp delay as an empty karaoke syllable', () => {
    const [event] = planEvents(
      {
        occurrences: [
          {
            startMs: 10_000,
            endMs: 12_000,
            text: 'Hello',
            segments: [{ text: 'Hello', timeMs: 500, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    // First line, so its leading gap is always pre-sweep-eligible (no predecessor to compare against).
    expect(event.text).toBe(
      '{\\q2}{\\kf13}\u00B7{\\kf12}\u00B7{\\kf13}\u00B7{\\kf12}\u00B7 {\\kf150}Hello',
    );
  });

  it('treats a leading whitespace-only segment as padding, not the first sung word', () => {
    const [event] = planEvents(
      {
        occurrences: [
          {
            startMs: 10_000,
            endMs: 12_000,
            text: ' Hello',
            segments: [
              { text: ' ', timeMs: 0, location: { line: 1, column: 1 } },
              { text: 'Hello', timeMs: 500, location: { line: 1, column: 2 } },
            ],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    // A whitespace-only leading segment is padding, not the first sung word, so its own timeMs (0)
    // is not used as the sung-start reference for pre-sweep gating.
    expect(event.text).toBe(
      '{\\q2}{\\kf13}\u00B7{\\kf12}\u00B7{\\kf13}\u00B7{\\kf12}\u00B7 {\\kf150}Hello',
    );
  });

  it('defers a lyric event start past a leading whitespace-only segment to the first real sung word', () => {
    const [event] = planEvents(
      {
        occurrences: [
          {
            startMs: 0,
            endMs: 20_000,
            text: ' La la la',
            segments: [
              { text: ' ', timeMs: 0, location: { line: 1, column: 1 } },
              { text: 'La la la', timeMs: 15_000, location: { line: 1, column: 2 } },
            ],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    // effectiveSungStartMs skips a whitespace-only leading segment, so the 15_000ms delay to the
    // first real word still triggers deferral.
    expect(event.startMs).toBe(14_000);
    expect(event.text).toBe(
      '{\\q2}{\\kf25}\u00B7{\\kf25}\u00B7{\\kf25}\u00B7{\\kf25}\u00B7 {\\kf500}La la la',
    );
  });

  it('defers a lyric event start when its leading enhanced-segment delay exceeds mainLinePreRollMs', () => {
    const [event] = planEvents(
      {
        occurrences: [
          {
            startMs: 0,
            endMs: 20_000,
            text: 'La la la',
            segments: [{ text: 'La la la', timeMs: 15_000, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    // 15_000ms delay minus the 1_000ms default pre-roll = starts at 14_000ms instead of 0.
    expect(event.startMs).toBe(14_000);
    // First line, so its leading gap is always pre-sweep-eligible (no predecessor to compare against).
    expect(event.text).toBe(
      '{\\q2}{\\kf25}\u00B7{\\kf25}\u00B7{\\kf25}\u00B7{\\kf25}\u00B7 {\\kf500}La la la',
    );
  });

  it('reorders lyrics chronologically by their deferred start so an interlude cannot overlap a later line', () => {
    // "First" has a bracket time of 0 but a 10_000ms leading segment delay, deferring its display
    // start to 9_000ms (10_000 - the 1_000ms default mainLinePreRollMs). "Second" is plain, at its
    // own bracket time of 5_000ms - chronologically earlier than "First"'s deferred start, even
    // though "First" comes first in source order.
    const normalized: NormalizedLyrics = {
      occurrences: [
        {
          startMs: 0,
          endMs: 20_000,
          text: 'First',
          segments: [{ text: 'First', timeMs: 10_000, location: { line: 1, column: 1 } }],
        },
        { startMs: 5_000, endMs: 8_000, text: 'Second' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 3_000, strategy: 'text' },
    });

    const first = document.events.find((event) => event.text.endsWith('First'));
    const second = document.events.find((event) => event.text.endsWith('Second'));
    const interlude = document.events.filter((event) => event.style === 'Interlude');

    expect(second?.startMs).toBe(5_000);
    expect(first?.startMs).toBe(9_000);
    // addInterludeEvents scans lyrics in chronological (deferred-start) order, so it only fills the
    // gap before "Second" and never overlaps "Second"'s own [5_000, 8_000] span.
    expect(interlude).toEqual([
      {
        layer: 0,
        startMs: 0,
        endMs: 5_000,
        style: 'Interlude',
        text: '\u266A Instrumental \u266A',
      },
    ]);
  });

  it('shows a pre-sweep dot count-in when the gap since the previous line is at least mainLinePreRollMs', () => {
    const [, second] = planEvents(
      {
        occurrences: [
          { startMs: 0, endMs: 1_000, text: 'First' },
          {
            startMs: 1_000,
            endMs: 3_000,
            text: 'Second',
            segments: [{ text: 'Second', timeMs: 1_000, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    // Gap from First's endMs (1_000) to Second's sung start (2_000) is 1_000ms, meeting mainLinePreRollMs.
    expect(second.text).toBe(
      '{\\q2}{\\kf25}\u00B7{\\kf25}\u00B7{\\kf25}\u00B7{\\kf25}\u00B7 {\\kf100}Second',
    );
  });

  it('does not show a pre-sweep dot count-in when the gap since the previous line is too short', () => {
    const [, second] = planEvents(
      {
        occurrences: [
          { startMs: 0, endMs: 1_000, text: 'First' },
          {
            startMs: 1_000,
            endMs: 2_500,
            text: 'Second',
            segments: [{ text: 'Second', timeMs: 500, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    // Gap from First's endMs (1_000) to Second's sung start (1_500) is only 500ms, under mainLinePreRollMs.
    expect(second.text).toBe('{\\q2}{\\kf50}{\\kf100}Second');
  });

  it('does not show a pre-sweep dot count-in when an earlier, longer-overlapping line is still active', () => {
    const [, , third] = planEvents(
      {
        occurrences: [
          { startMs: 0, endMs: 10_000, text: 'First' },
          {
            startMs: 1_000,
            endMs: 2_000,
            text: 'Second',
            segments: [{ text: 'Second', timeMs: 0, location: { line: 1, column: 1 } }],
          },
          {
            startMs: 8_000,
            endMs: 9_000,
            text: 'Third',
            segments: [{ text: 'Third', timeMs: 500, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    // Gap from Second's endMs (2_000) to Third's sung start (8_500) is 6_500ms, meeting
    // mainLinePreRollMs, but First (ending at 10_000) is still active at 8_500, so there's no real gap.
    expect(third.text).toBe('{\\q2}{\\kf50}{\\kf50}Third');
  });

  it("does not let an occurrence that never becomes visible suppress the next line's pre-sweep", () => {
    const events = planEvents(
      {
        occurrences: [
          { startMs: 0, endMs: 1_000, text: 'First' },
          {
            // Deferred to startMs 3_000 (2_000 sung-start delay - 1_000 mainLinePreRollMs) by its own
            // segment timing, past its own endMs (1_400) — this occurrence is skipped and never shown.
            startMs: 1_000,
            endMs: 1_400,
            text: 'Collapsed',
            segments: [{ text: 'Collapsed', timeMs: 3_000, location: { line: 1, column: 1 } }],
          },
          {
            startMs: 1_500,
            endMs: 3_000,
            text: 'Third',
            segments: [{ text: 'Third', timeMs: 500, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    // Gap from First's endMs (1_000, the last actually-shown line) to Third's sung start (2_000) is
    // exactly mainLinePreRollMs (1_000), so Third should get a pre-sweep dot count-in. Using the
    // never-shown "Collapsed" occurrence's own endMs (1_400) instead would shrink the gap to 600ms
    // and wrongly suppress it.
    const third = events.find((event) => event.style === 'Lyrics' && event.text.endsWith('Third'));
    expect(third?.text).toContain('\u00B7');
  });

  it('gates pre-sweep by chronological (deferred-start) order, not source order, when they invert', () => {
    // Source order is [X, Y], but X's own embedded delay defers its display (2_000) to chronologically
    // *after* Y's (500) - the true order is Y, then X. Y is genuinely first (no real predecessor), so
    // it should get its own pre-sweep count-in; X's real predecessor is Y, and X's sung start (3_000)
    // lands exactly on Y's endMs (3_000) - zero real gap - so X must not get one. Gating in source
    // order would process X first with no predecessor at all (wrongly granting it one) and would then
    // measure Y's gap against X's endMs instead (wrongly denying Y, the true first line, its own).
    const events = planEvents(
      {
        occurrences: [
          {
            startMs: 500,
            endMs: 4_000,
            text: 'X',
            segments: [{ text: 'X', timeMs: 2_500, location: { line: 1, column: 1 } }],
          },
          {
            startMs: 0,
            endMs: 3_000,
            text: 'Y',
            segments: [{ text: 'Y', timeMs: 1_500, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    const x = events.find((event) => event.style === 'Lyrics' && event.text.endsWith('X'));
    const y = events.find((event) => event.style === 'Lyrics' && event.text.endsWith('Y'));
    expect(x?.text).not.toContain('\u00B7');
    expect(y?.text).toContain('\u00B7');
  });

  it('grants a tied deferred-start pair the same pre-sweep verdict, regardless of which is emitted first', () => {
    // A and B share a deferredStart of 1_500 and the same real predecessor gap (from Z's endMs of
    // 1_000), but A's own endMs (5_000) is far later than B's (1_600). If A's endMs were used as the
    // baseline for B's pre-sweep check (source order processes A first), B would wrongly be denied.
    const events = planEvents(
      {
        occurrences: [
          { startMs: 0, endMs: 1_000, text: 'Z' },
          {
            startMs: 1_500,
            endMs: 5_000,
            text: 'A',
            segments: [{ text: 'A', timeMs: 500, location: { line: 1, column: 1 } }],
          },
          {
            startMs: 1_500,
            endMs: 1_600,
            text: 'B',
            segments: [{ text: 'B', timeMs: 500, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    const a = events.find((event) => event.style === 'Lyrics' && event.text.endsWith('A'));
    const b = events.find((event) => event.style === 'Lyrics' && event.text.endsWith('B'));
    expect(a?.text).toContain('\u00B7');
    expect(b?.text).toContain('\u00B7');
  });

  it("falls back to the plain leading tag when the gap since the previous line qualifies but the line's own leading duration is too short for 4 dots", () => {
    const [, second] = planEvents(
      {
        occurrences: [
          { startMs: 0, endMs: 1_000, text: 'First' },
          {
            startMs: 5_000,
            endMs: 6_000,
            text: 'Second',
            segments: [{ text: 'Second', timeMs: 10, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    // Gap from First's endMs (1_000) to Second's sung start (5_010) is 4_010ms, meeting mainLinePreRollMs,
    // but Second's own leading duration (10ms) is below the 40ms needed for 4 non-zero-duration dots.
    expect(second.text).toBe('{\\q2}{\\kf1}{\\kf99}Second');
  });

  it("mirrors a line's pre-sweep dot prefix in its own Preview event so text doesn't shift at handoff", () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        {
          startMs: 1_000,
          endMs: 3_000,
          text: 'Second',
          segments: [{ text: 'Second', timeMs: 1_000, location: { line: 1, column: 1 } }],
        },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      karaokeEffect: 'sweep',
    });

    const preview = document.events.find((event) => event.style === 'Preview');
    expect(preview?.text).toBe('{\\an8}{\\q2}\u00B7\u00B7\u00B7\u00B7 Second');
  });

  it('does not add a dot prefix to a Preview event when its line has no pre-sweep', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        {
          startMs: 1_000,
          endMs: 2_500,
          text: 'Second',
          segments: [{ text: 'Second', timeMs: 500, location: { line: 1, column: 1 } }],
        },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      karaokeEffect: 'sweep',
    });

    const preview = document.events.find((event) => event.style === 'Preview');
    expect(preview?.text).toBe('{\\an8}{\\q2}Second');
  });

  it('does not defer a lyric event start when there is no leading delay', () => {
    const [event] = planEvents(
      {
        occurrences: [
          {
            startMs: 5_000,
            endMs: 8_000,
            text: 'Hello',
            segments: [{ text: 'Hello', timeMs: 0, location: { line: 1, column: 1 } }],
          },
        ],
      },
      { ...options, karaokeEffect: 'sweep' },
    ).events;

    expect(event.startMs).toBe(5_000);
  });

  it('adds a next-line preview for the multi-line preset', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'Current' },
        { startMs: 2_000, endMs: 3_000, text: 'Next' },
      ],
    };

    const document = planEvents(normalized, { ...options, preset: 'multi-line' });

    expect(document.events).toContainEqual({
      layer: -1,
      startMs: 0,
      endMs: 2_000,
      style: 'Preview',
      marginVertical: 144,
      text: '{\\an8}{\\q2}Next',
    });
  });

  it('bounds a next-line preview to previewLeadMs before a delayed next lyric, instead of spanning the whole prior gap', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'Current' },
        {
          startMs: 20_000,
          endMs: 40_000,
          text: 'La la la',
          segments: [{ text: 'La la la', timeMs: 15_000, location: { line: 1, column: 1 } }],
        },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      karaokeEffect: 'sweep',
    });

    // Next lyric's effective sung-start is 35_000ms (20_000 + 15_000); preview shows for the
    // 4_000ms previewLeadMs before that, ending when the (pre-rolled) next lyric box begins. The
    // ~30s gap before that is a genuine full blank, so "La la la" resets to the top row (row 0)
    // instead of continuing the raw rotation to row 1.
    expect(document.events).toContainEqual({
      layer: -1,
      startMs: 31_000,
      endMs: 34_000,
      style: 'Preview',
      marginVertical: 114,
      text: '{\\an8}{\\q2}\u00B7\u00B7\u00B7\u00B7 La la la',
    });
  });

  it('emits one future preview for a simultaneous active lyric group', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'Singer one' },
        { startMs: 0, endMs: 1_000, text: 'Singer two' },
        { startMs: 2_000, endMs: 3_000, text: 'Next line' },
      ],
    };

    const document = planEvents(normalized, { ...options, preset: 'multi-line' });

    // "Next line" reuses "Singer one"'s row (occurrence index 2 mod rowCount 2 = 0), so its preview
    // can't start until that row frees up at 1_000, even though "Singer two" started earlier at 0.
    expect(document.events.filter((event) => event.style === 'Preview')).toEqual([
      {
        layer: -1,
        startMs: 1_000,
        endMs: 2_000,
        style: 'Preview',
        marginVertical: 114,
        text: '{\\an8}{\\q2}Next line',
      },
    ]);
    expect(document.events.slice(0, 3).map((event) => event.style)).toEqual([
      'Lyrics',
      'Lyrics',
      'Preview',
    ]);
    // Simultaneous occurrences alternate rows via marginVertical; alignment tag stays the same.
    const [singerOne, singerTwo] = document.events.filter((event) => event.style === 'Lyrics');
    expect(singerOne.text).toBe('{\\an8}{\\q2}Singer one');
    expect(singerTwo.text).toBe('{\\an8}{\\q2}Singer two');
    expect(singerOne.marginVertical).not.toBe(singerTwo.marginVertical);
  });

  it('alternates row marginVertical across consecutive lyric lines for the multi-line preset', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 2_000, endMs: 3_000, text: 'Second' },
        { startMs: 4_000, endMs: 5_000, text: 'Third' },
      ],
    };

    const document = planEvents(normalized, { ...options, preset: 'multi-line' });

    const lyricEvents = document.events.filter((event) => event.style === 'Lyrics');
    // Every row shares the same alignment tag; only the per-event MarginV distinguishes rows.
    expect(lyricEvents.map((event) => event.text)).toEqual([
      '{\\an8}{\\q2}First',
      '{\\an8}{\\q2}Second',
      '{\\an8}{\\q2}Third',
    ]);
    expect(lyricEvents.map((event) => event.marginVertical)).toEqual([114, 144, 114]);
  });

  it('starts the first lyric on the top row even after a leading interlude gap', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 20_000, endMs: 21_000, text: 'First' },
        { startMs: 22_000, endMs: 23_000, text: 'Second' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      interlude: { minGapMs: 1_000, strategy: 'text' },
    });

    expect(document.events.some((event) => event.style === 'Interlude')).toBe(true);
    const [firstLyric] = document.events.filter((event) => event.style === 'Lyrics');
    expect(firstLyric.text.startsWith('{\\an8}')).toBe(true);
  });

  it('does not preview a line before the first lyric of the song has actually started', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 20_000, endMs: 21_000, text: 'First' },
        { startMs: 22_000, endMs: 23_000, text: 'Second' },
      ],
    };

    // previewLeadMs (4_000) before "Second"'s sung-start (22_000) is 18_000, which is before
    // "First" even starts (20_000) — nothing should be on screen before that.
    const document = planEvents(normalized, { ...options, preset: 'multi-line' });

    const preview = document.events.find((event) => event.style === 'Preview');
    expect(preview?.startMs).toBe(20_000);
  });

  it('shows a preview already in the row the line keeps once promoted to current', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 2_000, endMs: 3_000, text: 'Second' },
      ],
    };

    const document = planEvents(normalized, { ...options, preset: 'multi-line' });

    const preview = document.events.find((event) => event.style === 'Preview');
    const secondLyric = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('Second'),
    );
    expect(preview?.text.slice(0, preview.text.indexOf('}') + 1)).toBe(
      secondLyric?.text.slice(0, secondLyric.text.indexOf('}') + 1),
    );
  });

  it('emits no row alignment tag for the single-line preset', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [{ startMs: 0, endMs: 1_000, text: 'Solo' }],
    };

    const document = planEvents(normalized, { ...options, preset: 'single-line' });

    expect(document.events).toEqual([
      { layer: 0, startMs: 0, endMs: 1_000, style: 'Lyrics', text: '{\\q2}Solo' },
    ]);
  });

  it('does not let styles.lyrics.alignment override the multi-line row alignment', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [{ startMs: 0, endMs: 1_000, text: 'First' }],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      styles: { lyrics: { alignment: 2 } },
    });

    const lyricEvent = document.events.find((event) => event.style === 'Lyrics');
    expect(lyricEvent?.text.startsWith('{\\an8}')).toBe(true);
  });

  it('uses layout.rowAlignment for multi-line rows when set, overriding the preview style default', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [{ startMs: 0, endMs: 1_000, text: 'First' }],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      layout: { ...options.layout, rowAlignment: 1 },
    });

    const lyricEvent = document.events.find((event) => event.style === 'Lyrics');
    expect(lyricEvent?.text.startsWith('{\\an1}')).toBe(true);
  });

  it('rejects a middle layout.rowAlignment (4-6) for the multi-line preset since MarginV would have no effect', () => {
    expect(() =>
      planEvents(
        { occurrences: [] },
        { ...options, preset: 'multi-line', layout: { ...options.layout, rowAlignment: 5 } },
      ),
    ).toThrow(RangeError);
  });

  it("derives the multi-line rows' per-event marginVertical from layout.resolutionY and layout.rowHeightPx", () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      layout: { ...options.layout, resolutionY: 288 },
    });

    // topMargin = (288 - 2*30)/2 = 114; rows alternate 114/144.
    const lyricEvents = document.events.filter((event) => event.style === 'Lyrics');
    expect(lyricEvents.map((event) => event.marginVertical)).toEqual([114, 144]);
  });

  it('computes per-row event margins regardless of an explicit style-level marginVertical override', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      styles: { lyrics: { marginVertical: 42 } },
    });

    // The style's own MarginV reflects the override (relevant for the single-line preset), but each
    // multi-line row still gets its own computed per-event MarginV, which always takes precedence.
    const lyrics = document.styles.find((style) => style.name === 'Lyrics');
    expect(lyrics?.marginVertical).toBe(42);
    const lyricEvents = document.events.filter((event) => event.style === 'Lyrics');
    expect(lyricEvents.map((event) => event.marginVertical)).toEqual([114, 144]);
  });

  it('gives every occurrence its own permanent row and per-event MarginV when maxPreviewLines > 1', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
        { startMs: 2_000, endMs: 3_000, text: 'Third' },
        { startMs: 3_000, endMs: 4_000, text: 'Fourth' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 3,
    });

    // 4 rows share resolutionY 288 at rowHeightPx 30: topMargin = (288 - 4*30)/2 = 84.
    const lyricEvents = document.events.filter((event) => event.style === 'Lyrics');
    expect(
      lyricEvents.map((event) => ({ text: event.text, marginVertical: event.marginVertical })),
    ).toEqual([
      { text: '{\\an8}{\\q2}First', marginVertical: 84 },
      { text: '{\\an8}{\\q2}Second', marginVertical: 114 },
      { text: '{\\an8}{\\q2}Third', marginVertical: 144 },
      { text: '{\\an8}{\\q2}Fourth', marginVertical: 174 },
    ]);
  });

  it('shows more than one simultaneous preview line when maxPreviewLines > 1 and lines arrive close together', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
        { startMs: 2_000, endMs: 3_000, text: 'Third' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 2,
    });

    // Both "Second" and "Third" fall within previewLeadMs (4000ms) of the song's start, and neither
    // needs to wait for a same-row predecessor (rowCount 3 > either occurrence's own index), so both
    // preview from t=0, genuinely overlapping in time on their own permanently-assigned rows.
    const previewEvents = document.events.filter((event) => event.style === 'Preview');
    expect(previewEvents).toEqual([
      {
        layer: -1,
        startMs: 0,
        endMs: 1_000,
        style: 'Preview',
        marginVertical: 129,
        text: '{\\an8}{\\q2}Second',
      },
      {
        layer: -1,
        startMs: 0,
        endMs: 2_000,
        style: 'Preview',
        marginVertical: 159,
        text: '{\\an8}{\\q2}Third',
      },
    ]);
  });

  it('previews more than one line ahead, not just the immediately next line, when they all fall within previewLeadMs', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
        { startMs: 2_000, endMs: 3_000, text: 'Third' },
        { startMs: 3_000, endMs: 4_000, text: 'Fourth' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 3,
    });

    // With 4 permanently-assigned rows and no same-row predecessor yet, Second/Third/Fourth all
    // preview from t=0 (bounded only by previewLeadMs, here effectively unconstrained since they're
    // all within 4_000ms of the song's start) — three simultaneous previews, not just one.
    const previewTexts = document.events
      .filter((event) => event.style === 'Preview' && event.startMs === 0)
      .map((event) => event.text);
    expect(previewTexts).toEqual([
      '{\\an8}{\\q2}Second',
      '{\\an8}{\\q2}Third',
      '{\\an8}{\\q2}Fourth',
    ]);
  });

  it('delays a preview until its row frees up from its same-row predecessor', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
        { startMs: 2_000, endMs: 3_000, text: 'Third' },
      ],
    };

    // rowCount 2: "Third" (index 2) shares "First"'s row (index 0), so its preview can't start
    // before "First"'s own Lyrics event ends at 1_000, even though previewLeadMs would allow t=0.
    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 1,
    });

    const thirdPreview = document.events.find(
      (event) => event.style === 'Preview' && event.text.endsWith('Third'),
    );
    expect(thirdPreview?.startMs).toBe(1_000);
  });

  it('caps concurrent Preview events at maxPreviewLines even when independent rows would each qualify', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 5_000, endMs: 6_000, text: 'Second' },
        { startMs: 5_000, endMs: 6_000, text: 'Third' },
      ],
    };

    // "First" ending early frees row 0 for "Second" well before its own natural appearance (3_000),
    // and row 1 (never used before) has no predecessor to gate "Third" either - so, uncapped, both
    // would preview from t=3_000 on separate rows despite maxPreviewLines: 1.
    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 1,
      previewLeadMs: 2_000,
    });

    const previewEvents = document.events.filter((event) => event.style === 'Preview');
    expect(previewEvents).toEqual([
      {
        layer: -1,
        startMs: 3_000,
        endMs: 5_000,
        style: 'Preview',
        marginVertical: 114,
        text: '{\\an8}{\\q2}Second',
      },
    ]);

    const third = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('Third'),
    );
    expect(third?.startMs).toBe(5_000);
  });

  it('resets the row rotation to the top row after a genuine full-blank gap', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 10_000, endMs: 11_000, text: 'Second' },
        { startMs: 11_000, endMs: 12_000, text: 'Third' },
      ],
    };

    // "First" ends at 1_000 and nothing shows again until 9_500 (Second's natural appearance,
    // 10_000 - 500ms previewLeadMs) — a genuine ~8.5s blank with every row empty.
    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 1,
      previewLeadMs: 500,
    });

    const first = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('First'),
    );
    const secondPreview = document.events.find(
      (event) => event.style === 'Preview' && event.text.endsWith('Second'),
    );
    const second = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('Second'),
    );
    const third = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('Third'),
    );

    // "Second" (and its preview) reset to the top row instead of continuing to row 1...
    expect(secondPreview?.marginVertical).toBe(first?.marginVertical);
    expect(second?.marginVertical).toBe(first?.marginVertical);
    // ...and rotation continues normally from the reset point, so "Third" takes row 1.
    expect(third?.marginVertical).not.toBe(second?.marginVertical);
  });

  it('resets the row rotation even when the gap is too short to qualify for an interlude', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 10_000, endMs: 11_000, text: 'Second' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 1,
      previewLeadMs: 500,
      interlude: { minGapMs: 20_000, strategy: 'text' },
    });

    const first = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('First'),
    );
    const second = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('Second'),
    );
    expect(second?.marginVertical).toBe(first?.marginVertical);
  });

  it('does not reset the row rotation when lingerMaxMs fully bridges a same-row gap', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
        { startMs: 2_000, endMs: 3_000, text: 'Third' },
        { startMs: 3_000, endMs: 4_000, text: 'Fourth' },
        { startMs: 6_000, endMs: 7_000, text: 'Fifth' },
      ],
    };

    // rowCount 3: "Fifth" (index 4) would reuse "Second"'s row (index 1). Its natural appearance
    // (5_500 = 6_000 - 500ms previewLeadMs) is 3_500ms after "Second"'s endMs, which fits
    // entirely within lingerMaxMs, so that row is never truly blank.
    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 2,
      previewLeadMs: 500,
      lingerMaxMs: 4_000,
    });

    const second = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('Second'),
    );
    const fifth = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('Fifth'),
    );
    expect(fifth?.marginVertical).toBe(second?.marginVertical);
  });

  it('still resets the row rotation when lingerMaxMs only partially bridges a same-row gap', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
        { startMs: 2_000, endMs: 3_000, text: 'Third' },
        { startMs: 3_000, endMs: 4_000, text: 'Fourth' },
        { startMs: 6_000, endMs: 7_000, text: 'Fifth' },
      ],
    };

    // Same setup, but lingerMaxMs only covers 1_000ms of "Second"'s 3_500ms gap, leaving a
    // genuine blank before "Fifth" appears, so it resets to the top row instead.
    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 2,
      previewLeadMs: 500,
      lingerMaxMs: 1_000,
    });

    const first = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('First'),
    );
    const fifth = document.events.find(
      (event) => event.style === 'Lyrics' && event.text.endsWith('Fifth'),
    );
    expect(fifth?.marginVertical).toBe(first?.marginVertical);
  });

  it('rejects a maxPreviewLines outside 1-8', () => {
    expect(() => planEvents({ occurrences: [] }, { ...options, maxPreviewLines: 0 })).toThrow(
      RangeError,
    );
    expect(() => planEvents({ occurrences: [] }, { ...options, maxPreviewLines: 9 })).toThrow(
      RangeError,
    );
  });

  it('rejects lyric occurrences whose peak concurrency exceeds the available rows', () => {
    // rowCount 2 (maxPreviewLines: 1), but 3 duet lines share the same [0, 1_000) window.
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 0, endMs: 1_000, text: 'Second' },
        { startMs: 0, endMs: 1_000, text: 'Third' },
      ],
    };

    expect(() =>
      planEvents(normalized, { ...options, preset: 'multi-line', maxPreviewLines: 1 }),
    ).toThrow(RangeError);
  });

  it('accepts lyric occurrences whose peak concurrency exactly fills the available rows', () => {
    // rowCount 2 (maxPreviewLines: 1); only 2 duet lines share the same window, which fits exactly.
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 0, endMs: 1_000, text: 'Second' },
      ],
    };

    expect(() =>
      planEvents(normalized, { ...options, preset: 'multi-line', maxPreviewLines: 1 }),
    ).not.toThrow();
  });

  it('does not assign a row still occupied by an earlier, longer occurrence even when round-robin would land there', () => {
    // rowCount 2 (maxPreviewLines: 1). "First" [0, 10_000) outlasts "Second" [1_000, 2_000), so by
    // the time "Third" [3_000, 4_000) is placed, naive round-robin would land back on "First"'s row
    // even though "First" is still active there and "Second"'s row is actually free.
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 10_000, text: 'First' },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
        { startMs: 3_000, endMs: 4_000, text: 'Third' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'multi-line',
      maxPreviewLines: 1,
    });
    const [first, second, third] = document.events.filter((event) => event.style === 'Lyrics');

    expect(third.marginVertical).not.toBe(first.marginVertical);
    expect(third.marginVertical).toBe(second.marginVertical);
  });

  describe('lingerMaxMs', () => {
    // rowCount 2 ("First"/index0 and "Third"/index2 share a row); previewLeadMs is short enough
    // to leave a real gap between "First"'s own endMs and "Third"'s preview, but generous enough
    // that neither gap here is a genuine full-blank row-reset trigger (see the dedicated
    // "resets the row rotation..." tests below for that).
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 3_000, endMs: 4_000, text: 'Second' },
        { startMs: 6_000, endMs: 7_000, text: 'Third' },
      ],
    };
    const lingerOptions = {
      ...options,
      preset: 'multi-line' as const,
      maxPreviewLines: 1,
      previewLeadMs: 2_000,
    };

    it("lets a line linger all the way to its row's next preview when the gap fits within lingerMaxMs", () => {
      const document = planEvents(normalized, { ...lingerOptions, lingerMaxMs: 10_000 });

      const first = document.events.find((event) => event.text.endsWith('First'));
      expect(first?.endMs).toBe(4_000);
    });

    it('caps lingering at lingerMaxMs and leaves the remainder of the gap blank', () => {
      const document = planEvents(normalized, { ...lingerOptions, lingerMaxMs: 1_500 });

      const first = document.events.find((event) => event.text.endsWith('First'));
      expect(first?.endMs).toBe(2_500);
    });

    it('does not linger across a gap long enough to warrant an interlude', () => {
      const document = planEvents(normalized, {
        ...lingerOptions,
        lingerMaxMs: 10_000,
        interlude: { minGapMs: 2_000, strategy: 'text' },
      });

      const first = document.events.find((event) => event.text.endsWith('First'));
      expect(first?.endMs).toBe(1_000);
    });

    it('lingers regardless of gap size when no interlude is configured', () => {
      const document = planEvents(normalized, {
        ...lingerOptions,
        lingerMaxMs: 10_000,
        interlude: undefined,
      });

      const first = document.events.find((event) => event.text.endsWith('First'));
      expect(first?.endMs).toBe(4_000);
    });

    it('does not linger when lingerMaxMs is 0 (the default fixture value)', () => {
      const document = planEvents(normalized, lingerOptions);

      const first = document.events.find((event) => event.text.endsWith('First'));
      expect(first?.endMs).toBe(1_000);
    });

    it("lingers past a row-local gap that isn't a real song-wide pause (other rows keep the screen busy)", () => {
      // 3 rows (A/D/E-F cycle row0, B/F cycle row1, C cycles row2). A small real gap before "E"
      // (4000->5010) triggers a row-reset that diverts what would've been row1's turn to row0
      // instead, delaying "B"'s own row1 successor ("F") well past lingerMaxMs — a rotation
      // artifact, not an actual pause: every gap between consecutive occurrences here stays under
      // minGapMs, so nothing here would ever actually become an Interlude.
      const rowSkipFixture: NormalizedLyrics = {
        occurrences: [
          { startMs: 0, endMs: 1_000, text: 'A' },
          { startMs: 1_000, endMs: 2_000, text: 'B' },
          { startMs: 2_000, endMs: 3_000, text: 'C' },
          { startMs: 3_000, endMs: 4_000, text: 'D' },
          { startMs: 5_010, endMs: 6_010, text: 'E' },
          { startMs: 6_010, endMs: 7_010, text: 'F' },
        ],
      };

      const document = planEvents(rowSkipFixture, {
        ...options,
        preset: 'multi-line',
        maxPreviewLines: 2,
        previewLeadMs: 0,
        lingerMaxMs: 3_000,
        interlude: { minGapMs: 4_000, strategy: 'text' },
      });

      const b = document.events.find((event) => event.text.endsWith('B'));
      expect(b?.endMs).toBe(5_000);
    });

    it('does not linger across a real gap masked by a large pre-sweep count-in delay', () => {
      // "C" has a plausible (small) bracket timestamp, but its enhanced segment defers its actual
      // first sung word another 6500ms out (a big count-in, same shape as an enhanced-LRC line
      // whose line tag arrives well before its first real word). The gap as measured by C's own
      // *display* start (bracket + segment offset - mainLinePreRollMs) is only 7500ms - under the
      // 8000ms minGapMs - but the real gap (to its actual first sung word) is 8500ms, and should
      // still be recognized and stop "A" from lingering across it.
      const preSweepMaskedFixture: NormalizedLyrics = {
        occurrences: [
          { startMs: 0, endMs: 1_000, text: 'A' },
          {
            startMs: 3_000,
            endMs: 10_500,
            text: 'C',
            segments: [{ text: 'C', timeMs: 6_500, location: { line: 1, column: 1 } }],
          },
        ],
      };

      const document = planEvents(preSweepMaskedFixture, {
        ...options,
        preset: 'multi-line',
        maxPreviewLines: 1,
        previewLeadMs: 0,
        lingerMaxMs: 5_000,
        interlude: { minGapMs: 8_000, strategy: 'text' },
      });

      const a = document.events.find((event) => event.text.endsWith('A'));
      expect(a?.endMs).toBe(1_000);
    });

    it('sorts occurrences by sung start (not display start) when computing quiet gaps, so a later-sung but earlier-displayed line cannot swallow a real gap around an earlier-sung, later-displayed line', () => {
      // Display order is A, B, Mid, D (B's huge embedded delay defers its display to right after A,
      // even though it isn't actually sung until 6_500 - after Mid and D). Scanning quiet gaps in
      // that display order lets B's late sungStart get compared against A's endMs before Mid or D
      // are considered, fabricating one giant gap (1_000-6_500) that wrongly swallows Mid's real
      // singing window (4_000-5_000). Mid and D end up sharing a row, and D's own display start
      // (6_200) falls inside that fabricated gap, so the buggy ceiling collapses all the way back
      // to 1_000 - shrinking Mid's already-placed endMs from 5_000 down to 1_000, before its own
      // startMs. Sorting by actual sung start keeps Mid's real gaps separate (1_000-4_000 and
      // 5_000-6_200), leaving Mid's endMs alone since it borders real quiet gaps on both sides.
      const fixture: NormalizedLyrics = {
        occurrences: [
          { startMs: 0, endMs: 1_000, text: 'A' },
          {
            startMs: 500,
            endMs: 8_000,
            text: 'B',
            segments: [{ text: 'B', timeMs: 6_000, location: { line: 1, column: 1 } }],
          },
          { startMs: 4_000, endMs: 5_000, text: 'Mid' },
          { startMs: 6_200, endMs: 7_200, text: 'D' },
        ],
      };

      const events = planEvents(fixture, {
        ...options,
        preset: 'multi-line',
        maxPreviewLines: 1,
        previewLeadMs: 0,
        mainLinePreRollMs: 6_000,
        lingerMaxMs: 10_000,
        interlude: { minGapMs: 100, strategy: 'text' },
      }).events;

      const mid = events.find((event) => event.style === 'Lyrics' && event.text.endsWith('Mid'));
      expect(mid?.endMs).toBe(5_000);
    });

    describe('blankGapMs', () => {
      const preSweepFixture: NormalizedLyrics = {
        occurrences: [
          { startMs: 0, endMs: 1_000, text: 'A' },
          {
            startMs: 2_000,
            endMs: 7_500,
            text: 'C',
            segments: [{ text: 'C', timeMs: 3_000, location: { line: 1, column: 1 } }],
          },
        ],
      };
      // The real gap here (A's end at 1000 to C's actual sung start at 5000) is 4000ms - real, but
      // short of the 8000ms minGapMs, so no Interlude appears either way.

      it('lingers across a real gap shorter than minGapMs when blankGapMs is unset', () => {
        const document = planEvents(preSweepFixture, {
          ...options,
          preset: 'multi-line',
          maxPreviewLines: 1,
          previewLeadMs: 0,
          mainLinePreRollMs: 0,
          lingerMaxMs: 5_000,
          interlude: { minGapMs: 8_000, strategy: 'text' },
        });

        const a = document.events.find((event) => event.text.endsWith('A'));
        expect(a?.endMs).toBe(5_000);
      });

      it('clears all rows instead of lingering once a real gap reaches blankGapMs, even below minGapMs', () => {
        const document = planEvents(preSweepFixture, {
          ...options,
          preset: 'multi-line',
          maxPreviewLines: 1,
          previewLeadMs: 0,
          mainLinePreRollMs: 0,
          lingerMaxMs: 5_000,
          interlude: { minGapMs: 8_000, strategy: 'text', blankGapMs: 3_000 },
        });

        const a = document.events.find((event) => event.text.endsWith('A'));
        expect(a?.endMs).toBe(1_000);
      });
    });
  });

  it('prepends a fad tag to every event when fadeInMs/fadeOutMs are set', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [{ startMs: 0, endMs: 1_000, text: 'Solo' }],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'single-line',
      fadeInMs: 200,
      fadeOutMs: 300,
    });

    expect(document.events).toEqual([
      { layer: 0, startMs: 0, endMs: 1_000, style: 'Lyrics', text: '{\\fad(200,300)}{\\q2}Solo' },
    ]);
  });

  it("scales fadeInMs/fadeOutMs down so they never exceed an event's own duration", () => {
    const normalized: NormalizedLyrics = {
      occurrences: [{ startMs: 0, endMs: 500, text: 'Short' }],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'single-line',
      fadeInMs: 400,
      fadeOutMs: 400,
    });

    // fadeInMs + fadeOutMs (800) exceeds the 500ms event duration, so both are scaled by 500/800 = 0.625.
    expect(document.events).toEqual([
      { layer: 0, startMs: 0, endMs: 500, style: 'Lyrics', text: '{\\fad(250,250)}{\\q2}Short' },
    ]);
  });

  it("derives the scaled fadeOutMs as fadeInMs's complement so the rounded pair never exceeds the event duration", () => {
    const normalized: NormalizedLyrics = {
      occurrences: [{ startMs: 0, endMs: 10, text: 'Tiny' }],
    };

    const document = planEvents(normalized, {
      ...options,
      preset: 'single-line',
      fadeInMs: 100,
      fadeOutMs: 300,
    });

    // fadeInMs + fadeOutMs (400) scales by 10/400 = 0.025 to 2.5/7.5; rounding each independently
    // would give fad(3,8) (sum 11 > the 10ms event duration), so fadeOutMs is derived as 10 - 3 = 7.
    expect(document.events).toEqual([
      { layer: 0, startMs: 0, endMs: 10, style: 'Lyrics', text: '{\\fad(3,7)}{\\q2}Tiny' },
    ]);
  });

  it('emits no fad tag when fadeInMs and fadeOutMs are both 0', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [{ startMs: 0, endMs: 1_000, text: 'Solo' }],
    };

    const document = planEvents(normalized, { ...options, preset: 'single-line' });

    expect(document.events).toEqual([
      { layer: 0, startMs: 0, endMs: 1_000, style: 'Lyrics', text: '{\\q2}Solo' },
    ]);
  });

  it('omits events that collapse after centisecond quantization', () => {
    const document = planEvents(
      { occurrences: [{ startMs: 1, endMs: 4, text: 'Too short' }] },
      options,
    );
    expect(document.events).toEqual([]);
  });

  it('rejects invalid planner options', () => {
    expect(() =>
      planEvents(
        { occurrences: [] },
        {
          ...options,
          interlude: { minGapMs: -1, strategy: 'none' },
        },
      ),
    ).toThrow(RangeError);
    expect(() =>
      planEvents(
        { occurrences: [] },
        {
          ...options,
          styles: { lyrics: { primaryColor: 'red' } },
        },
      ),
    ).toThrow(RangeError);
    expect(() =>
      planEvents(
        { occurrences: [] },
        {
          ...options,
          styles: { lyrics: { fontName: 'Unsafe, Font' } },
        },
      ),
    ).toThrow(RangeError);
    expect(() =>
      planEvents(
        { occurrences: [] },
        {
          ...options,
          styles: { lyrics: { fontName: 'Unsafe\nFont' } },
        },
      ),
    ).toThrow(RangeError);
    expect(() =>
      planEvents(
        { occurrences: [] },
        {
          ...options,
          layout: { ...options.layout, marginLeft: 200, marginRight: 200, resolutionX: 384 },
        },
      ),
    ).toThrow(RangeError);
    expect(() =>
      planEvents(
        { occurrences: [] },
        {
          ...options,
          preset: 'multi-line',
          maxPreviewLines: 3,
          layout: { ...options.layout, resolutionY: 50, rowHeightPx: 30 },
        },
      ),
    ).toThrow(RangeError);
  });

  it('rejects a row block that exactly equals resolutionY (would produce a top row MarginV of 0)', () => {
    // rowCount 2 * rowHeightPx 30 = 60 == resolutionY 60, an "exact fit" that must still be rejected.
    expect(() =>
      planEvents(
        { occurrences: [] },
        {
          ...options,
          preset: 'multi-line',
          maxPreviewLines: 1,
          layout: { ...options.layout, resolutionY: 60, rowHeightPx: 30 },
        },
      ),
    ).toThrow(RangeError);
  });

  it('does not gate the row-block-height check on single-line, since rowHeightPx/maxPreviewLines are unused there', () => {
    expect(() =>
      planEvents(
        { occurrences: [] },
        {
          ...options,
          preset: 'single-line',
          maxPreviewLines: 3,
          layout: { ...options.layout, resolutionY: 50, rowHeightPx: 30 },
        },
      ),
    ).not.toThrow();
  });

  it('adds buffered text and countdown interludes', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 5_000, endMs: 6_000, text: 'Second' },
      ],
    };

    const textInterlude = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 3_000, marginMs: 100, strategy: 'text' },
    });
    const countdown = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 0, strategy: 'countdown' },
    });

    expect(textInterlude.events).toContainEqual({
      layer: 0,
      startMs: 1_100,
      endMs: 4_900,
      style: 'Interlude',
      text: '♪ Instrumental ♪',
    });
    const customStyleInterlude = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 3_000, strategy: 'text', style: 'Instrumental' },
    });
    expect(customStyleInterlude.styles.map((style) => style.name)).toContain('Instrumental');
    expect(countdown.events.filter((event) => event.style === 'Interlude')).toEqual([
      { layer: 0, startMs: 1_000, endMs: 2_000, style: 'Interlude', text: '4' },
      { layer: 0, startMs: 2_000, endMs: 3_000, style: 'Interlude', text: '3' },
      { layer: 0, startMs: 3_000, endMs: 4_000, style: 'Interlude', text: '2' },
      { layer: 0, startMs: 4_000, endMs: 5_000, style: 'Interlude', text: '1' },
    ]);
  });

  it('draws a track and animated fill event for the progress-bar interlude strategy', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_000, text: 'First' },
        { startMs: 5_000, endMs: 6_000, text: 'Second' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 3_000, marginMs: 100, strategy: 'progress-bar' },
    });

    // layout: resolutionX 384, marginLeft/Right 10 -> barLeft 10, barWidth 364; resolutionY 288,
    // barHeight 24 -> barTop 132; radius clamps to 8. Single-line preset interlude colors:
    // primaryColor #FFFFFF (fill), secondaryColor #808080 (track), outlineColor #000000 (border).
    const path =
      'm 8 0 l 356 0 b 364 0 364 0 364 8 l 364 16 b 364 24 364 24 356 24 l 8 24 ' +
      'b 0 24 0 24 0 16 l 0 8 b 0 0 0 0 8 0';

    expect(document.events.filter((event) => event.style === 'Interlude')).toEqual([
      {
        layer: 0,
        startMs: 1_100,
        endMs: 4_900,
        style: 'Interlude',
        text: `{\\p1\\an7\\pos(10,132)\\shad0\\1c&H00808080&\\3c&H00000000&}${path}{\\p0}`,
      },
      {
        layer: 1,
        startMs: 1_100,
        endMs: 4_900,
        style: 'Interlude',
        text:
          '{\\p1\\an7\\pos(10,132)\\shad0\\1c&H00FFFFFF&\\3c&H00000000&' +
          '\\clip(10,132,10,156)\\t(0,3800,\\clip(10,132,374,156))}' +
          `${path}{\\p0}`,
      },
    ]);
  });

  it('adds an interlude for a leading gap before the very first lyric', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [{ startMs: 10_000, endMs: 11_000, text: 'First' }],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 3_000, marginMs: 100, strategy: 'text' },
    });

    expect(document.events.filter((event) => event.style === 'Interlude')).toEqual([
      { layer: 0, startMs: 100, endMs: 9_900, style: 'Interlude', text: '♪ Instrumental ♪' },
    ]);
  });

  it('waits for every overlapping lyric to end before adding an interlude', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 3_000, text: 'Long lyric' },
        { startMs: 0, endMs: 1_000, text: 'Short lyric' },
        { startMs: 5_000, endMs: 6_000, text: 'Next lyric' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 1_000, strategy: 'text' },
    });

    expect(document.events.filter((event) => event.style === 'Interlude')).toEqual([
      { layer: 0, startMs: 3_000, endMs: 5_000, style: 'Interlude', text: '♪ Instrumental ♪' },
    ]);
  });

  it('uses the final enhanced segment as the interlude tail anchor', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        {
          startMs: 0,
          endMs: 10_000,
          text: 'First line',
          segments: [
            { text: 'First ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'line', timeMs: 5_000, location: { line: 1, column: 7 } },
          ],
        },
        { startMs: 10_000, endMs: 12_000, text: 'Second line' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 3_000, strategy: 'text', trailingLyricDurationMs: 1_500 },
    });

    expect(document.events).toContainEqual({
      layer: 0,
      startMs: 0,
      endMs: 6_500,
      style: 'Lyrics',
      text: '{\\q2}First line',
    });
    expect(document.events).toContainEqual({
      layer: 0,
      startMs: 6_500,
      endMs: 10_000,
      style: 'Interlude',
      text: '♪ Instrumental ♪',
    });
  });

  it('does not truncate the final lyric with trailingLyricDurationMs when no lyric follows', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        {
          startMs: 0,
          endMs: 20_000,
          text: 'Last line',
          segments: [
            { text: 'Last ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'line', timeMs: 5_000, location: { line: 1, column: 6 } },
          ],
        },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 3_000, strategy: 'text', trailingLyricDurationMs: 1_500 },
    });

    expect(document.events).toContainEqual({
      layer: 0,
      startMs: 0,
      endMs: 20_000,
      style: 'Lyrics',
      text: '{\\q2}Last line',
    });
  });

  it('truncates a source-final lyric with trailingLyricDurationMs using its chronological (not source-order) successor', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        {
          startMs: 0,
          endMs: 6_000,
          text: 'First',
          segments: [{ text: 'First', timeMs: 5_000, location: { line: 1, column: 1 } }],
        },
        { startMs: 1_000, endMs: 2_000, text: 'Second' },
      ],
    };

    // "Second" (source-final) has no leading delay, so its deferredStart (1_000) ends up earlier
    // than "First"'s (5_000 sung-start - 1_000 mainLinePreRollMs = 4_000) — an inversion. "Second"
    // is chronologically first and its real successor is "First", not source-order's "undefined".
    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 1_000, strategy: 'text', trailingLyricDurationMs: 500 },
    });

    const second = document.events.find(
      (event) => event.style === 'Lyrics' && event.text === '{\\q2}Second',
    );
    expect(second?.endMs).toBe(1_500);
  });

  it('does not truncate the final visible lyric using a chronological successor that never becomes visible', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 10_000, text: 'First' },
        {
          // Deferred past its own endMs by segment timing, so it's never shown.
          startMs: 10_000,
          endMs: 10_400,
          text: 'Collapsed',
          segments: [{ text: 'Collapsed', timeMs: 3_000, location: { line: 1, column: 1 } }],
        },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 1_000, strategy: 'text', trailingLyricDurationMs: 500 },
    });

    const first = document.events.find(
      (event) => event.style === 'Lyrics' && event.text === '{\\q2}First',
    );
    expect(first?.endMs).toBe(10_000);
  });

  it('truncates a lyric against its real next visible successor, not an in-between candidate that only collapses once its own trailingLyricDurationMs clamp is applied', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        {
          startMs: 0,
          endMs: 6_000,
          text: 'First',
          segments: [{ text: 'First', timeMs: 5_000, location: { line: 1, column: 1 } }],
        },
        // Raw endMs looks fine, but trailingLyricDurationMs: 0 clamps it to its own start.
        { startMs: 6_000, endMs: 6_500, text: 'Collapsed' },
        { startMs: 20_000, endMs: 21_000, text: 'Third' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 1_000, strategy: 'text', trailingLyricDurationMs: 0 },
    });

    const first = document.events.find(
      (event) => event.style === 'Lyrics' && event.text === '{\\q2}First',
    );
    const collapsed = document.events.find(
      (event) => event.style === 'Lyrics' && event.text === '{\\q2}Collapsed',
    );
    expect(collapsed).toBeUndefined();
    expect(first?.endMs).toBe(5_000);
  });

  it('applies trailingLyricDurationMs to every member of a tied deferred-start group, not just the last', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 10_000, text: 'A' },
        { startMs: 0, endMs: 8_000, text: 'B' },
        { startMs: 20_000, endMs: 21_000, text: 'C' },
      ],
    };

    // A and B share deferredStart 0; each one's real chronological successor is C (20_000), not
    // its tied sibling's own start (which would make the gap look non-existent and skip clamping).
    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 1_000, strategy: 'text', trailingLyricDurationMs: 500 },
    });

    const a = document.events.find((event) => event.style === 'Lyrics' && event.text === '{\\q2}A');
    const b = document.events.find((event) => event.style === 'Lyrics' && event.text === '{\\q2}B');
    expect(a?.endMs).toBe(500);
    expect(b?.endMs).toBe(500);
  });

  it('does not truncate a lyric with trailingLyricDurationMs when the following gap is below minGapMs', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        {
          startMs: 0,
          endMs: 10_000,
          text: 'First line',
          segments: [
            { text: 'First ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'line', timeMs: 5_000, location: { line: 1, column: 7 } },
          ],
        },
        { startMs: 10_000, endMs: 12_000, text: 'Second line' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: { minGapMs: 10_000, strategy: 'text', trailingLyricDurationMs: 1_500 },
    });

    expect(document.events).toContainEqual({
      layer: 0,
      startMs: 0,
      endMs: 10_000,
      style: 'Lyrics',
      text: '{\\q2}First line',
    });
  });

  it('does not truncate a lyric when minGapMs is met but marginMs would leave no interlude window', () => {
    const normalized: NormalizedLyrics = {
      occurrences: [
        {
          startMs: 0,
          endMs: 7_000,
          text: 'First line',
          segments: [
            { text: 'First ', timeMs: 0, location: { line: 1, column: 1 } },
            { text: 'line', timeMs: 5_000, location: { line: 1, column: 7 } },
          ],
        },
        { startMs: 9_500, endMs: 11_000, text: 'Second line' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      interlude: {
        minGapMs: 3_000,
        marginMs: 2_000,
        strategy: 'text',
        trailingLyricDurationMs: 1_500,
      },
    });

    expect(document.events).toContainEqual({
      layer: 0,
      startMs: 0,
      endMs: 7_000,
      style: 'Lyrics',
      text: '{\\q2}First line',
    });
    expect(document.events.filter((event) => event.style === 'Interlude')).toEqual([]);
  });

  it('does not truncate a lyric when the raw gap clears minGapMs and margin but quantizing both margin-adjusted boundaries collapses the interlude window', () => {
    // Raw gap (1_020 - 1_004 = 16ms) clears minGapMs (0) and 2*marginMs (12ms), but each boundary,
    // once margin-adjusted and rounded to the nearest 10ms, lands on 1_010 - no room left for an
    // interlude. The truncation decision must see that same rounding collapse, not just the raw gap,
    // or "First" gets cut short with nothing (no interlude either) to fill the resulting dead air.
    const normalized: NormalizedLyrics = {
      occurrences: [
        { startMs: 0, endMs: 1_020, text: 'First' },
        { startMs: 1_020, endMs: 2_000, text: 'Second' },
      ],
    };

    const document = planEvents(normalized, {
      ...options,
      mainLinePreRollMs: 0,
      interlude: {
        minGapMs: 0,
        marginMs: 6,
        strategy: 'text',
        trailingLyricDurationMs: 1_004,
      },
    });

    expect(document.events).toContainEqual({
      layer: 0,
      startMs: 0,
      endMs: 1_020,
      style: 'Lyrics',
      text: '{\\q2}First',
    });
    expect(document.events.filter((event) => event.style === 'Interlude')).toEqual([]);
  });
});
