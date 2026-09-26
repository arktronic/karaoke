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
): Promise<void> {
  const frameTasks: Promise<void>[] = [];
  let frameFailed = false;
  let frameError: unknown;

  if (totalFrames > 0) {
    await renderFrame(0, 0);
  }

  for (let frame = 1; frame < totalFrames; frame++) {
    const time = frame / fps;
    frameTasks.push(
      context.suspend(time).then(async () => {
        try {
          if (!frameFailed) {
            await renderFrame(frame, time);
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
