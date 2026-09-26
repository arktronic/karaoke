import { describe, expect, it, vi } from 'vitest';
import { renderOfflineFrames } from '../src/render/runtime/frame-loop.js';

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('renderOfflineFrames', () => {
  it('renders frame zero directly and suspends only at future times', async () => {
    const events: string[] = [];
    const context = {
      suspend: vi.fn(async (time: number) => {
        events.push('suspend');
        if (time <= 0) {
          throw new Error('Suspension time must be in the future');
        }
      }),
      resume: vi.fn(async () => {
        events.push('resume');
      }),
      startRendering: vi.fn(async () => {
        events.push('start');
      }),
    };
    const renderFrame = vi.fn(async (frame: number, time: number) => {
      events.push(`frame:${frame}:${time}`);
    });

    await renderOfflineFrames(context, 2, 24, renderFrame);

    expect(events.slice(0, 3)).toEqual(['frame:0:0', 'suspend', 'start']);
    expect(context.suspend).toHaveBeenCalledTimes(1);
    expect(context.suspend).toHaveBeenCalledWith(1 / 24);
    expect(renderFrame).toHaveBeenNthCalledWith(1, 0, 0);
    expect(renderFrame).toHaveBeenCalledTimes(2);
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it('resumes the context and propagates frame failures', async () => {
    const suspended = createDeferred<void>();
    const rendering = createDeferred<void>();
    const frameError = new Error('Frame rendering failed');
    const context = {
      suspend: vi.fn(() => suspended.promise),
      resume: vi.fn(async () => {
        rendering.resolve(undefined);
      }),
      startRendering: vi.fn(() => rendering.promise),
    };

    const renderPromise = renderOfflineFrames(context, 2, 24, async (frame) => {
      if (frame === 1) {
        throw frameError;
      }
    });
    suspended.resolve(undefined);

    await expect(renderPromise).rejects.toBe(frameError);
    expect(context.suspend).toHaveBeenCalledWith(1 / 24);
    expect(context.resume).toHaveBeenCalledTimes(1);
  });
});
