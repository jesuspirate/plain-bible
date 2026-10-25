// Quiet Bible sync: accounts you sign in to with a passkey or a code sent by
// email, and one small JSON document per account (highlights, bookmarks,
// settings). No passwords, no tracking, and email addresses are never
// stored, only a fingerprint of them. The app works fully without it.
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

export interface Env {
  DB: D1Database
  RP_ID: string
  RP_NAME: string
  ORIGINS: string
  /** Email sign-in is on when both are set (see EMAIL_FROM). */
  RESEND_API_KEY?: string
  EMAIL_SECRET?: string
  EMAIL_FROM: string
}

const DAY = 86_400_000
const SESSION_DAYS = 365
const CHALLENGE_MS = 5 * 60_000
const MAX_BODY = 2_000_000
// Prayers: encrypted audio, sent in chunks that each fit in a row.
const CHUNK_MAX = 1_100_000
const MAX_CHUNKS = 64
const PRAYER_QUOTA = 300_000_000
// Moves to a new address: a packed, encrypted copy of one device's data.
const MOVE_ID = /^[A-Za-z0-9_-]{22}$/
const MOVE_MAX_CHUNKS = 400
const MOVE_DAYS = 7
// A link that signs another device in lives an hour.
const LINK_HOURS = 1

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: object) { super(message) }
}

// ---------------------------------------------------------------------------
// Encoding and crypto helpers

export const b64url = {
  encode(bytes: Uint8Array): string {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(s: string): Uint8Array<ArrayBuffer> {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
    return Uint8Array.from(bin, c => c.charCodeAt(0))
  },
}
const random = (n: number) => b64url.encode(crypto.getRandomValues(new Uint8Array(n)))
async function sha256(s: string) {
  return b64url.encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
}

// ---------------------------------------------------------------------------
// HTTP plumbing

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  if (!origins(env).includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}
const origins = (env: Env) => env.ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
/** The calling address and its passkey domain. Passkeys belong to one
 *  domain, so the old and new addresses each have their own; both sign in
 *  to the same accounts. */
function site(req: Request, env: Env) {
  const origin = req.headers.get('Origin') ?? ''
  if (!origins(env).includes(origin)) return { origin: origins(env), rpID: env.RP_ID }
  return { origin, rpID: new URL(origin).hostname }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

async function readJson<T>(req: Request): Promise<T> {
  const text = await req.text()
  if (text.length > MAX_BODY) throw new HttpError(413, 'Too large')
  try { return JSON.parse(text) as T } catch { throw new HttpError(400, 'Invalid JSON') }
}

async function session(req: Request, env: Env): Promise<string> {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('Authorization') ?? '')
  if (!m) throw new HttpError(401, 'Not signed in')
  const row = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires > ?')
    .bind(await sha256(m[1]), Date.now()).first<{ user_id: string }>()
  if (!row) throw new HttpError(401, 'Not signed in')
  return row.user_id
}

async function newSession(env: Env, userId: string) {
  const token = random(32), now = Date.now()
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * DAY).run()
  return token
}

async function takeChallenge(env: Env, id: unknown) {
  if (typeof id !== 'string') throw new HttpError(400, 'Missing challenge')
  const row = await env.DB.prepare('DELETE FROM challenges WHERE id = ? RETURNING challenge, user_id, expires')
    .bind(id).first<{ challenge: string; user_id: string | null; expires: number }>()
  if (!row || row.expires < Date.now()) throw new HttpError(400, 'Challenge expired, please try again')
  return row
}

async function saveChallenge(env: Env, challenge: string, userId: string | null) {
  const id = random(16), now = Date.now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM challenges WHERE expires < ?').bind(now),
    env.DB.prepare('INSERT INTO challenges (id, challenge, user_id, expires) VALUES (?, ?, ?, ?)').bind(id, challenge, userId, now + CHALLENGE_MS),
  ])
  return id
}

// ---------------------------------------------------------------------------
// Email sign-in: a 6-digit code to type into the app. A code rather than a
// link, because on iPhone a link opens Safari, not the Home Screen app, and
// the two keep separate storage.

const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/
const CODE_MINUTES = 15
const CODE_TRIES = 5
const SENDS_PER_HOUR = 5
// Resend's free plan sends up to 100 a day.
const SENDS_PER_DAY = 90

const emailOn = (env: Env) => !!(env.RESEND_API_KEY && env.EMAIL_SECRET)
function cleanEmail(v: unknown) {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (e.length > 254 || !EMAIL.test(e)) throw new HttpError(400, 'That doesn’t look like an email address.')
  return e
}
/** A keyed fingerprint, so a copy of the database doesn't reveal addresses. */
async function emailHash(env: Env, email: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.EMAIL_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url.encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(email))))
}
const emailHint = (email: string) => { const [name, domain] = email.split('@'); return `${name[0]}•••@${domain}` }

