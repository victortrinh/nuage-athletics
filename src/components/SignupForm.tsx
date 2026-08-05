import { useState, type FormEvent } from 'react'
import type { Locale } from '../i18n/config'
import type { Dict } from '../i18n/ui'

interface Props {
  locale: Locale
  d: Dict
  turnstileSiteKey?: string
}

type State =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
    }
  }
}

export default function SignupForm({ locale, d, turnstileSiteKey }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (state.kind === 'submitting') return

    // Client-side checks are UX only. The endpoint re-validates everything.
    if (!consent) {
      setState({ kind: 'error', message: d.errorConsent })
      return
    }

    setState({ kind: 'submitting' })
    const form = new FormData(e.currentTarget)

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          locale,
          consent,
          turnstileToken: form.get('cf-turnstile-response') ?? undefined,
          source: typeof document !== 'undefined' ? document.referrer || null : null,
        }),
      })

      const data = (await res.json()) as { ok: boolean; code?: string }

      if (data.ok) {
        setState({ kind: 'success' })
        return
      }

      const map: Record<string, string> = {
        invalid_email: d.errorEmail,
        consent_required: d.errorConsent,
        rate_limited: d.errorRate,
        already_subscribed: d.alreadySubscribed,
      }
      setState({ kind: 'error', message: map[data.code ?? ''] ?? d.errorGeneric })
    } catch {
      setState({ kind: 'error', message: d.errorGeneric })
    }
  }

  if (state.kind === 'success') {
    return (
      <div role="status" className="max-w-md">
        <p className="text-lg font-medium">{d.successTitle}</p>
        <p className="mt-2 text-sm opacity-70">{d.successBody}</p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md w-full" noValidate>
      {/* honeypot — real users never fill this */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <label htmlFor="email" className="block text-xs uppercase tracking-widest opacity-70">
        {d.emailLabel}
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        placeholder={d.emailPlaceholder}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-2 w-full bg-transparent border-b border-white/30 py-2 text-base outline-none focus:border-white transition-colors"
      />

      {/*
        CASL requires express consent. This checkbox must never be pre-checked
        and the wording must match CONSENT_VERSION in src/lib/consent.ts.
      */}
      <label className="mt-6 flex gap-3 items-start text-sm leading-relaxed">
        <input
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 shrink-0 accent-white"
        />
        <span className="opacity-80">{d.consentLabel}</span>
      </label>

      {turnstileSiteKey && (
        <div
          className="cf-turnstile mt-6"
          data-sitekey={turnstileSiteKey}
          data-theme="dark"
        />
      )}

      <button
        type="submit"
        disabled={state.kind === 'submitting'}
        className="mt-8 border border-white/40 px-6 py-3 text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors disabled:opacity-40"
      >
        {state.kind === 'submitting' ? d.submitting : d.submit}
      </button>

      {state.kind === 'error' && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {state.message}
        </p>
      )}
    </form>
  )
}
