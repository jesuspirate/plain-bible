// Moving from the old address (bible.chama.community) to myquietbible.com,
// where the app is called Quiet Bible. See lib/move.ts for how it works.
import { useEffect, useState } from 'preact/hooks'
import { applyMove, fetchMove, makeDeviceLink, makeMoveLink, MOVED, MOVED_IN, movedIn, NEW_HOST, NEW_ORIGIN, onNewAddress, onOldAddress, parseMoveLink } from './lib/move'
import { loadAccount, register } from './lib/sync'
import { copyText, isIOS } from './lib/native'

const standalone = () => (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* ignore */ } }

// ---- the old address ------------------------------------------------------------

/** The card that moves this device: packs everything, then gives the link. */
export function MoveOut() {
  const [state, setState] = useState<'idle' | 'working' | 'ready'>('idle')
  const [step, setStep] = useState('')
  const [error, setError] = useState('')
  const [made, setMade] = useState<Awaited<ReturnType<typeof makeMoveLink>>>()
  const [copied, setCopied] = useState(false)
  const start = async () => {
    setState('working'); setError(''); setStep('Packing your Bible…')
    try {
      const r = await makeMoveLink((done, of) => setStep(of > 1 ? `Sending ${done} of ${of}…` : 'Sending…'))
      setMade(r); setState('ready')
    } catch (e) {
      setError((e as Error).message || String(e)); setState('idle')
    }
  }
  const copy = async () => {
    try { await copyText(made!.link); setCopied(true) } catch { setError('Couldn’t copy. Press and hold the link to copy it.') }
  }
  if (state === 'ready' && made) {
    const what = [plural(made.marks, 'highlighted or noted verse'), plural(made.prayers, 'prayer'), 'your settings and history']
    return (
      <div class="move-card">
        <p><strong>Ready to move.</strong> This link carries {what.join(', ')}{made.account ? ', and keeps you signed in' : ''}. It works for 7 days, on this device only, so keep it to yourself.</p>
        <p class="move-link" onClick={copy}>{made.link}</p>
        <div class="row wrap">
          <button class="primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy move link'}</button>
          <a class="button" href={made.link} target="_blank" rel="noopener">Open {NEW_HOST}</a>
        </div>
        {isIOS
          ? <ol class="move-steps small">
              <li>Copy the move link.</li>
              <li>In Safari, go to <strong>{NEW_HOST}</strong>, tap Share, then <strong>Add to Home Screen</strong>.</li>
              <li>Open <strong>Quiet Bible</strong> from your Home Screen and tap <strong>Paste move link</strong>.</li>
              <li>When everything is there, you can remove Plain Bible from your Home Screen.</li>
            </ol>
          : <p class="muted small">Tap Open, and everything appears there. To keep it as an app, install it from the browser’s menu.</p>}
        {error && <p class="note">{error}</p>}
      </div>
    )
  }
  return (
    <div class="move-card">
      <p><strong>Plain Bible is now Quiet Bible</strong>, at <strong>{NEW_HOST}</strong>.
        Move this device to bring everything with you: highlights, notes, settings, history and your prayers. Nothing is lost here; this address keeps working for now.</p>
      <button class="primary" disabled={state === 'working'} onClick={start}>{state === 'working' ? step : get(MOVED) ? 'Make a new move link' : 'Move this device'}</button>
      {error && <p class="note">{error}</p>}
    </div>
  )
}

/** A slim line under the top bar on the old address, until moved or put off. */
export function MoveBanner() {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(() => !onOldAddress() || +(get('plain-bible:move-later') || 0) > Date.now())
  // Only once the new address is up: until its DNS is set, a move link would lead nowhere.
  const [live, setLive] = useState(false)
  useEffect(() => {
    if (hidden || navigator.onLine === false) return
    fetch(`${NEW_ORIGIN}/manifest.webmanifest`, { mode: 'no-cors', cache: 'no-store' }).then(() => setLive(true), () => {})
  }, [])
  if (hidden || !live) return null
  if (open) return <div class="move-banner open"><MoveOut /><button class="link" onClick={() => setOpen(false)}>Close</button></div>
  return (
    <div class="move-banner">
      <span>{get(MOVED) ? 'Moved? Open Quiet Bible at ' : 'Plain Bible is moving to '}<strong>{NEW_HOST}</strong></span>
      <button class="primary" onClick={() => setOpen(true)}>Move</button>
      <button class="link" aria-label="Remind me tomorrow" onClick={() => { set('plain-bible:move-later', String(Date.now() + 86_400_000)); setHidden(true) }}>Later</button>
    </div>
  )
}

