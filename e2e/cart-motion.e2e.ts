import { test, expect } from '@playwright/test'
import { ROUTES } from '../src/i18n/utils'
import { E2E_PREVIEW_PASSWORD, NUDGE_DISMISSED } from '../playwright.config'

/**
 * The header cart link's confirmation pulse (`.cart-bump` / `cart-ring` in
 * global.css) — the whole visible answer to a cart change now that the buy
 * button has no "Added" state (#74).
 *
 * This runs in the a11y-motion project for the same reason sky-motion.e2e.ts
 * does: every other project sets reducedMotion: 'reduce', under which these
 * keyframes deliberately never resolve. behavior.e2e.ts holds the
 * mirror-image assertion — that nothing animates under `reduce` — so the
 * two halves of the motion gate are pinned from both sides.
 *
 * Asserted by listening for `animationstart` rather than sampling
 * getAnimations() after the fact: both animations are under 550ms, so a
 * poll that arrives late would read an empty list and fail for a reason
 * that has nothing to do with the rule being tested. animationstart bubbles
 * (and fires for pseudo-element animations too, which is the only way to
 * see the ring at all — it is drawn on #cart-link::after).
 */
async function recordAnimations(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as Record<string, unknown>).naAnimations = seen
    document.addEventListener('animationstart', (event) => {
      seen.push((event as AnimationEvent).animationName)
    })
  })
}

function recorded(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).naAnimations as string[]
  )
}

test('adding to the cart bumps the header link and pulses a ring out of it', async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: NUDGE_DISMISSED })
  const page = await context.newPage()
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  await recordAnimations(page)

  await page.getByRole('radiogroup', { name: 'Taille' }).locator('label').filter({ hasText: 'M' }).click()
  await page.getByRole('button', { name: 'Ajouter au panier', exact: true }).click()

  await expect(page.getByRole('link', { name: /Panier \(1\)/ })).toBeVisible()
  await expect.poll(() => recorded(page)).toEqual(expect.arrayContaining(['cart-bump', 'cart-ring']))

  await context.close()
})

/**
 * The ring has to be able to fire twice in a row: the script removes the
 * class, forces a reflow and re-adds it precisely so a second add doesn't
 * land on an element that is already "on" — a state a CSS animation would
 * otherwise refuse to restart from.
 */
test('a second add restarts the pulse rather than sitting on the first', async ({ browser }) => {
  const context = await browser.newContext({ storageState: NUDGE_DISMISSED })
  const page = await context.newPage()
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const sizes = page.getByRole('radiogroup', { name: 'Taille' })
  const button = page.getByRole('button', { name: 'Ajouter au panier', exact: true })

  await sizes.locator('label').filter({ hasText: 'M' }).first().click()
  await button.click()
  await expect(page.getByRole('link', { name: /Panier \(1\)/ })).toBeVisible()

  // Only now start recording, so nothing from the first add can be counted
  // toward the second — and wait out the first pulse for the same reason.
  await page.waitForTimeout(600)
  await recordAnimations(page)

  await sizes.locator('label').filter({ hasText: 'L' }).first().click()
  await button.click()
  await expect(page.getByRole('link', { name: /Panier \(2\)/ })).toBeVisible()

  await expect.poll(() => recorded(page)).toEqual(expect.arrayContaining(['cart-bump', 'cart-ring']))

  await context.close()
})
