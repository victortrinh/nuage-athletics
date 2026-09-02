import { test, expect } from '@playwright/test'
import { ROUTES } from '../src/i18n/utils'

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
  await page.goto(ROUTES.gate['fr-CA'])

  const indicator = page.locator('div.size-4')
  const unchecked = await indicator.evaluate((el) => getComputedStyle(el).backgroundColor)

  await page.getByRole('checkbox').focus()
  await page.keyboard.press('Space')

  const checked = await indicator.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(checked).not.toBe(unchecked)

  const svg = indicator.locator('svg')
  await expect(svg).toBeVisible()
})
