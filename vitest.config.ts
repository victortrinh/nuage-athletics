import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

const migrationsPath = path.join(__dirname, 'migrations')
const migrations = await readD1Migrations(migrationsPath)

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // Fixed test-only values so webhook tests can generate valid
          // Stripe signatures without hitting the real API.
          STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
          STRIPE_WEBHOOK_SECRET: 'whsec_test_not_a_real_secret',
          // Fixed test-only value so the Resend path runs instead of the
          // no-key dev branch. test/stub-resend.ts intercepts the request.
          RESEND_API_KEY: 're_test_not_a_real_key',
          // Fixed test-only value so preview tests can mint valid tokens.
          PREVIEW_PASSWORD: 'test-preview-password',
          // Fixed test-only value so cart tests (test/cart.test.ts) can
          // exercise the real commerceEnabled → getLiveProduct → cart path
          // with a stubbed fetch, the same reasoning STRIPE_SECRET_KEY above
          // follows. COMMERCE_ENABLED stays 'false' (from wrangler.toml) —
          // these tests carry a preview cookie instead, same as the real
          // founder-preview path.
          SHOPIFY_STOREFRONT_TOKEN: 'storefront-vitest-token',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts', './test/stub-resend.ts'],
    // Default excludes don't cover nested worktrees under .worktrees/, whose
    // own test/ directories would otherwise be discovered and run twice.
    // e2e/ holds Playwright specs, which vitest's default include glob would
    // otherwise collect and try to run inside the Workers pool.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**', '**/e2e/**'],
  },
  resolve: {
    // Astro/Vite read the @/* path from tsconfig automatically; Vite's own
    // config resolution does not, so it's mirrored here for any test that
    // ends up importing through the alias.
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
