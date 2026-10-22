// Optional account sync. Sign-in is passkey only; the server keeps one JSON
// document per account. Everything also works signed out.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type { Marks } from './marks'

export const SYNC_URL: string = (import.meta.env.VITE_SYNC_URL ?? '').replace(/\/$/, '')

export interface SyncDoc {
  v: 1
  marks: Marks
  settings: Record<string, unknown>
  /** when settings last changed, ms since epoch */
  settingsT: number
}

/** Merge two documents: each verse keeps its newest mark (removals included),
 *  and the newer settings win as a whole. */
export function mergeDocs(a: SyncDoc, b: SyncDoc | null | undefined): SyncDoc {
  if (!b) return a
  const marks: Marks = { ...a.marks }
  for (const [k, m] of Object.entries(b.marks ?? {})) {
    if (!marks[k] || (m.t ?? 0) > (marks[k].t ?? 0)) marks[k] = m
  }
  const newer = (b.settingsT ?? 0) > a.settingsT
  return { v: 1, marks, settings: newer ? b.settings : a.settings, settingsT: newer ? b.settingsT : a.settingsT }
}

/** Stable text for comparing documents without caring about key order. */
export function docKey(d: SyncDoc) {
  const marks = Object.keys(d.marks).sort().map(k => [k, d.marks[k].c ?? '', d.marks[k].b ?? 0, d.marks[k].t])
  return JSON.stringify([marks, d.settingsT])
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

async function api<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(SYNC_URL + path, { method: init.method ?? 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined })
  } catch {
    throw new SyncError('Could not reach the sync service. Check your connection.')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new SyncError(body.error || `Sync service error (${res.status})`, res.status, body)
  return body as T
}

const cancelled = (e: unknown) => e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')

/** Create an account, or with a token add a passkey to that account. */
export async function register(token?: string): Promise<string | undefined> {
  const { challengeId, options } = await api<{ challengeId: string; options: any }>('/auth/register/options', { method: 'POST', token, body: {} })
  let response
  try { response = await startRegistration({ optionsJSON: options }) } catch (e) {
    if (cancelled(e)) throw new SyncError('Cancelled')
    throw new SyncError((e as Error).message)
  }
  const r = await api<{ token?: string }>('/auth/register/verify', { method: 'POST', token, body: { challengeId, response } })
  return r.token
}

export async function signIn(): Promise<string> {
  const { challengeId, options } = await api<{ challengeId: string; options: any }>('/auth/login/options', { method: 'POST', body: {} })
  let response
  try { response = await startAuthentication({ optionsJSON: options }) } catch (e) {
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
