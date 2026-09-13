import { loadConfig, mergeConfig } from './core/config.js';
import { resolveLyricsFile } from './core/input.js';
import { renderVideo } from './render/renderer.js';
import type { KaraokeConfigOverrides } from './types/options.js';

export interface CliIO {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

const USAGE = `Usage: karaoke-creation-cli --audio <file> --lyrics <lrc|ass> --output <mp4> [options]

Generates a karaoke video from an audio file and LRC/ASS lyrics, with a Butterchurn
visualizer background and JASSUB-rendered subtitles.

Options:
  --audio <file>     Path to the audio file (required)
  --lyrics <file>     Path to the .lrc or .ass lyrics file (required)
  --output <file>     Path to write the resulting .mp4 (required)
  --config <file>     Path to a karaoke.config.json overrides file
  --preset <name>     Butterchurn preset name
  --width <number>     Output video width
  --height <number>    Output video height
  --fps <number>      Output video frame rate
  -h, --help        Show this help message
`;

function writeStream(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

interface ParsedArgs {
  audio?: string;
  lyrics?: string;
  output?: string;
  config?: string;
  preset?: string;
  width?: string;
  height?: string;
  fps?: string;
}

const FLAG_KEYS: Record<string, keyof ParsedArgs> = {
  '--audio': 'audio',
  '--lyrics': 'lyrics',
  '--output': 'output',
  '--config': 'config',
  '--preset': 'preset',
  '--width': 'width',
  '--height': 'height',
  '--fps': 'fps',
};

function parseArgs(argv: string[]): { parsed: ParsedArgs } | { error: string } {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      return { parsed: {} };
    }
    const key = FLAG_KEYS[arg];
    if (!key) {
      return { error: `Unknown option: ${arg}` };
    }
    const value = argv[++i];
    if (value === undefined) {
      return { error: `Missing value for ${arg}` };
    }
    parsed[key] = value;
  }
  return { parsed };
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} must be a positive integer, got: ${value}`);
  }
  return n;
}

/** Parses CLI args, renders the karaoke video, and writes it to disk. Returns the process exit code. */
export async function runCli(
  argv: string[],
  io: CliIO = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  if (argv.includes('-h') || argv.includes('--help')) {
    await writeStream(io.stdout, USAGE);
    return 0;
  }

  const result = parseArgs(argv);
  if ('error' in result) {
    await writeStream(io.stderr, `${result.error}\n${USAGE}`);
    return 1;
  }
  const { audio, lyrics, output, config: configPath, preset, width, height, fps } = result.parsed;

  const missing = ['audio', 'lyrics', 'output'].filter(
    (key) => result.parsed[key as keyof ParsedArgs] === undefined,
  );
  if (missing.length > 0) {
    await writeStream(
      io.stderr,
      `Missing required option(s): ${missing.map((m) => `--${m}`).join(', ')}\n${USAGE}`,
    );
    return 1;
  }

  let overrides: KaraokeConfigOverrides;
  try {
    overrides = {
      ...(width !== undefined ? { width: parsePositiveInt(width, '--width') } : {}),
      ...(height !== undefined ? { height: parsePositiveInt(height, '--height') } : {}),
      ...(fps !== undefined ? { fps: parsePositiveInt(fps, '--fps') } : {}),
      ...(preset !== undefined ? { visualizer: { preset } } : {}),
    };
  } catch (error) {
    await writeStream(io.stderr, `${(error as Error).message}\n`);
    return 1;
  }

  try {
    const baseConfig = await loadConfig(configPath);
    const config = mergeConfig(baseConfig, overrides);
    const assText = await resolveLyricsFile(lyrics as string);
    await renderVideo({
      audioPath: audio as string,
      assText,
      config,
      outputPath: output as string,
    });
  } catch (error) {
    await writeStream(io.stderr, `Failed to generate karaoke video: ${(error as Error).message}\n`);
    return 1;
  }

  return 0;
}
