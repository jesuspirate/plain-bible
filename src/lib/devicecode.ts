// Signing in another device with a code, instead of a link. The signed-in
// device makes a 6-digit code; the new one types it, which leaves a public
// key; the signed-in one checks that both screens show the same four digits,
// taps Allow, and seals a sign-in (and the prayer key) to that public key.
// The server passes along bytes it can't open. Loaded only when needed.
import { b64url, open, seal } from './prayerCrypto'
import { api, loadAccount, SyncError } from './sync'
import { applyMove, deviceBundle, unpack } from './move'
import { EC, deviceLabel, matchCode, shared } from './approve'

const subtle = () => crypto.subtle
const aad = (code: string) => `device/${code}`
const salt = (code: string) => `device ${code}`

function token() {
  const a = loadAccount()
  if (!a) throw new SyncError('Sign in first, under Settings → Account.')
  return a.token
}

// ---- on the signed-in device ---------------------------------------------------

/** A code for one device, for 15 minutes. The same code while it's open, so
 *  a redraw or a second tap doesn't change it under the person typing. */
let made: Promise<{ code: string; expires: number }> | undefined
export function makeDeviceCode(): Promise<{ code: string; expires: number }> {
  if (!made) {
    made = api<{ code: string; expires: number }>('/devicecode', { method: 'POST', token: token() })
    made.catch(() => { made = undefined })
    return made
  }
  return made.then(c => {
    if (Date.now() < c.expires - 60_000) return c
    made = undefined
    return makeDeviceCode()
  })
}
export const doneWithDeviceCode = () => { made = undefined }
export const dropDeviceCode = (code: string) => {
  made = undefined
  return api(`/devicecode/${code}`, { method: 'DELETE', token: token() }).catch(() => {})
}

/** Who typed the code, once someone has, with the four digits their screen shows. */
export async function deviceAsk(code: string): Promise<{ label: string; match: string; pub: string } | null> {
  const r = await api<{ pub: string | null; label: string | null }>(`/devicecode/${code}`, { token: token() })
  if (!r.pub) return null
  return { label: r.label || 'device', match: await matchCode(r.pub), pub: r.pub }
}

export async function allowDevice(code: string, pub: string): Promise<{ prayers: boolean; locked: boolean }> {
  const { bytes, prayers, locked } = await deviceBundle()
  const pair = await subtle().generateKey(EC, false, ['deriveBits']) as CryptoKeyPair
  const epk = b64url.encode(new Uint8Array(await subtle().exportKey('raw', pair.publicKey)))
  const sealed = b64url.encode(await seal(await shared(pair.privateKey, pub, salt(code)), bytes, aad(code)))
  await api(`/devicecode/${code}`, { method: 'PUT', token: token(), body: { pub, epk, sealed } })
  made = undefined
  return { prayers, locked }
}

// ---- on the new device ---------------------------------------------------------

export interface Typed { code: string; pub: string; priv: CryptoKey; match: string }

// One key for each code typed here, so a second tap or a retry sends the
// same key and the four digits never change.
const keys = new Map<string, Promise<{ pub: string; priv: CryptoKey }>>()
export async function typeDeviceCode(code: string): Promise<Typed> {
  let key = keys.get(code)
  if (!key) {
    key = (async () => {
      const pair = await subtle().generateKey(EC, false, ['deriveBits']) as CryptoKeyPair
      return { pub: b64url.encode(new Uint8Array(await subtle().exportKey('raw', pair.publicKey))), priv: pair.privateKey }
    })()
    keys.set(code, key)
    key.catch(() => keys.delete(code))
  }
  const { pub, priv } = await key
  try {
    await api(`/devicecode/${code}/ask`, { method: 'POST', body: { pub, label: deviceLabel() } })
  } catch (e) {
    if (e instanceof SyncError && e.status === 404) keys.delete(code)
    throw e
  }
  return { code, pub, priv, match: await matchCode(pub) }
}

export const stopTyped = (typed: Typed) => {
  keys.delete(typed.code)
  return api(`/devicecode/${typed.code}/stop`, { method: 'POST', body: { pub: typed.pub } }).catch(() => {})
}

/** Once allowed: sign in here, the same as a device link. False while waiting. */
export async function takeDevice(typed: Typed): Promise<boolean> {
  const r = await api<{ epk: string | null; sealed: string | null }>(`/devicecode/${typed.code}/take`, { method: 'POST', body: { pub: typed.pub } })
  if (!r.sealed || !r.epk) return false
  const bytes = await open(await shared(typed.priv, r.epk, salt(typed.code)), b64url.decode(r.sealed), aad(typed.code))
  const { bundle, prayers } = unpack(bytes)
  await applyMove(bundle, prayers)
  keys.delete(typed.code)
  return true
}
