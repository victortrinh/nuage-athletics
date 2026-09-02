import { useState } from 'react'
import SignupForm from './SignupForm.tsx'
import type { Locale } from '../i18n/config'
import type { Dict } from '../i18n/ui'

interface Variant {
  id: string
  label: string
  inStock: boolean
}

interface Props {
  locale: Locale
  d: Dict
  productId: string
  variants: Variant[]
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
  commerceEnabled,
  turnstileSiteKey,
}: Props) {
  const [variantId, setVariantId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selected = variants.find((v) => v.id === variantId)

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

  return (
    <div>
      <p
        className="text-[11px] uppercase text-mute"
        style={{ letterSpacing: 'var(--tracking-label)' }}
      >
        {d.productSizeLabel}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-px bg-line sm:grid-cols-6 lg:grid-cols-3">
        {variants.map((v) => (
          <button
            key={v.id}
            type="button"
            disabled={!v.inStock}
            onClick={() => setVariantId(variantId === v.id ? '' : v.id)}
            aria-pressed={variantId === v.id}
            className={`bg-paper px-3 py-3 text-xs uppercase transition-colors disabled:cursor-not-allowed disabled:text-mute disabled:line-through ${
              variantId === v.id ? 'bg-ink text-paper' : 'hover:bg-ink hover:text-paper'
            }`}
            style={{ letterSpacing: 'var(--tracking-label)' }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {commerceEnabled ? (
        <>
          <button
            type="button"
            onClick={onBuy}
            disabled={loading}
            className="mt-8 w-full border border-ink bg-ink px-6 py-3 text-[11px] uppercase text-paper transition-colors hover:bg-paper hover:text-ink disabled:opacity-40"
            style={{ letterSpacing: 'var(--tracking-label)' }}
          >
            {loading ? d.submitting : d.productBuy}
          </button>
          {error && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}
        </>
      ) : (
        <div className="mt-10 border-t border-line pt-8">
          <p
            className="text-[11px] uppercase text-mute"
            style={{ letterSpacing: 'var(--tracking-label)' }}
          >
            {d.productNotifyTitle}
          </p>
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
              source={`product:${productId}:${selected?.label ?? 'unspecified'}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}
