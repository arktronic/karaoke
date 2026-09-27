import { describe, expect, it } from 'vitest';
import { resolveAssText, resolveAssTextWithDiagnostics } from '../src/core/input.js';

const SAMPLE_LRC = `[00:01.00]Hello world\n[00:03.00]Second line\n`;

describe('resolveAssText', () => {
  it('converts .lrc text to ASS via lrc2ass', () => {
    const result = resolveAssText(SAMPLE_LRC, '.lrc');
    expect(result).toContain('[Script Info]');
    expect(result).toContain('[Events]');
  });

  it('applies planner overrides while converting LRC text', () => {
    const result = resolveAssTextWithDiagnostics(SAMPLE_LRC, '.lrc', {
      layout: { resolutionX: 1280, resolutionY: 720 },
    });

    expect(result.text).toContain('PlayResX: 1280\r\nPlayResY: 720');
  });

  it('preserves conversion diagnostics for malformed .lrc text', () => {
    const result = resolveAssTextWithDiagnostics('[00:01.2]Bad', '.lrc');
    expect(result.text).toContain('[Events]');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'LRC_TIMESTAMP_INVALID', severity: 'warning' }),
      ]),
    );
  });

  it('passes .ass text through unchanged', () => {
    const assText = '[Script Info]\nPlayResX: 1920\n';
    expect(resolveAssText(assText, '.ass')).toBe(assText);
  });

  it('does not apply planner overrides to existing ASS text', () => {
    const assText = '[Script Info]\nPlayResX: 1920\n';
    expect(
      resolveAssText(assText, '.ass', { layout: { resolutionX: 1280, resolutionY: 720 } }),
    ).toBe(assText);
  });

  it('is case-insensitive on extension', () => {
    const result = resolveAssText(SAMPLE_LRC, '.LRC');
    expect(result).toContain('[Script Info]');
  });

  it('throws for unsupported extensions', () => {
    expect(() => resolveAssText('irrelevant', '.srt')).toThrow(/Unsupported lyrics file extension/);
  });
});
