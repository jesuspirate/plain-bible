// Report a problem (and, as a second choice, send a suggestion): anyone can
// write to the person who makes the app, from Settings, signed in or not.
// It goes by email through the sync service and isn't kept there. Sent with
// it, and said so on the page: the app's version, the kind of device and
// the language; for a problem also the screen, the steps the person
// recorded (Show what happens) and any error the app ran into. A reply address only if
// the person types one.
import { useEffect, useState } from 'preact/hooks'
import { SYNC_URL } from './lib/sync'
import { recentErrors } from './lib/errors'
import { inMacApp, inOtherApp, inStoreApp, fromPlayStore, installed } from './lib/install'
import { onStepsChange, recordedSteps, clearSteps, screenOf, stopSteps } from './lib/steps'
import { currentLang, t } from './i18n'
import { useLeave } from './motion'

const MAX = 3000
const DRAFT = 'plain-bible:suggest-draft'
const keep = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* private mode */ } }
const kept = (k: string) => { try { return localStorage.getItem(k) ?? '' } catch { return '' } }

type Kind = 'problem' | 'idea'
// Kept while Settings is put away to record the steps, then opened again here.
let kindNow: Kind = 'problem'
let reopen = false
/** Settings opens on this page again after the steps were recorded. */
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
// Show what happens: Settings goes away, a small pill at the top says it's
// recording, and the person uses the app as usual (tap, scroll, open other
// screens) until they tap Stop. The steps are written down in words
// (src/lib/steps.ts), shown on the report before it's sent. No picture.

export const START_STEPS = 'plain-bible:start-steps'

export function StepsPill({ onStop }: { onStop: () => void }) {
  const leave = useLeave()
  const [n, setN] = useState(() => recordedSteps().length)
  useEffect(() => onStepsChange(() => setN(recordedSteps().length)), [])
  const finish = () => { stopSteps(); reopen = true; onStop() }
  return (
    <div ref={leave} class="steps-pill" role="status">
      <span class="steps-dot" aria-hidden="true" />
      <span class="steps-say">{t('Recording')}<span class="steps-n" aria-hidden="true"> · {Math.max(0, n - 1)}</span></span>
      <button class="primary" onClick={finish}>{t('Stop')}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function SuggestPage({ onDone, crashed }: { onDone: () => void; crashed?: boolean }) {
  const [kind, setKindState] = useState<Kind>(crashed ? 'problem' : kindNow)
  const setKind = (k: Kind) => { kindNow = k; setKindState(k) }
  const [text, setText] = useState(() => kept(DRAFT))
  const [email, setEmail] = useState('')
  const [steps, setSteps] = useState(recordedSteps)
  const [seeSteps, setSeeSteps] = useState(false)
  useEffect(() => onStepsChange(() => setSteps(recordedSteps())), [])
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
          ...(problem ? { screen: screenOf(location.hash), steps: steps.length ? steps : undefined, errors: recentErrors(), size: `${innerWidth}×${innerHeight}`, theme: document.documentElement.dataset.theme } : {}),
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
      clearSteps()
      setText(''); setEmail('')
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
        {steps.length
          ? <>
              <div class="suggest-where-row">
                <span class="suggest-marked">{t('Steps recorded: {n} ✓', { n: steps.length })}</span>
                <button type="button" aria-expanded={seeSteps} onClick={() => setSeeSteps(!seeSteps)}>{seeSteps ? t('Hide the steps') : t('See the steps')}</button>
                <button type="button" onClick={() => dispatchEvent(new Event(START_STEPS))}>{t('Record again')}</button>
              </div>
              {seeSteps && <ol class="suggest-steps">{steps.map(s => <li>{s}</li>)}</ol>}
            </>
          : <>
              <button type="button" class="suggest-show" onClick={() => dispatchEvent(new Event(START_STEPS))}><span class="steps-dot" aria-hidden="true" /> {t('Show what happens')}</button>
              <p class="muted small suggest-how">{t('Use the app as usual, then tap Stop. Each step is written down, not filmed.')}</p>
            </>}
      </div>}
      <label class="suggest-field">
        <span>{t('Your email, if you’d like an answer (optional)')}</span>
        <input class="move-input" type="email" inputMode="email" autoComplete="email" value={email} onInput={e => setEmail((e.target as HTMLInputElement).value)} />
      </label>
      <p class="muted small">{problem
        ? t('Sent with it: the app’s version, the kind of device, its language, the screen you were on, the steps you recorded, and any error the app noticed. Nothing else.')
        : t('Sent with it: the app’s version, the kind of device and its language. Nothing else.')}</p>
      {!online && <p class="suggest-error error">{t('You’re offline. Connect to the internet to send it. Your words are kept here.')}</p>}
      {error && online && <p class="suggest-error error" role="alert">{error}</p>}
      <button type="submit" class="primary suggest-send" disabled={!text.trim() || !online || state === 'sending'}>
        {state === 'sending' ? t('Sending…') : t('Send')}
      </button>
    </form>
  )
}
