import type { AssStyle, LayoutOptions, PlanStyleOptions } from '../../types/index.js';
import { assColorFromHex } from '../color.js';

export function createStyle(
  name: string,
  layout: LayoutOptions,
  options: PlanStyleOptions,
): AssStyle {
  return {
    name,
    fontName: options.fontName ?? 'Arial',
    fontSize: options.fontSize ?? 28,
    primaryColor: assColorFromHex(options.primaryColor ?? '#FFFFFF'),
    secondaryColor: assColorFromHex(options.secondaryColor ?? '#808080'),
    outlineColor: assColorFromHex(options.outlineColor ?? '#000000'),
    backColor: assColorFromHex(options.backColor ?? '#000000', options.backOpacity ?? 0),
    shadow: options.shadow ?? 0,
    alignment: options.alignment ?? layout.alignment,
    marginLeft: options.marginLeft ?? layout.marginLeft,
    marginRight: options.marginRight ?? layout.marginRight,
    marginVertical: options.marginVertical ?? layout.marginVertical,
  };
}

export function alignmentTag(alignment: AssStyle['alignment']): string {
  return `{\\an${alignment}}`;
}

// The multi-line preset's rows share one evenly-spaced block: this is the offset from the block's
// anchored edge to its first row. For the default 2-row case, an8 (top row) measures it from the
// top edge and an2 (bottom row) measures it from the bottom edge, so this single value centers both
// rows toward/away from each other at once (twice as fast as either edge alone).
export function computeRowBlockTopMargin(
  resolutionY: number,
  rowHeightPx: number,
  rowCount: number,
): number {
  return Math.round((resolutionY - rowCount * rowHeightPx) / 2);
}
