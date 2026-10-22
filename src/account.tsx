// Settings → Account: optional passkey sign-in that keeps highlights,
// bookmarks and settings the same on every device.
import { useEffect, useRef, useState } from 'preact/hooks'
import { Marks, saveMarks } from './lib/marks'
import {
  Account, accountInfo, deleteAccount, docKey, loadAccount, mergeDocs, register, saveAccount,
  signIn, signOut, SYNC_URL, SyncDoc, SyncError, syncNow,
} from './lib/sync'
import { Settings, useApp } from './state'

export interface SyncApi {
  enabled: boolean
  account: Account | null
  busy: boolean
  error: string
  run: () => void
  signedIn: (token: string) => void
  signedOut: () => void
}

const T_KEY = 'plain-bible:settings-t'
export const loadSettingsT = () => { try { return +(localStorage.getItem(T_KEY) || 0) } catch { return 0 } }
export const saveSettingsT = (t: number) => { try { localStorage.setItem(T_KEY, String(t)) } catch { /* ignore */ } }

/** The sync engine: syncs on start, when the app comes back to the
 *  foreground, and a moment after any change. */
export function useSync(marks: Marks, setMarksState: (fn: (m: Marks) => Marks) => void,
  settings: Settings | undefined, setSettings: (fn: (s: Settings | undefined) => Settings | undefined) => void,
  validVersion: (id: string) => boolean): SyncApi {
  const [account, setAccountState] = useState<Account | null>(loadAccount)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef({ marks, settings })
  latest.current = { marks, settings }
  const running = useRef(false), again = useRef(false)
  const setAccount = (a: Account | null) => { saveAccount(a); setAccountState(a) }
  const localDoc = (): SyncDoc | null => latest.current.settings
    ? { v: 1, marks: latest.current.marks, settings: latest.current.settings as unknown as Record<string, unknown>, settingsT: loadSettingsT() }
    : null

  const run = async () => {
    const acct = loadAccount(), local = localDoc()
    if (!SYNC_URL || !acct || !local) return
    if (running.current) { again.current = true; return }
    running.current = true; setBusy(true)
    try {
      const { doc, account: next } = await syncNow(acct, local)
      // Merge again with the current state, in case something changed while syncing.
      setMarksState(cur => { const m = mergeDocs({ ...doc, marks: cur }, doc).marks; saveMarks(m); return m })
      if (doc.settingsT > local.settingsT) {
        const remote = doc.settings as Partial<Settings>
        setSettings(s => s && ({ ...s, ...remote, version: remote.version && validVersion(remote.version) ? remote.version : s.version }))
        saveSettingsT(doc.settingsT)
      }
      setAccount(next); setError('')
    } catch (e) {
      if (e instanceof SyncError && e.status === 401) { setAccount(null); setError('You were signed out. Sign in again to keep syncing.') }
      else setError((e as Error).message)
    } finally {
      running.current = false; setBusy(false)
      if (again.current) { again.current = false; run() }
    }
  }

  // On start (once settings exist) and whenever the app returns to the foreground.
  useEffect(() => { if (settings) run() }, [!!settings])
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  // Shortly after local changes.
  useEffect(() => {
    const local = localDoc()
    if (!account || !local || docKey(local) === account.synced) return
    const t = setTimeout(run, 2000)
    return () => clearTimeout(t)
  }, [marks, settings, account?.token])

  return {
    enabled: !!SYNC_URL, account, busy, error, run: () => { run() },
    signedIn: token => { setAccount({ token, rev: 0 }); setError(''); setTimeout(run, 0) },
    signedOut: () => setAccount(null),
  }
}

export function AccountSection() {
  const { sync } = useApp()
  const [msg, setMsg] = useState('')
  const [working, setWorking] = useState('')
  const [info, setInfo] = useState<{ passkeys: number; created: number }>()
  const acct = sync.account
  useEffect(() => { if (acct) accountInfo(acct.token).then(setInfo).catch(() => {}) }, [acct?.token, msg])
  if (!sync.enabled) return null
  const passkeys = typeof PublicKeyCredential !== 'undefined'

  const act = (label: string, fn: () => Promise<void>) => async () => {
    setWorking(label); setMsg('')
    try { await fn() } catch (e) { if ((e as Error).message !== 'Cancelled') setMsg((e as Error).message) }
    finally { setWorking('') }
  }
  const create = act('create', async () => { const t = await register(); if (t) sync.signedIn(t) })
  const login = act('login', async () => sync.signedIn(await signIn()))
  const addKey = act('add', async () => { await register(acct!.token); setMsg('Passkey added. You can now sign in with it on that device too.') })
  const logout = act('logout', async () => { await signOut(acct!.token); sync.signedOut() })
  const remove = act('delete', async () => {
    if (!confirm('Delete your account and its synced copy? Highlights stay on this device.')) return
    await deleteAccount(acct!.token); sync.signedOut(); setMsg('Account deleted.')
  })

  if (!acct) {
    return (
      <div class="account">
        <p class="muted">Optional. Sign in with a passkey to keep your highlights, bookmarks and settings the same on all your devices.
          No email, no password: your phone or computer unlocks it with Face ID, a fingerprint or your screen lock.</p>
        {passkeys ? (
          <div class="row wrap">
            <button class="primary" disabled={!!working} onClick={create}>{working === 'create' ? 'Waiting for passkey…' : 'Create account with a passkey'}</button>
            <button disabled={!!working} onClick={login}>{working === 'login' ? 'Waiting for passkey…' : 'Sign in'}</button>
          </div>
        ) : <p class="note">This browser does not support passkeys.</p>}
        {(msg || sync.error) && <p class="note">{msg || sync.error}</p>}
      </div>
    )
  }

  const when = acct.lastSync ? new Date(acct.lastSync).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''
  return (
    <div class="account">
      <p><strong>Sync is on.</strong> <span class="muted">{sync.busy ? 'Syncing…' : sync.error ? '' : when ? `Last synced ${when}.` : ''}</span></p>
      {info && <p class="muted small">{info.passkeys} {info.passkeys === 1 ? 'passkey' : 'passkeys'} · account created {new Date(info.created).toLocaleDateString()}</p>}
      <div class="row wrap">
        <button onClick={sync.run} disabled={sync.busy}>Sync now</button>
        <button onClick={addKey} disabled={!!working}>{working === 'add' ? 'Waiting for passkey…' : 'Add a passkey'}</button>
        <button onClick={logout} disabled={!!working}>Sign out</button>
        <button class="danger" onClick={remove} disabled={!!working}>Delete account</button>
      </div>
      <p class="muted small">Passkeys saved to iCloud Keychain or Google Password Manager already work on your other devices.
        Use “Add a passkey” to sign in from a device outside that ecosystem.</p>
      {(msg || sync.error) && <p class="note">{msg || sync.error}</p>}
    </div>
  )
}
