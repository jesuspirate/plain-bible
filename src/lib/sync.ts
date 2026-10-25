// Optional account sync. Sign-in is by passkey or by a code sent by email;
// the server keeps one JSON document per account. Everything also works
// signed out.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { mergeMark, Marks, upgrade } from './marks'
import { Days, mergeDays } from './streaks'
import { PRF_SALT } from './prayerCrypto'

export const SYNC_URL: string = (import.meta.env.VITE_SYNC_URL ?? '').replace(/\/$/, '')

export interface SyncDoc {
  v: 1
  marks: Marks
  settings: Record<string, unknown>
  /** when each setting last changed, ms since epoch. Older documents used
   *  one number for all settings. */
  settingsT: SettingsT
  /** the days you read and prayed, for streaks (see streaks.ts) */
  days?: Days
}
export type SettingsT = Record<string, number> | number

/** When `key` last changed according to `t`. */
export function changedAt(t: SettingsT | undefined, key: string) {
  return typeof t === 'number' ? t : t?.[key] ?? t?.['*'] ?? 0
}

/** Merge two documents: each verse keeps its newest mark (removals included)
 *  and each of its notes keeps its newest version, each setting keeps its
 *  newest value, and a day read or prayed on either side stays done. */
export function mergeDocs(a: SyncDoc, b: SyncDoc | null | undefined): SyncDoc {
  if (!b) return a
  const marks: Marks = { ...a.marks }
  for (const [k, m] of Object.entries(b.marks ?? {})) {
    marks[k] = mergeMark(marks[k], m)!
  }
  const settings: Record<string, unknown> = {}, settingsT: Record<string, number> = {}
  for (const k of new Set([...Object.keys(a.settings ?? {}), ...Object.keys(b.settings ?? {})])) {
    const ta = changedAt(a.settingsT, k), tb = changedAt(b.settingsT, k)
    const useB = k in (b.settings ?? {}) && (!(k in (a.settings ?? {})) || tb > ta)
    settings[k] = useB ? b.settings[k] : a.settings[k]
    settingsT[k] = useB ? tb : ta
  }
  return { v: 1, marks, settings, settingsT, days: mergeDays(a.days, b.days) }
}

/** Stable text for comparing documents without caring about key order. */
export function docKey(d: SyncDoc) {
  const marks = Object.keys(d.marks).sort().map(k => {
    const m = upgrade(d.marks[k])
    const ns = Object.keys(m.ns ?? {}).sort().map(id => { const x = m.ns![id]; return [id, x.n ?? null, x.t, x.c, x.v?.join() ?? ''] })
    return [k, m.c ?? '', m.b ?? 0, m.t, ns]
  })
  const settings = Object.keys(d.settings ?? {}).sort().map(k => [k, d.settings[k], changedAt(d.settingsT, k)])
  const days = Object.keys(d.days ?? {}).sort().map(k => [k, d.days![k]])
  return JSON.stringify([marks, settings, days])
}

// ---------------------------------------------------------------------------
// Local account state

const KEY = 'plain-bible:account'
export interface Account { token: string; rev: number; lastSync?: number; synced?: string }
export function loadAccount(): Account | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}
export function saveAccount(a: Account | null) {
  try { a ? localStorage.setItem(KEY, JSON.stringify(a)) : localStorage.removeItem(KEY) } catch { /* ignore */ }
}

export class SyncError extends Error {
  constructor(message: string, public status = 0, public body?: any) { super(message) }
}

const TIMEOUT_MS = 15000
const offline = () => navigator.onLine === false
const unreachable = () => new SyncError(offline()
  ? "You're offline. Connect to the internet to sign in or sync."
  : "Couldn't reach the sync server. Your highlights and settings are safe on this device. Try again in a minute.")

export async function api<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const req = () => fetch(SYNC_URL + path, {
    method: init.method ?? 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    // A stalled request would otherwise leave "Waiting for passkey…" up for minutes.
    signal: AbortSignal.timeout?.(TIMEOUT_MS),
  })
  let res: Response
  try {
    res = await req()
  } catch {
    // Mobile connections often drop the first request after waking up; one
    // quick retry hides that. Not for /verify: its challenge is single use.
    if (offline() || path.endsWith('/verify')) throw unreachable()
    await new Promise(r => setTimeout(r, 800))
    try { res = await req() } catch { throw unreachable() }
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new SyncError(body.error || `Sync service error (${res.status})`, res.status, body)
  return body as T
}

const cancelled = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')

// The same tap that signs in also asks the passkey for its PRF secret, the
// one that unlocks the account key (see prayerSync). Then circles and
// prayers open with no second passkey sheet. The secret stays on this
// device: it is taken out before the answer goes to the server.
const withPrf = (options: any) => ({ ...options, extensions: { ...options.extensions, prf: { eval: { first: PRF_SALT } } } })
type Answer = { rawId: string; clientExtensionResults: { prf?: { results?: { first?: BufferSource } } } }
function takeSecret(response: Answer) {
  const first = response.clientExtensionResults?.prf?.results?.first
  delete response.clientExtensionResults?.prf
  if (!first) return null
  const secret = new Uint8Array(first instanceof ArrayBuffer ? first : (first as ArrayBufferView).buffer).slice()
  return { credId: response.rawId, secret }
}
async function keepFromPasskey(token: string, s: ReturnType<typeof takeSecret>) {
  await import('./prayerSync').then(m => m.passkeySignedIn(token, s)).catch(() => {})
}

