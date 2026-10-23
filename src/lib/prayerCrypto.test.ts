import { describe, expect, it } from 'vitest'
import { keyCode, newKey, open, packPart, parseKeyCode, prayerKey, seal, unpackPart, unwrapKey, wrapKey } from './prayerCrypto'

describe('prayer encryption', () => {
  it('writes the key as a code and reads it back, forgiving typos of look-alikes', () => {
    const k = newKey()
    const code = keyCode(k)
    expect(code).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
    expect(parseKeyCode(code)).toEqual(k)
    expect(parseKeyCode(code.toLowerCase().replace(/-/g, ' '))).toEqual(k)
    expect(parseKeyCode(code.replace(/0/g, 'O').replace(/1/g, 'l'))).toEqual(k)
    expect(parseKeyCode(code.slice(0, -1))).toBeUndefined()
    expect(parseKeyCode(code.slice(0, -1) + 'U')).toBeUndefined()
  })
  it('gives the same fingerprint for the same key, and another for another', async () => {
    const k = newKey()
    expect((await prayerKey(k)).id).toBe((await prayerKey(k.slice())).id)
    expect((await prayerKey(k)).id).not.toBe((await prayerKey(newKey())).id)
  })
  it('seals a part so only the right key, in the right place, opens it', async () => {
    const k = await prayerKey(newKey())
    const audio = new Uint8Array([1, 2, 3, 250]).buffer
    const sealed = await seal(k.key, packPart({ at: 5, ms: 1200, type: 'audio/mp4' }, audio), 'abc/0')
    const back = unpackPart(await open(k.key, sealed, 'abc/0'))
    expect(back.head).toEqual({ at: 5, ms: 1200, type: 'audio/mp4' })
    expect([...new Uint8Array(back.audio)]).toEqual([1, 2, 3, 250])
    await expect(open(k.key, sealed, 'abc/1')).rejects.toThrow()
    await expect(open((await prayerKey(newKey())).key, sealed, 'abc/0')).rejects.toThrow()
  })
  it('wraps the key for a passkey secret', async () => {
    const k = newKey(), prf = crypto.getRandomValues(new Uint8Array(32))
    const w = await wrapKey(k, prf)
    expect(await unwrapKey(w, prf)).toEqual(k)
    await expect(unwrapKey(w, crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow()
  })
})
