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

/** Waits for both the audio load and the waveform build, so nothing is pending at teardown. */
async function waitForLoaded(name: string): Promise<void> {
  await waitFor(() => {
    expect(el('audio-name').textContent).toBe(name);
    expect(el('audio-status').textContent).toBe('');
  });
}

async function loadAudio(durationMs = 8000): Promise<void> {
  await userEvent.upload(el('file-input'), makeWav(durationMs));
  await waitForLoaded('tone.wav');
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

  describe('dragging', () => {
    const dispatch = (type: string, data: DataTransfer): DragEvent => {
      const event = new DragEvent(type, { dataTransfer: data, cancelable: true });
      window.dispatchEvent(event);
      return event;
    };
    const fileDrag = (): DataTransfer => {
      const data = new DataTransfer();
      data.items.add(makeWav(4000, 'dropped.wav'));
      return data;
    };
    const textDrag = (): DataTransfer => {
      const data = new DataTransfer();
      data.setData('text/plain', 'some lyrics');
      return data;
    };

    it('accepts a dragged file and highlights the dropzone', () => {
      expect(dispatch('dragover', fileDrag()).defaultPrevented).toBe(true);
      expect(el('dropzone').classList.contains('dragging')).toBe(true);
    });

    it('leaves dragged text alone so the lyrics box can take it', () => {
      expect(dispatch('dragover', textDrag()).defaultPrevented).toBe(false);
      expect(el('dropzone').classList.contains('dragging')).toBe(false);
      expect(dispatch('drop', textDrag()).defaultPrevented).toBe(false);
    });

    it('loads a file dropped anywhere on the page and takes it over from the browser', async () => {
      expect(dispatch('drop', fileDrag()).defaultPrevented).toBe(true);

      await waitForLoaded('dropped.wav');
    });
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

describe('seek slider', () => {
  const seek = (): HTMLInputElement => el<HTMLInputElement>('seek');
  const clock = (): string => el('time').textContent ?? '';

  it('stays disabled until audio is loaded', async () => {
    expect(seek().disabled).toBe(true);

    await loadAudio(8000);

    await waitFor(() => expect(seek().disabled).toBe(false));
    expect(seek().max).toBe('8000');
  });

  it('seeks with the keyboard, including forward to untimed parts', async () => {
    await loadAudio(8000);
    await waitFor(() => expect(seek().disabled).toBe(false));
    seek().focus();

    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(clock()).toMatch(/^0:00\.010 /));

    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await waitFor(() => expect(clock()).toMatch(/^0:05\.010 /));

    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    await waitFor(() => expect(clock()).toMatch(/^0:00\.010 /));

    await userEvent.keyboard('{End}');
    await waitFor(() => expect(clock()).toMatch(/^0:08\.000 /));

    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(clock()).toMatch(/^0:00\.000 /));
  });

  it('follows playback', async () => {
    await loadAudio(8000);
    await play();

    await waitFor(() => expect(seek().valueAsNumber).toBeGreaterThan(0));
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

  it('keeps keyboard focus on a focused chip while nudging it', async () => {
    const before = await tapOne();
    await userEvent.click(chips()[0]);
    expect(document.activeElement).toBe(chips()[0]);

    await userEvent.keyboard('{ArrowRight}');

    expect(lrcTimes(output())[0]).toBe(before + 10);
    expect(document.activeElement).toBe(chips()[0]);
    expect(chips()[0].classList.contains('selected')).toBe(true);
  });

  it('commits a typed time and still selects the chip clicked to leave the field', async () => {
    await applyLyrics('Hello world');
    await loadAudio();
    await play();
    await tapWord();
    await tapWord();
    await userEvent.click(chips()[0]);
    await userEvent.fill(el('slot-ms'), '50');

    await userEvent.click(chips()[1]);

    expect(lrcTimes(output())[0]).toBe(50);
    expect(el('slot-label').textContent).toBe('Line 1: world (start)');
    expect(chips()[1].classList.contains('selected')).toBe(true);
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
