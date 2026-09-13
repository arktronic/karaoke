import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import type { CliIO } from '../src/cli.js';

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

  it('exits 1 for an invalid numeric flag value', async () => {
    const { io, stderrText } = makeIo();
    const code = await runCli(
      ['--audio', 'a.mp3', '--lyrics', 'a.lrc', '--output', 'out.mp4', '--width', 'nope'],
      io,
    );
    expect(code).toBe(1);
    expect(stderrText()).toContain('--width must be a positive integer');
  });
});
