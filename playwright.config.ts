import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  timeout: 30_000,
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:8787', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev:fixture',
    url: 'http://127.0.0.1:8787/healthz',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 5'] } },
    { name: 'narrow-320', use: { browserName: 'chromium', viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true } },
  ],
});
