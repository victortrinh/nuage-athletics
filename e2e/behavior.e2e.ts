import { test, expect, type Page } from '@playwright/test'
import { ROUTES } from '../src/i18n/utils'
import { LOCALES } from '../src/i18n/config'

/**
 * The gate screen keeps its SignupForm inside a <details> disclosure, so
 * the form is in the DOM but not rendered until the summary is clicked.
 * Every gate test below needs it open first.
 */
async function openGateSignup(page: Page) {
  await page.locator('details > summary').click()
  await expect(page.getByRole('checkbox')).toBeVisible()
}

/**
 * The CASL consent checkbox must never be pre-checked or inferred
 * (CLAUDE.md non-negotiable #3) — before this test, nothing automated
 * verified that. The gate screen always renders a SignupForm regardless of
 * lock state.
 */
for (const locale of LOCALES) {
  test(`consent checkbox is unchecked on load (${locale})`, async ({ page }) => {
    await page.goto(ROUTES.gate[locale])
    await openGateSignup(page)
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
  await page.goto(ROUTES.gate['fr-CA'])
  await openGateSignup(page)

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
  await page.goto(ROUTES.gate['fr-CA'])

  // The real endpoint always returns email_failed without RESEND_API_KEY
  // configured (by design — see README). Stub the response to exercise the
  // client-side success rendering and focus-management in isolation.
  await page.route('**/api/subscribe', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  )

  await openGateSignup(page)
  await page.getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await page.getByRole('textbox', { name: /courriel/i }).fill('test@example.com')
  await page.getByRole('button', { name: /m.inscrire/i }).click({ force: true })

  await expect(page.locator('p[tabindex="-1"]')).toBeFocused()
  await expect(page.locator('[role="status"].sr-only')).toHaveText('Vérifiez vos courriels')
})

test('size selector is a real radiogroup with roving-tabindex arrow navigation', async ({
  page,
}) => {
  await page.goto(ROUTES.home['fr-CA'])

  // Scoped to "Taille" — the fit selector (ProductActions.tsx) is a second
  // radiogroup on this page since the fit/carousel work, so a bare
  // getByRole('radiogroup') is a Playwright strict-mode violation now.
  const group = page.getByRole('radiogroup', { name: 'Taille' })
  await expect(group).toBeVisible()

  const radios = group.getByRole('radio')
  const count = await radios.count()
  expect(count).toBeGreaterThan(1)

  await radios.first().focus()
  await expect(radios.first()).not.toBeChecked()

  await page.keyboard.press('ArrowRight')
  await expect(radios.nth(1)).toBeChecked()
  await expect(radios.nth(1)).toBeFocused()
  await expect(radios.first()).not.toBeChecked()
})

test('fit selector is a radiogroup, defaults to Classique, and switching fit updates the carousel', async ({
  page,
}) => {
  await page.goto(ROUTES.home['fr-CA'])

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

test('carousel exposes exactly one image at a time, pages with the numbered pagination, and announces the change', async ({
  page,
}) => {
  await page.goto(ROUTES.home['fr-CA'])

  const carousel = page.getByRole('group', { name: 'Images du produit' })
  await expect(carousel).toHaveAttribute('aria-roledescription', 'carousel')
  // axe can't make this assertion — it has no notion of "only one of 8
  // images should be in the accessibility tree at a time". This is the one
  // check that catches a broken aria-hidden toggle.
  await expect(carousel.getByRole('img')).toHaveCount(1)

  // Two sr-only status regions exist on this page while commerce is off —
  // this one (the carousel's) and SignupForm's inside ProductActions. The
  // carousel column is first in document order.
  const status = page.locator('[role="status"].sr-only').first()
  await expect(status).toHaveText('')

  const pageButtons = page.getByRole('button', { name: /^Image \d de 4$/ })
  await expect(pageButtons).toHaveCount(4)
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')

  await pageButtons.nth(2).click()
  await expect(pageButtons.nth(2)).toHaveAttribute('aria-current', 'true')
  await expect(pageButtons.nth(0)).not.toHaveAttribute('aria-current', 'true')
  await expect(carousel.getByRole('img')).toHaveCount(1)
  await expect(status).toHaveText('Classique — Image 3 de 4')
})

test('carousel pagination wraps and is keyboard-operable', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  // Arrow keys work from focus anywhere in the group (see onKeyDown in
  // ProductCarousel.tsx), pagination and prev/next arrows included.
  const carousel = page.getByRole('group', { name: 'Images du produit' })
  const pageButtons = page.getByRole('button', { name: /^Image \d de 4$/ })

  await pageButtons.nth(0).click()
  await pageButtons.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  // An arrow key moves focus along with the current slide.
  await expect(pageButtons.nth(1)).toBeFocused()

  await page.keyboard.press('ArrowLeft')
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')

  // Wraps rather than stopping at the boundary — there's no disabled state
  // to strand focus on.
  await page.keyboard.press('ArrowLeft')
  await expect(pageButtons.nth(3)).toHaveAttribute('aria-current', 'true')
  await expect(carousel.getByRole('img')).toHaveCount(1)
})

test('carousel prev/next arrows page and wrap', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const carousel = page.getByRole('group', { name: 'Images du produit' })
  const prev = page.getByRole('button', { name: 'Image précédente' })
  const next = page.getByRole('button', { name: 'Image suivante' })
  const pageButtons = page.getByRole('button', { name: /^Image \d de 4$/ })

  await next.click()
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  await prev.click()
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')

  // Wraps in both directions, so neither arrow ever needs a disabled state
  // that would strand focus on it.
  await prev.click()
  await expect(pageButtons.nth(3)).toHaveAttribute('aria-current', 'true')
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
  const pageButtons = page.getByRole('button', { name: /^Image \d de 4$/ })
  const status = page.locator('[role="status"].sr-only').first()

  // Dragging right at the first image has nowhere to go — unlike the arrows,
  // a swipe deliberately doesn't wrap (see `resist` in ProductCarousel.tsx).
  await swipe(page, 200)
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')

  await swipe(page, -200)
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(status).toHaveText('Classique — Image 2 de 4')

  // Short of the threshold, the track springs back and nothing changes.
  await swipe(page, -20)
  await expect(pageButtons.nth(1)).toHaveAttribute('aria-current', 'true')

  await swipe(page, 200)
  await expect(pageButtons.nth(0)).toHaveAttribute('aria-current', 'true')
  await expect(carousel.getByRole('img')).toHaveCount(1)
})

test('notify-me source tag records fit and size', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  let posted: { source?: string } = {}
  await page.route('**/api/subscribe', async (route) => {
    posted = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })

  // Click the label, not the (visually-hidden) input the "radio" role
  // resolves to — see the comment on the fit-selector test above.
  await page
    .getByRole('radiogroup', { name: 'Coupe' })
    .locator('label')
    .filter({ hasText: 'Crop' })
    .click()
  await page.getByRole('radiogroup', { name: 'Taille' }).locator('label').nth(2).click()

  await page.getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await page.getByRole('textbox', { name: /courriel/i }).fill('test@example.com')
  // ProductActions doesn't override SignupForm's submitLabel, so the button
  // reads "M'inscrire" here too, same as the gate screen.
  await page.getByRole('button', { name: /m.inscrire/i }).click({ force: true })

  await expect.poll(() => posted.source).toBe('product:ls-01:crop:M')
})

/**
 * Tailwind v4's preflight stopped restoring `cursor: pointer` on buttons,
 * so every <button> on the site rendered with an arrow — nothing in axe or
 * in the markup can see that, and it is exactly the kind of regression a
 * future `shadcn add` or preflight change reintroduces silently. The rule
 * lives in global.css; this is what holds it there.
 */
test('controls report a pointer cursor', async ({ page }) => {
  await page.goto(ROUTES.home['fr-CA'])

  const cursorOf = (locator: ReturnType<Page['locator']>) =>
    locator.evaluate((el) => getComputedStyle(el).cursor)

  expect(await cursorOf(page.getByRole('button', { name: 'Image suivante' }))).toBe('pointer')
  expect(await cursorOf(page.getByRole('button', { name: 'Image 2 de 4' }))).toBe('pointer')
  // The <label> RAC renders for a Radio isn't reachable from a global
  // selector — radio-group.tsx sets cursor-pointer itself.
  expect(
    await cursorOf(page.getByRole('radiogroup', { name: 'Coupe' }).locator('label').first())
  ).toBe('pointer')

  await page.goto(ROUTES.gate['fr-CA'])
  expect(await cursorOf(page.locator('details > summary'))).toBe('pointer')
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
