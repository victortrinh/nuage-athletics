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
          // The gate under test. SITE_LOCKED stays "true" here so the
          // endpoint's locked-only behaviour is what gets exercised.
          SITE_LOCKED: 'true',
          SITE_PASSWORD: 'test-gate-password',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts', './test/stub-resend.ts'],
    // Default excludes don't cover nested worktrees under .worktrees/, whose
    // own test/ directories would otherwise be discovered and run twice.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
  },
})
