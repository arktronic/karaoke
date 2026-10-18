import { vi } from 'vitest';
import indexHtml from '../../index.html?raw';

type Listener = [target: EventTarget, type: string, listener: EventListenerOrEventListenerObject];

export function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Mono 16-bit PCM WAV containing a sine tone. */
export function makeWav(durationMs: number, name = 'tone.wav'): File {
  const sampleRate = 22050;
  const samples = Math.round((sampleRate * durationMs) / 1000);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeText(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.8 * 32767, true);
  }
  return new File([buffer], name, { type: 'audio/wav' });
}

/** Dispatches a key press; events bubble to the document-level shortcut handler. */
export function press(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = document.body,
): void {
  for (const type of ['keydown', 'keyup']) {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...init }));
  }
}

/** Start times in milliseconds of every `<mm:ss.xx>` tag in the exported LRC, in order. */
export function lrcTimes(text: string): number[] {
  return [...text.matchAll(/<(\d+):(\d\d)\.(\d\d)>/g)].map(
    ([, m, s, cs]) => Number(m) * 60_000 + Number(s) * 1000 + Number(cs) * 10,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Longer than vi.waitFor's default so engines running in parallel do not time out. */
export function waitFor(callback: () => void): Promise<void> {
  return vi.waitFor(callback, { timeout: 5000 }) as Promise<void>;
}

let mountCount = 0;

/**
 * Loads index.html's markup and a fresh instance of main.ts. main.ts registers global listeners
 * and a never-ending animation-frame loop, so both are tracked and removed on unmount.
 */
export async function mountApp(): Promise<{ unmount(): void }> {
  const parsed = new DOMParser().parseFromString(indexHtml, 'text/html');
  parsed.querySelectorAll('script').forEach((script) => script.remove());
  document.body.replaceChildren(...parsed.body.childNodes);

  const listeners: Listener[] = [];
  const track =
    (target: Document | Window) =>
    (type: string, listener: EventListenerOrEventListenerObject, options?: unknown): void => {
      listeners.push([target, type, listener]);
      EventTarget.prototype.addEventListener.call(
        target,
        type,
        listener,
        options as AddEventListenerOptions,
      );
    };
  document.addEventListener = track(document) as typeof document.addEventListener;
  window.addEventListener = track(window) as typeof window.addEventListener;

  const pendingFrames = new Set<number>();
  const nativeRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) => {
    const id = nativeRaf.call(window, (time) => {
      pendingFrames.delete(id);
      callback(time);
    });
    pendingFrames.add(id);
    return id;
  };

  mountCount += 1;
  try {
    await import(/* @vite-ignore */ `../../src/main.ts?mount=${mountCount}`);
  } finally {
    delete (document as { addEventListener?: unknown }).addEventListener;
    delete (window as { addEventListener?: unknown }).addEventListener;
  }

  return {
    unmount() {
      if (el('play')?.textContent === 'Pause') {
        el('play').click();
      }
      pendingFrames.forEach((id) => cancelAnimationFrame(id));
      pendingFrames.clear();
      window.requestAnimationFrame = nativeRaf;
      for (const [target, type, listener] of listeners) {
        target.removeEventListener(type, listener);
      }
      document.body.replaceChildren();
    },
  };
}
