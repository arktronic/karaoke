import type { Diagnostic } from './diagnostics.js';
import type { EnhancedSegment, ParseOptions, ValidationMode } from './lrc.js';
import type { AssAlignment, AssDocument, KaraokeEffect } from './ass.js';

export type OverlapPolicy = 'preserve' | 'truncate' | 'error';

export interface Occurrence {
  startMs: number;
  endMs: number;
  text: string;
  segments?: EnhancedSegment[];
}

export interface NormalizedLyrics {
  occurrences: Occurrence[];
}

export interface NormalizeOptions {
  mode?: ValidationMode;
  /** Added to any `[offset:]` metadata offset (not a replacement for it) before normalization. */
  offsetMs?: number;
  /** How to resolve an occurrence whose inferred end runs past the next occurrence's start. */
  overlapPolicy?: OverlapPolicy;
  /** End of the track (ms); a fallback boundary for the final occurrence when no other duration hint applies. */
  trackEndMs?: number;
  /** Fallback duration (ms) an occurrence remains visible past its start when no other boundary hint applies. */
  defaultTrailingDurationMs?: number;
}

export interface NormalizeResult {
  normalized: NormalizedLyrics;
  diagnostics: Diagnostic[];
}

export interface InterludeOptions {
  /** Minimum silence (ms) between lyrics required before an interlude is inserted into the gap. */
  minGapMs: number;
  /** 'none': no interlude. 'text': static caption. 'countdown': seconds-remaining ticker. 'progress-bar': filling bar. */
  strategy: 'none' | 'text' | 'countdown' | 'progress-bar';
  style?: string;
  /** Gap (ms) kept clear on each side of an interlude so it doesn't touch the adjacent lyrics. */
  marginMs?: number;
  /** Progress bar top-edge Y coordinate in ASS canvas pixels; defaults to 622. */
  progressBarY?: number;
  /** Progress bar height in pixels; defaults to 90. */
  progressBarHeightPx?: number;
  /** Time a lyric remains visible after its start, or its final enhanced segment start. */
  trailingLyricDurationMs?: number;
  /**
   * Multi-line preset: a real gap at least this long (but shorter than minGapMs, so no Interlude
   * appears) still clears every row instead of letting them linger across it. Values above
   * minGapMs are clamped down to it (a no-op), so an inherited default can't conflict with a
   * caller-lowered minGapMs.
   */
  blankGapMs?: number;
}

export interface LayoutOptions {
  /** Script's authoring coordinate space (ASS "PlayResX"), not necessarily the video's actual resolution. */
  resolutionX: number;
  /** Script's authoring coordinate space (ASS "PlayResY"), not necessarily the video's actual resolution. */
  resolutionY: number;
  alignment: AssAlignment;
  marginLeft: number;
  marginRight: number;
  marginVertical: number;
  /** Row pitch (px) between the multi-line preset's rows; unused by single-line. */
  rowHeightPx: number;
  /**
   * Multi-line preset: shared alignment for every row (independent of styles.lyrics/preview
   * alignment when set explicitly, but otherwise falls back to the effective preview alignment,
   * so an unset rowAlignment still moves with styles.preview.alignment). Must be top or bottom
   * (1-3 or 7-9); middle alignments ignore MarginV, so distinct rows would collapse onto the same
   * vertical position. Set explicitly to decouple rows from Preview's alignment.
   */
  rowAlignment?: AssAlignment;
}

/** High-level visual settings for a generated ASS style. Colors use `#RRGGBB`. */
export interface PlanStyleOptions {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string;
  secondaryColor?: string;
  outlineColor?: string;
  backColor?: string;
  /** Opacity of backColor from 0 (transparent) to 1 (opaque). */
  backOpacity?: number;
  /** Drop-shadow offset distance in pixels; 0 (the default) means backColor/backOpacity have no visible effect. */
  shadow?: number;
  alignment?: AssAlignment;
  marginLeft?: number;
  marginRight?: number;
  marginVertical?: number;
}

export interface PlanStylesOptions {
  lyrics?: PlanStyleOptions;
  preview?: PlanStyleOptions;
  interlude?: PlanStyleOptions;
}

export type PlanPreset = 'single-line' | 'multi-line';

export interface PlanOptions {
  karaokeEffect: KaraokeEffect;
  layout: LayoutOptions;
  interlude?: InterludeOptions;
  preset?: PlanPreset;
  styles?: PlanStylesOptions;
  /** How long before a lyric's first sung word its Lyrics event may appear (never earlier than its own timestamp). */
  mainLinePreRollMs: number;
  /** Max lead time before the next lyric's first sung word that a Preview event may appear. */
  previewLeadMs: number;
  /** Fade-in duration (ms) applied to every event except a Lyrics event handed off from its own Preview; 0 disables it. */
  fadeInMs: number;
  /** Fade-out duration (ms) applied to every event except a Preview handing off into its own Lyrics event; 0 disables it. */
  fadeOutMs: number;
  /** Multi-line preset: how many upcoming lyrics may be previewed at once (1-8, default 3, i.e. a 4-row layout). Each gets its own permanently-assigned row; more rows are simultaneously populated only when the song's pace brings enough upcoming lines within previewLeadMs at once. */
  maxPreviewLines: number;
  /** Multi-line preset: how long (ms) an already-sung line may keep showing on its row to fill the gap before that row's next occupant needs it, instead of going blank; 0 disables lingering. Skipped for gaps long enough to warrant an interlude instead. */
  lingerMaxMs: number;
}

export interface PlanOverrideOptions {
  karaokeEffect?: KaraokeEffect;
  layout?: Partial<LayoutOptions>;
  interlude?: InterludeOptions;
  preset?: PlanPreset;
  styles?: PlanStylesOptions;
  mainLinePreRollMs?: number;
  previewLeadMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  maxPreviewLines?: number;
  lingerMaxMs?: number;
}

export interface SerializeOptions {
  /** Whether to emit the [Script Info] Title field from the LRC's `ti` metadata, when present. */
  includeMetadataComments?: boolean;
}

export type ParseOverrideOptions = Partial<ParseOptions>;

export interface ConvertOptions {
  parse?: ParseOverrideOptions;
  normalize?: NormalizeOptions;
  plan?: PlanOverrideOptions;
  serialize?: SerializeOptions;
}

export interface ConvertResult {
  ass: AssDocument;
  text: string;
  diagnostics: Diagnostic[];
}
