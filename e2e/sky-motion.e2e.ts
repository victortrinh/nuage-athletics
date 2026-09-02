import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ROUTES } from '../src/i18n/utils'

/**
 * The a11y project defaults to reducedMotion: 'reduce' so the sky's fluid
 * sim never mounts (see the comment in playwright.config.ts) — deterministic,
 * but it never exercises the toggle. This project runs with real motion
 * preferences to confirm the toggle actually appears and stays accessible
 * once the engine has a chance to load. Playwright's Chromium has WebGL2 via
 * SwiftShader, so skyBlockedByOs() (src/components/sky/prefs.ts) evaluates
 * false here and the engine attempts to mount, same as a real visitor's
 * browser would.
 */
test('sky toggle appears with an accessible name once motion is allowed', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const toggle = page.locator('#sky-toggle')
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await expect(toggle).toHaveAccessibleName(/./)

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('iframe[src*="challenges.cloudflare.com"]')
    .analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
})
