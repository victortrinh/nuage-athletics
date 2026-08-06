import { useState } from 'react'
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
  variants: Variant[]
}

export default function BuyButton({ locale, d, variants }: Props) {
  const [variantId, setVariantId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      <p className="text-xs uppercase tracking-widest opacity-70">{d.productSizeLabel}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {variants.map((v) => (
          <button
            key={v.id}
            type="button"
            disabled={!v.inStock}
            onClick={() => setVariantId(v.id)}
            aria-pressed={variantId === v.id}
            className={`border px-4 py-2 text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              variantId === v.id
                ? 'border-white bg-white text-black'
                : 'border-white/40 hover:border-white'
            }`}
          >
            {v.inStock ? v.label : `${v.label} — ${d.productOutOfStock}`}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onBuy}
        disabled={loading}
        className="mt-8 border border-white/40 px-6 py-3 text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors disabled:opacity-40"
      >
        {loading ? d.submitting : d.productBuy}
      </button>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
