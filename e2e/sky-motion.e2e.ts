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
  // match it in Chromium. Three stops — the skip link is first (see
  // behavior.e2e.ts), the nav drawer trigger second (#nav-trigger,
  // Base.astro, first thing in the header's grid), the home link third.
  await page.keyboard.press('Tab')
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

/**
 * The nav drawer trigger's three strokes (#nav-trigger, Base.astro, drawn by
 * NavIcon.astro) are the hamburger equivalent of the sky toggle's wind lines
 * above — they drift on hover instead of appearing, and only under real
 * motion preferences. behavior.e2e.ts holds the mirror assertion that they
 * stay put under prefers-reduced-motion.
 */
test('the nav trigger’s strokes drift on hover', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const stroke = page.getByRole('button', { name: 'Menu' }).locator('line').first()
  await expect(stroke).toHaveCSS('translate', 'none')

  await page.getByRole('button', { name: 'Menu' }).hover()
  await expect(stroke).not.toHaveCSS('translate', 'none')
})

/**
 * Regression test for the engine reading a backgrounded tab as a stalled
 * renderer and giving up on it (src/components/sky/engine.ts, the
 * SLOW_MS_HARD_CEILING path fed by an unresynced `lastTime`).
 *
 * Real OS-level tab backgrounding isn't reliably reproducible from a
 * headless Playwright run — switching pages with bringToFront() doesn't
 * dependably flip document.visibilityState under headless Chromium, since
 * there's no real window compositor deciding what's "in front". The engine's
 * only contract with the browser is `document.visibilityState` plus the
 * `visibilitychange` event, so this drives that interface directly rather
 * than chasing OS-level backgrounding semantics a headless run can't give it.
 */
test('the sky survives being backgrounded for longer than the old degrade ceiling', async ({
  page,
}) => {
  await page.goto(ROUTES.home['fr-CA'])

  const canvas = page.locator('.sky-canvas')
  await expect(canvas).toHaveCSS('opacity', '1', { timeout: 15_000 })

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  // Comfortably past SLOW_MS_HARD_CEILING (3000ms) in engine.ts — the rAF
  // loop is genuinely suspended for this whole span since onVisibility
  // stops rescheduling once `hidden` is true.
  await page.waitForTimeout(4_000)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  await expect(canvas).toHaveCSS('opacity', '1')
  const gaveUp = await page.evaluate(() => sessionStorage.getItem('na-sky-gaveup'))
  expect(gaveUp).toBeNull()
})

/**
 * Regression test for the shader clock running on absolute wall-clock time
 * (`(now - mountTime) / 1000` in the old engine.ts): pausing didn't stop the
 * clock, so resuming after a few seconds snapped the cloud field forward
 * instead of resuming from where it froze. preserveDrawingBuffer: true
 * (engine.ts) exists specifically so a test can read the canvas back like
 * this.
 */
test('pausing and resuming the sky does not jump the cloud field', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const toggle = page.locator('#sky-toggle')
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.sky-canvas')).toHaveCSS('opacity', '1')

  const sampleCanvas = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas.sky-canvas') as HTMLCanvasElement
      const off = document.createElement('canvas')
      off.width = 32
      off.height = 32
      const ctx = off.getContext('2d')!
      ctx.drawImage(canvas, 0, 0, 32, 32)
      return Array.from(ctx.getImageData(0, 0, 32, 32).data)
    })

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-paused', 'true')

  const before = await sampleCanvas()
  await page.waitForTimeout(3_000)

  await toggle.click()
  await expect(toggle).toHaveAttribute('data-paused', 'false')
  // Let the resumed loop paint a frame.
  await page.waitForTimeout(200)

  const after = await sampleCanvas()

  let totalDiff = 0
  for (let i = 0; i < before.length; i++) totalDiff += Math.abs(before[i] - after[i])
  const meanDiff = totalDiff / before.length

  // A frozen-then-resumed field differs only by render noise; a field that
  // jumped 3s of drift differs by a lot more across a 32x32 sample.
  expect(meanDiff).toBeLessThan(2)
})
