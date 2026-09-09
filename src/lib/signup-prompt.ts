/**
 * Persistence for the bottom-anchored signup prompt (SignupPrompt.astro).
 *
 * Same shape as src/components/sky/prefs.ts: a module-private key, every
 * localStorage access wrapped in try/catch and degrading to "shows again"
 * rather than throwing, and a timestamp rather than a plain flag so a
 * dismissal expires instead of being forever. `shouldShow` is exported pure
 * (storage read separated from the decision) so the TTL boundary is
 * testable without a DOM — see the note on hasGivenUp() in sky/prefs.ts for
 * the same reasoning.
 */

const STORAGE_KEY = 'na-signup-prompt'

/** How long dismissing the prompt (the × button) suppresses it for. */
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type StoredPromptState = { kind: 'dismissed'; at: number } | { kind: 'subscribed' } | null

/**
 * Whether the prompt should show, given what's stored and the current time.
 * `null` (nothing stored, or storage was unreadable) always shows. A
 * completed signup suppresses forever; a dismissal expires after the TTL.
 */
export function shouldShow(stored: StoredPromptState, now: number): boolean {
  if (stored === null) return true
  if (stored.kind === 'subscribed') return false
  return now - stored.at >= DISMISS_TTL_MS
}

export function getStoredPromptState(): StoredPromptState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    if (raw === 'subscribed') return { kind: 'subscribed' }
    const at = Number(raw)
    if (!Number.isFinite(at)) return null
    return { kind: 'dismissed', at }
  } catch {
    return null
  }
}

/** Called when the × dismisses the prompt without a completed signup. */
export function dismissPrompt(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    // localStorage unavailable (private mode, etc.) — the dismissal just
    // won't persist, so the prompt may show again next visit.
  }
}

/** Called when this prompt's own SignupForm completes. Never expires. */
export function markSubscribed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'subscribed')
  } catch {
    // ignore — worst case the prompt offers a signup to someone already on
    // the list, which the endpoint answers with 'already_subscribed'.
  }
}
