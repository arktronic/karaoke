import type {
  LayoutOptions,
  PlanOptions,
  PlanOverrideOptions,
  PlanPreset,
  PlanStyleOptions,
  PlanStylesOptions,
} from '../../types/index.js';
import { assColorFromHex } from '../color.js';

/** Hard cap on maxPreviewLines; keeps the multi-line preset's row stack to a sane, readable size. */
export const MAX_PREVIEW_LINES_CAP = 8;

export interface ResolvedPlanOptions extends PlanOptions {
  layout: LayoutOptions;
  preset: PlanPreset;
  styles: PlanStylesOptions;
}

interface PlanPresetDefaults {
  showPreview: boolean;
  styles: PlanStylesOptions;
}

export const PLAN_PRESETS: Readonly<Record<PlanPreset, PlanPresetDefaults>> = Object.freeze({
  'single-line': Object.freeze({
    showPreview: false,
    styles: Object.freeze({
      lyrics: Object.freeze({
        fontName: 'Arial',
        fontSize: 28,
        primaryColor: '#FFFFFF',
        secondaryColor: '#808080',
        outlineColor: '#000000',
        backColor: '#000000',
        backOpacity: 0,
      }),
      preview: Object.freeze({
        fontName: 'Arial',
        fontSize: 28,
        primaryColor: '#C0C0C0',
        secondaryColor: '#808080',
        outlineColor: '#000000',
        backColor: '#000000',
        backOpacity: 0,
        alignment: 8,
      }),
      interlude: Object.freeze({
        fontName: 'Arial',
        fontSize: 28,
        primaryColor: '#FFFFFF',
        secondaryColor: '#808080',
        outlineColor: '#000000',
        backColor: '#000000',
        backOpacity: 0,
      }),
    }),
  }),
  'multi-line': Object.freeze({
    showPreview: true,
    styles: Object.freeze({
      lyrics: Object.freeze({
        fontName: 'Arial',
        fontSize: 28,
        primaryColor: '#FFFFFF',
        secondaryColor: '#808080',
        outlineColor: '#FF0000',
        backColor: '#000000',
        backOpacity: 0.8,
        shadow: 6,
      }),
      preview: Object.freeze({
        fontName: 'Arial',
        fontSize: 28,
        primaryColor: '#C0C0C0',
        secondaryColor: '#808080',
        outlineColor: '#0000FF',
        backColor: '#000000',
        backOpacity: 0.8,
        shadow: 6,
        alignment: 8,
      }),
      interlude: Object.freeze({
        fontName: 'Arial',
        fontSize: 28,
        primaryColor: '#FFFFFF',
        secondaryColor: '#808080',
        outlineColor: '#000000',
        backColor: '#000000',
        // Row alternation means Preview can land on either row, so Interlude stays centered to avoid both.
        alignment: 5,
        backOpacity: 0.8,
        shadow: 6,
      }),
    }),
  }),
});

function definedLayoutOverrides(
  overrides: Partial<LayoutOptions> | undefined,
): Partial<LayoutOptions> {
  if (!overrides) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<LayoutOptions>;
}

function definedInterludeOverrides(
  overrides: PlanOverrideOptions['interlude'],
): Partial<NonNullable<PlanOptions['interlude']>> {
  if (!overrides) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<NonNullable<PlanOptions['interlude']>>;
}

function mergeStyleOptions(...styles: Array<PlanStyleOptions | undefined>): PlanStyleOptions {
  return Object.assign(
    {},
    ...styles.map((style) => {
      if (!style) {
        return {};
      }
      return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined));
    }),
  );
}

function resolveStyles(
  presetStyles: PlanStylesOptions,
  baseStyles: PlanStylesOptions | undefined,
  overrideStyles: PlanStylesOptions | undefined,
): PlanStylesOptions {
  return {
    lyrics: mergeStyleOptions(presetStyles.lyrics, baseStyles?.lyrics, overrideStyles?.lyrics),
    preview: mergeStyleOptions(presetStyles.preview, baseStyles?.preview, overrideStyles?.preview),
    interlude: mergeStyleOptions(
      presetStyles.interlude,
      baseStyles?.interlude,
      overrideStyles?.interlude,
    ),
  };
}

