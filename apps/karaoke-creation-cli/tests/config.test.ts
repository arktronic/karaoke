import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from '../src/core/config.js';

describe('mergeConfig', () => {
  it('returns the base config when no overrides are given', () => {
    expect(mergeConfig(DEFAULT_CONFIG, undefined)).toEqual(DEFAULT_CONFIG);
  });

  it('applies explicit overrides', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { width: 1280, height: 720 });
    expect(merged.width).toBe(1280);
    expect(merged.height).toBe(720);
    expect(merged.fps).toBe(DEFAULT_CONFIG.fps);
  });

  it('does not let undefined override values wipe out defaults', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { width: undefined, height: 720 });
    expect(merged.width).toBe(DEFAULT_CONFIG.width);
    expect(merged.height).toBe(720);
  });

  it('merges nested visualizer config without wiping unspecified fields', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { visualizer: {} });
    expect(merged.visualizer.preset).toBe(DEFAULT_CONFIG.visualizer.preset);
  });

  it('overrides nested visualizer preset when given', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { visualizer: { preset: 'Custom Preset' } });
    expect(merged.visualizer.preset).toBe('Custom Preset');
  });
});
