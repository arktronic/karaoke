import butterchurn from 'butterchurn';
import butterchurnPresetsModule from 'butterchurn-presets';
import JASSUB from 'jassub';
import {
  AudioBufferSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
} from 'mediabunny';

// esbuild's CJS interop wraps this package's own (webpack-built) `default` export in another
// `.default`, so unwrap defensively rather than assuming a single level of wrapping.
const butterchurnPresets: Record<string, unknown> =
  (butterchurnPresetsModule as { default?: Record<string, unknown> }).default ??
  butterchurnPresetsModule;

export interface RuntimeOptions {
  /** Base64-encoded bytes of the source audio file. */
  audioBase64: string;
  assText: string;
  width: number;
  height: number;
  fps: number;
  presetName: string;
  /**
   * JASSUB loads its worker/wasm/font assets via relative URLs resolved from its own module
   * location, which esbuild's IIFE bundling breaks; these must point to a real served origin.
   */
  jassubWorkerUrl: string;
  jassubWasmUrl: string;
  jassubModernWasmUrl: string;
  jassubFontUrl: string;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Converts a chunk of encoded output bytes to base64 for transfer to Node via window.__writeChunk;
// chunks are bounded in size (see StreamTarget's chunkSize), unlike the whole output file, so this
// never approaches the browser's ~500MB max string length.
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Renders a Butterchurn + JASSUB composited karaoke video, streaming the encoded output to Node
 * (via `window.__writeChunk`) as it's produced rather than buffering the whole file in memory.
 *
 * Runs entirely inside a headless browser page (Playwright). This is the highest-risk piece of the
 * pipeline: it drives Butterchurn's audio-reactive rendering deterministically (non-realtime) via
 * `OfflineAudioContext.suspend()`/`resume()` frame stepping, so it should be validated against a real
 * Chromium build before being relied on in production.
 */
export async function renderKaraoke(options: RuntimeOptions): Promise<void> {
  const {
    audioBase64,
    assText,
    width,
    height,
    fps,
    presetName,
    jassubWorkerUrl,
    jassubWasmUrl,
    jassubModernWasmUrl,
    jassubFontUrl,
  } = options;
  console.log(`[runtime] starting render: ${width}x${height}@${fps}fps, preset=${presetName}`);
  const audioBytes = base64ToArrayBuffer(audioBase64);

  const audioContext = new AudioContext();
  console.log('[runtime] decoding audio');
  const audioBuffer = await audioContext.decodeAudioData(audioBytes.slice(0));
  const totalFrames = Math.max(1, Math.ceil(audioBuffer.duration * fps));
  console.log(
    `[runtime] audio decoded: duration=${audioBuffer.duration.toFixed(2)}s, totalFrames=${totalFrames}`,
  );

  const compositeCanvas = document.createElement('canvas');
  compositeCanvas.width = width;
  compositeCanvas.height = height;
  const compositeCtx = compositeCanvas.getContext('2d');
  if (!compositeCtx) {
    throw new Error('Failed to acquire 2D context for the composite canvas');
  }

  const vizCanvas = document.createElement('canvas');
  vizCanvas.width = width;
  vizCanvas.height = height;

  const subtitleCanvas = document.createElement('canvas');
  subtitleCanvas.width = width;
  subtitleCanvas.height = height;
  // JASSUB's resize() computes its render size from the canvas's DOM layout box (clientWidth/
  // clientHeight), so the canvas must be attached to the document with an explicit CSS size, even
  // though it's never actually displayed -- an unattached or display:none canvas has a 0x0 layout
  // box, which breaks JASSUB's internal libass frame-size setup and silently zeroes all rendering.
  subtitleCanvas.style.position = 'fixed';
  subtitleCanvas.style.left = '-99999px';
  subtitleCanvas.style.width = `${width}px`;
  subtitleCanvas.style.height = `${height}px`;
  document.body.appendChild(subtitleCanvas);

  // Offline audio graph driving Butterchurn: suspend/resume at each frame time reproduces
  // frame-accurate audio-reactive analysis deterministically, without realtime playback.
  const offlineContext = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate,
  );
  const bufferSource = offlineContext.createBufferSource();
  bufferSource.buffer = audioBuffer;
  const analyser = offlineContext.createAnalyser();
  bufferSource.connect(analyser);
  analyser.connect(offlineContext.destination);
  bufferSource.start();

