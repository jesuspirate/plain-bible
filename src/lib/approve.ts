// "Allow your new phone?" A device that can't unlock prayers and circles by
// itself (say, one signed in by email) makes a key pair and asks; a device
// that holds the account key shows the ask next time it opens, and one tap
// seals the key to that pair. The server only passes along bytes it can't
// open. Both screens show the same four digits, so a swapped request would
// show. Loaded only when needed.
import { meta } from './prayers'
import { aesKey, b64url, keyCode, open, seal } from './prayerCrypto'
import { api, loadAccount, SyncError } from './sync'
import { N_ } from '../i18n'

const EC = { name: 'ECDH', namedCurve: 'P-256' } as const
const DAY = 86_400_000
const subtle = () => crypto.subtle

export interface Ask { id: string; pub: string; label: string; at: number }
interface Mine { id: string; pub: string; priv: CryptoKey; at: number }

function token() {
  const a = loadAccount()
  if (!a) throw new SyncError('Sign in first, under Settings → Account.')
  return a.token
}

/** The account key this device holds, if any. */
export const localKey = async () => (await meta.get<Uint8Array>('key')) ?? (await meta.get<Uint8Array>('acct'))
/** It as a code, to keep somewhere safe. */
export const localKeyCode = async () => { const k = await localKey(); return k ? keyCode(k) : '' }

/** Four digits both devices show for one request. */
export async function matchCode(pub: string) {
  const h = new Uint8Array(await subtle().digest('SHA-256', new TextEncoder().encode(pub)))
  return String(new DataView(h.buffer).getUint32(0) % 10000).padStart(4, '0')
}

function deviceLabel() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? N_('Android phone') : N_('Android tablet')
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return N_('Windows computer')
  return N_('device')
}

async function shared(priv: CryptoKey, pub: string, id: string) {
  const other = await subtle().importKey('raw', b64url.decode(pub), EC, false, [])
  const bits = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: other }, priv, 256))
  return aesKey(bits, `approve v1 ${id}`)
}

// ---- on the new device -------------------------------------------------------

/** Ask the other devices for the key. The same ask stands for a day. */
export async function askApproval(): Promise<{ code: string; label: string }> {
  let mine = await meta.get<Mine>('approve')
  if (!mine || Date.now() - mine.at > DAY - 3_600_000) {
    const pair = await subtle().generateKey(EC, false, ['deriveBits']) as CryptoKeyPair
    const pub = b64url.encode(new Uint8Array(await subtle().exportKey('raw', pair.publicKey)))
    const { id } = await api<{ id: string }>('/approve', { method: 'POST', token: token(), body: { pub, label: deviceLabel() } })
    mine = { id, pub, priv: pair.privateKey, at: Date.now() }
    await meta.set('approve', mine)
  }
  return { code: await matchCode(mine.pub), label: deviceLabel() }
}

/** The key, once another device has allowed this one; null while waiting. */
export async function checkApproval(): Promise<Uint8Array | null> {
  const mine = await meta.get<Mine>('approve')
  if (!mine) return null
  let r: { epk: string | null; sealed: string | null }
  try { r = await api(`/approve/${mine.id}`, { token: token() }) } catch (e) {
    if (e instanceof SyncError && e.status === 404) await meta.set('approve', undefined)
    throw e
  }
  if (!r.sealed || !r.epk) return null
  const raw = await open(await shared(mine.priv, r.epk, mine.id), b64url.decode(r.sealed), `approve/${mine.id}`)
  await meta.set('acct', raw)
  await meta.set('approve', undefined)
  api(`/approve/${mine.id}`, { method: 'DELETE', token: token() }).catch(() => {})
  return raw
}

// ---- on a device that holds the key --------------------------------------------

/** Devices waiting for this one to let them in. Nothing to ask unless this
 *  device holds the key. */
export async function waitingApprovals(): Promise<(Ask & { code: string })[]> {
  if (!loadAccount() || !(await localKey())) return []
  const { requests } = await api<{ requests: Ask[] }>('/approve', { token: token() })
  return Promise.all(requests.map(async a => ({ ...a, code: await matchCode(a.pub) })))
}

export async function allow(ask: Ask) {
  const raw = await localKey()
  if (!raw) throw new SyncError('This device can’t unlock them either.')
  const pair = await subtle().generateKey(EC, false, ['deriveBits']) as CryptoKeyPair
  const epk = b64url.encode(new Uint8Array(await subtle().exportKey('raw', pair.publicKey)))
  const sealed = b64url.encode(await seal(await shared(pair.privateKey, ask.pub, ask.id), raw, `approve/${ask.id}`))
  await api(`/approve/${ask.id}`, { method: 'PUT', token: token(), body: { epk, sealed } })
}

export const decline = (ask: Ask) => api(`/approve/${ask.id}`, { method: 'DELETE', token: token() })

/** Whether this device already asked and is waiting. */
export const waitingHere = async () => !!(await meta.get<Mine>('approve'))
