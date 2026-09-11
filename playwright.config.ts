import { defineConfig, devices } from '@playwright/test'
import { STOREFRONT_STUB_PORT, STOREFRONT_STUB_TOKEN } from './e2e/storefront-stub.ts'

const PORT = 8791
export const BASE_URL = `http://localhost:${PORT}`
// Not a real secret — only ever used against a throwaway local D1 instance
// started fresh for this test run (see the --persist-to path below).
export const E2E_PREVIEW_PASSWORD = 'e2e-preview-password'

/**
 * src/pages/index.astro nudges an English-primary browser from / to /en/ once,
 * then records `na-locale-nudge` in localStorage and never does it again. The
 * runner's browser reports en-US, so without this every visit to a French route
 * would land on the English one and any assertion about French copy would fail.
 *
 * This used to happen by accident: the suite logged into the pre-launch gate in
 * a globalSetup and saved the whole storageState, flag included. The gate is
 * gone, so the flag is stated outright — the nudge itself is real behaviour and
 * still fires for real visitors.
 */
export const NUDGE_DISMISSED = {
  cookies: [],
  origins: [
    { origin: BASE_URL, localStorage: [{ name: 'na-locale-nudge', value: '1' }] },
  ],
}

const PERSIST_DIR = '.wrangler-e2e'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    storageState: NUDGE_DISMISSED,
    trace: 'retain-on-failure',
    // Unset in normal use — Playwright resolves its own downloaded browser.
    // Only for environments (like sandboxes) that pre-bundle a Chromium
    // revision that doesn't match this package's pinned version.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  webServer: [
    {
      // Shopify stands between the preview cookie and the buy band now: no
      // Storefront answer, no price, no band (src/lib/commerce/index.ts). This
      // serves the one query the adapter sends, so the suite exercises the
      // real join instead of a bypass. See e2e/storefront-stub.ts.
      command: 'node e2e/storefront-stub.ts',
      url: `http://127.0.0.1:${STOREFRONT_STUB_PORT}/`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // A clean D1 every run: the preview rate-limiter caps at 8 attempts per
      // 10 minutes (src/lib/db.ts), and every request from `wrangler dev`
      // shares one clientAddress, so a persisted state directory would lock
      // the suite out after ~8 local re-runs. Build first — `wrangler dev`
      // serves the Worker astro build produces, it doesn't build on its own.
      command: `rm -rf ${PERSIST_DIR} && npm run build && npx wrangler d1 migrations apply nuage-athletics --local --persist-to ${PERSIST_DIR} && npx wrangler dev --local --port ${PORT} --persist-to ${PERSIST_DIR} --var PREVIEW_PASSWORD:${E2E_PREVIEW_PASSWORD} --var SHOPIFY_STORE_DOMAIN:127.0.0.1:${STOREFRONT_STUB_PORT} --var SHOPIFY_STOREFRONT_TOKEN:${STOREFRONT_STUB_TOKEN} --show-interactive-dev-session=false`,
      // A cheap static route to poll for readiness; the site is public now,
      // so any path would do.
      url: `${BASE_URL}/robots.txt`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { CI: 'true' },
    },
  ],
  projects: [
    {
      name: 'a11y',
      // Without this, the default testMatch ('**/*.e2e.ts') also picks up
      // the other two projects' spec files and runs them here too — under
      // this project's reducedMotion: 'reduce', which is exactly the
      // condition sky-motion.e2e.ts exists to assert is NOT the case.
      // mobile-layout.e2e.ts is excluded for the same reason: it needs the
      // 'mobile' project's viewport, not this project's Desktop Chrome one.
      testIgnore: [
        '**/sky-motion.e2e.ts',
        '**/cart-motion.e2e.ts',
        '**/forced-colors.e2e.ts',
        '**/mobile-layout.e2e.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
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
      // The only project without reducedMotion: 'reduce', so it is where
      // every `motion-safe` behaviour on the site gets asserted to actually
      // happen — the sky's toggle, and the cart link's confirmation pulse.
      testMatch: ['**/sky-motion.e2e.ts', '**/cart-motion.e2e.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'a11y-forced-colors',
      testMatch: '**/forced-colors.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
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
        contextOptions: { reducedMotion: 'reduce' },
      },
    },
  ],
})