/** Create an account, or with a token add a passkey to that account. */
export async function register(token?: string): Promise<string | undefined> {
  const { challengeId, options } = await api<{ challengeId: string; options: any }>('/auth/register/options', { method: 'POST', token, body: {} })
  let response
  try { response = await startRegistration({ optionsJSON: withPrf(options) }) } catch (e) {
    if (cancelled(e)) throw new SyncError('Cancelled')
    throw new SyncError((e as Error).message)
  }
  // Only some passkeys give the secret as they're made (iCloud Keychain does).
  const secret = takeSecret(response as Answer)
  const r = await api<{ token?: string }>('/auth/register/verify', { method: 'POST', token, body: { challengeId, response } })
  setNoPasskey(false)
  const t = r.token ?? token
  if (t) await keepFromPasskey(t, secret)
  return r.token
}

// Sign-in options are fetched ahead of the tap. Safari only shows the passkey
// sheet if it opens soon after the tap, and a slow network in between makes it
// fail quietly, leaving the button stuck on "Waiting for passkey…".
type Options = { challengeId: string; options: any }
let prepared: { at: number; p: Promise<Options> } | null = null
const loginOptions = () => api<Options>('/auth/login/options', { method: 'POST', body: {} })
export function prepareSignIn() {
  if (prepared && Date.now() - prepared.at < 4 * 60_000) return
  const p = loginOptions()
  prepared = { at: Date.now(), p }
  p.catch(() => { if (prepared?.p === p) prepared = null })
}

export async function signIn(): Promise<string> {
  const ready = prepared && Date.now() - prepared.at < 4 * 60_000 ? prepared.p.catch(loginOptions) : loginOptions()
  prepared = null
  const { challengeId, options } = await ready
  let response
  try { response = await startAuthentication({ optionsJSON: withPrf(options) }) } catch (e) {
    if (cancelled(e)) throw new SyncError('Cancelled')
    throw new SyncError((e as Error).message)
  }
  const secret = takeSecret(response as Answer)
  const { token } = await api<{ token: string }>('/auth/login/verify', { method: 'POST', body: { challengeId, response } })
  setNoPasskey(false)
  await keepFromPasskey(token, secret)
  return token
}

export async function signOut(token: string) {
  // A device signing out stops hearing about its circles (see lib/push).
  try {
    if (localStorage.getItem('plain-bible:push-circles') && navigator.serviceWorker?.controller) {
      const sub = await (await navigator.serviceWorker.ready).pushManager?.getSubscription()
      if (sub) await api('/push', { method: 'DELETE', token, body: { endpoint: sub.endpoint } }).then(() => sub.unsubscribe())
    }
    localStorage.removeItem('plain-bible:push-circles')
  } catch { /* ignore */ }
  return api('/auth/logout', { method: 'POST', token }).catch(() => {})
}
export const deleteAccount = (token: string) => api('/account', { method: 'DELETE', token })
export const accountInfo = (token: string) => api<{ created: number; passkeys: number; updated: number | null; email: string | null }>('/account', { token })

// Email sign-in, where the server has it turned on. Remembered, so the form
// is there at once next time, offline included.
const EMAIL_KEY = 'plain-bible:email-signin'
export function emailSignInOn() {
  try { return localStorage.getItem(EMAIL_KEY) === '1' } catch { return false }
}
export async function checkEmailSignIn(): Promise<boolean> {
  const on = !!(await api<{ email?: boolean }>('/')).email
  try { on ? localStorage.setItem(EMAIL_KEY, '1') : localStorage.removeItem(EMAIL_KEY) } catch { /* ignore */ }
  return on
}
/** Email a 6-digit code. With a token, it adds the address to that account. */
export const sendEmailCode = (email: string, token?: string) =>
  api('/auth/email/start', { method: 'POST', token, body: { email } })
/** A token to sign in with, or with a token, the address added. */
export async function verifyEmailCode(email: string, code: string, token?: string) {
  const r = await api<{ token?: string; added?: boolean; email?: string; passkeys?: number }>('/auth/email/verify', { method: 'POST', token, body: { email, code } })
  if (r.token) setNoPasskey(!r.passkeys)
  return r
}

// Whether the account has no passkey (one signed in by email), so unlocking
// prayers and circles doesn't ask for a passkey that isn't there.
const NO_PASSKEY = 'plain-bible:no-passkey'
export const noPasskey = () => { try { return localStorage.getItem(NO_PASSKEY) === '1' } catch { return false } }
export const setNoPasskey = (none: boolean) => { try { none ? localStorage.setItem(NO_PASSKEY, '1') : localStorage.removeItem(NO_PASSKEY) } catch { /* ignore */ } }
export const removeEmail = (token: string) => api('/auth/email', { method: 'DELETE', token })

interface Remote { rev: number; updated: number | null; body: SyncDoc | null }

/** Pull, merge with local, push if anything changed. Returns the merged
 *  document and the new account state. */
export async function syncNow(account: Account, local: SyncDoc): Promise<{ doc: SyncDoc; account: Account }> {
  let remote = await api<Remote>('/data', { token: account.token })
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = mergeDocs(local, remote.body)
    const key = docKey(doc)
    if (remote.body && key === docKey(remote.body)) {
      return { doc, account: { ...account, rev: remote.rev, lastSync: Date.now(), synced: key } }
    }
    try {
      const r = await api<{ rev: number }>('/data', { method: 'PUT', token: account.token, body: { rev: remote.rev, body: doc } })
      return { doc, account: { ...account, rev: r.rev, lastSync: Date.now(), synced: key } }
    } catch (e) {
      if (e instanceof SyncError && e.status === 409) { remote = e.body as Remote; local = doc; continue }
      throw e
    }
  }
  throw new SyncError('Sync kept conflicting; try again in a moment.')
}
