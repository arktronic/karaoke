import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, mergeConfig } from '../src/core/config.js';

async function loadConfigFromJson(json: string) {
  const directory = await mkdtemp(join(tmpdir(), 'karaoke-config-'));
  const path = join(directory, 'config.json');
  try {
    await writeFile(path, json);
    return await loadConfig(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

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

describe('loadConfig', () => {
  it('validates and merges partial JSON overrides', async () => {
    const config = await loadConfigFromJson('{"width":1280,"visualizer":{"preset":"Custom"}}');

    expect(config).toEqual({
      ...DEFAULT_CONFIG,
      width: 1280,
      visualizer: { preset: 'Custom' },
    });
  });

  it.each([
    ['null root', 'null'],
    ['array root', '[]'],
    ['zero width', '{"width":0}'],
    ['negative height', '{"height":-1}'],
    ['fractional fps', '{"fps":24.5}'],
    ['unsafe integer fps', '{"fps":9007199254740992}'],
    ['null visualizer', '{"visualizer":null}'],
    ['non-string preset', '{"visualizer":{"preset":42}}'],
    ['empty preset', '{"visualizer":{"preset":"  "}}'],
  ])('rejects %s', async (_name, json) => {
    await expect(loadConfigFromJson(json)).rejects.toThrow(/Config/);
  });
});
