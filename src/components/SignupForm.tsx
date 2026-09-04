import { useEffect, useRef, useState, type FormEvent } from 'react'
import { I18nProvider } from 'react-aria-components'
import type { Locale } from '../i18n/config'
import type { Dict } from '../i18n/ui'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { TextField, Label, Input, FieldError } from './ui/text-field'

interface Props {
  locale: Locale
  d: Dict
  turnstileSiteKey?: string
  /**
   * Where this signup came from — recorded on the subscriber row. The product
   * page passes the selected size so a "notify me" tells us which size to
   * restock first. Falls back to the referrer when the caller says nothing.
   */
  source?: string
  /** Overrides the button copy where "sign up" is the wrong verb. */
  submitLabel?: string
  /**
   * Astro renders each island as its own React root and doesn't expose
   * `identifierPrefix`, so two SignupForms on one page would both start
   * their internal id counters at zero. Not a collision today — there's
   * one island per page — but an explicit prefix removes the trap for
   * whoever adds a second one. Falls back to a fixed id when omitted.
   */
  idPrefix?: string
  /**
   * The page this form lives on, e.g. `/acces/` or the current product path
   * — carried as a hidden field so /api/subscribe knows where to bounce a
   * no-JS submit back to. Omitted only means a caller forgot; the endpoint
   * falls back to '/' rather than failing.
   */
  redirectTo?: string
  /**
   * A no-JS submit can't stay on the page to render its own result — the
   * endpoint redirects back here with the outcome folded into the URL
   * ('se=<code>' or 'sent=1') instead, and the caller reads that back out of
   * `Astro.url.searchParams` and passes it straight through as one of these
   * two. Server render and first client render then agree on `state` from
   * the same props, so there's nothing for hydration to reconcile.
   */
  initialErrorCode?: string
  initialSuccess?: boolean
}

type State =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; code: string; message: string }

function errorMessage(d: Dict, code: string): string {
  const map: Record<string, string> = {
    invalid_email: d.errorEmail,
    consent_required: d.errorConsent,
    rate_limited: d.errorRate,
    already_subscribed: d.alreadySubscribed,
    challenge_failed: d.errorChallenge,
    email_failed: d.errorEmailSend,
  }
  return map[code] ?? d.errorGeneric
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      remove: (id: string) => void
      reset: (id?: string) => void
    }
  }
}

const TURNSTILE_SRC = 'script[src*="turnstile/v0/api.js"]'

