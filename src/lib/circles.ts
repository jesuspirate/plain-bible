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
import { aesKey, b64url, keyCode, open, prayerKey, seal } from './prayerCrypto'
import { api, loadAccount, SYNC_URL, SyncError } from './sync'
import { keepStorage, unlockKey } from './prayerSync'
import { cleanVerse, PrayerVerse } from './prayerVerses'
import { shareLink } from './native'
import { setInCircles } from '../state'
import { Days, fromShared, loadDays, shareable } from './streaks'
import { noteLatest } from './circleNews'

const enc = new TextEncoder(), dec = new TextDecoder()
const CHUNK = 1_000_000
const newId = () => b64url.encode(crypto.getRandomValues(new Uint8Array(12)))

/** What a member shares. Each kind is sealed whole, so new kinds need no
 *  change on the server, and apps that don't know a kind skip it. Reading
 *  together ("read John 3 today") can come later as a kind of its own,
 *  sent only by people who turn it on for themselves. */
/** A verse carries its reference; whoever reads it sees it in their own
 *  Bible (see lib/passage). `text` and `version` are the sender's words,
 *  shown only when the reader's Bibles lack the passage, and `size` is how
 *  many verses the sender's Bible has in that chapter, to notice when the
 *  reader's Bible numbers it differently. */
export type Shared =
  | { k: 'verse' | 'bookmark'; verse: PrayerVerse; version: string; text: string; size?: number; note?: string }
  /** a note of yours: `note` is the note itself, `text` the verses it's on */
  | { k: 'note'; verse: PrayerVerse; version: string; text: string; size?: number; note: string }
  | { k: 'prayer'; ms: number; parts: { ms: number; type: string; size: number }[]; verse?: PrayerVerse; note?: string }

