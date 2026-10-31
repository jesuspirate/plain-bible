// Linking another device. This device packs a sign-in for the same account
// (and the prayer key, where prayers sync here), encrypts it with a fresh
// key, and leaves it with the sync server for an hour. The key travels only
// in the link's #fragment, which browsers never send to any server, so the
// server holds bytes it can't read. The same pipe once moved whole devices
// from the old address, which is why the names say "move".
import { mergeMark, Marks } from './marks'
import { meta, Prayer, prayers } from './prayers'
import { b64url, open, seal } from './prayerCrypto'
import { api, changedAt, claim, loadAccount, SettingsT, SYNC_URL, SyncError } from './sync'
import { Days, mergeDays } from './streaks'
import { t } from '../i18n'

/** The sync service is set up, so links between devices work. */
export const onNewAddress = () => !!SYNC_URL

const PREFIX = 'plain-bible:'
// Not carried: the list of versions (fetched fresh) and move bookkeeping.
const SKIP = new Set([PREFIX + 'catalog', PREFIX + 'moved', PREFIX + 'moved-in', PREFIX + 'move-later'])
const ACCOUNT = PREFIX + 'account', MARKS = PREFIX + 'marks', PRAYER_SYNC = PREFIX + 'prayer-sync'
/** Set after a link came in: what came, for the welcome. */
export const MOVED_IN = PREFIX + 'moved-in'

const CHUNK = 1_000_000
const LINK = /#\/move\/([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/

type Ref = [number, number]
interface PackedPart { ms: number; type: string; audio: Ref }
type PackedPrayer = Omit<Prayer, 'audio' | 'more'> & { audio: Ref; more?: PackedPart[] }
export interface Bundle {
  v: 1
  /** 'link': only a sign-in and the prayer key, to add another device. */
  kind?: 'move' | 'link'
  from: string
  at: number
  local: Record<string, string>
  prayerKey?: string
  /** The same account key, where prayers don't sync here but circles are
   *  open: it unlocks the circles on the other device. */
  accountKey?: string
  prayerDeleted?: string[]
  prayers: PackedPrayer[]
}
export interface MovedIn {
  at: number; from: string; marks: number; prayers: number; kind?: 'move' | 'link'; prayerKey?: boolean
  /** Signed in by the move. */
  account: boolean
  /** Already signed in here, and that sign-in stayed. */
  kept?: boolean
  /** The move came from a different account than the one signed in here. */
  otherAccount?: boolean
}

const enc = new TextEncoder(), dec = new TextDecoder()
const aad = (n: number, of: number) => `move ${n}/${of}`
const aesKey = (raw: Uint8Array, use: KeyUsage) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [use])

// ---- packing -----------------------------------------------------------------

/** Everything on this device as one byte string: the description first,
 *  then the prayers' audio, which the description points into. */
export function pack(b: Omit<Bundle, 'prayers'>, list: Prayer[]): Uint8Array {
  const audio: ArrayBuffer[] = []
  let at = 0
  const ref = (a: ArrayBuffer): Ref => { audio.push(a); const r: Ref = [at, a.byteLength]; at += a.byteLength; return r }
  const packed: PackedPrayer[] = list.map(({ audio: a, more, ...p }) => ({
    ...p, audio: ref(a), ...(more ? { more: more.map(m => ({ ms: m.ms, type: m.type, audio: ref(m.audio) })) } : {}),
  }))
  const head = enc.encode(JSON.stringify({ ...b, prayers: packed }))
  const out = new Uint8Array(4 + head.length + at)
  new DataView(out.buffer).setUint32(0, head.length)
  out.set(head, 4)
  let o = 4 + head.length
  for (const a of audio) { out.set(new Uint8Array(a), o); o += a.byteLength }
  return out
}

export function unpack(bytes: Uint8Array): { bundle: Bundle; prayers: Prayer[] } {
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  const bundle = JSON.parse(dec.decode(bytes.subarray(4, 4 + n))) as Bundle
  if (bundle.v !== 1) throw new Error(t('This move link comes from a newer version. Update the app and try again.'))
  const base = 4 + n
  const get = ([o, len]: Ref) => bytes.slice(base + o, base + o + len).buffer
  const list = bundle.prayers.map(({ audio, more, ...p }) => ({
    ...p, audio: get(audio), ...(more ? { more: more.map(m => ({ ms: m.ms, type: m.type, audio: get(m.audio) })) } : {}),
  }) as Prayer)
  return { bundle, prayers: list }
}

// ---- the old address: making the move link -------------------------------------

