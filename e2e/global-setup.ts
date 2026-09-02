import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { BASE_URL, E2E_GATE_PASSWORD, STORAGE_STATE } from '../playwright.config'

/**
 * Logs into the pre-launch gate once and saves the unlock cookie, so every
 * test project can request `storageState: STORAGE_STATE` and scan the real
 * locked site instead of a gate-disabled stand-in. /acces passes through
 * the gate itself regardless of lock state (see isGatePath in
 * src/lib/gate.ts), so this doesn't need to be authenticated first.
 */
export default async function globalSetup() {
  await mkdir(path.dirname(STORAGE_STATE), { recursive: true })

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  })
  const page = await browser.newPage({ baseURL: BASE_URL })
  await page.goto('/acces')
  await page.getByLabel(/mot de passe|password/i).fill(E2E_GATE_PASSWORD)
  await page.getByRole('button', { name: /entrer|enter/i }).click()
  await page.waitForURL(`${BASE_URL}/`)
  await page.context().storageState({ path: STORAGE_STATE })
  await browser.close()
}
