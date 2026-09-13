import { describe, expect, it } from 'vitest';
import { convert } from '../src/index.js';

describe('convert end-to-end', () => {
  it('produces a valid v4.00+ document for plain line-timed LRC', () => {
    const result = convert(
      '[ti:Song][ar:Artist][offset:0]\r\n[00:00.00]Hello world\r\n[00:02.00]Second line\r\n',
      { plan: { fadeInMs: 0, fadeOutMs: 0 } },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.text).toContain('[Script Info]\r\n');
    expect(result.text).toContain('ScriptType: v4.00+');
    expect(result.text).toContain('[V4+ Styles]\r\n');
    expect(result.text).toContain('[Events]\r\n');
    expect(result.text).toContain(
      'Dialogue: 0,0:00:00.00,0:00:02.00,Lyrics,,0,0,84,,{\\an8}{\\q2}Hello world',
    );
    expect(result.text).toContain(
      'Dialogue: 0,0:00:02.00,0:00:07.00,Lyrics,,0,0,114,,{\\an8}{\\q2}Second line',
    );
    // Default multi-line preset emits a Preview Dialogue event for the upcoming line.
    expect(result.text).toContain(
      'Dialogue: -1,0:00:00.00,0:00:02.00,Preview,,0,0,114,,{\\an8}{\\q2}Second line',
    );
    expect(result.text.endsWith('\r\n')).toBe(true);
  });

  it('emits no Preview Dialogue event for the single-line preset', () => {
    const result = convert(
      '[ti:Song][ar:Artist][offset:0]\r\n[00:00.00]Hello world\r\n[00:02.00]Second line\r\n',
      { plan: { preset: 'single-line' } },
    );

    expect(result.text).not.toMatch(/Dialogue:.*Preview,/);
  });

  it('encodes enhanced word timing as kf karaoke tags for a sweep effect', () => {
    const result = convert('[offset:0]\r\n[00:00.00]He<00:00.50>llo<00:01.00> there\r\n', {
      plan: { karaokeEffect: 'sweep' },
    });

    const dialogueLines = result.text
      .split('\r\n')
      .filter((line) => line.trim().startsWith('Dialogue:'));
    expect(dialogueLines.length).toBe(1);
    // \kf tags with centisecond durations, applied by the planner and passed verbatim.
    expect(dialogueLines[0]).toContain('{\\kf50}');
    expect(dialogueLines[0]).toContain('He');
    expect(dialogueLines[0]).toContain('llo');
    expect(dialogueLines[0]).toContain(' there');
    // Tags are not re-escaped by the serializer.
    expect(dialogueLines[0]).not.toContain('{\\kfb');
    expect(dialogueLines[0]).not.toContain('{\\kf50\\}');
  });

  it("does not fade out/in at the Preview-to-Lyrics handoff, only at a line's true entrance/exit", () => {
    const result = convert('[offset:0]\r\n[00:00.00]First\r\n[00:02.00]Second\r\n', {
      plan: { preset: 'multi-line', fadeInMs: 150, fadeOutMs: 300 },
    });

    // First line has no preceding preview, so it gets a full fade-in; its preview of "Second"
    // hands off seamlessly into "Second" becoming current, so no fade plays at that boundary.
    expect(result.text).toContain(
      'Dialogue: 0,0:00:00.00,0:00:02.00,Lyrics,,0,0,84,,{\\fad(150,300)}{\\an8}{\\q2}First',
    );
    expect(result.text).toContain(
      'Dialogue: -1,0:00:00.00,0:00:02.00,Preview,,0,0,114,,{\\fad(150,0)}{\\an8}{\\q2}Second',
    );
    expect(result.text).toContain(
      'Dialogue: 0,0:00:02.00,0:00:07.00,Lyrics,,0,0,114,,{\\fad(0,300)}{\\an8}{\\q2}Second',
    );
  });

  it('emits a Preview style Dialogue event for the multi-line preset', () => {
    const result = convert('[offset:0]\r\n[00:00.00]First\r\n[00:02.00]Second\r\n', {
      plan: { preset: 'multi-line', fadeInMs: 0, fadeOutMs: 0 },
    });

    expect(result.text).toContain(
      'Dialogue: -1,0:00:00.00,0:00:02.00,Preview,,0,0,114,,{\\an8}{\\q2}Second',
    );
    expect(result.text).toContain(
      'Dialogue: 0,0:00:00.00,0:00:02.00,Lyrics,,0,0,84,,{\\an8}{\\q2}First',
    );
    expect(result.text).toContain(
      'Dialogue: 0,0:00:02.00,0:00:07.00,Lyrics,,0,0,114,,{\\an8}{\\q2}Second',
    );
  });

  it('adds an Interlude text event for a long instrumental gap with a trailing duration', () => {
    const result = convert('[offset:0]\r\n[00:00.00]First\r\n[01:00.00]Second\r\n', {
      plan: {
        preset: 'multi-line',
        fadeInMs: 0,
        fadeOutMs: 0,
        interlude: { strategy: 'text', minGapMs: 1000, marginMs: 0, trailingLyricDurationMs: 1000 },
      },
    });

    expect(result.text).toContain(
      'Dialogue: 0,0:00:01.00,0:01:00.00,Interlude,,0,0,0,,♪ Instrumental ♪',
    );
    // The ~59s gap is a genuine full blank (no lingering configured here to bridge it), so "Second"
    // resets to the top row instead of continuing the raw rotation to row 1.
    expect(result.text).toContain(
      'Dialogue: 0,0:01:00.00,0:01:05.00,Lyrics,,0,0,84,,{\\an8}{\\q2}Second',
    );
  });

  it('emits countdown Interlude events labelled with whole seconds remaining', () => {
    const result = convert('[offset:0]\r\n[00:00.00]First\r\n[00:30.00]Second\r\n', {
      plan: {
        preset: 'multi-line',
        fadeInMs: 0,
        fadeOutMs: 0,
        interlude: {
          strategy: 'countdown',
          minGapMs: 1000,
          marginMs: 0,
          trailingLyricDurationMs: 1000,
        },
      },
    });

    const interludeLines = result.text
      .split('\r\n')
      .filter((line) => line.trim().startsWith('Dialogue:') && line.trim().includes(',Interlude,'));
    expect(interludeLines.length).toBe(29);
    // First event counts down from 29 seconds; last from 1.
    expect(interludeLines[0].trim().split(',')[9]).toBe('29');
    expect(interludeLines[interludeLines.length - 1].trim().split(',')[9]).toBe('1');
  });

  it('surfaces strict-mode error diagnostics without throwing', () => {
    const result = convert('[offset:0]\r\n[99:99.00]Impossible\r\n', { parse: { mode: 'strict' } });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].code).toBe('LRC_TIMESTAMP_SECONDS_RANGE');
    // Serialization still completes and is well-formed despite the parse error.
    expect(result.text).toContain('[Events]\r\n');
  });

  it('keeps malformed lines out of the model in tolerant mode', () => {
    const result = convert('[offset:0]\r\n[00:00.00]Good line\r\n[00:00.0]bad line here\r\n', {
      parse: { mode: 'tolerant' },
      plan: { fadeInMs: 0, fadeOutMs: 0 },
    });

    // The malformed line is stored as an unknown entry, not turned into a Dialogue event.
    expect(result.text).toContain(
      'Dialogue: 0,0:00:00.00,0:00:05.00,Lyrics,,0,0,84,,{\\an8}{\\q2}Good line',
    );
    expect(result.text).not.toContain('bad line here');
  });

  it('emits the Title line from LRC [ti:] metadata when includeMetadataComments is enabled', () => {
    const result = convert('[ti:My Song][offset:0]\r\n[00:00.00]Hello\r\n', {
      serialize: { includeMetadataComments: true },
    });

    expect(result.text).toContain('Title: My Song');
  });

  it('omits the Title line by default even when [ti:] metadata is present', () => {
    const result = convert('[ti:My Song][offset:0]\r\n[00:00.00]Hello\r\n', {});

    expect(result.text).not.toContain('Title:');
  });
});
