const STORAGE_KEY = 'na-sky-paused'
const GAVE_UP_KEY = 'na-sky-gaveup'

/**
 * OS-level accessibility signals. These are never overridden by the manual
 * toggle — if the platform says no motion, the toggle doesn't get to argue.
 * When this is true the toggle itself should be hidden, not just disabled.
 */
export function osPrefersNoMotion(): boolean {
  if (typeof window === 'undefined') return true
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
    if (window.matchMedia('(prefers-contrast: more)').matches) return true
    if (window.matchMedia('(forced-colors: active)').matches) return true
  } catch {
    // matchMedia unsupported — treat as no explicit preference
  }
  return false
}

export function dataSaverActive(): boolean {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return Boolean(conn?.saveData)
}

export function getStoredPause(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function setStoredPause(paused: boolean): void {
  try {
    if (paused) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage unavailable (private mode, etc.) — pause just won't persist
  }
}

/**
 * How long a runtime give-up suppresses the sky for.
 *
 * The flag exists so a device that genuinely can't render the sim isn't made
 * to re-run the whole degrade ladder — and re-jank the page for several
 * seconds — on every navigation. But it used to be a plain '1' that lived
 * for the entire browser session, which meant one give-up (a laptop that
 * hitched twice while a video decoded, say) left every page the visitor
 * opened afterward showing the static fallback with no way back short of
 * finding the toggle. Storing when it happened instead lets the engine try
 * again later in the same session: still no repeated jank inside one browsing
 * burst, no permanent verdict from one bad minute.
 */
const GAVE_UP_TTL_MS = 10 * 60 * 1000

export function hasGivenUp(): boolean {
  try {
    const raw = sessionStorage.getItem(GAVE_UP_KEY)
    if (raw === null) return false
    // Non-numeric covers the old '1' encoding, which carried no timestamp —
    // treat it as long expired rather than as forever.
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return Date.now() - at < GAVE_UP_TTL_MS
  } catch {
    return false
  }
}

export function setGaveUp(): void {
  try {
    sessionStorage.setItem(GAVE_UP_KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable — the flag just won't persist
  }
}

export function clearGaveUp(): void {
  try {
    sessionStorage.removeItem(GAVE_UP_KEY)
  } catch {
    // ignore
  }
}

/**
 * Absolute blockers: no accessibility or capability override should ever
 * offer to run the sky anyway, so the pause/resume toggle hides itself
 * entirely when this is true rather than exposing a dead control.
 */
export function skyBlockedByOs(): boolean {
  return osPrefersNoMotion() || !hasWebGL2()
}

/**
 * Soft blockers: things the visitor (or the runtime, after a give-up) can
 * override via the toggle. Device capability is deliberately not judged
 * here from static specs — the frame loop in engine.ts measures actual
 * throughput and degrades/gives up on its own.
 */
export function skySoftDisabled(): boolean {
  return dataSaverActive() || getStoredPause() || hasGivenUp()
}

/** Should the engine module be loaded at all, right now? */
export function skyDisabledByPrefs(): boolean {
  return skyBlockedByOs() || skySoftDisabled()
}

let webgl2Support: boolean | undefined
function hasWebGL2(): boolean {
  if (webgl2Support !== undefined) return webgl2Support
  try {
    const canvas = document.createElement('canvas')
    webgl2Support = Boolean(canvas.getContext('webgl2'))
  } catch {
    webgl2Support = false
  }
  return webgl2Support
}
