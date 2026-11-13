// Apple's own push, for the App Store iPhone app (ios/), which can't use web
// push. Same message as web push: only which circle has something new. The
// app's notification extension (ios/QuietBibleNotify) puts the circle's name
// in from the phone's own copy, so the name never comes from here either.
// Signed with the APNs key (APNS_KEY_P8, APNS_KEY_ID) using WebCrypto, so
// nothing is added to the Worker.

const enc = new TextEncoder()
const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface Apns { p8: string; keyId: string; teamId: string; topic: string }

/** A device's Apple push token: hex, as the app sends it. */
export const APNS_TOKEN = /^[0-9a-f]{64,200}$/
/** Stored in push_subs.endpoint as `apns:<token>`; p256dh holds which
 *  Apple server ('production', or 'sandbox' for Xcode builds). */
export const APNS_PREFIX = 'apns:'

// Only these two hosts, ever (and both are in the server's push allow-list).
const HOSTS = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' } as const
export type ApnsEnv = keyof typeof HOSTS
export const isApnsEnv = (v: unknown): v is ApnsEnv => v === 'production' || v === 'sandbox'

let signer: { id: string; key: Promise<CryptoKey> } | undefined
let jwt: { id: string; at: number; value: string } | undefined

function pkcs8(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(body), c => c.charCodeAt(0))
}

/** The bearer token. Apple wants a new one at most every 20 minutes and
 *  refuses one older than an hour, so each is kept for 40 minutes. */
export async function apnsJwt(a: Apns, now = Date.now()) {
  if (jwt && jwt.id === a.keyId && now - jwt.at < 40 * 60_000) return jwt.value
  if (signer?.id !== a.keyId) signer = { id: a.keyId, key: crypto.subtle.importKey('pkcs8', pkcs8(a.p8), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) }
  const head = b64(enc.encode(JSON.stringify({ alg: 'ES256', kid: a.keyId })))
  const claims = b64(enc.encode(JSON.stringify({ iss: a.teamId, iat: Math.floor(now / 1000) })))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signer.key, enc.encode(`${head}.${claims}`)))
  const value = `${head}.${claims}.${b64(sig)}`
  jwt = { id: a.keyId, at: now, value }
  return value
}

/** What the phone gets. The words are a fallback, in the app's own
 *  languages; the extension replaces them with "Something new in Family".
 *  No sound and no number on the icon, as with web push. */
export const apnsBody = (circle: string) => ({
  aps: {
    alert: { 'loc-key': 'Something new in your circle' },
    'mutable-content': 1,
    'thread-id': circle,
  },
  c: circle,
})

/** Send one. False when the device has gone (app removed, notifications
 *  turned off for good), so it can be forgotten. */
export async function sendApns(token: string, env: ApnsEnv, circle: string, a: Apns): Promise<boolean> {
  if (!APNS_TOKEN.test(token)) return false
  const res = await fetch(`${HOSTS[env]}/3/device/${token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await apnsJwt(a)}`,
      'apns-topic': a.topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      // Kept a day for a phone that's off; a newer one for the same circle replaces it.
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400),
      'apns-collapse-id': circle.slice(0, 64),
      'content-type': 'application/json',
    },
    body: JSON.stringify(apnsBody(circle)),
  })
  if (res.ok) return true
  const reason = await res.text().then(t => { try { return String(JSON.parse(t).reason) } catch { return t.slice(0, 100) } }, () => '')
  if (res.status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic') return false
  // A token Apple no longer takes: make a new one next time.
  if (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') jwt = undefined
  console.error('apns', res.status, reason)
  return true
}
