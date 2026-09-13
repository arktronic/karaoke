import type { AssEvent } from '../../types/index.js';
import { assColorFromHex } from '../color.js';
import type { ResolvedPlanOptions } from './options.js';
import { resolveInterludeBounds } from './timing.js';

export const INTERLUDE_STYLE_NAME = 'Interlude';
const DEFAULT_INTERLUDE_TEXT = '♪ Instrumental ♪';
const PROGRESS_BAR_HEIGHT_PX = 24;
const PROGRESS_BAR_RADIUS_PX = 8;

// Drawing-mode (\p1) path for a rounded rectangle, local origin at its own top-left corner.
function roundedRectPath(width: number, height: number, radius: number): string {
  const r = radius;
  return (
    `m ${r} 0 l ${width - r} 0 b ${width} 0 ${width} 0 ${width} ${r} l ${width} ${height - r} ` +
    `b ${width} ${height} ${width} ${height} ${width - r} ${height} l ${r} ${height} ` +
    `b 0 ${height} 0 ${height} 0 ${height - r} l 0 ${r} b 0 0 0 0 ${r} 0`
  );
}

export function addInterludeEvents(
  events: AssEvent[],
  lyricEvents: AssEvent[],
  options: ResolvedPlanOptions,
): void {
  const interlude = options.interlude;
  if (!interlude || interlude.strategy === 'none') {
    return;
  }

  // Starts at 0 so a leading gap before the very first lyric (e.g. an instrumental intro) is detected too.
  let latestActiveEndMs = 0;
  for (const event of lyricEvents) {
    const bounds = resolveInterludeBounds(latestActiveEndMs, event.startMs, interlude);

    if (bounds) {
      const { startMs, endMs } = bounds;
      const style = interlude.style ?? INTERLUDE_STYLE_NAME;
      if (interlude.strategy === 'text') {
        events.push({ layer: 0, startMs, endMs, style, text: DEFAULT_INTERLUDE_TEXT });
      } else if (interlude.strategy === 'progress-bar') {
        const barLeft = options.layout.marginLeft;
        const barWidth =
          options.layout.resolutionX - options.layout.marginLeft - options.layout.marginRight;
        const barHeight = Math.min(PROGRESS_BAR_HEIGHT_PX, options.layout.resolutionY);
        const barTop = Math.round((options.layout.resolutionY - barHeight) / 2);
        const radius = Math.max(0, Math.min(PROGRESS_BAR_RADIUS_PX, barHeight / 2, barWidth / 2));
        const path = roundedRectPath(barWidth, barHeight, radius);
        const interludeStyleOptions = options.styles.interlude ?? {};
        const trackColor = assColorFromHex(interludeStyleOptions.secondaryColor ?? '#808080');
        const fillColor = assColorFromHex(interludeStyleOptions.primaryColor ?? '#FFFFFF');
        const borderColor = assColorFromHex(interludeStyleOptions.outlineColor ?? '#000000');
        events.push({
          layer: 0,
          startMs,
          endMs,
          style,
          text: `{\\p1\\an7\\pos(${barLeft},${barTop})\\shad0\\1c${trackColor}\\3c${borderColor}}${path}{\\p0}`,
        });
        events.push({
          layer: 1,
          startMs,
          endMs,
          style,
          text:
            `{\\p1\\an7\\pos(${barLeft},${barTop})\\shad0\\1c${fillColor}\\3c${borderColor}` +
            `\\clip(${barLeft},${barTop},${barLeft},${barTop + barHeight})` +
            `\\t(0,${endMs - startMs},\\clip(${barLeft},${barTop},${barLeft + barWidth},${barTop + barHeight}))}` +
            `${path}{\\p0}`,
        });
      } else {
        for (let countdownStartMs = startMs; countdownStartMs < endMs; countdownStartMs += 1000) {
          const countdownEndMs = Math.min(countdownStartMs + 1000, endMs);
          const secondsRemaining = Math.ceil((endMs - countdownStartMs) / 1000);
          events.push({
            layer: 0,
            startMs: countdownStartMs,
            endMs: countdownEndMs,
            style,
            text: String(secondsRemaining),
          });
        }
      }
    }

    latestActiveEndMs = Math.max(latestActiveEndMs, event.endMs);
  }
}
