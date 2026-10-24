// Circles: a few people who share verses and prayers with each other. Each
// circle has its own key, known only to its members' devices. Everything
// shared is sealed with it here before it leaves the device, so the server
// only learns who is in a circle and when they share, never what.
//
// Each member keeps the circle key on the server locked with their own
// account key (the same key that encrypts synced prayers), so it follows
// them to their other devices. An invite link carries a secret after the #,
// which browsers never send anywhere, and that secret unlocks the circle key
// for one new member. Loaded only when circles are opened or used.
import { meta, partsOf, prayers } from './prayers'
import { aesKey, b64url, keyCode, open, seal } from './prayerCrypto'
import { api, loadAccount, SYNC_URL, SyncError } from './sync'
import { unlockKey } from './prayerSync'
import { cleanVerse, PrayerVerse } from './prayerVerses'
import { shareLink } from './native'
import { setInCircles } from '../state'

const enc = new TextEncoder(), dec = new TextDecoder()
const CHUNK = 1_000_000
const newId = () => b64url.encode(crypto.getRandomValues(new Uint8Array(12)))

/** What a member shares. Each kind is sealed whole, so new kinds need no
 *  change on the server, and apps that don't know a kind skip it. Reading
 *  together ("read John 3 today") can come later as a kind of its own,
 *  sent only by people who turn it on for themselves. */
export type Shared =
  | { k: 'verse'; verse: PrayerVerse; version: string; text: string; note?: string }
  | { k: 'prayer'; ms: number; parts: { ms: number; type: string; size: number }[]; verse?: PrayerVerse; note?: string }

export interface CircleInfo { id: string; name: string; members: number }
export interface Member { mid: string; name: string }
export interface FeedItem { id: string; by: string; at: number; body: Shared; chunks: number; amens: string[] }
export interface Feed { me: string; members: Member[]; items: FeedItem[] }

function token() {
  const a = loadAccount()
  if (!SYNC_URL || !a) throw new SyncError('Sign in first, under Settings → Account.')
  return a.token
}

// ---- keys ----------------------------------------------------------------------

/** The key that locks this account's copies of circle keys. 'needCode' when
 *  the passkey can't unlock the account key and it has to be typed in. */
async function lockKey(code?: string): Promise<CryptoKey | 'needCode'> {
  let raw = (await meta.get<Uint8Array>('acct')) ?? (await meta.get<Uint8Array>('key'))
  if (!raw) {
    const r = await unlockKey(code)
    if (r === 'needCode') return r
    raw = r
    await meta.set('acct', raw)
  }
  return aesKey(raw, 'circle lock v1')
}

const keys = new Map<string, CryptoKey>()
const circleKey = async (id: string, raw: Uint8Array) => {
  if (!keys.has(id)) keys.set(id, await aesKey(raw, 'circle v1'))
  return keys.get(id)!
}
async function rawKeys() { return (await meta.get<Record<string, Uint8Array>>('circle-keys')) ?? {} }
async function keyOf(id: string) {
  const raw = (await rawKeys())[id]
  if (!raw) throw new SyncError('This circle isn’t unlocked on this device yet. Open Circles to unlock it.')
  return circleKey(id, raw)
}

const sealJson = async (key: CryptoKey, v: unknown, aad: string) => b64url.encode(await seal(key, enc.encode(JSON.stringify(v)), aad))
const openJson = async (key: CryptoKey, s: string, aad: string): Promise<unknown> => JSON.parse(dec.decode(await open(key, b64url.decode(s), aad)))
const text = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : ''

// ---- circles -------------------------------------------------------------------

/** The circles kept from last time, for offline. */
export const keptCircles = async () => (await meta.get<CircleInfo[]>('circles')) ?? []

/** The circles you're in, unlocking any this device hasn't seen yet. */
export async function listCircles(code?: string): Promise<CircleInfo[] | 'needCode'> {
  const { circles } = await api<{ circles: { id: string; name: string; wrapped: string; members: number }[] }>('/circles', { token: token() })
  const raws = await rawKeys()
  let lock: CryptoKey | undefined
  const out: CircleInfo[] = []
  let unlocked = 0, failed = 0
  for (const c of circles) {
    if (!raws[c.id]) {
      if (!lock) { const k = await lockKey(code); if (k === 'needCode') return k; lock = k }
      const raw = await open(lock, b64url.decode(c.wrapped), `circle/${c.id}`).catch(() => undefined)
      // One circle that won't open mustn't hide the others.
      if (!raw) { failed++; continue }
      raws[c.id] = raw
      unlocked++
    }
    const name = await openJson(await circleKey(c.id, raws[c.id]), c.name, `${c.id}/name`).catch(() => 'Circle')
    out.push({ id: c.id, name: text(name, 80) || 'Circle', members: c.members })
  }
  await meta.set('circle-keys', raws)
  await meta.set('circles', out)
  setInCircles(out.length)
  // None would open: this device holds some other account's key.
  if (failed && !unlocked) {
    await meta.set('acct', undefined)
    throw new SyncError('Some circles couldn’t be unlocked on this device. Open Circles again to unlock them with your passkey.')
  }
  return out
}