  const visualizer = butterchurn.createVisualizer(offlineContext, vizCanvas, { width, height });
  visualizer.connectAudio(analyser);
  const preset = butterchurnPresets[presetName];
  if (!preset) {
    throw new Error(`Unknown visualizer preset: ${presetName}`);
  }
  visualizer.loadPreset(preset, 0);
  console.log('[runtime] visualizer created and preset loaded');

  console.log('[runtime] constructing JASSUB');
  const jassub = new JASSUB({
    canvas: subtitleCanvas,
    subContent: assText,
    workerUrl: jassubWorkerUrl,
    wasmUrl: jassubWasmUrl,
    modernWasmUrl: jassubModernWasmUrl,
    fonts: [jassubFontUrl],
    // Prevents JASSUB from falling back to its own import.meta.url-based default font URL, which
    // is invalid once bundled into an IIFE.
    availableFonts: { 'liberation sans': jassubFontUrl },
  });
  await jassub.ready;

  console.log('[runtime] JASSUB ready');

  const outputStream = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    write: async (chunk) => {
      await window.__writeChunk(uint8ArrayToBase64(chunk.data), chunk.position);
    },
  });
  const output = new Output({
    format: new Mp4OutputFormat(),
    // 16 MiB default chunking; larger chunks (64/128 MiB) showed no speedup and 192 MiB OOM'd.
    target: new StreamTarget(outputStream, { chunked: true }),
  });
  // Explicit constant bitrate for finer control than 'medium'/'high' quality steps, and to avoid
  // VBR dips (source of blocking artifacts) on the visualizer's high-entropy frames.
  const videoSource = new CanvasSource(compositeCanvas, {
    codec: 'avc',
    quality: new Quality({ bitrate: 16_777_216, bitrateMode: 'constant' }),
  });
  output.addVideoTrack(videoSource);

  const audioSource = new AudioBufferSource({ codec: 'aac', quality: new Quality('high') });
  output.addAudioTrack(audioSource);

  await output.start();
  console.log('[runtime] mediabunny output started, beginning frame-stepped offline render');

  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / fps;
    // `resume()` is only called once this frame's canvas snapshot has been added to the output,
    // so the offline audio graph never advances past a suspend point before its frame is captured.
    offlineContext.suspend(t).then(async () => {
      if (frame % 300 === 0) {
        console.log(`[runtime] rendering frame ${frame}/${totalFrames}`);
      }
      visualizer.render();
      // manualRender round-trips to JASSUB's worker before painting subtitleCanvas, so it must be
      // awaited before compositing, or the canvas will still hold the previous (or no) frame.
      await jassub.manualRender({
        expectedDisplayTime: performance.now(),
        width,
        height,
        mediaTime: t,
      });

      compositeCtx.clearRect(0, 0, width, height);
      compositeCtx.drawImage(vizCanvas, 0, 0);
      compositeCtx.drawImage(subtitleCanvas, 0, 0);

      await videoSource.add(t, 1 / fps);
      return offlineContext.resume();
    });
  }

  await offlineContext.startRendering();
  console.log('[runtime] offline audio rendering and video frame capture complete, adding audio');

  await audioSource.add(audioBuffer);

  console.log('[runtime] finalizing output');
  await output.finalize();
  console.log('[runtime] output finalized');
}

declare global {
  interface Window {
    __renderKaraoke: typeof renderKaraoke;
    __writeChunk: (base64: string, position: number) => Promise<void>;
  }
}

window.__renderKaraoke = renderKaraoke;
