import './style.css';
import { AudioPlayer } from './audio/player';
import { PEAKS_PER_SECOND, decodePeaks } from './audio/decode';
import { TapHistory } from './core/history';
import { serializeLrc } from './core/lrc';
import { readSearchQuery } from './audio/metadata';
import { formatClock } from './core/time';
import { mergeLyrics } from './core/tokenize';
import {
  activeTokenAt,
  applyEndTap,
  applyTap,
  canHaveEnd,
  clearSlotTime,
  countTimed,
  firstUntimedCursor,
  getSlotTime,
  isFinished,
  moveSlotTime,
  previousToken,
} from './core/timing';
import type { Cursor, Project, SlotRef, TokenRef } from './core/types';
import { LinesView } from './ui/lines-view';
import { setupSearchDialog } from './ui/search-dialog';
import { WaveformView } from './ui/waveform-view';

const UNDO_PREROLL_MS = 1500;
const SELECT_PREROLL_MS = 500;
const MSG_START_FIRST = 'Start a word first.';
const MSG_SYLLABLE = 'A word end can only be set right after a whole word, not a syllable.';
const MSG_BEHIND =
  'The playhead is before the previous word. Move it forward, or double-click an earlier word to re-time from there.';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const player = new AudioPlayer();
const history = new TapHistory();
let project: Project = { lines: [] };
let cursor: Cursor = { line: 0, token: 0 };
let selected: SlotRef | undefined;
let audioFile: File | undefined;
let loadId = 0;

const lyricsInput = el<HTMLTextAreaElement>('lyrics-input');
const latency = el<HTMLInputElement>('latency');
const playButton = el<HTMLButtonElement>('play');
const timeLabel = el('time');
const tapStatus = el('tap-status');
const slotLabel = el('slot-label');
const slotMs = el<HTMLInputElement>('slot-ms');
const slotEnd = el<HTMLButtonElement>('slot-end');
const exportOutput = el<HTMLTextAreaElement>('lrc-output');
const exportStatus = el('export-status');
const downloadButton = el<HTMLButtonElement>('download');
const copyButton = el<HTMLButtonElement>('copy');
const audioStatus = el('audio-status');

const lines = new LinesView(el('lines'), {
  onSelect: (ref) => {
    select(ref);
    const time = getSlotTime(project, ref);
    if (time !== undefined && player.loaded) {
      player.seekMs(time - SELECT_PREROLL_MS);
      waveform.reveal(time);
    }
  },
  onSetCursor: (ref) => setCursor({ line: ref.line, token: ref.token }),
});

const waveform = new WaveformView(el<HTMLCanvasElement>('waveform'), {
  onSeek: (ms) => player.loaded && player.seekMs(ms),
  onMarkerSelect: (ref) => select(ref),
  onMarkerMove: (ref, ms) => edit(moveSlotTime(project, ref, ms)),
});

function latencyMs(): number {
  return Number(latency.value || 0);
}

function setProject(next: Project): void {
  project = next;
  lines.render(project);
  waveform.setProject(project);
  updateEditor();
  refreshExport();
}

/** Manual edits invalidate the tap history, so undo only ever reverts taps. */
function edit(next: Project): void {
  history.clear();
  setProject(next);
}

function setCursor(next: Cursor): void {
  cursor = next;
  lines.setCursor(isFinished(project, cursor) ? undefined : cursor);
}

function select(ref: SlotRef | undefined): void {
  selected = ref;
  lines.setSelected(ref);
  waveform.setSelected(ref);
  updateEditor();
}

function updateEditor(): void {
  const token = selected && project.lines[selected.line]?.tokens[selected.token];
  if (!selected || !token) {
    slotLabel.textContent = 'Select a word to edit its time';
    slotMs.value = '';
    slotMs.disabled = true;
    slotEnd.disabled = true;
    return;
  }
  slotLabel.textContent = `Line ${selected.line + 1}: ${token.text} (${selected.kind})`;
  slotMs.disabled = false;
  slotMs.value = String(getSlotTime(project, selected) ?? '');
  slotEnd.disabled = token.startMs === undefined || !canHaveEnd(project, selected);
}