export function resolvePlanOptions(
  baseOptions: PlanOptions,
  overrides: PlanOverrideOptions | undefined,
): ResolvedPlanOptions {
  const preset = overrides?.preset ?? baseOptions.preset ?? 'single-line';
  const presetDefaults = PLAN_PRESETS[preset];
  if (!presetDefaults) {
    throw new RangeError(
      `preset must be "single-line" or "multi-line", received ${String(preset)}`,
    );
  }
  const interlude = baseOptions.interlude
    ? { ...baseOptions.interlude, ...definedInterludeOverrides(overrides?.interlude) }
    : overrides?.interlude;
  return {
    ...baseOptions,
    karaokeEffect: overrides?.karaokeEffect ?? baseOptions.karaokeEffect,
    mainLinePreRollMs: overrides?.mainLinePreRollMs ?? baseOptions.mainLinePreRollMs,
    previewLeadMs: overrides?.previewLeadMs ?? baseOptions.previewLeadMs,
    fadeInMs: overrides?.fadeInMs ?? baseOptions.fadeInMs,
    fadeOutMs: overrides?.fadeOutMs ?? baseOptions.fadeOutMs,
    maxPreviewLines: overrides?.maxPreviewLines ?? baseOptions.maxPreviewLines,
    lingerMaxMs: overrides?.lingerMaxMs ?? baseOptions.lingerMaxMs,
    interlude,
    preset,
    layout: {
      ...baseOptions.layout,
      ...definedLayoutOverrides(overrides?.layout),
    },
    styles: resolveStyles(presetDefaults.styles, baseOptions.styles, overrides?.styles),
  };
}

