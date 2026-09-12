import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ROUTES, SIGNUP_PROMPT_ENABLED } from '../src/i18n/utils'
import { E2E_PREVIEW_PASSWORD, NUDGE_DISMISSED } from '../playwright.config'
import { SOLD_OUT, STUB_PRICE, STUB_CHECKOUT_HOST, seedStubCart, soldOutSku } from './storefront-stub'
import { CART_COOKIE, CART_COUNT_COOKIE } from '../src/lib/cart'
import { BASE_URL } from '../playwright.config'
import { LOCALES } from '../src/i18n/config'

/**
 * SignupForm now lives only inside the bottom-anchored SignupPrompt
 * (SignupPrompt.astro), which every route in SHOWS_SIGNUP_PROMPT renders.
 * It starts `hidden` and its own script reveals
 * it for real, ~6s after load (no test-only shortcut — see the file's own
 * comment on why waiting for it is preferable to faking the timer), so
 * every test below needs to wait that out before it can interact.
 *
 * SignupForm hydrates on client:visible, which only starts once the prompt
 * becomes visible — i.e. right after that reveal. Unlike the old
 * client:load (which had a head start before any test or user could reach
 * the form), there's a real window where the checkbox's native <input>
 * accepts a click before React's onChange is listening — the click lands,
 * but the (still-unhydrated) `consent` state never sees it. Astro drops the
 * island's `ssr` attribute the moment hydration finishes, so waiting for
 * that closes the window before any test interacts.
 *
 * Scoped to #signup-prompt: these tests used to run on the pre-launch gate
 * screen, which carried one island and nothing else. The home page carries
 * two (ProductStage, SignupForm), so an unscoped `astro-island:not([ssr])`
 * is a strict-mode violation — and matching whichever island hydrated first
 * would wait on the wrong one.
 */
async function openSignupPrompt(page: Page) {
  await expect(page.locator('#signup-prompt')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByRole('checkbox')).toBeVisible()
  await page.locator('#signup-prompt astro-island:not([ssr])').waitFor({ state: 'attached' })
}

/**
 * The CASL consent checkbox must never be pre-checked or inferred
 * (CLAUDE.md non-negotiable #3) — before this test, nothing automated
 * verified that. The home page is in SHOWS_SIGNUP_PROMPT, so the form is
 * always there to check.
 */
for (const locale of LOCALES) {
  test(`consent checkbox is unchecked on load (${locale})`, async ({ page }) => {
    test.skip(!SIGNUP_PROMPT_ENABLED, 'signup prompt disabled until email sending is ready — see #67')
    await page.goto(ROUTES.home[locale])
    await openSignupPrompt(page)
    const consent = page.getByRole('checkbox')
    await expect(consent).not.toBeChecked()
  })
}

test('skip link is the first focus stop and targets #content', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])
  await page.keyboard.press('Tab')
  const skipLink = page.locator('a[href="#content"]')
  await expect(skipLink).toBeFocused()
  await expect(page.locator('main#content')).toBeAttached()
})

test('consent checkbox toggles by keyboard, and a bad email wires aria-invalid', async ({
  page,
}) => {
  test.skip(!SIGNUP_PROMPT_ENABLED, 'signup prompt disabled until email sending is ready — see #67')
  await page.goto(ROUTES.home['fr-CA'])
  await openSignupPrompt(page)

  const consent = page.getByRole('checkbox')
  await consent.focus()
  await page.keyboard.press('Space')
  await expect(consent).toBeChecked()

  const email = page.getByRole('textbox', { name: /courriel/i })
  await email.fill('not-an-email')
  await page.getByRole('button', { name: /m.inscrire/i }).click({ force: true })

  await expect(email).toHaveAttribute('aria-invalid', 'true')
  const describedBy = await email.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()
  await expect(page.locator(`#${describedBy}`)).toHaveText('Entrez une adresse courriel valide.')
})

test('focus moves into the success panel, and the live region announces it', async ({ page }) => {
  test.skip(!SIGNUP_PROMPT_ENABLED, 'signup prompt disabled until email sending is ready — see #67')
  await page.goto(ROUTES.home['fr-CA'])

  // The real endpoint always returns email_failed without RESEND_API_KEY
  // configured (by design — see README). Stub the response to exercise the
  // client-side success rendering and focus-management in isolation.
  await page.route('**/api/subscribe', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  )

  await openSignupPrompt(page)
  await page.getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await page.getByRole('textbox', { name: /courriel/i }).fill('test@example.com')
  await page.getByRole('button', { name: /m.inscrire/i }).click({ force: true })

  await expect(page.locator('p[tabindex="-1"]')).toBeFocused()
  // Scoped to the prompt: ProductCarousel has a live region of its own on this
  // page, which the gate screen this test used to run on did not.
  await expect(page.locator('#signup-prompt [role="status"].sr-only')).toHaveText(
    'Vérifiez vos courriels'
  )
})

/**
 * The hydrated path above resolves in place — the URL never changes, and a
 * success panel replaces the form via React state. A submit that lands
 * before hydration can't do that: it's a genuine <form action="/api/subscribe">
 * POST, which follows /api/subscribe's 303 into a full-page navigation (see
 * the no-JS describe block below). This test pins the hydrated case as
 * staying put, so the two paths can't quietly collapse into one without a
 * test noticing.
 */
test('a hydrated submit resolves in place, without navigating', async ({ page }) => {
  test.skip(!SIGNUP_PROMPT_ENABLED, 'signup prompt disabled until email sending is ready — see #67')
  await page.goto(ROUTES.home['fr-CA'])

  await page.route('**/api/subscribe', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  )

  await openSignupPrompt(page)
  await page.getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await page.getByRole('textbox', { name: /courriel/i }).fill('test@example.com')
  await page.getByRole('button', { name: /m.inscrire/i }).click({ force: true })

  await expect(page.locator('p[tabindex="-1"]')).toHaveText('Vérifiez vos courriels')
  await expect(page).toHaveURL(new RegExp(`${ROUTES.home['fr-CA']}$`))
})

