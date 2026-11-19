import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newKey, prayerKey } from './prayerCrypto'

// Signed in on a device that already holds the account key: prayers sync
// without asking again. A stand-in for the device's storage and the server.
const store = new Map<string, unknown>()
let keyId: string | null = null
const local = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v),
  removeItem: (k: string) => local.delete(k), key: () => null, length: 0, clear: () => local.clear(),
})
vi.mock('./prayers', () => ({
  meta: { get: async (k: string) => store.get(k), set: async (k: string, v: unknown) => { v === undefined ? store.delete(k) : store.set(k, v) } },
  prayers: { list: async () => [] }, partsOf: () => [],
}))
vi.mock('./sync', async orig => {
  const real = await orig<typeof import('./sync')>()
  return {
    ...real,
    SYNC_URL: 'https://sync.test',
    loadAccount: () => ({ token: 't' }),
    api: async (path: string) => path === '/prayers' ? { keyId, parts: [], gone: [] } : { ok: true },
  }
})
const { prayerSyncOn, syncPrayers, turnOffPrayerSync } = await import('./prayerSync')

describe('prayer sync on a signed-in device', () => {
  beforeEach(() => { store.clear(); local.clear(); keyId = null })

  it('turns on by itself where the account key is already here', async () => {
    const raw = newKey()
    keyId = (await prayerKey(raw)).id
    store.set('acct', raw)
    await syncPrayers()
    expect(prayerSyncOn()).toBe(true)
    expect(store.get('key')).toBe(raw)
  })

  it('waits for a tap where no key is here', async () => {
    keyId = (await prayerKey(newKey())).id
    await syncPrayers()
    expect(prayerSyncOn()).toBe(false)
  })

  it('leaves a key from another account alone', async () => {
    keyId = (await prayerKey(newKey())).id
    store.set('acct', newKey())
    await syncPrayers()
    expect(prayerSyncOn()).toBe(false)
  })

  it('stays off where Stop syncing was tapped', async () => {
    const raw = newKey()
    keyId = (await prayerKey(raw)).id
    store.set('acct', raw)
    await turnOffPrayerSync()
    await syncPrayers()
    expect(prayerSyncOn()).toBe(false)
  })
})
