import { formatClock } from '../core/time';
import type { Line, Project, SlotRef, TokenRef } from '../core/types';

export interface LinesCallbacks {
  onSelect(ref: SlotRef): void;
  onSetCursor(ref: TokenRef): void;
}

interface TokenChips {
  start: HTMLElement;
  end?: HTMLElement;
}

function sameToken(a: TokenRef | undefined, b: TokenRef | undefined): boolean {
  return a?.line === b?.line && a?.token === b?.token;
}

export class LinesView {
  private lineEls: HTMLElement[] = [];
  private chips: TokenChips[][] = [];
  private texts: string[][] = [];
  private selected: SlotRef | undefined;
  private cursor: TokenRef | undefined;
  private active: TokenRef | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: LinesCallbacks,
    /** Viewport y below which content is not covered by sticky UI. */
    private readonly topInset: () => number = () => 0,
  ) {}

  /**
   * Lines whose words are unchanged keep their elements and only get new times, so a click in
   * progress still lands on its chip. Other lines are rebuilt.
   */
  render(project: Project): void {
    const focused = this.focusedSlot();

    project.lines.forEach((line, lineIndex) => {
      const texts = line.tokens.map((token) => token.text);
      const same =
        this.texts[lineIndex]?.length === texts.length &&
        this.texts[lineIndex].every((text, i) => text === texts[i]);
      if (same) {
        this.updateLine(lineIndex, line);
        return;
      }
      const { lineEl, lineChips } = this.createLine(line, lineIndex);
      if (this.lineEls[lineIndex]) {
        this.lineEls[lineIndex].replaceWith(lineEl);
      } else {
        this.root.append(lineEl);
      }
      this.lineEls[lineIndex] = lineEl;
      this.chips[lineIndex] = lineChips;
      this.texts[lineIndex] = texts;
    });

    const count = project.lines.length;
    this.lineEls.splice(count).forEach((lineEl) => lineEl.remove());
    this.chips.length = count;
    this.texts.length = count;

    this.reapplyMarks();
    if (focused) {
      this.chipFor(focused)?.focus({ preventScroll: true });
    }
  }

  setSelected(ref: SlotRef | undefined): void {
    this.markSelected(false);
    this.selected = ref;
    this.markSelected(true);
  }

  setCursor(ref: TokenRef | undefined): void {
    this.markCursor(false);
    this.cursor = ref;
    this.markCursor(true);
    if (ref) {
      this.scrollToLine(ref.line);
    }
  }

  /** Highlights the token being sung and dims the ones already sung on its line. */
  setActive(ref: TokenRef | undefined, scroll: boolean): void {
    if (sameToken(ref, this.active)) {
      return;
    }
    const previous = this.active;
    this.active = ref;
    if (previous) {
      this.setLineActive(previous.line, undefined);
    }
    if (ref) {
      this.setLineActive(ref.line, ref.token);
      if (scroll && previous?.line !== ref.line) {
        this.scrollToLine(ref.line);
      }
    }
  }

  /**
   * Scrolls so the line and the one after it are fully visible, within the box and the window.
   * The box is scrolled first, then the page if the box is partly on screen.
   */
  scrollToLine(lineIndex: number): void {
    const lineEl = this.lineEls[lineIndex];
    if (!lineEl) {
      return;
    }
    const ahead = this.lineEls[lineIndex + 1] ?? lineEl;
    const inset = Math.max(0, this.topInset());
    const box = this.root.getBoundingClientRect();
    const onScreen = box.bottom > inset && box.top < window.innerHeight;
    const top = onScreen ? Math.max(box.top, inset) : box.top;
    const bottom = onScreen ? Math.min(box.bottom, window.innerHeight) : box.bottom;

    const line = lineEl.getBoundingClientRect();
    if (line.top < top || ahead.getBoundingClientRect().bottom > bottom) {
      this.root.scrollTop += line.top - top - (bottom - top) / 3;
    }
    if (!onScreen) {
      return;
    }

    const lineTop = lineEl.getBoundingClientRect().top;
    const aheadBottom = ahead.getBoundingClientRect().bottom;
    const shift =
      aheadBottom > window.innerHeight
        ? Math.min(aheadBottom - window.innerHeight, lineTop - inset)
        : Math.min(0, lineTop - inset);
    if (shift !== 0) {
      window.scrollBy(0, shift);
    }
  }

  private createLine(
    line: Line,
    lineIndex: number,
  ): { lineEl: HTMLElement; lineChips: TokenChips[] } {
    const lineEl = document.createElement('div');
    lineEl.className = 'line';
    const number = document.createElement('span');
    number.className = 'line-no';
    number.textContent = String(lineIndex + 1);
    lineEl.append(number);

    const lineChips = line.tokens.map((token, tokenIndex): TokenChips => {
      const start = this.createChip(
        token.text,
        token.startMs,
        { line: lineIndex, token: tokenIndex, kind: 'start' },
        false,
      );
      lineEl.append(start);
      const chips: TokenChips = { start };
      if (token.endMs !== undefined) {
        chips.end = this.createEndChip(lineIndex, tokenIndex, token.endMs);
        lineEl.append(chips.end);
      }
      return chips;
    });
    return { lineEl, lineChips };
  }

  private updateLine(lineIndex: number, line: Line): void {
    line.tokens.forEach((token, tokenIndex) => {
      const chips = this.chips[lineIndex][tokenIndex];
      this.setStamp(chips.start, token.startMs);
      if (token.endMs === undefined) {
        chips.end?.remove();
        delete chips.end;
      } else if (chips.end) {
        this.setStamp(chips.end, token.endMs);
      } else {
        chips.end = this.createEndChip(lineIndex, tokenIndex, token.endMs);
        chips.start.after(chips.end);
      }
    });
  }

  private createEndChip(line: number, token: number, time: number): HTMLElement {
    return this.createChip('end', time, { line, token, kind: 'end' }, true);
  }

  private setStamp(chip: HTMLElement, time: number | undefined): void {
    chip.classList.toggle('timed', time !== undefined);
    chip.querySelector('.chip-time')!.textContent = time === undefined ? '-' : formatClock(time);
  }

  private createChip(
    label: string,
    time: number | undefined,
    ref: SlotRef,
    isEnd: boolean,
  ): HTMLElement {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${isEnd ? ' end' : ''}${time === undefined ? '' : ' timed'}`;
    const text = document.createElement('span');
    text.className = 'chip-text';
    text.textContent = label;
    const stamp = document.createElement('span');
    stamp.className = 'chip-time';
    stamp.textContent = time === undefined ? '-' : formatClock(time);
    chip.append(text, stamp);
    chip.addEventListener('click', () => this.callbacks.onSelect(ref));
    chip.addEventListener('dblclick', () => this.callbacks.onSetCursor(ref));
    return chip;
  }

  private setLineActive(lineIndex: number, token: number | undefined): void {
    this.lineEls[lineIndex]?.classList.toggle('active-line', token !== undefined);
    this.chips[lineIndex]?.forEach(({ start }, i) => {
      start.classList.toggle('sung', token !== undefined && i <= token);
      start.classList.toggle('active', token === i);
    });
  }

  private focusedSlot(): SlotRef | undefined {
    const focus = document.activeElement;
    if (!focus || !this.root.contains(focus)) {
      return undefined;
    }
    for (const [line, lineChips] of this.chips.entries()) {
      for (const [token, { start, end }] of lineChips.entries()) {
        if (focus === start) {
          return { line, token, kind: 'start' };
        }
        if (focus === end) {
          return { line, token, kind: 'end' };
        }
      }
    }
    return undefined;
  }

  private chipFor(ref: SlotRef): HTMLElement | undefined {
    const chips = this.chips[ref.line]?.[ref.token];
    return ref.kind === 'end' ? chips?.end : chips?.start;
  }

  private markSelected(on: boolean): void {
    const ref = this.selected;
    if (ref) {
      this.chipFor(ref)?.classList.toggle('selected', on);
    }
  }

  private markCursor(on: boolean): void {
    const ref = this.cursor;
    if (ref) {
      this.chips[ref.line]?.[ref.token]?.start.classList.toggle('cursor', on);
    }
  }

  private reapplyMarks(): void {
    this.markSelected(true);
    this.markCursor(true);
    const active = this.active;
    this.active = undefined;
    this.setActive(active, false);
  }
}
