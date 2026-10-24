// Moving to the app's new address. A browser keeps each web address's data
// apart, and passkeys belong to one address, so nothing on the old address
// is visible on the new one by itself. The old address packs everything on
// the device (highlights, notes, settings, history, prayers and their sync
// key, and a sign-in for the same account), encrypts it with a fresh key,
// and leaves it with the sync server for a few days. The key travels only in
// the move link's #fragment, which browsers never send to any server, so
// the server holds bytes it can't read.
import { mergeMark, Marks } from './marks'
import { meta, Prayer, prayers } from './prayers'
import { b64url, open, seal } from './prayerCrypto'
import { api, loadAccount, SYNC_URL, SyncError } from './sync'

export const NEW_ORIGIN = 'https://myquietbible.com'
export const NEW_HOST = 'myquietbible.com'
const OLD_HOSTS = ['bible.chama.community']
/** This copy is running on an old address, which can move to the new one. */
export const onOldAddress = () => OLD_HOSTS.includes(location.hostname)
/** This copy is running on the new address, which can take in a move. */
export const onNewAddress = () => !onOldAddress() && !!SYNC_URL

const PREFIX = 'plain-bible:'
// Not carried: the list of versions (fetched fresh) and move bookkeeping.
const SKIP = new Set([PREFIX + 'catalog', PREFIX + 'moved', PREFIX + 'moved-in', PREFIX + 'move-later'])
const ACCOUNT = PREFIX + 'account', MARKS = PREFIX + 'marks', PRAYER_SYNC = PREFIX + 'prayer-sync'
/** Set on the old address once a move link was made. */
export const MOVED = PREFIX + 'moved'
/** Set on the new address after a move came in: what came, for the welcome. */
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
export interface MovedIn { at: number; from: string; marks: number; prayers: number; account: boolean; kind?: 'move' | 'link'; prayerKey?: boolean }

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
  if (bundle.v !== 1) throw new Error('This move link comes from a newer version. Update the app and try again.')
  const base = 4 + n
  const get = ([o, len]: Ref) => bytes.slice(base + o, base + o + len).buffer
  const list = bundle.prayers.map(({ audio, more, ...p }) => ({
    ...p, audio: get(audio), ...(more ? { more: more.map(m => ({ ms: m.ms, type: m.type, audio: get(m.audio) })) } : {}),
  }) as Prayer)
  return { bundle, prayers: list }
}

// ---- the old address: making the move link -------------------------------------

/** What's on this device, ready to pack. Signed in, the new address gets
 *  its own sign-in to the same account. */
async function gather(): Promise<{ b: Omit<Bundle, 'prayers'>; list: Prayer[] }> {
  const local: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(PREFIX) && !SKIP.has(k)) local[k] = localStorage.getItem(k) ?? ''
  }
  delete local[ACCOUNT]
  const acct = loadAccount()
  if (acct) {
    try {
      const { token } = await api<{ token: string }>('/auth/handoff', { method: 'POST', token: acct.token })
      local[ACCOUNT] = JSON.stringify({ token, rev: 0 })
    } catch (e) {
      // Signed out meanwhile: the move still carries everything else.
      if (!(e instanceof SyncError && e.status === 401)) throw e
    }
  }
  let list: Prayer[] = [], key: Uint8Array | undefined, deleted: string[] | undefined
  if (typeof indexedDB !== 'undefined') {
    const ids = (await prayers.list()).map(p => p.id)
    list = (await Promise.all(ids.map(id => prayers.get(id)))).filter((p): p is Prayer => !!p)
    key = await meta.get<Uint8Array>('key')
    deleted = await meta.get<string[]>('deleted')
  }
  return {
    b: { v: 1, from: location.origin, at: Date.now(), local, prayerKey: key ? b64url.encode(key) : undefined, prayerDeleted: deleted },
    list,
  }
}

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

/** Pack, encrypt and send everything on this device. Returns the move link
 *  and what it carries. */
export async function makeMoveLink(progress: (done: number, of: number) => void = () => {}): Promise<{ link: string; prayers: number; marks: number; account: boolean }> {
  const { b, list } = await gather()
  const hash = await upload(pack(b, list), 'move', progress)
  try { localStorage.setItem(MOVED, String(Date.now())) } catch { /* ignore */ }
  let marks = 0
  try { marks = Object.keys(JSON.parse(b.local[MARKS] || '{}')).length } catch { /* ignore */ }
  return { link: `${NEW_ORIGIN}/${hash}`, prayers: list.length, marks, account: !!b.local[ACCOUNT] }
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
  return { link: `${onOldAddress() ? NEW_ORIGIN : location.origin}/${hash}`, prayers: !!key, locked }
}

async function send(path: string, body: Uint8Array) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(SYNC_URL + path, { method: 'PUT', body: body as BodyInit, headers: { 'Content-Type': 'application/octet-stream' } })
      if (res.ok) return
      const msg = (await res.json().catch(() => ({}))).error
      if (res.status < 500 || attempt >= 2) throw new SyncError(msg || `Sync service error (${res.status})`, res.status)
    } catch (e) {
      if (e instanceof SyncError || attempt >= 2) throw e instanceof SyncError ? e : new SyncError('The connection dropped while sending. Try again.')
    }
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
  }
}

// ---- the new address: taking a move in ------------------------------------------

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
    if (!res?.ok) throw new SyncError('Couldn’t download the move. Check the connection and try again.')
    const plain = await open(key, new Uint8Array(await res.arrayBuffer()), aad(n, chunks)).catch(() => {
      throw new SyncError('This move link is damaged. Copy it again from the old address.')
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

/** Put a move on this device. What came wins over what's here, except that
 *  highlights and notes join, and prayers already here stay. */
export async function applyMove(bundle: Bundle, list: Prayer[]): Promise<MovedIn> {
  for (const [k, v] of Object.entries(bundle.local)) {
    if (!k.startsWith(PREFIX) || SKIP.has(k)) continue
    localStorage.setItem(k, k === MARKS ? mergeMarkText(localStorage.getItem(MARKS), v) : v)
  }
  for (const p of list) if (!(await prayers.get(p.id))) await prayers.put(p)
  if (bundle.prayerKey) await meta.set('key', b64url.decode(bundle.prayerKey))
  if (bundle.accountKey) await meta.set('acct', b64url.decode(bundle.accountKey))
  if (bundle.prayerDeleted?.length) {
    const here = (await meta.get<string[]>('deleted')) ?? []
    await meta.set('deleted', [...new Set([...here, ...bundle.prayerDeleted])])
  }
  let marks = 0
  try { marks = Object.keys(JSON.parse(bundle.local[MARKS] || '{}')).length } catch { /* ignore */ }
  const info: MovedIn = { at: Date.now(), from: bundle.from, marks, prayers: list.length, account: !!bundle.local[ACCOUNT], kind: bundle.kind ?? 'move', prayerKey: !!bundle.prayerKey }
  localStorage.setItem(MOVED_IN, JSON.stringify(info))
  return info
}

export function movedIn(): MovedIn | null {
  try { return JSON.parse(localStorage.getItem(MOVED_IN) || 'null') } catch { return null }
}
