import { computePeaks } from '../core/peaks';

export const PEAKS_PER_SECOND = 100;

/** Decodes the whole file to build a waveform; the decoded buffer is discarded afterwards. */
export async function decodePeaks(file: File): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
      buffer.getChannelData(i),
    );
    return computePeaks(channels, buffer.sampleRate, PEAKS_PER_SECOND);
  } finally {
    void context.close();
  }
}
