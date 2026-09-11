import { safeRedirect } from './preview'

/**
 * The degrade-to-native-POST shape every form-backed API route on this site
 * follows — first written for `src/pages/api/subscribe.ts`, lifted out here
 * once `src/pages/api/cart.ts` needed the same three pieces. CLAUDE.md's
 * "Component library" note asks for this discipline to repeat; sharing one
 * implementation is how it actually stays repeated rather than drifting
 * into two similar-but-not-identical copies.
 */

/**
 * A native form POST is the one path a third-party site could trigger
 * without JS of its own (a hidden auto-submitting form is the classic CSRF
 * vector) — this checks the POST actually came from this site: same-origin
 * only, via whichever of Origin / Sec-Fetch-Site the browser sent. Neither
 * present fails closed — every real browser sends at least one on a
 * same-origin POST. The JSON (fetch) path doesn't need this of its own: a
 * route that sends no Access-Control-Allow-Origin header is never reachable
 * from another origin's fetch() in the first place — the browser's own CORS
 * check blocks it before the request handler runs.
 */
export function isSameOrigin(request: Request, origin: string): boolean {
  const requestOrigin = request.headers.get('Origin')
  if (requestOrigin !== null) return requestOrigin === origin
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  if (fetchSite !== null) return fetchSite === 'same-origin' || fetchSite === 'none'
  return false
}

/**
 * How the result reaches the caller differs by how the request arrived: a
 * fetch() call (a hydrated island) wants JSON it can render in place; a
 * native <form> POST (no JS, or JS that hasn't hydrated yet) can't stay on
 * the page, so it gets a redirect back to wherever the visitor was, with the
 * outcome folded into that page's own query string so the next render can
 * show the right state server-side.
 */
export interface Responder {
  ok: () => Response
  fail: (code: string, status: number) => Response
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function jsonResponder(): Responder {
  return {
    ok: () => json({ ok: true }),
    fail: (code, status) => json({ ok: false, code }, status),
  }
}

/**
 * @param okParam the query param set (to '1') on success, e.g. 'sent' or 'added'
 * @param failParam the query param set (to the failure code) on failure, e.g. 'se' or 'ce'
 * @param redirectField the raw value of the form's hidden `redirect` field
 * @param origin the request's own origin, for `safeRedirect`'s same-origin resolution
 */
export function formResponder(
  okParam: string,
  failParam: string,
  redirectField: string,
  origin: string
): Responder {
  function redirectTo(param: string, value: string) {
    const target = new URL(safeRedirect(redirectField), origin)
    // The hidden `redirect` field is just "the page the visitor was on" and
    // may itself still carry a stale outcome from an earlier round trip
    // (e.g. ?se=rate_limited, resubmitted successfully this time) — clear
    // both before setting the current one so they never coexist.
    target.searchParams.delete(okParam)
    target.searchParams.delete(failParam)
    target.searchParams.set(param, value)
    return new Response(null, { status: 303, headers: { Location: target.pathname + target.search } })
  }
  return {
    ok: () => redirectTo(okParam, '1'),
    fail: (code) => redirectTo(failParam, code),
  }
}
