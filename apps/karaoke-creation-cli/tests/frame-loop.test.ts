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

    const renderPromise = renderOfflineFrames(context, 1, 24, async () => {
      throw frameError;
    });
    suspended.resolve(undefined);

    await expect(renderPromise).rejects.toBe(frameError);
    expect(context.resume).toHaveBeenCalledTimes(1);
  });
});
