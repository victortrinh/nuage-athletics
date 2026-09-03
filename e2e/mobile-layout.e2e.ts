import { test, expect } from '@playwright/test'
import { ROUTES } from '../src/i18n/utils'

/**
 * Regression coverage for the sticky, opaque top bar (Base.astro). A sticky
 * header is *meant* to have page content scroll underneath it as the page
 * scrolls (see the product h1, which passes behind it) — the invariant this
 * guards is that the header visually covers whatever's behind it rather than
 * letting it show through, not that content never reaches the header's
 * y-range. Runs at a phone viewport (the 'mobile' project) because the
 * collision this guards against is iOS-Safari-specific.
 *
 * Chromium cannot emulate iOS safe-area insets, so this cannot verify the
 * env(safe-area-inset-top) padding itself (pt-safe, global.css) — only that
 * the header stays sticky, opaque, and stacked above scrolled content. The
 * inset padding needs on-device verification on an actual notched iPhone.
 */
test('header stays sticky and opaquely covers scrolled content', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const header = page.locator('header')
  await expect(header).toHaveCSS('position', 'sticky')

  const bgColor = await header.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bgColor, 'header background must be opaque, not transparent').not.toBe(
    'rgba(0, 0, 0, 0)'
  )

  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  const headerBox = await header.boundingBox()
  expect(headerBox).not.toBeNull()
  // The header never scrolls away...
  expect(headerBox!.y).toBe(0)

  // ...and a point inside its band resolves to the header, not to whatever
  // page content has scrolled up behind it — i.e. the header actually
  // occludes it rather than letting it show through a transparent band.
  const midX = headerBox!.x + headerBox!.width / 2
  const midY = headerBox!.y + headerBox!.height / 2
  const hitsHeader = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest('header'),
    [midX, midY]
  )
  expect(hitsHeader, 'a point inside the header band should hit the header, not scrolled content').toBe(true)
})

test('#content has a scroll-margin clearing the sticky header', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const scrollMarginTop = await page
    .locator('#content')
    .evaluate((el) => getComputedStyle(el).scrollMarginTop)

  expect(scrollMarginTop).not.toBe('0px')
})
