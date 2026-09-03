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
 *
 * It is also the only project that runs without reducedMotion: 'reduce', so
 * it is where the site's `motion-safe` hover animations can be asserted to
 * actually happen. behavior.e2e.ts holds the mirror-image assertions — that
 * none of them move under a reduced-motion preference.
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

/**
 * The sky toggle is an icon with no visible label, so the wind lines are
 * the only thing that tells a sighted visitor which of the two states the
 * button is offering. They used to be toggled with the `hidden` attribute,
 * which is display:none and animates out of nothing; they are now driven
 * off data-paused on the button so the change can be a 300ms drift.
 */
test('the sky toggle blows its wind lines in when the sky is paused', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const toggle = page.locator('#sky-toggle')
  await expect(toggle).toBeVisible({ timeout: 15_000 })

  const wind = toggle.locator('.sky-icon-wind')
  await expect(toggle).toHaveAttribute('data-paused', 'false')
  await expect(wind).toHaveCSS('opacity', '0')
  // Still in the layout — the whole point of dropping `hidden` — so there
  // is something for the transition to move.
  await expect(wind).not.toHaveCSS('display', 'none')

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-paused', 'true')
  await expect(wind).toHaveCSS('opacity', '1')

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-paused', 'false')
  await expect(wind).toHaveCSS('opacity', '0')
})

/**
 * The positive half of the reduced-motion assertion in behavior.e2e.ts: the
 * dot of the wordmark floats when the header's home link is hovered, and
 * (below) when it is reached by keyboard, so the two input methods get the
 * same feedback.
 */
test('the wordmark dot floats on hover and on keyboard focus', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const link = page.getByRole('link', { name: 'Nuage Athletics' })
  const dot = page.locator('header .logo-dot')
  await expect(dot).toHaveCSS('translate', 'none')

  // Tabbed to, not .focus()'d: :focus-visible is decided by how the element
  // was reached, and a scripted focus after a mouse interaction doesn't
  // match it in Chromium. Two stops — the skip link is first (see
  // behavior.e2e.ts), the home link second.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
  await expect(dot).not.toHaveCSS('translate', 'none')

  await page.locator('main').click({ position: { x: 5, y: 5 } })
  await page.mouse.move(0, 300)
  await expect(dot).toHaveCSS('translate', 'none')

  await link.hover()
  await expect(dot).not.toHaveCSS('translate', 'none')
})
