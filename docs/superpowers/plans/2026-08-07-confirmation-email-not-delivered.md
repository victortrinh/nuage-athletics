# Confirmation Email Not Delivered — Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make double opt-in confirmation emails actually arrive, and make it impossible for a failed send to be reported to the subscriber as success.

**Architecture:** Two independent defects stack up. (1) Delivery: `nuageathletics.com` has no Resend authentication in DNS, so Resend almost certainly refuses the send. (2) Visibility: `src/pages/api/subscribe.ts` swallows the send failure and returns `{ ok: true }`, so the form says "check your inbox" for an email that was never sent. Fix the visibility defect with tests first (it is what hid the bug), then authenticate the domain, then verify end to end against production.

**Tech Stack:** Astro 7 SSR endpoint on Cloudflare Workers · D1 · Resend HTTP API · vitest + `@cloudflare/vitest-pool-workers` · Cloudflare DNS

---

## Evidence gathered (2026-08-07)

| Check | Result |
|---|---|
| Rows in remote D1 | `victor.trinh@outlook.com` (02:30:24 UTC) and `tda.victor@gmail.com` (02:29:35 UTC), both `status = pending`, `locale = fr-CA` |
| `wrangler secret list` | `RESEND_API_KEY` **is** set on the Worker (so the dev stub in `src/lib/email.ts:90` is not the production path) |
| `https://nuageathletics.com/` | 200 — the live site served the signup |
| Root SPF | `v=spf1 include:zohocloud.ca ~all` — Zoho only, **Resend not authorized** |
| DKIM at `resend._domainkey.nuageathletics.com` | **absent** (only Zoho's `zmail._domainkey` exists) |
| `send.nuageathletics.com` (Resend's bounce subdomain) | **absent** — no MX, no TXT |
| DMARC | `p=none; adkim=r; aspf=r` |
| Root MX | Zoho (`mx.zohocloud.ca` et al.) — receiving is healthy and unrelated |
| `test/subscribe.test.ts` | Never exercises the email path at all; with no `RESEND_API_KEY` bound, every test silently takes the dev-stub branch |

**What this rules out:** the request reaching the endpoint, Turnstile, rate limiting, validation, and the D1 write — all worked, for both addresses. **Two different mailbox providers (Outlook and Gmail) both received nothing**, which points at a send that never left Resend rather than at spam filtering.

**Root cause — CONFIRMED 2026-08-07:** Victor checked https://resend.com/domains: **no domains are registered on the account at all.** `nuageathletics.com` was never added, so `POST https://api.resend.com/emails` rejects every send with `403 validation_error: The nuageathletics.com domain is not verified`. Nothing was ever handed to a mail server — this is not a deliverability or spam-filtering problem. `subscribe.ts:106-109` logs that rejection to `console.error` and returns `{ ok: true }` anyway, which is why the form kept saying "check your inbox". Task 1 is complete; Task 5 is the fix.

### Task 1 attempt, 2026-08-07 17:58 — the re-send branch logs nothing at all

Resubmitted `victor.trinh@outlook.com` on production with `wrangler tail` attached. The tail record:

```json
{ "outcome": "ok", "logs": [], "exceptions": [],
  "event": { "request": { "url": "https://nuageathletics.com/api/subscribe", "method": "POST" },
             "response": { "status": 200 } } }
```

`logs: []` is not evidence that the send worked. The address was already `pending`, so the request took the **re-send branch** (`src/pages/api/subscribe.ts:76-85`), which discards `sendConfirmationEmail`'s return value without even a `console.error`. That branch is the one Victor hits on every retry with his own address, and it is structurally incapable of reporting a failure — worse than the first-send branch, which at least logs.

**Consequence for this plan:** the reproduction has to use an address with no row yet, so it lands in the first-send branch at `subscribe.ts:98-109`. A further attempt from the automated browser was blocked when Turnstile escalated to an interactive challenge, so the literal Resend status is still uncaptured. It does not change any task below: the DNS evidence already shows the domain cannot be verified in Resend, and Tasks 2-5 are identical whether the status is 403 (unverified) or 401 (bad key). Get the status from the Resend dashboard (Steps 1-2) rather than by reproducing.

---

### Task 1: Confirm the exact Resend rejection

No code changes. Do not skip — everything downstream assumes we know why the send failed.

**Files:** none

- [ ] **Step 1: Check the Resend dashboard for the two sends**

Open https://resend.com/emails and look for anything to `victor.trinh@outlook.com` or `tda.victor@gmail.com` around 2026-08-07 02:29–02:31 UTC.

Expected if the hypothesis holds: **nothing at all** — Resend rejects unverified-domain sends at the API boundary, so they never become log entries. If entries *do* exist with a `bounced`/`delivered` status, the hypothesis is wrong: stop, and re-run Phase 1 investigation against deliverability instead (check the bounce reason shown there).

- [ ] **Step 2: Check the domain's status in Resend**

Open https://resend.com/domains. Record whether `nuageathletics.com` is listed and, if so, whether it is `verified`, `pending`, or `failed`.

Expected: either not listed at all, or listed but not verified.

- [ ] **Step 3: Capture the live error from the Worker**

Start the log stream:

```bash
npx wrangler tail --format=pretty
```

With that running, submit the form at https://nuageathletics.com/ using an address that has **no row yet** — e.g. `victor.trinh+resend-test@outlook.com`. It must be a new address: an existing `pending` row routes to the re-send branch, which logs nothing on failure (see the 17:58 attempt above). The rate limit is 5 attempts per 10 minutes per IP, and Turnstile escalates to an interactive challenge under repeated automated submissions — do this by hand in a normal browser.

Expected in the tail output:

```
confirmation email failed resend 403: {"statusCode":403,"message":"The nuageathletics.com domain is not verified. Please, add and verify your domain on https://resend.com/domains","name":"validation_error"}
```

Any other status is still useful — write down the exact string. `401` means the API key is wrong or revoked and Task 5 changes to "issue a new key and `wrangler secret put RESEND_API_KEY`".

If `wrangler tail` is inconvenient, the same line is in Workers Logs (observability is enabled in `wrangler.toml:10-11`): Cloudflare dashboard → Workers & Pages → `nuage-athletics` → Logs.

- [ ] **Step 4: Record the finding**

Write the exact status and message into this file under "Evidence gathered" before continuing.

---

### Task 2: Make the email path testable

Right now no test touches Resend, which is why a totally broken send path passed CI. Bind a fake key and stub `fetch` so the happy path is exercised on purpose.

**Files:**
- Create: `test/stub-resend.ts`
- Modify: `vitest.config.ts:12-21` (miniflare bindings), `vitest.config.ts:23-28` (setupFiles)

- [ ] **Step 1: Write the fetch stub setup file**

Create `test/stub-resend.ts`:

```ts
import { beforeEach, vi } from 'vitest'

const realFetch = globalThis.fetch

/**
 * Tests bind a fake RESEND_API_KEY so the email path runs for real instead of
 * taking the no-key dev branch. Nothing may actually reach api.resend.com, so
 * every request to it is answered here. Individual tests override
 * `globalThis.fetch` again when they need a failure.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('https://api.resend.com/')) {
        return new Response(JSON.stringify({ id: 'test-email-id' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return realFetch(input as RequestInfo, init)
    }
  )
})
```

- [ ] **Step 2: Bind a fake key and register the setup file**

In `vitest.config.ts`, add to `miniflare.bindings` (next to the Stripe test values):

```ts
          // Fixed test-only value so the Resend path runs instead of the
          // no-key dev branch. test/stub-resend.ts intercepts the request.
          RESEND_API_KEY: 're_test_not_a_real_key',
```

and extend `setupFiles`:

```ts
    setupFiles: ['./test/apply-migrations.ts', './test/stub-resend.ts'],
```

- [ ] **Step 3: Run the suite to prove nothing regressed**

Run: `npm test`
Expected: PASS — all existing tests in `test/subscribe.test.ts` still green, now going through the stubbed Resend call rather than the dev branch.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts test/stub-resend.ts
git commit -m "test: exercise the Resend path instead of the no-key dev branch"
```

---

### Task 3: Surface send failures instead of reporting success

**Files:**
- Modify: `src/pages/api/subscribe.ts:29-34` (add helper), `:76-85` (re-send branch), `:98-111` (first-send branch)
- Test: `test/subscribe.test.ts`

The consent row must survive a failed send — it is the CASL evidence, and `CLAUDE.md` non-negotiable #4 forbids destroying it. Only the response changes.

The client needs no new string: `src/components/SignupForm.tsx:63-69` maps unknown codes to `d.errorGeneric` ("Une erreur est survenue. Réessayez dans un moment." / "Something went wrong. Try again in a moment."), which is accurate here. No `Dict` change, so non-negotiable #2 is satisfied without touching `src/i18n/ui.ts`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe` block in `test/subscribe.test.ts`:

```ts
  it('reports failure when Resend rejects the send, and keeps the consent row', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('{"name":"validation_error","message":"domain is not verified"}', {
          status: 403,
        })
    )

    const body = validBody()
    const res = await POST(makeContext(body, { ip: '203.0.113.20' }))
    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ ok: false, code: 'email_failed' })

    // The row stays: consent was given, only delivery failed.
    const row = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?')
      .bind(body.email)
      .first<{ status: string; consent_version: string }>()
    expect(row?.status).toBe('pending')
    expect(row?.consent_version).toBeTruthy()
  })

  it('reports failure when the re-send to a pending subscriber is rejected', async () => {
    const body = validBody()
    const first = await POST(makeContext(body, { ip: '203.0.113.21' }))
    expect(first.status).toBe(200)

    vi.stubGlobal('fetch', async () => new Response('nope', { status: 403 }))

    const res = await POST(makeContext(body, { ip: '203.0.113.21' }))
    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ ok: false, code: 'email_failed' })
  })
```

Add `vi` to the vitest import at `test/subscribe.test.ts:1`:

```ts
import { describe, expect, it, vi } from 'vitest'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/subscribe.test.ts`
Expected: FAIL — both new tests get `200 { ok: true }` instead of `502 { ok: false, code: 'email_failed' }`. That failure *is* the reproduction of the reported bug.

- [ ] **Step 3: Implement the fix**

In `src/pages/api/subscribe.ts`, add below the `json` helper (after line 34):

```ts
/**
 * A send that never left is not a success. The subscriber row stays — consent
 * was given and CASL requires us to keep that evidence — but the form must not
 * tell someone to check an inbox we failed to reach.
 */
function emailFailed(error: string | undefined) {
  console.error('confirmation email failed', error)
  return json({ ok: false, code: 'email_failed' }, 502)
}
```

Replace the re-send branch (lines 76-85) with:

```ts
    // pending or previously unsubscribed: re-send confirmation, fresh consent timestamp
    const token = await refreshPendingToken(env.DB, input.email)
    const resent = await sendConfirmationEmail({
      apiKey: env.RESEND_API_KEY,
      to: input.email,
      locale: input.locale,
      siteUrl,
      token: token || existing.token,
    })
    if (!resent.ok) return emailFailed(resent.error)
    return json({ ok: true })
```

Replace the tail of the handler (lines 106-111) with:

```ts
  if (!sent.ok) return emailFailed(sent.error)

  return json({ ok: true })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests, new and old.

- [ ] **Step 5: Typecheck and build**

```bash
npm run check && npm run build
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/subscribe.ts test/subscribe.test.ts
git commit -m "fix(subscribe): stop reporting success when the confirmation email fails

A rejected Resend call was logged and swallowed, so the form told people to
check an inbox that never received anything — which is how an unverified
sending domain went unnoticed. The subscriber row still stays on failure;
it is the CASL consent evidence and only delivery failed."
```

---

### Task 4: Fail loudly when `RESEND_API_KEY` is missing outside dev

The no-key branch (`src/lib/email.ts:89-93`) logs the confirm URL and returns `{ ok: true }`. That is right for `astro dev` and wrong everywhere else — if the secret is ever unset or lost, production silently stops mailing and reports success, exactly the failure mode Task 3 just closed.

**Files:**
- Modify: `src/lib/email.ts:89-93`
- Test: `test/email.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/email.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sendConfirmationEmail } from '../src/lib/email'

describe('sendConfirmationEmail', () => {
  it('fails instead of pretending to send when no API key is configured', async () => {
    const res = await sendConfirmationEmail({
      apiKey: undefined,
      to: 'someone@example.com',
      locale: 'fr-CA',
      siteUrl: 'https://nuageathletics.com',
      token: 'deadbeef',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/RESEND_API_KEY/)
  })
})
```

Note: `import.meta.env.DEV` is true under vitest, so the test runs in "dev". That is deliberate — the fix in Step 3 keeps the convenience of logging the confirm URL in dev but returns `ok: false` in *every* environment, so no caller anywhere gets a false success.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/email.test.ts`
Expected: FAIL — `expected true to be false`, because the current branch returns `{ ok: true }`.

- [ ] **Step 3: Implement the fix**

Replace `src/lib/email.ts:89-93` with:

```ts
  // No key configured: log the confirm URL so local dev is still usable, but
  // never claim the mail was sent. `import.meta.env` is undefined when
  // scripts/broadcast.ts imports this module under plain node, hence `?.`.
  if (!apiKey) {
    if (import.meta.env?.DEV) {
      console.log(`[email:dev] confirmation for ${to} -> ${confirmUrl}`)
    }
    return { ok: false, error: 'RESEND_API_KEY is not configured' }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. `test/subscribe.test.ts` is unaffected because Task 2 binds a key there.

- [ ] **Step 5: Update the README claim it contradicts**

`README.md:47-48` currently promises signup still succeeds locally without a key. Replace that paragraph with:

```markdown
Without `RESEND_API_KEY` the confirmation email is logged to the console with the
confirm URL, and the signup endpoint returns `email_failed` — the row is still
written, so paste the logged URL to finish the double opt-in locally.
```

- [ ] **Step 6: Typecheck, build, commit**

```bash
npm run check && npm run build
git add src/lib/email.ts test/email.test.ts README.md
git commit -m "fix(email): never report a send as ok when no API key is configured"
```

---

### Task 5: Authenticate `nuageathletics.com` for Resend (DNS — manual) — DONE 2026-08-07

Completed. `nuageathletics.com` added to Resend (region us-east-1, provider Cloudflare), and these three records created in Cloudflare DNS, confirmed live against the authoritative nameserver `morgan.ns.cloudflare.com`:

```
resend._domainkey.nuageathletics.com. TXT  "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC2ZgK9g74rkdKI8UI1vOb+…QIDAQAB"
send.nuageathletics.com.              MX   10 feedback-smtp.us-east-1.amazonses.com.
send.nuageathletics.com.              TXT  "v=spf1 include:amazonses.com ~all"
```

Zoho verified untouched afterwards: root MX still `10 mx.zohocloud.ca / 20 mx2 / 50 mx3`, root SPF still `v=spf1 include:zohocloud.ca ~all`.

**Resend's "Enable Receiving" toggle was deliberately left off.** Turning it on adds `MX @ → inbound-smtp.us-east-1.amazonaws.com` on the **root**, which would take mail reception away from Zoho and break `hello@nuageathletics.com`. Never enable it on this domain.

Resend's event timeline reached `DNS verified` at 18:13 and moved to `Verifying domain`; the status badge flips from Pending to Verified on Resend's own schedule. **Confirm it reads Verified before running Task 7.**

The original manual steps are kept below for reference.

**Files:** none (DNS + third-party dashboard)

**Constraint that must not be violated:** the root `MX` records point at Zoho (`mx.zohocloud.ca`, `mx2`, `mx3`) and that is where `hello@nuageathletics.com` is *received*. Resend's setup adds records for a `send.` subdomain and a DKIM TXT — **do not remove, replace, or reprioritise the root MX records** (`README.md:60-62` makes the same point).

- [ ] **Step 1: Add the domain in Resend**

https://resend.com/domains → Add Domain → `nuageathletics.com`, region North America. Resend then shows three records to create.

- [ ] **Step 2: Create the records in Cloudflare DNS**

In the Cloudflare dashboard for `nuageathletics.com` → DNS → Records, add exactly what Resend displays. They will be of this shape:

| Type | Name | Value | Notes |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0…` (Resend generates) | DKIM. Aligns `d=nuageathletics.com`, so DMARC passes. |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com`, priority 10 | Bounce handling for the **subdomain only**. Leave root MX alone. |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for the bounce subdomain. |

TXT and MX records are never proxied, so the orange/grey cloud does not apply. **Do not edit the root `v=spf1 include:zohocloud.ca ~all` record** — mail is sent with a Resend return-path on `send.`, so root SPF stays Zoho's business.

- [ ] **Step 3: Verify in Resend**

Click Verify. Propagation is usually under 5 minutes on Cloudflare.

Confirm from the shell:

```bash
dig +short resend._domainkey.nuageathletics.com TXT
dig +short send.nuageathletics.com MX
dig +short send.nuageathletics.com TXT
dig +short nuageathletics.com MX
```

Expected: the first three return the values from Step 2; the last still returns the three `zohocloud.ca` hosts.

- [ ] **Step 4: Confirm the key belongs to this account**

In Resend → API Keys, confirm a key exists with **Sending access** for this domain. If the production secret predates the domain or its scope is unclear, issue a new one and rotate:

```bash
npx wrangler secret put RESEND_API_KEY
```

- [ ] **Step 5: Leave DMARC at `p=none` for now**

`p=none` is correct while the domain has no sending history. Revisit `p=quarantine` after a few weeks of clean `rua` reports — not part of this fix.

---

### Task 6: CASL gate — real mailing address before the first real send

**Files:**
- Modify: `src/lib/consent.ts:15-20`

`SENDER_IDENTITY.address` is still the literal placeholder `[ADRESSE POSTALE REQUISE / MAILING ADDRESS REQUIRED]`, and `renderEmailShell` prints it in the footer of every message. The moment Task 5 makes delivery work, that string ships to real subscribers. CASL requires a physical mailing address in every commercial message (`CLAUDE.md` non-negotiable #6, `README.md` pre-launch checklist).

This is a known deferred item, not a surprise — but it is now on the critical path, because the next successful send is a real one.

- [ ] **Step 1: Decide the address**

Victor's call: the registered business address, or a mail-forwarding address. It must be one where physical mail is actually received for at least 60 days after the last send.

- [ ] **Step 2: Replace the placeholder**

In `src/lib/consent.ts`, replace lines 18-19 with the real address (single line, `<br />`-free — the shell already handles layout):

```ts
  address: '<street, city, QC, postal code, Canada>',
```

and delete the `TODO` comment above it.

- [ ] **Step 3: Check whether the consent wording changed**

If, and only if, the *consent checkbox wording* in `src/i18n/ui.ts` changed as part of this, bump `CONSENT_VERSION` in `src/lib/consent.ts:8`. Changing the mailing address alone is **not** a consent-wording change — do not bump it for this, and never backfill existing rows (non-negotiable #4).

- [ ] **Step 4: Verify and commit**

```bash
npm run check && npm run build
git add src/lib/consent.ts
git commit -m "chore(consent): set the real CASL mailing address for outbound email"
```

If Victor is not ready to decide the address, **stop here**: Tasks 1-5 are still worth shipping (they fix the silent-success bug and the DNS), but do not deploy a send-enabled build until this task is done.

---

### Task 7: Verify end to end against production

**Files:** none

- [ ] **Step 1: Deploy**

```bash
npm run deploy
```

- [ ] **Step 2: Reproduce the original report with logs attached**

```bash
npx wrangler tail --format=pretty
```

With that running, sign up at https://nuageathletics.com/ using `victor.trinh@outlook.com`.

Expected: **no** `confirmation email failed` line in the tail output, and the form shows the success state ("Vérifiez vos courriels").

- [ ] **Step 3: Confirm the mail arrived**

Check the Outlook inbox — and the Junk folder, since the domain has no sending reputation yet. Expected subject: `Confirmez votre inscription — Nuage Athletics`. Repeat with `tda.victor@gmail.com`; in Gmail, use "Show original" and confirm `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.

If the mail is accepted by Resend but lands in Junk, that is a *reputation* problem, not this bug — record it and treat warmup separately.

- [ ] **Step 4: Confirm the whole double opt-in closes**

Click the confirmation button in the email. Expected: redirect to `/inscription-confirmee`.

```bash
npm run db:subscribers
```

Expected: `victor.trinh@outlook.com` now shows `status = confirmed`.

- [ ] **Step 5: Confirm the failure path is honest**

Optional but cheap: in Resend, temporarily disable the API key (or `wrangler secret put RESEND_API_KEY` with a junk value on a preview deploy), submit the form, and confirm the UI now shows the error string instead of "check your email". Restore the key afterwards.

---

## Out of scope — separate follow-up

Found while tracing this path, unrelated to the missing email, worth its own change:

**Re-subscribing after unsubscribing produces a dead confirmation link.** In `src/pages/api/subscribe.ts:77`, `refreshPendingToken` (`src/lib/db.ts:105-115`) updates `WHERE email = ? AND status = 'pending'`, so for an `unsubscribed` row it writes nothing — but it still *returns* a freshly generated token. Since that token is always truthy, `token || existing.token` at line 83 sends the mail with a token that exists nowhere in D1, and `confirmSubscriber` will answer `not_found`. The row also stays `unsubscribed` forever. Fix is to have the re-send branch reset the row to `pending` with the new token when the status is `unsubscribed`, with a test for the unsubscribe → re-subscribe → confirm round trip.

**`sendOrderConfirmationEmail` has the same no-key silent-success branch** (`src/lib/email.ts:150-153`) that Task 4 fixes for confirmations. Harmless while `COMMERCE_ENABLED = "false"`, but it should get the same treatment before commerce goes live.
