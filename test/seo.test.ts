import { describe, expect, it } from 'vitest'
import { isGatePath } from '../src/lib/gate'
import { LOCALES } from '../src/i18n/config'
import { INDEXABLE, INDEXABLE_PATHS, ROUTES, type RouteId } from '../src/i18n/utils'

/**
 * The sitemap's allowlist (astro.config.mjs reads INDEXABLE_PATHS) and the
 * `noindex` meta Seo.astro renders come from one table now. These guard the
 * two ways that table can still be wrong in a way tsc can't see.
 */
describe('indexable routes', () => {
  it('never publishes a path the middleware refuses to serve', () => {
    // src/middleware.ts answers a gate path with 401 while the site is
    // locked and 404 once it isn't. Both were in the sitemap before this
    // table existed, and the 404 is the one that would have shipped.
    for (const path of INDEXABLE_PATHS) {
      expect(isGatePath(path), `${path} is a gate screen`).toBe(false)
      expect(isGatePath(path.replace(/\/$/, '')), `${path} is a gate screen`).toBe(false)
    }
  })

  it('publishes every locale of an indexable route, and only real routes', () => {
    const expected = (Object.keys(ROUTES) as RouteId[])
      .filter((id) => INDEXABLE[id])
      .flatMap((id) => LOCALES.map((locale) => ROUTES[id][locale]))

    // Both locales or neither: shipping one language's URL and withholding
    // the other is exactly what the Charter compliance note in
    // astro.config.mjs rules out.
    expect([...INDEXABLE_PATHS].sort()).toEqual(expected.sort())
  })

  it('keeps the home page indexable', () => {
    // A guard against the table being emptied by accident: with `home`
    // false, the site publishes an empty sitemap and noindexes everything,
    // which is a silent, total de-indexing rather than a visible break.
    expect(INDEXABLE.home).toBe(true)
    expect(INDEXABLE_PATHS.length).toBeGreaterThan(0)
  })
})
