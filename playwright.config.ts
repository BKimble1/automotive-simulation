import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests on four screen sizes, against the production build (vite preview). WebGL runs on
 * SwiftShader in CI, so the tests drive frames with the virtual clock (?virt=1) instead of
 * waiting on real time: every frame advances time by exactly 1/30 s, and results do not depend
 * on how fast the machine renders.
 */
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4176/',
    launchOptions: { args },
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'laptop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npx vite preview --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