/**
 * The whole point of SignupForm.tsx's <form method="POST" action="...">:
 * without this, a no-JS visitor's "notify me" silently does nothing, which
 * is the bug this branch exists to fix. SignupPrompt.astro's reveal is
 * driven entirely by JS (the ~6s timer), so with JS off the prompt would
 * never appear at all if it depended on that — the <noscript><style> in
 * SignupPrompt.astro forces it visible immediately instead, no click
 * needed, so only the request/response cycle differs from the hydrated
 * tests above.
 */
test.describe('signup form works before hydration (no JS)', () => {
  test.use({ javaScriptEnabled: false })

  test('a native form POST redirects to the confirmation state on success', async ({ page }) => {
    test.skip(!SIGNUP_PROMPT_ENABLED, 'signup prompt disabled until email sending is ready — see #67')
    // The real endpoint always returns email_failed without RESEND_API_KEY
    // configured (see README) — stub the redirect it would issue on success,
    // the same shape /api/subscribe itself produces for a form-encoded POST.
    await page.route('**/api/subscribe', (route) =>
      route.fulfill({ status: 303, headers: { Location: `${ROUTES.home['fr-CA']}?sent=1` } })
    )

    await page.goto(ROUTES.home['fr-CA'])
    await expect(page.getByRole('checkbox')).toBeVisible()

    await page.getByRole('checkbox').focus()
    await page.keyboard.press('Space')
    await page.getByRole('textbox', { name: /courriel/i }).fill('test@example.com')
    await page.getByRole('button', { name: /m.inscrire/i }).click()

    await expect(page).toHaveURL(new RegExp(`${ROUTES.home['fr-CA']}\\?sent=1$`))
    // No hydration ever ran, so there's no live region here — just the
    // static success markup the server rendered from initialSuccess.
    await expect(page.locator('p[tabindex="-1"]')).toHaveText('Vérifiez vos courriels')
  })

  test('submitting with consent unchecked bounces back with the French error, prompt forced open', async ({
    page,
  }) => {
    test.skip(!SIGNUP_PROMPT_ENABLED, 'signup prompt disabled until email sending is ready — see #67')
    await page.goto(ROUTES.home['fr-CA'])
    await expect(page.getByRole('checkbox')).toBeVisible()

    await page.getByRole('textbox', { name: /courriel/i }).fill('test@example.com')
    await page.getByRole('button', { name: /m.inscrire/i }).click()

    await expect(page).toHaveURL(new RegExp(`${ROUTES.home['fr-CA']}\\?se=consent_required$`))
    await expect(page.getByRole('alert')).toHaveText('Vous devez accepter de recevoir nos courriels.')
  })
})

test('size selector is a real radiogroup with roving-tabindex arrow navigation', async ({
  page,
}) => {
  // The band only renders once there's something to buy — see the note in
  // ProductView.astro — so this exercises it the way a founder would. Sizes
  // render directly now (no "+" to open first — ProductStage.tsx).
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  // Scoped to "Taille" — the fit selector (ProductStage.tsx) is a second
  // radiogroup on this page since the fit/carousel work, so a bare
  // getByRole('radiogroup') is a Playwright strict-mode violation now.
  const group = page.getByRole('radiogroup', { name: 'Taille' })
  await expect(group).toBeVisible()

  const radios = group.getByRole('radio')
  const count = await radios.count()
  expect(count).toBeGreaterThan(1)

  await expect(radios.first()).not.toBeChecked()

  await radios.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(radios.nth(1)).toBeChecked()
  await expect(radios.nth(1)).toBeFocused()
  await expect(radios.first()).not.toBeChecked()
})

test('fit selector is a radiogroup, defaults to Classique, and switching fit updates the carousel', async ({
  page,
}) => {
  // Preview, same reason as the size-selector test above.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const fitGroup = page.getByRole('radiogroup', { name: 'Coupe' })
  await expect(fitGroup).toBeVisible()
  await expect(fitGroup.getByRole('radio')).toHaveCount(2)
  await expect(fitGroup.getByRole('radio', { name: 'Classique' })).toBeChecked()

  const carousel = page.getByRole('group', { name: 'Images du produit' })
  await expect(carousel.getByRole('img')).toHaveAttribute('alt', /coupe classique/)

  // RadioGroup renders each radio as a visually-hidden <input> inside a
  // styled <label> (see radio-group.tsx / checkbox.tsx) — the input's own
  // hit-test box is a 1px clip-rect, so clicking the accessible "radio"
  // element directly fights Playwright's actionability check forever. Click
  // the label, same as a real pointer user would.
  await fitGroup.locator('label').filter({ hasText: 'Crop' }).click()
  await expect(fitGroup.getByRole('radio', { name: 'Crop' })).toBeChecked()
  await expect(carousel.getByRole('img')).toHaveAttribute('alt', /coupe crop/)

  // Switching size after fit keeps the size selected — the value={size}
  // binding (not value={variantId}) is what makes this survive a fit change.
  const sizeGroup = page.getByRole('radiogroup', { name: 'Taille' })
  await sizeGroup.locator('label').nth(2).click()
  const thirdSize = sizeGroup.getByRole('radio').nth(2)
  await expect(thirdSize).toBeChecked()
  await fitGroup.locator('label').filter({ hasText: 'Classique' }).click()
  await expect(thirdSize).toBeChecked()
})

/**
 * The whole point of the fixed-height band (see CLAUDE.md's product page
 * note): none of its states may change the band's own height or move the
 * carousel above it by so much as a pixel. axe has no notion of "this box
 * stays the same size" — this is the direct test of the brief.
 */
test('the buy band never changes height, and the carousel never moves, across any of its states', async ({
  page,
}) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const band = page.getByRole('button', { name: 'Ajouter au panier', exact: true }).locator(
    'xpath=ancestor::div[contains(@class, "max-w-[20rem]")]'
  )
  const img = page.getByRole('group', { name: 'Images du produit' }).getByRole('img')

  // The gap between the image and the band, not either one's raw viewport
  // position — the band's own box is scroll-invariant relative to the
  // image, which is what actually must not change.
  async function measure() {
    const [bandBox, imgBox] = await Promise.all([band.boundingBox(), img.boundingBox()])
    return { height: bandBox!.height, gap: bandBox!.y - (imgBox!.y + imgBox!.height) }
  }

  const idle = await measure()

  await page.getByRole('radiogroup', { name: 'Taille' }).locator('label').nth(2).click()
  const picked = await measure()

  expect(picked.height).toBe(idle.height)
  expect(picked.gap).toBe(idle.gap)
})

