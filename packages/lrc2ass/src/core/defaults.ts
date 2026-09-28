import type { ParseOptions, PlanOptions } from '../types/index.js';

export const DEFAULT_PARSE_OPTIONS: ParseOptions = { mode: 'tolerant' };
export const DEFAULT_TRAILING_DURATION_MS = 5000;
export const DEFAULT_PROGRESS_BAR_Y_PX = 622;
export const DEFAULT_PROGRESS_BAR_HEIGHT_PX = 90;
const DEFAULT_STYLE_FONT_SIZE = 105;

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  karaokeEffect: 'sweep',
  preset: 'multi-line',
  mainLinePreRollMs: 1500,
  previewLeadMs: 4000,
  fadeInMs: 150,
  fadeOutMs: 300,
  maxPreviewLines: 3,
  lingerMaxMs: 5000,
  styles: {
    lyrics: { fontSize: DEFAULT_STYLE_FONT_SIZE },
    preview: { fontSize: DEFAULT_STYLE_FONT_SIZE },
    interlude: { fontSize: DEFAULT_STYLE_FONT_SIZE },
  },
  interlude: {
    minGapMs: 8000,
    strategy: 'progress-bar',
    marginMs: 500,
    progressBarY: DEFAULT_PROGRESS_BAR_Y_PX,
    progressBarHeightPx: DEFAULT_PROGRESS_BAR_HEIGHT_PX,
    trailingLyricDurationMs: 5000,
    blankGapMs: 3000,
  },
  layout: {
    // Match the default 1080p output so ASS coordinates map directly to output pixels.
    resolutionX: 1920,
    resolutionY: 1080,
    alignment: 2,
    marginLeft: 38,
    marginRight: 38,
    marginVertical: 38,
    rowHeightPx: 112,
  },
};
