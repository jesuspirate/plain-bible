import { describe, expect, it } from 'vitest'
import { docKey, mergeDocs, type SyncDoc } from './sync'

const doc = (settings: Record<string, unknown>, settingsT: Record<string, number>): SyncDoc =>
  ({ v: 1, marks: {}, settings, settingsT, days: {} })

describe('retired settings', () => {
  it('are dropped by the merge, so the account is cleaned once and then matches', () => {
    const here = doc({ theme: 'sepia' }, { theme: 2 })
    const account = doc({ theme: 'sepia', favorite: 'KJV' }, { theme: 2, favorite: 9 })
    const merged = mergeDocs(here, account)
    expect(merged.settings).toEqual({ theme: 'sepia' })
    expect(merged.settingsT).toEqual({ theme: 2 })
    // Different from the account: sent once. Then the same as here: nothing more to send.
    expect(docKey(merged)).not.toBe(docKey(account))
    expect(docKey(mergeDocs(here, merged))).toBe(docKey(merged))
    expect(docKey(merged)).toBe(docKey(here))
  })
})
