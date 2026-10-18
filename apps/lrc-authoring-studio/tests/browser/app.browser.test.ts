import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { el, lrcTimes, makeWav, mountApp, press, sleep, waitFor } from './helpers';

let app: Awaited<ReturnType<typeof mountApp>>;

beforeEach(async () => {
  app = await mountApp();
});

afterEach(() => {
  vi.restoreAllMocks();
  app.unmount();
});

const output = (): string => el<HTMLTextAreaElement>('lrc-output').value;
const chips = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('#lines .chip')];

async function applyLyrics(text: string): Promise<void> {
  await userEvent.fill(el('lyrics-input'), text);
  await userEvent.click(el('lyrics-apply'));
}

async function loadAudio(durationMs = 8000): Promise<void> {
  await userEvent.upload(el('file-input'), makeWav(durationMs));
  await waitFor(() => {
    expect(el('audio-name').textContent).toBe('tone.wav');
    expect(el('audio-status').textContent).toBe('');
  });
}

async function play(): Promise<void> {
  await userEvent.click(el('play'));
  await waitFor(() => expect(el('play').textContent).toBe('Pause'));
}

/** Waits briefly so each tap lands at a distinct playback time. */
async function tapWord(): Promise<void> {
  await sleep(120);
  press(' ');
}

describe('lyrics', () => {
  it('renders one chip per word and starts with nothing to export', async () => {
    await applyLyrics('Hello world\nSecond line');

    expect(document.querySelectorAll('#lines .line')).toHaveLength(2);
    expect(chips().map((chip) => chip.querySelector('.chip-text')?.textContent)).toEqual([
      'Hello',
      'world',
      'Second',
      'line',
    ]);
    expect(el<HTMLButtonElement>('download').disabled).toBe(true);
    expect(el<HTMLButtonElement>('copy').disabled).toBe(true);
    expect(output()).toBe('');
  });

  it('keeps timings when the user declines a destructive lyrics change', async () => {
    await applyLyrics('Hello');
    await loadAudio();
    await play();
    await tapWord();
    const before = output();
    expect(before).not.toBe('');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await applyLyrics('Other');

    expect(confirm).toHaveBeenCalledOnce();
    expect(output()).toBe(before);
    expect(chips()[0].querySelector('.chip-text')?.textContent).toBe('Hello');
    expect(chips()[0].classList.contains('timed')).toBe(true);
  });

  it('drops timings when the user accepts a destructive lyrics change', async () => {
    await applyLyrics('Hello');
    await loadAudio();
    await play();
    await tapWord();
    expect(output()).not.toBe('');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await applyLyrics('Other');

    expect(confirm).toHaveBeenCalledOnce();
    expect(chips()[0].querySelector('.chip-text')?.textContent).toBe('Other');
    expect(chips()[0].classList.contains('timed')).toBe(false);
    expect(output()).toBe('');
  });
});

describe('audio', () => {
  it('shows the track duration once a file is loaded', async () => {
    await loadAudio(6000);

    await waitFor(() => expect(el('time').textContent).toBe('0:00.000 / 0:06.000'));
  });

  it('loads a file dropped anywhere on the page', async () => {
    const data = new DataTransfer();
    data.items.add(makeWav(4000, 'dropped.wav'));

    window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, cancelable: true }));

    await waitFor(() => expect(el('audio-name').textContent).toBe('dropped.wav'));
  });

  it('reports files the browser cannot play', async () => {
    await userEvent.upload(
      el('file-input'),
      new File(['not audio'], 'broken.wav', { type: 'audio/wav' }),
    );

    await waitFor(() =>
      expect(el('audio-status').textContent).toBe('This browser cannot play that audio file.'),
    );
  });

  it('toggles playback with the Play button and Enter', async () => {
    await loadAudio();

    await play();
    press('Enter');
    await waitFor(() => expect(el('play').textContent).toBe('Play'));
    press('Enter');
    await waitFor(() => expect(el('play').textContent).toBe('Pause'));
  });
});

