import { describe, expect, it } from 'vitest'
import { sendConfirmationEmail } from '../src/lib/email'

describe('sendConfirmationEmail', () => {
  it('fails instead of pretending to send when no API key is configured', async () => {
    const res = await sendConfirmationEmail({
      apiKey: undefined,
      to: 'someone@example.com',
      locale: 'fr-CA',
      siteUrl: 'https://nuageathletics.com',
      token: 'deadbeef',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/RESEND_API_KEY/)
  })
})
