import { useState, type FormEvent } from 'react'
import { I18nProvider } from 'react-aria-components'
import ProductCarousel from './ProductCarousel'
import { Button } from './ui/button'
import { RadioGroup, Radio } from './ui/radio-group'
import { Slot } from './product/Slot'
import { fmt, type Dict } from '../i18n/ui'
import type { Locale } from '../i18n/config'
import type { FitId, ProductFit } from '../lib/catalogue'

interface Variant {
  id: string
  label: string
  inStock: boolean
  options?: Record<string, string>
}

/** Maps an /api/cart failure code to the string it should show — everything
 *  but a real sold-out or a missing selection gets the one generic cart
 *  error, same reasoning SignupForm's own errorMessage table follows for
 *  /api/subscribe. `no_size` only ever reaches here via a no-JS submit —
 *  the hydrated path catches it before the fetch, in `onSubmit` below. */
function errorMessage(d: Dict, code: string): string {
  if (code === 'sold_out') return d.errorSoldOut
  if (code === 'no_size') return d.productChooseSize
  return d.errorCartGeneric
}

/**
 * The literal cookie name `/api/cart` just set (`CART_COUNT_COOKIE` in
 * src/lib/cart.ts) rather than an import from there: that module pulls in
 * `preview.ts`'s server-only db/crypto code through `readCookie`, which has
 * no business in this island's client bundle. The cookie is deliberately
 * readable and deliberately display-only — see cart.ts's own comment — so
 * reading it directly here is exactly the use it was built for.
 */
function readCartCount(): number {
  const match = document.cookie.match(/(?:^|; )na_cart_n=(\d+)/)
  const n = match ? Number(match[1]) : NaN
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * The one visible confirmation an add still gets, now that the button's own
 * "Added" state is gone (#74): the header cart link (#cart-link, Base.astro)
 * updates its count in place and briefly scales up (`.cart-bump`,
 * global.css). Reaches across from this island into the layout's plain
 * server-rendered markup via a DOM id rather than any shared state — the two
 * have no common parent to lift state into, same reasoning ProductCarousel
 * and the old ProductActions once needed a module-level store for (see this
 * file's own top-of-file note on fit-store.ts's removal).
 */
function bumpCartBadge(d: Dict) {
  const link = document.getElementById('cart-link')
  if (!link) return
  const count = readCartCount()
  link.setAttribute('aria-label', count > 0 ? fmt(d.cartCount, { n: count }) : d.cart)
  let badge = link.querySelector<HTMLSpanElement>('[data-cart-count]')
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span')
      badge.dataset.cartCount = ''
      badge.setAttribute('aria-hidden', 'true')
      badge.className = 'font-mono text-[10px] tabular-nums'
      link.appendChild(badge)
    }
    badge.textContent = String(count)
  } else {
    badge?.remove()
  }
  // Remove-then-reflow-then-add restarts the CSS animation even when a
  // second add lands while the first bump is still playing — a class that's
  // already present wouldn't retrigger it.
  link.classList.remove('cart-bump')
  void link.offsetWidth
  link.classList.add('cart-bump')
}

interface FitOption {
  id: FitId
  label: string
}

interface BaseProps {
  locale: Locale
  d: Dict
  productId: string
  productName: string
  /** Photos + labels for the carousel — never gated: see ProductView.astro. */
  fits: ProductFit[]
  initialFit: FitId
}

/**
 * Everything below is gated on `commerceEnabled` at the type level, not just
 * at render time. ProductView.astro server-renders this island's props into
 * the page as JSON (Astro's `astro-island` attribute) — hiding `price` and
 * `variants` behind an `if` inside this component would still put the
 * placeholder price on the wire for anyone who reads the HTML.
 * Non-negotiable 5.5 in CLAUDE.md is about the number reaching the visitor,
 * not about what renders, so the caller literally cannot pass these unless
 * `commerceEnabled` is `true`.
 */
