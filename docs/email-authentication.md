# Email authentication (SPF, DKIM, DMARC)

Who is allowed to send as `@nuageathletics.com`, and where the receiving
side's reports about that go. Every record here lives in Cloudflare DNS and
is changed by hand — nothing in this repo writes DNS.

## Who sends as the domain

| Sender | What it sends | From | DKIM (aligned `d=nuageathletics.com`) | SPF |
|---|---|---|---|---|
| Zoho Mail | people writing from `hello@` | `hello@nuageathletics.com` | `zmail._domainkey` | root: `v=spf1 include:zohocloud.ca ~all` |
| Resend | confirmation + broadcast mail (`src/lib/email.ts`) | `SENDER_IDENTITY.email` (`src/lib/consent.ts`) | `resend._domainkey` | `send.` subdomain: `v=spf1 include:amazonses.com ~all` (return-path only — not aligned, and doesn't need to be) |
| Shopify | order notifications (`shopify/notifications/`) | store email, `hello@nuageathletics.com` | **not yet** — Shopify's DKIM CNAMEs are a #93 checkbox | Shopify's own return-path |

DMARC passes when *either* aligned DKIM or aligned SPF passes. Zoho and
Resend each pass on DKIM. Shopify will not, until its CNAMEs are in.

The root SPF record is Zoho's and stays Zoho's. Resend's bounces use the
`send.` subdomain, so it never needs to be added there; adding it anyway
would only spend one of SPF's ten DNS lookups.

## DMARC record

```
_dmarc.nuageathletics.com  TXT
v=DMARC1; p=none; rua=mailto:<id>@dmarc-reports.cloudflare.net; adkim=r; aspf=r
```

- **`rua` goes to Cloudflare's DMARC Management, not `hello@`** (#119).
  Aggregate reports are machine-written XML from every large mailbox
  provider, daily. Sent to `hello@` they are noise in the inbox customers
  write to, and unread they are worth nothing anyway. Cloudflare's dashboard
  (Email → DMARC Management) parses them into a per-sender pass/fail view.
  Enabling it there writes the `rua` address itself; the `<id>` is
  per-account, so copy it from the dashboard rather than from here.
- **No `ruf`.** Failure (forensic) reports can carry whole message headers
  and fragments of real customers' mail. Most large providers — Microsoft
  and Google included — don't send them at all, and the ones that do would
  send them to whatever address is listed. There is nothing in them this
  site needs.
- **No `sp=`.** With no `sp`, subdomains inherit `p`, which is the same
  thing `sp=none` said while `p=none`, and it keeps saying the right thing
  when `p` changes.
- **`p=none` until Shopify is aligned.** Moving to `p=quarantine` before
  Shopify's DKIM is in sends order confirmations to spam. The order is:
  Shopify DKIM (#93) → a couple of weeks of reports showing every sender
  passing → `p=quarantine` → `p=reject`.

## Checking it

```bash
dig +short TXT _dmarc.nuageathletics.com
dig +short TXT resend._domainkey.nuageathletics.com
dig +short TXT zmail._domainkey.nuageathletics.com
```

In Gmail, "Show original" on a received message shows `SPF`, `DKIM` and
`DMARC` verdicts per message, which is the quickest way to check one sender
after a change.
