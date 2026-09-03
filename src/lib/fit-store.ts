import { useSyncExternalStore } from 'react'
import type { FitId } from './catalogue'

/**
 * Shares the selected fit between the carousel (left grid column) and the
 * buy panel (right column) — two separate React islands that don't share a
 * parent. A context provider can't cross that boundary, and lifting both
 * into one island would hydrate the h1/description/spec list along with
 * them, which is what CLAUDE.md's "React islands only where interaction
 * requires it" rules out. This is the smaller sin: a plain module-level
 * store, keyed by productId the same way `SignupForm`'s `idPrefix` guards
 * against two islands on one page colliding.
 */

interface FitStore {
  subscribe: (onChange: () => void) => () => void
  get: () => FitId
  set: (fit: FitId) => void
}

const stores = new Map<string, FitStore>()

export function getFitStore(productId: string, initial: FitId): FitStore {
  const existing = stores.get(productId)
  if (existing) return existing

  let value = initial
  const listeners = new Set<() => void>()

  const store: FitStore = {
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    get() {
      return value
    },
    set(fit) {
      if (fit === value) return
      value = fit
      for (const listener of listeners) listener()
    },
  }

  stores.set(productId, store)
  return store
}

/**
 * `useSyncExternalStore`'s third argument (server snapshot) is required, not
 * optional: Astro server-renders each island, and without it React 19 throws
 * "Missing getServerSnapshot". Returning `initial` also guarantees the SSR
 * markup and the first client render agree, so there is no hydration
 * mismatch to reconcile.
 */
export function useFit(productId: string, initial: FitId): [FitId, (fit: FitId) => void] {
  const store = getFitStore(productId, initial)
  const fit = useSyncExternalStore(store.subscribe, store.get, () => initial)
  return [fit, store.set]
}
