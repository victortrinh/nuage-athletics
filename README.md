# Nuage Athletics

Landing page + email capture for the fall 2026 drop. Commerce is stubbed behind an
adapter interface and not wired to any page yet.

**Stack:** Astro 7 (static + SSR endpoints) · React islands · Tailwind 4 ·
Cloudflare Workers · D1 · Resend · Turnstile · Stripe (phase 2)

---

## Why it's built this way

**French is the default locale and lives at `/`.** Quebec's Charter of the French
Language requires the French version to be available on terms at least as
favourable as any other language. `/fr` behind an English root would not satisfy
that. English is at `/en/`.

**Every user-facing string is in `src/i18n/ui.ts`, typed by `Dict`.** A missing
French key is a type error, because a partial French site is a compliance
problem rather than a cosmetic one.

**Consent is recorded, not assumed.** CASL requires express consent and puts the
burden of proof on the sender. `subscribers` stores the verbatim wording shown,
its version, timestamp, IP and user agent. Never drop those columns, and never
backfill `consent_version`.

**Commerce sits behind `CommerceAdapter`.** Stripe is the only implementation.
If Lightspeed ever earns its place, implement the interface and change one line
in `src/lib/commerce/index.ts`. Nothing under `src/pages` imports Stripe directly.

---

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in secrets

npm run db:create                # copy the returned database_id into wrangler.toml
npm run db:migrate:local
npm run dev
```

Without `RESEND_API_KEY` the confirmation email is logged to the console with the
confirm URL, and the signup endpoint returns `email_failed` — the row is still
written, so paste the logged URL to finish the double opt-in locally.

Turnstile: `wrangler.toml` ships Cloudflare's always-passes test site key.
Replace both the site key and `TURNSTILE_SECRET_KEY` before production.

## Deploy

```bash
wrangler kv namespace create SESSION   # adapter expects a SESSION binding
wrangler secret put RESEND_API_KEY
wrangler secret put TURNSTILE_SECRET_KEY
npm run db:migrate:remote
npm run deploy
```

Then point DNS at the Worker. **Adding the web records does not touch MX** —
`nuageathletics.com` mail runs on Zoho (Canadian data centre) and is independent.

## Commands

| | |
|---|---|
| `npm run dev` | local dev server |
| `npm run check` | `tsc --noEmit` |
| `npm run build` | production build |
| `npm run db:subscribers` | last 50 signups from remote D1 |

`astro check` is currently unusable: TypeScript 7 dropped the programmatic API the
Astro language server needs. `tsc --noEmit` covers the same ground for now.

---

## Layout

```
src/
├── i18n/          config, route table, all UI strings
├── layouts/       Base.astro (html shell, header, footer)
├── components/    Seo, LocaleSwitcher, SignupForm (React island)
├── lib/
│   ├── consent.ts CASL consent version + sender identity
│   ├── db.ts      D1 queries
│   ├── email.ts   Resend double opt-in
│   ├── turnstile.ts
│   └── commerce/  adapter interface + Stripe impl (phase 2)
└── pages/
    ├── *.astro    French routes at root
    ├── en/        English routes
    └── api/       subscribe, confirm, unsubscribe (prerender = false)
```

---

## Before launch

- [ ] Real mailing address in `src/lib/consent.ts` — CASL requires it in every email
- [ ] Privacy policy and terms written and legally reviewed (both locales)
- [ ] Real Turnstile keys
- [ ] Brand wordmark + typeface
- [ ] `wrangler d1 create` and real `database_id`

## Before selling

- [ ] GST/HST registration (CRA); QST, BC PST, SK PST, MB RST as applicable
- [ ] Enable Stripe Tax for the registrations you actually hold
- [ ] Quebec *Loi sur la protection du consommateur* distance-contract disclosures
- [ ] Flat-rate shipping decided, covering the territories
