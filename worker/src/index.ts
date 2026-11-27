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
import { APNS_PREFIX, APNS_TOKEN, isApnsEnv, sendApns, type Apns } from './apns'
import { checkNostrEvent, NOSTR_WRAP } from './nostr'
import { plainBookName } from '../../src/lib/bookList'
import { suggestionMail } from './suggest'
import { CARD_ID, CARD_MAX, cardId, isCard } from './card'

export interface Env {
  DB: D1Database
  RP_ID: string
  RP_NAME: string
  ORIGINS: string
  /** Email sign-in is on when both are set (see EMAIL_FROM). */
  RESEND_API_KEY?: string
  EMAIL_SECRET?: string
  EMAIL_FROM: string
  /** Where report notices go. Unset: hello@myquietbible.com. A secret, so no
   *  personal address is ever in the code. */
  REPORT_EMAIL?: string
  /** Notifications are on when set: the service's P-256 key as JWK (made
   *  once by the deploy script, then never changed, or every device would
   *  have to turn notifications on again). */
  VAPID_KEY?: string
  /** Notifications in the App Store iPhone app are on when both are set:
   *  an APNs key from developer.apple.com (the whole .p8 text) and its Key ID. */
  APNS_KEY_P8?: string
  APNS_KEY_ID?: string
  /** The private numbers page (/stats?key=…) is on when this is set. */
  STATS_KEY?: string
  /** The maker's own sign-in email. When set, the numbers page shows one of
   *  that account's bookmarks under its title, a new one each time. Only that
   *  one account is ever read. */
  STATS_EMAIL?: string
  /** Recorded Bible readings the app serves itself (/audio/…), when the
   *  account has R2 storage (scripts/deploy_sync.sh). Verse pictures for
   *  shared links' cards live there too, under cards/ (card.ts). */
  AUDIO?: R2Bucket
}

const DAY = 86_400_000
const SESSION_DAYS = 365
const CHALLENGE_MS = 5 * 60_000
const MAX_BODY = 2_000_000
// Prayers: encrypted audio, sent in chunks that each fit in a row.
const CHUNK_MAX = 1_100_000
const MAX_CHUNKS = 64
const PRAYER_QUOTA = 300_000_000
// Device links: a sign-in (and the prayer key) for another device, packed
// and encrypted there. The whole-device moves from the old address ended,
// so a link is a few kilobytes and lives an hour.
const MOVE_ID = /^[A-Za-z0-9_-]{22}$/
const MOVE_MAX_CHUNKS = 8
const LINK_HOURS = 1
// Anyone may leave one, so keep that small: per network address, and in all.
const MOVE_CHUNKS_PER_IP = 30
const MOVE_BYTES_PER_IP = 5_000_000
const MOVE_BYTES_TOTAL = 200_000_000

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
/** Who's asking, for limits only: a fingerprint of the network address,
 *  never the address itself. */
const ipKey = (req: Request) => sha256('ip:' + (req.headers.get('CF-Connecting-IP') ?? 'unknown')).then(h => h.slice(0, 22))

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

/** A sign-in made with a passkey remembers which one, for "This one". */
async function newSession(env: Env, userId: string, credId: string | null = null) {
  const token = random(32), now = Date.now()
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created, expires, cred_id) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * DAY, credId).run()
  return token
}

const bearer = (req: Request) => /^Bearer (\S+)$/.exec(req.headers.get('Authorization') ?? '')?.[1]

/** Password managers that say who they are when a passkey is made (its
 *  AAGUID), for the passkey's first name. Others start unnamed. */
const KNOWN: Record<string, string> = {
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'b84e4048-15dc-4dd0-8640-f4f60813c8af': 'NordPass',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
  '50726f74-6f6e-5061-7373-50726f746f6e': 'Proton Pass',
  'fdb141b2-5d84-443e-8a35-4698c205a502': 'KeePassXC',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
}
const NAME_MAX = 40

/** Checks a passkey's answer to a sign-in challenge, and notes its use. */
async function assertion(env: Env, body: { challengeId: string; response: AuthenticationResponseJSON }, origin: string | string[], rpID: string) {
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
  await env.DB.prepare('UPDATE credentials SET counter = ?, last_used = ?, rp_id = ? WHERE id = ?')
    .bind(v.authenticationInfo.newCounter, Date.now(), rpID, cred.id).run()
  return cred
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
// From one network address, so a few people can't use up the day's sends
// below and switch email sign-in off for everyone.
const IP_SENDS_PER_HOUR = 6
const IP_SENDS_PER_DAY = 12
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
/** On 2026-11-20 a deploy replaced EMAIL_SECRET by mistake, so addresses saved
 *  before then stopped matching, and signing in by email made a new, empty
 *  account instead. Such an account (made since then, with no passkey or Fedi
 *  key) gives its address up when the person proves the address again from
 *  their real account (Settings → Account → Change email). */
const EMAIL_SECRET_RESET = Date.UTC(2026, 10, 20, 16, 59)
async function strayEmailAccount(env: Env, userId: string) {
  const [user, cred, nostr] = await Promise.all([
    env.DB.prepare('SELECT created FROM users WHERE id = ?').bind(userId).first<{ created: number }>(),
    env.DB.prepare('SELECT 1 FROM credentials WHERE user_id = ?').bind(userId).first(),
    env.DB.prepare('SELECT 1 FROM nostr_keys WHERE user_id = ?').bind(userId).first(),
  ])
  return !!user && user.created >= EMAIL_SECRET_RESET && !cred && !nostr
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

/** A note to the app's maker that something in a circle was reported.
 *  Never blocks the report: it's kept either way, on the /stats page. */
async function tellAboutReport(env: Env, what: string) {
  const text = `Someone reported this in a circle:\n\n${what}\n\nOpen the private stats page (/stats on the sync service) to remove it, take the person out of the circle, or keep it. Apple asks for an answer within 24 hours.\n\n— My Quiet Bible`
  await tellMaker(env, 'Something was reported in a circle', text)
}
async function tellMaker(env: Env, subject: string, text: string) {
  if (!emailOn(env)) return
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [env.REPORT_EMAIL || 'hello@myquietbible.com'], subject, text }),
  }).then(r => { if (!r.ok) console.error('maker email', r.status) }, e => console.error('maker email', e))
}

// ---------------------------------------------------------------------------
// Suggestions: anyone, signed in or not, can write to the app's maker from
// Settings. It's sent by email (to REPORT_EMAIL) and never stored. A reply
// address only if the person types one, then Reply in the mail answers them.
// The app adds its version, kind of device and language, nothing else.

const SUGGEST_PER_HOUR = 5
const SUGGEST_PER_DAY = 15
const SUGGEST_ALL_PER_DAY = 300

async function suggestRoute(req: Request, env: Env) {
  if (!emailOn(env)) throw new HttpError(404, 'Suggestions aren’t set up yet.')
  const made = suggestionMail(await readJson(req))
  if (!made.ok) {
    if (made.why === 'empty') throw new HttpError(400, 'Write something first.')
    if (made.why === 'long') throw new HttpError(413, 'That’s a bit long. Please make it shorter.')
    throw new HttpError(400, 'That email address doesn’t look right.')
  }
  const { mail } = made
  const db = env.DB, now = Date.now(), ip = await ipKey(req)
  const [here, all] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n, COUNT(CASE WHEN at > ? THEN 1 END) AS h FROM suggest_sends WHERE ip = ? AND at > ?').bind(now - HOUR, ip, now - DAY).first<{ n: number; h: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM suggest_sends WHERE at > ?').bind(now - DAY).first<{ n: number }>(),
  ])
  if ((here?.h ?? 0) >= SUGGEST_PER_HOUR || (here?.n ?? 0) >= SUGGEST_PER_DAY || (all?.n ?? 0) >= SUGGEST_ALL_PER_DAY) {
    throw new HttpError(429, 'Too many messages for now. Please try again tomorrow.')
  }
  await db.batch([
    db.prepare('DELETE FROM suggest_sends WHERE at < ?').bind(now - DAY),
    db.prepare('INSERT INTO suggest_sends (ip, at) VALUES (?, ?)').bind(ip, now),
  ])
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM, to: [env.REPORT_EMAIL || 'hello@myquietbible.com'], subject: mail.subject, text: mail.text,
      ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    }),
  }).catch(() => null)
  if (!res?.ok) {
    console.error("report not sent", res?.status)
    throw new HttpError(502, 'It couldn’t be sent. Try again in a few minutes.')
  }
  return json({ ok: true })
}

async function emailStart(req: Request, env: Env) {
  if (!emailOn(env)) throw new HttpError(404, 'Email sign-in isn’t set up yet.')
  const adding = req.headers.has('Authorization') ? await session(req, env) : null
  const body = await readJson<{ email: string; lang?: string }>(req)
  const email = cleanEmail(body.email)
  const hash = await emailHash(env, email), now = Date.now(), db = env.DB, ip = await ipKey(req)
  const [mine, all, here] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM email_sends WHERE hash = ? AND at > ?').bind(hash, now - 3_600_000).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM email_sends WHERE at > ?').bind(now - DAY).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n, COUNT(CASE WHEN at > ? THEN 1 END) AS h FROM email_sends WHERE ip = ? AND at > ?').bind(now - 3_600_000, ip, now - DAY).first<{ n: number; h: number }>(),
  ])
  if ((mine?.n ?? 0) >= SENDS_PER_HOUR) throw new HttpError(429, 'Several codes were already sent to this address. Use the newest one, or try again in an hour.')
  if ((here?.h ?? 0) >= IP_SENDS_PER_HOUR || (here?.n ?? 0) >= IP_SENDS_PER_DAY) throw new HttpError(429, 'Too many sign-in emails from here. Try again later, or use a passkey.')
  if ((all?.n ?? 0) >= SENDS_PER_DAY) throw new HttpError(429, 'Too many sign-in emails today. Please try again tomorrow, or use a passkey.')
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
  await db.batch([
    db.prepare('DELETE FROM email_sends WHERE at < ?').bind(now - DAY),
    db.prepare('DELETE FROM email_codes WHERE expires < ?').bind(now),
    db.prepare('INSERT INTO email_sends (hash, at, ip) VALUES (?, ?, ?)').bind(hash, now, ip),
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
    if (owner && owner.user_id !== row.user_id && !await strayEmailAccount(env, owner.user_id))
      throw new HttpError(409, 'This email already signs in to another My Quiet Bible account.')
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
// Nostr sign-in, for Fedi: its mini apps have the person's Nostr key
// (NIP-07, window.nostr) but no passkeys. The app signs a one-time challenge
// with it; the key's public half finds the account. Only that public key is
// kept. Prayers stay end to end encrypted: the key seals its own copy of the
// account key (NIP-44), which the server can't open.

const NOSTR_KEYS_MAX = 20
// Per network address, so one script can't make accounts without end. Kept
// generous: a church hall or a Fedi meetup can share one address.
const NOSTR_TRIES_PER_HOUR = 60
const NOSTR_NEW_PER_HOUR = 20
const NOSTR_NEW_PER_DAY = 50

async function nostrStart(req: Request, env: Env) {
  const db = env.DB, now = Date.now(), ip = await ipKey(req)
  const here = await db.prepare('SELECT COUNT(*) AS n FROM nostr_tries WHERE ip = ? AND at > ? AND made = 0').bind(ip, now - HOUR).first<{ n: number }>()
  if ((here?.n ?? 0) >= NOSTR_TRIES_PER_HOUR) throw new HttpError(429, 'Too many sign-ins from here. Try again later.')
  await db.batch([
    db.prepare('DELETE FROM nostr_tries WHERE at < ?').bind(now - DAY),
    db.prepare('INSERT INTO nostr_tries (ip, at, made) VALUES (?, ?, 0)').bind(ip, now),
  ])
  const challenge = random(32)
  return json({ challengeId: await saveChallenge(env, challenge, null), challenge })
}

async function nostrVerify(req: Request, env: Env) {
  const adding = req.headers.has('Authorization') ? await session(req, env) : null
  const body = await readJson<{ challengeId: string; event: unknown }>(req)
  const ch = await takeChallenge(env, body.challengeId)
  // The address the app signed for: this very route (src/lib/nostr.ts).
  const u = new URL(req.url)
  const pubkey = await checkNostrEvent(body.event, ch.challenge, Date.now(), u.origin + u.pathname, 'POST')
  if (!pubkey) throw new HttpError(400, 'Fedi’s answer couldn’t be checked. Please try again.')
  const db = env.DB, now = Date.now()
  const owner = await db.prepare('SELECT user_id FROM nostr_keys WHERE pubkey = ?').bind(pubkey).first<{ user_id: string }>()
  // Adding (or changing) the Nostr key of the signed-in account.
  if (adding) {
    if (owner && owner.user_id !== adding) throw new HttpError(409, 'This Nostr key already signs in to another My Quiet Bible account.')
    // Several Fedi apps (each its own key) can sign in to one account, like
    // several passkeys. Each one opens the account and its prayers.
    if (!owner) {
      const n = await db.prepare('SELECT COUNT(*) AS n FROM nostr_keys WHERE user_id = ?').bind(adding).first<{ n: number }>()
      if ((n?.n ?? 0) >= NOSTR_KEYS_MAX) throw new HttpError(413, 'Too many Nostr keys on this account. Remove one first.')
      await db.prepare('INSERT INTO nostr_keys (pubkey, user_id, created, last_used) VALUES (?, ?, ?, ?)').bind(pubkey, adding, now, now).run()
    }
    return json({ added: true, pubkey })
  }
  if (owner) {
    const [n] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').bind(owner.user_id).first<{ n: number }>(),
      db.prepare('UPDATE nostr_keys SET last_used = ? WHERE pubkey = ?').bind(now, pubkey).run(),
    ])
    return json({ token: await newSession(env, owner.user_id), passkeys: n?.n ?? 0, pubkey })
  }
  // A key not seen before makes a new account, a limited number per address.
  const ip = await ipKey(req)
  const made = await db.prepare('SELECT COUNT(*) AS n, SUM(at > ?) AS h FROM nostr_tries WHERE ip = ? AND at > ? AND made = 1')
    .bind(now - HOUR, ip, now - DAY).first<{ n: number; h: number | null }>()
  if ((made?.h ?? 0) >= NOSTR_NEW_PER_HOUR || (made?.n ?? 0) >= NOSTR_NEW_PER_DAY) throw new HttpError(429, 'Too many sign-ins from here. Try again later.')
  const userId = random(16)
  await db.batch([
    db.prepare('INSERT INTO nostr_tries (ip, at, made) VALUES (?, ?, 1)').bind(ip, now),
    db.prepare('INSERT INTO users (id, created) VALUES (?, ?)').bind(userId, now),
    db.prepare('INSERT INTO nostr_keys (pubkey, user_id, created, last_used) VALUES (?, ?, ?, ?)').bind(pubkey, userId, now, now),
  ])
  return json({ token: await newSession(env, userId), created: true, passkeys: 0, pubkey })
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
      // A passkey's copy, or the Nostr key's ("nostr:<pubkey>"), sealed in
      // Fedi with NIP-44 so only that key opens it.
      const cred = b.startsWith(NOSTR_WRAP)
        ? await db.prepare('SELECT 1 FROM nostr_keys WHERE pubkey = ? AND user_id = ?').bind(b.slice(NOSTR_WRAP.length), userId).first()
        : await db.prepare('SELECT 1 FROM credentials WHERE id = ? AND user_id = ?').bind(b, userId).first()
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
    // The limit counts the bytes actually stored, finished parts or not (a
    // part that is never finished would otherwise take room for free). The
    // check and the write are one statement, so uploads sent side by side
    // can't all slip under it, and a chunk being replaced isn't counted twice.
    const stored = await db.prepare(`INSERT INTO prayer_chunks (user_id, prayer, part, n, of, data) SELECT ?1, ?2, ?3, ?4, ?5, ?6
      WHERE (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM prayer_chunks WHERE user_id = ?1 AND NOT (prayer = ?2 AND part = ?3 AND n = ?4)) + ?7 <= ?8
      ON CONFLICT DO UPDATE SET of = excluded.of, data = excluded.data`)
      .bind(userId, a, part, n, of, data, data.byteLength, PRAYER_QUOTA).run()
    if (!stored.meta.changes) throw new HttpError(413, 'Your synced prayers have reached the storage limit')
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

// A device link. Anyone may leave one; it is encrypted on the device, kept
// an hour, and found only by its random id, which travels in the link with
// the key. Limits keep strangers from filling the database with it.
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
    if (!row?.c || row.c !== row.of) throw new HttpError(404, 'This link has expired or was never finished. Make a new one on the other device.')
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
    const now = Date.now(), ip = await ipKey(req)
    await db.prepare('DELETE FROM moves WHERE expires < ?').bind(now).run()
    const [mine, all] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size), 0) AS b FROM moves WHERE ip = ? AND expires > ?').bind(ip, now).first<{ c: number; b: number }>(),
      db.prepare('SELECT COALESCE(SUM(size), 0) AS b FROM moves WHERE expires > ?').bind(now).first<{ b: number }>(),
    ])
    if ((mine?.c ?? 0) >= MOVE_CHUNKS_PER_IP || (mine?.b ?? 0) + data.byteLength > MOVE_BYTES_PER_IP) throw new HttpError(429, 'Too many links from here. Try again in an hour.')
    if ((all?.b ?? 0) + data.byteLength > MOVE_BYTES_TOTAL) throw new HttpError(503, 'Links are busy right now. Try again in an hour.')
    await db.prepare('INSERT INTO moves (id, n, of, data, expires, ip, size) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET of = excluded.of, data = excluded.data, size = excluded.size')
      .bind(id, n, of, data, now + LINK_HOURS * 3_600_000, ip, data.byteLength).run()
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
/** Open door circles: how many people one holds, and how many prayer
 *  requests one person may send its leader in a day. */