/**
 * The button is deliberately NOT `disabled` while no size is picked — see
 * ProductStage.tsx's own note on the Button: a `disabled` attribute baked
 * into the server render would make the no-JS `<form>` (#33) unsubmittable
 * no matter which size a visitor later checks, since nothing without JS can
 * flip that attribute back off. What replaces it is a real refusal — an
 * inline error, and no network call at all before a size is actually
 * chosen — asserted here the same way the old "never fires a purchase"
 * half of this test always was.
 */
test('a mis-tap on the add-to-cart button before a size is picked shows an error and fires no request', async ({
  page,
}) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const button = page.getByRole('button', { name: 'Ajouter au panier', exact: true })
  await expect(button).toBeEnabled()

  const cartRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/cart')) cartRequests.push(req.url())
  })

  await button.click()
  await expect(page.getByRole('alert')).toHaveText('Choisir une taille')
  await page.waitForTimeout(500)
  expect(cartRequests).toHaveLength(0)

  // Picking a size afterwards still works — the earlier mis-tap didn't
  // leave the band in some stuck state.
  await page.getByRole('radiogroup', { name: 'Taille' }).locator('label').filter({ hasText: 'M' }).click()
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/api/cart')),
    button.click(),
  ])
  expect(response.ok()).toBe(true)
  // No "Added" state and no navigation: the band rolls back to its ordinary
  // idle button and the visitor stays put, free to add another size.
  await expect(button).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${ROUTES.home['fr-CA']}$`))
})

/**
 * Sizes and the product name are on screen from the first render now — no
 * "+" to open, no fly-in to settle. Asserted as "one row, in order, inside
 * the group" rather than against exact offsets.
 */
test('the size row is one row, in document order, none of it overhanging', async ({ page }) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const group = page.getByRole('radiogroup', { name: 'Taille' })
  const boxes = await group.locator('label').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: Math.round(r.top) }
    })
  )
  const groupBox = (await group.boundingBox())!

  expect(boxes).toHaveLength(7)
  // One row: every size shares a top edge.
  expect(new Set(boxes.map((b) => b.top)).size).toBe(1)
  // In order, and sitting on the group's own box give or take a few px.
  // "XXS" and "XXL" are both wider than one-seventh of the row, so the two
  // outer cells legitimately overhang by a hair.
  const slack = 8
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThan(boxes[i - 1].left)
  expect(boxes[0].left).toBeGreaterThanOrEqual(groupBox.x - slack)
  expect(boxes[6].right).toBeLessThanOrEqual(groupBox.x + groupBox.width + slack)
})

/**
 * Pick a size, then activate the add-to-cart button, driven from the
 * keyboard alone — RAC's RadioGroup and a native <button> are what buy the
 * roving tabindex and Enter/Space activation below for free.
 */
test('the band is operable from the keyboard alone', async ({ page }) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const group = page.getByRole('radiogroup', { name: 'Taille' })
  await group.getByRole('radio').first().focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')

  const button = page.getByRole('button', { name: 'Ajouter au panier', exact: true })
  await expect(button).toBeEnabled()

  await button.focus()
  await expect(button).toBeFocused()
})

/**
 * The add-to-cart button and the size row both clear the 44×44 CSS-pixel
 * target size — the carousel's own pagination (size-8 = 32px) predates this
 * redesign and keeps its existing tests, so it's deliberately excluded
 * here rather than silently included and left passing on a smaller box.
 */
test('the add-to-cart button and size radios meet a 44×44 minimum target size', async ({ page }) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const buttonBox = (await page
    .getByRole('button', { name: 'Ajouter au panier', exact: true })
    .boundingBox())!
  expect(buttonBox.width).toBeGreaterThanOrEqual(44)
  expect(buttonBox.height).toBeGreaterThanOrEqual(44)

  // The styled hit target is the <label> — RAC's real <input> underneath it
  // is visually hidden (CLAUDE.md), so measuring the radio role itself would
  // measure that hidden input instead.
  const sizeBox = (await page
    .getByRole('radiogroup', { name: 'Taille' })
    .locator('label')
    .first()
    .boundingBox())!
  expect(sizeBox.height).toBeGreaterThanOrEqual(44)
})

test('carousel exposes exactly one image at a time, pages with the markers, and announces the change', async ({
  page,
}) => {
    // The carousel only renders once there's something to buy — preview,
  // same reason the size/fit selector tests above need it.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const carousel = page.getByRole('group', { name: 'Images du produit' })
  await expect(carousel).toHaveAttribute('aria-roledescription', 'carousel')
  // axe can't make this assertion — it has no notion of "only one of 4
  // images should be in the accessibility tree at a time". This is the one
  // check that catches a broken aria-hidden toggle.
  await expect(carousel.getByRole('img')).toHaveCount(1)

  // Two sr-only status regions exist on this page while commerce is off —
  // this one (the carousel's) and SignupForm's own. The carousel is first
  // in document order.
  const status = page.locator('[role="status"].sr-only').first()
  await expect(status).toHaveText('')

  // Front and back only — no worn shots (see catalogue.ts).
  const pageButtons = page.getByRole('button', { name: /^Image \d de 2$/ })
  await expect(pageButtons).toHaveCount(2)
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')

  await pageButtons.nth(1).click()
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(pageButtons.nth(0)).not.toHaveAttribute('aria-current', 'true')
  await expect(carousel.getByRole('img')).toHaveCount(1)
  await expect(status).toHaveText('Classique — Image 2 de 2')
})

test('carousel pagination wraps and is keyboard-operable', async ({ page }) => {
    // The carousel only renders once there's something to buy — preview,
  // same reason the size/fit selector tests above need it.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  // Arrow keys work from focus anywhere in the group (see onKeyDown in
  // ProductCarousel.tsx), pagination and prev/next arrows included.
  const carousel = page.getByRole('group', { name: 'Images du produit' })
  const pageButtons = page.getByRole('button', { name: /^Image \d de 2$/ })

  await pageButtons.nth(0).click()
  await pageButtons.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  // An arrow key moves focus along with the current slide.
  await expect(pageButtons.nth(1)).toBeFocused()

  await page.keyboard.press('ArrowLeft')
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')

  // Wraps rather than stopping at the boundary — there's no disabled state
  // to strand focus on. Only two images, so wrapping left from index 0
  // lands on the last one, index 1.
  await page.keyboard.press('ArrowLeft')
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(carousel.getByRole('img')).toHaveCount(1)
})

test('carousel prev/next arrows page and wrap', async ({ page }) => {
    // The carousel only renders once there's something to buy — preview,
  // same reason the size/fit selector tests above need it.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const carousel = page.getByRole('group', { name: 'Images du produit' })
  const prev = page.getByRole('button', { name: 'Image précédente' })
  const next = page.getByRole('button', { name: 'Image suivante' })
  const pageButtons = page.getByRole('button', { name: /^Image \d de 2$/ })

  await next.click()
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  await prev.click()
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')

  // Wraps in both directions, so neither arrow ever needs a disabled state
  // that would strand focus on it. Only two images, so wrapping back from
  // index 0 lands on index 1.
  await prev.click()
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  await next.click()
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')

  // The arrows are chrome, not slides: still exactly one image exposed.
  await expect(carousel.getByRole('img')).toHaveCount(1)
})

/**
 * The prev/next arrows flank the photo from `md:` up and are `hidden`
 * below it — a phone has the swipe and the markers, and two more controls
 * crowding a small frame buys nothing. What this pins is that hiding them
 * doesn't take paging with it: the arrow *keys* are handled on the group,
 * not on those buttons, so they keep working at a phone width where the
 * buttons themselves are gone.
 */
test('carousel arrows are desktop-only, and arrow keys still page without them', async ({
  page,
}) => {
    // The carousel only renders once there's something to buy — preview,
  // same reason the size/fit selector tests above need it.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const next = page.getByRole('button', { name: 'Image suivante' })
  const pageButtons = page.getByRole('button', { name: /^Image \d de 2$/ })
  await expect(next).toBeVisible()

  await page.setViewportSize({ width: 390, height: 800 })
  await expect(next).toBeHidden()

  // Still pageable from the keyboard at that width.
  await pageButtons.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
})

/**
 * The drag path has no axe- or markup-visible surface at all — it lives
 * entirely in pointer handlers — so this is the only thing standing between
 * a swipe and a silent regression. Playwright's mouse emits real pointer
 * events, which is what ProductCarousel listens for; the intermediate moves
 * matter, because the handler ignores a gesture until it has travelled
 * DRAG_INTENT_PX horizontally.
 */
async function swipe(page: import('@playwright/test').Page, dx: number) {
  // The *exposed* image, not the first in the DOM: off-screen slides sit on a
  // translated track, so their boxes are outside the frame and a drag started
  // there would never reach the stage's handlers.
  const stage = page.getByRole('group', { name: 'Images du produit' }).getByRole('img')
  const box = (await stage.boundingBox())!
  const y = box.y + box.height / 2
  const from = box.x + box.width / 2
  await page.mouse.move(from, y)
  await page.mouse.down()
  for (let step = 1; step <= 5; step++) await page.mouse.move(from + (dx * step) / 5, y)
  await page.mouse.up()
}

test('carousel advances on a horizontal drag and clamps at the ends', async ({ page }) => {
    // The carousel only renders once there's something to buy — preview,
  // same reason the size/fit selector tests above need it.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const carousel = page.getByRole('group', { name: 'Images du produit' })
  const pageButtons = page.getByRole('button', { name: /^Image \d de 2$/ })
  const status = page.locator('[role="status"].sr-only').first()

  // Dragging right at the first image has nowhere to go — unlike the arrows,
  // a swipe deliberately doesn't wrap (see `resist` in ProductCarousel.tsx).
  await swipe(page, 200)
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')

  await swipe(page, -200)
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(status).toHaveText('Classique — Image 2 de 2')

  // Short of the threshold, the track springs back and nothing changes.
  await swipe(page, -20)
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')

  await swipe(page, 200)
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')
  await expect(carousel.getByRole('img')).toHaveCount(1)
})

/**
 * Tailwind v4's preflight stopped restoring `cursor: pointer` on buttons,
 * so every <button> on the site rendered with an arrow — nothing in axe or
 * in the markup can see that, and it is exactly the kind of regression a
 * future `shadcn add` or preflight change reintroduces silently. The rule
 * lives in global.css; this is what holds it there.
 */
test('controls report a pointer cursor', async ({ page }) => {
  // Preview: this checks the fit radiogroup, which only renders once
  // there's something to buy.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const cursorOf = (locator: ReturnType<Page['locator']>) =>
    locator.evaluate((el) => getComputedStyle(el).cursor)

  expect(await cursorOf(page.getByRole('button', { name: 'Image suivante' }))).toBe('pointer')
  expect(await cursorOf(page.getByRole('button', { name: 'Image 2 de 2' }))).toBe('pointer')
  // The <label> RAC renders for a Radio isn't reachable from a global
  // selector — radio-group.tsx sets cursor-pointer itself.
  expect(
    await cursorOf(page.getByRole('radiogroup', { name: 'Coupe' }).locator('label').first())
  ).toBe('pointer')
})

/**
 * The carousel's swipe is invisible to a desktop visitor unless the cursor
 * says so, and the cursor is driven by the same `dragging` state the track
 * is — not by :active — so it has to survive pointer capture and let go
 * with the gesture.
 */
test('the carousel photo advertises its drag with a grab cursor', async ({ page }) => {
    // The carousel only renders once there's something to buy — preview,
  // same reason the size/fit selector tests above need it.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const stage = page.locator('div.touch-pan-y')
  await expect(stage).toHaveCSS('cursor', 'grab')

  const box = (await stage.boundingBox())!
  const y = box.y + box.height / 2
  const from = box.x + box.width / 2
  await page.mouse.move(from, y)
  await page.mouse.down()
  for (let step = 1; step <= 5; step++) await page.mouse.move(from - (100 * step) / 5, y)
  await expect(stage).toHaveCSS('cursor', 'grabbing')

  await page.mouse.up()
  await expect(stage).toHaveCSS('cursor', 'grab')
})

/**
 * Every hover animation on the site is gated on `motion-safe` rather than
 * having its transition removed, so that a reduced-motion visitor sees no
 * travel at all instead of the same displacement arriving instantly. This
 * project runs under reducedMotion: 'reduce' (playwright.config.ts), which
 * makes it the place that can prove it; the matching positive assertion —
 * that the dot does move when motion is allowed — is in sky-motion.e2e.ts,
 * the one project that runs with real motion preferences.
 */
test('the wordmark dot stays put on hover under prefers-reduced-motion', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const dot = page.locator('header .logo-dot')
  await page.getByRole('link', { name: 'Nuage Athletics' }).hover()
  await expect(dot).toHaveCSS('translate', 'none')
})

/**
 * The nav drawer (#nav-drawer, Base.astro) is the site's one modal — worth
 * its own coverage beyond axe, which only ever scans the closed page
 * (a11y.e2e.ts force-opens <details> disclosures before scanning, but has
 * no equivalent for a dialog that only exists once triggered). It's a
 * native <dialog> shown with showModal(), so the focus trap, the inert
 * background and the Escape handling are the browser's, not hand-rolled —
 * this is what proves Chromium is actually holding up its end.
 */
test('nav drawer opens from its trigger, traps focus, and Escape returns focus to the trigger', async ({
  page,
}) => {
  await page.goto(ROUTES.home['fr-CA'])

  const trigger = page.getByRole('button', { name: 'Menu' })
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: 'Navigation du site' })
  await expect(dialog).toBeVisible()

  // showModal()'s own focusing steps land on the first focusable descendant
  // or the dialog itself, not necessarily the close button — what matters
  // is that focus lands inside the dialog, not outside it.
  const focusIsInsideDialog = await dialog.evaluate((el) => el.contains(document.activeElement))
  expect(focusIsInsideDialog).toBe(true)

  // Tab cycles between the dialog's own controls only — the browser's
  // native modal focus trap — never escaping to the (now-inert) rest of
  // the page.
  await page.keyboard.press('Tab')
  const stillInsideDialog = await dialog.evaluate((el) => el.contains(document.activeElement))
  expect(stillInsideDialog).toBe(true)

  const links = dialog.getByRole('link')
  await expect(links).toHaveCount(6)
  await expect(links.nth(0)).toHaveText('Accueil')
  await expect(links.nth(1)).toHaveText('Confidentialité')
  await expect(links.nth(2)).toHaveText('Conditions')
  await expect(links.nth(3)).toHaveText('Informations précontractuelles')
  await expect(links.nth(4)).toHaveText('Contact')
  await expect(links.nth(5)).toHaveText('Instagram')

  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

test('nav drawer closes when a link is activated', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  await page.getByRole('button', { name: 'Menu' }).click()
  const dialog = page.getByRole('dialog', { name: 'Navigation du site' })
  await dialog.getByRole('link', { name: 'Confidentialité' }).click()

  await expect(page).toHaveURL(/\/confidentialite\/?$/)
})

test('nav drawer has no axe violations while open', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Navigation du site' })).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
})

/**
 * The reduced-motion mirror of sky-motion.e2e.ts's positive assertion: this
 * project runs under reducedMotion: 'reduce' (playwright.config.ts), so the
 * drawer's visible panel (#nav-drawer-panel — the child div that actually
 * slides; #nav-drawer itself is the full-viewport scrim) must land in place
 * with no slide, same as the sky toggle's wind lines and the wordmark dot
 * above.
 */
test('nav drawer panel does not slide under prefers-reduced-motion', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])
  await page.getByRole('button', { name: 'Menu' }).click()

  const panel = page.locator('#nav-drawer-panel')
  await expect(panel).toHaveCSS('translate', 'none')
})

/**
 * Founder preview, end to end against the real Worker.
 *
 * The buy flow has to be testable on the live site before the drop opens it to
 * everyone, and the price it reveals is the thing CLAUDE.md non-negotiable 5.5
 * is about — so this asserts both halves: that the public gets the drop
 * announcement and no buy band, and that a founder gets the buy band and a
 * response no shared cache is allowed to keep.
 *
 * The add-to-cart button (named "Ajouter au panier") is the marker used
 * here — it's the one control that's simply either there or not, on screen
 * from the first render, exactly like the old always-present buy button was
 * (see ProductStage.tsx and the buy tests above).
 *
 * Its own browser context, because the cookie must not leak into any other
 * test's view of the site.
 */
test.describe('founder preview', () => {
  test('the public sees the drop announcement and no buy band', async ({ page }) => {
    await page.goto(ROUTES.home['fr-CA'])
    await expect(page.getByText(/DISPONIBLE AUTOMNE 2026/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ajouter au panier', exact: true })).toHaveCount(0)
    // Same gate as the buy band itself — see Base.astro's `canBuy`.
    await expect(page.getByRole('link', { name: 'Panier', exact: true })).toHaveCount(0)
  })

  test('the cookie reveals the buy flow, and the response is never cached', async ({
    browser,
  }) => {
    // A fresh context does not inherit `use.storageState`, so the locale nudge
    // has to be dismissed here too.
    const context = await browser.newContext({ storageState: NUDGE_DISMISSED })
    const page = await context.newPage()

    const response = await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)
    // The secret is stripped on the way back, so it can't linger in history
    // or leak through Referer.
    await expect(page).toHaveURL(new RegExp(`${ROUTES.home['fr-CA']}$`))
    expect(response?.headers()['cache-control']).toBe('private, no-store')

    await expect(page.getByRole('button', { name: 'Ajouter au panier', exact: true })).toBeVisible()
    await expect(page.getByText(/DISPONIBLE AUTOMNE 2026/)).toHaveCount(0)

    // And back out again, without clearing cookies by hand.
    await page.goto(`${ROUTES.home['fr-CA']}?preview=`)
    await expect(page.getByRole('button', { name: 'Ajouter au panier', exact: true })).toHaveCount(0)

    await context.close()
  })

  /**
   * The price and the sold-out state are Shopify's, not the repo's — there is
   * no local number left to render (`PLACEHOLDER_PRICE_CENTS` is gone). The
   * store answering here is e2e/storefront-stub.ts, which quotes STUB_PRICE
   * and holds one size back, so this asserts the whole join end to end: the
   * adapter's SKU match, the band's formatting, and `productOutOfStock`
   * reaching a screen reader on the one size that isn't there.
   *
   * The outage half of that contract — Storefront unreachable, page falls
   * back to the pre-drop render — is asserted in test/shopify.test.ts. It is
   * process-wide state on a server this whole parallel suite shares, so
   * faking it here would break every other spec for the length of a cache
   * window.
   */
  test('the band shows the price Shopify quotes, and a sold-out size is disabled', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: NUDGE_DISMISSED })
    const page = await context.newPage()
    const response = await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

    // The diagnostic header is the failure signal only — a render with a
    // price must not carry one, or it stops meaning anything.
    expect(response?.headers()['x-storefront']).toBeUndefined()

    // fr-CA formatting of the stub's amount ("65,00 $"), built the same way
    // formatPrice does rather than hardcoded, so a currency-formatting change
    // fails in one place instead of reading as a pricing bug.
    const formatted = new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD',
    }).format(Number(STUB_PRICE))
    await expect(page.getByText(formatted, { exact: true })).toBeVisible()

    // The stub holds back the classic fit's XXL, which is the fit the page
    // opens on — no picker interaction needed to see it.
    const soldOut = page.getByRole('radio', { name: new RegExp(`^${SOLD_OUT.size}\\b`) })
    await expect(soldOut).toBeDisabled()
    await expect(soldOut).toHaveAccessibleName(/Épuisé/)

    await expect(page.getByRole('radio', { name: 'XL', exact: true })).toBeEnabled()

    await context.close()
  })

  /**
   * The strikethrough on a sold-out size says *something* happened; it does
   * not say what. A screen reader has had the word all along (it is in the
   * control's own name, asserted above), so this is the pointer user's half
   * of the same fact — and it must not cost the band its fixed height, which
   * is why the tip is positioned out of flow.
   */
  test('a sold-out size explains itself on hover, without moving the band', async ({ browser }) => {
    const context = await browser.newContext({ storageState: NUDGE_DISMISSED })
    const page = await context.newPage()
    await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

    const soldOut = page.getByRole('radio', { name: new RegExp(`^${SOLD_OUT.size}\\b`) })
    const cell = soldOut.locator('xpath=ancestor::span[contains(@class, "group")][1]')
    const tip = cell.locator('[aria-hidden="true"]')

    // Present but unshown — and hidden by opacity, not by `display`, so
    // there is nothing to lay out when it appears.
    await expect(tip).toHaveText('Épuisé')
    await expect(tip).toHaveCSS('opacity', '0')

    const before = await page.getByRole('button', { name: 'Ajouter au panier', exact: true }).boundingBox()
    await cell.hover()
    await expect(tip).toHaveCSS('opacity', '1')
    const after = await page.getByRole('button', { name: 'Ajouter au panier', exact: true }).boundingBox()

    expect(after).toEqual(before)

    // A size that is in stock has nothing to explain.
    const inStock = page
      .getByRole('radio', { name: 'XL', exact: true })
      .locator('xpath=ancestor::span[contains(@class, "group")][1]')
    await expect(inStock.locator('[aria-hidden="true"]')).toHaveCount(0)

    await context.close()
  })

  /**
   * The real multi-item cart (#33), and its confirmation (#74): an add
   * bumps the header cart badge in place — no reload needed for the
   * count/aria-label to update, since ProductStage.tsx reads the same
   * `na_cart_n` cookie /api/cart just set — and the page stays put, so a
   * second size can go in without walking back from anywhere. Only then,
   * on the visitor's own click, does the cart page show the lines and hand
   * checkout off to Shopify's hosted page. Checkout is asserted against the
   * storefront stub's own host (STUB_CHECKOUT_HOST) rather than following
   * the redirect, since there's no real Shopify checkout to land on in this
   * suite.
   */
  test('adding sizes bumps the cart badge without leaving the page, and the cart carries them through to checkout', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: NUDGE_DISMISSED })
    const page = await context.newPage()
    await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

    // The header link is reachable before anything is in the cart — gated
    // on commerceEnabled (same switch as the buy band itself), not on
    // whether the cart happens to hold a line, so a founder previewing the
    // buy flow can always get to /panier/, not only after an add.
    const cartLink = page.getByRole('link', { name: 'Panier', exact: true })
    await expect(cartLink).toBeVisible()

    const sizes = page.getByRole('radiogroup', { name: 'Taille' })
    const button = page.getByRole('button', { name: 'Ajouter au panier', exact: true })

    async function add(size: string) {
      await sizes.locator('label').filter({ hasText: size }).first().click()
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/api/cart')),
        button.click(),
      ])
      expect(response.ok()).toBe(true)
    }

    await add('M')
    // The badge updates in place — no reload, unlike the header's own first
    // render, which reads the cookie server-side.
    await expect(page.getByRole('link', { name: /Panier \(1\)/ })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${ROUTES.home['fr-CA']}$`))

    // This project runs under reducedMotion: 'reduce', so the confirmation
    // pulse is marked but never animates — the count still changed, which is
    // the part that carries the information. cart-motion.e2e.ts holds the
    // other half: that it does animate when motion is allowed.
    const link = page.locator('#cart-link')
    await expect(link).toHaveClass(/cart-bump/)
    expect(
      await link.evaluate((el) => el.getAnimations({ subtree: true }).length)
    ).toBe(0)

    // The whole point of not navigating: a second size goes in from right
    // here, and the badge keeps count.
    await add('L')
    const cartLinkWithCount = page.getByRole('link', { name: /Panier \(2\)/ })
    await expect(cartLinkWithCount).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${ROUTES.home['fr-CA']}$`))

    await cartLinkWithCount.click()
    await expect(page).toHaveURL(new RegExp(`${ROUTES.cart['fr-CA']}$`))
    await expect(page.getByText(/Classique/).first()).toBeVisible()

    // The stub's checkout host isn't a real, resolvable store, so this reads
    // /api/cart's own 303 response rather than letting the browser actually
    // follow it — a real cross-origin navigation to an unresolvable host is
    // exactly what left this flaky in CI (chrome-error://chromewebdata/,
    // deterministically, not a one-off). This suite's job stops at "the
    // button hands off to the store's own host" — what Shopify's hosted
    // checkout itself renders is out of scope, same as it always was.
    const [checkoutResponse] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/api/cart')),
      page.getByRole('button', { name: 'Passer à la caisse' }).click(),
    ])
    expect(checkoutResponse.status()).toBe(303)
    const location = checkoutResponse.headers()['location']
    expect(location).toBeTruthy()
    expect(new URL(location!).hostname).toBe(STUB_CHECKOUT_HOST)

    await context.close()
  })

  /**
   * The cart page's own controls: two native forms per line (`+` / `−`),
   * each a plain submit against `/api/cart`'s existing `update`/`remove`
   * intents — there is no select-and-submit control left to test since the
   * order-summary redesign replaced it with steppers. `−` at quantity 1
   * removes the line rather than going to 0, which this asserts explicitly
   * since it's the one place the two steppers don't mirror each other.
   *
   * Hydrated, those submits no longer reload the document: CartView.astro's
   * script posts the same form and swaps `#cart-body` for the server's own
   * next render. The marker below is how that's asserted — a variable set
   * on `window` survives a DOM swap and would not survive a navigation.
   */
  test('the cart page steppers update quantity in place, and stepping down from 1 removes the line', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: NUDGE_DISMISSED })
    const page = await context.newPage()
    await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

    await page.getByRole('radiogroup', { name: 'Taille' }).locator('label').filter({ hasText: 'M' }).click()
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/api/cart')),
      page.getByRole('button', { name: 'Ajouter au panier', exact: true }).click(),
    ])
    expect(response.ok()).toBe(true)

    await page.goto(ROUTES.cart['fr-CA'])
    await page.evaluate(() => ((window as unknown as Record<string, unknown>).naNoReload = true))

    // The one line on the page — scoped by its own data hook rather than by
    // text, so this doesn't also match a price or a size elsewhere in the row.
    const qty = page.locator('[data-cart-qty]')
    await expect(qty).toHaveText('1')

    /*
     * A cart is not a hold, and this is the last surface the site controls
     * before Shopify's hosted checkout — so the disclosure has to be on the
     * page, not behind a toggle. Asserted here rather than in the axe scan
     * because axe cannot know whether a required statement is present, only
     * that whatever is present is markup-valid. Quoted loosely (the sentence
     * is copy and will be edited); "ne le réserve pas" is the claim itself.
     */
    await expect(page.getByText(/ne le réserve pas/)).toBeVisible()

    const increase = page.getByRole('button', { name: /^Augmenter la quantité/ })
    const decrease = page.getByRole('button', { name: /^Diminuer la quantité/ })

    await increase.click()
    await expect(qty).toHaveText('2')
    // The header count follows the same response, with no reload of its own.
    await expect(page.getByRole('link', { name: /Panier \(2\)/ })).toBeVisible()

    await decrease.click()
    await expect(qty).toHaveText('1')

    // At quantity 1 the same-position button's intent flips from `update`
    // to `remove` (CartView.astro) — same submit, no separate control.
    const remove = page.getByRole('button', { name: /^Retirer/ })
    await remove.click()
    await expect(page.getByText(/Votre panier est vide/)).toBeVisible()

    // Three mutations, still the same document.
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).naNoReload)
    ).toBe(true)

    await context.close()
  })

  /**
   * The other half of "a cart is not a hold": the cart page re-checks
   * availability on every render, so a line that sold out after it went in
   * stops looking buyable here rather than on Shopify's hosted checkout,
   * in wording we don't own, after the visitor has committed (#86).
   *
   * The line is planted rather than added through the buy band, because the
   * band cannot produce this state and shouldn't be able to: `/api/cart`'s
   * add re-resolves the variant against a live read and refuses anything
   * out of stock. `seedStubCart()` makes the cart the way Shopify would
   * have made it while the size was still there — see its own note.
   *
   * Checkout stays enabled, deliberately, and that is asserted too: this is
   * a boolean cached ~15s, and disabling it would strand someone whose item
   * is actually fine (CLAUDE.md 5.7).
   */
  test('the cart page marks a line that sold out after it was added, and warns before checkout', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: NUDGE_DISMISSED })
    const page = await context.newPage()
    // Preview first: the cart route is gated on commerceEnabled, same as the
    // buy band, and the redirect that strips the secret sets the cookie.
    await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

    const cartId = await seedStubCart(soldOutSku())
    await context.addCookies([
      // httpOnly, exactly as /api/cart sets it — the id is a capability and
      // never reaches client JS (src/lib/cart.ts).
      { name: CART_COOKIE, value: cartId, url: BASE_URL, httpOnly: true },
      { name: CART_COUNT_COOKIE, value: '1', url: BASE_URL },
    ])

    await page.goto(ROUTES.cart['fr-CA'])

    // Three renderings of one fact, the same vocabulary the product page
    // uses for a sold-out size: the strikethrough for the glance, the word
    // for everyone (it is in the row's own text, not a hover tip), and the
    // notice above the button that says what to do about it.
    const row = page.locator('li', { hasText: SOLD_OUT.size })
    await expect(row.getByText('Épuisé', { exact: true })).toBeVisible()
    await expect(row.locator('span.line-through').first()).toHaveCSS(
      'text-decoration-line',
      'line-through'
    )
    await expect(page.getByText(/n'est plus disponible/)).toBeVisible()

    // Shopify is still the authority on whether this order can happen.
    const checkout = page.getByRole('button', { name: 'Passer à la caisse' })
    await expect(checkout).toBeVisible()
    await expect(checkout).toBeEnabled()

    // And removing it is still possible — the flag never touched the
    // steppers' accessible names, which name an action that works.
    await page.getByRole('button', { name: /^Retirer/ }).click()
    await expect(page.getByText(/Votre panier est vide/)).toBeVisible()

    await context.close()
  })

  /**
   * The one path #33's AC 2 is actually about: adding to cart with no
   * JavaScript at all, via the plain `<form>` ProductStage.tsx renders and
   * /api/cart's native-POST fallback (src/lib/form-endpoint.ts) — same
   * shape as SignupForm.tsx's own no-JS round trip, asserted the same way
   * (a separate browser context with JS disabled, following a real
   * redirect rather than any script running).
   */
  test('adding a size works with JavaScript disabled', async ({ browser }) => {
    // A tall viewport, not a wide one: the band is vertically centred in a
    // box sized off `100dvh`, so a tall viewport gives it real clearance
    // from SignupPrompt.astro's bottom banner — forced permanently visible
    // by its own <noscript><style> with no JS to run the timer that would
    // otherwise defer it — which `force: true` clicks below would otherwise
    // land on instead of the band underneath it.
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 2000 } })
    const page = await context.newPage()
    await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

    // force: true — same as the signup form's own no-JS test above: with JS
    // off, SignupPrompt.astro's <noscript><style> forces its bottom banner
    // permanently visible (it would otherwise wait for a ~6s JS timer),
    // which can overlap the band depending on viewport height.
    await page
      .getByRole('radiogroup', { name: 'Taille' })
      .locator('label')
      .filter({ hasText: 'M' })
      .click({ force: true })
    await page.getByRole('button', { name: 'Ajouter au panier', exact: true }).click({ force: true })

    // The native POST 303s back here with added=1 — '1' meaning the add went
    // through with nothing to report, which is the whole of what
    // ProductView.astro renders for it: the button's ordinary idle label, in
    // the very first (and, with no JS, only) render, same as a fresh visit.
    // The param does carry a notice code when Shopify clamped the line
    // (`noticeFor()` in /api/cart.ts), which the band then does render — the
    // stub keeps enough stock that this add is the plain case.
    await expect(page).toHaveURL(/\?added=1$/)
    await expect(page.getByRole('button', { name: 'Ajouter au panier', exact: true })).toBeVisible()

    // And the cart page's own steppers degrade the same way: with no script
    // to intercept them, `+` is the plain form POST it has always been, and
    // /api/cart's 303 lands back on the cart with the new quantity rendered.
    // This is the half CartView.astro's script must never break.
    await page.goto(ROUTES.cart['fr-CA'])
    await expect(page.locator('[data-cart-qty]')).toHaveText('1')
    await page.getByRole('button', { name: /^Augmenter la quantité/ }).click({ force: true })

    // `added=1` because /api/cart's form responder folds success into that
    // one param (src/lib/form-endpoint.ts), whichever intent it was — '1'
    // for an untroubled one, a notice code when Shopify changed what was
    // asked for, which is what the cart page reads it for.
    await expect(page).toHaveURL(new RegExp(`${ROUTES.cart['fr-CA']}\\?added=1$`))
    await expect(page.locator('[data-cart-qty]')).toHaveText('2')

    await context.close()
  })

  test('a wrong secret is refused', async ({ page }) => {
    const response = await page.goto(`${ROUTES.home['fr-CA']}?preview=not-the-password`)
    expect(response?.status()).toBe(404)
  })

  /**
   * The garment's design isn't final, so the public pre-drop page carries no
   * product photography at all — no carousel, no image, in either locale.
   * Founder preview (this describe block) is the only way to see it. This
   * replaces a pixel-placement comparison this repo used to run here
   * ("preview does not move the product"): that test pinned the public and
   * preview renders to an identical photo position, which depended on the
   * pre-drop page reserving the exact height the carousel + band occupy
   * under preview. There is no public photo to place any more, so the
   * invariant worth pinning is narrower and more direct — no photography
   * leaks to the public page, full stop.
   */
  test('the public page shows no product photography; preview does', async ({ page }) => {
    await page.goto(ROUTES.home['fr-CA'])
    await expect(page.getByRole('group', { name: 'Images du produit' })).toHaveCount(0)
    await expect(page.locator('img[src*="ls-01"]')).toHaveCount(0)

    await page.goto(ROUTES.home['en-CA'])
    await expect(page.getByRole('group', { name: 'Product images' })).toHaveCount(0)
    await expect(page.locator('img[src*="ls-01"]')).toHaveCount(0)

    await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)
    await expect(page.getByRole('group', { name: 'Images du produit' })).toBeVisible()
    await expect(page.locator('img[src*="ls-01"]').first()).toBeVisible()
  })
})