describe('tapping', () => {
  it('ignores Space while paused', async () => {
    await applyLyrics('Hello');
    await loadAudio();

    press(' ');

    expect(chips()[0].classList.contains('timed')).toBe(false);
    expect(output()).toBe('');
  });

  it('ignores shortcuts typed into the lyrics box', async () => {
    await applyLyrics('Hello');
    await loadAudio();
    await play();
    await sleep(120);

    press(' ', {}, el('lyrics-input'));
    expect(chips()[0].classList.contains('timed')).toBe(false);

    press(' ');
    expect(chips()[0].classList.contains('timed')).toBe(true);
  });

  it('times each word with Space and exports enhanced LRC', async () => {
    await applyLyrics('Hello world');
    await loadAudio();
    await play();

    await tapWord();
    await tapWord();

    expect(output()).toMatch(
      /^\[\d\d:\d\d\.\d\d\]<\d\d:\d\d\.\d\d>Hello <\d\d:\d\d\.\d\d>world\n$/,
    );
    const [first, second] = lrcTimes(output());
    expect(second).toBeGreaterThan(first);
    expect(chips().every((chip) => chip.classList.contains('timed'))).toBe(true);
    expect(el<HTMLButtonElement>('download').disabled).toBe(false);
  });

  it('omits lines that are not fully timed and says so', async () => {
    await applyLyrics('Hello world');
    await loadAudio();
    await play();

    await tapWord();

    expect(output()).toBe('');
    expect(el('export-status').textContent).toContain('line 1');
  });

  it('sets a word end with F and orders it between the two starts', async () => {
    await applyLyrics('Hello world');
    await loadAudio();
    await play();

    await tapWord();
    await sleep(120);
    press('f');
    await tapWord();

    const [start, end, next] = lrcTimes(output());
    expect(start).toBeLessThan(end);
    expect(end).toBeLessThan(next);
    expect(document.querySelectorAll('#lines .chip.end')).toHaveLength(1);
  });

  it('refuses a word end right after a syllable', async () => {
    await applyLyrics('Hel/lo');
    await loadAudio();
    await play();

    await tapWord();
    press('j');

    expect(el('tap-status').textContent).toContain('whole word');
  });

  it('asks for a word start before an end', async () => {
    await applyLyrics('Hello');
    await loadAudio();
    await play();

    press('f');

    expect(el('tap-status').textContent).toBe('Start a word first.');
  });

  it('undoes the last tap with Z', async () => {
    await applyLyrics('Hello');
    await loadAudio();
    await play();
    await tapWord();
    expect(output()).not.toBe('');

    press('z');

    expect(output()).toBe('');
    expect(chips()[0].classList.contains('timed')).toBe(false);
  });
});

describe('editing times', () => {
  async function tapOne(): Promise<number> {
    await applyLyrics('Hello');
    await loadAudio();
    await play();
    await tapWord();
    return lrcTimes(output())[0];
  }

  it('selects the tapped word and enables the editor', async () => {
    await tapOne();

    expect(chips()[0].classList.contains('selected')).toBe(true);
    expect(el('slot-label').textContent).toBe('Line 1: Hello (start)');
    expect(el<HTMLInputElement>('slot-ms').disabled).toBe(false);
  });

  it('nudges the selected time with the buttons', async () => {
    const before = await tapOne();

    await userEvent.click(document.querySelector('[data-nudge="100"]')!);

    expect(lrcTimes(output())[0]).toBe(before + 100);
  });

  it('nudges with the arrow keys, Shift for larger steps', async () => {
    const before = await tapOne();

    press('ArrowRight');
    expect(lrcTimes(output())[0]).toBe(before + 10);
    press('ArrowRight', { shiftKey: true });
    expect(lrcTimes(output())[0]).toBe(before + 110);
  });

  it('accepts a typed time', async () => {
    await tapOne();

    await userEvent.fill(el('slot-ms'), '2500');
    await userEvent.tab();

    expect(output()).toBe('[00:02.50]<00:02.50>Hello\n');
  });

  it('clears the selected time', async () => {
    await tapOne();

    await userEvent.click(el('slot-clear'));

    expect(output()).toBe('');
    expect(chips()[0].classList.contains('timed')).toBe(false);
  });

  it('sets a word end at the playhead from the editor', async () => {
    await tapOne();
    await userEvent.fill(el('slot-ms'), '10');
    await userEvent.tab();
    expect(el<HTMLButtonElement>('slot-end').disabled).toBe(false);

    await userEvent.click(el('slot-end'));

    const [start, end] = lrcTimes(output());
    expect(document.querySelectorAll('#lines .chip.end')).toHaveLength(1);
    expect(end).toBeGreaterThan(start);
  });
});
