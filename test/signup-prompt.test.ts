import { describe, expect, it } from 'vitest'
import { shouldShow, type StoredPromptState } from '../src/lib/signup-prompt'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-08T12:00:00Z')

describe('shouldShow', () => {
  it('shows when nothing is stored', () => {
    expect(shouldShow(null, NOW)).toBe(true)
  })

  it('never shows again once subscribed', () => {
    const state: StoredPromptState = { kind: 'subscribed' }
    expect(shouldShow(state, NOW)).toBe(false)
    expect(shouldShow(state, NOW + 100 * DAY_MS)).toBe(false)
  })

  it('stays hidden while a dismissal is within its 30-day TTL', () => {
    const state: StoredPromptState = { kind: 'dismissed', at: NOW }
    expect(shouldShow(state, NOW)).toBe(false)
    expect(shouldShow(state, NOW + 29 * DAY_MS)).toBe(false)
  })

  it('shows again exactly at the 30-day boundary and after', () => {
    const state: StoredPromptState = { kind: 'dismissed', at: NOW }
    expect(shouldShow(state, NOW + 30 * DAY_MS)).toBe(true)
    expect(shouldShow(state, NOW + 31 * DAY_MS)).toBe(true)
  })

  it('stays hidden one millisecond before the boundary', () => {
    const state: StoredPromptState = { kind: 'dismissed', at: NOW }
    expect(shouldShow(state, NOW + 30 * DAY_MS - 1)).toBe(false)
  })
})
