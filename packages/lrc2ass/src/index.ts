export * from './types/index.js';

export { parseLrc } from './core/parser.js';
export { normalizeLyrics } from './core/normalizer.js';
export { planEvents } from './core/planner.js';
export { serializeAss } from './core/serializer.js';
export { assColorFromHex } from './core/color.js';
export {
  DEFAULT_PARSE_OPTIONS,
  DEFAULT_PLAN_OPTIONS,
  DEFAULT_TRAILING_DURATION_MS,
} from './core/defaults.js';
export { convert } from './core/convert.js';
export { resolveAndValidatePlanOptions } from './core/planning/options.js';
