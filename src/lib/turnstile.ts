const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export async function verifyTurnstile(
  token: string | undefined,
  secret: string | undefined,
  ip: string | null
): Promise<boolean> {
  // No secret configured (local dev) — do not block.
  if (!secret) return true
  if (!token) return false

  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (ip) body.append('remoteip', ip)

  const res = await fetch(VERIFY_URL, { method: 'POST', body })
  if (!res.ok) return false
  const data = (await res.json()) as { success: boolean }
  return data.success === true
}
