// Prayer sync, off until you turn it on, one device at a time. Recordings are
// encrypted here before they leave the device (see prayerCrypto); the server
// only ever holds bytes it can't read. Loaded only when needed, so it costs
// nothing at startup.
import { meta, partsOf, prayers } from './prayers'
import {
  b64url, keyCode, newKey, open, packPart, parseKeyCode, prayerKey, PRF_SALT, seal, unpackPart, unwrapKey, wrapKey,
} from './prayerCrypto'
import { api, loadAccount, noPasskey, setNoPasskey, SYNC_URL, SyncError } from './sync'
import { cleanVerse } from './prayerVerses'
import { t } from '../i18n'

/** Set on a device whose prayers sync: the fingerprint of the key it holds. */
const ON = 'plain-bible:prayer-sync'
export const prayerSyncOn = () => { try { return !!localStorage.getItem(ON) } catch { return false } }
const setOn = (keyId: string | null) => { try { keyId ? localStorage.setItem(ON, keyId) : localStorage.removeItem(ON) } catch { /* ignore */ } }

const CHUNK = 1_000_000
// The verse a prayer was prayed over travels as its own small sealed part,
// numbered past any audio, so apps from before verses simply skip it.
const VERSE_PART = 999
const enc = new TextEncoder(), dec = new TextDecoder()

interface Remote { keyId: string | null; passkeys?: number; parts: { prayer: string; part: number; chunks: number; size: number }[]; gone: string[] }

// ---- turning it on -----------------------------------------------------------

/** A secret only this passkey can produce, the same on every device the
 *  passkey is synced to. Null where the browser or passkey can't (then the
 *  key is typed in as a code instead). */
async function passkeySecret(): Promise<{ credId: string; secret: Uint8Array } | null> {
  if (typeof PublicKeyCredential === 'undefined') return null
  let cred: PublicKeyCredential | null
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        userVerification: 'preferred',
        extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
      },
    }) as PublicKeyCredential | null
  } catch (e) {
    if ((e as Error).name === 'NotAllowedError' || (e as Error).name === 'AbortError') throw new SyncError('Cancelled')
    return null
  }
  const first = (cred?.getClientExtensionResults() as { prf?: { results?: { first?: BufferSource } } })?.prf?.results?.first
  if (!cred || !first) return null
  return { credId: b64url.encode(new Uint8Array(cred.rawId)), secret: new Uint8Array(first instanceof ArrayBuffer ? first : (first as ArrayBufferView).buffer) }
}

// The passkey secret from a first try that ended up asking for the code, so
// the code needs typing only once: after that the passkey unlocks it. Also
// the one a passkey sign-in just gave, so nothing asks for the passkey again.
let pendingSecret: { credId: string; secret: Uint8Array } | null = null

/** A key this device already holds for the prayers' key `keyId`. */
async function heldKey(keyId: string | null) {
  for (const name of ['key', 'acct']) {
    const raw = await meta.get<Uint8Array>(name)
    if (raw && (!keyId || (await prayerKey(raw)).id === keyId)) return raw
  }
}

/** Right after a passkey sign-in (or sign-up) that also gave the passkey's
 *  secret: keep the account key on this device, so circles and prayers open
 *  without a second passkey sheet. Where the device already holds it, the
 *  passkey is taught to unlock it too, for next time on a new device. */
export async function passkeySignedIn(token: string, s: { credId: string; secret: Uint8Array } | null) {
  pendingSecret = s
  if (!s) return
  const remote = await api<Remote>('/prayers', { token })
  // A new account: its key is made when first needed, from this secret.
  if (!remote.keyId) return
  const wrapAt = `/prayers/wrap/${encodeURIComponent(s.credId)}`
  let raw = await heldKey(remote.keyId)
  if (raw) {
    await api(wrapAt, { method: 'PUT', token, body: { wrapped: await wrapKey(raw, s.secret) } }).catch(() => {})
  } else {
    const w = await api<{ wrapped: string }>(wrapAt, { token }).catch(() => null)
    raw = w ? await unwrapKey(w.wrapped, s.secret).catch(() => undefined) : undefined
    if (!raw || (await prayerKey(raw)).id !== remote.keyId) return
  }
  await meta.set('acct', raw)
  pendingSecret = null
  keepStorage()
}