function refreshExport(): void {
  const { text, skippedLines } = serializeLrc(project);
  exportOutput.value = text;
  downloadButton.disabled = copyButton.disabled = text === '';
  exportStatus.textContent =
    skippedLines.length === 0
      ? ''
      : `Not fully timed, omitted from output: line ${skippedLines.map((i) => i + 1).join(', ')}`;
}

function applyLyrics(): void {
  const next = mergeLyrics(project, lyricsInput.value);
  if (
    countTimed(next) < countTimed(project) &&
    !confirm('Some existing timings will be lost. Apply these lyrics anyway?')
  ) {
    return;
  }
  edit(next);
  select(undefined);
  setCursor(firstUntimedCursor(project));
}

/** Starts the next word at the playhead. */
function tap(): void {
  if (!player.playing || isFinished(project, cursor)) {
    return;
  }
  const tapped = cursor;
  const atMs = player.currentMs;
  const result = applyTap(project, cursor, atMs - latencyMs());
  if (result.project === project) {
    tapStatus.textContent = MSG_BEHIND;
    return;
  }
  history.push({ project, cursor, atMs });
  tapStatus.textContent = '';
  setProject(result.project);
  setCursor(result.cursor);
  select({ ...tapped, kind: 'start' });
}

/** Ends the word that was started most recently, at the playhead. */
function tapEnd(): void {
  if (!player.playing) {
    return;
  }
  const atMs = player.currentMs;
  const next = applyEndTap(project, cursor, atMs - latencyMs());
  const target = previousToken(project, cursor);
  if (next === project || !target) {
    const start = target && getSlotTime(project, { ...target, kind: 'start' });
    if (start === undefined) {
      tapStatus.textContent = MSG_START_FIRST;
    } else {
      tapStatus.textContent = Math.round(atMs - latencyMs()) < start ? MSG_BEHIND : MSG_SYLLABLE;
    }
    return;
  }
  history.push({ project, cursor, atMs });
  tapStatus.textContent = '';
  setProject(next);
  select({ ...target, kind: 'end' });
}

function undo(): void {
  const snapshot = history.pop();
  if (!snapshot) {
    return;
  }
  tapStatus.textContent = '';
  setProject(snapshot.project);
  setCursor(snapshot.cursor);
  select(undefined);
  if (player.loaded) {
    player.seekMs(snapshot.atMs - UNDO_PREROLL_MS);
  }
}

function nudge(deltaMs: number): void {
  if (!selected) {
    return;
  }
  const base = getSlotTime(project, selected) ?? player.currentMs;
  edit(moveSlotTime(project, selected, base + deltaMs));
}

function setEndAtPlayhead(): void {
  if (!selected) {
    return;
  }
  const word: TokenRef = { line: selected.line, token: selected.token };
  const end: SlotRef = { ...word, kind: 'end' };
  const next = moveSlotTime(project, end, player.currentMs);
  if (next !== project) {
    edit(next);
    select(end);
  }
}

function togglePlay(): void {
  if (player.loaded) {
    player.toggle().catch(() => undefined);
  }
}

async function loadAudio(file: File): Promise<void> {
  const id = ++loadId;
  audioStatus.textContent = 'Loading audio...';
  try {
    await player.load(file);
  } catch (error) {
    if (id === loadId) {
      audioStatus.textContent = error instanceof Error ? error.message : 'Could not load audio.';
    }
    return;
  }
  if (id !== loadId) {
    return;
  }
  audioFile = file;
  el('audio-name').textContent = file.name;
  player.setRate(Number(el<HTMLSelectElement>('speed').value));
  waveform.setPeaks(undefined, PEAKS_PER_SECOND);
  audioStatus.textContent = 'Building waveform...';
  try {
    const peaks = await decodePeaks(file);
    if (id === loadId) {
      waveform.setPeaks(peaks, PEAKS_PER_SECOND);
      audioStatus.textContent = '';
    }
  } catch {
    if (id === loadId) {
      audioStatus.textContent = 'Waveform unavailable for this file; timing still works.';
    }
  }
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('textarea, select, input') || target.isContentEditable)
  );
}

