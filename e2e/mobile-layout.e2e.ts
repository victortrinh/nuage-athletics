import { test, expect } from '@playwright/test'
import { ROUTES } from '../src/i18n/utils'

/**
 * Regression coverage for the sticky, see-through top bar (Base.astro). The
 * header used to be flatly opaque (bg-paper); it now paints an opaque cap
 * only across env(safe-area-inset-top) and fades to fully transparent below
 * that — see the header-veil utility in global.css — so the sky reads
 * unbroken beneath it. The invariant this guards is no longer "the header is
 * opaque": it's that the header stays sticky and on top of the stacking
 * order, so it keeps *receiving* pointer events over scrolled content even
 * though it no longer visually occludes it. Runs at a phone viewport (the
 * 'mobile' project) because the collision the veil itself guards against —
 * scrolled content rendering under the iOS status bar — is iOS-Safari-
 * specific.
 *
 * Chromium cannot emulate iOS safe-area insets, so this cannot verify the
 * env(safe-area-inset-top) cap itself (header-veil, pt-safe, global.css) —
 * only that the header stays sticky, see-through, and stacked above
 * scrolled content. The cap needs on-device verification on an actual
 * notched iPhone: the status-bar band should stay solid paper with no page
 * content visible behind the glyphs, in both portrait and landscape.
 */
test('header stays sticky, see-through, and on top of scrolled content', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const header = page.locator('header')
  await expect(header).toHaveCSS('position', 'sticky')

  // The flat backgroundColor is gone — the veil is a background-image, not
  // a fill — but the gradient layers that replace it must still be there.
  const bgColor = await header.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bgColor, 'the header has no flat background fill anymore').toBe('rgba(0, 0, 0, 0)')

  const bgImage = await header.evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(bgImage, 'header-veil’s two gradient layers must be applied').toContain(
    'linear-gradient'
  )

  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  const headerBox = await header.boundingBox()
  expect(headerBox).not.toBeNull()
  // The header never scrolls away...
  expect(headerBox!.y).toBe(0)

  // ...and stays on top of the stacking order: a point inside its band still
  // resolves to the header, not to whatever page content has scrolled up
  // behind it, even though the header no longer paints over it visually.
  const midX = headerBox!.x + headerBox!.width / 2
  const midY = headerBox!.y + headerBox!.height / 2
  const hitsHeader = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest('header'),
    [midX, midY]
  )
  expect(
    hitsHeader,
    'a point inside the header band should still hit the header, not scrolled content'
  ).toBe(true)
})

test('#content has a scroll-margin clearing the sticky header', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const scrollMarginTop = await page
    .locator('#content')
    .evaluate((el) => getComputedStyle(el).scrollMarginTop)

  expect(scrollMarginTop).not.toBe('0px')
})
