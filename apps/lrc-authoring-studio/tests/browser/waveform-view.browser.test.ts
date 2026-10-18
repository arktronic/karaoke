import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { WaveformView } from '../../src/ui/waveform-view';
import type { Project, SlotRef } from '../../src/core/types';

const WIDTH = 600;
const HEIGHT = 100;
// Default window is 10 s across 600 px, so 5 s sits at x = 300.
const MS_AT_300 = 5000;
const TOLERANCE_MS = 100;

const project: Project = {
  lines: [{ tokens: [{ text: 'Hello', spaceAfter: false, startMs: 5000, endMs: 8000 }] }],
};
const startRef: SlotRef = { line: 0, token: 0, kind: 'start' };

let canvas: HTMLCanvasElement;
let view: WaveformView;
const callbacks = { onSeek: vi.fn(), onMarkerSelect: vi.fn(), onMarkerMove: vi.fn() };

function pixel(x: number, y: number): [number, number, number] {
  const dpr = window.devicePixelRatio || 1;
  const data = canvas.getContext('2d')!.getImageData(x * dpr, y * dpr, 1, 1).data;
  return [data[0], data[1], data[2]];
}

function lastCallMs(spy: typeof callbacks.onSeek): number {
  return spy.mock.lastCall![0] as number;
}

beforeEach(() => {
  canvas = document.createElement('canvas');
  canvas.style.cssText = `display: block; width: ${WIDTH}px; height: ${HEIGHT}px`;
  document.body.replaceChildren(canvas);
  view = new WaveformView(canvas, callbacks);
});

afterEach(() => {
  canvas.remove();
  vi.clearAllMocks();
});

