// Nostr sign-in in Fedi: the sync service's check of the signed challenge
// (worker/src/nostr.ts), and that the button only shows inside Fedi.
import { afterEach, describe, expect, it } from 'vitest'
import { schnorr } from '../../worker/node_modules/@noble/curves/secp256k1.js'
import { checkNostrEvent, NOSTR_KIND, nostrEventId } from '../../worker/src/nostr'

const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!, b => parseInt(b, 16))

async function signed(over: Record<string, unknown> = {}, challenge = 'abc123') {
  const secret = schnorr.utils.randomSecretKey()
  const pubkey = toHex(schnorr.getPublicKey(secret))
  const now = Math.floor(Date.now() / 1000)
  const base = { pubkey, created_at: now, kind: NOSTR_KIND, tags: [['u', 'https://sync.example/auth/nostr/verify'], ['method', 'POST'], ['challenge', challenge]], content: '', ...over }
  const id = await nostrEventId(base as any)
  return { ...base, id, sig: toHex(schnorr.sign(fromHex(id), secret)) }
}

describe('checkNostrEvent', () => {
  it('takes a fresh event that answers the challenge, signed by its key', async () => {
    const e = await signed()
    expect(await checkNostrEvent(e, 'abc123', Date.now())).toBe(e.pubkey)
  })
  it('refuses another challenge, a changed event, another kind or an old one', async () => {
    const e = await signed()
    expect(await checkNostrEvent(e, 'other', Date.now())).toBeNull()
    expect(await checkNostrEvent({ ...e, content: 'x' }, 'abc123', Date.now())).toBeNull()
    expect(await checkNostrEvent(await signed({ kind: 1 }), 'abc123', Date.now())).toBeNull()
    expect(await checkNostrEvent(await signed({ created_at: Math.floor(Date.now() / 1000) - 3600 }), 'abc123', Date.now())).toBeNull()
  })
  it('refuses a signature by another key', async () => {
    const e = await signed(), other = await signed()
    expect(await checkNostrEvent({ ...e, sig: other.sig }, 'abc123', Date.now())).toBeNull()
    expect(await checkNostrEvent({ ...other, pubkey: e.pubkey }, 'abc123', Date.now())).toBeNull()
  })
  it('refuses junk', async () => {
    for (const j of [null, 1, 'x', {}, { id: 'zz' }]) expect(await checkNostrEvent(j, 'abc123', Date.now())).toBeNull()
  })
})

describe('inFedi', () => {
  const g = globalThis as any
  afterEach(() => { delete g.window })
  it('only with Fedi and its Nostr key, not a Nostr extension alone', async () => {
    const { inFedi } = await import('./nostr')
    g.window = { nostr: { signEvent: () => {} } }
    expect(inFedi()).toBe(false)
    g.window = { nostr: { signEvent: () => {} }, fedi: { version: 2 } }
    expect(inFedi()).toBe(true)
    g.window = { fedi: { version: 2 } }
    expect(inFedi()).toBe(false)
  })
})