export async function createCircle(name: string, me: string, code?: string): Promise<string | 'needCode'> {
  const lock = await lockKey(code)
  if (lock === 'needCode') return lock
  const id = newId(), raw = crypto.getRandomValues(new Uint8Array(32))
  const key = await circleKey(id, raw)
  await api('/circles', {
    method: 'POST', token: token(), body: {
      id, name: await sealJson(key, name, `${id}/name`), me: await sealJson(key, me, `${id}/me`),
      wrapped: b64url.encode(await seal(lock, raw, `circle/${id}`)),
    },
  })
  await meta.set('circle-keys', { ...(await rawKeys()), [id]: raw })
  await listCircles().catch(() => {})
  return id
}

/** A link that lets one more person in, for a week. */
export async function inviteLink(circle: string) {
  const raw = (await rawKeys())[circle]
  if (!raw) throw new SyncError('This circle isn’t unlocked on this device yet.')
  const id = newId(), secret = crypto.getRandomValues(new Uint8Array(16))
  const wrapped = b64url.encode(await seal(await aesKey(secret, 'circle invite v1'), raw, `invite/${id}`))
  await api(`/circles/${circle}/invites`, { method: 'POST', token: token(), body: { id, wrapped } })
  return shareLink(`#/join?i=${id}&k=${b64url.encode(secret)}`)
}

export interface Invite { circle: string; name: string; members: number; already: boolean; raw: Uint8Array }
/** What an invite link opens, before you join. */
export async function readInvite(id: string, secret: string): Promise<Invite> {
  const r = await api<{ circle: string; wrapped: string; name: string; members: number; already: boolean }>(`/circles/invite/${encodeURIComponent(id)}`, { token: token() })
  const raw = await open(await aesKey(b64url.decode(secret), 'circle invite v1'), b64url.decode(r.wrapped), `invite/${id}`)
    .catch(() => { throw new SyncError('This invite link is incomplete. Ask for it to be sent again.') })
  const name = await openJson(await circleKey(r.circle, raw), r.name, `${r.circle}/name`).catch(() => 'Circle')
  return { circle: r.circle, name: text(name, 80) || 'Circle', members: r.members, already: r.already, raw }
}

export async function joinCircle(id: string, invite: Invite, me: string, code?: string): Promise<'joined' | 'needCode'> {
  const lock = await lockKey(code)
  if (lock === 'needCode') return lock
  const key = await circleKey(invite.circle, invite.raw)
  await api(`/circles/invite/${encodeURIComponent(id)}`, {
    method: 'POST', token: token(), body: {
      wrapped: b64url.encode(await seal(lock, invite.raw, `circle/${invite.circle}`)), me: await sealJson(key, me, `${invite.circle}/me`),
    },
  })
  await meta.set('circle-keys', { ...(await rawKeys()), [invite.circle]: invite.raw })
  await listCircles().catch(() => {})
  return 'joined'
}

export async function leaveCircle(circle: string) {
  await api(`/circles/${circle}/me`, { method: 'DELETE', token: token() })
  const raws = await rawKeys()
  delete raws[circle]
  await meta.set('circle-keys', raws)
  await meta.set(`circle:${circle}`, undefined)
  const left = (await keptCircles()).filter(c => c.id !== circle)
  await meta.set('circles', left)
  setInCircles(left.length)
}

// ---- what's shared ---------------------------------------------------------------

/** One shared thing as it came off the server, or undefined if it isn't one
 *  this app knows. */
export function cleanShared(v: unknown): Shared | undefined {
  const x = v as Record<string, unknown> | null
  if (!x || typeof x !== 'object') return
  const note = text(x.note, 2000) || undefined
  if (x.k === 'verse') {
    const verse = cleanVerse(x.verse)
    return verse && { k: 'verse', verse, version: text(x.version, 20), text: text(x.text, 8000), note }
  }
  if (x.k === 'prayer' && Array.isArray(x.parts)) {
    const parts = x.parts.filter(p => p && Number.isInteger(p.size) && p.size > 0 && typeof p.type === 'string')
      .map(p => ({ ms: Number(p.ms) || 0, type: text(p.type, 60), size: p.size as number }))
    if (!parts.length) return
    return { k: 'prayer', ms: Number(x.ms) || 0, parts, verse: cleanVerse(x.verse), note }
  }
}

/** The circle as kept from last time, for offline. */
export const keptFeed = (circle: string) => meta.get<Feed>(`circle:${circle}`)

