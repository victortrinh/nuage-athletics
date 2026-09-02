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

export function hasGivenUp(): boolean {
  try {
    return sessionStorage.getItem(GAVE_UP_KEY) === '1'
  } catch {
    return false
  }
}

export function setGaveUp(): void {
  try {
    sessionStorage.setItem(GAVE_UP_KEY, '1')
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
