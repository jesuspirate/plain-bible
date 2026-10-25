// Settings → Account: optional sign-in, by email code or passkey, that keeps
// highlights, bookmarks and settings the same on every device.
import { useEffect, useRef, useState } from 'preact/hooks'
import { Marks, saveMarks } from './lib/marks'
import {
  Account, accountInfo, changedAt, checkEmailSignIn, deleteAccount, docKey, emailSignInOn, loadAccount, mergeDocs, register,
  noteOwner, removeEmail, saveAccount, prepareSignIn, sendEmailCode, signIn, signOut, SYNC_URL, SyncDoc, SyncError, syncNow, takeSwitched,
  verifyEmailCode,
} from './lib/sync'
import { Settings, useApp } from './state'
import { addDays, DAYS_EVENT, loadDays } from './lib/streaks'
import { DeviceLink, PasteMove } from './move'
import { KeyBackup } from './approve'
import { CheckIcon, KeyIcon, MailIcon, RefreshIcon, SignOutIcon, TrashIcon } from './icons'
import { locale, t, tj, tn } from './i18n'

export interface SyncApi {
  enabled: boolean
  account: Account | null
  busy: boolean
  error: string
  run: () => void
  signedIn: (token: string) => void
  signedOut: () => void
  /** Send everything to the account now; throws if it couldn't. */
  flush: () => Promise<void>
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
      // Retired; a device not yet updated may still send it.
      delete remote.favorite
      if (JSON.stringify(doc.settings) !== JSON.stringify(local.settings)) {
        const ok = (id: unknown) => typeof id === 'string' && validVersion(id)
        setSettings(s => s && ({
          ...s, ...remote,
          version: ok(remote.version) ? remote.version! : s.version,
        }))
      }
      saveSettingsT({ ...doc.settingsT as Record<string, number>, ...Object.fromEntries(changedHere.map(k => [k, nowT[k]])) })
      setAccount(next); setError('')
      // Prayers sync too where turned on; that code loads only then.
      try { if (localStorage.getItem('plain-bible:prayer-sync')) import('./lib/prayerSync').then(m => m.syncPrayers()).catch(() => {}) } catch { /* ignore */ }
    } catch (e) {
      if (e instanceof SyncError && e.status === 401) { setAccount(null); setError(t('You were signed out. Sign in again to keep syncing.')) }
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
    const timer = setTimeout(auto, 2000)
    return () => clearTimeout(timer)
  }, [marks, settings, account?.token])
  // And shortly after a day is read or prayed.
  useEffect(() => {
    let timer = 0
    const on = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => { const local = localDoc(); if (loadAccount() && local && docKey(local) !== loadAccount()?.synced) auto() }, 2000)
    }
    addEventListener(DAYS_EVENT, on)
    return () => { clearTimeout(timer); removeEventListener(DAYS_EVENT, on) }
  }, [])

  useEffect(() => { if (account) noteOwner(account.token) }, [account?.token])

  return {
    enabled: !!SYNC_URL, account, busy, error, run: () => { run() },
    signedIn: token => {
      setAccount({ token, rev: 0 }); setError('')
      // Another account's things were just cleared from here: start afresh,
      // so none of them is still on screen to sync into this one.
      if (takeSwitched()) location.reload()
      else setTimeout(run, 0)
    },
    signedOut: () => setAccount(null),
    flush: async () => {
      const acct = loadAccount(), local = localDoc()
      if (!acct || !local) return
      if (navigator.onLine === false) throw new SyncError("You're offline. Connect to the internet to sign in or sync.")
      await syncNow(acct, local)
      if (localStorage.getItem('plain-bible:prayer-sync')) await (await import('./lib/prayerSync')).syncPrayers()
    },
  }
}

const LEFT = 'plain-bible:left'
const prayerSyncing = () => { try { return !!localStorage.getItem('plain-bible:prayer-sync') } catch { return false } }

/** A button that acts only once pressed and held until it fills, so a slip
 *  of the finger (or the mouse) can't set it off. Enter or Space held works
 *  too. */
function HoldToConfirm({ label, busy, onDone, ms = 2500 }: { label: string; busy: string; onDone: () => void; ms?: number }) {
  const [held, setHeld] = useState(false)
  const timer = useRef(0)
  const start = () => {
    if (busy || timer.current) return
    setHeld(true)
    timer.current = window.setTimeout(() => { timer.current = 0; setHeld(false); onDone() }, ms)
  }
  const stop = () => { clearTimeout(timer.current); timer.current = 0; setHeld(false) }
  useEffect(() => stop, [])
  return (
    <button class={'hold-confirm' + (held ? ' held' : '')} style={{ '--hold-ms': `${ms}ms` }} disabled={!!busy}
      onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); start() }}
      onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start() } }}
      onKeyUp={e => { if (e.key === 'Enter' || e.key === ' ') stop() }}>
      <span class="hold-fill" aria-hidden="true" />
      <span class="hold-label">{busy || label}</span>
    </button>
  )
}

