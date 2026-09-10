import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { I18nProvider } from 'react-aria-components'
import ProductCarousel from './ProductCarousel'
import { Button } from './ui/button'
import { RadioGroup, Radio } from './ui/radio-group'
import { Slot } from './product/Slot'
import { cn } from './ui/cn'
import { fmt, type Dict } from '../i18n/ui'
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

interface Spec {
  label: string
  value: string
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
      description: string
      specs: Spec[]
    })

/** Rem offset applied to each size button before the band opens, so they
 *  converge toward the row's centre rather than just fading in place — the
 *  adapted version of Yeezy's --tx/--ty displacement (see CLAUDE.md and the
 *  PR this shipped from). Kept small: this is a flourish riding on top of
 *  the slot roll, not the primary motion. */
const FLY_OUT_STEP_REM = 0.9

/**
 * The product page's single interactive root — carousel, fit picker and the
 * fixed-height buy band, merged into one island.
 *
 * This used to be two: ProductCarousel and ProductActions, sharing the
 * selected fit through a module-level store (`src/lib/fit-store.ts`)
 * because lifting both into one island "would hydrate the heading,
 * description and spec list for no interactive reason" (CLAUDE.md's old
 * wording). That reasoning doesn't hold any more — this redesign puts the
 * heading, price, description and spec list *inside* the interactive band,
 * where they roll and toggle. See fit-store.ts's removal in the same
 * commit.
 *
 * The band itself is four fixed-height "slots" (product/Slot.tsx) stacked
 * under the carousel and fit picker. Collapsed, slot A shows the product
 * name and slot C shows a single `+`. Opening it rolls slot A to "choose a
 * size" (or, once one's picked, "buy · <size>" — a real button, so a mis-tap
 * on a size never fires a purchase) and slot C's size grid flies in; a
 * second tap on the "information" toggle in slot D swaps slot C for the
 * description and spec list without moving anything else. None of these
 * transitions changes the band's total height, which is the whole point:
 * the carousel above it never moves.
 */
