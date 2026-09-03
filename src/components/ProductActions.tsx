import { useState } from 'react'
import { I18nProvider } from 'react-aria-components'
import SignupForm from './SignupForm.tsx'
import { Button } from './ui/button'
import { RadioGroup, Radio } from './ui/radio-group'
import { useFit } from '../lib/fit-store'
import type { Locale } from '../i18n/config'
import type { Dict } from '../i18n/ui'
import type { FitId } from '../lib/catalogue'

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

interface Props {
  locale: Locale
  d: Dict
  productId: string
  variants: Variant[]
  /** Fit id + display label only — the photography lives in ProductCarousel's props, not here. */
  fits: FitOption[]
  initialFit: FitId
  /**
   * When false the size selector still works, but there is nothing to buy —
   * the call to action captures an email instead, tagged with the size, so a
   * visitor who came to buy is not simply turned away.
   */
  commerceEnabled: boolean
  turnstileSiteKey?: string
}

export default function ProductActions({
  locale,
  d,
  productId,
  variants,
  fits,
  initialFit,
  commerceEnabled,
  turnstileSiteKey,
}: Props) {
  const [fit, setFit] = useFit(productId, initialFit)
  // Bound to the size string, not the variant id — with fit added as a
  // second axis, binding directly to a variant id would silently invalidate
  // the chosen size the moment fit changes. The variant is resolved below
  // from (fit, size) instead. Size deliberately starts unset (no default,
  // unlike fit): the buyer should make an explicit choice.
  const [size, setSize] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selected = variants.find((v) => v.options?.fit === fit && v.options?.size === size)
  const variantId = selected?.id ?? null

  async function onBuy() {
    if (!variantId) {
      setError(d.productSelectSizeError)
      return
    }
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

  const fitLabelId = `fit-label-${productId}`
  const sizeLabelId = `size-label-${productId}`

  // Sizes available in the selected fit, in catalogue order. Every fit
  // carries the same six sizes today, but scoping to the active fit keeps
  // this correct if that ever stops being true.
  const sizesForFit = variants.filter((v) => v.options?.fit === fit)

  return (
    <I18nProvider locale={locale}>
      <div>
        <p id={fitLabelId} className="text-[11px] uppercase tracking-label text-mute">
          {d.productFitLabel}
        </p>
        <RadioGroup
          aria-labelledby={fitLabelId}
          value={fit}
          onChange={(value) => setFit(value as FitId)}
          className="mt-3 grid grid-cols-2 gap-px bg-line"
        >
          {fits.map((f) => (
            <Radio key={f.id} value={f.id}>
              {f.label}
            </Radio>
          ))}
        </RadioGroup>

        <p id={sizeLabelId} className="mt-8 text-[11px] uppercase tracking-label text-mute">
          {d.productSizeLabel}
        </p>

        {/*
          RadioGroup, not five independently-toggled buttons: exactly one
          size can be selected, which is what role="radiogroup" and arrow-key
          roving tabindex mean, and aria-pressed on plain buttons never gave
          screen-reader/keyboard users either. One real behaviour change from
          the old buttons: clicking the selected size no longer deselects it
          (a radio group can't represent "none" once one is picked) — same
          as any native <input type="radio"> group.

          catalogue.ts hardcodes every variant inStock today, so isDisabled
          is always false in practice and the sr-only out-of-stock text below
          is dormant — both are wired correctly for whenever real stock data
          lands. Note RAC's RadioGroup skips disabled radios during arrow
          navigation, so that text is reachable in browse mode but not by
          arrow keys — the visual `line-through` (in radio-group.tsx) is
          still the primary signal for sighted users either way.
        */}
        <RadioGroup
          aria-labelledby={sizeLabelId}
          value={size}
          onChange={setSize}
          className="mt-3 grid grid-cols-3 gap-px bg-line sm:grid-cols-6 lg:grid-cols-3"
        >
          {sizesForFit.map((v) => (
            <Radio key={v.id} value={v.options?.size ?? v.id} isDisabled={!v.inStock}>
              {v.options?.size ?? v.label}
              {!v.inStock && <span className="sr-only"> — {d.productOutOfStock}</span>}
            </Radio>
          ))}
        </RadioGroup>

        {commerceEnabled ? (
          <>
            <Button onPress={onBuy} isDisabled={loading} className="mt-8">
              {loading ? d.submitting : d.productBuy}
            </Button>
            {error && (
              <p role="alert" className="mt-4 text-sm text-danger">
                {error}
              </p>
            )}
          </>
        ) : (
          <div className="mt-10 border-t border-line pt-8">
            <p className="text-[11px] uppercase tracking-label text-mute">{d.productNotifyTitle}</p>
            <p className="mt-3 text-sm leading-relaxed">{d.productNotifyBody}</p>
            <div className="mt-6">
              {/*
                The consent checkbox inside SignupForm stays visible and
                unchecked. Wanting to be told when something ships is not consent
                to be emailed, and /api/subscribe requires a literal true.
              */}
              <SignupForm
                locale={locale}
                d={d}
                turnstileSiteKey={turnstileSiteKey}
                source={`product:${productId}:${fit}:${size ?? 'unspecified'}`}
                idPrefix={`signup-${productId}`}
              />
            </div>
          </div>
        )}
      </div>
    </I18nProvider>
  )
}