export interface CircleInfo { id: string; name: string; members: number }
/** `streak`: the days they read and prayed, if they show their streaks here. */
export interface Member { mid: string; name: string; streak?: Days }
export interface Reply { id: string; by: string; at: number; text: string }
/** `amenAt`: when each 🙏 was given, by member (missing in feeds kept by older versions). */
export interface FeedItem { id: string; by: string; at: number; body: Shared; chunks: number; amens: string[]; amenAt?: Record<string, number>; replies: Reply[] }
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
  const raw = await lockRaw(code)
  return raw === 'needCode' ? raw : aesKey(raw, 'circle lock v1')
}
async function lockRaw(code?: string): Promise<Uint8Array | 'needCode'> {
  let raw = await meta.get<Uint8Array>('acct')
  if (!raw) {
    // Kept as the account key too, so turning prayer sync off later
    // doesn't lock the circles again.
    const r = (await meta.get<Uint8Array>('key')) ?? await unlockKey(code)
    if (r === 'needCode') return r
    raw = r
    await meta.set('acct', raw)
    keepStorage()
  }
  return raw
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

/** The circles you're in. With `unlock` (a tap, or a typed code) it also
 *  unlocks any this device hasn't seen yet, which can ask for the passkey;
 *  without, those are only counted, so just opening Circles never asks. */
/** `stale`: circles whose copy here was locked with a key no device holds
 *  any more (see startOver); a new invite opens them again. */
export async function listCircles(unlock = false, code?: string): Promise<{ circles: CircleInfo[]; locked: number; stale: number } | 'needCode'> {
  // The passkey goes first, in the same tap (see unlockKey).
  const locking = unlock ? lockKey(code).then(k => ({ k }), (e: Error) => ({ e })) : undefined
  const { circles } = await api<{ circles: { id: string; name: string; wrapped: string; members: number; latest?: number | null }[] }>('/circles', { token: token() })
  noteLatest(circles)
  const raws = await rawKeys()
  let lock: CryptoKey | undefined
  const out: CircleInfo[] = []
  let unlocked = 0, failed = 0, locked = 0
  for (const c of circles) {
    if (!raws[c.id]) {
      if (!locking && !(await meta.get('acct')) && !(await meta.get('key'))) { locked++; continue }
      if (!lock) {
        const r = await (locking ?? lockKey(code).then(k => ({ k }), (e: Error) => ({ e }))) as { k: CryptoKey | 'needCode' } | { e: Error }
        if ('e' in r) throw r.e
        if (r.k === 'needCode') return r.k
        lock = r.k
      }
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
  // None would open: either this device holds some other account's key, or
  // the account started over with a new key and those need a new invite.
  if (failed && !unlocked) {
    const { keyId } = await api<{ keyId: string | null }>('/prayers', { token: token() })
    const raw = await meta.get<Uint8Array>('acct')
    if (!keyId || !raw || (await prayerKey(raw)).id !== keyId) {
      await meta.set('acct', undefined)
      throw new SyncError('Some circles couldn’t be unlocked on this device. Open Circles again to unlock them with your passkey.')
    }
  }
  return { circles: out, locked, stale: failed }
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

/** The invite in a link someone sent, pasted in: its id and secret. */
export function parseInviteLink(s: string): { i: string; k: string } | undefined {
  const m = /[?&]i=([\w-]{8,40})&k=([\w-]{16,40})/.exec(s.trim())
  return m ? { i: m[1], k: m[2] } : undefined
}

export interface Invite { circle: string; name: string; by: string; members: number; already: boolean; raw: Uint8Array }
/** What an invite link opens, before you join. */
export async function readInvite(id: string, secret: string): Promise<Invite> {
  const r = await api<{ circle: string; wrapped: string; name: string; by: string | null; members: number; already: boolean }>(`/circles/invite/${encodeURIComponent(id)}`, { token: loadAccount()?.token })
  const raw = await open(await aesKey(b64url.decode(secret), 'circle invite v1'), b64url.decode(r.wrapped), `invite/${id}`)
    .catch(() => { throw new SyncError('This invite link is incomplete. Ask for it to be sent again.') })
  const key = await circleKey(r.circle, raw)
  const name = await openJson(key, r.name, `${r.circle}/name`).catch(() => 'Circle')
  const by = r.by ? await openJson(key, r.by, `${r.circle}/me`).catch(() => '') : ''
  return { circle: r.circle, name: text(name, 80) || 'Circle', by: text(by, 60), members: r.members, already: r.already, raw }
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

/** An invite to a circle you're already in: it opens the circle on this
 *  device, and where this device holds your key without asking, it also
 *  replaces your copy on the server (one that no device of yours could open
 *  any more, say after starting over). */
export async function openInvited(id: string, invite: Invite, me: string) {
  await meta.set('circle-keys', { ...(await rawKeys()), [invite.circle]: invite.raw })
  if (await meta.get('acct') || await meta.get('key')) {
    const lock = await lockKey()
    const key = await circleKey(invite.circle, invite.raw)
    if (lock !== 'needCode') {
      await api(`/circles/invite/${encodeURIComponent(id)}`, {
        method: 'POST', token: token(), body: {
          wrapped: b64url.encode(await seal(lock, invite.raw, `circle/${invite.circle}`)), me: await sealJson(key, me, `${invite.circle}/me`),
        },
      }).catch(() => {})
    }
  }
  await listCircles().catch(() => {})
}

// ---- joining with a code ----------------------------------------------------------
// A member makes a 6-digit code; the person joining types it, which leaves a
// public key; the member taps Allow and their device seals the circle key to
// it. Guessing a code gets nobody in: the member still has to allow, after
// checking that both screens show the same four digits.

/** The member's side: a code for one person, for 15 minutes. */
export const makeCode = (circle: string) => api<{ code: string; expires: number }>(`/circles/${circle}/code`, { method: 'POST', token: token() })
export const dropCode = (circle: string, code: string) => api(`/circles/${circle}/code/${code}`, { method: 'DELETE', token: token() }).catch(() => {})
/** Who typed the code, once someone has, with the four digits their screen shows. */
export async function codeAsk(circle: string, code: string): Promise<{ label: string; match: string; pub: string } | null> {
  const r = await api<{ pub: string | null; label: string | null }>(`/circles/${circle}/code/${code}`, { token: token() })
  if (!r.pub) return null
  const { matchCode } = await import('./approve')
  return { label: r.label || 'device', match: await matchCode(r.pub), pub: r.pub }
}
export async function allowCode(circle: string, code: string, pub: string) {
  const raw = (await rawKeys())[circle]
  if (!raw) throw new SyncError('This circle isn’t unlocked on this device yet.')
  const { EC, shared } = await import('./approve')
  const pair = await crypto.subtle.generateKey(EC, false, ['deriveBits']) as CryptoKeyPair
  const epk = b64url.encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  const sealed = b64url.encode(await seal(await shared(pair.privateKey, pub, `code ${code}`), raw, `code/${code}`))
  await api(`/circles/${circle}/code/${code}`, { method: 'PUT', token: token(), body: { epk, sealed } })
}

export interface Typed { code: string; pub: string; priv: CryptoKey; match: string }
/** The joining side: type the code. Returns the four digits to compare. */
export async function typeCode(code: string): Promise<Typed> {
  const { EC, deviceLabel, matchCode } = await import('./approve')
  const pair = await crypto.subtle.generateKey(EC, false, ['deriveBits']) as CryptoKeyPair
  const pub = b64url.encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  await api('/circles/code', { method: 'POST', token: token(), body: { code, pub, label: deviceLabel() } })
  return { code, pub, priv: pair.privateKey, match: await matchCode(pub) }
}
export const stopWaiting = (t: Typed) => api(`/circles/code/${t.code}`, { method: 'DELETE', token: token() }).catch(() => {})
/** Once allowed: join, and the circle opens here. Null while still waiting. */
export async function joinWithCode(t: Typed, me: string, code?: string): Promise<CircleInfo | 'needCode' | null> {
  const r = await api<{ circle: string; epk: string | null; sealed: string | null }>(`/circles/code/${t.code}`, { token: token() })
  if (!r.sealed || !r.epk) return null
  const { shared } = await import('./approve')
  const raw = await open(await shared(t.priv, r.epk, `code ${t.code}`), b64url.decode(r.sealed), `code/${t.code}`)
  await meta.set('circle-keys', { ...(await rawKeys()), [r.circle]: raw })
  const lock = await lockKey(code)
  if (lock === 'needCode') return lock
  const key = await circleKey(r.circle, raw)
  await api(`/circles/code/${t.code}/join`, {
    method: 'POST', token: token(), body: {
      wrapped: b64url.encode(await seal(lock, raw, `circle/${r.circle}`)), me: await sealJson(key, me, `${r.circle}/me`),
    },
  })
  const list = await listCircles().catch(() => null)
  return (list && list !== 'needCode' ? list.circles.find(c => c.id === r.circle) : undefined) ?? { id: r.circle, name: 'Circle', members: 0 }
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
  if (x.k === 'verse' || x.k === 'bookmark' || x.k === 'note') {
    const verse = cleanVerse(x.verse)
    if (!verse) return
    const size = Number.isInteger(x.size) && (x.size as number) > 0 ? x.size as number : undefined
    const base = { verse, version: text(x.version, 20), text: text(x.text, 8000), ...(size ? { size } : {}) }
    if (x.k === 'note') return note ? { k: 'note', ...base, note } : undefined
    return { k: x.k, ...base, note }
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
  const r = await api<{
    me: string; members: { mid: string; name: string; streak?: string | null }[]; items: { id: string; mid: string; at: number; body: string; chunks: number }[]
    amens: { item: string; mid: string; at?: number }[]; replies?: { item: string; id: string; mid: string; at: number; body: string }[]
  }>(`/circles/${circle}`, { token: token() })
  const members: Member[] = await Promise.all(r.members.map(async m => ({
    mid: m.mid, name: text(await openJson(key, m.name, `${circle}/me`).catch(() => ''), 60) || 'Someone',
    ...(m.streak ? { streak: fromShared(await openJson(key, m.streak, `${circle}/streak/${m.mid}`).catch(() => undefined)) } : {}),
  })))
  const amens = new Map<string, string[]>(), amenAt = new Map<string, Record<string, number>>()
  for (const a of r.amens) {
    amens.set(a.item, [...(amens.get(a.item) ?? []), a.mid])
    if (a.at) amenAt.set(a.item, { ...amenAt.get(a.item), [a.mid]: a.at })
  }
  const replies = new Map<string, Reply[]>()
  for (const x of r.replies ?? []) {
    const said = text(await openJson(key, x.body, `${circle}/${x.item}/${x.id}`).catch(() => ''), 2000)
    if (said) replies.set(x.item, [...(replies.get(x.item) ?? []), { id: x.id, by: x.mid, at: x.at, text: said }])
  }
  const items: FeedItem[] = []
  for (const i of r.items) {
    const body = cleanShared(await openJson(key, i.body, `${circle}/${i.id}`).catch(() => undefined))
    if (body) items.push({ id: i.id, by: i.mid, at: i.at, body, chunks: i.chunks, amens: amens.get(i.id) ?? [], amenAt: amenAt.get(i.id) ?? {}, replies: replies.get(i.id) ?? [] })
  }
  const feed = { me: r.me, members, items }
  await meta.set(`circle:${circle}`, feed)
  return feed
}

/** What's new for you in a feed since `since`: things others shared, their
 *  replies, and their 🙏 on what you shared. The same rule the server uses
 *  for the dot, so looking at the circle clears it. */
export function newsIn(feed: Feed, since: number) {
  const items = new Map<string, { item: boolean; replies: Set<string>; amens: Set<string> }>()
  let latest = 0
  for (const i of feed.items) {
    const item = i.by !== feed.me && i.at > since
    const replies = new Set(i.replies.filter(r => r.by !== feed.me && r.at > since).map(r => r.id))
    const amens = new Set(i.by === feed.me ? Object.entries(i.amenAt ?? {}).filter(([m, at]) => m !== feed.me && at > since).map(([m]) => m) : [])
    if (i.by !== feed.me) latest = Math.max(latest, i.at)
    for (const r of i.replies) if (r.by !== feed.me) latest = Math.max(latest, r.at)
    if (i.by === feed.me) for (const [m, at] of Object.entries(i.amenAt ?? {})) if (m !== feed.me) latest = Math.max(latest, at)
    if (item || replies.size || amens.size) items.set(i.id, { item, replies, amens })
  }
  return { items, latest }
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

/** Verses as they are, as a bookmark (others can bookmark them too with a
 *  tap), or with one of your notes on them. */
export function shareVerse(circle: string, k: 'verse' | 'bookmark' | 'note', verse: PrayerVerse, version: string, quote: string, note?: string, size?: number) {
  if (k === 'note' && !note) throw new SyncError('That note is empty.')
  const base = { verse, version, text: quote, ...(size ? { size } : {}) }
  return send(circle, k === 'note' ? { k, ...base, note: note! } : { k, ...base, note: note || undefined })
}

/** `standard`: the prayer's verse as everyone numbers it (see versification). */
export async function sharePrayer(circle: string, prayerId: string, note?: string, standard = (v: PrayerVerse) => v) {
  const p = await prayers.get(prayerId)
  if (!p) throw new SyncError('That prayer is no longer on this device.')
  const parts = partsOf(p)
  const audio = new Uint8Array(parts.reduce((n, x) => n + x.audio.byteLength, 0))
  parts.reduce((o, x) => { audio.set(new Uint8Array(x.audio), o); return o + x.audio.byteLength }, 0)
  return send(circle, {
    k: 'prayer', ms: p.ms, verse: p.verse && standard(p.verse), note: note || undefined,
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

// Streaks a circle sees: sealed like everything else. What was last sent
// to each circle is remembered, so nothing is sent twice.
const SENT = 'plain-bible:streak-sent'
const sentStreaks = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(SENT) || '{}') } catch { return {} } }
const keepSent = (s: Record<string, string>) => { try { localStorage.setItem(SENT, JSON.stringify(s)) } catch { /* ignore */ } }

/** Show this circle your streaks (as of now), or stop showing them. `mid`
 *  is your place in the circle, which ties what's sealed to you. */
export async function shareStreak(circle: string, mid: string, on: boolean) {
  const sent = sentStreaks()
  if (!on) {
    await api(`/circles/${circle}/streak`, { method: 'DELETE', token: token() })
    delete sent[circle]
  } else {
    const now = JSON.stringify(shareable(loadDays()))
    const streak = await sealJson(await keyOf(circle), JSON.parse(now), `${circle}/streak/${mid}`)
    await api(`/circles/${circle}/streak`, { method: 'PUT', token: token(), body: { streak } })
    sent[circle] = now
  }
  keepSent(sent)
}

/** Keep the circles that see your streaks up to date: after a day is read
 *  or prayed, and once a day. Sends only what changed. */
export async function pushStreaks(ids: string[]) {
  const now = JSON.stringify(shareable(loadDays()))
  for (const id of ids) {
    if (sentStreaks()[id] === now) continue
    const mid = (await keptFeed(id))?.me ?? (await loadFeed(id)).me
    await shareStreak(id, mid, true)
  }
}

export const amen = (circle: string, item: string, on: boolean) =>
  api(`/circles/${circle}/items/${item}/amen`, { method: on ? 'PUT' : 'DELETE', token: token() })

/** A few words back on something shared. */
export async function reply(circle: string, item: string, said: string) {
  const id = newId()
  await api(`/circles/${circle}/items/${item}/replies/${id}`, { method: 'PUT', token: token(), body: { body: await sealJson(await keyOf(circle), said, `${circle}/${item}/${id}`) } })
}
export const removeReply = (circle: string, item: string, id: string) =>
  api(`/circles/${circle}/items/${item}/replies/${id}`, { method: 'DELETE', token: token() })

export async function removeShared(circle: string, item: string) {
  await api(`/circles/${circle}/items/${item}`, { method: 'DELETE', token: token() })
  await meta.set(`circle-audio:${circle}/${item}`, undefined)
}

/** The account key as a code, for a device whose passkey can't unlock it. */
export async function accountKeyCode() {
  const raw = (await meta.get<Uint8Array>('acct')) ?? (await meta.get<Uint8Array>('key'))
  return raw ? keyCode(raw) : ''
}
