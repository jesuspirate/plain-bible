// Linking another device: a link that signs it in and unlocks prayers there.
// See lib/move.ts for how it works.
import { useEffect, useState } from 'preact/hooks'
import { applyMove, fetchMove, linkAccount, makeDeviceLink, MOVED_IN, movedIn, parseMoveLink } from './lib/move'
import { copyText, isIOS } from './lib/native'
import { PhoneIcon } from './icons'
import { ShowDeviceCode } from './devicecode'
import { t, tj } from './i18n'

const standalone = () => (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches
const set = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* ignore */ } }

/** Shown instead of the app while a device link is being taken in. It
 *  asks first: a link signs this device in to someone's account, and what's
 *  here then syncs to it, so nothing happens until you say so. */
export function Arriving({ link }: { link: { id: string; key: string } }) {
  const [step, setStep] = useState(() => t('Checking the link…'))
  const [error, setError] = useState('')
  const [ask, setAsk] = useState<{ got: Awaited<ReturnType<typeof fetchMove>>; email: string | null; signedIn: boolean }>()
  const toBible = () => { history.replaceState(null, '', location.pathname + '#/read'); location.reload() }
  const check = () => {
    setError(''); setStep(t('Checking the link…'))
    fetchMove(link)
      .then(async got => setAsk({ got, ...(await linkAccount(got.bundle)) }))
      .catch(e => setError((e as Error).message || String(e)))
  }
  useEffect(() => {
    // The app isn't running yet, so wear the theme picked here ourselves.
    try { const th = JSON.parse(localStorage.getItem('plain-bible:settings') || '{}').theme; if (th) document.documentElement.dataset.theme = th } catch { /* default look */ }
    check()
  }, [])
  const go = () => {
    if (!ask) return
    setAsk(undefined); setStep(t('Bringing your Bible over…'))
    applyMove(ask.got.bundle, ask.got.prayers).then(toBible).catch(e => setError((e as Error).message || String(e)))
  }
  if (ask && !error) return (
    <div class="move-ask">
      <div class="confirm-card move-ask-card" role="alertdialog" aria-labelledby="move-ask-title">
        <p id="move-ask-title" class="confirm-title"><strong>{t('Link this device to an account?')}</strong></p>
        <p>{ask.signedIn
          ? t('You’re already signed in on this device, and you stay signed in. The link only adds what it carries.')
          : t('This link signs this device in to a My Quiet Bible account. From then on, your highlights, notes and prayers here sync to that account.')}</p>
        {ask.email && <p>{tj('The account: {email}', { email: <strong>{ask.email}</strong> })}</p>}
        <p>{t('Only continue if you made this link yourself, on your other device. If someone sent it to you, tap Cancel.')}</p>
        <div class="confirm-buttons">
          <button class="primary" onClick={go}>{t('Link this device')}</button>
          <button onClick={toBible}>{t('Cancel')}</button>
        </div>
      </div>
    </div>
  )
  return (
    <div class="center">
      {error ? <>
        <p class="error">{error}</p>
        <p><button onClick={check}>{t('Try again')}</button></p>
        <p><button onClick={toBible}>{t('Open the Bible')}</button></p>
      </> : <p class="muted">{step}</p>}
    </div>
  )
}

