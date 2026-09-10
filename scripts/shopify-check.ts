/**
 * Ask the Storefront API what this repo would ask it, and print why the
 * product page has a price or hasn't.
 *
 * The buy band is now downstream of a Shopify read (CLAUDE.md 5.5), and every
 * way that read can come back empty renders identically: the pre-drop page,
 * no price, no band. That is the right behaviour for a visitor and a terrible
 * one to debug against, so this runs the same query and the same SKU join
 * outside the Worker and says which step failed.
 *
 * Usage:
 *   npm run shopify:check                  -- reads .dev.vars, else the environment
 *   SHOPIFY_STORE_DOMAIN=… SHOPIFY_STOREFRONT_TOKEN=… npm run shopify:check
 *
 * The token is never printed. Nothing here writes anything to the store.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CATALOGUE } from '../src/lib/catalogue.ts'
import { normalizeDomain } from '../src/lib/commerce/shopify.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

/** Same file `wrangler dev` reads, so this checks what local dev would see. */
function devVars(): Record<string, string> {
  try {
    const text = readFileSync(resolve(REPO_ROOT, '.dev.vars'), 'utf8')
    return Object.fromEntries(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const eq = line.indexOf('=')
          return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()]
        })
    )
  } catch {
    return {}
  }
}

function credentials() {
  const vars = devVars()
  const domain = process.env.SHOPIFY_STORE_DOMAIN ?? vars.SHOPIFY_STORE_DOMAIN
  const token = process.env.SHOPIFY_STOREFRONT_TOKEN ?? vars.SHOPIFY_STOREFRONT_TOKEN
  if (!domain || !token) {
    console.error(
      'Missing SHOPIFY_STORE_DOMAIN / SHOPIFY_STOREFRONT_TOKEN.\n' +
        'Put them in .dev.vars (see .dev.vars.example) or pass them in the environment.\n' +
        'Secrets already set in Cloudflare cannot be read back — paste the same values here.'
    )
    process.exit(1)
  }
  return { domain, token }
}

// Deliberately a copy of the adapter's query rather than an import of it: this
// script is the thing you run when you don't trust the wiring, so it asks the
// store directly instead of through the module under suspicion. Keep the two
// in step if the query changes.
const QUERY = `query NuageInventory($products: Int!, $variants: Int!) {
  products(first: $products) {
    nodes {
      title
      handle
      variants(first: $variants) {
        nodes { sku availableForSale price { amount currencyCode } }
      }
    }
  }
}`

interface VariantNode {
  sku?: string | null
  availableForSale?: boolean
  price?: { amount?: string; currencyCode?: string }
}

async function main() {
  const { domain, token } = credentials()
  const host = normalizeDomain(domain)
  if (host !== domain.trim()) {
    console.warn(`! SHOPIFY_STORE_DOMAIN is a host, not a URL — reading it as "${host}"\n`)
  }

  const url = `https://${host}/api/2026-01/graphql.json`
  console.log(`→ ${url}`)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': token,
      },
      body: JSON.stringify({ query: QUERY, variables: { products: 10, variants: 100 } }),
    })
  } catch (err) {
    console.error(`✘ could not reach the store: ${String(err)}`)
    console.error('  Check the domain — it should look like your-store.myshopify.com')
    process.exit(1)
  }

  if (!res.ok) {
    console.error(`✘ HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
    if (res.status === 401 || res.status === 403) {
      console.error(
        '  The token was refused. A Storefront API token needs the\n' +
          '  unauthenticated_read_product_listings scope, and it must belong to\n' +
          '  this store.'
      )
    }
    if (res.status === 404) {
      console.error('  404 usually means the domain is wrong, or that API version is gone.')
    }
    process.exit(1)
  }

  const body = (await res.json()) as {
    data?: { products?: { nodes?: { title?: string; variants?: { nodes?: VariantNode[] } }[] } }
    errors?: { message?: string }[]
  }
  if (body.errors?.length) {
    console.error(`✘ GraphQL errors: ${body.errors.map((e) => e.message).join('; ')}`)
    process.exit(1)
  }

  const products = body.data?.products?.nodes ?? []
  console.log(`✓ reachable — the store answered with ${products.length} product(s)\n`)
  if (products.length === 0) {
    console.error(
      '✘ Nothing came back. A Storefront token only sees products published to\n' +
        '  its own sales channel — publish the product to the app this token\n' +
        '  belongs to (Shopify admin → the product → Publishing).'
    )
    process.exit(1)
  }

  const live = new Map<string, VariantNode>()
  for (const product of products) {
    console.log(`  ${product.title ?? '(untitled)'} — ${product.variants?.nodes?.length ?? 0} variant(s)`)
    for (const variant of product.variants?.nodes ?? []) {
      if (variant.sku) live.set(variant.sku.trim(), variant)
    }
  }

  // The join the adapter does, printed row by row.
  console.log('\nSKU join against src/lib/catalogue.ts:')
  let matched = 0
  const prices = new Set<string>()
  for (const variant of CATALOGUE['fr-CA'][0].variants) {
    const found = live.get(variant.sku)
    if (!found) {
      console.log(`  ✘ ${variant.sku.padEnd(18)} not in the store`)
      continue
    }
    matched += 1
    const amount = found.price?.amount ?? '?'
    const currency = found.price?.currencyCode ?? '?'
    prices.add(`${amount} ${currency}`)
    console.log(
      `  ✓ ${variant.sku.padEnd(18)} ${amount} ${currency}  ${found.availableForSale ? 'in stock' : 'SOLD OUT'}`
    )
  }

  console.log(`\n${matched}/${CATALOGUE['fr-CA'][0].variants.length} variants matched.`)
  if (matched === 0) {
    console.error(
      '✘ No price will render. The SKUs in Shopify have to match the ones above\n' +
        '  exactly — the SKU is the join key.'
    )
    process.exit(1)
  }
  if (prices.size > 1) {
    console.error(
      `✘ No price will render: variants disagree on price (${[...prices].join(', ')}).\n` +
        '  One product carries one price here; make them equal in Shopify.'
    )
    process.exit(1)
  }
  const [only] = [...prices]
  if (!only.endsWith(' CAD')) {
    console.error(`✘ No price will render: ${only} is not CAD. This site sells in CAD only.`)
    process.exit(1)
  }

  console.log(`✓ the product page would render ${only}`)
  if (matched < CATALOGUE['fr-CA'][0].variants.length) {
    console.log('  (unmatched SKUs above render as sold out, not as an error)')
  }
  console.log('\nStill no buy band? Then it is not Shopify:')
  console.log('  • COMMERCE_ENABLED is "false", so you need /?preview=<PREVIEW_PASSWORD>')
  console.log('  • the same secrets have to be set on the Worker you are visiting')
}

await main()
