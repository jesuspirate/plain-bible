// Optional account sync. Sign-in is passkey only; the server keeps one JSON
// document per account. Everything also works signed out.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { mergeMark, Marks } from './marks'
import { isNative, WEB_URL } from './native'

export const SYNC_URL: string = (import.meta.env.VITE_SYNC_URL ?? '').replace(/\/$/, '')

export interface SyncDoc {
  v: 1
  marks: Marks
  settings: Record<string, unknown>
  /** when each setting last changed, ms since epoch. Older documents used
   *  one number for all settings. */
  settingsT: SettingsT
}
export type SettingsT = Record<string, number> | number

/** When `key` last changed according to `t`. */
export function changedAt(t: SettingsT | undefined, key: string) {
  return typeof t === 'number' ? t : t?.[key] ?? t?.['*'] ?? 0
}

/** Merge two documents: each verse keeps its newest mark (removals included)
 *  and its newest note, and each setting keeps its newest value. */
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
  return { v: 1, marks, settings, settingsT }
}

/** Stable text for comparing documents without caring about key order. */
export function docKey(d: SyncDoc) {
  const marks = Object.keys(d.marks).sort().map(k => [k, d.marks[k].c ?? '', d.marks[k].b ?? 0, d.marks[k].t, d.marks[k].n ?? '', d.marks[k].nt ?? 0, ...(d.marks[k].nv ? [d.marks[k].nv!.join()] : [])])
  const settings = Object.keys(d.settings ?? {}).sort().map(k => [k, d.settings[k], changedAt(d.settingsT, k)])
  return JSON.stringify([marks, settings])
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

async function api<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
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

// In the iOS app the page's origin is capacitor://localhost, which can't use
// passkeys for bible.chama.community. The native passkey API can, because
// the app and the site vouch for each other (associated domains).
const RP_ORIGIN = new URL(WEB_URL).origin
async function createPasskey(options: any) {
  if (!isNative) return startRegistration({ optionsJSON: options })
  const { CapacitorPasskey } = await import('@capgo/capacitor-passkey')
  return CapacitorPasskey.createCredential({ origin: RP_ORIGIN, publicKey: options }) as Promise<any>
}
async function usePasskey(options: any) {
  if (!isNative) return startAuthentication({ optionsJSON: options })
  const { CapacitorPasskey } = await import('@capgo/capacitor-passkey')
  return CapacitorPasskey.getCredential({ origin: RP_ORIGIN, publicKey: options }) as Promise<any>
}

// Native errors carry the WebAuthn error name in `code`; SimpleWebAuthn's
// errors keep it in `name` and use `code` for their own labels.
const cancelled = (e: unknown) => e instanceof Error &&
  [(e as { code?: string }).code, e.name].some(n => n === 'NotAllowedError' || n === 'AbortError')

/** Create an account, or with a token add a passkey to that account. */
export async function register(token?: string): Promise<string | undefined> {
  const { challengeId, options } = await api<{ challengeId: string; options: any }>('/auth/register/options', { method: 'POST', token, body: {} })
  let response
  try { response = await createPasskey(options) } catch (e) {
    if (cancelled(e)) throw new SyncError('Cancelled')
    throw new SyncError((e as Error).message)
  }
  const r = await api<{ token?: string }>('/auth/register/verify', { method: 'POST', token, body: { challengeId, response } })
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
  try { response = await usePasskey(options) } catch (e) {
    if (cancelled(e)) throw new SyncError('Cancelled')
    throw new SyncError((e as Error).message)
  }
  return (await api<{ token: string }>('/auth/login/verify', { method: 'POST', body: { challengeId, response } })).token
}

export const signOut = (token: string) => api('/auth/logout', { method: 'POST', token }).catch(() => {})
export const deleteAccount = (token: string) => api('/account', { method: 'DELETE', token })
export const accountInfo = (token: string) => api<{ created: number; passkeys: number; updated: number | null }>('/account', { token })

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
