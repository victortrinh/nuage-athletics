import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ROUTES } from '../src/i18n/utils'
import { E2E_PREVIEW_PASSWORD, NUDGE_DISMISSED } from '../playwright.config'
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
    await page.goto(ROUTES.home['fr-CA'])
    await expect(page.getByRole('checkbox')).toBeVisible()

    await page.getByRole('textbox', { name: /courriel/i }).fill('test@example.com')
    await page.getByRole('button', { name: /m.inscrire/i }).click()

    await expect(page).toHaveURL(new RegExp(`${ROUTES.home['fr-CA']}\\?se=consent_required$`))
    await expect(page.getByRole('alert')).toHaveText('Vous devez accepter de recevoir nos courriels.')
  })
})

/**
 * Opens the buy band the way a pointer user does — the "+" trigger — and
 * waits for the size radiogroup to actually take focus, which is the
 * band's own signal (ProductStage.tsx's focus-management effect) that the
 * open transition has settled. Every test below that needs the band open
 * calls this first, mirroring `openSignupPrompt` above.
 */
async function openBand(page: Page) {
  await page.getByRole('button', { name: 'Choisir une taille', exact: true }).click()
  await expect(page.getByRole('radiogroup', { name: 'Taille' }).getByRole('radio').first()).toBeFocused()
}

test('size selector is a real radiogroup with roving-tabindex arrow navigation', async ({
  page,
}) => {
  // The band only renders once there's something to buy — see the note in
  // ProductView.astro — so this exercises it the way a founder would.
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)
  await openBand(page)

  // Scoped to "Taille" — the fit selector (ProductStage.tsx) is a second
  // radiogroup on this page since the fit/carousel work, so a bare
  // getByRole('radiogroup') is a Playwright strict-mode violation now.
  const group = page.getByRole('radiogroup', { name: 'Taille' })
  await expect(group).toBeVisible()

  const radios = group.getByRole('radio')
  const count = await radios.count()
  expect(count).toBeGreaterThan(1)

  // openBand already focused and left the first radio unchecked — arrow
  // navigation from there is the thing under test.
  await expect(radios.first()).not.toBeChecked()

  await page.keyboard.press('ArrowRight')
  await expect(radios.nth(1)).toBeChecked()
  await expect(radios.nth(1)).toBeFocused()
  await expect(radios.first()).not.toBeChecked()
})

test('fit selector is a radiogroup, defaults to Classique, and switching fit updates the carousel', async ({
  page,
}) => {
  // Preview, same reason as the size-selector test above. Unlike the size
  // radiogroup, the fit picker sits under the carousel rather than inside
  // the band, so it's visible without opening anything.
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
  await openBand(page)
  const sizeGroup = page.getByRole('radiogroup', { name: 'Taille' })
  await sizeGroup.locator('label').nth(2).click()
  const thirdSize = sizeGroup.getByRole('radio').nth(2)
  await expect(thirdSize).toBeChecked()
  await fitGroup.locator('label').filter({ hasText: 'Classique' }).click()
  await expect(thirdSize).toBeChecked()
})

/**
 * The whole point of the fixed-height band (see CLAUDE.md's product page
 * note): none of these four states may change the band's own height or
 * move the carousel above it by so much as a pixel. axe has no notion of
 * "this box stays the same size" — this is the direct test of the brief.
 */
test('the buy band never changes height, and the carousel never moves, across any of its states', async ({
  page,
}) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const band = page.getByRole('button', { name: 'Choisir une taille', exact: true }).locator(
    'xpath=ancestor::div[contains(@class, "max-w-[20rem]")]'
  )
  const img = page.getByRole('group', { name: 'Images du produit' }).getByRole('img')

  // The gap between the image and the band, not either one's raw viewport
  // position — clicking a control further down the page (Détails, say) can
  // auto-scroll the viewport, which would shift both boxes by the same
  // amount and read as a false failure if compared to an absolute position
  // from before the scroll. The gap between them is scroll-invariant and is
  // the thing that actually must not change.
  async function measure() {
    const [bandBox, imgBox] = await Promise.all([band.boundingBox(), img.boundingBox()])
    return { height: bandBox!.height, gap: bandBox!.y - (imgBox!.y + imgBox!.height) }
  }

  const collapsed = await measure()

  await openBand(page)
  const open = await measure()

  await page.getByRole('radiogroup', { name: 'Taille' }).locator('label').nth(2).click()
  const confirming = await measure()

  await page.getByRole('button', { name: 'Détails' }).click()
  const info = await measure()

  for (const state of [open, confirming, info]) {
    expect(state.height).toBe(collapsed.height)
    expect(state.gap).toBe(collapsed.gap)
  }
})

test('a mis-tap on a size can never fire a purchase — selecting one only reveals a confirm control', async ({
  page,
}) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)
  await openBand(page)

  // No plain "Acheter" button exists before a size is chosen — only the
  // instructional roller text, which is not a button at all.
  await expect(page.getByRole('button', { name: /^Acheter/ })).toHaveCount(0)

  await page.getByRole('radiogroup', { name: 'Taille' }).locator('label').filter({ hasText: 'M' }).click()

  // Selecting the radio itself must not have submitted anything — track
  // every request from here on and confirm none of them ever reaches
  // /api/checkout, rather than racing a single waitForRequest against a
  // timeout (which throws, rather than resolving empty, on its own timeout).
  const checkoutRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('/api/checkout')) checkoutRequests.push(req.url())
  })

  const confirm = page.getByRole('button', { name: 'Acheter · M', exact: true })
  await expect(confirm).toBeVisible()
  await page.waitForTimeout(500)
  expect(checkoutRequests).toHaveLength(0)
})