type Props =
  | (BaseProps & { commerceEnabled: false })
  | (BaseProps & {
      commerceEnabled: true
      fitOptions: FitOption[]
      variants: Variant[]
      /** Pre-formatted by the caller (`formatPrice` in catalogue.ts) — this
       *  island has no reason to know about `Intl.NumberFormat` or currency
       *  codes. */
      price: string
      /** Resolved server-side (`route('precontract', locale)` in
       *  ProductView.astro) rather than imported here — `route()` and
       *  `i18n/utils` stay server-side, same reason `price` arrives
       *  pre-formatted rather than this island importing `formatPrice`. */
      precontractHref: string
      /** Resolved server-side the same way as `precontractHref` above — where
       *  the hydrated path sends the visitor shortly after a successful add
       *  (see `onSubmit`'s success branch below). The no-JS fallback doesn't
       *  use this: a native submit still returns to `redirectTo`, since a
       *  303 there has no way to show the bump animation first. */
      cartHref: string
      /**
       * The page this island lives on, including any query string — carried
       * as the form's hidden `redirect` field for the no-JS fallback, same
       * pattern as SignupForm.tsx's own `redirectTo`. `/api/cart` bounces a
       * native POST back here with the outcome folded into
       * `added=1`/`ce=<code>`.
       */
      redirectTo: string
      /**
       * Read out of `Astro.url.searchParams` by the caller and passed
       * straight through, so the server render and the first client render
       * agree on `error` from the same prop — see SignupForm.tsx's
       * `initialErrorCode` for the pattern this mirrors.
       */
      initialErrorCode?: string
    })

/**
 * The column's non-frame chrome, per breakpoint — the pad above the carousel
 * plus everything the caller puts below the marker row. Deliberately ONE
 * number for both renders rather than two hand-measured ones: the pre-drop
 * view reserves exactly the height the fit picker and buy band occupy here
 * (see ProductView.astro's `min-h`), so the photo and the marker row land in
 * the same place whether or not commerce is on. Flipping founder preview on
 * must not move the product — that's the whole point of previewing the real
 * page. Re-measure both halves together if the band's height changes.
 */
const CHROME_REM = { base: 21.03125, sm: 19.03125 }

/**
 * The product page's single interactive root — carousel, fit picker and the
 * fixed-height buy band, merged into one island.
 *
 * This used to be two: ProductCarousel and ProductActions, sharing the
 * selected fit through a module-level store (`src/lib/fit-store.ts`)
 * because lifting both into one island "would hydrate the heading,
 * description and spec list for no interactive reason" (CLAUDE.md's old
 * wording). That reasoning doesn't hold any more — this redesign puts the
 * heading and price *inside* the interactive band. See fit-store.ts's
 * removal in the same commit.
 *
 * The band used to be collapsed behind a `+`, with the size grid flying in
 * on tap and a second "Détails" toggle swapping it for the description and
 * spec list. Both are gone: the name, the sizes and the one purchase
 * control are all visible on arrival, and the description/spec list moved
 * to its own always-open section below the fold (ProductDetails.astro) —
 * nothing left here to disclose into. What's fixed-height now is only the
 * price row (an error can replace it) and the button's own label (idle /
 * "Ajout…"), both `product/Slot.tsx` rollers so neither changes the band's
 * total height.
 */
