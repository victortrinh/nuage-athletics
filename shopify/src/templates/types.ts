/** One notification's generated output. `file` is the basename under
 * shopify/notifications/ (no extension) — the generator writes
 * `<file>.liquid` (body) and `<file>.subject.liquid` (subject line). */
export interface NotificationTemplate {
  file: string
  /** Human label for the runbook and the CLI's own log output — the exact
   * name of this notification in Settings → Notifications. */
  adminName: string
  subject: string
  html: string
}
