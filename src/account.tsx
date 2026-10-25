// Settings → Account: optional sign-in, by email code or passkey, that keeps
// highlights, bookmarks and settings the same on every device.
import { useEffect, useRef, useState } from 'preact/hooks'
import { Marks, saveMarks } from './lib/marks'
import {
  Account, accountInfo, changedAt, checkEmailSignIn, deleteAccount, docKey, emailSignInOn, loadAccount, mergeDocs, register,
  removeEmail, saveAccount, prepareSignIn, sendEmailCode, signIn, signOut, SYNC_URL, SyncDoc, SyncError, syncNow, verifyEmailCode,
} from './lib/sync'
import { Settings, useApp } from './state'
import { addDays, DAYS_EVENT, loadDays } from './lib/streaks'
import { DeviceLink, PasteMove } from './move'

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
/** Per-setting change times. An older single number applies to every setting. */
export function loadSettingsT(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(T_KEY) || '{}')
    return typeof v === 'number' ? { '*': v } : v
  } catch { return {} }
}
export function saveSettingsT(t: Record<string, number>) {
  try { localStorage.setItem(T_KEY, JSON.stringify(t)) } catch { /* ignore */ }
}
/** Record that these settings changed now. */
export function touchSettings(keys: string[]) {
  if (keys.length) saveSettingsT({ ...loadSettingsT(), ...Object.fromEntries(keys.map(k => [k, Date.now()])) })
}

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
    ? { v: 1, marks: latest.current.marks, settings: latest.current.settings as unknown as Record<string, unknown>, settingsT: loadSettingsT(), days: loadDays() }
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
      addDays(doc.days)
      // A setting changed here while the sync was on its way (say, the theme
      // tapped) is newer than what came back: keep it, and send it next time.
      const nowT = loadSettingsT(), startT = local.settingsT
      const changedHere = Object.keys(nowT).filter(k => changedAt(nowT, k) > changedAt(startT, k))
      const remote = { ...doc.settings } as Partial<Settings> & Record<string, unknown>
      for (const k of changedHere) delete remote[k]
      if (JSON.stringify(doc.settings) !== JSON.stringify(local.settings)) {
        const ok = (id: unknown) => typeof id === 'string' && validVersion(id)
        setSettings(s => s && ({
          ...s, ...remote,
          version: ok(remote.version) ? remote.version! : s.version,
          favorite: ok(remote.favorite) ? remote.favorite : s.favorite,
        }))
      }
      saveSettingsT({ ...doc.settingsT as Record<string, number>, ...Object.fromEntries(changedHere.map(k => [k, nowT[k]])) })
      setAccount(next); setError('')
      // Prayers sync too where turned on; that code loads only then.
      try { if (localStorage.getItem('plain-bible:prayer-sync')) import('./lib/prayerSync').then(m => m.syncPrayers()).catch(() => {}) } catch { /* ignore */ }
    } catch (e) {
      if (e instanceof SyncError && e.status === 401) { setAccount(null); setError('You were signed out. Sign in again to keep syncing.') }
      else setError((e as Error).message)
    } finally {
      running.current = false; setBusy(false)
      if (again.current) { again.current = false; run() }
    }
  }

  // Everything works offline; changes made then are sent once back online.
  const auto = () => { if (navigator.onLine !== false) run() }
  // On start (once settings exist), whenever the app returns to the
  // foreground, and when the connection comes back.
  useEffect(() => { if (settings) auto() }, [!!settings])
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') auto() }
    document.addEventListener('visibilitychange', on)
    addEventListener('online', auto)
    return () => { document.removeEventListener('visibilitychange', on); removeEventListener('online', auto) }
  }, [])
  // Shortly after local changes.
  useEffect(() => {
    const local = localDoc()
    if (!account || !local || docKey(local) === account.synced) return
    const t = setTimeout(auto, 2000)
    return () => clearTimeout(t)
  }, [marks, settings, account?.token])
  // And shortly after a day is read or prayed.
  useEffect(() => {
    let t = 0
    const on = () => {
      clearTimeout(t)
      t = window.setTimeout(() => { const local = localDoc(); if (loadAccount() && local && docKey(local) !== loadAccount()?.synced) auto() }, 2000)
    }
    addEventListener(DAYS_EVENT, on)
    return () => { clearTimeout(t); removeEventListener(DAYS_EVENT, on) }
  }, [])

  return {
    enabled: !!SYNC_URL, account, busy, error, run: () => { run() },
    signedIn: token => { setAccount({ token, rev: 0 }); setError(''); setTimeout(run, 0) },
    signedOut: () => setAccount(null),
  }
}

/** Sign in with a 6-digit code sent by email, or with `token`, add an email
 *  to that account. A code rather than a link: on iPhone a link would open
 *  Safari, not the Home Screen app, and the two keep separate storage. */
