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
});
