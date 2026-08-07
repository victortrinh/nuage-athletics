import { beforeEach, vi } from 'vitest'

const realFetch = globalThis.fetch

/**
 * Tests bind a fake RESEND_API_KEY so the email path runs for real instead of
 * taking the no-key dev branch. Nothing may actually reach api.resend.com, so
 * every request to it is answered here. Individual tests override
 * `globalThis.fetch` again when they need a failure.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('https://api.resend.com/')) {
        return new Response(JSON.stringify({ id: 'test-email-id' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return realFetch(input as RequestInfo, init)
    }
  )
})
