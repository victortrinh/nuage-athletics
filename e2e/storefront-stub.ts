/**
 * A stand-in for Shopify's Storefront API, for the e2e suite only.
 *
 * The price and the sold-out state on the product page come from Shopify
 * (src/lib/commerce/shopify.ts), so without a store to answer, founder
 * preview would render the pre-drop page and every assertion about the buy
 * band would fail for the wrong reason. This serves every operation that
 * file sends — the inventory query and the cart mutations/query — over http
 * on loopback, which is the only case the adapter allows a scheme other
 * than https, and it exists for exactly this.
 *
 * It answers with the real catalogue's SKUs so the join under test is the
 * real one, and holds one variant back as sold out so `productOutOfStock` has
 * something to render.
 *
 * What it deliberately does not do is fail on command. A Storefront outage is
 * global state on a server the whole parallel suite shares, and a toggle would
 * have every other spec racing a fifteen-second cache window. That path is
 * asserted in test/shopify.test.ts instead, where it is a function call.
 *
 * Carts are real, in-memory state (a plain Map, this process's lifetime) —
 * the same "process-wide state the parallel suite shares" caveat as the
 * inventory read applies here too, so each cart-flow test starts its own
 * cart rather than assuming an empty one.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { CATALOGUE } from '../src/lib/catalogue.ts'

export const STOREFRONT_STUB_PORT = 8792
export const STOREFRONT_STUB_TOKEN = 'e2e-storefront-token'

/** In cents, matching what the stub quotes below. */
export const STUB_PRICE = '65.00'

/** The one size held back, as fit and size — see `soldOutSku`. */
export const SOLD_OUT = { fit: 'classic', size: 'XXL' } as const

/** The host Shopify's hosted checkout would live on, for asserting the buy flow hands off there. */
export const STUB_CHECKOUT_HOST = 'stub-shop.example'

function soldOutSku(): string {
  const variant = CATALOGUE['fr-CA'][0].variants.find(
    (v) => v.options?.fit === SOLD_OUT.fit && v.options?.size === SOLD_OUT.size
  )
  if (!variant) throw new Error(`no ${SOLD_OUT.fit}/${SOLD_OUT.size} variant to hold back`)
  return variant.sku
}

/** Same scheme a real Shopify variant GID follows closely enough for the join under test to be the real one. */
function merchandiseId(sku: string): string {
  return `gid://shopify/ProductVariant/${sku}`
}

function skuFromMerchandiseId(id: string): string {
  return id.replace('gid://shopify/ProductVariant/', '')
}

/** The catalogue's own "Classique · M"-shaped label, so a cart-flow test sees the real display text, not a raw SKU standing in for Shopify's own variant title. */
function labelFor(merchId: string): string {
  const sku = skuFromMerchandiseId(merchId)
  const variant = CATALOGUE['fr-CA'][0].variants.find((v) => v.sku === sku)
  return variant?.label ?? sku
}

function inventory() {
  const sku = soldOutSku()
  return {
    products: {
      nodes: [
        {
          variants: {
            nodes: CATALOGUE['fr-CA'][0].variants.map((variant) => ({
              id: merchandiseId(variant.sku),
              sku: variant.sku,
              availableForSale: variant.sku !== sku,
              price: { amount: STUB_PRICE, currencyCode: 'CAD' },
            })),
          },
        },
      ],
    },
  }
}

interface StubLine {
  id: string
  merchandiseId: string
  quantity: number
}

interface StubCart {
  id: string
  lines: StubLine[]
}

const carts = new Map<string, StubCart>()
let lineSeq = 0
function nextLineId(): string {
  lineSeq += 1
  return `gid://shopify/CartLine/${lineSeq}`
}