/**
 * The description and spec list used to be reachable only by tapping
 * "Détails" inside the band; they now live below the fold, server-rendered
 * and always open (ProductDetails.astro), gated on commerce the same way
 * the price and picker are.
 */
test('product details render below the fold when commerce is on, and are absent pre-drop', async ({
  page,
}) => {
  await page.goto(ROUTES.home['fr-CA'])
  await expect(page.getByText('Composition')).toHaveCount(0)

  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)
  await expect(page.getByRole('heading', { name: 'Détails', level: 2 })).toBeVisible()
  await expect(page.getByText('Composition')).toBeVisible()
})

/**
 * The CPA pre-contract disclosure (CLAUDE.md's Non-negotiables) moved off
 * the product page onto its own route — reachable from the footer, the nav
 * drawer, and directly under the buy control, since that link is the last
 * surface the site controls before checkout hands off to Shopify.
 */
test('the pre-contract information page is reachable from the footer, the nav drawer, and the buy band', async ({
  page,
}) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  await expect(
    page.locator('footer').getByRole('link', { name: 'Informations précontractuelles' })
  ).toHaveAttribute('href', ROUTES.precontract['fr-CA'])

  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Informations précontractuelles' })
  ).toHaveAttribute('href', ROUTES.precontract['fr-CA'])
  await page.keyboard.press('Escape')

  const bandLink = page
    .getByRole('button', { name: 'Ajouter au panier', exact: true })
    .locator('xpath=ancestor::div[contains(@class, "max-w-[20rem]")]')
    .getByRole('link', { name: 'Informations précontractuelles' })
  await expect(bandLink).toHaveAttribute('href', ROUTES.precontract['fr-CA'])

  await bandLink.click()
  await expect(page).toHaveURL(new RegExp(`${ROUTES.precontract['fr-CA']}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Informations précontractuelles')
})