document.addEventListener('keydown', (e) => {
  if (isTextField(e.target) || e.ctrlKey || e.metaKey || e.altKey) {
    return;
  }
  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault();
      if (!e.repeat) {
        tap();
      }
      break;
    case 'f':
    case 'j':
      if (!e.repeat) {
        tapEnd();
      }
      break;
    case 'z':
      undo();
      break;
    case 'backspace':
      e.preventDefault();
      undo();
      break;
    case 'enter':
      if (!(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        togglePlay();
      }
      break;
    case 'arrowleft':
    case 'arrowright':
      if (selected) {
        e.preventDefault();
        nudge((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 100 : 10));
      }
      break;
  }
});

// Space on a focused button would otherwise also click it on release.
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && !isTextField(e.target)) {
    e.preventDefault();
  }
});

const dropzone = el('dropzone');
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) {
    dropzone.classList.remove('dragging');
  }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) {
    void loadAudio(file);
  }
});
el<HTMLInputElement>('file-input').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files?.[0]) {
    void loadAudio(input.files[0]);
  }
  input.value = '';
});

const openSearch = setupSearchDialog(el<HTMLDialogElement>('search-dialog'), (lyrics) => {
  lyricsInput.value = lyrics;
  applyLyrics();
});
el('lyrics-apply').addEventListener('click', applyLyrics);
el('lyrics-search').addEventListener('click', async () =>
  openSearch(audioFile ? await readSearchQuery(audioFile) : ''),
);

playButton.addEventListener('click', togglePlay);
for (const type of ['play', 'pause', 'ended']) {
  player.element.addEventListener(type, () => {
    playButton.textContent = player.playing ? 'Pause' : 'Play';
  });
}
el('back').addEventListener('click', () => player.loaded && player.seekMs(player.currentMs - 5000));
el<HTMLSelectElement>('speed').addEventListener('change', (e) =>
  player.setRate(Number((e.target as HTMLSelectElement).value)),
);
el<HTMLSelectElement>('zoom').addEventListener('change', (e) =>
  waveform.setWindowMs(Number((e.target as HTMLSelectElement).value)),
);

el('tap').addEventListener('click', tap);
el('tap-end').addEventListener('click', tapEnd);
el('undo').addEventListener('click', undo);

slotMs.addEventListener('change', () => {
  if (selected && slotMs.value !== '') {
    edit(moveSlotTime(project, selected, Number(slotMs.value)));
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-nudge]')) {
  button.addEventListener('click', () => nudge(Number(button.dataset.nudge)));
}
slotEnd.addEventListener('click', setEndAtPlayhead);
el('slot-clear').addEventListener('click', () => {
  if (!selected) {
    return;
  }
  const { kind } = selected;
  edit(clearSlotTime(project, selected));
  if (kind === 'end') {
    select({ ...selected, kind: 'start' });
  }
});
el('slot-cursor').addEventListener('click', () => {
  if (selected) {
    setCursor({ line: selected.line, token: selected.token });
  }
});

downloadButton.addEventListener('click', () => {
  const name = (audioFile?.name.replace(/\.[^.]+$/, '') || 'lyrics') + '.lrc';
  const url = URL.createObjectURL(
    new Blob([exportOutput.value], { type: 'text/plain;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
});
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(exportOutput.value);
    exportStatus.textContent = 'Copied.';
  } catch {
    exportStatus.textContent = 'Copy failed; select the text below and copy manually.';
  }
});

// Timings are not persisted.
window.addEventListener('beforeunload', (e) => {
  if (countTimed(project) > 0) {
    e.preventDefault();
  }
});

function frame(): void {
  const ms = player.currentMs;
  waveform.setPlayhead(ms);
  lines.setActive(activeTokenAt(project, ms), player.playing);
  const label = `${formatClock(ms)} / ${formatClock(player.durationMs)}`;
  if (timeLabel.textContent !== label) {
    timeLabel.textContent = label;
  }
  waveform.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
