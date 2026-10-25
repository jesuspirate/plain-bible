import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetAccount } from './signout'

function fakeStorage(init: Record<string, string>) {
  const m = new Map(Object.entries(init))
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
  return new Proxy(s, { ownKeys: () => [...m.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) }) as unknown as Storage & { m: Map<string, string> }
}

const ALL = {
  'plain-bible:account': '{"token":"x"}', 'plain-bible:owner': '1', 'plain-bible:prayer-sync': 'id', 'plain-bible:no-passkey': '1',
  'plain-bible:key-saved': '1', 'plain-bible:circles': '2', 'plain-bible:circle-seen': '{}', 'plain-bible:circle-name': 'Jet',
  'plain-bible:share-circle': 'c', 'plain-bible:push-circles': '[]', 'plain-bible:marks': '{}', 'plain-bible:days': '{}',
  'plain-bible:settings-t': '{}', 'plain-bible:history': '[]', 'plain-bible:recent': '[]',
  'plain-bible:settings': '{"theme":"sepia"}', 'plain-bible:last': 'JHN.3', 'plain-bible:catalog': '[]',
}

describe('forgetAccount', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('always clears what belongs to the account', async () => {
    const ls = fakeStorage(ALL)
    vi.stubGlobal('localStorage', ls)
    await forgetAccount()
    const left = Object.keys(localStorage)
    for (const k of ['account', 'owner', 'prayer-sync', 'no-passkey', 'key-saved', 'circles', 'circle-seen', 'circle-name', 'share-circle', 'push-circles']) {
      expect(left).not.toContain('plain-bible:' + k)
    }
    expect(left).toEqual(expect.arrayContaining(['plain-bible:marks', 'plain-bible:days', 'plain-bible:settings', 'plain-bible:last']))
  })
  it('on sign out, also what syncs, but keeps device preferences', async () => {
    vi.stubGlobal('localStorage', fakeStorage(ALL))
    await forgetAccount({ personal: true })
    expect(Object.keys(localStorage).sort()).toEqual(['plain-bible:catalog', 'plain-bible:last', 'plain-bible:settings'])
  })
})