describe('WaveformView pointer input', () => {
  it('seeks to the clicked position', async () => {
    await userEvent.click(canvas, { position: { x: 300, y: 50 } });

    expect(Math.abs(lastCallMs(callbacks.onSeek) - MS_AT_300)).toBeLessThan(TOLERANCE_MS);
  });

  it('seeks relative to the zoom window', async () => {
    view.setWindowMs(5000);

    await userEvent.click(canvas, { position: { x: 300, y: 50 } });

    expect(Math.abs(lastCallMs(callbacks.onSeek) - 2500)).toBeLessThan(TOLERANCE_MS);
  });

  it('scrolls the view with the wheel', async () => {
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));

    await userEvent.click(canvas, { position: { x: 300, y: 50 } });

    expect(Math.abs(lastCallMs(callbacks.onSeek) - (MS_AT_300 + 1000))).toBeLessThan(TOLERANCE_MS);
  });

  it('does not scroll before the start of the track', async () => {
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));

    await userEvent.click(canvas, { position: { x: 300, y: 50 } });

    expect(Math.abs(lastCallMs(callbacks.onSeek) - MS_AT_300)).toBeLessThan(TOLERANCE_MS);
  });

  describe('while the playhead follows the pointer', () => {
    // Moving the playhead past 90% of the window would normally scroll the view.
    const followSeeks = (): void => {
      callbacks.onSeek.mockImplementation((ms: number) => view.setPlayhead(ms));
    };

    afterEach(() => {
      callbacks.onSeek.mockReset();
      callbacks.onMarkerSelect.mockReset();
    });

    it('keeps the position mapping fixed while scrubbing', async () => {
      followSeeks();

      await userEvent.dragAndDrop(canvas, canvas, {
        sourcePosition: { x: 570, y: 50 },
        targetPosition: { x: 580, y: 50 },
      });

      expect(Math.abs(lastCallMs(callbacks.onSeek) - 9667)).toBeLessThan(TOLERANCE_MS);
    });

    it('keeps the position mapping fixed while dragging a marker', async () => {
      view.setProject(project);
      callbacks.onMarkerSelect.mockImplementation(() => view.setPlayhead(15_000));

      await userEvent.dragAndDrop(canvas, canvas, {
        sourcePosition: { x: 300, y: 50 },
        targetPosition: { x: 420, y: 50 },
      });

      const [, ms] = callbacks.onMarkerMove.mock.lastCall!;
      expect(Math.abs(ms - 7000)).toBeLessThan(TOLERANCE_MS);
    });

    it('catches up with the playhead on release even if it no longer changes', async () => {
      followSeeks();
      await userEvent.dragAndDrop(canvas, canvas, {
        sourcePosition: { x: 570, y: 50 },
        targetPosition: { x: 580, y: 50 },
      });
      const playhead = lastCallMs(callbacks.onSeek);
      callbacks.onSeek.mockReset();

      await userEvent.click(canvas, { position: { x: 300, y: 50 } });

      // The view starts 10% of the window before the playhead.
      const expected = playhead - 1000 + MS_AT_300;
      expect(Math.abs(lastCallMs(callbacks.onSeek) - expected)).toBeLessThan(TOLERANCE_MS);
    });
  });

  describe('with a marker', () => {
    beforeEach(() => view.setProject(project));

    describe('panned away from a paused playhead', () => {
      // Three wheel steps start the view at 3 s, so the marker is at x = 120 and the playhead at 0 is offscreen.
      const VIEW_START_MS = 3000;

      beforeEach(() => {
        for (let step = 0; step < 3; step += 1) {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
        }
      });

      // The end marker sits at x = 300, so probe the mapping between the two markers.
      async function expectViewportKept(): Promise<void> {
        callbacks.onSeek.mockReset();
        await userEvent.click(canvas, { position: { x: 200, y: 50 } });
        expect(Math.abs(lastCallMs(callbacks.onSeek) - (VIEW_START_MS + 3333))).toBeLessThan(
          TOLERANCE_MS,
        );
      }

      it('keeps the viewport after selecting a marker', async () => {
        await userEvent.click(canvas, { position: { x: 120, y: 50 } });

        expect(callbacks.onMarkerSelect).toHaveBeenCalledWith(startRef);
        await expectViewportKept();
      });

      it('keeps the viewport after dragging a marker', async () => {
        await userEvent.dragAndDrop(canvas, canvas, {
          sourcePosition: { x: 120, y: 50 },
          targetPosition: { x: 240, y: 50 },
        });

        expect(callbacks.onMarkerMove).toHaveBeenCalled();
        await expectViewportKept();
      });
    });

    it('selects a marker clicked within its hit radius instead of seeking', async () => {
      await userEvent.click(canvas, { position: { x: 304, y: 50 } });

      expect(callbacks.onMarkerSelect).toHaveBeenCalledWith(startRef);
      expect(callbacks.onSeek).not.toHaveBeenCalled();
    });

    it('seeks when the click is outside the hit radius', async () => {
      await userEvent.click(canvas, { position: { x: 320, y: 50 } });

      expect(callbacks.onMarkerSelect).not.toHaveBeenCalled();
      expect(callbacks.onSeek).toHaveBeenCalled();
    });

    it('moves a dragged marker', async () => {
      await userEvent.dragAndDrop(canvas, canvas, {
        sourcePosition: { x: 300, y: 50 },
        targetPosition: { x: 420, y: 50 },
      });

      expect(callbacks.onMarkerMove).toHaveBeenCalled();
      const [ref, ms] = callbacks.onMarkerMove.mock.lastCall!;
      expect(ref).toEqual(startRef);
      expect(Math.abs(ms - 7000)).toBeLessThan(TOLERANCE_MS);
      expect(callbacks.onSeek).not.toHaveBeenCalled();
    });

    it('shows a resize cursor over a marker and a pointer elsewhere', async () => {
      await userEvent.hover(canvas, { position: { x: 300, y: 50 } });
      expect(canvas.style.cursor).toBe('ew-resize');

      await userEvent.hover(canvas, { position: { x: 100, y: 50 } });
      expect(canvas.style.cursor).toBe('pointer');
    });
  });
});

describe('WaveformView drawing', () => {
  const BACKGROUND = [20, 22, 26];

  it('draws the waveform from peaks', () => {
    view.setPeaks(new Float32Array(2000).fill(0.5), 100);
    view.render();

    expect(pixel(100, 50)).toEqual([91, 107, 125]);
    expect(pixel(100, 2)).toEqual(BACKGROUND);
  });

  it('draws start markers, end markers and the playhead', () => {
    view.setProject(project);
    view.setPlayhead(2000);
    view.render();

    expect(pixel(300, 90)).toEqual([74, 163, 255]);
    expect(pixel(480, 90)).toEqual([255, 107, 107]);
    expect(pixel(120, 90)).toEqual([255, 255, 255]);
  });

  it('highlights the selected marker', () => {
    view.setProject(project);
    view.setSelected(startRef);
    view.render();

    expect(pixel(300, 90)).toEqual([255, 210, 63]);
  });

  it('scrolls to keep the playhead visible', () => {
    view.setProject(project);
    view.setPlayhead(15_000);
    view.render();

    // The view starts 10% of the window before the playhead: (15 s - 1 s) puts it at x = 60.
    expect(pixel(60, 90)).toEqual([255, 255, 255]);
    expect(pixel(300, 90)).toEqual(BACKGROUND);
  });
});
