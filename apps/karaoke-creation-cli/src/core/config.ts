import { readFile } from 'node:fs/promises';
import type { KaraokeConfig, KaraokeConfigOverrides } from '../types/options.js';

export const DEFAULT_CONFIG: KaraokeConfig = {
  width: 1920,
  height: 1080,
  fps: 60,
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

function validateConfigOverrides(value: unknown): asserts value is KaraokeConfigOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Config must be a JSON object');
  }

  const overrides = value as Record<string, unknown>;
  for (const key of ['width', 'height', 'fps'] as const) {
    const number = overrides[key];
    if (
      number !== undefined &&
      (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0)
    ) {
      throw new Error(`Config ${key} must be a positive safe integer`);
    }
  }

  const visualizer = overrides.visualizer;
  if (visualizer !== undefined) {
    if (typeof visualizer !== 'object' || visualizer === null || Array.isArray(visualizer)) {
      throw new Error('Config visualizer must be a JSON object');
    }

    const preset = (visualizer as Record<string, unknown>).preset;
    if (preset !== undefined && (typeof preset !== 'string' || preset.trim().length === 0)) {
      throw new Error('Config visualizer.preset must be a non-empty string');
    }
  }
}

/** Loads a JSON config file and merges it over the built-in defaults. Returns defaults if `path` is undefined. */
export async function loadConfig(path: string | undefined): Promise<KaraokeConfig> {
  if (!path) {
    return DEFAULT_CONFIG;
  }

  const text = await readFile(path, 'utf8');
  const overrides: unknown = JSON.parse(text);
  validateConfigOverrides(overrides);
  return mergeConfig(DEFAULT_CONFIG, overrides);
}
