import type { ParseOptions, PlanOptions } from '../types/index.js';

export const DEFAULT_PARSE_OPTIONS: ParseOptions = { mode: 'tolerant' };
export const DEFAULT_TRAILING_DURATION_MS = 5000;
export const DEFAULT_PROGRESS_BAR_Y_PX = 166;
export const DEFAULT_PROGRESS_BAR_HEIGHT_PX = 24;

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  karaokeEffect: 'sweep',
  preset: 'multi-line',
  mainLinePreRollMs: 1500,
  previewLeadMs: 4000,
  fadeInMs: 150,
  fadeOutMs: 300,
  maxPreviewLines: 3,
  lingerMaxMs: 5000,
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
    // Default 16:9 authoring space for wrap decisions.
    resolutionX: 512,
    resolutionY: 288,
    alignment: 2,
    marginLeft: 10,
    marginRight: 10,
    marginVertical: 10,
    rowHeightPx: 30,
  },
};