test('the "+" toggles aria-expanded, and closing returns focus to it without losing the chosen size', async ({
  page,
}) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const trigger = page.getByRole('button', { name: 'Choisir une taille', exact: true })
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await openBand(page)
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')

  // Exact match: 'L' is also a substring of 'XL' and '2XL', unlike 'M'
  // above, so a plain hasText filter here is ambiguous.
  await page.getByRole('radiogroup', { name: 'Taille' }).locator('label').filter({ hasText: /^L$/ }).click()

  const close = page.getByRole('button', { name: 'Fermer la sélection de taille' })
  await close.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()

  // Reopening still shows L selected — closing the band doesn't clear it.
  // exact: true — 'L' is also a substring match for the 'XL' and '2XL'
  // radios' accessible names.
  await trigger.click()
  await expect(
    page.getByRole('radiogroup', { name: 'Taille' }).getByRole('radio', { name: 'L', exact: true })
  ).toBeChecked()
})

test('"Détails" discloses the description and spec list in place of the size grid', async ({
  page,
}) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)
  await openBand(page)

  const details = page.getByRole('button', { name: 'Détails' })
  await expect(details).toHaveAttribute('aria-expanded', 'false')
  await details.click()
  await expect(details).toHaveAttribute('aria-expanded', 'true')

  await expect(page.getByText('Composition')).toBeVisible()

  // The size grid's *branch* of the slot goes `inert`, not the radiogroup
  // itself going display:none — its box is still in the DOM (product/Slot.tsx
  // needs that to keep the fixed height), just translated out of the clipped
  // box and unreachable, which is what `inert` (rather than Playwright's
  // toBeVisible, which doesn't reason about a transformed/clipped ancestor)
  // actually verifies here.
  const sizeGroupBranchInert = await page
    .getByRole('radiogroup', { name: 'Taille' })
    .evaluate((el) => (el.closest('[inert]') !== null ? true : false))
  expect(sizeGroupBranchInert).toBe(true)
})

/**
 * The whole open → pick a size → confirm → information path, driven from
 * the keyboard alone. Each of these controls is either a native <button>
 * or a RAC RadioGroup, which is what buys the roving tabindex and Enter/
 * Space activation below for free — this is what proves it actually holds
 * end to end, not control by control.
 */
test('the whole band is operable from the keyboard alone', async ({ page }) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const trigger = page.getByRole('button', { name: 'Choisir une taille', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('radiogroup', { name: 'Taille' }).getByRole('radio').first()).toBeFocused()

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  const confirm = page.getByRole('button', { name: /^Acheter/ })
  await expect(confirm).toBeVisible()

  await page.getByRole('button', { name: 'Détails' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Composition')).toBeVisible()

  await page.getByRole('button', { name: 'Fermer la sélection de taille' }).focus()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()
})

/**
 * Everything new in the band clears the 44×44 CSS-pixel target size — the
 * carousel's own pagination (size-8 = 32px) predates this redesign and
 * keeps its existing tests, so it's deliberately excluded here rather than
 * silently included and left passing on a smaller box.
 */
test('every band control meets a 44×44 minimum target size', async ({ page }) => {
  await page.goto(`${ROUTES.home['fr-CA']}?preview=${E2E_PREVIEW_PASSWORD}`)

  const trigger = page.getByRole('button', { name: 'Choisir une taille', exact: true })
  const triggerBox = (await trigger.boundingBox())!
  expect(triggerBox.width).toBeGreaterThanOrEqual(44)
  expect(triggerBox.height).toBeGreaterThanOrEqual(44)

  await openBand(page)
  const closeBox = (await page.getByRole('button', { name: 'Fermer la sélection de taille' }).boundingBox())!
  expect(closeBox.width).toBeGreaterThanOrEqual(44)
  expect(closeBox.height).toBeGreaterThanOrEqual(44)
})

test('carousel exposes exactly one image at a time, pages with the numbered pagination, and announces the change', async ({
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
  await expect(links).toHaveCount(5)
  await expect(links.nth(0)).toHaveText('Accueil')
  await expect(links.nth(1)).toHaveText('Confidentialité')
  await expect(links.nth(2)).toHaveText('Conditions')
  await expect(links.nth(3)).toHaveText('Contact')
  await expect(links.nth(4)).toHaveText('Instagram')

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
 * The band's "+" trigger (named "Choisir une taille") is the marker used
 * here rather than an "Acheter" button — there is no plain "Acheter" button
 * any more; the confirm control only exists, named "Acheter · <size>", once
 * a size is picked (see ProductStage.tsx and the two-tap buy tests above).
 * The "+" is the thing that's simply either there or not, exactly like the
 * old always-present buy button was.
 *
 * Its own browser context, because the cookie must not leak into any other
 * test's view of the site.
 */
test.describe('founder preview', () => {
  test('the public sees the drop announcement and no buy band', async ({ page }) => {
    await page.goto(ROUTES.home['fr-CA'])
    await expect(page.getByText(/DISPONIBLE AUTOMNE 2026/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choisir une taille', exact: true })).toHaveCount(0)
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

    await expect(page.getByRole('button', { name: 'Choisir une taille', exact: true })).toBeVisible()
    await expect(page.getByText(/DISPONIBLE AUTOMNE 2026/)).toHaveCount(0)

    // And back out again, without clearing cookies by hand.
    await page.goto(`${ROUTES.home['fr-CA']}?preview=`)
    await expect(page.getByRole('button', { name: 'Choisir une taille', exact: true })).toHaveCount(0)

    await context.close()
  })

  test('a wrong secret is refused', async ({ page }) => {
    const response = await page.goto(`${ROUTES.home['fr-CA']}?preview=not-the-password`)
    expect(response?.status()).toBe(404)
  })
})
