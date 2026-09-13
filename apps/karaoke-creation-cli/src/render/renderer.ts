import { open, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startAssetServer } from './server.js';
import type { KaraokeConfig } from '../types/options.js';

const APP_DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const JASSUB_DIST_DIR = join(
  dirname(createRequire(import.meta.url).resolve('jassub/package.json')),
  'dist',
);

// Served at "/"; loads the bundled runtime as a real <script src>, giving it a proper origin so
// JASSUB's explicit worker/wasm URLs (below) can be resolved and fetched.
const INDEX_HTML =
  '<!doctype html><html><head></head><body><script src="/dist/runtime.js"></script></body></html>';

export interface RenderInputs {
  audioPath: string;
  assText: string;
  config: KaraokeConfig;
  outputPath: string;
}

function log(message: string): void {
  process.stderr.write(`[renderer] ${message}\n`);
}

function gpuAngleBackend(): string {
  if (process.platform === 'win32') return 'd3d11';
  if (process.platform === 'darwin') return 'metal';
  return 'gl';
}

/** Launches headed (GPU-accelerated) Chromium and streams the composited karaoke video to `outputPath`. */
export async function renderVideo({
  audioPath,
  assText,
  config,
  outputPath,
}: RenderInputs): Promise<void> {
  const audioBytes = await readFile(audioPath);
  const outputHandle = await open(outputPath, 'w');

  log('starting asset server');
  const server = await startAssetServer(
    [
      { prefix: '/dist', dir: APP_DIST_DIR },
      { prefix: '/jassub', dir: JASSUB_DIST_DIR },
    ],
    INDEX_HTML,
  );
  log(`asset server listening at ${server.baseUrl}`);

  log('launching chromium');
  // Headless Chromium falls back to a software GL/GPU path on many systems; running headed with
  // explicit ANGLE/GPU flags gets real hardware acceleration for Butterchurn's WebGL rendering.
  const browser = await chromium.launch({
    headless: false,
    args: [
      `--use-angle=${gpuAngleBackend()}`,
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
    ],
  });
  try {
    const page = await browser.newPage();
    page.on('console', (msg) => log(`[browser:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (error) => log(`[browser:pageerror] ${error}`));
    page.on('requestfailed', (request) =>
      log(`[browser:requestfailed] ${request.url()} ${request.failure()?.errorText}`),
    );
    page.on('response', (response) => {
      if (!response.ok()) {
        log(`[browser:badresponse] ${response.status()} ${response.url()}`);
      }
    });
    page.on('worker', (worker) => {
      log(`[browser:worker created] ${worker.url()}`);
    });

    // Streams encoded MP4 chunks straight to disk as they're produced, avoiding both an in-memory
    // buffer of the whole file and a base64 return value that could exceed the page's max string length.
    await page.exposeFunction('__writeChunk', async (base64: string, position: number) => {
      const buffer = Buffer.from(base64, 'base64');
      await outputHandle.write(buffer, 0, buffer.length, position);
    });

    log(`navigating to ${server.baseUrl}/`);
    await page.goto(`${server.baseUrl}/`);
    log('waiting for __renderKaraoke to be defined');
    await page.waitForFunction(
      () => typeof (globalThis as { __renderKaraoke?: unknown }).__renderKaraoke === 'function',
    );
    log('runtime script loaded, invoking __renderKaraoke');

    const jassubBaseUrl = `${server.baseUrl}/jassub`;
    const jassubWorkerUrl = `${server.baseUrl}/dist/jassub-worker.js`;
    await page.evaluate(
      ({
        audioBase64,
        assText: ass,
        width,
        height,
        fps,
        presetName,
        jassubBaseUrl: jassubUrl,
        jassubWorkerUrl: workerUrl,
      }) =>
        // `window.__renderKaraoke` is attached by the bundled runtime script; this file's tsconfig
        // has no DOM lib, so it's accessed via globalThis rather than the typed `window` global.
        (
          globalThis as unknown as { __renderKaraoke: (options: unknown) => Promise<void> }
        ).__renderKaraoke({
          audioBase64,
          assText: ass,
          width,
          height,
          fps,
          presetName,
          jassubWorkerUrl: workerUrl,
          jassubWasmUrl: `${jassubUrl}/wasm/jassub-worker.wasm`,
          jassubModernWasmUrl: `${jassubUrl}/wasm/jassub-worker-modern.wasm`,
          jassubFontUrl: `${jassubUrl}/default.woff2`,
        }),
      {
        audioBase64: audioBytes.toString('base64'),
        assText,
        width: config.width,
        height: config.height,
        fps: config.fps,
        presetName: config.visualizer.preset,
        jassubBaseUrl,
        jassubWorkerUrl,
      },
    );

    log('__renderKaraoke resolved');
  } finally {
    log('closing browser and asset server');
    await browser.close();
    await server.close();
    await outputHandle.close();
  }
}
