import { describe, expect, it } from 'vitest';
import { resolveAssText } from '../src/core/input.js';

const SAMPLE_LRC = `[00:01.00]Hello world\n[00:03.00]Second line\n`;

describe('resolveAssText', () => {
  it('converts .lrc text to ASS via lrc2ass', () => {
    const result = resolveAssText(SAMPLE_LRC, '.lrc');
    expect(result).toContain('[Script Info]');
    expect(result).toContain('[Events]');
  });

  it('passes .ass text through unchanged', () => {
    const assText = '[Script Info]\nPlayResX: 1920\n';
    expect(resolveAssText(assText, '.ass')).toBe(assText);
  });

  it('is case-insensitive on extension', () => {
    const result = resolveAssText(SAMPLE_LRC, '.LRC');
    expect(result).toContain('[Script Info]');
  });

  it('throws for unsupported extensions', () => {
    expect(() => resolveAssText('irrelevant', '.srt')).toThrow(/Unsupported lyrics file extension/);
  });
});
