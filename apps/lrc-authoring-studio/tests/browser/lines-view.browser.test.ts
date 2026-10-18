import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { LinesView } from '../../src/ui/lines-view';
import type { Project } from '../../src/core/types';

const project: Project = {
  lines: [
    {
      tokens: [
        { text: 'Hello', spaceAfter: true, startMs: 1000, endMs: 1400 },
        { text: 'world', spaceAfter: false, startMs: 2500 },
      ],
    },
    { tokens: [{ text: 'again', spaceAfter: false }] },
  ],
};

let root: HTMLElement;
let view: LinesView;
const onSelect = vi.fn();
const onSetCursor = vi.fn();

const chip = (line: number, text: string): HTMLElement =>
  [...document.querySelectorAll('.line')[line].querySelectorAll<HTMLElement>('.chip')].find(
    (c) => c.querySelector('.chip-text')?.textContent === text,
  )!;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  view = new LinesView(root, { onSelect, onSetCursor });
  view.render(project);
});

afterEach(() => {
  root.remove();
  vi.clearAllMocks();
});

describe('LinesView', () => {
  it('renders numbered lines with a chip per token and an extra chip per word end', () => {
    expect([...root.querySelectorAll('.line-no')].map((n) => n.textContent)).toEqual(['1', '2']);
    expect(root.querySelectorAll('.chip')).toHaveLength(4);
    expect(root.querySelectorAll('.chip.end')).toHaveLength(1);
  });

  it('shows clock times for timed chips and a dash for untimed ones', () => {
    const time = (c: HTMLElement): string | null | undefined =>
      c.querySelector('.chip-time')?.textContent;

    expect(time(chip(0, 'Hello'))).toBe('0:01.000');
    expect(time(chip(0, 'end'))).toBe('0:01.400');
    expect(time(chip(1, 'again'))).toBe('-');
    expect(chip(0, 'Hello').classList.contains('timed')).toBe(true);
    expect(chip(1, 'again').classList.contains('timed')).toBe(false);
  });

  it('reports the slot of a clicked chip', async () => {
    await userEvent.click(chip(0, 'end'));

    expect(onSelect).toHaveBeenCalledWith({ line: 0, token: 0, kind: 'end' });
  });

  it('reports the token of a double-clicked chip', async () => {
    await userEvent.dblClick(chip(0, 'world'));

    expect(onSetCursor).toHaveBeenCalledWith({ line: 0, token: 1, kind: 'start' });
  });

  it('marks the selected chip and moves the mark', () => {
    view.setSelected({ line: 0, token: 1, kind: 'start' });
    expect(chip(0, 'world').classList.contains('selected')).toBe(true);

    view.setSelected({ line: 0, token: 0, kind: 'end' });
    expect(chip(0, 'world').classList.contains('selected')).toBe(false);
    expect(chip(0, 'end').classList.contains('selected')).toBe(true);
  });

  it('marks the cursor chip and clears it', () => {
    view.setCursor({ line: 1, token: 0 });
    expect(chip(1, 'again').classList.contains('cursor')).toBe(true);

    view.setCursor(undefined);
    expect(chip(1, 'again').classList.contains('cursor')).toBe(false);
  });

  it('highlights the active token and dims the ones already sung', () => {
    view.setActive({ line: 0, token: 1 }, false);

    expect(chip(0, 'world').classList.contains('active')).toBe(true);
    expect(chip(0, 'Hello').classList.contains('sung')).toBe(true);
    expect(chip(0, 'Hello').classList.contains('active')).toBe(false);
    expect(root.querySelector('.line')?.classList.contains('active-line')).toBe(true);

    view.setActive(undefined, false);
    expect(root.querySelector('.sung, .active, .active-line')).toBeNull();
  });

  it('keeps selection, cursor and active marks across a re-render', () => {
    view.setSelected({ line: 0, token: 0, kind: 'start' });
    view.setCursor({ line: 1, token: 0 });
    view.setActive({ line: 0, token: 1 }, false);

    view.render(project);

    expect(chip(0, 'Hello').classList.contains('selected')).toBe(true);
    expect(chip(1, 'again').classList.contains('cursor')).toBe(true);
    expect(chip(0, 'world').classList.contains('active')).toBe(true);
  });

  describe('focus across a re-render', () => {
    it('returns to the replacement of the focused start chip', () => {
      chip(0, 'world').focus();

      view.render(project);

      expect(document.activeElement).toBe(chip(0, 'world'));
    });

    it('returns to the replacement of the focused end chip', () => {
      chip(0, 'end').focus();

      view.render(project);

      expect(document.activeElement).toBe(chip(0, 'end'));
    });

    it('does not take focus from outside the view', () => {
      const outside = document.createElement('button');
      document.body.append(outside);
      outside.focus();

      view.render(project);

      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it('leaves focus alone when the focused slot no longer exists', () => {
      chip(0, 'end').focus();

      view.render({ lines: [{ tokens: [{ text: 'Hello', spaceAfter: false, startMs: 1000 }] }] });

      expect(root.contains(document.activeElement)).toBe(false);
    });
  });

  it('scrolls the cursor line into view inside a scrollable box', () => {
    const many: Project = {
      lines: Array.from({ length: 40 }, (_, i) => ({
        tokens: [{ text: `line${i}`, spaceAfter: false }],
      })),
    };
    root.style.cssText = 'height: 100px; overflow-y: auto';
    view.render(many);

    view.setCursor({ line: 30, token: 0 });

    expect(root.scrollTop).toBeGreaterThan(0);
  });

  describe('when the page scrolls', () => {
    const many: Project = {
      lines: Array.from({ length: 40 }, (_, i) => ({
        tokens: [{ text: `line${i}`, spaceAfter: false }],
      })),
    };
    let spacer: HTMLElement;
    let tail: HTMLElement;
    let bar: HTMLElement;

    const lineEl = (i: number): HTMLElement => root.querySelectorAll<HTMLElement>('.line')[i];

    const placeBoxWithVisible = (visible: number): void => {
      spacer.style.height = '0';
      window.scrollTo(0, 0);
      spacer.style.height = `${window.innerHeight - visible - root.getBoundingClientRect().top}px`;
      expect(root.getBoundingClientRect().top).toBe(window.innerHeight - visible);
    };

    beforeEach(() => {
      bar = document.createElement('div');
      bar.style.cssText = 'position: sticky; top: 0; z-index: 1; height: 120px; background: #444';
      spacer = document.createElement('div');
      tail = document.createElement('div');
      tail.style.height = `${window.innerHeight}px`;
      root.before(bar, spacer);
      root.after(tail);
      root.style.cssText = 'height: 405px; overflow-y: auto';
      view = new LinesView(
        root,
        { onSelect, onSetCursor },
        () => bar.getBoundingClientRect().bottom,
      );
      view.render(many);
    });

    afterEach(() => {
      bar.remove();
      spacer.remove();
      tail.remove();
      window.scrollTo(0, 0);
    });

    it('reveals the followed line when only 80px of the box is on screen', () => {
      placeBoxWithVisible(80);

      view.setCursor({ line: 20, token: 0 });

      expect(lineEl(20).getBoundingClientRect().top).toBeGreaterThanOrEqual(bar.offsetHeight);
      expect(lineEl(21).getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    });

    it('scrolls the page when the visible slice is too short for the line and the next', () => {
      placeBoxWithVisible(40);

      view.setCursor({ line: 20, token: 0 });

      expect(window.scrollY).toBeGreaterThan(0);
      expect(lineEl(20).getBoundingClientRect().top).toBeGreaterThanOrEqual(bar.offsetHeight);
      expect(lineEl(21).getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1);
    });

    it('keeps the followed line out from under the sticky controls', () => {
      spacer.style.height = `${window.innerHeight * 2}px`;
      window.scrollTo(0, root.offsetTop - 40);
      expect(root.getBoundingClientRect().top).toBeLessThan(bar.offsetHeight);

      view.setCursor({ line: 0, token: 0 });

      expect(lineEl(0).getBoundingClientRect().top).toBeGreaterThanOrEqual(bar.offsetHeight);
    });

    it('does not scroll the page when the box is off screen', () => {
      spacer.style.height = `${window.innerHeight * 2}px`;
      window.scrollTo(0, 0);

      view.setCursor({ line: 20, token: 0 });

      expect(window.scrollY).toBe(0);
      expect(root.scrollTop).toBeGreaterThan(0);
    });
  });
});
