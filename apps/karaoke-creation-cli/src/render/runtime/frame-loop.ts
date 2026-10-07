interface OfflineAudioFrameContext {
  suspend(time: number): Promise<void>;
  resume(): Promise<void>;
  startRendering(): Promise<unknown>;
}

export async function renderOfflineFrames(
  context: OfflineAudioFrameContext,
  totalFrames: number,
  fps: number,
  renderFrame: (frame: number, time: number) => Promise<void>,
  updateFrame?: (time: number) => Promise<void>,
  updateFps = fps,
): Promise<void> {
  const frameTasks: Promise<void>[] = [];
  let frameFailed = false;
  let frameError: unknown;

  if (totalFrames > 0) {
    if (updateFrame) {
      await updateFrame(0);
    }
    await renderFrame(0, 0);
  }

  let nextFrame = 1;
  let nextUpdateTime = updateFrame ? 1 / updateFps : Number.POSITIVE_INFINITY;
  const finalFrameTime = (totalFrames - 1) / fps;

  while (nextFrame < totalFrames || nextUpdateTime <= finalFrameTime) {
    const outputTime = nextFrame < totalFrames ? nextFrame / fps : Number.POSITIVE_INFINITY;
    const timesCoincide = Math.abs(outputTime - nextUpdateTime) < 1e-9;
    const renderOutputFrame = timesCoincide || outputTime < nextUpdateTime;
    const updateAudioFrame = timesCoincide || nextUpdateTime < outputTime;
    const frame = nextFrame;
    const time = timesCoincide ? outputTime : Math.min(outputTime, nextUpdateTime);

    frameTasks.push(
      context.suspend(time).then(async () => {
        try {
          if (!frameFailed) {
            if (updateAudioFrame) {
              await updateFrame?.(time);
            }
            if (renderOutputFrame && !frameFailed) {
              await renderFrame(frame, time);
            }
          }
        } catch (error) {
          if (!frameFailed) {
            frameFailed = true;
            frameError = error;
          }
        } finally {
          await context.resume();
        }
      }),
    );

    if (renderOutputFrame) {
      nextFrame++;
    }
    if (updateAudioFrame) {
      nextUpdateTime += 1 / updateFps;
    }
  }

  const settledFrameTasks = Promise.allSettled(frameTasks);
  await context.startRendering();

  const results = await settledFrameTasks;
  const rejectedTask = results.find((result) => result.status === 'rejected');
  if (rejectedTask?.status === 'rejected') {
    throw rejectedTask.reason;
  }
  if (frameFailed) {
    throw frameError;
  }
}
