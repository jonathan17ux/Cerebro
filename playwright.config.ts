import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 6 * 60_000, // 6 minutes per test (real Claude Code calls)
  retries: 0,
  workers: 1, // serial — one Electron instance at a time
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
  },
});
