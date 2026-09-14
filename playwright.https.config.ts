import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/https', timeout: 45_000, workers: 3,
  reporter: [['list'], ['json', { outputFile: process.env.PWA_HTTPS_REPORT_PATH ?? 'test-results/https-browser.json' }]],
  use: { baseURL: 'https://127.0.0.1:8791', ignoreHTTPSErrors: false, trace: 'retain-on-failure' },
  // A TCP readiness probe avoids a test-runner-specific TLS trust bypass.
  webServer: { command: 'node scripts/https-fixture.mjs', port: 8791, reuseExistingServer: false },
  projects: [
    { name: 'https-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'https-iphone-webkit', testMatch: '**/trusted-pwa.spec.ts', use: { ...devices['iPhone 13'] } },
    { name: 'https-android', use: { ...devices['Pixel 5'] } },
  ],
});