async function sendCode(env: Env, to: string, code: string) {
  const text = `Your Quiet Bible code is ${code}\n\nType it into the app to sign in. It works for ${CODE_MINUTES} minutes.\n\nIf you didn't ask for it, you can ignore this email.`
  const html = `<div style="font-family:Georgia,serif;font-size:17px;line-height:1.5;color:#3b2f22">
<p>Your Quiet Bible code is</p><p style="font-size:32px;letter-spacing:6px;margin:8px 0 16px"><strong>${code}</strong></p>
<p>Type it into the app to sign in. It works for ${CODE_MINUTES} minutes.</p>
<p style="color:#8a7a66;font-size:14px">If you didn't ask for it, you can ignore this email.</p></div>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: `${code} is your Quiet Bible code`, text, html }),
  }).catch(() => null)
  if (!res?.ok) {
    console.error('email not sent', res?.status, await res?.text().catch(() => ''))
    throw new HttpError(502, 'The email couldn’t be sent. Try again in a few minutes.')
  }
}

async function emailStart(req: Request, env: Env) {
  if (!emailOn(env)) throw new HttpError(404, 'Email sign-in isn’t set up yet.')
  const adding = req.headers.has('Authorization') ? await session(req, env) : null
  const email = cleanEmail((await readJson<{ email: string }>(req)).email)
  const hash = await emailHash(env, email), now = Date.now(), db = env.DB
  const [mine, all] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM email_sends WHERE hash = ? AND at > ?').bind(hash, now - 3_600_000).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM email_sends WHERE at > ?').bind(now - DAY).first<{ n: number }>(),
  ])
  if ((mine?.n ?? 0) >= SENDS_PER_HOUR) throw new HttpError(429, 'Several codes were already sent to this address. Use the newest one, or try again in an hour.')
  if ((all?.n ?? 0) >= SENDS_PER_DAY) throw new HttpError(429, 'Too many sign-in emails today. Please try again tomorrow, or use a passkey.')
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
  await db.batch([
    db.prepare('DELETE FROM email_sends WHERE at < ?').bind(now - DAY),
    db.prepare('DELETE FROM email_codes WHERE expires < ?').bind(now),
    db.prepare('INSERT INTO email_sends (hash, at) VALUES (?, ?)').bind(hash, now),
    db.prepare(`INSERT INTO email_codes (hash, code_hash, user_id, tries, expires) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(hash) DO UPDATE SET code_hash = excluded.code_hash, user_id = excluded.user_id, tries = 0, expires = excluded.expires`)
      .bind(hash, await sha256(`${hash}:${code}`), adding, now + CODE_MINUTES * 60_000),
  ])
  await sendCode(env, email, code)
  return json({ ok: true })
}

async function emailVerify(req: Request, env: Env) {
  if (!emailOn(env)) throw new HttpError(404, 'Email sign-in isn’t set up yet.')
  const body = await readJson<{ email: string; code: string }>(req)
  const email = cleanEmail(body.email), digits = String(body.code ?? '').replace(/\D/g, '')
  const hash = await emailHash(env, email), db = env.DB
  // Each try counts, so the code can't be guessed.
  const row = await db.prepare('UPDATE email_codes SET tries = tries + 1 WHERE hash = ? AND expires > ? RETURNING code_hash, user_id, tries')
    .bind(hash, Date.now()).first<{ code_hash: string; user_id: string | null; tries: number }>()
  const expired = 'That code has expired. Send yourself a new one.'
  if (!row || row.tries > CODE_TRIES) throw new HttpError(400, expired)
  if (digits.length !== 6 || await sha256(`${hash}:${digits}`) !== row.code_hash) {
    throw new HttpError(400, row.tries >= CODE_TRIES ? expired : 'That code isn’t right. Check the newest email and try again.')
  }
  await db.prepare('DELETE FROM email_codes WHERE hash = ?').bind(hash).run()
  const owner = await db.prepare('SELECT user_id FROM emails WHERE hash = ?').bind(hash).first<{ user_id: string }>()
  const hint = emailHint(email), now = Date.now()
  // Adding (or changing) the address of the signed-in account.
  if (row.user_id) {
    if (await session(req, env) !== row.user_id) throw new HttpError(400, expired)
    if (owner && owner.user_id !== row.user_id) throw new HttpError(409, 'This email already signs in to another Quiet Bible account.')
    await db.batch([
      db.prepare('DELETE FROM emails WHERE user_id = ?').bind(row.user_id),
      db.prepare('INSERT INTO emails (hash, user_id, hint, created) VALUES (?, ?, ?, ?)').bind(hash, row.user_id, hint, now),
    ])
    return json({ added: true, email: hint })
  }
  if (owner) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').bind(owner.user_id).first<{ n: number }>()
    return json({ token: await newSession(env, owner.user_id), passkeys: n?.n ?? 0 })
  }
  // An address not seen before makes a new account.
  const userId = random(16)
  await db.batch([
    db.prepare('INSERT INTO users (id, created) VALUES (?, ?)').bind(userId, now),
    db.prepare('INSERT INTO emails (hash, user_id, hint, created) VALUES (?, ?, ?, ?)').bind(hash, userId, hint, now),
  ])
  return json({ token: await newSession(env, userId), created: true, passkeys: 0 })
}

// ---------------------------------------------------------------------------
// Routes

// Prayer sync. The app encrypts each recording with a key only the user's
// devices hold, so all of this is opaque bytes plus ids and sizes.
const PRAYER_ID = /^[a-z0-9]{4,40}$/
const bytes = (v: unknown) => v instanceof ArrayBuffer ? v : new Uint8Array(v as number[]).buffer

async function prayerRoute(req: Request, env: Env, parts: string[]): Promise<Response> {
  const userId = await session(req, env)
  const db = env.DB
  const [a, b, c] = parts
  // Everything there is, so a device can see what it is missing.
  if (req.method === 'GET' && !a) {
    const [key, list, gone] = await Promise.all([
      db.prepare('SELECT key_id FROM prayer_keys WHERE user_id = ?').bind(userId).first<{ key_id: string }>(),
      db.prepare('SELECT prayer, part, chunks, size FROM prayer_parts WHERE user_id = ? ORDER BY prayer, part').bind(userId).all(),
      db.prepare('SELECT prayer FROM prayer_gone WHERE user_id = ?').bind(userId).all<{ prayer: string }>(),
    ])
    // Passkeys: an account signed in only by email has none to unlock the key with.
    const passkeys = await db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').bind(userId).first<{ n: number }>()
    return json({ keyId: key?.key_id ?? null, passkeys: passkeys?.n ?? 0, parts: list.results, gone: gone.results.map(r => r.prayer) })
  }
  // The key's fingerprint is set once, by the first device to turn sync on.
  if (a === 'key' && !b && req.method === 'PUT') {
    const { keyId } = await readJson<{ keyId: string }>(req)
    if (typeof keyId !== 'string' || !/^[\w-]{8,64}$/.test(keyId)) throw new HttpError(400, 'Bad key id')
    await db.prepare('INSERT INTO prayer_keys (user_id, key_id, created) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING').bind(userId, keyId, Date.now()).run()
    const cur = await db.prepare('SELECT key_id FROM prayer_keys WHERE user_id = ?').bind(userId).first<{ key_id: string }>()
    if (cur?.key_id !== keyId) throw new HttpError(409, 'This account already has a prayer key', { keyId: cur?.key_id })
    return json({ ok: true })
  }
  // Starting over with a new key, when no device of theirs holds the old one.
  // What the old key locked can't be opened by anyone any more, so it goes:
  // the synced prayers and the passkeys' copies of the old key. Circles stay;
  // each needs a new invite to open with the new key (see the invite join).
  if (a === 'key' && b === 'new' && !c && req.method === 'POST') {
    const { keyId } = await readJson<{ keyId: string }>(req)
    if (typeof keyId !== 'string' || !/^[\w-]{8,64}$/.test(keyId)) throw new HttpError(400, 'Bad key id')
    await db.batch([
      db.prepare('INSERT INTO prayer_keys (user_id, key_id, created) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET key_id = excluded.key_id, created = excluded.created')
        .bind(userId, keyId, Date.now()),
      db.prepare('DELETE FROM prayer_wraps WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM prayer_chunks WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM prayer_parts WHERE user_id = ?').bind(userId),
    ])
    return json({ ok: true })
  }
  // The key wrapped for one passkey.
  if (a === 'wrap' && b && !c) {
    if (req.method === 'GET') {
      const row = await db.prepare('SELECT wrapped FROM prayer_wraps WHERE cred_id = ? AND user_id = ?').bind(b, userId).first<{ wrapped: string }>()
      if (!row) throw new HttpError(404, 'No key for this passkey')
      return json({ wrapped: row.wrapped })
    }
    if (req.method === 'PUT') {
      const { wrapped } = await readJson<{ wrapped: string }>(req)
      if (typeof wrapped !== 'string' || wrapped.length > 500) throw new HttpError(400, 'Bad request')
      const cred = await db.prepare('SELECT 1 FROM credentials WHERE id = ? AND user_id = ?').bind(b, userId).first()
      if (!cred) throw new HttpError(404, 'Not your passkey')
      await db.prepare('INSERT INTO prayer_wraps (cred_id, user_id, wrapped, created) VALUES (?, ?, ?, ?) ON CONFLICT(cred_id) DO UPDATE SET wrapped = excluded.wrapped')
        .bind(b, userId, wrapped, Date.now()).run()
      return json({ ok: true })
    }
  }
  if (!a || !PRAYER_ID.test(a)) throw new HttpError(404, 'Not found')
  // Deleting a prayer deletes it on every device.
  if (req.method === 'DELETE' && !b) {
    await db.batch([
      db.prepare('DELETE FROM prayer_chunks WHERE user_id = ? AND prayer = ?').bind(userId, a),
      db.prepare('DELETE FROM prayer_parts WHERE user_id = ? AND prayer = ?').bind(userId, a),
      db.prepare('INSERT INTO prayer_gone (user_id, prayer, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(userId, a, Date.now()),
    ])
    return json({ ok: true })
  }
  const part = Number(b), n = Number(c)
  if (!Number.isInteger(part) || part < 0 || part > 999 || !Number.isInteger(n) || n < 0 || n >= MAX_CHUNKS) throw new HttpError(404, 'Not found')
  if (req.method === 'GET') {
    const row = await db.prepare('SELECT data FROM prayer_chunks WHERE user_id = ? AND prayer = ? AND part = ? AND n = ?').bind(userId, a, part, n).first<{ data: unknown }>()
    if (!row) throw new HttpError(404, 'Not found')
    return new Response(bytes(row.data), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } })
  }
  if (req.method === 'PUT') {
    const of = Number(new URL(req.url).searchParams.get('of'))
    if (!Number.isInteger(of) || of < 1 || of > MAX_CHUNKS || n >= of) throw new HttpError(400, 'Bad chunk')
    const data = await req.arrayBuffer()
    if (!data.byteLength || data.byteLength > CHUNK_MAX) throw new HttpError(413, 'Chunk too large')
    if (await db.prepare('SELECT 1 FROM prayer_gone WHERE user_id = ? AND prayer = ?').bind(userId, a).first()) throw new HttpError(410, 'Deleted')
    const used = await db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM prayer_parts WHERE user_id = ?').bind(userId).first<{ n: number }>()
    if ((used?.n ?? 0) + data.byteLength > PRAYER_QUOTA) throw new HttpError(413, 'Your synced prayers have reached the storage limit')
    await db.prepare('INSERT INTO prayer_chunks (user_id, prayer, part, n, of, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET of = excluded.of, data = excluded.data')
      .bind(userId, a, part, n, of, data).run()
    // The part is listed once all its chunks are in.
    const have = await db.prepare('SELECT COUNT(*) AS c, SUM(LENGTH(data)) AS size FROM prayer_chunks WHERE user_id = ? AND prayer = ? AND part = ? AND of = ?')
      .bind(userId, a, part, of).first<{ c: number; size: number }>()
    if (have?.c === of) {
      await db.prepare('INSERT INTO prayer_parts (user_id, prayer, part, chunks, size, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET chunks = excluded.chunks, size = excluded.size')
        .bind(userId, a, part, of, have.size, Date.now()).run()
    }
    return json({ ok: true, complete: have?.c === of })
  }
  throw new HttpError(404, 'Not found')
}

// A move to a new address. Anyone may leave one (the app works without an
// account); it is encrypted on the device, kept a few days, and found only
// by its random id, which travels in the move link with the key.
async function moveRoute(req: Request, env: Env, parts: string[]): Promise<Response> {
  const db = env.DB
  const [id, n0] = parts
  if (req.method === 'POST' && !id) {
    await db.prepare('DELETE FROM moves WHERE expires < ?').bind(Date.now()).run()
    return json({ id: random(16) })
  }
  if (!id || !MOVE_ID.test(id)) throw new HttpError(404, 'Not found')
  if (req.method === 'GET' && n0 === undefined) {
    const row = await db.prepare('SELECT COUNT(*) AS c, MAX(of) AS of FROM moves WHERE id = ? AND expires > ?').bind(id, Date.now()).first<{ c: number; of: number | null }>()
    if (!row?.c || row.c !== row.of) throw new HttpError(404, 'This move link has expired or was never finished. Make a new one on the old address.')
    return json({ chunks: row.of })
  }
  if (req.method === 'DELETE' && n0 === undefined) {
    await db.prepare('DELETE FROM moves WHERE id = ?').bind(id).run()
    return json({ ok: true })
  }
  const n = Number(n0)
  if (!Number.isInteger(n) || n < 0 || n >= MOVE_MAX_CHUNKS) throw new HttpError(404, 'Not found')
  if (req.method === 'GET') {
    const row = await db.prepare('SELECT data FROM moves WHERE id = ? AND n = ? AND expires > ?').bind(id, n, Date.now()).first<{ data: unknown }>()
    if (!row) throw new HttpError(404, 'Not found')
    return new Response(bytes(row.data), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } })
  }
  if (req.method === 'PUT') {
    const of = Number(new URL(req.url).searchParams.get('of'))
    if (!Number.isInteger(of) || of < 1 || of > MOVE_MAX_CHUNKS || n >= of) throw new HttpError(400, 'Bad chunk')
    const data = await req.arrayBuffer()
    if (!data.byteLength || data.byteLength > CHUNK_MAX) throw new HttpError(413, 'Chunk too large')
    const life = new URL(req.url).searchParams.get('life') === 'link' ? LINK_HOURS * 3_600_000 : MOVE_DAYS * DAY
    await db.prepare('INSERT INTO moves (id, n, of, data, expires) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET of = excluded.of, data = excluded.data')
      .bind(id, n, of, data, Date.now() + life).run()
    return json({ ok: true })
  }
  throw new HttpError(404, 'Not found')
}

// Circles. Members share verses and prayers, each sealed with the circle's
// key on the device; here they're opaque text and bytes, plus who and when.
const CIRCLE_ID = /^[\w-]{8,40}$/
const SEALED_MAX = 20_000
const CIRCLE_QUOTA = 1_000_000_000
const MAX_CIRCLES = 20
const MAX_MEMBERS = 50
const INVITE_DAYS = 7
const sealedText = (v: unknown, max = SEALED_MAX) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[\w-]+$/.test(v)

/** The member's row in the circle, or 404 (not 403: a stranger can't tell
 *  whether the circle exists). */
async function membership(db: D1Database, circle: string, userId: string) {
  const row = await db.prepare('SELECT mid FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(circle, userId).first<{ mid: string }>()
  if (!row) throw new HttpError(404, 'Not found')
  return row.mid
}

/** Take a member out, with what they shared. The last one out closes the circle. */
function leaveCircle(db: D1Database, circle: string, userId: string) {
  const mine = 'SELECT id FROM circle_items WHERE circle_id = ?1 AND user_id = ?2'
  return [
    db.prepare(`DELETE FROM circle_chunks WHERE circle_id = ?1 AND item IN (${mine})`).bind(circle, userId),
    db.prepare(`DELETE FROM circle_amens WHERE circle_id = ?1 AND (user_id = ?2 OR item IN (${mine}))`).bind(circle, userId),
    db.prepare(`DELETE FROM circle_replies WHERE circle_id = ?1 AND (user_id = ?2 OR item IN (${mine}))`).bind(circle, userId),
    db.prepare('DELETE FROM circle_items WHERE circle_id = ?1 AND user_id = ?2').bind(circle, userId),
    db.prepare('DELETE FROM circle_invites WHERE circle_id = ?1 AND user_id = ?2').bind(circle, userId),
    db.prepare('DELETE FROM circle_members WHERE circle_id = ?1 AND user_id = ?2').bind(circle, userId),
    ...['circle_chunks', 'circle_amens', 'circle_replies', 'circle_items', 'circle_invites'].map(t =>
      db.prepare(`DELETE FROM ${t} WHERE circle_id = ?1 AND NOT EXISTS (SELECT 1 FROM circle_members WHERE circle_id = ?1)`).bind(circle)),
    db.prepare('DELETE FROM circles WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM circle_members WHERE circle_id = ?1)').bind(circle),
  ]
}

async function circleRoute(req: Request, env: Env, parts: string[]): Promise<Response> {
  const db = env.DB, now = Date.now()
  const [a, b, c, d, e] = parts
  // Looking at an invite needs no account yet, so the link can say who it's
  // from before asking you to make one. It's sealed: the link's secret opens it.
  const looking = a === 'invite' && b && !c && req.method === 'GET'
  const userId = looking ? await session(req, env).catch(() => '') : await session(req, env)

  // The circles you're in, with your locked copy of each key, and when
  // someone else last shared, replied, or prayed with something of yours
  // (so the app can show a quiet dot; it says nothing of what).
  if (req.method === 'GET' && !a) {
    const rows = await db.prepare(`SELECT c.id, c.name, m.mid, m.wrapped, (SELECT COUNT(*) FROM circle_members x WHERE x.circle_id = c.id) AS members,
      MAX(COALESCE((SELECT MAX(at) FROM circle_items i WHERE i.circle_id = c.id AND i.user_id != m.user_id), 0),
        COALESCE((SELECT MAX(at) FROM circle_replies r WHERE r.circle_id = c.id AND r.user_id != m.user_id), 0),
        COALESCE((SELECT MAX(a.at) FROM circle_amens a JOIN circle_items i ON i.circle_id = a.circle_id AND i.id = a.item
          WHERE a.circle_id = c.id AND a.user_id != m.user_id AND i.user_id = m.user_id), 0)) AS latest
      FROM circle_members m JOIN circles c ON c.id = m.circle_id WHERE m.user_id = ? ORDER BY m.joined`).bind(userId).all()
    return json({ circles: rows.results })
  }
  if (req.method === 'POST' && !a) {
    const { id, name, wrapped, me } = await readJson<{ id: string; name: string; wrapped: string; me: string }>(req)
    if (typeof id !== 'string' || !CIRCLE_ID.test(id) || !sealedText(name, 2000) || !sealedText(wrapped, 500) || !sealedText(me, 2000)) throw new HttpError(400, 'Bad request')
    const n = await db.prepare('SELECT COUNT(*) AS n FROM circle_members WHERE user_id = ?').bind(userId).first<{ n: number }>()
    if ((n?.n ?? 0) >= MAX_CIRCLES) throw new HttpError(413, `You can be in up to ${MAX_CIRCLES} circles`)
    if (await db.prepare('SELECT 1 FROM circles WHERE id = ?').bind(id).first()) throw new HttpError(409, 'Try again')
    await db.batch([
      db.prepare('INSERT INTO circles (id, name, created) VALUES (?, ?, ?)').bind(id, name, now),
      db.prepare('INSERT INTO circle_members (circle_id, user_id, mid, wrapped, name, joined) VALUES (?, ?, ?, ?, ?, ?)').bind(id, userId, random(9), wrapped, me, now),
    ])
    return json({ ok: true })
  }

  // Invites. Anyone signed in who has the link can look, and join once.
  if (a === 'invite' && b && !c) {
    if (!CIRCLE_ID.test(b)) throw new HttpError(404, 'Not found')
    const inv = await db.prepare(`SELECT i.circle_id, i.wrapped, c.name, m.name AS by_name, (SELECT COUNT(*) FROM circle_members x WHERE x.circle_id = i.circle_id) AS members
      FROM circle_invites i JOIN circles c ON c.id = i.circle_id LEFT JOIN circle_members m ON m.circle_id = i.circle_id AND m.user_id = i.user_id
      WHERE i.id = ? AND i.expires > ?`).bind(b, now)
      .first<{ circle_id: string; wrapped: string; name: string; by_name: string | null; members: number }>()
    if (!inv) throw new HttpError(404, 'This invite has been used or has expired. Ask for a new one.')
    const already = !!userId && !!(await db.prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(inv.circle_id, userId).first())
    if (req.method === 'GET') return json({ circle: inv.circle_id, wrapped: inv.wrapped, name: inv.name, by: inv.by_name, members: inv.members, already })
    if (req.method === 'POST' && userId) {
      const { wrapped, me } = await readJson<{ wrapped: string; me: string }>(req)
      // Already in: a new invite replaces your locked copy of the circle key,
      // for someone whose old copy no device of theirs can open any more.
      if (already) {
        if (!sealedText(wrapped, 500)) return json({ ok: true, circle: inv.circle_id })
        const taken = await db.prepare('DELETE FROM circle_invites WHERE id = ? AND expires > ? RETURNING circle_id').bind(b, now).first()
        if (!taken) throw new HttpError(404, 'This invite has been used or has expired. Ask for a new one.')
        await db.prepare('UPDATE circle_members SET wrapped = ? WHERE circle_id = ? AND user_id = ?').bind(wrapped, inv.circle_id, userId).run()
        return json({ ok: true, circle: inv.circle_id })
      }
      if (!sealedText(wrapped, 500) || !sealedText(me, 2000)) throw new HttpError(400, 'Bad request')
      if (inv.members >= MAX_MEMBERS) throw new HttpError(413, `A circle can have up to ${MAX_MEMBERS} people`)
      const n = await db.prepare('SELECT COUNT(*) AS n FROM circle_members WHERE user_id = ?').bind(userId).first<{ n: number }>()
      if ((n?.n ?? 0) >= MAX_CIRCLES) throw new HttpError(413, `You can be in up to ${MAX_CIRCLES} circles`)
      // Used up in the same step as joining, so one link can't let in two people.
      const taken = await db.prepare('DELETE FROM circle_invites WHERE id = ? AND expires > ? RETURNING circle_id').bind(b, now).first()
      if (!taken) throw new HttpError(404, 'This invite has been used or has expired. Ask for a new one.')
      await db.prepare('INSERT INTO circle_members (circle_id, user_id, mid, wrapped, name, joined) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .bind(inv.circle_id, userId, random(9), wrapped, me, now).run()
      return json({ ok: true, circle: inv.circle_id })
    }
  }

  if (!a || !CIRCLE_ID.test(a)) throw new HttpError(404, 'Not found')
  const circle = a
  const mid = await membership(db, circle, userId)

  // Who's in it and what's been shared, newest first.
  if (req.method === 'GET' && !b) {
    const [members, items, amens, replies] = await Promise.all([
      db.prepare('SELECT mid, name, streak FROM circle_members WHERE circle_id = ? ORDER BY joined').bind(circle).all(),
      db.prepare(`SELECT i.id, m.mid, i.at, i.body, i.chunks, i.size FROM circle_items i JOIN circle_members m ON m.circle_id = i.circle_id AND m.user_id = i.user_id
        WHERE i.circle_id = ?1 AND (i.chunks = 0 OR i.chunks = (SELECT COUNT(*) FROM circle_chunks k WHERE k.circle_id = ?1 AND k.item = i.id))
        ORDER BY i.at DESC LIMIT 300`).bind(circle).all(),
      db.prepare(`SELECT a.item, m.mid, a.at FROM circle_amens a JOIN circle_members m ON m.circle_id = a.circle_id AND m.user_id = a.user_id
        WHERE a.circle_id = ? ORDER BY a.at`).bind(circle).all<{ item: string; mid: string; at: number }>(),
      db.prepare(`SELECT r.item, r.id, m.mid, r.at, r.body FROM circle_replies r JOIN circle_members m ON m.circle_id = r.circle_id AND m.user_id = r.user_id
        WHERE r.circle_id = ? ORDER BY r.at`).bind(circle).all(),
    ])
    return json({ me: mid, members: members.results, items: items.results, amens: amens.results, replies: replies.results })
  }
  // Your name in this circle.
  if (b === 'me' && !c) {
    if (req.method === 'PUT') {
      const { me } = await readJson<{ me: string }>(req)
      if (!sealedText(me, 2000)) throw new HttpError(400, 'Bad request')
      await db.prepare('UPDATE circle_members SET name = ? WHERE circle_id = ? AND user_id = ?').bind(me, circle, userId).run()
      return json({ ok: true })
    }
    if (req.method === 'DELETE') { await db.batch(leaveCircle(db, circle, userId)); return json({ ok: true }) }
  }
  // Your streaks, for this circle to see, if you turned that on.
  if (b === 'streak' && !c) {
    if (req.method === 'PUT') {
      const { streak } = await readJson<{ streak: string }>(req)
      if (!sealedText(streak, 12000)) throw new HttpError(400, 'Bad request')
      await db.prepare('UPDATE circle_members SET streak = ?, streak_at = ? WHERE circle_id = ? AND user_id = ?').bind(streak, now, circle, userId).run()
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      await db.prepare('UPDATE circle_members SET streak = NULL, streak_at = NULL WHERE circle_id = ? AND user_id = ?').bind(circle, userId).run()
      return json({ ok: true })
    }
  }
  if (b === 'invites' && !c && req.method === 'POST') {
    const { id, wrapped } = await readJson<{ id: string; wrapped: string }>(req)
    if (typeof id !== 'string' || !CIRCLE_ID.test(id) || !sealedText(wrapped, 500)) throw new HttpError(400, 'Bad request')
    const open = await db.prepare('SELECT COUNT(*) AS n FROM circle_invites WHERE circle_id = ? AND expires > ?').bind(circle, now).first<{ n: number }>()
    if ((open?.n ?? 0) >= 20) throw new HttpError(413, 'Too many unused invites. Try again in a few days.')
    await db.batch([
      db.prepare('DELETE FROM circle_invites WHERE expires < ?').bind(now),
      db.prepare('INSERT INTO circle_invites (id, circle_id, user_id, wrapped, expires) VALUES (?, ?, ?, ?, ?)').bind(id, circle, userId, wrapped, now + INVITE_DAYS * DAY),
    ])
    return json({ ok: true, expires: now + INVITE_DAYS * DAY })
  }
  if (b !== 'items' || !c || !CIRCLE_ID.test(c)) throw new HttpError(404, 'Not found')
  const item = c
  const own = () => db.prepare('SELECT chunks FROM circle_items WHERE circle_id = ? AND id = ? AND user_id = ?').bind(circle, item, userId).first<{ chunks: number }>()

  if (!d) {
    if (req.method === 'PUT') {
      const { body, chunks, size } = await readJson<{ body: string; chunks: number; size: number }>(req)
      if (!sealedText(body) || !Number.isInteger(chunks) || chunks < 0 || chunks > MAX_CHUNKS || !Number.isInteger(size) || size < 0 || size > MAX_CHUNKS * CHUNK_MAX) throw new HttpError(400, 'Bad request')
      const used = await db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM circle_items WHERE circle_id = ?').bind(circle).first<{ n: number }>()
      if ((used?.n ?? 0) + size > CIRCLE_QUOTA) throw new HttpError(413, 'This circle is full. Delete some older prayers to make room.')
      const res = await db.prepare('INSERT INTO circle_items (circle_id, id, user_id, at, body, chunks, size) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .bind(circle, item, userId, now, body, chunks, size).run()
      if (!res.meta.changes && !(await own())) throw new HttpError(409, 'Try again')
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      if (!(await own())) throw new HttpError(404, 'Not found')
      await db.batch(['circle_chunks', 'circle_amens', 'circle_replies'].map(t => db.prepare(`DELETE FROM ${t} WHERE circle_id = ? AND item = ?`).bind(circle, item)).concat(
        db.prepare('DELETE FROM circle_items WHERE circle_id = ? AND id = ?').bind(circle, item)))
      return json({ ok: true })
    }
  }
  // Replies: anyone in the circle may write one; only its writer removes it.
  if (d === 'replies' && e && CIRCLE_ID.test(e)) {
    if (req.method === 'PUT') {
      const { body } = await readJson<{ body: string }>(req)
      if (!sealedText(body, 6000)) throw new HttpError(400, 'Bad request')
      if (!(await db.prepare('SELECT 1 FROM circle_items WHERE circle_id = ? AND id = ?').bind(circle, item).first())) throw new HttpError(404, 'Not found')
      const n = await db.prepare('SELECT COUNT(*) AS n FROM circle_replies WHERE circle_id = ? AND item = ?').bind(circle, item).first<{ n: number }>()
      if ((n?.n ?? 0) >= 200) throw new HttpError(413, 'This has as many replies as it can hold')
      await db.prepare('INSERT INTO circle_replies (circle_id, item, id, user_id, at, body) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(circle, item, e, userId, now, body).run()
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      await db.prepare('DELETE FROM circle_replies WHERE circle_id = ? AND item = ? AND id = ? AND user_id = ?').bind(circle, item, e, userId).run()
      return json({ ok: true })
    }
  }
  if (d === 'amen' && !e) {
    if (req.method === 'PUT') {
      if (!(await db.prepare('SELECT 1 FROM circle_items WHERE circle_id = ? AND id = ?').bind(circle, item).first())) throw new HttpError(404, 'Not found')
      await db.prepare('INSERT INTO circle_amens (circle_id, item, user_id, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(circle, item, userId, now).run()
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      await db.prepare('DELETE FROM circle_amens WHERE circle_id = ? AND item = ? AND user_id = ?').bind(circle, item, userId).run()
      return json({ ok: true })
    }
  }
  // A prayer's sealed audio, one chunk at a time.
  const n = Number(d)
  if (!d || e || !Number.isInteger(n) || n < 0 || n >= MAX_CHUNKS) throw new HttpError(404, 'Not found')
  if (req.method === 'GET') {
    const row = await db.prepare('SELECT data FROM circle_chunks WHERE circle_id = ? AND item = ? AND n = ?').bind(circle, item, n).first<{ data: unknown }>()
    if (!row) throw new HttpError(404, 'Not found')
    return new Response(bytes(row.data), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } })
  }
  if (req.method === 'PUT') {
    const it = await own()
    if (!it || n >= it.chunks) throw new HttpError(404, 'Not found')
    const data = await req.arrayBuffer()
    if (!data.byteLength || data.byteLength > CHUNK_MAX) throw new HttpError(413, 'Chunk too large')
    await db.prepare('INSERT INTO circle_chunks (circle_id, item, n, data) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET data = excluded.data').bind(circle, item, n, data).run()
    return json({ ok: true })
  }
  throw new HttpError(404, 'Not found')
}

// A new device asking for the account key, and a device that holds it
// passing it on, sealed to the new one's public key.
const APPROVE_ID = /^[\w-]{16,40}$/
async function approveRoute(req: Request, env: Env, parts: string[]): Promise<Response> {
  const userId = await session(req, env)
  const db = env.DB, now = Date.now()
  const [id] = parts
  if (!id) {
    if (req.method === 'GET') {
      const rows = await db.prepare('SELECT id, pub, label, created AS at FROM approvals WHERE user_id = ? AND sealed IS NULL AND expires > ? ORDER BY created')
        .bind(userId, now).all()
      return json({ requests: rows.results })
    }
    if (req.method === 'POST') {
      const { pub, label } = await readJson<{ pub: string; label: string }>(req)
      if (!sealedText(pub, 200) || typeof label !== 'string' || label.length > 60) throw new HttpError(400, 'Bad request')
      const open = await db.prepare('SELECT COUNT(*) AS n FROM approvals WHERE user_id = ? AND expires > ?').bind(userId, now).first<{ n: number }>()
      if ((open?.n ?? 0) >= 5) throw new HttpError(429, 'Too many devices waiting. Try again tomorrow.')
      const rid = random(16)
      await db.batch([
        db.prepare('DELETE FROM approvals WHERE expires < ?').bind(now),
        db.prepare('INSERT INTO approvals (id, user_id, pub, label, created, expires) VALUES (?, ?, ?, ?, ?, ?)').bind(rid, userId, pub, label, now, now + DAY),
      ])
      return json({ id: rid })
    }
  }
  if (!id || !APPROVE_ID.test(id) || parts.length > 1) throw new HttpError(404, 'Not found')
  if (req.method === 'GET') {
    const row = await db.prepare('SELECT epk, sealed FROM approvals WHERE id = ? AND user_id = ? AND expires > ?').bind(id, userId, now).first<{ epk: string | null; sealed: string | null }>()
    if (!row) throw new HttpError(404, 'This request has expired. Ask again.')
    return json(row)
  }
  if (req.method === 'PUT') {
    const { epk, sealed } = await readJson<{ epk: string; sealed: string }>(req)
    if (!sealedText(epk, 200) || !sealedText(sealed, 500)) throw new HttpError(400, 'Bad request')
    const res = await db.prepare('UPDATE approvals SET epk = ?, sealed = ? WHERE id = ? AND user_id = ? AND sealed IS NULL AND expires > ?').bind(epk, sealed, id, userId, now).run()
    if (!res.meta.changes) throw new HttpError(404, 'That device stopped waiting. Ask it to try again.')
    return json({ ok: true })
  }
  if (req.method === 'DELETE') {
    await db.prepare('DELETE FROM approvals WHERE id = ? AND user_id = ?').bind(id, userId).run()
    return json({ ok: true })
  }
  throw new HttpError(404, 'Not found')
}

async function route(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url)
  const key = `${req.method} ${pathname}`
  const { origin, rpID } = site(req, env)
  if (pathname === '/move' || pathname.startsWith('/move/')) {
    return moveRoute(req, env, pathname.split('/').slice(2).filter(Boolean))
  }
  if (pathname === '/prayers' || pathname.startsWith('/prayers/')) {
    return prayerRoute(req, env, pathname.split('/').slice(2).filter(Boolean).map(decodeURIComponent))
  }
  if (pathname === '/approve' || pathname.startsWith('/approve/')) {
    return approveRoute(req, env, pathname.split('/').slice(2).filter(Boolean))
  }
  if (pathname === '/circles' || pathname.startsWith('/circles/')) {
    return circleRoute(req, env, pathname.split('/').slice(2).filter(Boolean).map(decodeURIComponent))
  }

  switch (key) {
    case 'GET /': return json({ service: 'plain-bible-sync', ok: true, email: emailOn(env) })

    // Sign in (or sign up) with a code sent by email, or add an email to
    // the signed-in account.
    case 'POST /auth/email/start': return emailStart(req, env)
    case 'POST /auth/email/verify': return emailVerify(req, env)
    case 'DELETE /auth/email': {
      const userId = await session(req, env)
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').bind(userId).first<{ n: number }>()
      if (!n?.n) throw new HttpError(400, 'Add a passkey first. Without your email or a passkey, you couldn’t sign in again.')
      await env.DB.prepare('DELETE FROM emails WHERE user_id = ?').bind(userId).run()
      return json({ ok: true })
    }

    // Create an account, or add another passkey to the signed-in account.
    case 'POST /auth/register/options': {
      const existing = req.headers.has('Authorization') ? await session(req, env) : null
      const userId = existing ?? random(16)
      const creds = existing
        ? (await env.DB.prepare('SELECT id, transports FROM credentials WHERE user_id = ?').bind(existing).all<{ id: string; transports: string | null }>()).results
        : []
      const options = await generateRegistrationOptions({
        rpName: env.RP_NAME, rpID,
        userID: b64url.decode(userId),
        userName: env.RP_NAME,
        userDisplayName: env.RP_NAME,
        attestationType: 'none',
        excludeCredentials: creds.map(c => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      })
      const challengeId = await saveChallenge(env, options.challenge, userId)
      return json({ challengeId, options })
    }

    case 'POST /auth/register/verify': {
      const body = await readJson<{ challengeId: string; response: RegistrationResponseJSON }>(req)
      const ch = await takeChallenge(env, body.challengeId)
      if (!ch.user_id) throw new HttpError(400, 'Bad challenge')
      const v = await verifyRegistrationResponse({
        response: body.response, expectedChallenge: ch.challenge,
        expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      }).catch(e => { throw new HttpError(400, String(e.message || e)) })
      if (!v.verified) throw new HttpError(400, 'Passkey could not be verified')
      const { credential } = v.registrationInfo
      const now = Date.now()
      const isNew = !(await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(ch.user_id).first())
      await env.DB.batch([
        ...(isNew ? [env.DB.prepare('INSERT INTO users (id, created) VALUES (?, ?)').bind(ch.user_id, now)] : []),
        env.DB.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports, created) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(credential.id, ch.user_id, b64url.encode(credential.publicKey), credential.counter,
            credential.transports ? JSON.stringify(credential.transports) : null, now),
      ])
      return json({ token: isNew ? await newSession(env, ch.user_id) : undefined, added: !isNew })
    }

    // Sign in with any passkey saved for this site (no username).
    case 'POST /auth/login/options': {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' })
      return json({ challengeId: await saveChallenge(env, options.challenge, null), options })
    }

    case 'POST /auth/login/verify': {
      const body = await readJson<{ challengeId: string; response: AuthenticationResponseJSON }>(req)
      const ch = await takeChallenge(env, body.challengeId)
      const cred = await env.DB.prepare('SELECT id, user_id, public_key, counter, transports FROM credentials WHERE id = ?')
        .bind(body.response?.id).first<{ id: string; user_id: string; public_key: string; counter: number; transports: string | null }>()
      if (!cred) throw new HttpError(404, 'This passkey is not linked to an account. It may have been deleted.')
      const v = await verifyAuthenticationResponse({
        response: body.response, expectedChallenge: ch.challenge,
        expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
        credential: { id: cred.id, publicKey: b64url.decode(cred.public_key), counter: cred.counter, transports: cred.transports ? JSON.parse(cred.transports) : undefined },
      }).catch(e => { throw new HttpError(400, String(e.message || e)) })
      if (!v.verified) throw new HttpError(400, 'Passkey could not be verified')
      await env.DB.prepare('UPDATE credentials SET counter = ?, last_used = ? WHERE id = ?')
        .bind(v.authenticationInfo.newCounter, Date.now(), cred.id).run()
      return json({ token: await newSession(env, cred.user_id) })
    }

    // A second sign-in for the same account, carried to the app's new
    // address inside a move, so signing out on one doesn't sign out both.
    case 'POST /auth/handoff': {
      const userId = await session(req, env)
      return json({ token: await newSession(env, userId) })
    }

    case 'POST /auth/logout': {
      const m = /^Bearer (\S+)$/.exec(req.headers.get('Authorization') ?? '')
      if (m) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(m[1])).run()
      return json({ ok: true })
    }

    case 'GET /account': {
      const userId = await session(req, env)
      const [user, passkeys, data, email] = await Promise.all([
        env.DB.prepare('SELECT created FROM users WHERE id = ?').bind(userId).first<{ created: number }>(),
        env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').bind(userId).first<{ n: number }>(),
        env.DB.prepare('SELECT updated FROM data WHERE user_id = ?').bind(userId).first<{ updated: number }>(),
        env.DB.prepare('SELECT hint FROM emails WHERE user_id = ?').bind(userId).first<{ hint: string }>(),
      ])
      return json({ created: user?.created, passkeys: passkeys?.n ?? 0, updated: data?.updated ?? null, email: email?.hint ?? null })
    }

    case 'DELETE /account': {
      const userId = await session(req, env)
      // Out of every circle first, taking what they shared with them.
      const circles = await env.DB.prepare('SELECT circle_id FROM circle_members WHERE user_id = ?').bind(userId).all<{ circle_id: string }>()
      for (const c of circles.results) await env.DB.batch(leaveCircle(env.DB, c.circle_id, userId))
      await env.DB.batch(['circle_replies', 'circle_amens', 'circle_invites', 'prayer_chunks', 'prayer_parts', 'prayer_gone', 'prayer_wraps', 'prayer_keys', 'data', 'emails', 'email_codes', 'approvals', 'sessions', 'credentials', 'challenges'].map(t =>
        env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(userId)).concat(
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId)))
      return json({ ok: true })
    }

    // The account's document. Writes name the revision they were based on;
    // if someone else wrote in between, the client gets 409 with the newer
    // copy, merges, and tries again.
    case 'GET /data': {
      const userId = await session(req, env)
      const row = await env.DB.prepare('SELECT body, rev, updated FROM data WHERE user_id = ?').bind(userId)
        .first<{ body: string; rev: number; updated: number }>()
      return json(row ? { rev: row.rev, updated: row.updated, body: JSON.parse(row.body) } : { rev: 0, updated: null, body: null })
    }

    case 'PUT /data': {
      const userId = await session(req, env)
      const { rev, body } = await readJson<{ rev: number; body: unknown }>(req)
      if (!Number.isInteger(rev) || rev < 0 || typeof body !== 'object' || body === null) throw new HttpError(400, 'Bad request')
      const text = JSON.stringify(body), now = Date.now()
      const res = rev === 0
        ? await env.DB.prepare('INSERT INTO data (user_id, body, rev, updated) VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING').bind(userId, text, now).run()
        : await env.DB.prepare('UPDATE data SET body = ?, rev = rev + 1, updated = ? WHERE user_id = ? AND rev = ?').bind(text, now, userId, rev).run()
      if (!res.meta.changes) {
        const cur = await env.DB.prepare('SELECT body, rev, updated FROM data WHERE user_id = ?').bind(userId).first<{ body: string; rev: number; updated: number }>()
        throw new HttpError(409, 'Changed elsewhere', cur ? { rev: cur.rev, updated: cur.updated, body: JSON.parse(cur.body) } : { rev: 0, updated: null, body: null })
      }
      return json({ rev: rev + 1, updated: now })
    }
  }
  throw new HttpError(404, 'Not found')
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req, env)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    let res: Response
    try {
      res = await route(req, env)
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message, ...e.extra }, e.status)
      else { console.error(e); res = json({ error: 'Something went wrong' }, 500) }
    }
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
    return res
  },
}
