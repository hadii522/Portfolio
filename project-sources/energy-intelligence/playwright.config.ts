import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
const chrome =
  process.env.ETIP_BROWSER ||
  (process.platform === 'win32' && fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined);
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    viewport: { width: 1440, height: 1050 },
    launchOptions: { executablePath: chrome },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