function EmailCode({ token, onToken, onAdded }: { token?: string; onToken?: (t: string) => void; onAdded?: (hint: string) => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [working, setWorking] = useState('')
  const [msg, setMsg] = useState('')
  const act = (label: string, fn: () => Promise<void>) => async () => {
    if (working) return
    setWorking(label); setMsg('')
    try { await fn() } catch (e) { setMsg((e as Error).message) } finally { setWorking('') }
  }
  const send = act('send', async () => { await sendEmailCode(email.trim(), token); setSent(true); setCode('') })
  const check = (c: string) => act('check', async () => {
    const r = await verifyEmailCode(email.trim(), c, token)
    if (r.token) onToken?.(r.token)
    else if (r.added) onAdded?.(r.email ?? '')
  })()
  const submit = (fn: () => void) => (e: Event) => { e.preventDefault(); fn() }

  if (!sent) return (
    <div class="email-code">
      <form class="row wrap" onSubmit={submit(send)}>
        <input class="move-input" type="email" inputMode="email" autoComplete="email" placeholder="Your email" value={email}
          onInput={e => setEmail((e.target as HTMLInputElement).value)} />
        <button class="primary" disabled={!!working || !/\S@\S+\.\S/.test(email)}>{working ? 'Sending…' : 'Email me a code'}</button>
      </form>
      {msg && <p class="note">{msg}</p>}
    </div>
  )
  const digits = code.replace(/\D/g, '')
  return (
    <div class="email-code">
      <p class="muted small">We emailed a 6-digit code to <strong>{email.trim()}</strong>. It can take a minute; look in spam too.</p>
      <form class="row wrap" onSubmit={submit(() => check(digits))}>
        <input class="move-input code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" maxLength={7} value={code}
          onInput={e => {
            const v = (e.target as HTMLInputElement).value
            setCode(v)
            // Filled in from the email (or typed): go straight on.
            if (v.replace(/\D/g, '').length === 6) check(v.replace(/\D/g, ''))
          }} />
        <button class="primary" disabled={!!working || digits.length !== 6}>{working === 'check' ? 'Checking…' : token ? 'Add email' : 'Sign in'}</button>
      </form>
      <div class="row wrap">
        <button class="link" disabled={!!working} onClick={send}>{working === 'send' ? 'Sending…' : 'Send a new code'}</button>
        <button class="link" disabled={!!working} onClick={() => { setSent(false); setMsg('') }}>Use another email</button>
      </div>
      {msg && <p class="note">{msg}</p>}
    </div>
  )
}

/** With `onAccount`, "Sign-in options" is a row that opens its own page
 *  (Settings shows it as one, with a back arrow); `part="account"` is that page. */
export function AccountSection({ onAccount, part }: { onAccount?: () => void; part?: 'account' } = {}) {
  const { sync } = useApp()
  const [msg, setMsg] = useState('')
  const [working, setWorking] = useState('')
  const [info, setInfo] = useState<{ passkeys: number; created: number; email: string | null }>()
  const [email, setEmailOn] = useState(emailSignInOn)
  const [addEmail, setAddEmail] = useState(false)
  const acct = sync.account
  useEffect(() => { if (acct) accountInfo(acct.token).then(setInfo).catch(() => {}) }, [acct?.token, msg])
  useEffect(() => { if (!acct && SYNC_URL && navigator.onLine !== false) prepareSignIn() }, [acct?.token])
  useEffect(() => { if (SYNC_URL && navigator.onLine !== false) checkEmailSignIn().then(setEmailOn).catch(() => {}) }, [])
  if (!sync.enabled) return null
  const passkeys = typeof PublicKeyCredential !== 'undefined'

  const act = (label: string, fn: () => Promise<void>) => async () => {
    setWorking(label); setMsg('')
    try { await fn() } catch (e) {
      const m = (e as Error).message
      // Safari also reports a passkey sheet that never opened as cancelled.
      if (m !== 'Cancelled') setMsg(m)
      else if (label === 'login' || label === 'create') setMsg('The passkey request was cancelled or timed out. Tap the button to try again.')
    }
    finally { setWorking('') }
  }
  const create = act('create', async () => { const t = await register(); if (t) sync.signedIn(t) })
  const login = act('login', async () => {
    try { sync.signedIn(await signIn()) } catch (e) { prepareSignIn(); throw e }
  })
  const addKey = act('add', async () => { await register(acct!.token); setMsg('Passkey added. You can now sign in with it on that device too.') })
  const logout = act('logout', async () => { await signOut(acct!.token); sync.signedOut() })
  const dropEmail = act('email', async () => {
    if (!confirm('Stop signing in with this email? You’ll sign in with your passkey only.')) return
    await removeEmail(acct!.token); setMsg('Email removed.')
  })
  const remove = act('delete', async () => {
    if (!confirm('Delete your account and its synced copy? Highlights stay on this device.')) return
    await deleteAccount(acct!.token); sync.signedOut(); setMsg('Account deleted.')
  })

  if (!acct) {
    if (email) return (
      <div class="account">
        <p class="muted">Optional. Keep your highlights, notes, settings and prayers the same on all your devices.
          No password: we email you a code. New here? The same code makes your account.</p>
        <EmailCode onToken={sync.signedIn} />
        {passkeys && <>
          <p class="muted small">Or use a passkey: Face ID, a fingerprint or your screen lock.</p>
          <div class="row wrap">
            <button disabled={!!working} onClick={login}>{working === 'login' ? 'Waiting for passkey…' : 'Sign in with a passkey'}</button>
            <button disabled={!!working} onClick={create}>{working === 'create' ? 'Waiting for passkey…' : 'New account with a passkey'}</button>
          </div>
        </>}
        <details class="account-more">
          <summary>Got a link from your other device?</summary>
          <PasteMove />
        </details>
        {(msg || sync.error) && <p class="note">{msg || sync.error}</p>}
      </div>
    )
    return (
      <div class="account">
        <p class="muted">Optional. Keep your highlights, notes, settings and prayers the same on all your devices.
          No email, no password: Face ID, a fingerprint or your screen lock unlocks it.</p>
        {passkeys ? (
          <div class="row wrap">
            <button class="primary" disabled={!!working} onClick={create}>{working === 'create' ? 'Waiting for passkey…' : 'Create account'}</button>
            <button disabled={!!working} onClick={login}>{working === 'login' ? 'Waiting for passkey…' : 'Sign in'}</button>
          </div>
        ) : <p class="note">This browser does not support passkeys.</p>}
        <details class="account-more">
          <summary>Got a link from your other device?</summary>
          <PasteMove />
        </details>
        {(msg || sync.error) && <p class="note">{msg || sync.error}</p>}
      </div>
    )
  }

  const account = <>
    {info && <p class="muted small">
      {info.email && <>Email {info.email} · </>}
      {info.passkeys} {info.passkeys === 1 ? 'passkey' : 'passkeys'} · account created {new Date(info.created).toLocaleDateString()}
    </p>}
    <div class="row wrap">
      {email && info?.email && !addEmail && <button onClick={() => setAddEmail(true)} disabled={!!working}>Change email</button>}
      {email && info?.email && !!info.passkeys && <button onClick={dropEmail} disabled={!!working}>Remove email</button>}
      <button onClick={addKey} disabled={!!working}>{working === 'add' ? 'Waiting for passkey…' : info?.passkeys ? 'Add another passkey' : 'Add a passkey'}</button>
      <button onClick={logout} disabled={!!working}>Sign out</button>
      <button class="danger" onClick={remove} disabled={!!working}>Delete account</button>
    </div>
    {/* Signed in by email, it can look as if the passkeys went away; they didn't, and this button only ever makes a new one. */}
    <p class="muted small">{info?.passkeys
      ? `Your ${info.passkeys === 1 ? 'passkey still works' : `${info.passkeys} passkeys still work`}, however you signed in. Add another only for a device that can’t use ${info.passkeys === 1 ? 'it' : 'them'}: passkeys in iCloud Keychain, Google Password Manager or Bitwarden already reach your other devices.`
      : 'A passkey lets you sign in with Face ID, a fingerprint or your screen lock. Saved to iCloud Keychain, Google Password Manager or Bitwarden, it works on your other devices too.'}</p>
  </>
  if (part === 'account') return (
    <div class="account">
      {account}
      {addEmail && <EmailCode token={acct.token} onAdded={hint => { setAddEmail(false); setMsg(`You can now also sign in with ${hint}.`) }} />}
      {(msg || sync.error) && <p class="note">{msg || sync.error}</p>}
    </div>
  )

  const when = acct.lastSync ? new Date(acct.lastSync).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''
  return (
    <div class="account">
      <p><strong>Sync is on.</strong> <span class="muted">{sync.busy ? 'Syncing…' : sync.error ? '' : when ? `Last synced ${when}.` : ''}</span></p>
      <div class="row wrap">
        <button onClick={sync.run} disabled={sync.busy}>Sync now</button>
      </div>
      <DeviceLink />
      {/* Someone who signed in by passkey alone can add an email, so losing the passkey never locks them out. */}
      {email && info && !info.email && !addEmail && (
        <p class="muted small">Worried about losing your passkey? <button class="link" onClick={() => setAddEmail(true)}>Add your email</button> as another way to sign in.</p>
      )}
      {addEmail && <EmailCode token={acct.token} onAdded={hint => { setAddEmail(false); setMsg(`You can now also sign in with ${hint}.`) }} />}
      {onAccount
        ? <button class="link account-open" onClick={onAccount}>Sign-in options ›</button>
        : <details class="account-more"><summary>Sign-in options</summary>{account}</details>}
      {(msg || sync.error) && <p class="note">{msg || sync.error}</p>}
    </div>
  )
}
