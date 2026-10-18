/** Peak amplitude (0..1) per bucket, taking the loudest sample across all channels. */
export function computePeaks(
  channels: Float32Array[],
  sampleRate: number,
  peaksPerSecond = 100,
): Float32Array {
  const length = channels[0]?.length ?? 0;
  const step = sampleRate / peaksPerSecond;
  const count = Math.ceil(length / step);
  const peaks = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const from = Math.floor(i * step);
    const to = Math.min(length, Math.floor((i + 1) * step));
    let peak = 0;
    for (const channel of channels) {
      for (let s = from; s < to; s += 1) {
        const value = Math.abs(channel[s]);
        if (value > peak) {
          peak = value;
        }
      }
    }
    peaks[i] = Math.min(1, peak);
  }
  return peaks;
}