export function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, received ${value}`);
  }
}

export function assertAlignment(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 9) {
    throw new RangeError(`${name} must be an ASS alignment from 1 to 9, received ${value}`);
  }
}

function assertStyleOptions(styles: PlanStyleOptions, role: string): void {
  if (styles.fontName !== undefined && !/^[^,\r\n]+$/.test(styles.fontName)) {
    throw new RangeError(
      `${role}.fontName must be non-empty and cannot contain commas or line breaks`,
    );
  }
  if (
    styles.fontSize !== undefined &&
    (!Number.isFinite(styles.fontSize) || styles.fontSize <= 0)
  ) {
    throw new RangeError(
      `${role}.fontSize must be a positive finite number, received ${styles.fontSize}`,
    );
  }
  if (styles.alignment !== undefined) {
    assertAlignment(styles.alignment, `${role}.alignment`);
  }
  for (const margin of ['marginLeft', 'marginRight', 'marginVertical'] as const) {
    if (styles[margin] !== undefined) {
      assertNonNegativeSafeInteger(styles[margin], `${role}.${margin}`);
    }
  }
  if (
    styles.backOpacity !== undefined &&
    (!Number.isFinite(styles.backOpacity) || styles.backOpacity < 0 || styles.backOpacity > 1)
  ) {
    throw new RangeError(
      `${role}.backOpacity must be between 0 and 1, received ${styles.backOpacity}`,
    );
  }
  if (styles.shadow !== undefined && (!Number.isFinite(styles.shadow) || styles.shadow < 0)) {
    throw new RangeError(
      `${role}.shadow must be a non-negative finite number, received ${styles.shadow}`,
    );
  }
  for (const color of ['primaryColor', 'secondaryColor', 'outlineColor', 'backColor'] as const) {
    if (styles[color] !== undefined) {
      assColorFromHex(styles[color]);
    }
  }
}

export function assertPlanOptions(options: ResolvedPlanOptions): void {
  if (!['none', 'instant', 'sweep', 'sweep-outline'].includes(options.karaokeEffect)) {
    throw new RangeError(`karaokeEffect is invalid: ${String(options.karaokeEffect)}`);
  }
  assertNonNegativeSafeInteger(options.mainLinePreRollMs, 'mainLinePreRollMs');
  assertNonNegativeSafeInteger(options.previewLeadMs, 'previewLeadMs');
  assertNonNegativeSafeInteger(options.fadeInMs, 'fadeInMs');
  assertNonNegativeSafeInteger(options.fadeOutMs, 'fadeOutMs');
  if (
    !Number.isInteger(options.maxPreviewLines) ||
    options.maxPreviewLines < 1 ||
    options.maxPreviewLines > MAX_PREVIEW_LINES_CAP
  ) {
    throw new RangeError(
      `maxPreviewLines must be an integer from 1 to ${MAX_PREVIEW_LINES_CAP}, received ${options.maxPreviewLines}`,
    );
  }
  assertNonNegativeSafeInteger(options.lingerMaxMs, 'lingerMaxMs');
  if (!Number.isSafeInteger(options.layout.resolutionX) || options.layout.resolutionX <= 0) {
    throw new RangeError(
      `layout.resolutionX must be a positive safe integer, received ${options.layout.resolutionX}`,
    );
  }
  if (!Number.isSafeInteger(options.layout.resolutionY) || options.layout.resolutionY <= 0) {
    throw new RangeError(
      `layout.resolutionY must be a positive safe integer, received ${options.layout.resolutionY}`,
    );
  }
  assertAlignment(options.layout.alignment, 'layout.alignment');
  for (const margin of ['marginLeft', 'marginRight', 'marginVertical'] as const) {
    assertNonNegativeSafeInteger(options.layout[margin], `layout.${margin}`);
  }
  if (options.layout.marginLeft + options.layout.marginRight >= options.layout.resolutionX) {
    throw new RangeError(
      `layout.marginLeft + layout.marginRight must be less than layout.resolutionX, received ` +
        `${options.layout.marginLeft} + ${options.layout.marginRight} >= ${options.layout.resolutionX}`,
    );
  }
  if (!Number.isSafeInteger(options.layout.rowHeightPx) || options.layout.rowHeightPx <= 0) {
    throw new RangeError(
      `layout.rowHeightPx must be a positive safe integer, received ${options.layout.rowHeightPx}`,
    );
  }
  if (options.layout.rowAlignment !== undefined) {
    assertAlignment(options.layout.rowAlignment, 'layout.rowAlignment');
  }
  if (PLAN_PRESETS[options.preset].showPreview) {
    const rowCount = options.maxPreviewLines + 1;
    const rowBlockHeight = rowCount * options.layout.rowHeightPx;
    if (rowBlockHeight >= options.layout.resolutionY) {
      throw new RangeError(
        `The multi-line row block (maxPreviewLines + 1 = ${rowCount} rows * layout.rowHeightPx ` +
          `${options.layout.rowHeightPx} = ${rowBlockHeight}) must be strictly less than layout.resolutionY ` +
          `(an exact fit would produce a top row MarginV of 0, which ASS treats as "no override"), ` +
          `received ${options.layout.resolutionY}`,
      );
    }
    const rowAlignment =
      options.layout.rowAlignment ?? options.styles.preview?.alignment ?? options.layout.alignment;
    if (rowAlignment >= 4 && rowAlignment <= 6) {
      throw new RangeError(
        `layout.rowAlignment must be a top or bottom ASS alignment (1-3 or 7-9); middle alignments ` +
          `(4-6) ignore MarginV, so distinct rows would collapse onto the same vertical position, ` +
          `received ${rowAlignment}`,
      );
    }
  }
  assertStyleOptions(options.styles.lyrics ?? {}, 'styles.lyrics');
  assertStyleOptions(options.styles.preview ?? {}, 'styles.preview');
  assertStyleOptions(options.styles.interlude ?? {}, 'styles.interlude');

  if (!options.interlude) {
    return;
  }
  assertNonNegativeSafeInteger(options.interlude.minGapMs, 'interlude.minGapMs');
  if (options.interlude.marginMs !== undefined) {
    assertNonNegativeSafeInteger(options.interlude.marginMs, 'interlude.marginMs');
  }
  if (options.interlude.trailingLyricDurationMs !== undefined) {
    assertNonNegativeSafeInteger(
      options.interlude.trailingLyricDurationMs,
      'interlude.trailingLyricDurationMs',
    );
  }
  if (options.interlude.blankGapMs !== undefined) {
    assertNonNegativeSafeInteger(options.interlude.blankGapMs, 'interlude.blankGapMs');
  }
  if (!['none', 'text', 'countdown', 'progress-bar'].includes(options.interlude.strategy)) {
    throw new RangeError(`interlude.strategy is invalid: ${String(options.interlude.strategy)}`);
  }
  if (options.interlude.style !== undefined && !/^[^,\r\n]+$/.test(options.interlude.style)) {
    throw new RangeError(
      'interlude.style must be non-empty and cannot contain commas or line breaks',
    );
  }
}
