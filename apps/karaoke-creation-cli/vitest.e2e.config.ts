import { defineConfig } from 'vitest/config';

// Opt-in suite: launches a real headless browser and renders a full video. Not run by default `pnpm test`.
export default defineConfig({
  test: {
    include: ['tests/**/*.e2e.test.ts'],
    testTimeout: 120_000,
  },
});
