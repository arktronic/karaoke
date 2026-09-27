import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const jassubDistDir = join(dirname(require.resolve('jassub/package.json')), 'dist');

// Bundles the browser-only runtime (Butterchurn + JASSUB + Mediabunny) into a single IIFE
// script that gets injected into the Playwright page; tsc never compiles this folder directly.
await build({
  entryPoints: ['src/render/runtime/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome124',
  outfile: 'dist/runtime.js',
});

// JASSUB's worker script imports bare package specifiers (e.g. "abslink", "lfa-ponyfill") that a
// native `Worker({ type: 'module' })` can't resolve when served as-is; bundle it into a
// self-contained ESM worker script instead.
await build({
  entryPoints: [join(jassubDistDir, 'worker', 'worker.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome124',
  outfile: 'dist/jassub-worker.js',
});
