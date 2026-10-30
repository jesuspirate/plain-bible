// My Quiet Bible sync: accounts you sign in to with a passkey or a code sent by
// email, and one small JSON document per account (highlights, bookmarks,
// settings). No passwords, no tracking, and email addresses are never
// stored, only a fingerprint of them. The app works fully without it.
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { send, vapidPublic, type Subscription, type Vapid } from './push'

export interface Env {
  DB: D1Database
  RP_ID: string
  RP_NAME: string
  ORIGINS: string
  /** Email sign-in is on when both are set (see EMAIL_FROM). */
  RESEND_API_KEY?: string
  EMAIL_SECRET?: string
  EMAIL_FROM: string
  /** Notifications are on when set: the service's P-256 key as JWK (made
   *  once by the deploy script, then never changed, or every device would
   *  have to turn notifications on again). */
  VAPID_KEY?: string
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

// The code email in the language the app is in (src/lib/sync.ts sends it).
const CODE_MAIL = {
  en: { subject: '{code} is your My Quiet Bible code', is: 'Your My Quiet Bible code is', type: 'Type it into the app to sign in. It works for {min} minutes.', ignore: 'If you didn’t ask for it, you can ignore this email.' },
  fr: { subject: '{code} est votre code My Quiet Bible', is: 'Votre code My Quiet Bible est', type: 'Saisissez-le dans l’application pour vous connecter. Il reste valable {min}\u00a0minutes.', ignore: 'Si vous ne l’avez pas demandé, vous pouvez ignorer cet e-mail.' },
  es: { subject: '{code} es tu código de My Quiet Bible', is: 'Tu código de My Quiet Bible es', type: 'Escríbelo en la app para iniciar sesión. Sirve durante {min} minutos.', ignore: 'Si no lo pediste, puedes ignorar este correo.' },
}

async function sendCode(env: Env, to: string, code: string, lang?: string) {
  const w = CODE_MAIL[lang as keyof typeof CODE_MAIL] ?? CODE_MAIL.en
  const type = w.type.replace('{min}', String(CODE_MINUTES))
  // Plain and link-free on purpose: mail filters trust short transactional
  // mail with a matching text part, and no tracking or links to judge.
  const text = `${w.is} ${code}\n\n${type}\n\n${w.ignore}\n\n— My Quiet Bible`
  const html = `<!doctype html><html lang="${lang && lang in CODE_MAIL ? lang : 'en'}"><head><meta charset="utf-8"><title>My Quiet Bible</title></head>
<body><div style="font-family:Georgia,serif;font-size:17px;line-height:1.5;color:#3b2f22">
<p>${w.is}</p><p style="font-size:32px;letter-spacing:6px;margin:8px 0 16px"><strong>${code}</strong></p>
<p>${type}</p>
<p style="color:#8a7a66;font-size:14px">${w.ignore}</p>
<p style="color:#8a7a66;font-size:14px">— My Quiet Bible</p></div></body></html>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM, to: [to], subject: w.subject.replace('{code}', code), text, html,
      // Each code its own message, so Gmail doesn't fold new codes under old ones.
      headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
    }),
  }).catch(() => null)
  if (!res?.ok) {
    console.error('email not sent', res?.status, await res?.text().catch(() => ''))
    throw new HttpError(502, 'The email couldn’t be sent. Try again in a few minutes.')
  }
}

async function emailStart(req: Request, env: Env) {
  if (!emailOn(env)) throw new HttpError(404, 'Email sign-in isn’t set up yet.')
  const adding = req.headers.has('Authorization') ? await session(req, env) : null
  const body = await readJson<{ email: string; lang?: string }>(req)
  const email = cleanEmail(body.email)
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
  await sendCode(env, email, code, body.lang)
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
    if (owner && owner.user_id !== row.user_id) throw new HttpError(409, 'This email already signs in to another My Quiet Bible account.')
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
const CODE_MS = 15 * 60_000
const CODE_MISSES = 10
const HOUR = 3_600_000
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
    db.prepare(`DELETE FROM circle_reacts WHERE circle_id = ?1 AND (user_id = ?2 OR item IN (${mine}))`).bind(circle, userId),
    db.prepare(`DELETE FROM circle_replies WHERE circle_id = ?1 AND (user_id = ?2 OR item IN (${mine}))`).bind(circle, userId),
    db.prepare('DELETE FROM circle_items WHERE circle_id = ?1 AND user_id = ?2').bind(circle, userId),
    db.prepare('DELETE FROM circle_invites WHERE circle_id = ?1 AND user_id = ?2').bind(circle, userId),
    db.prepare('DELETE FROM circle_members WHERE circle_id = ?1 AND user_id = ?2').bind(circle, userId),
    db.prepare('DELETE FROM push_circles WHERE circle_id = ?1 AND endpoint IN (SELECT endpoint FROM push_subs WHERE user_id = ?2)').bind(circle, userId),
    ...['circle_chunks', 'circle_amens', 'circle_reacts', 'circle_replies', 'circle_items', 'circle_invites'].map(t =>
      db.prepare(`DELETE FROM ${t} WHERE circle_id = ?1 AND NOT EXISTS (SELECT 1 FROM circle_members WHERE circle_id = ?1)`).bind(circle)),
    db.prepare('DELETE FROM circles WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM circle_members WHERE circle_id = ?1)').bind(circle),
  ]
}

// ---------------------------------------------------------------------------
// Notifications: "something new in <circle>", on the devices that asked.

const PUSH_GAP = 2 * 60_000
const vapid = (env: Env): Vapid | undefined => {
  if (!env.VAPID_KEY) return undefined
  try { return { jwk: JSON.parse(env.VAPID_KEY), subject: 'mailto:hello@myquietbible.com' } } catch { return undefined }
}

/** Tell the other members' devices (or only `to`, whose prayer was prayed
 *  with) that something is new in this circle. At most once every two
 *  minutes per device and circle; the notification on the phone stays one
 *  per circle either way. */
async function notifyCircle(env: Env, circle: string, from: string, to?: string) {
  const v = vapid(env)
  if (!v) return
  const now = Date.now()
  const rows = (await env.DB.prepare(`SELECT s.endpoint, s.p256dh, s.auth FROM push_circles p JOIN push_subs s ON s.endpoint = p.endpoint
    JOIN circle_members m ON m.circle_id = p.circle_id AND m.user_id = s.user_id
    WHERE p.circle_id = ?1 AND s.user_id != ?2 AND (?3 IS NULL OR s.user_id = ?3) AND (p.sent IS NULL OR p.sent < ?4)`)
    .bind(circle, from, to ?? null, now - PUSH_GAP).all<Subscription>()).results
  if (!rows.length) return
  await env.DB.batch(rows.map(r => env.DB.prepare('UPDATE push_circles SET sent = ? WHERE endpoint = ? AND circle_id = ?').bind(now, r.endpoint, circle)))
  const gone: string[] = []
  await Promise.all(rows.map(r => send(r, { c: circle }, v, circle).then(ok => { if (!ok) gone.push(r.endpoint) }, e => console.error('push', e))))
  if (gone.length) await env.DB.batch(gone.flatMap(e => [
    env.DB.prepare('DELETE FROM push_circles WHERE endpoint = ?').bind(e),
    env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(e),
  ]))
}

const PUSH_HOSTS = /^https:\/\/[\w.-]+(:\d+)?\//
const cleanSub = (v: unknown): Subscription => {
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = s?.endpoint, p256dh = s?.keys?.p256dh, auth = s?.keys?.auth
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !PUSH_HOSTS.test(endpoint) || !sealedText(p256dh, 200) || !sealedText(auth, 100)) throw new HttpError(400, 'Bad request')
  return { endpoint, p256dh: p256dh as string, auth: auth as string }
}

async function pushRoute(req: Request, env: Env, parts: string[]): Promise<Response> {
  const db = env.DB
  const [a, b] = parts
  // The key browsers subscribe with. null: notifications aren't set up.
  if (a === 'key' && !b && req.method === 'GET') {
    const v = vapid(env)
    return json({ key: v ? vapidPublic(v.jwk) : null })
  }
  const userId = await session(req, env)
  // This device stops hearing about anything (signing out).
  if (!a && req.method === 'DELETE') {
    const { endpoint } = await readJson<{ endpoint: string }>(req)
    await db.batch([
      db.prepare('DELETE FROM push_circles WHERE endpoint = ? AND EXISTS (SELECT 1 FROM push_subs s WHERE s.endpoint = ?1 AND s.user_id = ?2)').bind(endpoint, userId),
      db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(endpoint, userId),
    ])
    return json({ ok: true })
  }
  // One circle, on or off, for this device.
  if (a === 'circles' && b && CIRCLE_ID.test(b)) {
    const { sub } = await readJson<{ sub: unknown }>(req)
    const s = cleanSub(sub)
    if (req.method === 'PUT') {
      await membership(db, b, userId)
      if (!vapid(env)) throw new HttpError(503, 'Notifications aren’t set up yet. Try again later.')
      const n = await db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').bind(userId).first<{ n: number }>()
      if ((n?.n ?? 0) >= 20 && !(await db.prepare('SELECT 1 FROM push_subs WHERE endpoint = ?').bind(s.endpoint).first())) throw new HttpError(413, 'Too many devices have notifications on')
      await db.batch([
        db.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`).bind(s.endpoint, userId, s.p256dh, s.auth, Date.now()),
        db.prepare('INSERT INTO push_circles (endpoint, circle_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(s.endpoint, b),
      ])
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      await db.prepare('DELETE FROM push_circles WHERE endpoint = ?1 AND circle_id = ?2 AND EXISTS (SELECT 1 FROM push_subs s WHERE s.endpoint = ?1 AND s.user_id = ?3)').bind(s.endpoint, b, userId).run()
      return json({ ok: true })
    }
  }
  throw new HttpError(404, 'Not found')
}

