import { readFile } from 'node:fs/promises';
import type { KaraokeConfig, KaraokeConfigOverrides } from '../types/options.js';

export const DEFAULT_CONFIG: KaraokeConfig = {
  width: 1920,
  height: 1080,
  fps: 24,
  visualizer: {
    preset: 'Flexi, martin + geiss - dedicated to the sherwin maxawow',
  },
};

/** Merges override values onto a base config; `undefined` override values leave the base value untouched. */
export function mergeConfig(
  base: KaraokeConfig,
  overrides: KaraokeConfigOverrides | undefined,
): KaraokeConfig {
  if (!overrides) {
    return base;
  }

  return {
    width: overrides.width ?? base.width,
    height: overrides.height ?? base.height,
    fps: overrides.fps ?? base.fps,
    visualizer: {
      preset: overrides.visualizer?.preset ?? base.visualizer.preset,
    },
  };
}

/** Loads a JSON config file and merges it over the built-in defaults. Returns defaults if `path` is undefined. */
export async function loadConfig(path: string | undefined): Promise<KaraokeConfig> {
  if (!path) {
    return DEFAULT_CONFIG;
  }

  const text = await readFile(path, 'utf8');
  const overrides = JSON.parse(text) as KaraokeConfigOverrides;
  return mergeConfig(DEFAULT_CONFIG, overrides);
}
