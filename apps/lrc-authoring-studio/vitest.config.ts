import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

// Launch options differ per engine, so each gets its own project and provider; all run muted.
const launchOptions = {
  chromium: { args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] },
  firefox: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.volume_scale': '0.0' } },
};

const browserProjects = (['chromium', 'firefox'] as const).map((browser) => ({
  // Pre-bundling it up front avoids a mid-run page reload when main.ts first imports it.
  optimizeDeps: { include: ['music-metadata'] },
  test: {
    name: `browser-${browser}`,
    // Firefox throttles playback and pointer input in background tabs.
    fileParallelism: false,
    include: ['tests/browser/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: launchOptions[browser] }),
      instances: [{ browser }],
      viewport: { width: 1280, height: 900 },
    },
  },
}));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/browser/**'],
        },
      },
      ...browserProjects,
    ],
  },
});
