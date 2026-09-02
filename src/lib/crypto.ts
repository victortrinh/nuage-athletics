/**
 * HMAC-SHA256 over Web Crypto, shared by the Stripe webhook verifier and the
 * password gate. Both need exactly this and the stripe-node SDK isn't usable
 * on Workers, so it lives here rather than being written twice.
 */

export async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Comparison whose running time does not depend on where the first difference
 * falls. A plain === leaks the length of the matching prefix through timing,
 * which is enough to reconstruct a signature or a password one character at a
 * time. Length inequality is not secret — a wrong length can't be a match —
 * so returning early on it is fine.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