function rawCart(cart: StubCart) {
  const price = Number(STUB_PRICE)
  return {
    id: cart.id,
    checkoutUrl: `https://${STUB_CHECKOUT_HOST}/cart/c/${cart.id}`,
    cost: {
      subtotalAmount: {
        amount: (cart.lines.reduce((sum, l) => sum + l.quantity, 0) * price).toFixed(2),
        currencyCode: 'CAD',
      },
    },
    lines: {
      nodes: cart.lines.map((l) => ({
        id: l.id,
        quantity: l.quantity,
        cost: { totalAmount: { amount: (l.quantity * price).toFixed(2), currencyCode: 'CAD' } },
        merchandise: {
          id: l.merchandiseId,
          title: labelFor(l.merchandiseId),
          price: { amount: STUB_PRICE, currencyCode: 'CAD' },
        },
      })),
    },
  }
}

type Vars = Record<string, unknown>

function cartCreate(vars: Vars) {
  const id = randomUUID()
  const cart: StubCart = {
    id,
    lines: [{ id: nextLineId(), merchandiseId: String(vars.merchandiseId), quantity: Number(vars.quantity) }],
  }
  carts.set(id, cart)
  return { cartCreate: { cart: rawCart(cart), userErrors: [] } }
}

function cartLinesAdd(vars: Vars) {
  const cart = carts.get(String(vars.cartId))
  if (!cart) return { cartLinesAdd: { cart: null, userErrors: [] } }
  const merchId = String(vars.merchandiseId)
  const existing = cart.lines.find((l) => l.merchandiseId === merchId)
  if (existing) existing.quantity += Number(vars.quantity)
  else cart.lines.push({ id: nextLineId(), merchandiseId: merchId, quantity: Number(vars.quantity) })
  return { cartLinesAdd: { cart: rawCart(cart), userErrors: [] } }
}

function cartLinesUpdate(vars: Vars) {
  const cart = carts.get(String(vars.cartId))
  if (!cart) return { cartLinesUpdate: { cart: null, userErrors: [] } }
  const line = cart.lines.find((l) => l.id === vars.lineId)
  if (line) line.quantity = Number(vars.quantity)
  return { cartLinesUpdate: { cart: rawCart(cart), userErrors: [] } }
}

function cartLinesRemove(vars: Vars) {
  const cart = carts.get(String(vars.cartId))
  if (!cart) return { cartLinesRemove: { cart: null, userErrors: [] } }
  cart.lines = cart.lines.filter((l) => l.id !== vars.lineId)
  return { cartLinesRemove: { cart: rawCart(cart), userErrors: [] } }
}

function cartQuery(vars: Vars) {
  const cart = carts.get(String(vars.cartId))
  return { cart: cart ? rawCart(cart) : null }
}

/** Routed by the operation name every query/mutation in shopify.ts carries — good enough without parsing GraphQL for real. */
const OPERATIONS: [marker: string, handle: (vars: Vars) => unknown][] = [
  ['NuageCartCreate', cartCreate],
  ['NuageCartLinesAdd', cartLinesAdd],
  ['NuageCartLinesUpdate', cartLinesUpdate],
  ['NuageCartLinesRemove', cartLinesRemove],
  ['NuageCartQuery', cartQuery],
  ['NuageInventory', () => inventory()],
]

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

  const chunks: Buffer[] = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    let body: { query?: string; variables?: Vars } = {}
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    } catch {
      // Fall through — an unparseable body matches no operation below and
      // gets the 404 that loop ends on.
    }
    const query = body.query ?? ''
    const operation = OPERATIONS.find(([marker]) => query.includes(marker))
    if (!operation) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ errors: [{ message: 'stub: no handler for this operation' }] }))
      return
    }
    const [, handle] = operation
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: handle(body.variables ?? {}) }))
  })
})

// playwright.config.ts imports the port and token from here so the two ends
// of the wiring can't drift; only running this file as a script starts it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  server.listen(STOREFRONT_STUB_PORT, '127.0.0.1', () => {
    console.log(`storefront stub listening on ${STOREFRONT_STUB_PORT}`)
  })
}