/** Just signed out, or deleted the account: said once, after the app starts afresh. */
export function LeftNote() {
  const [note, setNote] = useState(() => { try { const n = sessionStorage.getItem(LEFT); sessionStorage.removeItem(LEFT); return n } catch { return null } })
  useEffect(() => { if (note) { const id = setTimeout(() => setNote(null), 6000); return () => clearTimeout(id) } }, [note])
  if (!note) return null
  return (
    <div class="move-welcome" role="status" onClick={() => setNote(null)}>
      <p>{note === 'deleted'
        ? <><strong>{t('Account deleted.')}</strong> {t('Your highlights, notes and prayers stay on this device.')}</>
        : <><strong>{t('Signed out.')}</strong> {t('Nothing of your account is left on this device.')}</>}</p>
    </div>
  )
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
        <input class="move-input" type="email" inputMode="email" autoComplete="email" placeholder={t('Your email')} value={email}
          onInput={e => setEmail((e.target as HTMLInputElement).value)} />
        <button class="primary" disabled={!!working || !/\S@\S+\.\S/.test(email)}>{working ? t('Sending…') : t('Email me a code')}</button>
      </form>
      {msg && <p class="note">{msg}</p>}
    </div>
  )
  const digits = code.replace(/\D/g, '')
  return (
    <div class="email-code">
      <p class="muted small">{tj('We emailed a 6-digit code to {email}. It can take a minute; look in spam too.', { email: <strong>{email.trim()}</strong> })}</p>
      <form class="row wrap" onSubmit={submit(() => check(digits))}>
        <input class="move-input code" inputMode="numeric" autoComplete="one-time-code" placeholder={t('6-digit code')} maxLength={7} value={code}
          onInput={e => {
            const v = (e.target as HTMLInputElement).value
            setCode(v)
            // Filled in from the email (or typed): go straight on.
            if (v.replace(/\D/g, '').length === 6) check(v.replace(/\D/g, ''))
          }} />
        <button class="primary" disabled={!!working || digits.length !== 6}>{working === 'check' ? t('Checking…') : token ? t('Add email') : t('Sign in')}</button>
      </form>
      <div class="row wrap">
        <button class="link" disabled={!!working} onClick={send}>{working === 'send' ? t('Sending…') : t('Send a new code')}</button>
        <button class="link" disabled={!!working} onClick={() => { setSent(false); setMsg('') }}>{t('Use another email')}</button>
      </div>
      {msg && <p class="note">{msg}</p>}
      {/* A new sending domain is sometimes held back or binned by mail services. */}
      <details class="account-more">
        <summary>{t('Code didn’t come?')}</summary>
        <p class="muted small">{t('Wait a minute, then look in Spam or Junk. If it’s there, mark it “Not spam” so the next one comes straight in.')}</p>
        {!token && <p class="muted small">{t('Still nothing? Use a passkey instead, or on a device that’s already signed in, open Settings → Account → Link another device.')}</p>}
      </details>
    </div>
  )
}

/** Settings → Account, all on one page: signed out, the ways in; signed in,
 *  who you are, sync, and the account's own buttons, as cards. */
