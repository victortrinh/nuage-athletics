const STORAGE_KEY = 'na-sky-paused'

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

/** Weak-device heuristic: skip WebGL entirely rather than ship a bad frame rate. */
export function isLowPowerDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) return true
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4) return true
  return false
}

/** Should the engine module be loaded at all, right now? */
export function skyDisabledByPrefs(): boolean {
  return (
    osPrefersNoMotion() || dataSaverActive() || getStoredPause() || isLowPowerDevice() || !hasWebGL2()
  )
}

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2'))
  } catch {
    return false
  }
}
