import { beforeEach, describe, expect, it, vi } from 'vitest'

// A small stand-in for what's kept on the device, and for the sync service.
const store = new Map<string, unknown>()
const calls: string[] = []
let missing = new Set<string>(), offline = false
vi.mock('./prayers', () => ({
  meta: { get: async (k: string) => store.get(k), set: async (k: string, v: unknown) => { v === undefined ? store.delete(k) : store.set(k, v) } },
  prayers: {}, partsOf: () => [],
}))
vi.mock('./sync', async orig => {
  const real = await orig<typeof import('./sync')>()
  return {
    ...real,
    SYNC_URL: 'https://sync.test',
    loadAccount: () => ({ token: 't' }),
    api: async (path: string, init: { method?: string }) => {
      if (offline) throw new real.SyncError('offline')
      calls.push(`${init.method} ${path}`)
      if (missing.has(path)) throw new real.SyncError('Not found', 404)
      return { ok: true }
    },
  }
})
const { takeOutDeleted, unsharePrayer } = await import('./circles')

const prayer = (id: string, by: string, prayed?: number) =>
  ({ id, by, at: 1, chunks: 1, amens: [], amenAt: {}, replies: [], reacts: {}, body: { k: 'prayer' as const, ms: 1, parts: [{ ms: 1, type: 'audio/mp4', size: 1 }], ...(prayed ? { prayed } : {}) } })

describe('a prayer deleted from Your prayers', () => {
  beforeEach(() => { store.clear(); calls.length = 0; missing = new Set(); offline = false })

  it('comes out of the circle: only your own copy of that prayer', async () => {
    store.set('prayers-unshare', [500])
    store.set('prayers-shared', { c1: [500, 600] })
    store.set('circle-audio:c1/a', new ArrayBuffer(1))
    const items = [prayer('a', 'me', 500), prayer('b', 'me', 600), prayer('c', 'mom', 500), prayer('d', 'me')]
    await takeOutDeleted('c1', 'me', items)
    expect(calls).toEqual(['DELETE /circles/c1/items/a'])
    expect(items.map(i => i.id)).toEqual(['b', 'c', 'd'])
    expect(store.get('prayers-shared')).toEqual({ c1: [600] })
    expect(store.has('circle-audio:c1/a')).toBe(false)
  })

  it('counts one already taken out elsewhere as gone', async () => {
    store.set('prayers-unshare', [500])
    missing.add('/circles/c1/items/a')
    const items = [prayer('a', 'me', 500)]
    await takeOutDeleted('c1', 'me', items)
    expect(items).toEqual([])
  })

  it('stays, and is tried again, while offline', async () => {
    store.set('prayers-unshare', [500])
    offline = true
    const items = [prayer('a', 'me', 500)]
    await takeOutDeleted('c1', 'me', items)
    expect(items.map(i => i.id)).toEqual(['a'])
    offline = false
    await takeOutDeleted('c1', 'me', items)
    expect(items).toEqual([])
  })

  it('is remembered even when no circle can be reached', async () => {
    offline = true
    store.set('circles', [{ id: 'c1', name: 'Home' }])
    await unsharePrayer(500)
    await unsharePrayer(500)
    expect(store.get('prayers-unshare')).toEqual([500])
  })
})