export async function loadFeed(circle: string): Promise<Feed> {
  const key = await keyOf(circle)
  const r = await api<{ me: string; members: { mid: string; name: string }[]; items: { id: string; mid: string; at: number; body: string; chunks: number }[]; amens: { item: string; mid: string }[] }>(`/circles/${circle}`, { token: token() })
  const members = await Promise.all(r.members.map(async m => ({ mid: m.mid, name: text(await openJson(key, m.name, `${circle}/me`).catch(() => ''), 60) || 'Someone' })))
  const amens = new Map<string, string[]>()
  for (const a of r.amens) amens.set(a.item, [...(amens.get(a.item) ?? []), a.mid])
  const items: FeedItem[] = []
  for (const i of r.items) {
    const body = cleanShared(await openJson(key, i.body, `${circle}/${i.id}`).catch(() => undefined))
    if (body) items.push({ id: i.id, by: i.mid, at: i.at, body, chunks: i.chunks, amens: amens.get(i.id) ?? [] })
  }
  const feed = { me: r.me, members, items }
  await meta.set(`circle:${circle}`, feed)
  return feed
}

async function send(circle: string, body: Shared, audio?: Uint8Array) {
  const key = await keyOf(circle), tok = token(), id = newId()
  const sealed = audio && await seal(key, audio, `${circle}/${id}/audio`)
  const chunks = sealed ? Math.ceil(sealed.length / CHUNK) : 0
  await api(`/circles/${circle}/items/${id}`, { method: 'PUT', token: tok, body: { body: await sealJson(key, body, `${circle}/${id}`), chunks, size: sealed?.length ?? 0 } })
  for (let n = 0; n < chunks; n++) {
    const res = await fetch(`${SYNC_URL}/circles/${circle}/items/${id}/${n}`, {
      method: 'PUT', body: sealed!.subarray(n * CHUNK, (n + 1) * CHUNK) as BodyInit,
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/octet-stream' },
    }).catch(() => { throw new SyncError('The connection dropped while sending. Try again.') })
    if (!res.ok) throw new SyncError((await res.json().catch(() => ({}))).error || `Sync service error (${res.status})`, res.status)
  }
  // Your own prayer plays from here without downloading it again.
  if (audio) await meta.set(`circle-audio:${circle}/${id}`, audio.buffer)
  return id
}

export const shareVerse = (circle: string, verse: PrayerVerse, version: string, quote: string, note?: string) =>
  send(circle, { k: 'verse', verse, version, text: quote, note: note || undefined })

export async function sharePrayer(circle: string, prayerId: string, note?: string) {
  const p = await prayers.get(prayerId)
  if (!p) throw new SyncError('That prayer is no longer on this device.')
  const parts = partsOf(p)
  const audio = new Uint8Array(parts.reduce((n, x) => n + x.audio.byteLength, 0))
  parts.reduce((o, x) => { audio.set(new Uint8Array(x.audio), o); return o + x.audio.byteLength }, 0)
  return send(circle, {
    k: 'prayer', ms: p.ms, verse: p.verse, note: note || undefined,
    parts: parts.map(x => ({ ms: x.ms, type: x.type, size: x.audio.byteLength })),
  }, audio)
}

/** A shared prayer's recording, part by part. Kept on the device once heard. */
export async function prayerAudio(circle: string, item: FeedItem): Promise<{ type: string; audio: ArrayBuffer }[]> {
  if (item.body.k !== 'prayer') return []
  const kept = `circle-audio:${circle}/${item.id}`
  let all = await meta.get<ArrayBuffer>(kept)
  if (!all) {
    const tok = token(), pieces: Uint8Array[] = []
    for (let n = 0; n < item.chunks; n++) {
      const res = await fetch(`${SYNC_URL}/circles/${circle}/items/${item.id}/${n}`, { headers: { Authorization: `Bearer ${tok}` } })
        .catch(() => { throw new SyncError('Connect to the internet to hear this prayer the first time.') })
      if (!res.ok) throw new SyncError(`Sync service error (${res.status})`, res.status)
      pieces.push(new Uint8Array(await res.arrayBuffer()))
    }
    const sealed = new Uint8Array(pieces.reduce((s, x) => s + x.length, 0))
    pieces.reduce((o, x) => { sealed.set(x, o); return o + x.length }, 0)
    all = (await open(await keyOf(circle), sealed, `${circle}/${item.id}/audio`)).buffer as ArrayBuffer
    await meta.set(kept, all)
  }
  let o = 0
  return item.body.parts.map(p => ({ type: p.type, audio: all!.slice(o, o += p.size) }))
}

export const amen = (circle: string, item: string, on: boolean) =>
  api(`/circles/${circle}/items/${item}/amen`, { method: on ? 'PUT' : 'DELETE', token: token() })

export async function removeShared(circle: string, item: string) {
  await api(`/circles/${circle}/items/${item}`, { method: 'DELETE', token: token() })
  await meta.set(`circle-audio:${circle}/${item}`, undefined)
}

/** The account key as a code, for a device whose passkey can't unlock it. */
export async function accountKeyCode() {
  const raw = (await meta.get<Uint8Array>('acct')) ?? (await meta.get<Uint8Array>('key'))
  return raw ? keyCode(raw) : ''
}