export default function ProductStage(props: Props) {
  const { locale, d, productId, productName, fits, initialFit, commerceEnabled } = props

  const [fit, setFit] = useState<FitId>(initialFit)
  const [open, setOpen] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [size, setSize] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const plusRef = useRef<HTMLButtonElement>(null)
  const sizeGroupRef = useRef<HTMLDivElement>(null)
  const openedOnce = useRef(false)

  const uid = useId()
  const sizeGroupId = `size-group-${uid}`
  const infoPanelId = `info-panel-${uid}`

  // Opening moves focus to the first size radio; closing returns it to the
  // trigger — both only once the transition is user-driven, never on mount.
  useEffect(() => {
    if (!openedOnce.current) {
      openedOnce.current = true
      return
    }
    if (open) {
      sizeGroupRef.current?.querySelector<HTMLElement>('input')?.focus()
    } else {
      plusRef.current?.focus()
    }
  }, [open])

  function openBand() {
    setOpen(true)
    setShowInfo(false)
  }

  function closeBand() {
    setOpen(false)
    setShowInfo(false)
  }

  function onSizeChange(value: string) {
    setSize(value)
    setError('')
  }

  async function onBuy() {
    if (!commerceEnabled) return
    const variantId = props.variants.find((v) => v.options?.fit === fit && v.options?.size === size)?.id
    // Unreachable in practice — slot A only renders this as a button once a
    // size is picked — but the fetch below needs a variant id regardless of
    // how it got here.
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
    // moving into slot A. chromeRem is hand-measured from just that
    // heading + one line of announcement text, with a little cushion —
    // see ProductCarousel.tsx's frame-sizing comment. Nothing above the
    // carousel here, so it's all below-frame chrome.
    return (
      <ProductCarousel
        d={d}
        fit={fit}
        fits={fits}
        initialFit={initialFit}
        chromeRem={{ base: 14, sm: 13 }}
      />
    )
  }

  const { fitOptions, variants, price, description, specs } = props
  const sizesForFit = variants.filter((v) => v.options?.fit === fit)
  const selectedVariant = variants.find((v) => v.options?.fit === fit && v.options?.size === size)
  const center = (sizesForFit.length - 1) / 2

  const slotAIndex = !open ? 0 : loading ? 3 : selectedVariant ? 2 : 1
  const slotBIndex = error ? 1 : 0
  const slotCIndex = !open ? 0 : showInfo ? 2 : 1
  const slotDIndex = open ? 1 : 0

  return (
    <I18nProvider locale={locale}>
      {/*
        The pad above the carousel is the top half of a trade, not decoration.
        ProductView.astro centres this whole block inside a reserved screenful
        (`justify-center`), so on a phone — where the frame is bound by width,
        not by the height budget below, and so leaves real slack — the leftover
        room was splitting evenly and pooling under the collapsed band's `+`,
        which has an empty slot D beneath it besides. Air added above the photo
        and between it and the marker row (ProductCarousel's own `mt-8 sm:mt-4`)
        comes out of that slack, so the band stops trailing a stretch of nothing.
        Both numbers are part of the column's chrome, hence `chromeRem` below.
      */}
      <div className="pt-10 sm:pt-2">
        {/* chromeRem is hand-measured from the pad above plus the fit picker
            and band that follow — see ProductCarousel.tsx's frame-sizing
            comment. `sm:` is smaller because that pad is (the band itself is
            the same height at both breakpoints). */}
        <ProductCarousel
          d={d}
          fit={fit}
          fits={fits}
          initialFit={initialFit}
          chromeRem={{ base: 20.5, sm: 18.5 }}
        />

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
          The band. Every slot below is the same fixed height in every
          state it can be in — that constancy is the feature, not a detail,
          so resist adding a conditional that would make one taller in one
          branch than another.
        */}
        <div className="mx-auto mt-10 flex w-full max-w-[20rem] flex-col items-center">
          <Slot index={slotAIndex} className="h-7 w-full">
            {/*
              Mono/uppercase at the band's own size, not the `wordmark`
              display face: the reference sets the product name in exactly
              the same treatment as the price under it, and at 2xl/3xl in
              an 800-weight display face this was the loudest thing on a
              page whose loudest thing should be the photograph.

              It also fixes a real bug rather than only a weight: at
              `leading-none` the line box is the em box, so descenders fell
              outside it and the slot's `overflow-y-clip` (product/Slot.tsx)
              took the tail off the "g" in "Longues". Normal leading gives
              the line box room for them, and uppercase has none to clip in
              the first place.
            */}
            <h1 className="font-mono text-xs uppercase tracking-label">{productName}</h1>
            {/* Not a control — the band is already open by the time this
                branch can show (index 1 only happens once `open` is true);
                opening it happens from slot C's `+`, below. */}
            <p className="font-mono text-xs uppercase tracking-label text-mute">{d.productChooseSize}</p>
            {/* A real button, not just rolled-in text: this is the one tap
                that fires a purchase, so it has to be a distinct control a
                mis-tap on a size can never reach — selecting a size only
                gets you here, it doesn't submit anything by itself. */}
            <Button
              variant="text"
              type="button"
              onPress={onBuy}
              isDisabled={loading}
              className="font-mono text-xs"
            >
              {selectedVariant && fmt(d.productBuySize, { size: selectedVariant.options?.size ?? '' })}
            </Button>
            <span role="status" aria-live="polite" className="font-mono text-xs uppercase tracking-label text-mute">
              {d.productAdding}
            </span>
          </Slot>

          <Slot index={slotBIndex} className="mt-1 h-6 w-full">
            <p className="font-mono text-xs text-mute">{price}</p>
            <p role="alert" className="font-mono text-xs text-danger">
              {error}
            </p>
          </Slot>

          {/*
            One height at every breakpoint now that the sizes are one row
            everywhere (they used to wrap to two below `sm:`, so this slot
            had to be 3rem taller there to hold them). Worth keeping
            uniform beyond the tidiness: this slot is also what the
            information panel renders into, and its height was the only
            thing making the band's own height breakpoint-dependent — which
            is the number ProductCarousel's `chromeRem` has to track.
          */}
          <Slot index={slotCIndex} className="mt-4 h-20 w-full">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={sizeGroupId}
              aria-label={d.productChooseSize}
              onClick={openBand}
              ref={plusRef}
              className="press flex size-11 items-center justify-center"
            >
              <PlusMinus open={false} />
            </button>

            <div ref={sizeGroupRef} id={sizeGroupId} className="w-full">
              <RadioGroup
                aria-label={d.productSizeLabel}
                value={size}
                onChange={onSizeChange}
                // No `place-items-center`: the radios stretch to fill their
                // own column instead, which is what makes "S" and "XXL" the
                // same-sized button (see radio-group.tsx's `tight` density).
                className="grid grid-cols-7 gap-x-0.5"
              >
                {sizesForFit.map((v, i) => (
                  <Radio
                    key={v.id}
                    value={v.options?.size ?? v.id}
                    isDisabled={!v.inStock}
                    density="tight"
                    style={
                      {
                        // Settles at 0 once open — the offset is the
                        // *starting* position the size flies in from, not a
                        // permanent displacement. Leaving it applied in both
                        // states (as this did until the sizes moved onto one
                        // row and it showed up as the outer two overhanging
                        // the band) means every size sits up to 2.25rem off
                        // its own grid cell for as long as the band is open.
                        '--tx': open ? '0rem' : `${(center - i) * -FLY_OUT_STEP_REM}rem`,
                        transitionDelay: open ? `${i * 20}ms` : '0ms',
                      } as CSSProperties
                    }
                    className={cn(
                      'translate-x-[var(--tx)] motion-safe:transition-[transform,opacity] motion-safe:duration-300 motion-safe:ease-out',
                      open ? 'scale-100 opacity-100' : 'pointer-events-none scale-75 opacity-0'
                    )}
                  >
                    {v.options?.size ?? v.label}
                    {!v.inStock && <span className="sr-only"> — {d.productOutOfStock}</span>}
                  </Radio>
                ))}
              </RadioGroup>
            </div>

            {/* The information panel shares this slot with the size grid —
                same device Yeezy uses — so opening it never moves the
                carousel or the fit picker above. Long content (a French
                spec label, a taller viewport font size) scrolls inside the
                fixed box rather than growing it, which is what keeps the
                band's total height genuinely constant across every state,
                not just the common ones. */}
            <div id={infoPanelId} className="max-h-full w-full overflow-y-auto px-1 text-center">
              <p className="text-xs leading-relaxed text-mute">{description}</p>
              <dl className="mt-3 space-y-1">
                {specs.map((spec) => (
                  <div key={spec.label} className="flex justify-between gap-4 text-left text-[10px] uppercase tracking-label text-mute">
                    <dt>{spec.label}</dt>
                    <dd className="text-ink">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Slot>

          <Slot index={slotDIndex} className="mt-2 h-8 w-full">
            <span aria-hidden="true" />
            <div className="flex items-center justify-center gap-6">
              <Button
                variant="text"
                type="button"
                aria-expanded={showInfo}
                aria-controls={infoPanelId}
                onPress={() => setShowInfo((v) => !v)}
                className="text-[11px]"
              >
                {d.productDetails}
              </Button>
              <button
                type="button"
                aria-label={d.productCloseSizes}
                onClick={closeBand}
                className="press flex size-11 items-center justify-center"
              >
                <PlusMinus open={true} />
              </button>
            </div>
          </Slot>
        </div>
      </div>
    </I18nProvider>
  )
}

/**
 * Drawn, not typed: two crossed 1px `--color-line`-weight rules, the same
 * hairline device the rest of the layout is built from — this site has no
 * icon font and no lucide-react (CLAUDE.md). Rotating the whole mark 45°
 * turns the drawn `+` into an `×` with one `motion-safe:rotate-45`, no
 * second glyph to name or swap in. Two separate instances of this component
 * exist in the band (the big collapsed trigger in slot C, the small close
 * control in slot D) rather than one element that relocates across states —
 * relocating it would itself be a reflow, exactly what the band exists to
 * avoid — but both draw from this one definition, which is what keeps them
 * reading as the same control.
 */
function PlusMinus({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block size-3 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
        open && 'motion-safe:rotate-45'
      )}
    >
      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-current" />
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-current" />
    </span>
  )
}
