import { useState } from 'react'
import { I18nProvider } from 'react-aria-components'
import ProductCarousel from './ProductCarousel'
import { Button } from './ui/button'
import { RadioGroup, Radio } from './ui/radio-group'
import { Slot } from './product/Slot'
import { type Dict } from '../i18n/ui'
import type { Locale } from '../i18n/config'
import type { FitId, ProductFit } from '../lib/catalogue'

interface Variant {
  id: string
  label: string
  inStock: boolean
  options?: Record<string, string>
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
 * "Ajout…" / "Ajouté…"), both `product/Slot.tsx` rollers so neither changes
 * the band's total height.
 */
export default function ProductStage(props: Props) {
  const { locale, d, productId, productName, fits, initialFit, commerceEnabled } = props

  const [fit, setFit] = useState<FitId>(initialFit)
  const [size, setSize] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState(false)
  const [error, setError] = useState('')

  function onSizeChange(value: string) {
    setSize(value)
    setError('')
  }

  async function onBuy() {
    if (!commerceEnabled) return
    const variantId = props.variants.find((v) => v.options?.fit === fit && v.options?.size === size)?.id
    // Unreachable in practice — the button stays disabled until a size is
    // picked — but the fetch below needs a variant id regardless of how it
    // got here.
    if (!variantId) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId, quantity: 1, locale }),
      })
      const data = (await res.json()) as { ok: boolean; url?: string }
      if (data.ok && data.url) {
        // "Ajouté…" is what shows for the moment before the redirect fires
        // — there is no cart to land in, only Stripe's hosted checkout, so
        // this confirms the tap rather than a state the visitor stays in.
        setAdded(true)
        window.location.href = data.url
        return
      }
      setError(d.errorGeneric)
    } catch {
      setError(d.errorGeneric)
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

  const { fitOptions, variants, price, precontractHref } = props
  const sizesForFit = variants.filter((v) => v.options?.fit === fit)
  const selectedVariant = variants.find((v) => v.options?.fit === fit && v.options?.size === size)

  const priceSlotIndex = error ? 1 : 0
  const actionSlotIndex = added ? 2 : loading ? 1 : 0
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
          No visible "Coupe" heading above these: the two tabs say
          "Classique" and "Crop", which is the same information twice on a
          page whose whole point is that nothing is there unasked. The
          accessible name moves to `aria-label` rather than disappearing —
          a radiogroup with no name is a different (and worse) thing than
          one whose name isn't drawn on screen.
        */}
        <RadioGroup
          aria-label={d.productFitLabel}
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
            value={size}
            onChange={onSizeChange}
            // No `place-items-center`: the radios stretch to fill their own
            // column instead, which is what makes "S" and "XXL" the
            // same-sized button (see radio-group.tsx's `tight` density).
            className="mt-4 grid w-full grid-cols-7 gap-x-0.5"
          >
            {sizesForFit.map((v) => (
              <Radio key={v.id} value={v.options?.size ?? v.id} isDisabled={!v.inStock} density="tight">
                {v.options?.size ?? v.label}
                {!v.inStock && <span className="sr-only"> — {d.productOutOfStock}</span>}
              </Radio>
            ))}
          </RadioGroup>

          {/* Visually hidden — announced as the button's description while
              no size is picked, same information the disabled state itself
              can't convey to a screen reader. */}
          <span id={sizeHintId} className="sr-only">
            {d.productChooseSize}
          </span>

          <Slot index={actionSlotIndex} className="mt-4 h-11 w-full">
            {/* The one tap that fires a purchase — disabled until a size is
                picked, so a mis-tap on a size can never reach it by itself. */}
            <Button
              variant="solid"
              type="button"
              onPress={onBuy}
              isDisabled={!selectedVariant || loading}
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
            <span role="status" aria-live="polite" className="font-mono text-xs uppercase tracking-label">
              {d.productAdded}
            </span>
          </Slot>

          {/* The CPA pre-contract disclosure link — Quebec's Consumer
              Protection Act wants this presented before the distance
              contract forms, and checkout jumps straight to Stripe's
              hosted page from here, so this is the last surface the site
              controls before that happens. */}
          <a
            href={precontractHref}
            className="underline-sweep mt-2 text-[11px] uppercase tracking-label text-mute hover:text-accent-ink"
          >
            {d.precontract}
          </a>
        </div>
      </div>
    </I18nProvider>
  )
}