export default function ProductStage(props: Props) {
  const { locale, d, productId, productName, fits, initialFit, commerceEnabled } = props

  const [fit, setFit] = useState<FitId>(initialFit)
  const [size, setSize] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(() =>
    commerceEnabled && props.initialErrorCode ? errorMessage(d, props.initialErrorCode) : ''
  )

  function onSizeChange(value: string) {
    setSize(value)
    setError('')
  }

  /**
   * The band's <form> posts natively to /api/cart with no JS at all — this
   * only intercepts that once hydrated, to fetch() in place instead of
   * taking the 303 round trip. `fit`/`size` travel exactly as the native
   * submit would send them (RAC's radios are real named inputs — see the
   * JSX below), so there is nothing here for the two paths to disagree
   * about. On success the hydrated path bumps the header cart badge and
   * moves on to the cart itself a beat later (see the success branch
   * below); the no-JS fallback stays on this page, same as it always has —
   * a 303 has no way to show the bump first.
   */
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (!commerceEnabled) return
    e.preventDefault()
    if (loading) return
    const selected = props.variants.find((v) => v.options?.fit === fit && v.options?.size === size)
    // The button is never `disabled` on `!selectedVariant` any more — see
    // the note on the Button below for why — so this is reachable for real:
    // an error, not a silent no-op, is what a no-JS submit of the same form
    // gets from /api/cart's own missing-selection check.
    if (!selected) {
      setError(d.productChooseSize)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'add', fit, size, quantity: 1, locale }),
      })
      const data = (await res.json()) as { ok: boolean; code?: string }
      if (data.ok) {
        bumpCartBadge(d)
        // Long enough to see the badge bump (420ms, global.css) land before
        // the page unloads — short enough that this still reads as one
        // continuous action, not a separate step.
        window.setTimeout(() => window.location.assign(props.cartHref), 550)
        return
      }
      setError(errorMessage(d, data.code ?? ''))
    } catch {
      setError(d.errorCartGeneric)
    } finally {
      setLoading(false)
    }
  }

  if (!commerceEnabled) {
    // Pre-drop: the carousel and its fit photography exist, but nothing
    // below it does — no picker, no band, no price. The h1 and drop
    // announcement are rendered by ProductView.astro itself, outside this
    // island, exactly as they were before this redesign; see the note
    // there on why that stays a plain server-rendered heading rather than
    // moving into the band. Same pad above the carousel and same CHROME_REM
    // as the commerce branch below — the two renders are deliberately
    // identical from the top of the page down through the marker row.
    return (
      <div className="pt-10 sm:pt-2">
        <ProductCarousel d={d} fit={fit} fits={fits} initialFit={initialFit} chromeRem={CHROME_REM} />
      </div>
    )
  }

  const { fitOptions, variants, price, precontractHref, redirectTo } = props
  const sizesForFit = variants.filter((v) => v.options?.fit === fit)
  const selectedVariant = variants.find((v) => v.options?.fit === fit && v.options?.size === size)

  const priceSlotIndex = error ? 1 : 0
  const actionSlotIndex = loading ? 1 : 0
  const sizeHintId = `size-hint-${productId}`

  return (
    <I18nProvider locale={locale}>
      {/*
        The pad above the carousel is the top half of a trade, not decoration.
        ProductView.astro centres this whole block inside a reserved screenful
        (`justify-center`), so on a phone — where the frame is bound by width,
        not by the height budget below, and so leaves real slack — the leftover
        room was splitting evenly and pooling under the band. Air added above
        the photo and between it and the marker row (ProductCarousel's own
        `mt-10 sm:mt-6`) comes out of that slack. Both numbers are part of the
        column's chrome, hence `chromeRem` below.
      */}
      <div className="pt-10 sm:pt-2">
        {/* CHROME_REM (above) is hand-measured from the pad above plus the fit
            picker and band that follow — see ProductCarousel.tsx's
            frame-sizing comment. `sm:` is smaller because that pad is (the
            band itself is the same height at both breakpoints). */}
        <ProductCarousel d={d} fit={fit} fits={fits} initialFit={initialFit} chromeRem={CHROME_REM} />

        {/*
          The whole fit picker and buy band, as one native form: this is
          what lets "Ajouter au panier" work with JavaScript disabled — the
          browser POSTs it to /api/cart exactly as `onSubmit` below does by
          fetch() once hydrated, and /api/cart resolves the same (fit, size)
          pair either way (RAC's radios are real named <input
          type="radio">s under the hood, so `name="fit"`/`name="size"` below
          reach FormData for free). See /api/cart.ts and CLAUDE.md's note on
          SignupForm.tsx being the reference for this shape.
        */}
        <form method="POST" action="/api/cart" onSubmit={onSubmit}>
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="quantity" value="1" />
          <input type="hidden" name="locale" value={locale} />
          {/* Where /api/cart's no-JS 303 bounces back to, outcome folded
              into `added=1`/`ce=<code>` — see ProductView.astro. */}
          <input type="hidden" name="redirect" value={redirectTo} />

          {/*
            No visible "Coupe" heading above these: the two tabs say
            "Classique" and "Crop", which is the same information twice on a
            page whose whole point is that nothing is there unasked. The
            accessible name moves to `aria-label` rather than disappearing —
            a radiogroup with no name is a different (and worse) thing than
            one whose name isn't drawn on screen.
          */}
          <RadioGroup
            aria-label={d.productFitLabel}
            name="fit"
            value={fit}
            onChange={(value) => setFit(value as FitId)}
            className="mx-auto mt-5 grid max-w-[13rem] grid-cols-2 gap-px bg-line"
          >
            {fitOptions.map((f) => (
              <Radio key={f.id} value={f.id} density="compact">
                {f.label}
              </Radio>
            ))}
          </RadioGroup>

          {/*
            The band. The name is a static heading — always on screen, never a
            roller — and the sizes render directly with no entrance animation:
            both used to be reachable only once the (now-removed) `+` was
            tapped. Only the price and the button's own label still roll:
            an error can replace the price without moving anything else, and
            the button's label announces its own progress.
          */}
          <div className="mx-auto mt-10 flex w-full max-w-[20rem] flex-col items-center">
            {/*
              Mono/uppercase at the band's own size, not the `wordmark` display
              face: the reference sets the product name in exactly the same
              treatment as the price under it, and at 2xl/3xl in an
              800-weight display face this was the loudest thing on a page
              whose loudest thing should be the photograph.
            */}
            <h1 className="flex h-7 w-full items-center justify-center font-mono text-xs uppercase tracking-label">
              {productName}
            </h1>

          <Slot index={priceSlotIndex} className="mt-1 h-6 w-full">
            <p className="font-mono text-xs text-mute">{price}</p>
            <p role="alert" className="font-mono text-xs text-danger">
              {error}
            </p>
          </Slot>

          <RadioGroup
            aria-label={d.productSizeLabel}
            name="size"
            value={size}
            onChange={onSizeChange}
            // No `place-items-center`: the radios stretch to fill their own
            // column instead, which is what makes "S" and "XXL" the
            // same-sized button (see radio-group.tsx's `tight` density).
            className="mt-4 grid w-full grid-cols-7 gap-x-0.5"
          >
            {sizesForFit.map((v) => (
              /*
                The wrapper exists for the sold-out tip below, and it holds
                the grid cell the Radio used to hold directly — hence
                `flex`, so the Radio's own `w-full`/`min-h-11` still fill
                the cell and every size stays the same size.

                Hover on the wrapper rather than the control: a disabled
                Radio carries `pointer-events-none` (radio-group.tsx), so it
                has no hover of its own. Pointer events pass through it to
                this parent, which is what makes `group-hover` fire over a
                control that can't be interacted with.
              */
              <span key={v.id} className="group relative flex">
                <Radio value={v.options?.size ?? v.id} isDisabled={!v.inStock} density="tight">
                  {v.options?.size ?? v.label}
                  {/*
                    The accessible half, and it stays: a screen reader gets
                    "XXL — Épuisé" from the control's own name, which is
                    information a hover can't carry to someone who never
                    hovers.
                  */}
                  {!v.inStock && <span className="sr-only"> — {d.productOutOfStock}</span>}
                </Radio>
                {/*
                  And the visible half, for the pointer user the strikethrough
                  leaves guessing. `aria-hidden` because the name above
                  already says it — announced twice, it reads as two facts.

                  CSS only, no RAC Tooltip: this is one non-interactive
                  bubble on one control, and the overlay machinery would be
                  the largest thing added to the bundle on this branch
                  (scripts/check-bundle.sh) to say a word the markup already
                  contains. Absolutely positioned, so the band's fixed
                  height — the thing the whole layout is built around — is
                  untouched whether it shows or not.
                */}
                {!v.inStock && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap bg-ink px-1.5 py-1 font-mono text-[10px] uppercase leading-none tracking-label text-paper opacity-0 group-hover:opacity-100 motion-safe:transition-opacity forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]"
                  >
                    {d.productOutOfStock}
                  </span>
                )}
              </span>
            ))}
          </RadioGroup>

          {/* Visually hidden — announced as the button's description while
              no size is picked, same information the disabled state itself
              can't convey to a screen reader. */}
          <span id={sizeHintId} className="sr-only">
            {d.productChooseSize}
          </span>

          <Slot index={actionSlotIndex} className="mt-4 h-11 w-full">
            {/*
              The one tap that fires a purchase — deliberately not disabled
              on `!selectedVariant` any more. It used to be, which meant a
              no-JS visitor could never submit at all: React computes that
              condition client-side, so a native form built from the same
              server render has no way to flip a `disabled` attribute once
              a radio is picked — a disabled submit never fires a form,
              full stop, whichever size is checked. `onSubmit` above (and
              /api/cart itself, for the no-JS case that never reaches it)
              is what actually refuses an incomplete pick now, with a real
              error instead of a button that silently can't be pressed.
            */}
            <Button
              variant="solid"
              type="submit"
              isDisabled={loading}
              aria-describedby={!selectedVariant ? sizeHintId : undefined}
              // `solid`'s own padding falls just under the 44px minimum
              // target size at this font size — min-h-11 (the Slot
              // branch's own height) stretches the button to fill it
              // rather than sitting centred inside it under that height.
              className="min-h-11"
            >
              {d.productAddToCart}
            </Button>
            <span role="status" aria-live="polite" className="font-mono text-xs uppercase tracking-label">
              {d.productAdding}
            </span>
          </Slot>

            {/* The CPA pre-contract disclosure link — Quebec's Consumer
                Protection Act wants this presented before the distance
                contract forms, and the cart page hands off straight to
                Shopify's hosted checkout, so this is the last surface the
                site controls before that happens. */}
            <a
              href={precontractHref}
              className="underline-sweep mt-2 text-[11px] uppercase tracking-label text-mute hover:text-accent-ink"
            >
              {d.precontract}
            </a>
          </div>
        </form>
      </div>
    </I18nProvider>
  )
}