/** Encrypt and send packed bytes. Returns the link's id and key. */
async function upload(bytes: Uint8Array, life: 'move' | 'link', progress: (done: number, of: number) => void) {
  if (!SYNC_URL) throw new SyncError('This needs the sync service, which isn’t set up here.')
  if (navigator.onLine === false) throw new SyncError('You’re offline. Connect to the internet and try again.')
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const key = await aesKey(raw, 'encrypt')
  const { id } = await api<{ id: string }>('/move', { method: 'POST', body: {} })
  const of = Math.max(1, Math.ceil(bytes.length / CHUNK))
  progress(0, of)
  for (let n = 0; n < of; n++) {
    const sealed = await seal(key, bytes.subarray(n * CHUNK, (n + 1) * CHUNK), aad(n, of))
    await send(`/move/${id}/${n}?of=${of}${life === 'link' ? '&life=link' : ''}`, sealed)
    progress(n + 1, of)
  }
  return `#/move/${id}.${b64url.encode(raw)}`
}

/** A link that signs another device in to this account and, where prayers
 *  sync here, unlocks them there too: no passkey dance, no key to type.
 *  Highlights, notes and settings then arrive by the usual sync. It works
 *  for an hour. */
export async function makeDeviceLink(): Promise<{ link: string; prayers: boolean; locked: boolean }> {
  const acct = loadAccount()
  if (!acct) throw new SyncError('Sign in first, under Settings → Account.')
  const { token } = await api<{ token: string }>('/auth/handoff', { method: 'POST', token: acct.token })
  const local: Record<string, string> = { [ACCOUNT]: JSON.stringify({ token, rev: 0 }) }
  const syncId = localStorage.getItem(PRAYER_SYNC)
  const key = syncId ? await meta.get<Uint8Array>('key') : undefined
  if (syncId && key) local[PRAYER_SYNC] = syncId
  const acctKey = key ? undefined : await meta.get<Uint8Array>('acct')
  const b: Omit<Bundle, 'prayers'> = {
    v: 1, kind: 'link', from: location.origin, at: Date.now(), local,
    prayerKey: key ? b64url.encode(key) : undefined, accountKey: acctKey ? b64url.encode(acctKey) : undefined,
  }
  // Prayers on the account that this device can't open: the link can't
  // carry their key, so say so rather than let the other device find none.
  const locked = !key && !!(await api<{ keyId: string | null }>('/prayers', { token: acct.token }).catch(() => null))?.keyId
  const hash = await upload(pack(b, []), 'link', () => {})
  return { link: `${location.origin}/${hash}`, prayers: !!key, locked }
}

async function send(path: string, body: Uint8Array) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(SYNC_URL + path, { method: 'PUT', body: body as BodyInit, headers: { 'Content-Type': 'application/octet-stream' } })
      if (res.ok) return
      const msg = (await res.json().catch(() => ({}))).error
      if (res.status < 500 || attempt >= 2) throw new SyncError(msg || t('Sync service error ({status})', { status: res.status }), res.status)
    } catch (e) {
      if (e instanceof SyncError || attempt >= 2) throw e instanceof SyncError ? e : new SyncError('The connection dropped while sending. Try again.')
    }
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
  }
}

// ---- taking a link in ------------------------------------------------------------

/** The id and key in a move link (or the whole URL pasted). */
export function parseMoveLink(s: string): { id: string; key: string } | undefined {
  const m = LINK.exec(s.trim())
  return m ? { id: m[1], key: m[2] } : undefined
}

/** Fetch, decrypt and unpack a move. */
export async function fetchMove(link: { id: string; key: string }, progress: (done: number, of: number) => void = () => {}) {
  const key = await aesKey(b64url.decode(link.key), 'decrypt')
  const { chunks } = await api<{ chunks: number }>(`/move/${link.id}`)
  const parts: Uint8Array[] = []
  progress(0, chunks)
  for (let n = 0; n < chunks; n++) {
    const res = await fetch(`${SYNC_URL}/move/${link.id}/${n}`).catch(() => null)
    if (!res?.ok) throw new SyncError('Couldn’t download what the link carries. Check the connection and try again.')
    const plain = await open(key, new Uint8Array(await res.arrayBuffer()), aad(n, chunks)).catch(() => {
      throw new SyncError('This link is damaged. Copy it again on the other device.')
    })
    parts.push(plain)
    progress(n + 1, chunks)
  }
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  parts.reduce((o, p) => { all.set(p, o); return o + p.length }, 0)
  return unpack(all)
}

/** Highlights and notes from both sides: each verse keeps its newest
 *  highlight and bookmark, and every note. */
export function mergeMarkText(here: string | null, came: string): string {
  let a: Marks = {}, b: Marks = {}
  try { a = JSON.parse(here || '{}') } catch { /* keep what came */ }
  try { b = JSON.parse(came || '{}') } catch { return here ?? '{}' }
  const out: Marks = { ...a }
  for (const [k, m] of Object.entries(b)) out[k] = mergeMark(out[k], m)!
  return JSON.stringify(out)
}

const SETTINGS = PREFIX + 'settings', SETTINGS_T = PREFIX + 'settings-t', DAYS = PREFIX + 'days'
/** Kept with the account they belong to: never taken from another account. */
const ACCOUNT_BOUND = (k: string) => k === ACCOUNT || k === PRAYER_SYNC || k.startsWith(PREFIX + 'circle') || k.startsWith(PREFIX + 'share-circle')
const parse = <T>(s: string | null | undefined, or: T): T => { try { return s ? JSON.parse(s) ?? or : or } catch { return or } }

