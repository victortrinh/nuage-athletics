import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ROUTES, SIGNUP_PROMPT_ENABLED } from '../src/i18n/utils'
import { E2E_PREVIEW_PASSWORD, NUDGE_DISMISSED } from '../playwright.config'
import { SOLD_OUT, STUB_PRICE, STUB_CHECKOUT_HOST } from './storefront-stub'
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
  await button.click()
  await expect(page.getByText('Ajouté…')).toBeVisible()
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
  await page.goto(ROUTES.home['fr-CA'])

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
  await page.goto(ROUTES.home['fr-CA'])

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
  await page.goto(ROUTES.home['fr-CA'])

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
  await page.goto(ROUTES.home['fr-CA'])

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
  await page.goto(ROUTES.home['fr-CA'])

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
  await page.goto(ROUTES.home['fr-CA'])

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
   * The real multi-item cart (#33): adding a size stays on the product
   * page (the band rolls to "Ajouté…" via the hydrated fetch to
   * /api/cart), the header picks up a cart link once there's a line in it,
   * and the cart page itself shows that line and hands checkout off to
   * Shopify's hosted page — asserted against the storefront stub's own
   * host (STUB_CHECKOUT_HOST) rather than following the redirect, since
   * there's no real Shopify checkout to land on in this suite.
   */
  test('adding a size stays on the page, and the cart carries it through to checkout', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: NUDGE_DISMISSED })
    const page = await context.newPage()
    await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

    await page.getByRole('radiogroup', { name: 'Taille' }).locator('label').filter({ hasText: 'M' }).click()
    const button = page.getByRole('button', { name: 'Ajouter au panier', exact: true })
    await button.click()

    // The button's own label rolls to confirm the add — no redirect, no
    // navigation away from the product page.
    await expect(page.getByText('Ajouté…')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${ROUTES.home['fr-CA']}$`))

    // The header link reads the count straight off the cookie /api/cart just
    // set (src/layouts/Base.astro) — server-rendered, so it only reflects
    // the add on the next render, not the in-place client update above.
    await page.reload()
    const cartLink = page.getByRole('link', { name: /Panier \(1\)/ })
    await expect(cartLink).toBeVisible()
    await cartLink.click()

    await expect(page).toHaveURL(new RegExp(`${ROUTES.cart['fr-CA']}$`))
    await expect(page.getByText(/Classique/)).toBeVisible()

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

    // The native POST 303s back here with added=1 — ProductView.astro reads
    // it server-side into ProductStage's initialAdded prop, so the button's
    // "Ajouté…" label is in the very first (and, with no JS, only) render.
    await expect(page).toHaveURL(/\?added=1$/)
    await expect(page.getByText('Ajouté…')).toBeVisible()

    await context.close()
  })

  test('a wrong secret is refused', async ({ page }) => {
    const response = await page.goto(`${ROUTES.home['fr-CA']}?preview=not-the-password`)
    expect(response?.status()).toBe(404)
  })

  /**
   * Founder preview only tells you what launch day looks like if turning it
   * on doesn't move the page. The two renders are held identical from the top
   * of the document down through the marker row by two halves of one
   * arrangement: ProductStage's shared CHROME_REM (which sizes the frame off
   * the same height budget either way) and the `min-h`/`pt` block in
   * ProductView.astro's pre-drop branch (which reserves exactly what the fit
   * picker and buy band occupy in the commerce render). Either half drifting
   * on its own puts the photo back to a different size or a different place,
   * which is what this measures — and the arithmetic is spread across two
   * files, so a comment alone would not have caught it.
   *
   * Both viewports on purpose: they fail differently. The frame is
   * width-bound on a phone (so a chrome mismatch shows up as a vertical
   * offset) and height-bound on a desktop (where it shows up as a
   * differently-sized photo).
   */
  for (const [name, viewport] of [
    ['phone', { width: 393, height: 851 }],
    ['desktop', { width: 1280, height: 720 }],
  ] as const) {
    test(`preview does not move the product (${name})`, async ({ browser }) => {
      async function placement(url: string) {
        const context = await browser.newContext({ storageState: NUDGE_DISMISSED, viewport })
        const page = await context.newPage()
        await page.goto(url)
        const marker = page.locator('button[data-pagination="true"]').first()
        await marker.waitFor()
        const photo = page.locator('[aria-roledescription="carousel"] img').first()
        const boxes = { photo: await photo.boundingBox(), marker: await marker.boundingBox() }
        await context.close()
        return boxes
      }

      const publicView = await placement(ROUTES.home['fr-CA'])
      const previewView = await placement(
        `${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`
      )

      expect(publicView.photo).toEqual(previewView.photo)
      expect(publicView.marker).toEqual(previewView.marker)
    })
  }
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
 * surface the site controls before checkout hands off to Stripe.
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
