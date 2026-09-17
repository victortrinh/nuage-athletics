import { describe, expect, it } from 'vitest'
import { LOCALES } from '../src/i18n/config'
import { CATALOGUE, skuBaseFor } from '../src/lib/catalogue'

/**
 * `ProductView.astro` publishes `skuBaseFor(product.id)` as the product's
 * structured-data identifier. That is only honest while it really is the
 * prefix of the SKUs Shopify is joined by — a renamed SKU scheme that left
 * the base behind would publish an identifier no store has ever heard of,
 * and nothing about the rendered page would look wrong.
 */
describe('sku base', () => {
  it('prefixes every variant SKU, in every locale', () => {
    for (const locale of LOCALES) {
      for (const product of CATALOGUE[locale]) {
        const base = skuBaseFor(product.id)
        expect(product.variants.length).toBeGreaterThan(0)
        for (const variant of product.variants) {
          expect(variant.sku.startsWith(`${base}-`), `${variant.sku} vs ${base}`).toBe(true)
        }
      }
    }
  })

  it('refuses a product it has no base for', () => {
    expect(() => skuBaseFor('nope')).toThrow()
  })
})
