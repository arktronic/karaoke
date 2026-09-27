import type { PlanOverrideOptions } from 'lrc2ass';

export interface VisualizerConfig {
  /** Name of the butterchurn-presets preset to load. */
  preset: string;
}

export interface KaraokeConfig {
  width: number;
  height: number;
  fps: number;
  visualizer: VisualizerConfig;
  /** lrc2ass planner overrides applied when the input lyrics are LRC. */
  plan?: PlanOverrideOptions;
}

export type KaraokeConfigOverrides = Omit<Partial<KaraokeConfig>, 'visualizer'> & {
  visualizer?: Partial<VisualizerConfig>;
};

export interface CreateVideoOptions {
  /** Path to the audio file (e.g. .mp3, .wav) to render and mux into the output video. */
  audioPath: string;
  /** Path to the lyrics file; `.lrc` is converted via lrc2ass, `.ass` is used as-is. */
  lyricsPath: string;
  /** Path the finished .mp4 is written to. */
  outputPath: string;
  config: KaraokeConfig;
}
