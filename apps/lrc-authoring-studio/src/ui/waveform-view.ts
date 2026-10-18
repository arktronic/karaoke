import type { Project, SlotRef } from '../core/types';

export interface WaveformCallbacks {
  onSeek(ms: number): void;
  onMarkerSelect(ref: SlotRef): void;
  onMarkerMove(ref: SlotRef, ms: number): void;
}

interface Marker {
  ref: SlotRef;
  ms: number;
  label: string;
}

const HIT_RADIUS_PX = 6;
const COLORS = {
  background: '#14161a',
  wave: '#5b6b7d',
  token: '#4aa3ff',
  end: '#ff6b6b',
  selected: '#ffd23f',
  playhead: '#ffffff',
  label: '#c9d1d9',
};

export class WaveformView {
  private readonly context: CanvasRenderingContext2D;
  private peaks: Float32Array | undefined;
  private peaksPerSecond = 100;
  private markers: Marker[] = [];
  private selected: SlotRef | undefined;
  private playheadMs = 0;
  private windowMs = 10_000;
  private viewStartMs = 0;
  private dirty = true;
  private cssWidth = 0;
  private cssHeight = 0;
  private drag: { ref?: SlotRef } | undefined;
  private playheadMovedDuringDrag = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: WaveformCallbacks,
  ) {
    this.context = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', () => this.endDrag());
    canvas.addEventListener('pointercancel', () => this.endDrag());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.resize();
  }

  setPeaks(peaks: Float32Array | undefined, peaksPerSecond: number): void {
    this.peaks = peaks;
    this.peaksPerSecond = peaksPerSecond;
    this.dirty = true;
  }

  setProject(project: Project): void {
    this.markers = [];
    project.lines.forEach((line, lineIndex) => {
      line.tokens.forEach((token, tokenIndex) => {
        if (token.startMs !== undefined) {
          this.markers.push({
            ref: { line: lineIndex, token: tokenIndex, kind: 'start' },
            ms: token.startMs,
            label: token.text,
          });
        }
        if (token.endMs !== undefined) {
          this.markers.push({
            ref: { line: lineIndex, token: tokenIndex, kind: 'end' },
            ms: token.endMs,
            label: '',
          });
        }
      });
    });
    this.dirty = true;
  }

  setSelected(ref: SlotRef | undefined): void {
    this.selected = ref;
    this.dirty = true;
  }

  setWindowMs(ms: number): void {
    this.windowMs = ms;
    this.reveal(this.playheadMs);
    this.dirty = true;
  }

  /** Moves the playhead and scrolls the view when the playhead leaves it. */
  setPlayhead(ms: number): void {
    if (ms === this.playheadMs) {
      return;
    }
    this.playheadMs = ms;
    this.playheadMovedDuringDrag ||= this.drag !== undefined;
    this.reveal(ms);
    this.dirty = true;
  }

  /** Scrolls the view to include `ms`; does nothing during a pointer drag so the mapping stays put. */
  reveal(ms: number): void {
    if (this.drag) {
      return;
    }
    if (ms < this.viewStartMs || ms > this.viewStartMs + this.windowMs * 0.9) {
      this.viewStartMs = Math.max(0, ms - this.windowMs * 0.1);
      this.dirty = true;
    }
  }

  render(): void {
    if (!this.dirty || this.cssWidth === 0) {
      return;
    }
    this.dirty = false;
    const ctx = this.context;
    const width = this.cssWidth;
    const height = this.cssHeight;
    const msPerPx = this.windowMs / width;
    const mid = height / 2;

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    if (this.peaks) {
      ctx.fillStyle = COLORS.wave;
      for (let x = 0; x < width; x += 1) {
        const first = Math.floor(((this.viewStartMs + x * msPerPx) / 1000) * this.peaksPerSecond);
        const last = Math.max(
          first,
          Math.ceil(((this.viewStartMs + (x + 1) * msPerPx) / 1000) * this.peaksPerSecond) - 1,
        );
        let peak = 0;
        for (let i = Math.max(first, 0); i <= last && i < this.peaks.length; i += 1) {
          peak = Math.max(peak, this.peaks[i]);
        }
        const h = peak * mid * 0.95;
        ctx.fillRect(x, mid - h, 1, Math.max(1, h * 2));
      }
    }

    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'top';
    let labelEnd = 0;
    for (const marker of this.markers) {
      const x = (marker.ms - this.viewStartMs) / msPerPx;
      if (x < -1 || x > width + 1) {
        continue;
      }
      const isSelected = this.isSelected(marker.ref);
      ctx.fillStyle = isSelected
        ? COLORS.selected
        : marker.ref.kind === 'end'
          ? COLORS.end
          : COLORS.token;
      ctx.fillRect(Math.round(x) - (isSelected ? 1 : 0), 0, isSelected ? 3 : 1, height);
      if (marker.label && x >= labelEnd) {
        ctx.fillStyle = COLORS.label;
        ctx.fillText(marker.label, x + 4, 4);
        labelEnd = x + 4 + ctx.measureText(marker.label).width + 4;
      }
    }

    const playheadX = (this.playheadMs - this.viewStartMs) / msPerPx;
    if (playheadX >= 0 && playheadX <= width) {
      ctx.fillStyle = COLORS.playhead;
      ctx.fillRect(Math.round(playheadX), 0, 1, height);
    }
  }

  private isSelected(ref: SlotRef): boolean {
    return (
      this.selected?.line === ref.line &&
      this.selected.token === ref.token &&
      this.selected.kind === ref.kind
    );
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = this.canvas.clientWidth;
    this.cssHeight = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  private xToMs(clientX: number): number {
    const rect = this.canvas.getBoundingClientRect();
    return Math.max(0, this.viewStartMs + ((clientX - rect.left) / rect.width) * this.windowMs);
  }

  private markerAt(clientX: number): Marker | undefined {
    const rect = this.canvas.getBoundingClientRect();
    const msPerPx = this.windowMs / rect.width;
    let best: Marker | undefined;
    let bestDistance = HIT_RADIUS_PX * msPerPx;
    for (const marker of this.markers) {
      const distance = Math.abs(marker.ms - this.xToMs(clientX));
      if (distance <= bestDistance) {
        best = marker;
        bestDistance = distance;
      }
    }
    return best;
  }

  private endDrag(): void {
    this.drag = undefined;
    if (this.playheadMovedDuringDrag) {
      this.playheadMovedDuringDrag = false;
      this.reveal(this.playheadMs);
    }
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.playheadMovedDuringDrag = false;
    const hit = this.markerAt(e.clientX);
    if (hit) {
      this.drag = { ref: hit.ref };
      this.callbacks.onMarkerSelect(hit.ref);
    } else {
      this.drag = {};
      this.callbacks.onSeek(this.xToMs(e.clientX));
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drag) {
      this.canvas.style.cursor = this.markerAt(e.clientX) ? 'ew-resize' : 'pointer';
      return;
    }
    if (this.drag.ref) {
      this.callbacks.onMarkerMove(this.drag.ref, this.xToMs(e.clientX));
    } else {
      this.callbacks.onSeek(this.xToMs(e.clientX));
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const delta = Math.sign(e.deltaY || e.deltaX) * this.windowMs * 0.1;
    this.viewStartMs = Math.max(0, this.viewStartMs + delta);
    this.dirty = true;
  }
}
