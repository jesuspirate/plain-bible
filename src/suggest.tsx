// Send a suggestion: anyone can write to the person who makes the app, from
// Settings, signed in or not. It goes by email through the sync service and
// isn't kept there. Sent with it, and said so on the page: the app's
// version, the kind of device and the language. A reply address only if
// the person types one.
import { useEffect, useState } from 'preact/hooks'
import { SYNC_URL } from './lib/sync'
import { inMacApp, inOtherApp, inStoreApp, fromPlayStore, installed, isAndroid, isIPhone } from './lib/install'
import { currentLang, t } from './i18n'

const MAX = 3000
const DRAFT = 'plain-bible:suggest-draft'
const keep = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k) } catch { /* private mode */ } }
const kept = (k: string) => { try { return localStorage.getItem(k) ?? '' } catch { return '' } }

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

export function SuggestPage({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState(() => kept(DRAFT))
  const [email, setEmail] = useState('')
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

  const send = async (e: Event) => {
    e.preventDefault()
    if (!text.trim() || state === 'sending') return
    setState('sending'); setError('')
    try {
      const res = await fetch(SYNC_URL + '/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ text: text.trim(), email: email.trim() || undefined, version: __BUILD__, platform: platformLabel(), lang: currentLang() }),
        signal: AbortSignal.timeout?.(20_000),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setError(res.status === 429 ? t('Too many suggestions for now. Please try again tomorrow.')
          : /email/i.test(body.error ?? '') ? t('That email address doesn’t look right.')
          : t('It couldn’t be sent. Try again in a few minutes.'))
        setState('idle')
        return
      }
      keep(DRAFT, '')
      setText(''); setEmail('')
      setState('sent')
    } catch {
      setError(navigator.onLine === false ? t('You’re offline. Connect to the internet to send it. Your words are kept here.') : t('It couldn’t be sent. Try again in a few minutes.'))
      setState('idle')
    }
  }

  if (state === 'sent') return (
    <div class="suggest-sent" role="status">
      <p class="suggest-thanks"><strong>{t('Thank you! Your suggestion was sent.')}</strong></p>
      <button class="primary suggest-send" onClick={onDone}>{t('Done')}</button>
    </div>
  )

  return (
    <form class="suggest" onSubmit={send}>
      <p>{t('An idea, a problem, or a kind word? It goes straight to the person who makes My Quiet Bible.')}</p>
      <label class="suggest-field">
        <span>{t('Your suggestion')}</span>
        <textarea class="suggest-text" rows={6} maxLength={MAX} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} />
      </label>
      <label class="suggest-field">
        <span>{t('Your email, if you’d like an answer (optional)')}</span>
        <input class="move-input" type="email" inputMode="email" autoComplete="email" value={email} onInput={e => setEmail((e.target as HTMLInputElement).value)} />
      </label>
      <p class="muted small">{t('Sent with it: the app’s version, the kind of device and its language. Nothing else.')}</p>
      {!online && <p class="suggest-error error">{t('You’re offline. Connect to the internet to send it. Your words are kept here.')}</p>}
      {error && online && <p class="suggest-error error" role="alert">{error}</p>}
      <button type="submit" class="primary suggest-send" disabled={!text.trim() || !online || state === 'sending'}>
        {state === 'sending' ? t('Sending…') : t('Send')}
      </button>
    </form>
  )
}
