// Report a problem (and, as a second choice, send a suggestion): anyone can
// write to the person who makes the app, from Settings, signed in or not.
// It goes by email through the sync service and isn't kept there. Sent with
// it, and said so on the page: the app's version, the kind of device and
// the language; for a problem also the screen, the spot the person showed
// (tap where it is) and any error the app ran into. A reply address only if
// the person types one.
import { useEffect, useState } from 'preact/hooks'
import { SYNC_URL } from './lib/sync'
import { recentErrors } from './lib/errors'
import { inMacApp, inOtherApp, inStoreApp, fromPlayStore, installed } from './lib/install'
import { Glyph } from './gesture'
import { currentLang, t } from './i18n'

const MAX = 3000
const DRAFT = 'plain-bible:suggest-draft'
const keep = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* private mode */ } }
const kept = (k: string) => { try { return localStorage.getItem(k) ?? '' } catch { return '' } }

type Kind = 'problem' | 'idea'
// Kept while Settings is put away to show the spot, then opened again here.
let kindNow: Kind = 'problem'
let spotNow = ''
let reopen = false
/** Settings opens on this page again after the spot was shown. */
export const reopenReport = () => { const r = reopen; reopen = false; return r }

/** The kind of device and app, in a few plain words, to help find a problem. */
export function platformLabel(ua = navigator.userAgent): string {
  const os = /iPad/.test(ua) ? 'iPad' : /iPhone|iPod/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|CrOS/.test(ua) ? 'Linux' : 'other'
  if (inMacApp()) return 'Mac app'
  if (inStoreApp()) return `${os} App Store app`
  if (fromPlayStore()) return 'Google Play app'
  if (inOtherApp()) return `${os} wallet mini app`
  return `${os} ${installed() ? 'Home Screen' : 'browser'}`
}

export const canSuggest = () => !!SYNC_URL

// ---------------------------------------------------------------------------
// Show where: Settings goes away, a quiet line at the top says to tap the
// spot, and the tap is described in words (which button, which verse) for
// the report. No picture is taken.

export const PICK_SPOT = 'plain-bible:pick-spot'

/** A few plain words for the thing at a spot: its label, and where it sits. */
export function describeSpot(el: Element | null, x: number, y: number, w: number, h: number): string {
  const parts: string[] = []
  let label = ''
  for (let n: Element | null = el, i = 0; n && n !== document.body && i < 8; n = n.parentElement, i++) {
    const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/)[0] : ''
    if (parts.length < 4) parts.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (cls ? '.' + cls : ''))
    if (!label) label = n.getAttribute('aria-label') ?? ''
  }
  if (!label) label = (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (label.length > 60) label = label.slice(0, 59) + '…'
  const at = `${Math.round(x / w * 100)}% across, ${Math.round(y / h * 100)}% down`
  return `${label ? `“${label}” ` : ''}[${parts.join(' > ')}] at ${at} of ${w}×${h}`
}

