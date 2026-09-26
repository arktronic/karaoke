import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  readFile: vi.fn(),
  launch: vi.fn(),
  startAssetServer: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  open: mocks.open,
  readFile: mocks.readFile,
}));
vi.mock('playwright', () => ({ chromium: { launch: mocks.launch } }));
vi.mock('../src/render/server.js', () => ({ startAssetServer: mocks.startAssetServer }));

import { renderVideo } from '../src/render/renderer.js';

describe('renderVideo resource cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.readFile.mockResolvedValue(Buffer.from('audio'));
  });

  it('launches unified headless Chromium with GPU flags and cleans up on launch failure', async () => {
    const closeOutput = vi.fn().mockResolvedValue(undefined);
    const closeServer = vi.fn().mockResolvedValue(undefined);
    mocks.open.mockResolvedValue({ close: closeOutput, write: vi.fn() });
    mocks.startAssetServer.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:1234',
      close: closeServer,
    });
    mocks.launch.mockRejectedValue(new Error('Chromium launch failed'));

    await expect(
      renderVideo({
        audioPath: 'input.wav',
        assText: '',
        config: {
          width: 1920,
          height: 1080,
          fps: 24,
          visualizer: { preset: 'test' },
        },
        outputPath: 'output.mp4',
      }),
    ).rejects.toThrow('Chromium launch failed');

    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
        channel: 'chromium',
        args: expect.arrayContaining([
          expect.stringMatching(/^--use-angle=/),
          '--ignore-gpu-blocklist',
          '--enable-gpu-rasterization',
        ]),
      }),
    );
    expect(closeServer).toHaveBeenCalledOnce();
    expect(closeOutput).toHaveBeenCalledOnce();
  });
});