/** Settings from both sides: each one keeps its newest change. A setting
 *  here with no change time is a first-start default, so what came wins. */
export function mergeSettingsText(here: { s: string | null; t: string | null }, came: { s?: string; t?: string }) {
  const hs = parse<Record<string, unknown>>(here.s, {}), cs = parse<Record<string, unknown>>(came.s, {})
  const ht = parse<SettingsT>(here.t, {}), ct = parse<SettingsT>(came.t, {})
  const s: Record<string, unknown> = { ...hs }, t: Record<string, number> = {}
  for (const k of new Set([...Object.keys(hs), ...Object.keys(cs)])) {
    const a = changedAt(ht, k), b = changedAt(ct, k)
    const useCame = k in cs && (!(k in hs) || a === 0 || b > a)
    if (useCame) s[k] = cs[k]
    const at = useCame ? b : a
    if (at) t[k] = at
  }
  return { settings: JSON.stringify(s), settingsT: JSON.stringify(t) }
}

/** What a move writes here, given what's here already. Nothing here is
 *  replaced by something older: highlights and notes join, settings keep
 *  their newest change, reading days add up, and anything else already here
 *  stays. `ownAccount`: this device is signed in already, so its sign-in
 *  stays; `sameAccount`: the move comes from that same account (false or
 *  unknown keeps out everything tied to the other account). */
export function mergeLocal(here: (k: string) => string | null, came: Record<string, string>, ownAccount: boolean, sameAccount: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(came)) {
    if (!k.startsWith(PREFIX) || SKIP.has(k) || k === SETTINGS || k === SETTINGS_T) continue
    if (k === ACCOUNT && ownAccount) continue
    if (ownAccount && !sameAccount && ACCOUNT_BOUND(k)) continue
    const h = here(k)
    if (k === MARKS) out[k] = mergeMarkText(h, v)
    else if (k === DAYS) out[k] = JSON.stringify(mergeDays(parse<Days>(h, {}), parse<Days>(v, {})))
    else if (h === null) out[k] = v
  }
  if (came[SETTINGS] !== undefined) {
    const m = mergeSettingsText({ s: here(SETTINGS), t: here(SETTINGS_T) }, { s: came[SETTINGS], t: came[SETTINGS_T] })
    out[SETTINGS] = m.settings
    out[SETTINGS_T] = m.settingsT
  }
  return out
}

/** Which account a sign-in belongs to, or undefined if that can't be told. */
async function whose(token: string) {
  const a = await api<{ created: number; email: string | null }>('/account', { token }).catch(() => undefined)
  return a && `${a.created}|${a.email ?? ''}`
}

/** Put a move on this device, joining what's here (see mergeLocal). A
 *  sign-in here stays, and so do the prayer key and circles here. */
export async function applyMove(bundle: Bundle, list: Prayer[]): Promise<MovedIn> {
  const own = loadAccount()
  const cameToken = parse<{ token?: string }>(bundle.local[ACCOUNT], {}).token
  let same = !own
  if (own && cameToken) {
    const [a, b] = await Promise.all([whose(own.token), whose(cameToken)])
    same = !!a && a === b
    // This device keeps its own sign-in, so the one that came isn't needed.
    api('/auth/logout', { method: 'POST', token: cameToken }).catch(() => {})
  } else if (cameToken) await claim(cameToken)
  const get = (k: string) => localStorage.getItem(k)
  for (const [k, v] of Object.entries(mergeLocal(get, bundle.local, !!own, same))) localStorage.setItem(k, v)
  for (const p of list) if (!(await prayers.get(p.id))) await prayers.put(p)
  // A prayer key here stays: replacing it would lock the prayers it opens.
  const hadKey = !!(await meta.get('key'))
  const takeKey = same && !!bundle.prayerKey && !hadKey
  if (takeKey) await meta.set('key', b64url.decode(bundle.prayerKey!))
  if (same && bundle.accountKey && !(await meta.get('acct'))) await meta.set('acct', b64url.decode(bundle.accountKey))
  if (bundle.prayerDeleted?.length) {
    const here = (await meta.get<string[]>('deleted')) ?? []
    await meta.set('deleted', [...new Set([...here, ...bundle.prayerDeleted])])
  }
  let marks = 0
  try { marks = Object.keys(JSON.parse(bundle.local[MARKS] || '{}')).length } catch { /* ignore */ }
  const info: MovedIn = {
    at: Date.now(), from: bundle.from, marks, prayers: list.length, kind: bundle.kind ?? 'move',
    account: !own && !!bundle.local[ACCOUNT], kept: !!own, otherAccount: !!own && !!cameToken && !same, prayerKey: takeKey,
  }
  localStorage.setItem(MOVED_IN, JSON.stringify(info))
  return info
}

export function movedIn(): MovedIn | null {
  try { return JSON.parse(localStorage.getItem(MOVED_IN) || 'null') } catch { return null }
}
