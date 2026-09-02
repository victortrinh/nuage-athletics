import { test, expect } from '@playwright/test'
import { ROUTES } from '../src/i18n/utils'
import { LOCALES } from '../src/i18n/config'

/**
 * The CASL consent checkbox must never be pre-checked or inferred
 * (CLAUDE.md non-negotiable #3) — before this test, nothing automated
 * verified that. The gate screen always renders a SignupForm regardless of
 * lock state.
 */
for (const locale of LOCALES) {
  test(`consent checkbox is unchecked on load (${locale})`, async ({ page }) => {
    await page.goto(ROUTES.gate[locale])
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

  await page.getByRole('checkbox').focus()
  await page.keyboard.press('Space')
  await page.getByRole('textbox', { name: /courriel/i }).fill('test@example.com')
  await page.getByRole('button', { name: /m.inscrire/i }).click({ force: true })

  await expect(page.locator('p[tabindex="-1"]')).toBeFocused()
  await expect(page.locator('[role="status"].sr-only')).toHaveText('Vérifiez vos courriels')
})
