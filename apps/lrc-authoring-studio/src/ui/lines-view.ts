import { formatClock } from '../core/time';
import type { Project, SlotRef, TokenRef } from '../core/types';

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
  private selected: SlotRef | undefined;
  private cursor: TokenRef | undefined;
  private active: TokenRef | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: LinesCallbacks,
    /** Viewport y below which content is not covered by sticky UI. */
    private readonly topInset: () => number = () => 0,
  ) {}

  render(project: Project): void {
    this.lineEls = [];
    this.chips = [];
    const fragment = document.createDocumentFragment();

    project.lines.forEach((line, lineIndex) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'line';
      const number = document.createElement('span');
      number.className = 'line-no';
      number.textContent = String(lineIndex + 1);
      lineEl.append(number);

      const lineChips: TokenChips[] = [];
      line.tokens.forEach((token, tokenIndex) => {
        const start = this.createChip(
          token.text,
          token.startMs,
          { line: lineIndex, token: tokenIndex, kind: 'start' },
          false,
        );
        const chips: TokenChips = { start };
        lineEl.append(start);
        if (token.endMs !== undefined) {
          chips.end = this.createChip(
            'end',
            token.endMs,
            { line: lineIndex, token: tokenIndex, kind: 'end' },
            true,
          );
          lineEl.append(chips.end);
        }
        lineChips.push(chips);
      });
      this.lineEls.push(lineEl);
      this.chips.push(lineChips);
      fragment.append(lineEl);
    });

    this.root.replaceChildren(fragment);
    this.reapplyMarks();
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

  private markSelected(on: boolean): void {
    const ref = this.selected;
    const chips = ref && this.chips[ref.line]?.[ref.token];
    (ref?.kind === 'end' ? chips?.end : chips?.start)?.classList.toggle('selected', on);
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
