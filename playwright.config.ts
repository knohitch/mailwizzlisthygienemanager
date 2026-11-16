import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
  },
  webServer: {
    command: 'npm run start',
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