const DOOR_MAX = 300
const ASKS_PER_DAY = 5
const sealedText = (v: unknown, max = SEALED_MAX) => typeof v === 'string' && v.length > 0 && v.length <= max && /^[\w-]+$/.test(v)

/** The member's row in the circle, or 404 (not 403: a stranger can't tell
 *  whether the circle exists). */
async function membership(db: D1Database, circle: string, userId: string) {
  const row = await db.prepare('SELECT mid FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(circle, userId).first<{ mid: string }>()
  if (!row) throw new HttpError(404, 'Not found')
  return row.mid
}

/** The accounts the member `m` blocked in circle `c` (inside a query that names them so). */
const BLOCKED = 'SELECT bm.user_id FROM circle_blocks bl JOIN circle_members bm ON bm.circle_id = bl.circle_id AND bm.mid = bl.mid WHERE bl.user_id = m.user_id AND bl.circle_id = c.id'
const REPORTS_PER_DAY = 30

/** How many people the circle can hold: more for an Open door one. */
const capOf = async (db: D1Database, circle: string) =>
  (await db.prepare('SELECT leader FROM circles WHERE id = ?').bind(circle).first<{ leader: string | null }>())?.leader ? DOOR_MAX : MAX_MEMBERS
/** One more of an anonymous daily count (on the /stats page). */
const countUp = (db: D1Database, kind: string) =>
  db.prepare('INSERT INTO hello (period, kind, n) VALUES (?, ?, 1) ON CONFLICT (period, kind) DO UPDATE SET n = n + 1').bind(new Date().toISOString().slice(0, 10), kind).run()

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
    db.prepare('DELETE FROM circle_requests WHERE circle_id = ?1 AND user_id = ?2').bind(circle, userId),
    db.prepare(`DELETE FROM circle_blocks WHERE circle_id = ?1 AND (user_id = ?2 OR mid IN (SELECT mid FROM circle_members WHERE circle_id = ?1 AND user_id = ?2))`).bind(circle, userId),
    db.prepare('DELETE FROM circle_members WHERE circle_id = ?1 AND user_id = ?2').bind(circle, userId),
    db.prepare('DELETE FROM push_circles WHERE circle_id = ?1 AND endpoint IN (SELECT endpoint FROM push_subs WHERE user_id = ?2)').bind(circle, userId),
    // The leader of an Open door circle leaving closes it, for everyone.
    db.prepare('DELETE FROM circle_members WHERE circle_id = ?1 AND EXISTS (SELECT 1 FROM circles WHERE id = ?1 AND leader = ?2)').bind(circle, userId),
    ...['circle_chunks', 'circle_amens', 'circle_reacts', 'circle_replies', 'circle_items', 'circle_invites', 'circle_blocks', 'circle_requests', 'circle_door_bans', 'circle_codes', 'push_circles'].map(t =>
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
// The iPhone app: com.myquietbible.ios, in the developer team that publishes it.
const apns = (env: Env): Apns | undefined =>
  env.APNS_KEY_P8 && env.APNS_KEY_ID ? { p8: env.APNS_KEY_P8, keyId: env.APNS_KEY_ID, teamId: 'VBV7MKN8BZ', topic: 'com.myquietbible.ios' } : undefined
const isApns = (endpoint: string) => endpoint.startsWith(APNS_PREFIX)

/** Tell the other members' devices (or only `to`, whose prayer was prayed
 *  with) that something is new in this circle. At most once every two
 *  minutes per device and circle; the notification on the phone stays one
 *  per circle either way. */
async function notifyCircle(env: Env, circle: string, from: string, to?: string) {
  const v = vapid(env), a = apns(env)
  if (!v && !a) return
  const now = Date.now()
  const rows = (await env.DB.prepare(`SELECT s.endpoint, s.p256dh, s.auth FROM push_circles p JOIN push_subs s ON s.endpoint = p.endpoint
    JOIN circle_members m ON m.circle_id = p.circle_id AND m.user_id = s.user_id
    WHERE p.circle_id = ?1 AND s.user_id != ?2 AND (?3 IS NULL OR s.user_id = ?3) AND (p.sent IS NULL OR p.sent < ?4)
      AND NOT EXISTS (SELECT 1 FROM circle_blocks bl JOIN circle_members bm ON bm.circle_id = bl.circle_id AND bm.mid = bl.mid
        WHERE bl.circle_id = ?1 AND bl.user_id = s.user_id AND bm.user_id = ?2)`)
    .bind(circle, from, to ?? null, now - PUSH_GAP).all<Subscription>()).results
    .filter(r => isApns(r.endpoint) ? !!a : !!v)
  if (!rows.length) return
  await env.DB.batch(rows.map(r => env.DB.prepare('UPDATE push_circles SET sent = ? WHERE endpoint = ? AND circle_id = ?').bind(now, r.endpoint, circle)))
  const gone: string[] = []
  const one = (r: Subscription) => isApns(r.endpoint)
    ? sendApns(r.endpoint.slice(APNS_PREFIX.length), isApnsEnv(r.p256dh) ? r.p256dh : 'production', circle, a!)
    : send(r, { c: circle }, v!, circle)
  await Promise.all(rows.map(r => one(r).then(ok => { if (!ok) gone.push(r.endpoint) }, e => console.error('push', e))))
  if (gone.length) await env.DB.batch(gone.flatMap(e => [
    env.DB.prepare('DELETE FROM push_circles WHERE endpoint = ?').bind(e),
    env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(e),
  ]))
}

// Only the browsers' own push services: Chrome and Android (Google),
// Firefox (Mozilla), Safari (Apple), Edge (Windows). Nothing else is ever
// sent a request by this server. The iPhone app's devices are only a token
// (stored as apns:<token>); they're sent to Apple's two fixed addresses
// (worker/src/apns.ts), which are under push.apple.com too.
const PUSH_HOSTS = /^https:\/\/([\w-]+\.)*(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?\//
const cleanSub = (v: unknown): Subscription => {
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; apns?: unknown; env?: unknown } | null
  // The App Store iPhone app: its Apple push token, and which Apple server.
  if (s && 'apns' in s) {
    if (typeof s.apns !== 'string' || !APNS_TOKEN.test(s.apns) || !isApnsEnv(s.env)) throw new HttpError(400, 'Bad request')
    return { endpoint: APNS_PREFIX + s.apns, p256dh: s.env, auth: 'apns' }
  }
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
    return json({ key: v ? vapidPublic(v.jwk) : null, apns: !!apns(env) })
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
      if (isApns(s.endpoint) ? !apns(env) : !vapid(env)) throw new HttpError(503, 'Notifications aren’t set up yet. Try again later.')
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
  const looking = (a === 'invite' || a === 'door') && b && !c && req.method === 'GET'
  const userId = looking ? await session(req, env).catch(() => '') : await session(req, env)

  // The circles you're in, with your locked copy of each key, and when
  // someone else last shared, replied, or prayed with something of yours
  // (so the app can show a quiet dot; it says nothing of what).
  if (req.method === 'GET' && !a) {
    const rows = await db.prepare(`SELECT c.id, c.name, m.mid, m.wrapped, (SELECT COUNT(*) FROM circle_members x WHERE x.circle_id = c.id) AS members,
      MAX(COALESCE((SELECT MAX(at) FROM circle_items i WHERE i.circle_id = c.id AND i.user_id != m.user_id AND i.user_id NOT IN (${BLOCKED})), 0),
        COALESCE((SELECT MAX(at) FROM circle_replies r WHERE r.circle_id = c.id AND r.user_id != m.user_id AND r.user_id NOT IN (${BLOCKED})), 0),
        COALESCE((SELECT MAX(a.at) FROM circle_amens a JOIN circle_items i ON i.circle_id = a.circle_id AND i.id = a.item
          WHERE a.circle_id = c.id AND a.user_id != m.user_id AND i.user_id = m.user_id AND a.user_id NOT IN (${BLOCKED})), 0),
        COALESCE((SELECT MAX(x.at) FROM circle_reacts x JOIN circle_items i ON i.circle_id = x.circle_id AND i.id = x.item
          WHERE x.circle_id = c.id AND x.user_id != m.user_id AND i.user_id = m.user_id AND x.user_id NOT IN (${BLOCKED})), 0),
        COALESCE((SELECT MAX(q.at) FROM circle_requests q WHERE q.circle_id = c.id AND c.leader = m.user_id), 0),
        COALESCE((SELECT MAX(q.prayed) FROM circle_requests q WHERE q.circle_id = c.id AND q.user_id = m.user_id), 0)) AS latest,
      CASE WHEN c.leader IS NULL THEN NULL WHEN c.leader = m.user_id THEN 'lead' ELSE 'member' END AS door
      FROM circle_members m JOIN circles c ON c.id = m.circle_id WHERE m.user_id = ? ORDER BY m.joined`).bind(userId).all()
    const lead = await db.prepare('SELECT allowed, asked FROM door_leaders WHERE user_id = ?').bind(userId).first<{ allowed: number | null; asked: number }>()
    return json({ circles: rows.results, lead: lead ? (lead.allowed ? 'yes' : 'asked') : null })
  }
  if (req.method === 'POST' && !a) {
    const { id, name, wrapped, me, door } = await readJson<{ id: string; name: string; wrapped: string; me: string; door?: { pub: string; priv: string } }>(req)
    if (typeof id !== 'string' || !CIRCLE_ID.test(id) || !sealedText(name, 2000) || !sealedText(wrapped, 500) || !sealedText(me, 2000)) throw new HttpError(400, 'Bad request')
    if (door && (!sealedText(door.pub, 200) || !sealedText(door.priv, 1000))) throw new HttpError(400, 'Bad request')
    if (door && !(await db.prepare('SELECT 1 FROM door_leaders WHERE user_id = ? AND allowed IS NOT NULL').bind(userId).first())) throw new HttpError(403, 'Open door circles need a yes from My Quiet Bible first.')
    // One Open door circle each: the one link you share.
    if (door && await db.prepare('SELECT 1 FROM circles WHERE leader = ?').bind(userId).first()) throw new HttpError(409, 'You already lead an Open door circle.')
    const n = await db.prepare('SELECT COUNT(*) AS n FROM circle_members WHERE user_id = ?').bind(userId).first<{ n: number }>()
    if ((n?.n ?? 0) >= MAX_CIRCLES) throw new HttpError(413, `You can be in up to ${MAX_CIRCLES} circles`)
    if (await db.prepare('SELECT 1 FROM circles WHERE id = ?').bind(id).first()) throw new HttpError(409, 'Try again')
    await db.batch([
      db.prepare('INSERT INTO circles (id, name, created, leader, door_pub, door_priv) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, now, door ? userId : null, door?.pub ?? null, door?.priv ?? null),
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
        const most = await capOf(db, circle)
        if ((members?.n ?? 0) >= most) throw new HttpError(413, `A circle can have up to ${most} people`)
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
      const most = await capOf(db, inv.circle_id)
      if (inv.members >= most) throw new HttpError(413, `A circle can have up to ${most} people`)
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

  // An Open door link: anyone who has it may look, and join, as many times
  // as the leader leaves it open. Nobody taken out comes back in through it.
  if (a === 'door' && b && !c) {
    if (!CIRCLE_ID.test(b)) throw new HttpError(404, 'Not found')
    const door = await db.prepare(`SELECT c.id, c.name, c.leader, c.door_wrapped, m.name AS by_name, (SELECT COUNT(*) FROM circle_members x WHERE x.circle_id = c.id) AS members
      FROM circles c LEFT JOIN circle_members m ON m.circle_id = c.id AND m.user_id = c.leader WHERE c.door_id = ?`).bind(b)
      .first<{ id: string; name: string; leader: string; door_wrapped: string; by_name: string | null; members: number }>()
    if (!door) throw new HttpError(404, 'This Open door link has been closed. Ask for the new one.')
    const already = !!userId && !!(await db.prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(door.id, userId).first())
    if (req.method === 'GET') return json({ circle: door.id, wrapped: door.door_wrapped, name: door.name, by: door.by_name, members: door.members, already, door: true })
    if (req.method === 'POST' && userId) {
      const { wrapped, me } = await readJson<{ wrapped: string; me: string }>(req)
      if (!sealedText(wrapped, 500)) throw new HttpError(400, 'Bad request')
      if (already) {
        await db.prepare('UPDATE circle_members SET wrapped = ? WHERE circle_id = ? AND user_id = ?').bind(wrapped, door.id, userId).run()
        return json({ ok: true, circle: door.id })
      }
      if (!sealedText(me, 2000)) throw new HttpError(400, 'Bad request')
      if (await db.prepare('SELECT 1 FROM circle_door_bans WHERE circle_id = ? AND user_id = ?').bind(door.id, userId).first()) throw new HttpError(403, 'This circle’s leader took you out of it.')
      if (door.members >= DOOR_MAX) throw new HttpError(413, `A circle can have up to ${DOOR_MAX} people`)
      const n = await db.prepare('SELECT COUNT(*) AS n FROM circle_members WHERE user_id = ?').bind(userId).first<{ n: number }>()
      if ((n?.n ?? 0) >= MAX_CIRCLES) throw new HttpError(413, `You can be in up to ${MAX_CIRCLES} circles`)
      const res = await db.prepare('INSERT INTO circle_members (circle_id, user_id, mid, wrapped, name, joined) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .bind(door.id, userId, random(9), wrapped, me, now).run()
      if (res.meta.changes) ctx.waitUntil(countUp(db, 'door:join'))
      return json({ ok: true, circle: door.id })
    }
  }

  // Asking to lead an Open door circle. The app's maker says yes on /stats.
  if (a === 'lead' && !b && req.method === 'POST') {
    const { note, lang } = await readJson<{ note: string; lang?: string }>(req)
    const words = typeof lang === 'string' && isLang(lang) ? lang : 'en'
    const said = typeof note === 'string' ? note.trim().slice(0, 300) : ''
    if (!said) throw new HttpError(400, 'Bad request')
    const was = await db.prepare('SELECT allowed FROM door_leaders WHERE user_id = ?').bind(userId).first<{ allowed: number | null }>()
    if (was?.allowed) return json({ lead: 'yes' })
    await db.prepare('INSERT INTO door_leaders (user_id, asked, note, lang) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET note = excluded.note, lang = excluded.lang').bind(userId, now, said, words).run()
    if (!was) ctx.waitUntil(tellMaker(env, 'Someone asked to lead an Open door circle', `Someone asked to lead an Open door circle. In their words:\n\n${said}\n\nOpen the private stats page (/stats on the sync service) to say yes, or not now.\n\n— My Quiet Bible`))
    return json({ lead: 'asked' })
  }

  if (!a || !CIRCLE_ID.test(a)) throw new HttpError(404, 'Not found')
  const circle = a
  const mid = await membership(db, circle, userId)
  // An Open door circle: only its leader shares, invites, or renames it.
  const room = await db.prepare('SELECT leader, door_id, door_pub, door_priv, door_link FROM circles WHERE id = ?').bind(circle)
    .first<{ leader: string | null; door_id: string | null; door_pub: string | null; door_priv: string | null; door_link: string | null }>()
  const door = !!room?.leader, leading = door && room!.leader === userId
  const leaderOnly = () => { if (door && !leading) throw new HttpError(403, 'Only the circle’s leader can do that here.') }

  // Who's in it and what's been shared, newest first.
  if (req.method === 'GET' && !b) {
    const [named, members, items, amens, replies, reacts, blocked] = await Promise.all([
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
      db.prepare('SELECT mid FROM circle_blocks WHERE circle_id = ? AND user_id = ?').bind(circle, userId).all<{ mid: string }>(),
    ])
    if (!door) return json({ me: mid, name: named?.name, members: members.results, items: items.results, amens: amens.results, replies: replies.results, reacts: reacts.results,
      blocked: blocked.results.map(r => r.mid) })
    // Open door: everyone sees how many prayed with each thing, and nobody
    // but the leader sees who. The others see only the leader and themselves.
    const lead = (await db.prepare('SELECT mid FROM circle_members WHERE circle_id = ? AND user_id = ?').bind(circle, room!.leader).first<{ mid: string }>())?.mid ?? ''
    const prayed: Record<string, number> = {}
    for (const x of amens.results) prayed[x.item] = (prayed[x.item] ?? 0) + 1
    const seen = <T>(rows: T[]) => leading ? rows : rows.filter(r => { const m = (r as { mid: string }).mid; return m === lead || m === mid })
    return json({ me: mid, name: named?.name, members: seen(members.results), items: seen(items.results), amens: seen(amens.results), replies: seen(replies.results),
      reacts: seen(reacts.results), blocked: blocked.results.map(r => r.mid),
      door: { lead, open: !!room!.door_id, pub: room!.door_pub, prayed, ...(leading ? { id: room!.door_id, link: room!.door_link, priv: room!.door_priv } : {}) } })
  }
  // Open door, the leader's side: open the link (or a new one in its place), or close it.
  if (b === 'door' && !c) {
    if (!leading) throw new HttpError(403, 'Only the circle’s leader can do that here.')
    if (req.method === 'PUT') {
      const { id, wrapped, link } = await readJson<{ id: string; wrapped: string; link: string }>(req)
      if (typeof id !== 'string' || !CIRCLE_ID.test(id) || !sealedText(wrapped, 500) || !sealedText(link, 500)) throw new HttpError(400, 'Bad request')
      await db.prepare('UPDATE circles SET door_id = ?, door_wrapped = ?, door_link = ? WHERE id = ?').bind(id, wrapped, link, circle).run()
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      await db.prepare('UPDATE circles SET door_id = NULL, door_wrapped = NULL, door_link = NULL WHERE id = ?').bind(circle).run()
      return json({ ok: true })
    }
  }
  // Open door, the leader takes someone out: the link won't let them back.
  if (b === 'members' && c && /^[\w-]{4,20}$/.test(c) && !d && req.method === 'DELETE') {
    if (!leading) throw new HttpError(403, 'Only the circle’s leader can do that here.')
    const who = await db.prepare('SELECT user_id FROM circle_members WHERE circle_id = ? AND mid = ?').bind(circle, c).first<{ user_id: string }>()
    if (!who || who.user_id === userId) throw new HttpError(404, 'They’re no longer in this circle.')
    await db.batch([...leaveCircle(db, circle, who.user_id),
      db.prepare('INSERT INTO circle_door_bans (circle_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(circle, who.user_id, now)])
    return json({ ok: true })
  }
  // Open door prayer requests: sealed to the leader's key, so only the
  // leader reads them. Each person sees only their own (and whether the
  // leader prayed); the leader sees them all.
  if (b === 'requests' && door) {
    if (!c && req.method === 'GET') {
      const rows = leading
        ? await db.prepare(`SELECT q.id, m.mid, q.at, q.epk, q.body, q.prayed FROM circle_requests q JOIN circle_members m ON m.circle_id = q.circle_id AND m.user_id = q.user_id
            WHERE q.circle_id = ? ORDER BY q.at DESC LIMIT 300`).bind(circle).all()
        : await db.prepare('SELECT id, at, prayed FROM circle_requests WHERE circle_id = ? AND user_id = ? ORDER BY at DESC LIMIT 50').bind(circle, userId).all()
      return json({ requests: rows.results })
    }
    if (!c || !CIRCLE_ID.test(c)) throw new HttpError(404, 'Not found')
    if (!d && req.method === 'PUT') {
      if (leading) throw new HttpError(400, 'Bad request')
      const { epk, body } = await readJson<{ epk: string; body: string }>(req)
      if (!sealedText(epk, 200) || !sealedText(body, 6000)) throw new HttpError(400, 'Bad request')
      const sent = await db.prepare('SELECT COUNT(*) AS n FROM circle_requests WHERE circle_id = ? AND user_id = ? AND at > ?').bind(circle, userId, now - DAY).first<{ n: number }>()
      if ((sent?.n ?? 0) >= ASKS_PER_DAY) throw new HttpError(429, 'That’s all the prayer requests for today. Try again tomorrow.')
      const res = await db.prepare('INSERT INTO circle_requests (circle_id, id, user_id, at, epk, body) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(circle, c, userId, now, epk, body).run()
      if (res.meta.changes) ctx.waitUntil(Promise.all([countUp(db, 'door:ask'), notifyCircle(env, circle, userId, room!.leader!)]))
      return json({ ok: true })
    }
    if (d === 'prayed' && !e && req.method === 'PUT') {
      if (!leading) throw new HttpError(403, 'Only the circle’s leader can do that here.')
      const row = await db.prepare('UPDATE circle_requests SET prayed = ? WHERE circle_id = ? AND id = ? AND prayed IS NULL RETURNING user_id').bind(now, circle, c).first<{ user_id: string }>()
      if (row) ctx.waitUntil(Promise.all([countUp(db, 'door:prayed'), notifyCircle(env, circle, userId, row.user_id)]))
      return json({ ok: true })
    }
    if (!d && req.method === 'DELETE') {
      await db.prepare('DELETE FROM circle_requests WHERE circle_id = ? AND id = ? AND (user_id = ? OR ?)').bind(circle, c, userId, leading ? 1 : 0).run()
      return json({ ok: true })
    }
  }
  // Joining with a code, on the member's side: make one, see who typed it,
  // and allow them by sealing the circle key to their public key.
  if (b === 'code') {
    leaderOnly()
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
    leaderOnly()
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
  // Block someone in this circle: you stop seeing what they share or write
  // here, and hearing about it. They aren't told.
  if (b === 'blocks' && c && /^[\w-]{4,20}$/.test(c) && !d) {
    if (c === mid) throw new HttpError(400, 'Bad request')
    if (req.method === 'PUT') {
      await db.prepare('INSERT INTO circle_blocks (user_id, circle_id, mid, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(userId, circle, c, now).run()
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      await db.prepare('DELETE FROM circle_blocks WHERE user_id = ? AND circle_id = ? AND mid = ?').bind(userId, circle, c).run()
      return json({ ok: true })
    }
  }
  // Report something someone shared or wrote. It's sealed here, so `what` is
  // the words the person reporting saw, sent by them on purpose.
  if (b === 'report' && !c && req.method === 'POST') {
    const r = await readJson<{ mid: string; item?: string; reply?: string; what: string }>(req)
    const what = typeof r.what === 'string' ? r.what.trim().slice(0, 4000) : ''
    const id = (v: unknown) => v == null ? null : typeof v === 'string' && CIRCLE_ID.test(v) ? v : undefined
    const item = id(r.item), reply = id(r.reply)
    if (typeof r.mid !== 'string' || r.mid === mid || !what || item === undefined || reply === undefined) throw new HttpError(400, 'Bad request')
    const about = await db.prepare('SELECT user_id FROM circle_members WHERE circle_id = ? AND mid = ?').bind(circle, r.mid).first<{ user_id: string }>()
    if (!about) throw new HttpError(404, 'They’re no longer in this circle.')
    const sent = await db.prepare('SELECT COUNT(*) AS n FROM circle_reports WHERE by_user = ? AND at > ?').bind(userId, now - DAY).first<{ n: number }>()
    if ((sent?.n ?? 0) >= REPORTS_PER_DAY) throw new HttpError(429, 'Too many reports today. Try again tomorrow.')
    await db.prepare('INSERT INTO circle_reports (id, circle_id, by_user, about, item, reply, what, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(random(12), circle, userId, about.user_id, item, reply, what, now).run()
    ctx.waitUntil(tellAboutReport(env, what))
    return json({ ok: true })
  }
  if (b === 'invites' && !c && req.method === 'POST') {
    leaderOnly()
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
  const own = () => db.prepare('SELECT chunks, size FROM circle_items WHERE circle_id = ? AND id = ? AND user_id = ?').bind(circle, item, userId).first<{ chunks: number; size: number }>()

  if (!d) {
    if (req.method === 'PUT') {
      leaderOnly()
      const { body, chunks, size } = await readJson<{ body: string; chunks: number; size: number }>(req)
      if (!sealedText(body) || !Number.isInteger(chunks) || chunks < 0 || chunks > MAX_CHUNKS || !Number.isInteger(size) || size < 0 || size > MAX_CHUNKS * CHUNK_MAX) throw new HttpError(400, 'Bad request')
      const used = await db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM circle_items WHERE circle_id = ?').bind(circle).first<{ n: number }>()
      if ((used?.n ?? 0) + size > CIRCLE_QUOTA) throw new HttpError(413, 'This circle is full. Delete some older prayers to make room.')
      // Checked again inside the write, so items sent side by side can't all slip under the limit.
      const res = await db.prepare(`INSERT INTO circle_items (circle_id, id, user_id, at, body, chunks, size) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
        WHERE (SELECT COALESCE(SUM(size), 0) FROM circle_items WHERE circle_id = ?1) + ?7 <= ?8 ON CONFLICT DO NOTHING`)
        .bind(circle, item, userId, now, body, chunks, size, CIRCLE_QUOTA).run()
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
  // Its words or verses changed by the one who shared it: sealed again
  // whole, under the same address. Quiet: nobody is told.
  if (d === 'body' && !e && req.method === 'PUT') {
    leaderOnly()
    const { body } = await readJson<{ body: string }>(req)
    if (!sealedText(body)) throw new HttpError(400, 'Bad request')
    const res = await db.prepare('UPDATE circle_items SET body = ? WHERE circle_id = ? AND id = ? AND user_id = ?').bind(body, circle, item, userId).run()
    if (!res.meta.changes) throw new HttpError(404, 'Not found')
    return json({ ok: true })
  }
  // Replies: anyone in the circle may write one; only its writer removes it.
  if (d === 'replies' && e && CIRCLE_ID.test(e)) {
    if (req.method === 'PUT') {
      leaderOnly()
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
      leaderOnly()
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
    // The circle's limit counts each item at the size it declared, so its
    // audio may not grow past that: the chunks stored, with this one in
    // place of any it replaces, must fit. Checked inside each write.
    const fits = '(SELECT COALESCE(SUM(LENGTH(data)), 0) FROM circle_chunks WHERE circle_id = ?1 AND item = ?2 AND n != ?3) + ?5 <= ?6'
    const res = await db.prepare(`INSERT INTO circle_chunks (circle_id, item, n, data) SELECT ?1, ?2, ?3, ?4 WHERE ${fits} ON CONFLICT DO NOTHING`)
      .bind(circle, item, n, data, data.byteLength, it.size).run()
    if (!res.meta.changes) {
      const replaced = await db.prepare(`UPDATE circle_chunks SET data = ?4 WHERE circle_id = ?1 AND item = ?2 AND n = ?3 AND ${fits}`)
        .bind(circle, item, n, data, data.byteLength, it.size).run()
      if (!replaced.meta.changes) throw new HttpError(413, 'This prayer is larger than it said it would be')
    }
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

// Signing in another device with a code. The signed-in side makes the code,
// sees who typed it, and allows them by sealing a sign-in to their public
// key. The new side isn't signed in yet: it types the code (leaving its
// public key) and picks up what was sealed to it. Guessing a code gets
// nobody in: the signed-in person still has to allow, after checking that
// both screens show the same four digits.
async function deviceCodeRoute(req: Request, env: Env, parts: string[]): Promise<Response> {
  const db = env.DB, now = Date.now()
  const [code, step] = parts
  if (!code) {
    if (req.method !== 'POST') throw new HttpError(404, 'Not found')
    const userId = await session(req, env)
    const open = await db.prepare('SELECT COUNT(*) AS n FROM device_codes WHERE user_id = ? AND expires > ?').bind(userId, now).first<{ n: number }>()
    if ((open?.n ?? 0) >= 5) throw new HttpError(429, 'Several codes are already waiting. Try again in a few minutes.')
    await db.prepare('DELETE FROM device_codes WHERE expires < ?').bind(now).run()
    for (let i = 0; i < 5; i++) {
      const c = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
      const res = await db.prepare('INSERT INTO device_codes (code, user_id, created, expires) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .bind(c, userId, now, now + CODE_MS).run()
      if (res.meta.changes) return json({ code: c, expires: now + CODE_MS })
    }
    throw new HttpError(503, 'Try again')
  }
  if (!/^\d{6}$/.test(code) || parts.length > 2) throw new HttpError(404, 'Not found')

  // The new device, not signed in.
  if (req.method === 'POST' && step === 'ask') {
    const { pub, label } = await readJson<{ pub: string; label: string }>(req)
    if (!sealedText(pub, 200) || typeof label !== 'string' || label.length > 60) throw new HttpError(400, 'Bad request')
    const ip = await ipKey(req)
    const misses = await db.prepare('SELECT COUNT(*) AS n FROM device_code_misses WHERE ip = ? AND at > ?').bind(ip, now - HOUR).first<{ n: number }>()
    if ((misses?.n ?? 0) >= CODE_MISSES) throw new HttpError(429, 'Too many wrong codes. Try again in an hour.')
    // The same ask again (a second tap, a retry) finds its own request.
    const row = await db.prepare('UPDATE device_codes SET pub = ?, label = ? WHERE code = ? AND (pub IS NULL OR pub = ?) AND expires > ? RETURNING code')
      .bind(pub, label, code, pub, now).first()
    if (!row) {
      await db.batch([
        db.prepare('DELETE FROM device_code_misses WHERE at < ?').bind(now - HOUR),
        db.prepare('INSERT INTO device_code_misses (ip, at) VALUES (?, ?)').bind(ip, now),
      ])
      throw new HttpError(404, 'That code isn’t right, or it has expired. Check it and try again.')
    }
    return json({ ok: true })
  }
  if (req.method === 'POST' && step === 'take') {
    const { pub } = await readJson<{ pub: string }>(req)
    if (!sealedText(pub, 200)) throw new HttpError(400, 'Bad request')
    const row = await db.prepare('SELECT epk, sealed FROM device_codes WHERE code = ? AND pub = ? AND expires > ?').bind(code, pub, now)
      .first<{ epk: string | null; sealed: string | null }>()
    if (!row) throw new HttpError(404, 'That code was closed on the other device, or it expired. Make a new one there.')
    // Picked up: it's done with.
    if (row.sealed) await db.prepare('DELETE FROM device_codes WHERE code = ?').bind(code).run()
    return json(row)
  }
  if (req.method === 'POST' && step === 'stop') {
    const { pub } = await readJson<{ pub: string }>(req)
    await db.prepare('UPDATE device_codes SET pub = NULL, label = NULL WHERE code = ? AND pub = ? AND sealed IS NULL').bind(code, pub).run()
    return json({ ok: true })
  }

  // The signed-in device that made the code.
  if (step) throw new HttpError(404, 'Not found')
  const userId = await session(req, env)
  if (req.method === 'GET') {
    const row = await db.prepare('SELECT pub, label FROM device_codes WHERE code = ? AND user_id = ? AND expires > ?').bind(code, userId, now)
      .first<{ pub: string | null; label: string | null }>()
    if (!row) throw new HttpError(404, 'This code has expired.')
    return json(row)
  }
  if (req.method === 'PUT') {
    const { pub, epk, sealed } = await readJson<{ pub: string; epk: string; sealed: string }>(req)
    if (!sealedText(pub, 200) || !sealedText(epk, 200) || !sealedText(sealed)) throw new HttpError(400, 'Bad request')
    const res = await db.prepare('UPDATE device_codes SET epk = ?, sealed = ? WHERE code = ? AND user_id = ? AND pub = ? AND sealed IS NULL AND expires > ?')
      .bind(epk, sealed, code, userId, pub, now).run()
    if (!res.meta.changes) throw new HttpError(404, 'That device stopped waiting. Ask it to type the code again.')
    return json({ ok: true })
  }
  if (req.method === 'DELETE') {
    await db.prepare('DELETE FROM device_codes WHERE code = ? AND user_id = ?').bind(code, userId).run()
    return json({ ok: true })
  }
  throw new HttpError(404, 'Not found')
}

// ---------------------------------------------------------------------------
// Counting how many use the app, without knowing who (src/lib/hello.ts).
// Each device says hello at most once a day with a few yes/no answers; the
// service adds one to some counters. No id, no address, nothing else kept.

/** The ISO week a day falls in, like "2026-W45". */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const y = t.getUTCFullYear()
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / DAY + 1) / 7)
  return `${y}-W${String(week).padStart(2, '0')}`
}

// The app's languages (src/i18n.ts): an id like "de" or "zh-hant". Emails and
// notifications have words in English, French and Spanish; the others read English.
const LANGS = ['en', 'fr', 'es']
const KEEPS = ['7', '30', '90']
const TALLIES = ['pr', 'ch', 'sh', 'bm']
const HEARD_MODES = ['listen', 'along']
// Who reads aloud (src/lib/recordings.ts ids, the phone's voice, or nobody).
const VOICES: Record<string, string> = { hays: 'Barry Hays (BSB)', david: 'David (KJV)', tresor: 'Trésor Sonore (LSG)', voice: 'The phone’s voice', silent: 'No voice (highlight only)' }
const PLATFORMS: [string, string][] = [['ios', 'iPhone & iPad app'], ['mac', 'Mac app'], ['android', 'Android app'], ['fedi', 'In Fedi'], ['phone', 'Phone browser'], ['computer', 'Computer browser']]
const isLang = (l: string | null | undefined): l is string => !!l && /^[a-z]{2,3}(-han[st])?$/.test(l)
const regionName = (c: string) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(c) ?? c } catch { return c } }
const langName = (l: string) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(l.replace(/-(han[st])$/, (_, x: string) => '-' + x[0].toUpperCase() + x.slice(1))) ?? l } catch { return l } }

async function helloRoute(req: Request, env: Env) {
  // Only the app itself counts (a stray visit to the address doesn't).
  if (!origins(env).includes(req.headers.get('Origin') ?? '')) throw new HttpError(403, 'Not from the app')
  const q = new URL(req.url).searchParams, now = new Date()
  const day = now.toISOString().slice(0, 10)
  const counts: [string, string][] = [[day, 'day']]
  if (q.get('new') === '1') counts.push([day, 'new'])
  if (q.get('home') === '1') counts.push([day, 'home'])
  if (q.get('week') === '1') counts.push([isoWeek(now), 'week'])
  if (q.get('month') === '1') counts.push([day.slice(0, 7), 'month'])
  const lang = q.get('lang')
  if (isLang(lang)) counts.push([day, `lang:${lang}`])
  // Since its first hello under this count, and still opening a week, a
  // month, three months later (each told once by the device).
  if (q.get('start') === '1') counts.push([day, 'start'])
  for (const n of (q.get('kept') ?? '').split(',')) if (KEEPS.includes(n)) counts.push([day, `kept:${n}`])
  const bible = q.get('bible'), on = q.get('on'), h = Number(q.get('h') ?? NaN), wd = Number(q.get('wd') ?? NaN)
  if (bible && /^[A-Za-z0-9_-]{1,20}$/.test(bible)) counts.push([day, `bible:${bible}`])
  if (on && PLATFORMS.some(([id]) => id === on)) counts.push([day, `on:${on}`])
  if (Number.isInteger(h) && h >= 0 && h < 24) counts.push([day, `hour:${h}`])
  if (Number.isInteger(wd) && wd >= 0 && wd < 7) counts.push([day, `wd:${wd}`])
  // How many prayers, chapters, shares and bookmarks since the last hello.
  const adds: [string, string, number][] = counts.map(([period, kind]) => [period, kind, 1])
  for (const k of TALLIES) {
    const n = Number(q.get(k) ?? 0)
    if (Number.isInteger(n) && n > 0) adds.push([day, `total:${k}`, Math.min(n, 500)])
  }
  // Listened since the last hello (src/lib/heard.ts): each kind once.
  const said = (k: string, ok: (x: string) => boolean) => [...new Set((q.get(k) ?? '').split(',').filter(ok))].slice(0, 12)
  const modes = said('am', x => HEARD_MODES.includes(x))
  if (modes.length) {
    adds.push([day, 'heard', 1])
    if (q.get('aw') === '1') adds.push([isoWeek(now), 'heard-week', 1])
    if (q.get('amo') === '1') adds.push([day.slice(0, 7), 'heard-month', 1])
    for (const m of modes) adds.push([day, `heard:${m}`, 1])
    const id = (x: string) => /^[A-Za-z0-9_-]{1,20}$/.test(x)
    for (const x of said('as', id)) adds.push([day, `heardby:${x}`, 1])
    for (const x of said('ab', id)) adds.push([day, `heardin:${x}`, 1])
    for (const x of said('al', x => /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(x))) adds.push([day, `heardlang:${x}`, 1])
  }
  // The prayer map: prayed, and counting on the map (at most once in any 7
  // days, see src/lib/hello.ts). Only the country Cloudflare guesses from the
  // address is kept, added to that day's count; never the address itself.
  const cc = prayedIn(req, q)
  if (cc) adds.push([day, `prayedin:${cc}`, 1])
  await env.DB.batch(adds.map(([period, kind, n]) =>
    env.DB.prepare('INSERT INTO hello (period, kind, n) VALUES (?, ?, ?) ON CONFLICT (period, kind) DO UPDATE SET n = n + excluded.n').bind(period, kind, n)))
  return json({ ok: true })
}

/** The country to count a prayer in, or nothing: only when the device says
 *  it prayed and counts on the map, and only a real country (not Tor's "T1"
 *  or the unknown "XX"). */
export function prayedIn(req: Request, q: URLSearchParams): string | undefined {
  if (q.get('pw') !== '1' || !(Number(q.get('pr')) > 0)) return
  const cc = (req as Request & { cf?: { country?: unknown } }).cf?.country
  return typeof cc === 'string' && /^[A-Z]{2}$/.test(cc) && cc !== 'XX' && cc !== 'T1' ? cc : undefined
}

// A country lights up on the prayer map once at least this many devices
// prayed there in the last 7 days, so one person alone in a small country
// never shows. The map only says which countries, never how many in each.
export const MAP_FLOOR = 5
export const MAP_DAYS = 7

/** The countries lit on the prayer map: those with MAP_FLOOR praying devices
 *  in the last MAP_DAYS days, from counts like 'prayedin:FR' per day. */
export function litCountries(rows: { kind: string; n: number }[]) {
  return rows.filter(r => r.n >= MAP_FLOOR).map(r => r.kind.slice('prayedin:'.length)).filter(c => /^[A-Z]{2}$/.test(c)).sort()
}

async function worldRoute(req: Request, env: Env, ctx?: ExecutionContext) {
  // Everyone sees the same answer, so it's kept at the edge for an hour.
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default
  const key = new Request(new URL('/world', req.url).toString())
  const hit = await cache?.match(key)
  if (hit) return new Response(hit.body, hit)
  const since = new Date(Date.now() - (MAP_DAYS - 1) * DAY).toISOString().slice(0, 10)
  const { results } = await env.DB.prepare(
    "SELECT kind, SUM(n) AS n FROM hello WHERE kind LIKE 'prayedin:%' AND period >= ? AND period NOT LIKE '%W%' GROUP BY kind"
  ).bind(since).all<{ kind: string; n: number }>()
  const res = new Response(JSON.stringify({ c: litCountries(results) }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  })
  if (cache) { const put = cache.put(key, res.clone()); ctx ? ctx.waitUntil(put) : await put }
  return res
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// The maker's own page, dressed as the bridge of a quiet ship looking down on
// the world (his idea): still stars and a planet's edge drawn with CSS alone
// (no images, nothing fetched, nothing moving), calm console cards. Always
// dark, with big bright text for easy reading.
const STARS = [
  ['12% 18%', '#ffffff', 1.3], ['27% 72%', '#cfe8ff', 1], ['41% 33%', '#ffffff', 1], ['58% 81%', '#ffe9c4', 1.2], ['66% 12%', '#ffffff', 1],
  ['79% 47%', '#cfe8ff', 1.3], ['91% 76%', '#ffffff', 1], ['6% 58%', '#ffe9c4', 1], ['34% 91%', '#ffffff', 1], ['85% 22%', '#ffffff', 1],
  ['50% 55%', '#cfe8ff', 1], ['19% 40%', '#ffffff', 1], ['72% 64%', '#ffffff', 1], ['96% 40%', '#cfe8ff', 1], ['3% 90%', '#ffffff', 1.2],
// Faint on purpose: the stars sit far behind, the numbers come first.
].map(([at, c, r]) => `radial-gradient(${r}px ${r}px at ${at},${c}55 98%,transparent)`).join(',')
const STATS_STYLE = `html{background:${STARS},#05060f;background-size:240px 240px;background-attachment:fixed;color-scheme:dark}
body{font:20px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;max-width:46em;margin:0 auto;padding:28px 16px 56px;color:#eef3ff;background:transparent;min-height:100vh}
body:before,body:after{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none}
body:before{background:radial-gradient(ellipse 60% 40% at 85% 8%,#2a1d5244,transparent 70%)}
body:after{background:radial-gradient(circle at 50% 100%,#0c2a4a 0,#0a1f38 58%,#4fa8e0aa 59.3%,#1d4f7a55 60.5%,transparent 66%) 50% calc(100% + 72vmax)/150vmax 150vmax no-repeat}
h1{font-size:1.7em;line-height:1.15;margin:0 0 24px;letter-spacing:.05em;text-transform:uppercase;color:#bfe9f7;font-weight:600}
.why{margin:-2px 0 10px}.own{display:block;padding:14px 0 4px}.own input{margin-top:8px;max-width:8em;display:block}.verse{margin:-14px 0 8px;font-size:1.05em;line-height:1.45}.verse a{color:#e9d6a8;text-decoration:none}.verse .t{font-style:italic;display:inline;font-size:1em;color:inherit;margin:0}.verse span{display:block;font-style:normal;font-size:.8em;color:#c9b88f;margin-top:4px}
h2{font-size:1.05em;letter-spacing:.06em;text-transform:uppercase;color:#bfe9f7;margin:32px 0 12px;border-bottom:1px solid #9fd8f033;padding-bottom:6px}
h2:before{content:'\\25B8  ';color:#e9d6a8}
/* Tiles share each row; a short last row stretches, so no tile ever sits beside an empty gap. */
.grid{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}.card b.long{font-size:1.7em;line-height:1.4}@media (max-width:480px){.card b.long{font-size:1.25em}}.grid>.card{flex:1 1 calc((100% - (var(--cols,3) - 1) * 12px) / var(--cols,3));min-width:8em;box-sizing:border-box}
h3{font-size:.85em;letter-spacing:.06em;text-transform:uppercase;color:#9fc3d6;margin:20px 0 0;font-weight:600}
.choose{margin-top:36px;border:2px solid #9fd8f040;border-radius:14px;padding:4px 16px 16px;background:#0a1226f2}.choose summary{cursor:pointer;font-weight:bold;color:#bfe9f7;padding:14px 0;font-size:1.1em}
.pick{border:0;border-bottom:1px solid #9fd8f01f;margin:0;padding:12px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.pick legend{float:left;width:100%;padding:0 0 8px;font-size:1em}
.pick label{flex:1 1 6em;display:flex;align-items:center;justify-content:center;gap:8px;min-height:46px;border:2px solid #9fd8f040;border-radius:12px;cursor:pointer;color:#b9c7e6}
.pick label:has(input:checked){border-color:#e9d6a8;color:#fff;font-weight:bold;background:#e9d6a81f}.pick input[type=radio]{width:22px;height:22px;margin:0;accent-color:#e9d6a8}
.card{border:2px solid #9fd8f040;border-radius:14px;padding:14px 16px;background:#0a1226f7}
.card b{display:block;font-size:2.4em;line-height:1.1;color:#fff;font-variant-numeric:tabular-nums}.card span{color:#b9c7e6;font-size:.85em}
table{border-collapse:collapse;margin-top:12px;width:100%;background:#0a1226f7;border-radius:12px}td,th{text-align:right;padding:6px 10px;border-bottom:1px solid #9fd8f026;font-variant-numeric:tabular-nums}
th{color:#bfe9f7}td:first-child,th:first-child{text-align:left}p.note{color:#b9c7e6;font-size:.85em}
input,button{font:inherit;font-size:1.1em;padding:12px 14px;border-radius:12px;border:2px solid #9fd8f066;width:100%;box-sizing:border-box;margin-top:10px;background:#0a1226;color:#eef3ff}
button{background:#e9d6a8;color:#1a1408;border-color:#e9d6a8;font-weight:bold;min-height:56px;cursor:pointer}p.error{color:#ff8a80;font-weight:bold}
.report{--red:#ff8a80;border:2px solid var(--red);border-radius:14px;padding:14px 16px;background:#1a0d18ee;color:#eef3ff;margin-bottom:16px;scroll-margin-top:16px}
.report pre{white-space:pre-wrap;font:inherit;margin:8px 0}.report .when{color:#b9c7e6;font-size:.85em;margin:0}
.report .acts{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch;margin-top:6px}
.report .acts .bad{display:flex;flex-direction:column;gap:10px}.report .acts button{margin:0;height:100%}.report .acts .bad button{height:auto;flex:1 0 auto}
.report button.del{background:transparent;color:var(--red);border-color:var(--red);font-weight:normal;font-size:1em}
.report button.keep{font-size:1.2em}
.report .ask{border:2px solid var(--red);border-radius:12px;padding:12px 14px;margin-top:6px}.report .ask p{margin:0 0 4px;font-weight:bold;font-size:1.1em}
.report .ask small{display:block;color:#b9c7e6;margin-bottom:10px}
.mark{margin:20px 0 0;padding:14px 18px;border-left:3px solid #e9d6a8;background:#0a1226f2;border-radius:0 12px 12px 0;color:#f3e6c4;font-size:1.05em}`
// Under the title, a word from God rather than about the maker: Acts 5:29,
// or one of his own bookmarks (see myVerse).
const ACTS_5_29 = '« Pierre et les apôtres répondirent: Il faut obéir à Dieu plutôt qu’aux hommes. »'
const verseLine = (v: MyVerse | string) => typeof v === 'object'
  ? `<p class="verse" lang="${esc(v.lang)}"><a href="${esc(v.href)}"><span class="t" id="vt">…</span><span>${esc(v.ref)}</span></a></p>
<script>(()=>{const s=document.getElementById('vt'),a=s.parentNode,v=${JSON.stringify({ u: v.url, b: v.book, c: v.chapter, f: v.from, t: v.to })};
const no=e=>{s.textContent=${JSON.stringify(ACTS_5_29)};a.href='https://myquietbible.com/#/read/LSG/Acts/5?v=29';a.lastChild.textContent='Actes 5:29 (LSG)';const w=document.getElementById('vwhy');w.textContent='Acts 5:29 shows because '+e+'.';w.hidden=false};
fetch(v.u).then(r=>r.ok?r.json():Promise.reject('your Bible ('+v.u.split('/').pop()+') answered '+r.status)).then(d=>{const ch=(d.books[v.b]||[])[v.c-1]||[],w=[];for(let i=v.f;i<=v.t;i++)if(ch[i-1])w.push(ch[i-1].replace(/\{([^{}|]*)\|[^{}]*\}/g,'$1'));
if(!w.length)return no(v.b+' '+v.c+':'+v.f+' isn’t in that Bible');s.textContent='« '+w.join(' ')+' »'}).catch(e=>no(typeof e==='string'?e:'your Bible couldn’t load here'))})()</script><p class="note why" id="vwhy" hidden></p>`
  : `<p class="verse" lang="fr"><a href="https://myquietbible.com/#/read/LSG/Acts/5?v=29"><span class="t">${ACTS_5_29}</span><span>Actes 5:29 (LSG)</span></a></p>${v ? `<p class="note why">Acts 5:29 shows because ${esc(v)}.</p>` : ''}`
interface MyVerse { lang: string; href: string; ref: string; url: string; book: string; chapter: number; from: number; to: number }
/** One of the maker's bookmarks, picked at random each time the page opens,
 *  in his own Bible. Read from the one account STATS_EMAIL signs in to, and
 *  only its bookmarks; the words themselves are fetched by his browser from
 *  the app's site, like the app does. Nothing set or nothing saved: none. */
/** When it can't, a few words on why, shown small under Acts 5:29 (only
 *  the maker sees this page), so a setup slip is easy to spot. */
async function myVerse(env: Env): Promise<MyVerse | string> {
  if (!env.STATS_EMAIL) return 'the STATS_EMAIL secret hasn’t reached the sync service yet'
  if (!env.EMAIL_SECRET) return 'email sign-in is off on the sync service'
  try {
    // Forgiving about how the secret was typed: quotes, <>, "mailto:", spaces,
    // and several addresses separated by commas or spaces (the first that
    // belongs to an account with synced data wins).
    const emails = env.STATS_EMAIL.toLowerCase().replace(/mailto:/g, '').split(/[\s,;<>"']+/).filter(e => e.includes('@'))
    let row: { body: string } | null = null, known = false
    for (const e of emails) {
      const hash = await emailHash(env, e)
      row = await env.DB.prepare('SELECT d.body FROM emails e JOIN data d ON d.user_id = e.user_id WHERE e.hash = ?').bind(hash).first<{ body: string }>()
      if (row) break
      known ||= !!(await env.DB.prepare('SELECT 1 FROM emails WHERE hash = ?').bind(hash).first())
    }
    if (!row) {
      const shown = emails.map(emailHint).join(', ') || 'nothing that looks like an email'
      return known ? 'the account with that email has nothing synced yet'
        : `no account signs in with the STATS_EMAIL address (it reads as ${shown}; compare with the email shown in Settings → Account, or add that email there)`
    }
    const doc = JSON.parse(row.body) as { marks?: Record<string, { b?: 1; v?: string }>; settings?: { version?: unknown; language?: unknown } }
    const keys = Object.entries(doc.marks ?? {}).filter(([, m]) => m?.b === 1).map(([k]) => k.split('.'))
      .map(([book, c, v]) => ({ book, chapter: +c, verse: +v })).filter(k => /^\w+$/.test(k.book) && k.chapter > 0 && k.verse > 0)
    if (!keys.length) return 'the account with that email has no synced bookmarks (is it the account your devices sync to?)'
    // Bookmarks on neighbouring verses are one passage, as in Saved.
    const has = new Set(keys.map(k => `${k.book}.${k.chapter}.${k.verse}`))
    const starts = keys.filter(k => !has.has(`${k.book}.${k.chapter}.${k.verse - 1}`))
    const pick = starts[Math.floor(Math.random() * starts.length)]
    let to = pick.verse
    while (has.has(`${pick.book}.${pick.chapter}.${to + 1}`) && to - pick.verse < 9) to++
    const set = doc.settings ?? {}
    const version = typeof set.version === 'string' && /^[\w-]+$/.test(set.version) ? set.version : 'LSG'
    const lang = set.language === 'en' || set.language === 'es' || set.language === 'fr' ? set.language : version === 'LSG' ? 'fr' : 'en'
    const verses = to > pick.verse ? `${pick.verse}-${to}` : `${pick.verse}`
    return {
      lang, book: pick.book, chapter: pick.chapter, from: pick.verse, to,
      ref: `${plainBookName(pick.book, lang)} ${pick.chapter}:${verses} (${version})`,
      href: `https://myquietbible.com/#/read/${version}/${pick.book}/${pick.chapter}?v=${pick.verse}${to > pick.verse ? `&e=${to}` : ''}`,
      url: `https://myquietbible.com/data/bibles/${version}.json`,
    }
  } catch (e) { console.error('stats verse', e); return 'reading your bookmarks failed' }
}
const statsPage = (body: string, status = 200, verse: MyVerse | string = '') => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>MQB Observatory</title><style>${STATS_STYLE}</style></head><body><h1>MQB Observatory</h1>${verseLine(verse)}${body}</body></html>`,
  // Never shown inside another site's frame, where a page could line its own
  // buttons up over "Say yes" or "Remove" once the word is typed in.
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' } })

/** One number on the numbers page. A tile at 0 stays out of the way unless
 *  the maker asked to see it anyway (see chooser). */
interface Tile { id: string; label: string; value: string; sub: string; zero?: boolean }
/** Tiles that come and go together (a share of each Bible, say), shown or
 *  hidden as one. */
interface Group { id: string; title: string; tiles: Tile[] }
interface Section { title: string; tiles: Tile[]; groups?: Group[] }
/** Rows of even tiles: as few gaps in the last row as can be (4 tiles make
 *  2 rows of 2, 7 make 4 and 3), so no tile sits alone under a full row. */
const cols = (n: number) => n <= 3 ? n : [3, 4, 2].reduce((best, c) => (c - n % c) % c < (best - n % best) % best ? c : best)
const gridHtml = (tiles: Tile[]) => `<div class="grid" style="--cols:${cols(tiles.length)}">${tiles.map(tileHtml).join('')}</div>`
const tileHtml = (t: Tile) => `<div class="card">${esc(t.label)}<b${t.value.length > 6 ? ' class="long"' : ''}>${esc(t.value)}</b><span>${esc(t.sub)}</span></div>`
type Layout = Map<string, string>
const shows = (layout: Layout, id: string, zero: boolean) => layout.get(id) === 'show' || (!zero && layout.get(id) !== 'hide')
function sectionHtml(sec: Section, layout: Layout) {
  const isZero = (t: Tile) => !!t.zero || t.value === '0' || t.value === '0%'
  const tiles = sec.tiles.filter(t => shows(layout, t.id, isZero(t)))
  const groups = (sec.groups ?? []).filter(g => g.tiles.length && shows(layout, g.id, false))
  if (!tiles.length && !groups.length) return ''
  return `<h2>${esc(sec.title)}</h2>${tiles.length ? gridHtml(tiles) : ''}
${groups.map(g => `<h3>${esc(g.title)}, last 30 days</h3>${gridHtml(g.tiles)}`).join('')}`
}
/** "Choose what shows": for each tile, Show (even at 0), Unless 0 (the
 *  usual), or Hide. Big round choices, one row per tile. */
function chooser(sections: Section[], layout: Layout, key: string) {
  const row = (id: string, label: string) => {
    const how = layout.get(id) ?? 'auto'
    return `<fieldset class="pick"><legend>${esc(label)}</legend><input type="hidden" name="all" value="${esc(id)}">${([['show', 'Show'], ['auto', 'Unless 0'], ['hide', 'Hide']] as const)
      .map(([v, l]) => `<label><input type="radio" name="how:${esc(id)}" value="${v}"${how === v ? ' checked' : ''}>${l}</label>`).join('')}</fieldset>`
  }
  return `<details class="choose"><summary>Choose what shows</summary><p class="note">Tiles at 0 stay out of the way. Choose Show to keep one in sight anyway, or Hide to put one away.</p><form method="post" action="/stats"><input type="hidden" name="key" value="${esc(key)}">
${sections.map(sec => `<h3>${esc(sec.title)}</h3>${sec.tiles.map(t => row(t.id, t.label)).join('')}${(sec.groups ?? []).map(g => row(g.id, g.title)).join('')}`).join('')}
<h3>Other</h3>${row('mark', 'Devices found, without an ad')}${row('table', 'Day by day table')}
<label class="own">Your own family’s devices, left out of All devices ever<input type="number" name="own" min="0" max="99" inputmode="numeric" value="${esc(layout.get('own') ?? '0')}"></label>
<button type="submit" name="act" value="layout">Save</button></form></details>`
}

/** Two strings equal, compared in the same time whatever they hold. */
async function same(a: string, b: string) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)])
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return d === 0
}
// Wrong words, kept only in this Worker's memory for a minute.
const statsMisses = new Map<string, number[]>()

/** The private numbers page, for the app's maker only. The word is typed in
 *  a password box and sent in the request body, never in the address, so it
 *  stays out of history, bookmarks and logs; a password manager can fill it. */
async function statsRoute(req: Request, env: Env) {
  if (!env.STATS_KEY) throw new HttpError(404, 'Not found')
  const form = (error = '') => statsPage(`${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/stats"><input type="text" name="username" value="numbers" autocomplete="username" hidden>
<label>Your word<input type="password" name="key" autocomplete="current-password" autofocus required></label>
<button type="submit">Show the numbers</button></form>`, error ? 403 : 200)
  if (req.method === 'GET') return form()
  const ip = req.headers.get('CF-Connecting-IP') ?? '', at = Date.now()
  const recent = (statsMisses.get(ip) ?? []).filter(t => at - t < 60_000)
  if (recent.length >= 5) return form('Too many tries. Wait a minute.')
  const sent = await req.formData().catch(() => null)
  const key = String(sent?.get('key') ?? '')
  if (!(await same(key, env.STATS_KEY))) {
    statsMisses.set(ip, [...recent, at])
    return form('That word isn’t right.')
  }
  const act = String(sent?.get('act') ?? ''), which = String(sent?.get('report') ?? '')
  // Removing and taking someone out are two steps: the first press only asks.
  const asking = act === 'ask-remove' || act === 'ask-out' ? act : ''
  if (act && which && !asking) await moderate(env, act, which)
  // Asking to lead an Open door circle: yes, or not now (they can ask again).
  const who = String(sent?.get('who') ?? '')
  if (who && act === 'lead-yes') {
    const res = await env.DB.prepare('UPDATE door_leaders SET allowed = ? WHERE user_id = ? AND allowed IS NULL').bind(Date.now(), who).run()
    if (res.meta.changes) await tellLeader(env, who)
  }
  if (who && act === 'lead-no') await env.DB.prepare('DELETE FROM door_leaders WHERE user_id = ? AND allowed IS NULL').bind(who).run()
  // Which tiles show: Show, Hide, or the usual (unless 0), for each listed.
  if (act === 'layout') {
    const listed = sent!.getAll('all').map(String).filter(id => /^[a-z0-9-]{1,40}$/.test(id)).slice(0, 100)
    const set = listed.map(id => [id, String(sent!.get(`how:${id}`) ?? '')] as const).filter(([, how]) => how === 'show' || how === 'hide')
    // How many of the devices are the maker's own family's, left out of Lifetime.
    const own = Math.min(99, Math.max(0, Math.floor(Number(sent!.get('own') ?? 0)) || 0))
    await env.DB.batch([env.DB.prepare('DELETE FROM stats_layout'), ...[...set, ...(own ? [['own', String(own)] as const] : [])]
      .map(([id, how]) => env.DB.prepare('INSERT OR REPLACE INTO stats_layout (id, how) VALUES (?, ?)').bind(id, how))])
  }
  const leadAsks = (await env.DB.prepare('SELECT user_id, note, asked FROM door_leaders WHERE allowed IS NULL ORDER BY asked LIMIT 20')
    .all<{ user_id: string; note: string | null; asked: number }>()).results
  const leadList = leadAsks.length ? `<h2>Asking to lead an Open door circle</h2>
${leadAsks.map(l => `<div class="report"><p class="when">${new Date(l.asked).toISOString().slice(0, 16).replace('T', ' ')} UTC</p><pre>${esc(l.note ?? '')}</pre>
<form method="post" action="/stats"><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="who" value="${esc(l.user_id)}">
<div class="acts"><button name="act" value="lead-no" class="del">Not now</button><button name="act" value="lead-yes" class="keep">Say yes</button></div></form></div>`).join('')}` : ''
  const reports = (await env.DB.prepare('SELECT id, what, at, item, reply FROM circle_reports WHERE done IS NULL ORDER BY at LIMIT 50')
    .all<{ id: string; what: string; at: number; item: string | null; reply: string | null }>()).results
  const reportForm = (id: string, inner: string) => `<form method="post" action="/stats#r-${esc(id)}"><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="report" value="${esc(id)}">${inner}</form>`
  const reportActs = (r: { id: string; item: string | null; reply: string | null }) => {
    if (asking && r.id === which) {
      const out = asking === 'ask-out'
      return reportForm(r.id, `<div class="ask"><p>${out ? 'Take this person out of the circle?' : 'Remove this from the circle?'}</p>
<small>${out ? 'Everything they shared in that circle goes too. This can’t be undone.' : 'It’s gone for everyone in the circle. This can’t be undone.'}</small>
<div class="acts"><button name="act" value="${out ? 'out' : 'remove'}" class="del">${out ? 'Take them out' : 'Remove it'}</button><button name="act" value="" class="keep">Cancel</button></div></div>`)
    }
    return reportForm(r.id, `<div class="acts"><div class="bad">${r.item || r.reply ? '<button name="act" value="ask-remove" class="del">Remove it</button>' : ''}<button name="act" value="ask-out" class="del">Take the person out of the circle</button></div>
<button name="act" value="keep" class="keep">Keep it, it’s fine</button></div>`)
  }
  const reportList = reports.length ? `<h2>Reported, waiting for you</h2>
${reports.map(r => `<div class="report" id="r-${esc(r.id)}"><p class="when">${new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')} UTC</p><pre>${esc(r.what)}</pre>
${reportActs(r)}</div>`).join('')}` : ''
  const now = new Date(), day = now.toISOString().slice(0, 10)
  const week = Date.now() - 7 * DAY
  const count = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<{ n: number }>().then(r => r?.n ?? 0)
  const [rows, accounts, circles, newAccounts, activeCircles, shared, prayedWith, notified, doors, doorsOpen, doorPeople, hiddenRows] = await Promise.all([
    env.DB.prepare('SELECT period, kind, n FROM hello').all<{ period: string; kind: string; n: number }>(),
    count('SELECT COUNT(*) AS n FROM users'),
    count('SELECT COUNT(*) AS n FROM circles'),
    count('SELECT COUNT(*) AS n FROM users WHERE created > ?', week),
    count('SELECT COUNT(DISTINCT circle_id) AS n FROM circle_items WHERE at > ?', week),
    count('SELECT COUNT(*) AS n FROM circle_items WHERE at > ?', week),
    count('SELECT COUNT(*) AS n FROM circle_amens WHERE at > ?', week),
    count('SELECT COUNT(DISTINCT user_id) AS n FROM push_subs'),
    count('SELECT COUNT(*) AS n FROM circles WHERE leader IS NOT NULL'),
    count('SELECT COUNT(*) AS n FROM circles WHERE leader IS NOT NULL AND door_id IS NOT NULL'),
    count('SELECT COUNT(*) AS n FROM circle_members m JOIN circles c ON c.id = m.circle_id WHERE c.leader IS NOT NULL AND m.user_id != c.leader'),
    env.DB.prepare('SELECT id, how FROM stats_layout').all<{ id: string; how: string }>(),
  ])
  const layout: Layout = new Map(hiddenRows.results.map(r => [r.id, r.how]))
  const own = Number(layout.get('own') ?? 0) || 0
  const get = (period: string, kind: string) => rows.results.find(r => r.period === period && r.kind === kind)?.n ?? 0
  const sum = (kind: string, from = '') => rows.results.filter(r => r.kind === kind && r.period >= from).reduce((a, r) => a + r.n, 0)
  const ever = Math.max(0, sum('new') - own)
  const since30 = new Date(now.getTime() - 29 * DAY).toISOString().slice(0, 10)
  const since7 = new Date(now.getTime() - 6 * DAY).toISOString().slice(0, 10)
  const n = (x: number) => x.toLocaleString('en')
  const pct = (part: number, whole: number) => whole ? `${Math.round(100 * part / whole)}%` : '0%'
  // Shares of the last 30 days' hellos: kind of device, Bible, app language.
  const split = (prefix: string, name: (id: string) => string, keep = 6, unit = 'daily hello'): Tile[] => {
    const ids = [...new Set(rows.results.filter(r => r.kind.startsWith(prefix) && r.period >= since30).map(r => r.kind.slice(prefix.length)))]
    const list = ids.map(id => [id, sum(prefix + id, since30)] as const).filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).slice(0, keep)
    const all = ids.reduce((a, id) => a + sum(prefix + id, since30), 0)
    return list.map(([id, x]) => ({ id: '', label: name(id), value: pct(x, all), sub: `${n(x)} ${unit}${x === 1 ? '' : 's'}` }))
  }
  // The busiest hour and day of the week for opening the app, last 30 days.
  const busiest = (prefix: string, span: number) => {
    let best = -1, top = 0
    for (let i = 0; i < span; i++) { const x = sum(prefix + i, since30); if (x > top) { top = x; best = i } }
    return best
  }
  const hour = busiest('hour:', 24), weekday = busiest('wd:', 7)
  const mapRows = [...new Set(rows.results.filter(r => r.kind.startsWith('prayedin:') && r.period >= since7).map(r => r.kind))].map(kind => ({ kind, n: sum(kind, since7) }))
  const mapLit = litCountries(mapRows), mapAny = mapRows.filter(r => r.n > 0).length
  // Still opening N days after a device's first day under this count, out of
  // the devices whose first day is at least N days ago.
  const kept = (days: number, label: string): Tile => {
    const before = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10)
    const old = rows.results.filter(r => r.kind === 'start' && r.period <= before).reduce((a, r) => a + r.n, 0)
    const still = sum(`kept:${days}`)
    return { id: `kept${days}`, label, value: pct(still, old), sub: `${n(still)} of ${n(old)} devices still opening it`, zero: !still }
  }
  const sections: Section[] = [
    { title: 'Today', tiles: [
      { id: 'today', label: 'Devices', value: n(get(day, 'day')), sub: 'opened the app today' },
      { id: 'today-new', label: 'New devices', value: n(get(day, 'new')), sub: 'opened it for the first time today' },
      { id: 'today-home', label: 'On a Home Screen', value: n(get(day, 'home')), sub: 'of today’s devices' },
    ] },
    { title: 'This week', tiles: [
      { id: 'week', label: 'Devices', value: n(get(isoWeek(now), 'week')), sub: 'opened the app since Monday' },
      { id: 'week-accounts', label: 'New accounts', value: n(newAccounts), sub: 'in the last 7 days' },
      { id: 'week-active', label: 'Active circles', value: n(activeCircles), sub: 'shared something, last 7 days' },
      { id: 'week-shared', label: 'Shared in circles', value: n(shared), sub: 'verses, notes and prayers, last 7 days' },
      { id: 'week-prayed', label: 'Prayed with', value: n(prayedWith), sub: '🙏 on something shared, last 7 days' },
      { id: 'week-door-in', label: 'Came in', value: n(sum('door:join', since7)), sub: 'through an Open door link, last 7 days' },
      { id: 'week-door-ask', label: 'Prayer requests', value: n(sum('door:ask', since7)), sub: 'sent to Open door leaders, last 7 days' },
      { id: 'week-door-prayed', label: 'Prayed for', value: n(sum('door:prayed', since7)), sub: 'requests a leader prayed for, last 7 days' },
    ] },
    { title: 'This month', tiles: [
      { id: 'month', label: 'Devices', value: n(get(day.slice(0, 7), 'month')), sub: 'opened the app this month' },
      { id: 'month-new', label: 'New in 30 days', value: n(sum('new', since30)), sub: 'devices opened it for the first time' },
      { id: 'hour', label: 'Busiest hour', value: hour < 0 ? '' : `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`, sub: 'when most open it first each day', zero: hour < 0 },
      { id: 'weekday', label: 'Busiest day', value: weekday < 0 ? '' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday], sub: 'of the week, last 30 days', zero: weekday < 0 },
    ], groups: [
      { id: 'devices', title: 'Kind of device', tiles: split('on:', id => PLATFORMS.find(([p]) => p === id)?.[1] ?? id) },
      { id: 'bibles', title: 'Bibles', tiles: split('bible:', id => id) },
      { id: 'languages', title: 'App languages', tiles: split('lang:', langName) },
    ] },
    // Listening (src/lib/heard.ts): told with the next day's hello, so a day
    // late, once a day per device whatever it played.
    { title: 'Listening', tiles: [
      { id: 'heard-today', label: 'Listened', value: n(get(day, 'heard')), sub: 'devices, told with today’s hello' },
      { id: 'heard-week', label: 'This week', value: n(get(isoWeek(now), 'heard-week')), sub: 'devices that listened' },
      { id: 'heard-month', label: 'This month', value: n(get(day.slice(0, 7), 'heard-month')), sub: 'devices that listened' },
      { id: 'heard-share', label: 'Of all openings', value: pct(sum('heard', since30), sum('day', since30)), sub: 'daily hellos with listening, last 30 days', zero: !sum('heard', since30) },
    ], groups: [
      { id: 'heard-how', title: 'Listen or Read along', tiles: split('heard:', id => id === 'listen' ? 'Listen (picked verses)' : 'Read along', 6, 'listening day') },
      { id: 'heard-by', title: 'Voices', tiles: split('heardby:', id => VOICES[id] ?? id, 6, 'listening day') },
      { id: 'heard-in', title: 'Bibles listened to', tiles: split('heardin:', id => id, 6, 'listening day') },
      { id: 'heard-lang', title: 'Languages listened in', tiles: split('heardlang:', langName, 6, 'listening day') },
    ] },
    // The prayer map (worldRoute): countries with praying devices in the
    // last 7 days, and those with enough of them to light up. No numbers
    // per country, here either.
    { title: 'Prayer map', tiles: [
      { id: 'map-lit', label: 'Countries lit', value: n(mapLit.length), sub: `with ${MAP_FLOOR}+ praying devices, last ${MAP_DAYS} days`, zero: !mapLit.length },
      { id: 'map-any', label: 'Countries praying', value: n(mapAny), sub: `any praying device, last ${MAP_DAYS} days`, zero: !mapAny },
      { id: 'map-names', label: 'Lit now', value: mapLit.length ? mapLit.map(regionName).join(', ') : 'None yet', sub: 'what everyone sees after Amen', zero: !mapLit.length },
    ] },
    { title: 'Lifetime', tiles: [
      { id: 'ever', label: 'All devices ever', value: n(ever), sub: own ? `since the count began, not counting your own ${n(own)}` : 'counted since the count began' },
      { id: 'accounts', label: 'Accounts', value: n(accounts), sub: 'signed up to sync' },
      { id: 'circles', label: 'Circles', value: n(circles), sub: 'made so far' },
      { id: 'notified', label: 'Notifications on', value: n(notified), sub: 'accounts hearing from their circles' },
      { id: 'doors', label: 'Open door circles', value: n(doors), sub: `${n(doorsOpen)} with the door open now` },
      { id: 'door-people', label: 'People in them', value: n(doorPeople), sub: 'not counting the leaders' },
      { id: 'total-pr', label: 'Prayers recorded', value: n(sum('total:pr')), sub: 'since this count began', zero: !sum('total:pr') },
      { id: 'total-ch', label: 'Chapters read', value: n(sum('total:ch')), sub: 'open half a minute or more', zero: !sum('total:ch') },
      { id: 'total-sh', label: 'Verses shared', value: n(sum('total:sh')), sub: 'outside the app or in circles', zero: !sum('total:sh') },
      { id: 'total-bm', label: 'Bookmarks saved', value: n(sum('total:bm')), sub: 'since this count began', zero: !sum('total:bm') },
      kept(7, 'Still opening after a week'),
      kept(30, 'Still opening after a month'),
      kept(90, 'Still opening after 3 months'),
    ] },
  ]
  const days = [...new Set(rows.results.filter(r => r.kind === 'day').map(r => r.period))].sort().reverse().slice(0, 30)
  // A quiet word among the stars: every device here found the app on its
  // own, with no ads and no social media. No target, no countdown.
  const found = ever && layout.get('mark') !== 'hide' ? `${n(ever)} device${ever === 1 ? ' has' : 's have'} found My Quiet Bible, all without a single ad.` : ''
  return statsPage(`${reportList}${leadList}${found ? `<p class="mark">\u2726 ${esc(found)}</p>` : ''}
${sections.map(sec => sectionHtml(sec, layout)).join('')}
${layout.get('table') === 'hide' ? '' : `<h2>Day by day</h2><table><tr><th>Day</th><th>Devices</th><th>New</th><th>Home Screen</th></tr>
${days.map(d => `<tr><td>${d}</td><td>${get(d, 'day')}</td><td>${get(d, 'new')}</td><td>${get(d, 'home')}</td></tr>`).join('')}
</table>`}<p class="note">Each device says hello at most once a day, with no name, id or address, so these count devices, not people.
On the first day, every device already using the app counts as new. Days are in UTC.</p>
${chooser(sections, layout, key)}`, 200, await myVerse(env))
}

/** "You can lead an Open door circle now", on each device of theirs that
 *  hears from circles, in the language they asked in. The app also shows it
 *  as a card in Circles, for a device without notifications. */
const LEAD_WORDS: Record<string, string> = {
  en: 'You can lead an Open door circle now. Open Circles to make it.',
  fr: 'Vous pouvez maintenant animer un cercle Porte ouverte. Ouvrez Cercles pour le créer.',
  es: 'Ya puedes dirigir un círculo Puerta abierta. Abre Círculos para crearlo.',
}
async function tellLeader(env: Env, userId: string) {
  const v = vapid(env), a = apns(env)
  if (!v && !a) return
  const lang = (await env.DB.prepare('SELECT lang FROM door_leaders WHERE user_id = ?').bind(userId).first<{ lang: string | null }>())?.lang ?? 'en'
  const text = LEAD_WORDS[lang] ?? LEAD_WORDS.en
  const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?').bind(userId).all<Subscription>()).results
  await Promise.all(subs.map(r => (isApns(r.endpoint)
    ? a ? sendApns(r.endpoint.slice(APNS_PREFIX.length), isApnsEnv(r.p256dh) ? r.p256dh : 'production', 'lead', a, { aps: { alert: { body: text } } }) : Promise.resolve(true)
    : v ? send(r, { t: 'lead', text }, v, 'lead') : Promise.resolve(true)).catch(e => console.error('lead push', e))))
}

/** What the maker decided about a report: remove what was reported, take
 *  the person out of the circle (with everything they shared there), or
 *  keep it. */
async function moderate(env: Env, act: string, id: string) {
  const db = env.DB
  const r = await db.prepare('SELECT circle_id, about, item, reply FROM circle_reports WHERE id = ? AND done IS NULL').bind(id)
    .first<{ circle_id: string; about: string; item: string | null; reply: string | null }>()
  if (!r) return
  if (act === 'remove' && r.reply && r.item) await db.prepare('DELETE FROM circle_replies WHERE circle_id = ? AND item = ? AND id = ? AND user_id = ?').bind(r.circle_id, r.item, r.reply, r.about).run()
  else if (act === 'remove' && r.item) {
    const own = await db.prepare('SELECT 1 FROM circle_items WHERE circle_id = ? AND id = ? AND user_id = ?').bind(r.circle_id, r.item, r.about).first()
    if (own) await db.batch(['circle_chunks', 'circle_amens', 'circle_reacts', 'circle_replies'].map(t => db.prepare(`DELETE FROM ${t} WHERE circle_id = ? AND item = ?`).bind(r.circle_id, r.item))
      .concat(db.prepare('DELETE FROM circle_items WHERE circle_id = ? AND id = ?').bind(r.circle_id, r.item)))
  } else if (act === 'out') await db.batch(leaveCircle(db, r.circle_id, r.about))
  else if (act !== 'keep') return
  await db.prepare('UPDATE circle_reports SET done = ? WHERE id = ?').bind(Date.now(), id).run()
}

/** A chapter of a recorded reading: <voice>/<Book>/<chapter>.mp3, from the
 *  service's own storage, in pieces when the player asks for a range (it
 *  does, to start a chapter at a verse). Files never change once there. */
async function audioRoute(req: Request, env: Env, key: string): Promise<Response> {
  if (!env.AUDIO || !/^[a-z]+\/[1-3]?[A-Za-z]+\/\d{1,3}\.mp3$/.test(key)) throw new HttpError(404, 'Not found')
  const obj = await env.AUDIO.get(key, { range: req.headers, onlyIf: req.headers })
  if (!obj) throw new HttpError(404, 'Not found')
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('Content-Type', 'audio/mpeg')
  headers.set('ETag', obj.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  headers.set('Access-Control-Allow-Origin', '*')
  if (!('body' in obj)) return new Response(null, { status: 304, headers })
  let status = 200
  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined
  if (r && req.headers.has('Range')) {
    const start = r.suffix !== undefined ? obj.size - r.suffix : r.offset ?? 0
    const length = r.suffix !== undefined ? r.suffix : r.length ?? obj.size - start
    headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${obj.size}`)
    headers.set('Content-Length', String(length))
    status = 206
  } else headers.set('Content-Length', String(obj.size))
  return new Response(req.method === 'HEAD' ? null : obj.body, { status, headers })
}

// Verse pictures for shared links' cards (card.ts): sent once from a Mac or
// computer, kept, and shown to Facebook, X and WhatsApp when they read the link.
const CARDS_PER_HOUR = 20
const CARDS_PER_DAY = 60
const CARDS_ALL_PER_DAY = 3000

async function cardSend(req: Request, env: Env): Promise<Response> {
  if (!env.AUDIO) throw new HttpError(404, 'Not found')
  if (Number(req.headers.get('Content-Length') ?? 0) > CARD_MAX) throw new HttpError(413, 'Too large')
  const body = new Uint8Array(await req.arrayBuffer())
  if (!isCard(body)) throw new HttpError(400, 'Bad request')
  const db = env.DB, now = Date.now(), ip = await ipKey(req)
  const [here, all] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n, COUNT(CASE WHEN at > ? THEN 1 END) AS h FROM card_sends WHERE ip = ? AND at > ?').bind(now - 3_600_000, ip, now - DAY).first<{ n: number; h: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM card_sends WHERE at > ?').bind(now - DAY).first<{ n: number }>(),
  ])
  if ((here?.h ?? 0) >= CARDS_PER_HOUR || (here?.n ?? 0) >= CARDS_PER_DAY || (all?.n ?? 0) >= CARDS_ALL_PER_DAY) {
    throw new HttpError(429, 'Too many links from here. Try again in an hour.')
  }
  const id = await cardId(body), key = `cards/${id}.png`
  // The same verse in the same look is the same picture: kept once.
  if (!await env.AUDIO.head(key)) {
    await env.AUDIO.put(key, body, { httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' } })
  }
  await db.batch([
    db.prepare('DELETE FROM card_sends WHERE at < ?').bind(now - DAY),
    db.prepare('INSERT INTO card_sends (ip, at) VALUES (?, ?)').bind(ip, now),
  ])
  return json({ id })
}

async function cardGet(req: Request, env: Env, name: string): Promise<Response> {
  const id = name.replace(/\.png$/, '')
  if (!env.AUDIO || !CARD_ID.test(id)) throw new HttpError(404, 'Not found')
  const obj = await env.AUDIO.get(`cards/${id}.png`)
  if (!obj) throw new HttpError(404, 'Not found')
  return new Response(req.method === 'HEAD' ? null : obj.body, { headers: {
    'Content-Type': 'image/png', 'Content-Length': String(obj.size), ETag: obj.httpEtag,
    'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*',
  } })
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
  if (pathname === '/devicecode' || pathname.startsWith('/devicecode/')) {
    return deviceCodeRoute(req, env, pathname.split('/').slice(2).filter(Boolean))
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
  if (pathname.startsWith('/card/') && (req.method === 'GET' || req.method === 'HEAD')) {
    return cardGet(req, env, pathname.slice(6))
  }
  if (pathname.startsWith('/audio/') && (req.method === 'GET' || req.method === 'HEAD')) {
    return audioRoute(req, env, decodeURIComponent(pathname.slice(7)))
  }

  switch (key) {
    case 'GET /hello': return helloRoute(req, env)
    case 'GET /world': return worldRoute(req, env, ctx)
    case 'POST /suggest': return suggestRoute(req, env)
    case 'POST /card': return cardSend(req, env)
    case 'GET /stats': case 'POST /stats': return statsRoute(req, env)
    case 'GET /': return json({ service: 'plain-bible-sync', ok: true, email: emailOn(env), push: !!vapid(env), apns: !!apns(env) })

    // Sign in (or sign up) with a code sent by email, or add an email to
    // the signed-in account.
    case 'POST /auth/email/start': return emailStart(req, env)
    // Sign in (or sign up) with a Nostr key, or add one to the signed-in
    // account. The app only offers it inside Fedi (see src/lib/nostr.ts).
    case 'POST /auth/nostr/options': return nostrStart(req, env)
    case 'POST /auth/nostr/verify': return nostrVerify(req, env)
    case 'POST /auth/email/verify': return emailVerify(req, env)
    case 'DELETE /auth/email': {
      const userId = await session(req, env)
      const [n, nostr] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').bind(userId).first<{ n: number }>(),
        env.DB.prepare('SELECT 1 FROM nostr_keys WHERE user_id = ?').bind(userId).first(),
      ])
      if (!n?.n && !nostr) throw new HttpError(400, 'Add a passkey first. Without your email or a passkey, you couldn’t sign in again.')
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
        env.DB.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports, created, rp_id, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(credential.id, ch.user_id, b64url.encode(credential.publicKey), credential.counter,
            credential.transports ? JSON.stringify(credential.transports) : null, now, rpID, KNOWN[v.registrationInfo.aaguid] ?? null),
      ])
      return json({ token: isNew ? await newSession(env, ch.user_id, credential.id) : undefined, added: !isNew })
    }

    // Sign in with any passkey saved for this site (no username).
    case 'POST /auth/login/options': {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' })
      return json({ challengeId: await saveChallenge(env, options.challenge, null), options })
    }

    case 'POST /auth/login/verify': {
      const cred = await assertion(env, await readJson<{ challengeId: string; response: AuthenticationResponseJSON }>(req), origin, rpID)
      return json({ token: await newSession(env, cred.user_id, cred.id) })
    }

    // "Which passkey is mine?" for a device signed in before sign-ins
    // remembered it, or by email: the passkey tapped becomes "This one".
    case 'POST /auth/passkey/check': {
      const userId = await session(req, env)
      const cred = await assertion(env, await readJson<{ challengeId: string; response: AuthenticationResponseJSON }>(req), origin, rpID)
      if (cred.user_id !== userId) throw new HttpError(400, 'This passkey belongs to another account.')
      await env.DB.prepare('UPDATE sessions SET cred_id = ? WHERE token_hash = ?').bind(cred.id, await sha256(bearer(req)!)).run()
      return json({ id: cred.id })
    }

    // Give a passkey a name of your own; an empty one goes back to its number.
    case 'PUT /auth/passkey': {
      const userId = await session(req, env)
      const { id, name } = await readJson<{ id: string; name: string }>(req)
      if (typeof id !== 'string' || typeof name !== 'string') throw new HttpError(400, 'Bad request')
      const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
      const res = await env.DB.prepare('UPDATE credentials SET name = ? WHERE id = ? AND user_id = ?').bind(clean || null, id, userId).run()
      if (!res.meta.changes) throw new HttpError(404, 'Not your passkey')
      return json({ name: clean || null })
    }

    // Forget a passkey. Not the last way in, and the device's password
    // manager still keeps its copy until it's deleted there too.
    case 'DELETE /auth/passkey': {
      const userId = await session(req, env)
      const { id } = await readJson<{ id: string }>(req)
      if (typeof id !== 'string') throw new HttpError(400, 'Bad request')
      const [keys, mail, nostr] = await Promise.all([
        env.DB.prepare('SELECT id FROM credentials WHERE user_id = ?').bind(userId).all<{ id: string }>(),
        env.DB.prepare('SELECT 1 FROM emails WHERE user_id = ?').bind(userId).first(),
        env.DB.prepare('SELECT 1 FROM nostr_keys WHERE user_id = ?').bind(userId).first(),
      ])
      if (!keys.results.some(k => k.id === id)) throw new HttpError(404, 'Not your passkey')
      if (keys.results.length === 1 && !mail && !nostr) throw new HttpError(400, 'This is your only way to sign in. Add another passkey or an email first.')
      await env.DB.batch([
        env.DB.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').bind(id, userId),
        env.DB.prepare('DELETE FROM prayer_wraps WHERE cred_id = ? AND user_id = ?').bind(id, userId),
        env.DB.prepare('UPDATE sessions SET cred_id = NULL WHERE cred_id = ? AND user_id = ?').bind(id, userId),
      ])
      return json({ ok: true })
    }

    // Forget one Fedi app's Nostr key, and the copy of the prayer key it
    // sealed. Not the last way in.
    case 'DELETE /auth/nostr': {
      const userId = await session(req, env)
      const { pubkey } = await readJson<{ pubkey: string }>(req)
      if (typeof pubkey !== 'string') throw new HttpError(400, 'Bad request')
      const [keys, mail, nostr] = await Promise.all([
        env.DB.prepare('SELECT 1 FROM credentials WHERE user_id = ?').bind(userId).first(),
        env.DB.prepare('SELECT 1 FROM emails WHERE user_id = ?').bind(userId).first(),
        env.DB.prepare('SELECT pubkey FROM nostr_keys WHERE user_id = ?').bind(userId).all<{ pubkey: string }>(),
      ])
      if (!nostr.results.some(k => k.pubkey === pubkey)) throw new HttpError(404, 'Bad request')
      if (nostr.results.length === 1 && !keys && !mail) throw new HttpError(400, 'This is your only way to sign in. Add another passkey or an email first.')
      await env.DB.batch([
        env.DB.prepare('DELETE FROM nostr_keys WHERE pubkey = ? AND user_id = ?').bind(pubkey, userId),
        env.DB.prepare('DELETE FROM prayer_wraps WHERE cred_id = ? AND user_id = ?').bind(NOSTR_WRAP + pubkey, userId),
      ])
      return json({ ok: true })
    }

    // A second sign-in for the same account, carried to the app's new
    // address inside a move, so signing out on one doesn't sign out both.
    case 'POST /auth/handoff': {
      const userId = await session(req, env)
      return json({ token: await newSession(env, userId) })
    }

    case 'POST /auth/logout': {
      const token = bearer(req)
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
      return json({ ok: true })
    }

    case 'GET /account': {
      const userId = await session(req, env)
      const [user, keys, data, email, mine, nostr] = await Promise.all([
        env.DB.prepare('SELECT created FROM users WHERE id = ?').bind(userId).first<{ created: number }>(),
        env.DB.prepare('SELECT id, created, last_used, rp_id, name FROM credentials WHERE user_id = ? ORDER BY created')
          .bind(userId).all<{ id: string; created: number; last_used: number | null; rp_id: string | null; name: string | null }>(),
        env.DB.prepare('SELECT updated FROM data WHERE user_id = ?').bind(userId).first<{ updated: number }>(),
        env.DB.prepare('SELECT hint FROM emails WHERE user_id = ?').bind(userId).first<{ hint: string }>(),
        env.DB.prepare('SELECT cred_id FROM sessions WHERE token_hash = ?').bind(await sha256(bearer(req)!)).first<{ cred_id: string | null }>(),
        env.DB.prepare('SELECT pubkey, created, last_used FROM nostr_keys WHERE user_id = ? ORDER BY created')
          .bind(userId).all<{ pubkey: string; created: number; last_used: number | null }>(),
      ])
      // The passkey this device signed in with is told apart by its
      // credential id: the one the session was made with.
      const list = keys.results.map(k => ({ id: k.id, name: k.name, created: k.created, lastUsed: k.last_used, site: k.rp_id, current: k.id === mine?.cred_id }))
      return json({ created: user?.created, passkeys: list.length, list, updated: data?.updated ?? null, email: email?.hint ?? null,
        nostr: nostr.results.length > 0, nostrKeys: nostr.results.map(k => ({ id: k.pubkey, created: k.created, lastUsed: k.last_used })) })
    }

    case 'DELETE /account': {
      const userId = await session(req, env)
      // Out of every circle first, taking what they shared with them.
      const circles = await env.DB.prepare('SELECT circle_id FROM circle_members WHERE user_id = ?').bind(userId).all<{ circle_id: string }>()
      for (const c of circles.results) await env.DB.batch(leaveCircle(env.DB, c.circle_id, userId))
      await env.DB.prepare('DELETE FROM push_circles WHERE endpoint IN (SELECT endpoint FROM push_subs WHERE user_id = ?)').bind(userId).run()
      await env.DB.batch(['circle_replies', 'circle_amens', 'circle_reacts', 'circle_invites', 'circle_blocks', 'circle_requests', 'door_leaders', 'prayer_chunks', 'prayer_parts', 'prayer_gone', 'prayer_wraps', 'prayer_keys', 'data', 'emails', 'email_codes', 'nostr_keys', 'approvals', 'push_subs', 'sessions', 'credentials', 'challenges'].map(t =>
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
