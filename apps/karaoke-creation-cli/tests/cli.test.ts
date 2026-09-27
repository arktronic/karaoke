import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';
import { resolveLyricsFileWithDiagnostics } from '../src/core/input.js';
import { renderVideo } from '../src/render/renderer.js';
import type { CliIO } from '../src/cli.js';

vi.mock('../src/core/input.js', () => ({
  resolveLyricsFileWithDiagnostics: vi.fn(),
}));

vi.mock('../src/render/renderer.js', () => ({
  renderVideo: vi.fn(),
}));

function makeIo(): { io: CliIO; stdoutText: () => string; stderrText: () => string } {
  let stdoutText = '';
  let stderrText = '';
  const stdout = {
    write(text: string, callback: (error?: Error) => void) {
      stdoutText += text;
      callback();
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  const stderr = {
    write(text: string, callback: (error?: Error) => void) {
      stderrText += text;
      callback();
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { io: { stdout, stderr }, stdoutText: () => stdoutText, stderrText: () => stderrText };
}

describe('runCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveLyricsFileWithDiagnostics).mockResolvedValue({ text: '', diagnostics: [] });
    vi.mocked(renderVideo).mockResolvedValue();
  });

  it('prints usage and exits 0 for --help', async () => {
    const { io, stdoutText } = makeIo();
    const code = await runCli(['--help'], io);
    expect(code).toBe(0);
    expect(stdoutText()).toContain('Usage: karaoke-creation-cli');
  });

  it('exits 1 with a message when required options are missing', async () => {
    const { io, stderrText } = makeIo();
    const code = await runCli([], io);
    expect(code).toBe(1);
    expect(stderrText()).toContain('Missing required option(s)');
  });

  it('exits 1 for an unknown option', async () => {
    const { io, stderrText } = makeIo();
    const code = await runCli(['--bogus', 'value'], io);
    expect(code).toBe(1);
    expect(stderrText()).toContain('Unknown option: --bogus');
  });

  it('rejects simultaneous named and file preset options', async () => {
    const { io, stderrText } = makeIo();
    const code = await runCli(
      [
        '--audio',
        'song.mp3',
        '--lyrics',
        'song.lrc',
        '--output',
        'out.mp4',
        '--preset',
        'named',
        '--preset-file',
        'custom.json',
      ],
      io,
    );

    expect(code).toBe(1);
    expect(stderrText()).toContain('--preset and --preset-file cannot be used together');
    expect(renderVideo).not.toHaveBeenCalled();
  });

  it('loads and forwards a preset JSON object to the renderer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'karaoke-preset-'));
    const presetFile = join(directory, 'custom.json');
    const presetData = { name: 'custom', baseVals: { zoom: 1 } };
    await writeFile(presetFile, JSON.stringify(presetData));

    try {
      const { io } = makeIo();
      const code = await runCli(
        [
          '--audio',
          'song.mp3',
          '--lyrics',
          'song.lrc',
          '--output',
          'out.mp4',
          '--preset-file',
          presetFile,
        ],
        io,
      );

      expect(code).toBe(0);
      expect(renderVideo).toHaveBeenCalledWith(expect.objectContaining({ presetData }));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects preset files that do not contain a JSON object', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'karaoke-preset-'));
    const presetFile = join(directory, 'custom.json');
    await writeFile(presetFile, '[]');

    try {
      const { io, stderrText } = makeIo();
      const code = await runCli(
        [
          '--audio',
          'song.mp3',
          '--lyrics',
          'song.lrc',
          '--output',
          'out.mp4',
          '--preset-file',
          presetFile,
        ],
        io,
      );

      expect(code).toBe(1);
      expect(stderrText()).toContain('Preset file must contain a JSON object');
      expect(renderVideo).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exits 1 for an invalid numeric flag value', async () => {
    const { io, stderrText } = makeIo();
    const code = await runCli(
      ['--audio', 'a.mp3', '--lyrics', 'a.lrc', '--output', 'out.mp4', '--width', 'nope'],
      io,
    );
    expect(code).toBe(1);
    expect(stderrText()).toContain('--width must be a positive safe integer');
  });

  it('rejects unsafe integer overrides before resolving lyrics or rendering', async () => {
    const { io, stderrText } = makeIo();
    const code = await runCli(
      ['--audio', 'a.mp3', '--lyrics', 'a.lrc', '--output', 'out.mp4', '--fps', '9007199254740992'],
      io,
    );

    expect(code).toBe(1);
    expect(stderrText()).toContain('--fps must be a positive safe integer');
    expect(resolveLyricsFileWithDiagnostics).not.toHaveBeenCalled();
    expect(renderVideo).not.toHaveBeenCalled();
  });

  it('reports warning diagnostics and continues rendering', async () => {
    vi.mocked(resolveLyricsFileWithDiagnostics).mockResolvedValue({
      text: '[Script Info]\n',
      diagnostics: [
        {
          code: 'LRC_TIMESTAMP_INVALID',
          message: 'Malformed timestamp',
          severity: 'warning',
          location: { line: 1, column: 1 },
        },
      ],
    });
    const { io, stderrText } = makeIo();

    const code = await runCli(
      ['--audio', 'song.mp3', '--lyrics', 'song.lrc', '--output', 'out.mp4'],
      io,
    );

    expect(code).toBe(0);
    expect(stderrText()).toContain('warning: Malformed timestamp (1:1)');
    expect(renderVideo).toHaveBeenCalledOnce();
  });

  it('reports error diagnostics and skips rendering', async () => {
    vi.mocked(resolveLyricsFileWithDiagnostics).mockResolvedValue({
      text: '[Script Info]\n',
      diagnostics: [
        {
          code: 'LRC_TIMESTAMP_INVALID',
          message: 'Malformed timestamp',
          severity: 'error',
          location: { line: 1, column: 1 },
        },
      ],
    });
    const { io, stderrText } = makeIo();

    const code = await runCli(
      ['--audio', 'song.mp3', '--lyrics', 'song.lrc', '--output', 'out.mp4'],
      io,
    );

    expect(code).toBe(1);
    expect(stderrText()).toContain('error: Malformed timestamp (1:1)');
    expect(renderVideo).not.toHaveBeenCalled();
  });
});