export function AccountSection() {
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
      else if (label === 'login' || label === 'create') setMsg(t('The passkey request was cancelled or timed out. Tap the button to try again.'))
    }
    finally { setWorking('') }
  }
  const create = act('create', async () => { const t = await register(); if (t) sync.signedIn(t) })
  const login = act('login', async () => {
    try { sync.signedIn(await signIn()) } catch (e) { prepareSignIn(); throw e }
  })
  const addKey = act('add', async () => { await register(acct!.token); setMsg(t('Passkey added. You can now sign in with it on that device too.')) })
  // Signing out leaves nothing of the account here (see lib/signout). What
  // syncs is sent first, so it's all safe in the account; if that can't
  // happen, you're asked before anything is lost.
  const [confirming, setConfirm] = useState<'' | 'out' | 'unsaved' | 'delete'>('')
  const [onlyHere, setOnlyHere] = useState(0)
  const ask = async (which: 'out' | 'delete') => {
    setMsg('')
    if (which === 'out') setOnlyHere(await import('./lib/signout').then(m => m.prayersOnlyHere(prayerSyncing())).catch(() => 0))
    setConfirm(which)
  }
  const leave = async (note: 'out' | 'deleted', personal: boolean, prayers: boolean) => {
    await (await import('./lib/signout')).forgetAccount({ personal, prayers })
    try { sessionStorage.setItem(LEFT, note) } catch { /* ignore */ }
    sync.signedOut()
    location.reload()
  }
  const logout = (anyway: boolean) => act('logout', async () => {
    const syncing = prayerSyncing()
    if (!anyway) {
      try { await sync.flush() } catch { setConfirm('unsaved'); return }
    }
    await signOut(acct!.token)
    // Prayers go too only when they're all in the account.
    await leave('out', true, syncing && !anyway)
  })()
  const dropEmail = act('email', async () => {
    if (!confirm(t('Stop signing in with this email? You’ll sign in with your passkey only.'))) return
    await removeEmail(acct!.token); setMsg(t('Email removed.'))
  })
  // What's on this device stays: the account it synced with is gone.
  const remove = act('delete', async () => {
    await deleteAccount(acct!.token)
    await leave('deleted', false, false)
  })

  if (!acct) {
    // A passkey first: nothing to wait for and no mail to lose. Email codes
    // are the way in for people without one, or on a browser without passkeys.
    if (email) return (
      <div class="account">
        <p class="muted">{t('Optional. Keep your highlights, notes, settings and prayers the same on all your devices.')}{' '}
          {passkeys ? t('Easiest with a passkey: Face ID, a fingerprint or your screen lock. No password.')
            : t('No password: we email you a code. New here? The same code makes your account.')}</p>
        {passkeys && <>
          <div class="row wrap">
            <button class="primary" disabled={!!working} onClick={login}>{working === 'login' ? t('Waiting for passkey…') : t('Sign in with a passkey')}</button>
            <button disabled={!!working} onClick={create}>{working === 'create' ? t('Waiting for passkey…') : t('New account with a passkey')}</button>
          </div>
          <p class="muted small">{t('No passkey? We can email you a code instead. New here? The same code makes your account.')}</p>
        </>}
        <EmailCode onToken={sync.signedIn} />
        <details class="account-more">
          <summary>{t('Got a link from your other device?')}</summary>
          <PasteMove />
        </details>
        {(msg || sync.error) && <p class="note">{msg || sync.error}</p>}
      </div>
    )
    return (
      <div class="account">
        <p class="muted">{t('Optional. Keep your highlights, notes, settings and prayers the same on all your devices.')}{' '}
          {t('No email, no password: Face ID, a fingerprint or your screen lock unlocks it.')}</p>
        {passkeys ? (
          <div class="row wrap">
            <button class="primary" disabled={!!working} onClick={create}>{working === 'create' ? t('Waiting for passkey…') : t('Create account')}</button>
            <button disabled={!!working} onClick={login}>{working === 'login' ? t('Waiting for passkey…') : t('Sign in')}</button>
          </div>
        ) : <p class="note">{t('This browser does not support passkeys.')}</p>}
        <details class="account-more">
          <summary>{t('Got a link from your other device?')}</summary>
          <PasteMove />
        </details>
        {(msg || sync.error) && <p class="note">{msg || sync.error}</p>}
      </div>
    )
  }

  const when = acct.lastSync ? new Date(acct.lastSync) : undefined
  const last = sync.busy ? t('Syncing…') : sync.error ? t('Couldn’t sync') : when
    ? t('Last synced {when}', { when: when.toDateString() === new Date().toDateString()
      ? when.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
      : when.toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
    : t('Sync is on')
  const keys = info?.passkeys ?? 0
  return (
    <div class="account account-page">
      <div class="set-list">
        <div class="set-row set-static">
          <span class="set-icon" aria-hidden="true"><CheckIcon size={24} /></span>
          <span class="set-label">{info?.email ? t('Signed in as {email}', { email: info.email }) : t('Signed in')}
            {info && <span class="set-sub">{tn(keys, '{n} passkey', '{n} passkeys')} · {t('since {date}', { date: new Date(info.created).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' }) })}</span>}
          </span>
        </div>
      </div>

      <h2 class="set-kicker">{t('Sync')}</h2>
      <div class="set-list">
        <button class="set-row" onClick={sync.run} disabled={sync.busy}>
          <span class="set-icon" aria-hidden="true"><RefreshIcon size={24} /></span>
          <span class="set-label">{t('Sync now')}<span class="set-sub">{last}</span></span>
        </button>
        <DeviceLink row />
      </div>
      <KeyBackup />

      <h2 class="set-kicker">{t('Sign-in')}</h2>
      <div class="set-list">
        {email && !addEmail && <button class="set-row" onClick={() => setAddEmail(true)} disabled={!!working}>
          <span class="set-icon" aria-hidden="true"><MailIcon size={24} /></span>
          <span class="set-label">{info?.email ? t('Change email') : t('Add an email')}{!info?.email && <span class="set-sub">{t('Another way in if you lose your passkey')}</span>}</span>
        </button>}
        <button class="set-row" onClick={addKey} disabled={!!working}>
          <span class="set-icon" aria-hidden="true"><KeyIcon size={24} /></span>
          <span class="set-label">{working === 'add' ? t('Waiting for passkey…') : keys ? t('Add another passkey') : t('Add a passkey')}
            <span class="set-sub">{keys ? t('Only for a device your passkeys don’t reach') : t('Face ID, a fingerprint or your screen lock')}</span></span>
        </button>
        {email && info?.email && !!keys && <button class="set-row" onClick={dropEmail} disabled={!!working}><span class="set-icon" aria-hidden="true"><MailIcon size={24} /></span><span class="set-label">{t('Remove email')}</span></button>}
      </div>
      {addEmail && <EmailCode token={acct.token} onAdded={hint => { setAddEmail(false); setMsg(t('You can now also sign in with {email}.', { email: hint })) }} />}

      {confirming === 'out' ? (
        <div class="confirm-card" role="alertdialog" aria-labelledby="confirm-title">
          <p id="confirm-title"><strong>{t('Sign out of this device?')}</strong></p>
          <p>{t('Your highlights, notes, prayers and circles stay safe in your account and come back when you sign in again. This device forgets them.')}</p>
          {onlyHere > 0 && <p class="small">{tn(onlyHere, '{n} prayer recorded here isn’t in your account. It stays on this device.', '{n} prayers recorded here aren’t in your account. They stay on this device.')}</p>}
          <div class="confirm-buttons">
            <button class="primary" disabled={!!working} onClick={() => logout(false)}>{working ? t('Signing out…') : t('Sign out')}</button>
            <button disabled={!!working} onClick={() => setConfirm('')}>{t('Cancel')}</button>
          </div>
        </div>
      ) : confirming === 'unsaved' ? (
        <div class="confirm-card" role="alertdialog" aria-labelledby="confirm-title">
          <p id="confirm-title"><strong>{t('Your latest changes couldn’t reach your account')}</strong></p>
          <p>{t('Connect to the internet and try again. If you sign out anyway, changes since you last synced are lost here. Prayers stay on this device.')}</p>
          <div class="confirm-buttons">
            <button class="primary" disabled={!!working} onClick={() => logout(false)}>{working ? t('Signing out…') : t('Try again')}</button>
            <button class="danger" disabled={!!working} onClick={() => logout(true)}>{t('Sign out anyway')}</button>
            <button disabled={!!working} onClick={() => setConfirm('')}>{t('Cancel')}</button>
          </div>
        </div>
      ) : confirming === 'delete' ? (
        <div class="confirm-card danger" role="alertdialog" aria-labelledby="confirm-title">
          <p id="confirm-title"><strong>{t('Delete your account for good?')}</strong></p>
          <p>{t('This can’t be undone. Deleted on every device: your synced highlights, notes and settings, your synced prayers, and your place in every circle, with what you shared there.')}</p>
          <p class="small">{t('This device keeps its own highlights, notes and prayers.')}</p>
          <div class="confirm-buttons">
            <HoldToConfirm label={t('Hold to delete')} busy={working === 'delete' ? t('Deleting…') : ''} onDone={remove} />
            <button disabled={!!working} onClick={() => setConfirm('')}>{t('Cancel')}</button>
          </div>
          <p class="muted small">{t('Press and hold the red button until it fills.')}</p>
        </div>
      ) : (
        <div class="set-list">
          <button class="set-row" onClick={() => ask('out')} disabled={!!working}><span class="set-icon" aria-hidden="true"><SignOutIcon size={24} /></span><span class="set-label">{t('Sign out')}</span></button>
          <button class="set-row danger" onClick={() => ask('delete')} disabled={!!working}><span class="set-icon" aria-hidden="true"><TrashIcon size={24} /></span><span class="set-label">{t('Delete account')}</span></button>
        </div>
      )}
      {(msg || sync.error) && <p class="note">{msg || sync.error}</p>}
    </div>
  )
}