async function circleRoute(req: Request, env: Env, parts: string[], ctx: ExecutionContext): Promise<Response> {
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
          WHERE a.circle_id = c.id AND a.user_id != m.user_id AND i.user_id = m.user_id), 0),
        COALESCE((SELECT MAX(x.at) FROM circle_reacts x JOIN circle_items i ON i.circle_id = x.circle_id AND i.id = x.item
          WHERE x.circle_id = c.id AND x.user_id != m.user_id AND i.user_id = m.user_id), 0)) AS latest
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

  // Joining with a code, on the joining side: type it (which leaves your
  // public key), wait for the member who made it to allow you, then join.
  if (a === 'code') {
    if (!b && req.method === 'POST') {
      const { code, pub, label } = await readJson<{ code: string; pub: string; label: string }>(req)
      if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !sealedText(pub, 200) || typeof label !== 'string' || label.length > 60) throw new HttpError(400, 'Bad request')
      const misses = await db.prepare('SELECT COUNT(*) AS n FROM circle_code_misses WHERE user_id = ? AND at > ?').bind(userId, now - HOUR).first<{ n: number }>()
      if ((misses?.n ?? 0) >= CODE_MISSES) throw new HttpError(429, 'Too many wrong codes. Try again in an hour.')
      // The same ask again (a second tap, or a retry after a dropped answer)
      // finds its own request and changes nothing.
      const row = await db.prepare('UPDATE circle_codes SET joiner = ?, pub = ?, label = ? WHERE code = ? AND (joiner IS NULL OR (joiner = ? AND pub = ?)) AND expires > ? RETURNING code')
        .bind(userId, pub, label, code, userId, pub, now).first()
      if (!row) {
        await db.batch([
          db.prepare('DELETE FROM circle_code_misses WHERE at < ?').bind(now - HOUR),
          db.prepare('INSERT INTO circle_code_misses (user_id, at) VALUES (?, ?)').bind(userId, now),
        ])
        throw new HttpError(404, 'That code isn’t right, or it has expired. Check it and try again.')
      }
      return json({ ok: true })
    }
    if (!b || !/^\d{6}$/.test(b) || d) throw new HttpError(404, 'Not found')
    const row = await db.prepare('SELECT circle_id, epk, sealed FROM circle_codes WHERE code = ? AND joiner = ? AND expires > ?').bind(b, userId, now)
      .first<{ circle_id: string; epk: string | null; sealed: string | null }>()
    if (req.method === 'DELETE' && !c) {
      await db.prepare('DELETE FROM circle_codes WHERE code = ? AND joiner = ?').bind(b, userId).run()
      return json({ ok: true })
    }
    if (!row) throw new HttpError(404, 'This code has expired. Ask for a new one.')
    if (req.method === 'GET' && !c) return json({ circle: row.circle_id, epk: row.epk, sealed: row.sealed })
    if (req.method === 'POST' && c === 'join') {
      if (!row.sealed) throw new HttpError(409, 'Not allowed in yet.')
      const { wrapped, me } = await readJson<{ wrapped: string; me: string }>(req)
      if (!sealedText(wrapped, 500) || !sealedText(me, 2000)) throw new HttpError(400, 'Bad request')
      const circle = row.circle_id
      const already = await db.prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(circle, userId).first()
      if (!already) {
        const [members, mine] = await Promise.all([
          db.prepare('SELECT COUNT(*) AS n FROM circle_members WHERE circle_id = ?').bind(circle).first<{ n: number }>(),
          db.prepare('SELECT COUNT(*) AS n FROM circle_members WHERE user_id = ?').bind(userId).first<{ n: number }>(),
        ])
        if ((members?.n ?? 0) >= MAX_MEMBERS) throw new HttpError(413, `A circle can have up to ${MAX_MEMBERS} people`)
        if ((mine?.n ?? 0) >= MAX_CIRCLES) throw new HttpError(413, `You can be in up to ${MAX_CIRCLES} circles`)
      }
      await db.batch([
        db.prepare(`INSERT INTO circle_members (circle_id, user_id, mid, wrapped, name, joined) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT DO UPDATE SET wrapped = excluded.wrapped`).bind(circle, userId, random(9), wrapped, me, now),
        db.prepare('DELETE FROM circle_codes WHERE code = ?').bind(b),
      ])
      return json({ ok: true, circle })
    }
    throw new HttpError(404, 'Not found')
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
    const [named, members, items, amens, replies, reacts] = await Promise.all([
      db.prepare('SELECT name FROM circles WHERE id = ?').bind(circle).first<{ name: string }>(),
      db.prepare('SELECT mid, name, streak FROM circle_members WHERE circle_id = ? ORDER BY joined').bind(circle).all(),
      db.prepare(`SELECT i.id, m.mid, i.at, i.body, i.chunks, i.size FROM circle_items i JOIN circle_members m ON m.circle_id = i.circle_id AND m.user_id = i.user_id
        WHERE i.circle_id = ?1 AND (i.chunks = 0 OR i.chunks = (SELECT COUNT(*) FROM circle_chunks k WHERE k.circle_id = ?1 AND k.item = i.id))
        ORDER BY i.at DESC LIMIT 300`).bind(circle).all(),
      db.prepare(`SELECT a.item, m.mid, a.at FROM circle_amens a JOIN circle_members m ON m.circle_id = a.circle_id AND m.user_id = a.user_id
        WHERE a.circle_id = ? ORDER BY a.at`).bind(circle).all<{ item: string; mid: string; at: number }>(),
      db.prepare(`SELECT r.item, r.id, m.mid, r.at, r.body FROM circle_replies r JOIN circle_members m ON m.circle_id = r.circle_id AND m.user_id = r.user_id
        WHERE r.circle_id = ? ORDER BY r.at`).bind(circle).all(),
      db.prepare(`SELECT x.item, m.mid, x.at, x.body FROM circle_reacts x JOIN circle_members m ON m.circle_id = x.circle_id AND m.user_id = x.user_id
        WHERE x.circle_id = ? ORDER BY x.at`).bind(circle).all(),
    ])
    return json({ me: mid, name: named?.name, members: members.results, items: items.results, amens: amens.results, replies: replies.results, reacts: reacts.results })
  }
  // Joining with a code, on the member's side: make one, see who typed it,
  // and allow them by sealing the circle key to their public key.
  if (b === 'code') {
    if (!c && req.method === 'POST') {
      const open = await db.prepare('SELECT COUNT(*) AS n FROM circle_codes WHERE circle_id = ? AND expires > ?').bind(circle, now).first<{ n: number }>()
      if ((open?.n ?? 0) >= 5) throw new HttpError(429, 'Several codes are already waiting. Try again in a few minutes.')
      await db.prepare('DELETE FROM circle_codes WHERE expires < ?').bind(now).run()
      for (let i = 0; i < 5; i++) {
        const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
        const res = await db.prepare('INSERT INTO circle_codes (code, circle_id, user_id, created, expires) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
          .bind(code, circle, userId, now, now + CODE_MS).run()
        if (res.meta.changes) return json({ code, expires: now + CODE_MS })
      }
      throw new HttpError(503, 'Try again')
    }
    if (!c || !/^\d{6}$/.test(c) || d) throw new HttpError(404, 'Not found')
    if (req.method === 'DELETE') {
      await db.prepare('DELETE FROM circle_codes WHERE code = ? AND circle_id = ? AND user_id = ?').bind(c, circle, userId).run()
      return json({ ok: true })
    }
    const row = await db.prepare('SELECT pub, label, sealed FROM circle_codes WHERE code = ? AND circle_id = ? AND user_id = ? AND expires > ?').bind(c, circle, userId, now)
      .first<{ pub: string | null; label: string | null; sealed: string | null }>()
    if (!row) throw new HttpError(404, 'This code has expired. Make a new one.')
    if (req.method === 'GET') return json({ pub: row.pub, label: row.label, allowed: !!row.sealed })
    if (req.method === 'PUT') {
      const { epk, sealed } = await readJson<{ epk: string; sealed: string }>(req)
      if (!sealedText(epk, 200) || !sealedText(sealed, 500)) throw new HttpError(400, 'Bad request')
      const res = await db.prepare('UPDATE circle_codes SET epk = ?, sealed = ? WHERE code = ? AND circle_id = ? AND user_id = ? AND joiner IS NOT NULL AND sealed IS NULL AND expires > ?')
        .bind(epk, sealed, c, circle, userId, now).run()
      if (!res.meta.changes) throw new HttpError(404, 'They stopped waiting. Make a new code.')
      return json({ ok: true })
    }
  }
  // The circle's own name: anyone in it may change it. It's sealed with
  // the circle's key, so this side never knows what it says.
  if (b === 'name' && !c && req.method === 'PUT') {
    const { name } = await readJson<{ name: string }>(req)
    if (!sealedText(name, 2000)) throw new HttpError(400, 'Bad request')
    await db.prepare('UPDATE circles SET name = ? WHERE id = ?').bind(name, circle).run()
    return json({ ok: true })
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
      // A prayer is news once its audio is all there (see the chunks below).
      if (res.meta.changes && !chunks) ctx.waitUntil(notifyCircle(env, circle, userId))
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      if (!(await own())) throw new HttpError(404, 'Not found')
      await db.batch(['circle_chunks', 'circle_amens', 'circle_reacts', 'circle_replies'].map(t => db.prepare(`DELETE FROM ${t} WHERE circle_id = ? AND item = ?`).bind(circle, item)).concat(
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
      const res = await db.prepare('INSERT INTO circle_replies (circle_id, item, id, user_id, at, body) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(circle, item, e, userId, now, body).run()
      if (res.meta.changes) ctx.waitUntil(notifyCircle(env, circle, userId))
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      await db.prepare('DELETE FROM circle_replies WHERE circle_id = ? AND item = ? AND id = ? AND user_id = ?').bind(circle, item, e, userId).run()
      return json({ ok: true })
    }
  }
  if (d === 'amen' && !e) {
    if (req.method === 'PUT') {
      const it = await db.prepare('SELECT user_id FROM circle_items WHERE circle_id = ? AND id = ?').bind(circle, item).first<{ user_id: string }>()
      if (!it) throw new HttpError(404, 'Not found')
      const res = await db.prepare('INSERT INTO circle_amens (circle_id, item, user_id, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(circle, item, userId, now).run()
      // A 🙏 is news only to the one who shared it (as with the dot).
      if (res.meta.changes) ctx.waitUntil(notifyCircle(env, circle, userId, it.user_id))
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      await db.prepare('DELETE FROM circle_amens WHERE circle_id = ? AND item = ? AND user_id = ?').bind(circle, item, userId).run()
      return json({ ok: true })
    }
  }
  // Your reactions on it (❤️ 💪 🙌), sealed. `added`: one was just given,
  // which makes it news to whoever shared it; taking one back isn't.
  if (d === 'react' && !e) {
    if (req.method === 'PUT') {
      const { body, added } = await readJson<{ body: string; added?: boolean }>(req)
      if (!sealedText(body, 500)) throw new HttpError(400, 'Bad request')
      const it = await db.prepare('SELECT user_id FROM circle_items WHERE circle_id = ? AND id = ?').bind(circle, item).first<{ user_id: string }>()
      if (!it) throw new HttpError(404, 'Not found')
      await db.prepare(`INSERT INTO circle_reacts (circle_id, item, user_id, at, body) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT DO UPDATE SET body = excluded.body, at = CASE WHEN ?6 THEN excluded.at ELSE circle_reacts.at END`).bind(circle, item, userId, now, body, added ? 1 : 0).run()
      if (added) ctx.waitUntil(notifyCircle(env, circle, userId, it.user_id))
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      await db.prepare('DELETE FROM circle_reacts WHERE circle_id = ? AND item = ? AND user_id = ?').bind(circle, item, userId).run()
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
    const res = await db.prepare('INSERT INTO circle_chunks (circle_id, item, n, data) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(circle, item, n, data).run()
    if (!res.meta.changes) await db.prepare('UPDATE circle_chunks SET data = ? WHERE circle_id = ? AND item = ? AND n = ?').bind(data, circle, item, n).run()
    // The last piece of a prayer's audio: now the others can hear it.
    else if ((await db.prepare('SELECT COUNT(*) AS n FROM circle_chunks WHERE circle_id = ? AND item = ?').bind(circle, item).first<{ n: number }>())?.n === it.chunks) {
      ctx.waitUntil(notifyCircle(env, circle, userId))
    }
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

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
    return circleRoute(req, env, pathname.split('/').slice(2).filter(Boolean).map(decodeURIComponent), ctx)
  }
  if (pathname === '/push' || pathname.startsWith('/push/')) {
    return pushRoute(req, env, pathname.split('/').slice(2).filter(Boolean))
  }

  switch (key) {
    case 'GET /': return json({ service: 'plain-bible-sync', ok: true, email: emailOn(env), push: !!vapid(env) })

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
      await env.DB.prepare('DELETE FROM push_circles WHERE endpoint IN (SELECT endpoint FROM push_subs WHERE user_id = ?)').bind(userId).run()
      await env.DB.batch(['circle_replies', 'circle_amens', 'circle_reacts', 'circle_invites', 'prayer_chunks', 'prayer_parts', 'prayer_gone', 'prayer_wraps', 'prayer_keys', 'data', 'emails', 'email_codes', 'approvals', 'push_subs', 'sessions', 'credentials', 'challenges'].map(t =>
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
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const headers = cors(req, env)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    let res: Response
    try {
      res = await route(req, env, ctx)
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message, ...e.extra }, e.status)
      else { console.error(e); res = json({ error: 'Something went wrong' }, 500) }
    }
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
    return res
  },
}