/** Paste a link from another device. */
export function PasteMove({ onDone }: { onDone?: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const go = (s: string) => {
    const link = parseMoveLink(s)
    if (!link) { setError(t('That isn’t a My Quiet Bible link. Copy it again on the other device.')); return }
    location.hash = `#/move/${link.id}.${link.key}`
    location.reload()
  }
  const paste = async () => {
    try { go(await navigator.clipboard.readText()) } catch { setError(t('Couldn’t read the clipboard. Paste the link into the box instead.')) }
  }
  return (
    <div class="move-paste">
      <div class="row wrap">
        {'clipboard' in navigator && 'readText' in navigator.clipboard && <button class="primary" onClick={paste}>{t('Paste link')}</button>}
        {onDone && <button onClick={onDone}>{t('Not now')}</button>}
      </div>
      <input type="url" class="move-input" placeholder={t('or paste it here')} value={text} autocomplete="off"
        onInput={e => { const v = (e.target as HTMLInputElement).value; setText(v); if (parseMoveLink(v)) go(v) }} />
      {error && <p class="note">{error}</p>}
    </div>
  )
}

/** After a device link: what came. A fresh install opens quietly; pasting
 *  a link lives in Settings → Account. */
export function MoveWelcome() {
  const [info, setInfo] = useState(movedIn)
  // Moves from the old address ended; only device links remain.
  if (info?.kind !== 'link') return null
  const close = () => { set(MOVED_IN, null); setInfo(null) }
  return (
    <div class="move-welcome" role="dialog" aria-label={t('Linked')}>
      <p><strong>{t('This device is linked.')}</strong> {info.prayerKey
        ? t('You’re signed in and your prayers are unlocked. Your highlights, notes and settings arrive in a moment, and your prayers right after.')
        : t('You’re signed in. Your highlights, notes and settings arrive in a moment.')}</p>
      {isIOS && !standalone() && <p class="small">{tj('To keep it on your Home Screen: tap Share, then {add}. If it opens signed out there, paste the same link once more under Settings → Account (it works for an hour).', { add: <strong>{t('Add to Home Screen')}</strong> })}</p>}
      <div class="row wrap"><button class="primary" onClick={close}>{t('Done')}</button></div>
    </div>
  )
}

/** Settings → Account, and Your prayers: a link that signs another device
 *  in and unlocks prayers there. */
export function DeviceLink({ class: cls = '', row }: { class?: string; row?: boolean }) {
  const [state, setState] = useState<'idle' | 'working' | 'ready'>('idle')
  const [showCode, setShowCode] = useState(false)
  const [made, setMade] = useState<{ link: string; prayers: boolean; locked: boolean }>()
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const make = async () => {
    setState('working'); setError('')
    try { setMade(await makeDeviceLink()); setState('ready') } catch (e) { setError((e as Error).message); setState('idle') }
  }
  const copy = async () => {
    try { await copyText(made!.link); setCopied(true) } catch { setError(t('Couldn’t copy. Press and hold the link to copy it.')) }
  }
  const share = () => navigator.share?.({ title: 'My Quiet Bible', url: made!.link }).catch(() => {})
  if (state === 'ready' && made) return (
    <div class={'move-card ' + cls}>
      <p class="small">{made.prayers ? t('Open this on your other device within an hour. It signs that device in and unlocks your prayers there. Keep it private: whoever opens it gets into your account.')
        : t('Open this on your other device within an hour. It signs that device in. Keep it private: whoever opens it gets into your account.')}</p>
      {made.locked && <p class="note small">{tj('Your prayers are locked on this device, so this link won’t bring them. Make the link on a device where Your prayers says {syncing}, or unlock them here first under Your prayers.', { syncing: <strong>{t('Synced with your devices.')}</strong> })}</p>}
      <p class="move-link" onClick={copy}>{made.link}</p>
      <div class="row wrap">
        <button class="primary" onClick={copy}>{copied ? t('Copied ✓') : t('Copy link')}</button>
        {'share' in navigator && <button onClick={share}>{t('Send…')}</button>}
      </div>
      <p class="muted small">{tj('Send it to yourself privately: AirDrop, a note to yourself, or your password manager. On iPhone, add My Quiet Bible to the Home Screen first, open it, then go to Settings → Account and tap {paste}.', { paste: <strong>{t('Paste link')}</strong> })}</p>
      {error && <p class="note">{error}</p>}
    </div>
  )
  // First a code to type on the other device; a link only if asked for.
  const codeCard = showCode && <ShowDeviceCode onClose={() => setShowCode(false)} onLink={make} />
  // As a row in a Settings card.
  if (row) return <>
    <button class="set-row" disabled={state === 'working'} onClick={() => { setError(''); setShowCode(true) }}>
      <span class="set-icon" aria-hidden="true"><PhoneIcon size={24} /></span>
      <span class="set-label">{state === 'working' ? t('Making a link…') : t('Link another device')}<span class="set-sub">{t('Sign it in with a 6-digit code')}</span></span>
    </button>
    {codeCard}
    {error && <p class="note small set-note">{error}</p>}
  </>
  return (
    <div class={cls}>
      <button class={cls ? 'pray-btn' : ''} disabled={state === 'working'} onClick={() => { setError(''); setShowCode(true) }}>{state === 'working' ? t('Making a link…') : t('Link another device')}</button>
      {codeCard}
      {error && <p class="note small">{error}</p>}
    </div>
  )
}
