/**
 * A stand-in for Shopify's Storefront API, for the e2e suite only.
 *
 * The price and the sold-out state on the product page come from Shopify
 * (src/lib/commerce/shopify.ts), so without a store to answer, founder
 * preview would render the pre-drop page and every assertion about the buy
 * band would fail for the wrong reason. This serves the one GraphQL query
 * that file sends, over http on loopback — which is the only case the adapter
 * allows a scheme other than https, and it exists for exactly this.
 *
 * It answers with the real catalogue's SKUs so the join under test is the
 * real one, and holds one variant back as sold out so `productOutOfStock` has
 * something to render.
 *
 * What it deliberately does not do is fail on command. A Storefront outage is
 * global state on a server the whole parallel suite shares, and a toggle would
 * have every other spec racing a fifteen-second cache window. That path is
 * asserted in test/shopify.test.ts instead, where it is a function call.
 */
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { CATALOGUE } from '../src/lib/catalogue.ts'

export const STOREFRONT_STUB_PORT = 8792
export const STOREFRONT_STUB_TOKEN = 'e2e-storefront-token'

/** In cents, matching what the stub quotes below. */
export const STUB_PRICE = '65.00'

/** The one size held back, as fit and size — see `soldOutSku`. */
export const SOLD_OUT = { fit: 'classic', size: 'XXL' } as const

function soldOutSku(): string {
  const variant = CATALOGUE['fr-CA'][0].variants.find(
    (v) => v.options?.fit === SOLD_OUT.fit && v.options?.size === SOLD_OUT.size
  )
  if (!variant) throw new Error(`no ${SOLD_OUT.fit}/${SOLD_OUT.size} variant to hold back`)
  return variant.sku
}

function inventory() {
  const sku = soldOutSku()
  return {
    data: {
      products: {
        nodes: [
          {
            variants: {
              nodes: CATALOGUE['fr-CA'][0].variants.map((variant) => ({
                sku: variant.sku,
                availableForSale: variant.sku !== sku,
                price: { amount: STUB_PRICE, currencyCode: 'CAD' },
              })),
            },
          },
        ],
      },
    },
  }
}

const server = createServer((req, res) => {
  // Playwright's readiness poll — a plain GET, before the Worker is even up.
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('storefront stub ready')
    return
  }

  // The token is checked so a missing header fails loudly here rather than
  // silently rendering a pre-drop page nobody can explain.
  if (req.headers['x-shopify-storefront-access-token'] !== STOREFRONT_STUB_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ errors: [{ message: 'stub: bad storefront token' }] }))
    return
  }
  // Drain the request body: the query itself isn't inspected, but leaving it
  // unread stalls the connection.
  req.resume()
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(inventory()))
  })
})

// playwright.config.ts imports the port and token from here so the two ends
// of the wiring can't drift; only running this file as a script starts it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  server.listen(STOREFRONT_STUB_PORT, '127.0.0.1', () => {
    console.log(`storefront stub listening on ${STOREFRONT_STUB_PORT}`)
  })
}
