import { test, expect } from '@playwright/test'
import { ROUTES } from '../src/i18n/utils'
import { E2E_PREVIEW_PASSWORD } from '../playwright.config'

/**
 * SignupForm.tsx's consent checkbox used to be a native
 * <input type="checkbox">, which Windows High Contrast draws correctly for
 * free. Replacing it with a custom RAC indicator (src/components/ui/
 * checkbox.tsx) risks the classic forced-colors regression: a background
 * that gets stripped to the same color whether checked or not. This
 * verifies the explicit forced-colors: rules in checkbox.tsx actually keep
 * the two states visually distinct.
 */
test.use({ contextOptions: { forcedColors: 'active', reducedMotion: 'reduce' } })

test('consent checkbox stays visually distinct checked vs unchecked in forced-colors', async ({
  page,
}) => {
  await page.goto(ROUTES.home['fr-CA'])
  // SignupForm now lives only inside the bottom-anchored SignupPrompt
  // (SignupPrompt.astro), which reveals itself for real ~6s after load —
  // see the matching helper/comment in behavior.e2e.ts. Waiting for the
  // island to drop its ssr attribute matters here specifically: this test
  // presses Space to toggle the checkbox, and a keypress that lands before
  // hydration's onChange is listening is a silent no-op, not a failure —
  // which is exactly the kind of thing that reads as "flaky" without this.
  await expect(page.locator('#signup-prompt')).toBeVisible({ timeout: 8_000 })
  await page.locator('#signup-prompt astro-island:not([ssr])').waitFor({ state: 'attached' })

  const indicator = page.locator('div.size-4')
  const unchecked = await indicator.evaluate((el) => getComputedStyle(el).backgroundColor)

  await page.getByRole('checkbox').focus()
  await page.keyboard.press('Space')

  // React's state flip, re-render and style recalc aren't synchronous with
  // the keypress — a single read right after it is a race that this test
  // used to win often enough to look reliable, until running this suite
  // back-to-back many times in one session left enough system load for the
  // race to actually lose. Poll instead of reading once.
  await expect
    .poll(() => indicator.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(unchecked)

  const svg = indicator.locator('svg')
  await expect(svg).toBeVisible()
})

/**
 * radio-group.tsx's selected state was pure bg-ink/text-paper with no
 * forced-colors: rules — in forced-colors mode both flatten to system
 * colors and selected/unselected become indistinguishable. Latent with one
 * radiogroup (size), made real by adding a second, more prominent one
 * (fit) — see the forced-colors: additions in radio-group.tsx.
 */
test('fit radio stays visually distinct selected vs unselected in forced-colors', async ({ page }) => {
  // The fit picker only renders once there's something to buy — see the
  // note in ProductView.astro — so this exercises it under preview.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  // The background/data-selected styling lives on the wrapping <label>
  // (radio-group.tsx), not on the radio role's own element — RAC renders
  // the real <input> inside a visually-hidden span. Same distinction the
  // consent-checkbox test above makes by targeting div.size-4 instead of
  // the checkbox role.
  const fitGroup = page.getByRole('radiogroup', { name: 'Coupe' })
  const classic = fitGroup.locator('label').filter({ hasText: 'Classique' })
  const crop = fitGroup.locator('label').filter({ hasText: 'Crop' })

  const selectedBg = await classic.evaluate((el) => getComputedStyle(el).backgroundColor)
  const unselectedBg = await crop.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(selectedBg).not.toBe(unselectedBg)
})

/**
 * Same failure mode, different widget: the carousel's pagination marks the
 * current slide with bg-ink alone (ProductCarousel.tsx) unless the
 * forced-colors Highlight/GrayText pair also applies.
 *
 * Reads the marker `<span>`, not the button: since the numbered pagination
 * became dots, the button is only the tap target and carries no background
 * of its own — comparing the buttons would compare two transparents and
 * pass no matter how the markers themselves were coloured.
 */
test('current pagination marker stays visually distinct from the others in forced-colors', async ({
  page,
}) => {
  await page.goto(ROUTES.home['fr-CA'])

  const markers = page.getByRole('button', { name: /^Image \d de 2$/ }).locator('span')
  const current = await markers.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)
  const other = await markers.nth(1).evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(current).not.toBe(other)
})

/**
 * The drawer's visible panel (#nav-drawer-panel, Base.astro — the child div
 * inside the full-viewport #nav-drawer dialog) relies on bg-paper to stay a
 * legible ground for its text over the WebGL sky — in forced-colors mode
 * that background is stripped, so the explicit border
 * (forced-colors:border-[CanvasText]) is what keeps the panel visually
 * distinct from the page behind it.
 */
test('nav drawer panel keeps a visible edge in forced-colors', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])
  await page.getByRole('button', { name: 'Menu' }).click()

  const panel = page.locator('#nav-drawer-panel')
  const borderStyle = await panel.evaluate((el) => getComputedStyle(el).borderRightStyle)
  expect(borderStyle).not.toBe('none')
})
