// Web Push, for "something new in your circle". What's shared is sealed on
// the devices, so all a notification can carry is which circle; the phone
// shows that circle's name from its own copy. Each message is encrypted to
// the device (RFC 8291) and signed with the service's VAPID key (RFC 8292),
// both with WebCrypto, so nothing is added to the Worker.

const enc = new TextEncoder()
const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of parts) { out.set(p, i); i += p.length }
  return out
}
type Bytes = Uint8Array<ArrayBuffer>
async function hkdf(salt: Bytes, ikm: Bytes, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: info as Bytes }, key, bytes * 8))
}

export interface Subscription { endpoint: string; p256dh: string; auth: string }

/** The service's key: a P-256 private key as JWK (the VAPID_KEY secret). */
export interface Vapid { jwk: JsonWebKey; subject: string }
/** The public half, as browsers want it for subscribing. */
export const vapidPublic = (jwk: JsonWebKey) => b64(concat(new Uint8Array([4]), unb64(jwk.x!), unb64(jwk.y!)))

/** The body of one push message: `payload` encrypted for this device
 *  (aes128gcm). `local` and `salt` are only passed by tests. */
export async function encrypt(sub: Pick<Subscription, 'p256dh' | 'auth'>, payload: Uint8Array, local?: CryptoKeyPair, salt: Bytes = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPublic = unb64(sub.p256dh), auth = unb64(sub.auth)
  const pair = local ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)
  const ua = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua } as unknown as Parameters<SubtleCrypto['deriveBits']>[0], pair.privateKey, 256))
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // One record, ended by the 0x02 delimiter.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))))
  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096)
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed)
}

const signers = new Map<string, Promise<CryptoKey>>()
/** "vapid t=…, k=…": who is sending, signed, for the push service at this endpoint. */
export async function vapidHeader(endpoint: string, v: Vapid, now = Date.now()) {
  const pub = vapidPublic(v.jwk)
  if (!signers.has(pub)) {
    const { d, x, y } = v.jwk
    signers.set(pub, crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d, x, y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']))
  }
  const head = b64(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject })))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signers.get(pub)!, enc.encode(`${head}.${claims}`)))
  return `vapid t=${head}.${claims}.${b64(sig)}, k=${pub}`
}

/** Send one message. Returns false when the device has gone (unsubscribed,
 *  app removed), so its subscription can be forgotten. */
export async function send(sub: Subscription, payload: unknown, v: Vapid, topic?: string): Promise<boolean> {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, v),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // Kept a day for a phone that's off; one per circle at a time.
      TTL: '86400',
      Urgency: 'normal',
      // A newer message for the same circle replaces one not yet delivered.
      ...(topic ? { Topic: topic.replace(/[^\w-]/g, '').slice(0, 32) } : {}),
    },
    body: await encrypt(sub, enc.encode(JSON.stringify(payload))),
  })
  if (res.status === 404 || res.status === 410) return false
  if (!res.ok) console.error('push', new URL(sub.endpoint).host, res.status, (await res.text()).slice(0, 200))
  return true
}
