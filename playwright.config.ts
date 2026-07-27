import { defineConfig, devices } from '@playwright/test';
const e2ePort = 1422;
const e2eOrigin = process.env.ORBITSTART_E2E_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  timeout: 90000,
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: e2eOrigin,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'msedge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
});
