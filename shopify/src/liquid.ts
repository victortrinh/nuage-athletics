/**
 * Liquid-generation primitives shared by every notification template.
 *
 * Shopify's notification templates have no `{% render %}`/`{% include %}` for
 * custom snippets between templates, and no build step of their own — each
 * one is a standalone blob of Liquid pasted into Settings → Notifications
 * (shopify/notifications/README.md). So the "shared partial" this repo's own
 * non-negotiable #2 (an exhaustive bilingual Dict) would normally give us
 * lives here instead, in TypeScript, and `scripts/shopify-notifications.ts`
 * writes its output to the committed .liquid files. Edit these sources, run
 * `npm run shopify:notifications`, never hand-edit a committed .liquid file.
 */

/**
 * Wraps a French and an English string in a Liquid branch on the `en`
 * boolean the locale prelude below assigns. Both arguments are required —
 * unlike src/i18n/ui.ts's `Dict` type, there is no compiler here to catch a
 * missing translation, so this signature is the enforcement: a call site
 * that only has one language literally cannot construct the other branch.
 *
 * `fr`/`en` are Liquid-safe HTML already (interpolate `{{ }}` inside them
 * freely); this only ever wraps them in the `{% if %}`, it doesn't escape
 * them.
 */
export function t(fr: string, en: string): string {
  return `{% if en %}${en}{% else %}${fr}{% endif %}`
}

/**
 * Every template's locale detection. Shopify exposes the checkout language
 * under a different object per notification family — `order.customer_locale`
 * on order/fulfillment mail, `checkout.customer_locale` on the abandoned
 * checkout mail, `customer.locale` on account mail — and a reference that
 * doesn't exist on a given payload renders as empty rather than raising, so
 * this chain is defensive rather than a guess at exactly one name.
 *
 * French is the `else`: non-negotiable #1 makes French the default locale
 * everywhere else in this codebase, and an unrecognised or missing locale
 * value must fail toward the language the site is legally required to serve
 * completely, never away from it. The HTML comment is read back from a
 * "Send test" (which always renders in the store's default locale, so it
 * will say `fr-ca`) to confirm which upstream variable actually resolved —
 * see the runbook.
 */
const LOCALE_ASSIGN = `{%- assign na_lang = order.customer_locale | default: checkout.customer_locale | default: customer.locale | default: 'fr' -%}
{%- assign na_lang2 = na_lang | slice: 0, 2 | downcase -%}
{%- assign en = false -%}
{%- if na_lang2 == 'en' -%}{%- assign en = true -%}{%- endif -%}`

/** For the email body: same as LOCALE_ASSIGN, plus an HTML comment a
 * "Send test" lets you view-source for, to confirm which upstream variable
 * actually resolved (see the runbook). */
export const LOCALE_PRELUDE = `${LOCALE_ASSIGN}
<!-- na-locale: {{ na_lang }} -->`

/** For the subject line: the assigns only, no HTML comment — a subject
 * field is plain text, not markup, so a comment would render literally in
 * the recipient's inbox. */
export const LOCALE_PRELUDE_SUBJECT = LOCALE_ASSIGN

/** `{{ expr | money }}` — store currency, no code (matches the site's own
 * cart page, which never shows a currency code either). */
export function money(expr: string): string {
  return `{{ ${expr} | money }}`
}

/** `{{ expr | money_with_currency }}` — used once, on the grand total, same
 * as a Shopify checkout's own summary. */
export function moneyWithCurrency(expr: string): string {
  return `{{ ${expr} | money_with_currency }}`
}

/**
 * ISO date, deliberately not Liquid's `date: "%B %d, %Y"` — Liquid's month
 * names are always English regardless of the storefront or checkout
 * locale, so a `%B` in the French branch would silently print "September"
 * instead of "septembre". Numeric dates need no translation.
 */
export function isoDate(expr: string): string {
  return `{{ ${expr} | date: "%Y-%m-%d" }}`
}

/** Liquid raw-output escape hatch for a variable that already produced its
 * own HTML (e.g. `format_address`, which returns pre-formatted markup). */
export function raw(expr: string): string {
  return `{{ ${expr} }}`
}

/** A complete `<file>.subject.liquid` body: the locale assigns (no debug
 * comment — see LOCALE_PRELUDE_SUBJECT) followed by the bilingual subject
 * line itself. */
export function subjectLine(fr: string, en: string): string {
  return `${LOCALE_PRELUDE_SUBJECT}\n${t(fr, en)}`
}