export default function SignupForm({
  locale,
  d,
  turnstileSiteKey,
  source,
  submitLabel,
  idPrefix = 'signup',
  redirectTo,
  initialErrorCode,
  initialSuccess,
}: Props) {
  const [state, setState] = useState<State>(() => {
    if (initialSuccess) return { kind: 'success' }
    if (initialErrorCode) {
      return { kind: 'error', code: initialErrorCode, message: errorMessage(d, initialErrorCode) }
    }
    return { kind: 'idle' }
  })
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const widgetRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const successHeadingRef = useRef<HTMLParagraphElement>(null)

  /**
   * Render Turnstile ourselves rather than letting api.js auto-scan the page.
   * Auto-render injects into this container while React is still hydrating,
   * which breaks hydration and costs us the widget (and therefore the token).
   * An effect runs after hydration, so the DOM the server sent is never
   * touched before React is done with it.
   *
   * Two things have to be true before rendering: api.js has loaded, and the
   * container actually has a layout box. The gate screen keeps this form
   * inside a collapsed <details>, whose contents aren't rendered at all —
   * Turnstile draws an iframe, and one rendered into nothing never finishes
   * its challenge, so we'd hand the endpoint an empty token. Whichever of
   * the two happens last triggers the mount; `mount` is idempotent, so
   * being called from both paths is harmless.
   */
  useEffect(() => {
    if (!turnstileSiteKey) return

    function mount() {
      const el = widgetRef.current
      if (!el || !window.turnstile || widgetId.current !== null) return
      // checkVisibility is Baseline-2023; treat its absence as visible,
      // which is the pre-<details> behaviour.
      if (el.checkVisibility && !el.checkVisibility()) return
      widgetId.current = window.turnstile.render(el, {
        sitekey: turnstileSiteKey,
        theme: 'light',
      })
    }

    // api.js is async: it may already be there, or still in flight.
    const script = document.querySelector<HTMLScriptElement>(TURNSTILE_SRC)
    if (window.turnstile) mount()
    else script?.addEventListener('load', mount, { once: true })

    // No-op for every form that isn't inside a disclosure.
    const disclosure = widgetRef.current?.closest('details')
    disclosure?.addEventListener('toggle', mount)

    return () => {
      script?.removeEventListener('load', mount)
      disclosure?.removeEventListener('toggle', mount)
      if (widgetId.current !== null) {
        window.turnstile?.remove(widgetId.current)
        widgetId.current = null
      }
    }
  }, [turnstileSiteKey])

  // Moves focus into the success panel once it replaces the form — without
  // this, focus (which was on the submit button) is dropped to <body> when
  // that button unmounts.
  useEffect(() => {
    if (state.kind === 'success') successHeadingRef.current?.focus()
  }, [state.kind])

  function resetTurnstile() {
    if (widgetId.current !== null) window.turnstile?.reset(widgetId.current)
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (state.kind === 'submitting') return

    // Client-side checks are UX only. The endpoint re-validates everything.
    if (!consent) {
      setState({ kind: 'error', code: 'consent_required', message: d.errorConsent })
      return
    }

    setState({ kind: 'submitting' })
    const form = new FormData(e.currentTarget)
    // A real visitor never fills the honeypot. Read it straight from the DOM —
    // consent stays a React boolean (see the comment on the checkbox below),
    // this is the one field that's safe to source from FormData.
    const company = String(form.get('company') ?? '') || undefined

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          locale,
          consent,
          company,
          turnstileToken: form.get('cf-turnstile-response') ?? undefined,
          source: source ?? (typeof document !== 'undefined' ? document.referrer || null : null),
        }),
      })

      const data = (await res.json()) as { ok: boolean; code?: string }

      if (data.ok) {
        setState({ kind: 'success' })
        return
      }

      const code = data.code ?? ''
      // Turnstile tokens are single use. Without a reset, retrying after an
      // error submits the spent token and fails the challenge every time.
      resetTurnstile()
      setState({ kind: 'error', code, message: errorMessage(d, code) })
    } catch {
      resetTurnstile()
      setState({ kind: 'error', code: 'network', message: d.errorGeneric })
    }
  }

  // A field-level error (the email itself is invalid) gets FieldError,
  // scoped to that input via TextField's built-in aria-invalid/
  // aria-describedby wiring. Every other error (consent, rate limit,
  // already-subscribed, Turnstile, Resend) is form-level, not about what's
  // in the email box, and keeps the standalone alert below.
  const emailInvalid = state.kind === 'error' && state.code === 'invalid_email'
  const formError = state.kind === 'error' && state.code !== 'invalid_email' ? state.message : null

  // One persistent live region across every state, so a screen reader
  // announces the *transition* into "submitting" and then "success" —
  // a region that appears already populated (the old success-only markup)
  // is not reliably announced by most screen readers, only a mutation to
  // an existing one is.
  const liveMessage = state.kind === 'submitting' ? d.submitting : state.kind === 'success' ? d.successTitle : ''

  return (
    <I18nProvider locale={locale}>
      <p role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </p>

      {state.kind === 'success' ? (
        <div className="max-w-md">
          <p ref={successHeadingRef} tabIndex={-1} className="text-lg font-medium focus:outline-none">
            {d.successTitle}
          </p>
          <p className="mt-2 text-sm text-mute">{d.successBody}</p>
        </div>
      ) : (
        <form
          method="POST"
          action="/api/subscribe"
          onSubmit={onSubmit}
          className="max-w-md w-full"
          noValidate
        >
          {/* honeypot — real users never fill this */}
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
          />

          {/*
            Carries what the fetch body in onSubmit sends explicitly, for the
            native POST a no-JS (or not-yet-hydrated) submit falls back to.
            onSubmit's own fetch call ignores these — it reads `email`/
            `locale`/`source`/`consent` from component state and props, not
            from FormData — so there's nothing here for the hydrated path to
            get out of sync with.
          */}
          <input type="hidden" name="locale" value={locale} />
          {source && <input type="hidden" name="source" value={source} />}
          {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}

          <TextField
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            isRequired
            isInvalid={emailInvalid}
            validationBehavior="aria"
            value={email}
            onChange={setEmail}
          >
            <Label>{d.emailLabel}</Label>
            <Input
              autoComplete="email"
              inputMode="email"
              placeholder={d.emailPlaceholder}
              className="mt-2"
            />
            {emailInvalid && <FieldError className="mt-2">{d.errorEmail}</FieldError>}
          </TextField>

          {/*
            CASL requires express consent. isSelected/onChange, never
            defaultSelected — the box must never be pre-checked, and the
            wording must match CONSENT_VERSION in src/lib/consent.ts.
          */}
          <Checkbox
            name="consent"
            className="mt-6"
            isSelected={consent}
            onChange={setConsent}
          >
            <span className="text-mute">{d.consentLabel}</span>
          </Checkbox>

          {/* Left empty on the server; the effect above fills it after hydration. */}
          {turnstileSiteKey && <div ref={widgetRef} className="mt-6" />}

          <Button type="submit" isDisabled={state.kind === 'submitting'} className="mt-8">
            {state.kind === 'submitting' ? d.submitting : (submitLabel ?? d.submit)}
          </Button>

          {formError && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {formError}
            </p>
          )}
        </form>
      )}
    </I18nProvider>
  )
}
