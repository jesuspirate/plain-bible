import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshSaved } from './data'

const BASE = 'https://x.test/data/'

function setup(saved: Record<string, string>, answer: (url: string) => Response) {
  const store = new Map<string, Response>()
  for (const [id, tag] of Object.entries(saved)) store.set(BASE + `bibles/${id}.json`, new Response('old ' + id, { headers: { etag: tag } }))
  const cache = {
    keys: async () => [...store.keys()].map(url => ({ url })),
    match: async (r: { url: string }) => store.get(r.url),
    delete: async (r: { url: string }) => store.delete(r.url),
    put: async (url: string, res: Response) => { store.set(url, res) },
  }
  const local = new Map<string, string>()
  vi.stubGlobal('caches', { open: async () => cache })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('localStorage', { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v) })
  const fetch = vi.fn(async (url: string) => answer(url))
  vi.stubGlobal('fetch', fetch)
  return { store, fetch }
}

afterEach(() => vi.unstubAllGlobals())

describe('refreshSaved', () => {
  it('replaces a changed saved Bible and keeps an unchanged one', async () => {
    const { store, fetch } = setup({ EthFr: '"a"', KJV: '"b"' }, url =>
      url.includes('EthFr') ? new Response('new EthFr', { status: 200 }) : new Response(null, { status: 304 }))
    await refreshSaved(BASE, 1e12)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(await store.get(BASE + 'bibles/EthFr.json')!.text()).toBe('new EthFr')
    expect(await store.get(BASE + 'bibles/KJV.json')!.text()).toBe('old KJV')
  })

  it('keeps the saved copy when offline mid-check, and checks once a day', async () => {
    const { store, fetch } = setup({ LSG: '"c"' }, () => { throw new TypeError('offline') })
    await refreshSaved(BASE, 1e12)
    expect(await store.get(BASE + 'bibles/LSG.json')!.text()).toBe('old LSG')
    await refreshSaved(BASE, 1e12 + 3600e3)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
