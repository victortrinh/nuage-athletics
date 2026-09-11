import { describe, expect, it } from 'vitest'
import { hmacBase64, hmacHex, timingSafeEqual } from '../src/lib/crypto'

describe('hmacHex', () => {
  it('is deterministic for the same secret and payload', async () => {
    const a = await hmacHex('secret', 'payload')
    const b = await hmacHex('secret', 'payload')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]+$/)
  })

  it('differs when the payload changes', async () => {
    const a = await hmacHex('secret', 'payload-a')
    const b = await hmacHex('secret', 'payload-b')
    expect(a).not.toBe(b)
  })
})

describe('hmacBase64', () => {
  it('is deterministic for the same secret and payload', async () => {
    const a = await hmacBase64('secret', 'payload')
    const b = await hmacBase64('secret', 'payload')
    expect(a).toBe(b)
  })

  it('produces standard base64, not hex — the format Shopify actually signs with', async () => {
    const sig = await hmacBase64('secret', 'payload')
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/)
    // A 32-byte SHA-256 digest is 44 base64 chars (with padding), not the 64
    // hex chars hmacHex would produce for the same input.
    expect(sig.length).toBe(44)
  })

  it('differs when the secret changes', async () => {
    const a = await hmacBase64('secret-a', 'payload')
    const b = await hmacBase64('secret-b', 'payload')
    expect(a).not.toBe(b)
  })
})

describe('timingSafeEqual', () => {
  it('is true for identical strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true)
  })

  it('is false for a different value of the same length', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false)
  })

  it('is false for values of different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })
})
