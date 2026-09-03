import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = 8791
export const BASE_URL = `http://localhost:${PORT}`
// Not a real secret — only ever used against a throwaway local D1 instance
// started fresh for this test run (see the --persist-to path below).
export const E2E_GATE_PASSWORD = 'e2e-gate-password'
export const STORAGE_STATE = path.join(dirname, 'e2e/.auth/unlocked.json')

const PERSIST_DIR = '.wrangler-e2e'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // Unset in normal use — Playwright resolves its own downloaded browser.
    // Only for environments (like sandboxes) that pre-bundle a Chromium
    // revision that doesn't match this package's pinned version.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  webServer: {
    // A clean D1 every run: the gate rate-limiter caps at 8 attempts per
    // 10 minutes (src/lib/db.ts), and every request from `wrangler dev`
    // shares one clientAddress, so a persisted state directory would lock
    // the suite out after ~8 local re-runs. Build first — `wrangler dev`
    // serves the Worker astro build produces, it doesn't build on its own.
    command: `rm -rf ${PERSIST_DIR} && npm run build && npx wrangler d1 migrations apply nuage-athletics --local --persist-to ${PERSIST_DIR} && npx wrangler dev --local --port ${PORT} --persist-to ${PERSIST_DIR} --var SITE_PASSWORD:${E2E_GATE_PASSWORD} --show-interactive-dev-session=false`,
    // /robots.txt is in OPEN_PREFIXES (src/lib/gate.ts) so it always
    // returns 200 regardless of lock state — / returns 401 while locked,
    // which most webServer readiness checks would treat as not-ready.
    url: `${BASE_URL}/robots.txt`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { CI: 'true' },
  },
  projects: [
    {
      name: 'a11y',
      // Without this, the default testMatch ('**/*.e2e.ts') also picks up
      // the other two projects' spec files and runs them here too — under
      // this project's reducedMotion: 'reduce', which is exactly the
      // condition sky-motion.e2e.ts exists to assert is NOT the case.
      // mobile-layout.e2e.ts is excluded for the same reason: it needs the
      // 'mobile' project's viewport, not this project's Desktop Chrome one.
      testIgnore: ['**/sky-motion.e2e.ts', '**/forced-colors.e2e.ts', '**/mobile-layout.e2e.ts'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
        // Playwright's Chromium has WebGL2 via SwiftShader, so without this
        // the full sky fluid sim (src/components/sky/engine.ts) would mount
        // on the runner, pin the CPU, and let its give-up path flip
        // #sky-toggle's `hidden` mid-scan. `reduce` matches
        // osPrefersNoMotion() in src/components/sky/prefs.ts, which keeps
        // the engine from ever loading — deterministic and fast, and it's
        // the fallback most real users see anyway.
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
    {
      name: 'a11y-motion',
      testMatch: '**/sky-motion.e2e.ts',
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
    },
    {
      name: 'a11y-forced-colors',
      testMatch: '**/forced-colors.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
        contextOptions: { forcedColors: 'active', reducedMotion: 'reduce' },
      },
    },
    {
      // Chromium can't emulate iOS safe-area insets, so this catches
      // sticky/opacity/offset regressions in the header only — the
      // env(safe-area-inset-*) padding itself still needs on-device
      // verification (see mobile-layout.e2e.ts).
      name: 'mobile',
      testMatch: '**/mobile-layout.e2e.ts',
      use: {
        ...devices['Pixel 5'],
        storageState: STORAGE_STATE,
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
  ],
})
