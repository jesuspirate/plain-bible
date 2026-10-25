// The sync service's push messages (worker/src/push.ts), opened here the way
// a phone opens them (RFC 8291), and its VAPID signature checked.
import { describe, expect, it } from 'vitest'
import { encrypt, vapidHeader, vapidPublic } from '../../worker/src/push'

const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url')
const enc = new TextEncoder()
async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8))
}

describe('web push', () => {
  it('encrypts a message only the phone can open', async () => {
    const phone = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', phone.publicKey) as ArrayBuffer)
    const auth = crypto.getRandomValues(new Uint8Array(16))
    const body = await encrypt({ p256dh: b64(pub), auth: b64(auth) }, enc.encode('{"c":"family"}'))

    const salt = body.slice(0, 16), idlen = body[20], server = body.slice(21, 21 + idlen), sealed = body.slice(21 + idlen)
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096)
    expect(idlen).toBe(65)
    const theirs = await crypto.subtle.importKey('raw', server, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, phone.privateKey, 256))
    const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...pub, ...server])
    const ikm = await hkdf(auth, shared, info, 32)
    const cek = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt'])
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, cek, sealed))
    expect(plain[plain.length - 1]).toBe(2)
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"c":"family"}')
  })

  it('signs for the push service it sends to', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    const h = await vapidHeader('https://web.push.apple.com/QAbc', { jwk, subject: 'mailto:hello@myquietbible.com' }, 1_700_000_000_000)
    const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h)!
    expect(k).toBe(vapidPublic(jwk))
    const [head, claims, sig] = t.split('.')
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ aud: 'https://web.push.apple.com', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:hello@myquietbible.com' })
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(sig, 'base64url'), enc.encode(`${head}.${claims}`))
    expect(ok).toBe(true)
  })
})