export function SpotPicker({ onDone }: { onDone: () => void }) {
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null)
  const finish = (spot?: string) => {
    if (spot !== undefined) spotNow = spot
    reopen = true
    onDone()
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); finish() } }
    addEventListener('keydown', esc, true)
    return () => removeEventListener('keydown', esc, true)
  }, [])
  const tap = (e: PointerEvent) => {
    if (ring) return
    e.preventDefault()
    const layer = e.currentTarget as HTMLElement
    layer.style.pointerEvents = 'none'
    const under = document.elementFromPoint(e.clientX, e.clientY)
    layer.style.pointerEvents = ''
    setRing({ x: e.clientX, y: e.clientY })
    const spot = describeSpot(under, e.clientX, e.clientY, innerWidth, innerHeight)
    setTimeout(() => finish(spot), 450)
  }
  return (
    <div class="spot-layer" onPointerDown={tap}>
      <div class="spot-bar" onPointerDown={e => e.stopPropagation()}>
        <span class="spot-say"><Glyph kind="tap" /> {t('Tap where the problem is')}</span>
        <button onClick={() => finish()}>{t('Cancel')}</button>
      </div>
      {ring && <span class="spot-ring" style={{ left: ring.x + 'px', top: ring.y + 'px' }} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function SuggestPage({ onDone, crashed }: { onDone: () => void; crashed?: boolean }) {
  const [kind, setKindState] = useState<Kind>(crashed ? 'problem' : kindNow)
  const setKind = (k: Kind) => { kindNow = k; setKindState(k) }
  const [text, setText] = useState(() => kept(DRAFT))
  const [email, setEmail] = useState('')
  const [spot, setSpot] = useState(spotNow)
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(navigator.onLine !== false)
    addEventListener('online', on); addEventListener('offline', on)
    return () => { removeEventListener('online', on); removeEventListener('offline', on) }
  }, [])
  // Kept on the device until it's sent, so leaving the page loses nothing.
  useEffect(() => { if (state !== 'sent') keep(DRAFT, text) }, [text])
  const problem = kind === 'problem'

  const send = async (e: Event) => {
    e.preventDefault()
    if (!text.trim() || state === 'sending') return
    setState('sending'); setError('')
    try {
      const res = await fetch(SYNC_URL + '/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({
          kind, text: text.trim(), email: email.trim() || undefined, version: __BUILD__, platform: platformLabel(), lang: currentLang(),
          ...(problem ? { screen: location.hash.slice(0, 120), where: spot || undefined, errors: recentErrors(), size: `${innerWidth}×${innerHeight}`, theme: document.documentElement.dataset.theme } : {}),
        }),
        signal: AbortSignal.timeout?.(20_000),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setError(res.status === 429 ? t('Too many messages for now. Please try again tomorrow.')
          : /email/i.test(body.error ?? '') ? t('That email address doesn’t look right.')
          : t('It couldn’t be sent. Try again in a few minutes.'))
        setState('idle')
        return
      }
      keep(DRAFT, '')
      spotNow = ''
      setText(''); setEmail(''); setSpot('')
      setState('sent')
    } catch {
      setError(navigator.onLine === false ? t('You’re offline. Connect to the internet to send it. Your words are kept here.') : t('It couldn’t be sent. Try again in a few minutes.'))
      setState('idle')
    }
  }

  if (state === 'sent') return (
    <div class="suggest-sent" role="status">
      <p class="suggest-thanks"><strong>{problem ? t('Thank you! Your report was sent.') : t('Thank you! Your suggestion was sent.')}</strong></p>
      <button class="primary suggest-send" onClick={onDone}>{t('Done')}</button>
    </div>
  )

  return (
    <form class="suggest" onSubmit={send}>
      {!crashed && <div class="seg suggest-kind" role="radiogroup">
        <button type="button" role="radio" aria-checked={problem} class={problem ? 'on' : ''} onClick={() => setKind('problem')}>{t('A problem')}</button>
        <button type="button" role="radio" aria-checked={!problem} class={!problem ? 'on' : ''} onClick={() => setKind('idea')}>{t('A suggestion')}</button>
      </div>}
      <p>{problem ? t('Something not working? Say what happened. It goes straight to the person who makes My Quiet Bible.')
        : t('An idea, a problem, or a kind word? It goes straight to the person who makes My Quiet Bible.')}</p>
      <label class="suggest-field">
        <span>{problem ? t('What went wrong?') : t('Your suggestion')}</span>
        <textarea class="suggest-text" rows={6} maxLength={MAX} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} />
      </label>
      {problem && !crashed && <div class="suggest-where">
        {spot
          ? <><span class="suggest-marked">{t('Spot shown ✓')}</span>
              <button type="button" onClick={() => dispatchEvent(new Event(PICK_SPOT))}>{t('Show again')}</button></>
          : <button type="button" class="suggest-show" onClick={() => dispatchEvent(new Event(PICK_SPOT))}><Glyph kind="tap" /> {t('Show where')}</button>}
      </div>}
      <label class="suggest-field">
        <span>{t('Your email, if you’d like an answer (optional)')}</span>
        <input class="move-input" type="email" inputMode="email" autoComplete="email" value={email} onInput={e => setEmail((e.target as HTMLInputElement).value)} />
      </label>
      <p class="muted small">{problem
        ? t('Sent with it: the app’s version, the kind of device, its language, the screen you were on, the spot you showed, and any error the app noticed. Nothing else.')
        : t('Sent with it: the app’s version, the kind of device and its language. Nothing else.')}</p>
      {!online && <p class="suggest-error error">{t('You’re offline. Connect to the internet to send it. Your words are kept here.')}</p>}
      {error && online && <p class="suggest-error error" role="alert">{error}</p>}
      <button type="submit" class="primary suggest-send" disabled={!text.trim() || !online || state === 'sending'}>
        {state === 'sending' ? t('Sending…') : t('Send')}
      </button>
    </form>
  )
}
