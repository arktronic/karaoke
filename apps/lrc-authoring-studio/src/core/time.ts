function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** `mm:ss.xx` with centisecond rounding (minutes may exceed 99). */
export function formatLrcTime(ms: number): string {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const minutes = Math.floor(totalCs / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  return `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(totalCs % 100, 2)}`;
}

/** `m:ss.mmm` for on-screen display. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  return `${minutes}:${pad(seconds, 2)}.${pad(total % 1000, 3)}`;
}
