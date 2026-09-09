import { describe, expect, it } from 'vitest'
import { LOCALES } from '../src/i18n/config'
import { INDEXABLE, INDEXABLE_PATHS, ROUTES, type RouteId } from '../src/i18n/utils'

/**
 * The sitemap's allowlist (astro.config.mjs reads INDEXABLE_PATHS) and the
 * `noindex` meta Seo.astro renders come from one table now. These guard the
 * two ways that table can still be wrong in a way tsc can't see.
 */
describe('indexable routes', () => {
  it('never publishes a path no route serves', () => {
    // The sitemap used to advertise the pre-launch gate screens, which the
    // middleware answered with a 404 the moment the site opened. The gate is
    // gone, but the failure it stood for — publishing a URL nothing renders —
    // is the one worth keeping a guard on.
    const served = new Set(
      (Object.keys(ROUTES) as RouteId[]).flatMap((id) => LOCALES.map((l) => ROUTES[id][l]))
    )
    for (const path of INDEXABLE_PATHS) {
      expect(served.has(path), `${path} is not a route`).toBe(true)
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
