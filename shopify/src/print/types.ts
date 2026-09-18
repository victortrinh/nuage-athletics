/** One generated print document. `file` is the basename under
 * shopify/print/ (no extension) — the generator writes `<file>.liquid`.
 *
 * Deliberately not `NotificationTemplate` (../templates/types.ts), which
 * carries a `subject`: a printed document has no subject line, no recipient
 * and no send. The two families share `t()` and the locale prelude and
 * nothing else — see shopify/src/print/shell.ts. */
export interface PrintTemplate {
  file: string
  /** Human label for the runbook and the CLI's log output — where this is
   * pasted in the Shopify admin. */
  adminName: string
  html: string
}