// ---- the new address ------------------------------------------------------------

/** Shown instead of the app while a move link is being taken in. */
export function Arriving({ link }: { link: { id: string; key: string } }) {
  const [step, setStep] = useState('Bringing your Bible over…')
  const [error, setError] = useState('')
  useEffect(() => {
    fetchMove(link, (done, of) => setStep(of > 1 ? `Bringing your Bible over… ${Math.round(done / of * 100)}%` : 'Bringing your Bible over…'))
      .then(({ bundle, prayers }) => applyMove(bundle, prayers))
      .then(() => { history.replaceState(null, '', location.pathname + '#/read'); location.reload() })
      .catch(e => setError((e as Error).message || String(e)))
  }, [])
  return (
    <div class="center">
      {error ? <>
        <p class="error">{error}</p>
        <p><button onClick={() => location.reload()}>Try again</button></p>
        <p><button onClick={() => { history.replaceState(null, '', location.pathname + '#/read'); location.reload() }}>Open the Bible</button></p>
      </> : <p class="muted">{step}</p>}
    </div>
  )
}

/** Paste a move link made on the old address, or a link from another device. */
export function PasteMove({ onDone }: { onDone?: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const go = (s: string) => {
    const link = parseMoveLink(s)
    if (!link) { setError('That isn’t a Quiet Bible link. Copy it again on the other device.'); return }
    location.hash = `#/move/${link.id}.${link.key}`
    location.reload()
  }
  const paste = async () => {
    try { go(await navigator.clipboard.readText()) } catch { setError('Couldn’t read the clipboard. Paste the link into the box instead.') }
  }
  return (
    <div class="move-paste">
      <div class="row wrap">
        {'clipboard' in navigator && 'readText' in navigator.clipboard && <button class="primary" onClick={paste}>Paste link</button>}
        {onDone && <button onClick={onDone}>Not now</button>}
      </div>
      <input type="url" class="move-input" placeholder="or paste it here" value={text} autocomplete="off"
        onInput={e => { const v = (e.target as HTMLInputElement).value; setText(v); if (parseMoveLink(v)) go(v) }} />
      {error && <p class="note">{error}</p>}
    </div>
  )
}

/** Settings → Your data, on the new address. */
export function MoveInSection() {
  if (!onNewAddress()) return null
  return (
    <div class="field"><span>Link from another device</span>
      <div class="col">
        <span class="muted small">Paste a link from Settings → Account → Link another device, or a move link from Plain Bible at bible.chama.community.</span>
        <PasteMove />
      </div>
    </div>
  )
}

/** After a move: what came, and a passkey for this address. Or, on a first
 *  start from the iPhone Home Screen (which keeps its own storage, apart from
 *  Safari), a way to paste the move link. */
export function MoveWelcome({ firstStart }: { firstStart: boolean }) {
  const [info, setInfo] = useState(movedIn)
  const [askPaste, setAskPaste] = useState(() => firstStart && !info && onNewAddress() && standalone())
  const [msg, setMsg] = useState('')
  const [working, setWorking] = useState(false)
  const [saved, setSaved] = useState(false)
  const [prayerKey, setPrayerKey] = useState(false)
  if (askPaste) return (
    <div class="move-welcome" role="dialog" aria-label="Moving in">
      <p><strong>Welcome to Quiet Bible.</strong> Have a link from another device, or a move link from Plain Bible? Paste it to bring everything over.</p>
      <PasteMove onDone={() => setAskPaste(false)} />
    </div>
  )
  if (!info) return null
  const close = () => { set(MOVED_IN, null); setInfo(null) }
  const acct = loadAccount()
  const fail = (e: unknown) => {
    const m = (e as Error).message
    setMsg(m === 'Cancelled' ? 'The passkey request was cancelled. Tap the button to try again.' : m)
  }
  // One passkey request per tap. Asking again straight after saving one
  // left password managers (Bitwarden) stuck on their own screen.
  const passkey = async () => {
    setWorking(true); setMsg('')
    try {
      await register(acct!.token)
      setSaved(true)
      const { prayerSyncOn } = await import('./lib/prayerSync')
      setPrayerKey(prayerSyncOn())
      setMsg('Passkey saved.')
    } catch (e) { fail(e) } finally { setWorking(false) }
  }
  // Optional: lets the new passkey unlock synced prayers on a new device.
  const unlockPrayers = async () => {
    setWorking(true); setMsg('')
    try {
      const { keepKeyWithPasskey } = await import('./lib/prayerSync')
      setMsg(await keepKeyWithPasskey()
        ? 'Done. This passkey now unlocks your synced prayers on new devices too.'
        : 'This passkey can’t unlock prayers. On a new device, type in your prayer key instead (Your prayers → Show prayer key).')
      setPrayerKey(false)
    } catch (e) { fail(e) } finally { setWorking(false) }
  }
  if (info.kind === 'link') return (
    <div class="move-welcome" role="dialog" aria-label="Linked">
      <p><strong>This device is linked.</strong> You’re signed in{info.prayerKey ? ' and your prayers are unlocked' : ''}. Your highlights, notes and settings arrive in a moment{info.prayerKey ? ', and your prayers right after' : ''}.</p>
      {isIOS && !standalone() && <p class="small">To keep it on your Home Screen: tap Share, then <strong>Add to Home Screen</strong>. If it opens signed out there, paste the same link once more (it works for an hour).</p>}
      <div class="row wrap"><button class="primary" onClick={close}>Done</button></div>
    </div>
  )
  const what = [plural(info.marks, 'highlighted or noted verse'), plural(info.prayers, 'prayer')]
  return (
    <div class="move-welcome" role="dialog" aria-label="Moved">
      <p><strong>Welcome to Quiet Bible.</strong> Your Bible moved: {what.join(', ')}, your settings and history.</p>
      {info.account && !saved && <p class="small">You’re still signed in. Save a passkey for {NEW_HOST} so you can sign in here later; the old one only works on the old address.</p>}
      {isIOS && !standalone() && <p class="small">To keep it on your Home Screen: tap Share, then <strong>Add to Home Screen</strong>. If it opens empty there, paste the same move link once more.</p>}
      <div class="row wrap">
        {info.account && !saved && <button class="primary" disabled={working} onClick={passkey}>{working ? 'Waiting for passkey…' : 'Save a passkey'}</button>}
        {saved && prayerKey && <button class="primary" disabled={working} onClick={unlockPrayers}>{working ? 'Waiting for passkey…' : 'Use it for prayers too'}</button>}
        <button onClick={close}>{info.account && !saved ? 'Later' : 'Done'}</button>
      </div>
      {msg && <p class="note">{msg}</p>}
    </div>
  )
}

/** Settings → Account, and Your prayers: a link that signs another device
 *  in and unlocks prayers there. */
export function DeviceLink({ class: cls = '', row }: { class?: string; row?: boolean }) {
  const [state, setState] = useState<'idle' | 'working' | 'ready'>('idle')
  const [made, setMade] = useState<{ link: string; prayers: boolean; locked: boolean }>()
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const make = async () => {
    setState('working'); setError('')
    try { setMade(await makeDeviceLink()); setState('ready') } catch (e) { setError((e as Error).message); setState('idle') }
  }
  const copy = async () => {
    try { await copyText(made!.link); setCopied(true) } catch { setError('Couldn’t copy. Press and hold the link to copy it.') }
  }
  const share = () => navigator.share?.({ title: 'Quiet Bible', url: made!.link }).catch(() => {})
  if (state === 'ready' && made) return (
    <div class={'move-card ' + cls}>
      <p class="small">Open this on your other device within an hour. It signs that device in{made.prayers ? ' and unlocks your prayers there' : ''}. Keep it private: whoever opens it gets into your account.</p>
      {made.locked && <p class="note small">Your prayers are locked on this device, so this link won’t bring them. Make the link on a device where Your prayers says <strong>Syncing with your devices</strong>, or unlock them here first under Your prayers.</p>}
      <p class="move-link" onClick={copy}>{made.link}</p>
      <div class="row wrap">
        <button class="primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        {'share' in navigator && <button onClick={share}>Send…</button>}
      </div>
      <p class="muted small">Send it to yourself privately: AirDrop, a note to yourself, or your password manager. On iPhone, add Quiet Bible to the Home Screen first, open it, and tap <strong>Paste link</strong>.</p>
      {error && <p class="note">{error}</p>}
    </div>
  )
  // As a row in a Settings card.
  if (row) return <>
    <button class="set-row" disabled={state === 'working'} onClick={make}>
      <span class="set-label">{state === 'working' ? 'Making a link…' : 'Link another device'}<span class="set-sub">Sign it in without typing anything</span></span>
    </button>
    {error && <p class="note small set-note">{error}</p>}
  </>
  return (
    <div class={cls}>
      <button class={cls ? 'pray-btn' : ''} disabled={state === 'working'} onClick={make}>{state === 'working' ? 'Making a link…' : 'Link another device'}</button>
      {error && <p class="note small">{error}</p>}
    </div>
  )
}