/** Ask the browser not to clear this device's keys when space runs low.
 *  Safari and Chrome decide by themselves, without asking; Firefox would
 *  ask, so not there. */
export function keepStorage() {
  if (/Firefox\//.test(navigator.userAgent)) return
  navigator.storage?.persist?.().catch(() => {})
}

/** The account's prayer key, from the passkey or a typed code; on the
 *  account's first device this makes it. 'needCode' when the key has to be
 *  typed in (a passkey that can't unlock it). Circles use the same key to
 *  keep each circle's key, so it's one key to look after, not two. */
export async function unlockKey(code?: string): Promise<Uint8Array | 'needCode'> {
  const acct = loadAccount()
  if (!SYNC_URL || !acct) throw new SyncError('Sign in first, under Settings → Account.')
  // The passkey is asked for at once, in the same tap, while the server is
  // asked alongside. Safari drops a passkey sheet that opens after a network
  // wait and reports it as cancelled, so a second tap failed the same way.
  // Not where the last look found no passkey (an account signed in by email).
  // A key already here (from another device's approval, or from circles)
  // needs nothing asked. Nor does a secret the passkey already gave (at
  // sign-in, or a try that ended up asking for the code): its answer won't
  // change, and asking again would only show the same sheet for nothing.
  const kept = code === undefined ? (await meta.get<Uint8Array>('key')) ?? (await meta.get<Uint8Array>('acct')) : undefined
  const given = code === undefined && !kept ? pendingSecret : null
  const asking = code === undefined && !kept && !given && !noPasskey()
    ? passkeySecret().then(s => ({ s }), (e: Error) => ({ e }))
    : undefined
  const remote = await api<Remote>('/prayers', { token: acct.token })
  if (remote.passkeys !== undefined) setNoPasskey(remote.passkeys === 0)
  let raw: Uint8Array | undefined
  let secret = pendingSecret
  const held = code === undefined && kept ? await heldKey(remote.keyId) : undefined
  if (code !== undefined) {
    raw = parseKeyCode(code)
    if (!raw) throw new SyncError('That isn’t a whole prayer key. It has 32 letters and numbers.')
    if (remote.keyId && (await prayerKey(raw)).id !== remote.keyId) throw new SyncError('That key doesn’t match the prayers on this account.')
  } else if (held) {
    raw = held
  } else if (given || (asking && remote.passkeys !== 0)) {
    if (asking) {
      const r = await asking
      if ('e' in r) throw r.e
      secret = r.s
    }
    if (secret) {
      const w = await api<{ wrapped: string }>(`/prayers/wrap/${encodeURIComponent(secret.credId)}`, { token: acct.token }).catch(() => null)
      if (w) raw = await unwrapKey(w.wrapped, secret.secret).catch(() => undefined)
    }
  }
  if (!raw && !remote.keyId) raw = newKey()
  if (!raw) { pendingSecret = secret; return 'needCode' }
  pendingSecret = null
  const pk = await prayerKey(raw)
  if (remote.keyId && pk.id !== remote.keyId) throw new SyncError('This passkey holds an older prayer key. Type in the key from a device where prayers sync.')
  if (!remote.keyId) {
    await api('/prayers/key', { method: 'PUT', token: acct.token, body: { keyId: pk.id } }).catch(e => {
      throw e instanceof SyncError && e.status === 409 ? new SyncError('Another device just turned prayer sync on. Try again.') : e
    })
  }
  if (secret) {
    await api(`/prayers/wrap/${encodeURIComponent(secret.credId)}`, { method: 'PUT', token: acct.token, body: { wrapped: await wrapKey(raw, secret.secret) } }).catch(() => {})
  }
  return raw
}

/** Turn prayer sync on for this device. Asks for the passkey; on the
 *  account's first device this makes the prayer key. Returns needCode when
 *  the key has to be typed in (a passkey that can't unlock it). */
export async function turnOnPrayerSync(code?: string): Promise<'on' | 'needCode'> {
  const raw = await unlockKey(code)
  if (raw === 'needCode') return raw
  const pk = await prayerKey(raw)
  await meta.set('key', raw)
  keepStorage()
  setOn(pk.id)
  await syncPrayers()
  return 'on'
}

/** A new account key, for when no device can open the old one any more
 *  (an app deleted, Safari's storage cleared, a passkey that can't unlock
 *  keys). What the old key locked on the server is dropped: nobody can open
 *  it. Prayers kept on this device stay, and sync again with the new key. */
export async function startOver() {
  const acct = loadAccount()
  if (!SYNC_URL || !acct) throw new SyncError('Sign in first, under Settings → Account.')
  const raw = newKey(), pk = await prayerKey(raw)
  await api('/prayers/key/new', { method: 'POST', token: acct.token, body: { keyId: pk.id } })
  await meta.set('acct', raw)
  if (prayerSyncOn()) { await meta.set('key', raw); setOn(pk.id) } else await meta.set('key', undefined)
  // The passkey that just tried can unlock the new key from now on.
  if (pendingSecret) {
    await api(`/prayers/wrap/${encodeURIComponent(pendingSecret.credId)}`, { method: 'PUT', token: acct.token, body: { wrapped: await wrapKey(raw, pendingSecret.secret) } }).catch(() => {})
    pendingSecret = null
  }
  keepStorage()
}

/** Let a passkey unlock the prayer key on other devices too (say one just
 *  saved on a new address). Asks for the passkey; false if it can't. */
export async function keepKeyWithPasskey(): Promise<boolean> {
  const acct = loadAccount(), raw = await meta.get<Uint8Array>('key')
  if (!SYNC_URL || !acct || !raw) return false
  const secret = await passkeySecret()
  if (!secret) return false
  await api(`/prayers/wrap/${encodeURIComponent(secret.credId)}`, { method: 'PUT', token: acct.token, body: { wrapped: await wrapKey(raw, secret.secret) } })
  return true
}

/** Stop syncing on this device. Its prayers stay here, and on the account. */
export async function turnOffPrayerSync() {
  setOn(null)
  await meta.set('key', undefined)
}

/** The prayer key as a code, to unlock prayers on a device whose passkey can't. */
export async function prayerKeyCode() {
  const raw = await meta.get<Uint8Array>('key')
  return raw ? keyCode(raw) : ''
}

/** Remember a deletion, to delete the prayer on the other devices too. */
export async function deletedHere(id: string) {
  if (!prayerSyncOn()) return
  const list = (await meta.get<string[]>('deleted')) ?? []
  await meta.set('deleted', [...list, id])
}

// ---- syncing -----------------------------------------------------------------

let running: Promise<boolean> | null = null
/** Send what's new here, fetch what's new elsewhere, and carry deletions
 *  both ways. Resolves true if anything here changed. */
export function syncPrayers(): Promise<boolean> {
  return running ??= run().finally(() => { running = null })
}

async function run(): Promise<boolean> {
  const acct = loadAccount()
  if (!SYNC_URL || !acct || !prayerSyncOn() || navigator.onLine === false) return false
  const raw = await meta.get<Uint8Array>('key')
  if (!raw) { setOn(null); return false }
  const token = acct.token
  const pk = await prayerKey(raw)
  const remote = await api<Remote>('/prayers', { token })
  if (remote.keyId !== pk.id) {
    await turnOffPrayerSync()
    throw new SyncError('Prayer sync turned off: the account you’re signed in to has different prayers. Turn it on again to use them.')
  }
  let changed = false

  // Deletions made here go first, then deletions made elsewhere.
  const deleted = (await meta.get<string[]>('deleted')) ?? []
  for (const id of deleted) await api(`/prayers/${id}`, { method: 'DELETE', token })
  if (deleted.length) await meta.set('deleted', undefined)
  const gone = new Set([...remote.gone, ...deleted])
  let local = await prayers.list()
  for (const p of local) if (gone.has(p.id)) { await prayers.delete(p.id); changed = true }
  local = local.filter(p => !gone.has(p.id))

  // How many parts of each prayer are on the server, in order.
  const chunks = new Map<string, Map<number, number>>()
  for (const r of remote.parts) {
    if (!chunks.has(r.prayer)) chunks.set(r.prayer, new Map())
    chunks.get(r.prayer)!.set(r.part, r.chunks)
  }
  const sent = (id: string) => { let n = 0; while (chunks.get(id)?.has(n)) n++; return n }

  // Up: whatever the server doesn't have yet.
  up: for (const p of local) {
    const from = sent(p.id)
    if (p.parts > from) {
      const full = await prayers.get(p.id)
      if (!full) continue
      const parts = partsOf(full)
      for (let i = from; i < parts.length; i++) {
        const sealed = await seal(pk.key, packPart({ at: full.at, ms: parts[i].ms, type: parts[i].type }, parts[i].audio), `${p.id}/${i}`)
        const of = Math.ceil(sealed.length / CHUNK)
        for (let n = 0; n < of; n++) {
          const res = await put(`/prayers/${p.id}/${i}/${n}?of=${of}`, token, sealed.subarray(n * CHUNK, (n + 1) * CHUNK))
          if (res === 'gone') { await prayers.delete(p.id); changed = true; continue up }
        }
      }
    }
    if (p.verse && !chunks.get(p.id)?.has(VERSE_PART)) {
      const sealed = await seal(pk.key, enc.encode(JSON.stringify(p.verse)), `${p.id}/${VERSE_PART}`)
      if (await put(`/prayers/${p.id}/${VERSE_PART}/0?of=1`, token, sealed) === 'gone') { await prayers.delete(p.id); changed = true }
    }
  }

  // Down: prayers, or later parts of them, recorded elsewhere.
  const mine = new Map(local.map(p => [p.id, p.parts]))
  const verseHere = new Set(local.filter(p => p.verse).map(p => p.id))
  for (const id of chunks.keys()) {
    if (gone.has(id)) continue
    const have = mine.get(id) ?? 0, total = sent(id)
    for (let i = have; i < total; i++) {
      const pieces: Uint8Array[] = []
      for (let n = 0; n < chunks.get(id)!.get(i)!; n++) pieces.push(await get(`/prayers/${id}/${i}/${n}`, token))
      const sealed = new Uint8Array(pieces.reduce((s, x) => s + x.length, 0))
      pieces.reduce((o, x) => { sealed.set(x, o); return o + x.length }, 0)
      const { head, audio } = unpackPart(await open(pk.key, sealed, `${id}/${i}`))
      const part = { ms: head.ms, type: head.type, audio }
      if (i === 0) await prayers.put({ id, at: head.at, ...part })
      else await prayers.append(id, part)
      changed = true
    }
    // The verse it was prayed over, tied on another device.
    if ((have || total) && chunks.get(id)!.get(VERSE_PART) === 1 && !verseHere.has(id)) {
      const sealed = await get(`/prayers/${id}/${VERSE_PART}/0`, token)
      // One unreadable verse mustn't stop the prayers themselves syncing.
      const verse = await open(pk.key, sealed, `${id}/${VERSE_PART}`).then(b => cleanVerse(JSON.parse(dec.decode(b))), () => undefined)
      if (verse) { await prayers.setVerse(id, verse); changed = true }
    }
  }
  return changed
}

async function put(path: string, token: string, body: Uint8Array): Promise<'ok' | 'gone'> {
  const res = await fetch(SYNC_URL + path, {
    method: 'PUT', body: body as BodyInit,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
  })
  if (res.status === 410) return 'gone'
  if (!res.ok) throw new SyncError((await res.json().catch(() => ({}))).error || t('Sync service error ({status})', { status: res.status }), res.status)
  return 'ok'
}
async function get(path: string, token: string): Promise<Uint8Array> {
  const res = await fetch(SYNC_URL + path, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new SyncError(t('Sync service error ({status})', { status: res.status }), res.status)
  return new Uint8Array(await res.arrayBuffer())
}
