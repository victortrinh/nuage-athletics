/** One notification's generated output. `file` is the basename under
 * shopify/notifications/ (no extension) — the generator writes
 * `<file>.liquid` (body) and, when `subject` is set, `<file>.subject.liquid`. */
export interface NotificationTemplate {
  file: string
  /** Human label for the runbook and the CLI's own log output — the exact
   * name of this notification in Settings → Notifications. */
  adminName: string
  /**
   * The subject-line template, built with `subjectLine()`.
   *
   * Optional, for the one notification whose subject is not ours to write:
   * "Contact customer" is composed in an admin dialog with its own Subject
   * field, typed fresh per message. Shipping a subject template for it would
   * either be overwritten by what Victor types or — worse — quietly replace
   * it. A template that omits this generates a body only, and the runbook
   * says to leave Shopify's stock subject template in place.
   */
  subject?: string
  html: string
}
