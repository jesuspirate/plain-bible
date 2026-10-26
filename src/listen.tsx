// Read aloud with the phone's own voice (the browser's speech synthesis),
// the one set in the phone's settings for the language: it works for everyone
// with nothing to set up. Nothing is downloaded or bundled, so the app stays
// as light and as quick to open as before. Reading goes verse by verse:
// the verse being read is marked and kept in view, the reader follows into
// the next chapter, and pausing or stopping is instant.
import { useEffect, useState } from 'preact/hooks'
import { BOOKS, BOOK_INDEX, bookName } from './lib/books'
import type { Bible } from './lib/data'
import { plain } from './lib/text'
import { go, parseHash, readPath } from './state'
import { CloseIcon, PauseIcon, PlayIcon } from './icons'
import { locale, N_, t } from './i18n'

export interface Spot { version: string; lang: string; book: string; chapter: number; verse: number }
interface Now extends Spot { playing: boolean; bible: Bible; trouble?: string }

const synth = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis
export const canListen = !!synth && typeof SpeechSynthesisUtterance !== 'undefined'

const EVENT = 'qb-listen'
let now: Now | undefined
let run = 0 // bumped on every start, pause and stop, so old utterances stand down
const emit = () => dispatchEvent(new Event(EVENT))

const RATES = [0.8, 0.9, 1, 1.15, 1.3]
const RATE_KEY = 'plain-bible:listen-rate', TIP_KEY = 'plain-bible:listen-tip'
const IPHONE = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const rate = () => { const r = Number(get(RATE_KEY)); return RATES.includes(r) ? r : 1 }

// Book names and the chapter heading in the language of the Bible being read
// (they're spoken with its words), not the app's.
const bookTitle = (id: string, lang: string) => bookName(id, lang.split('-')[0])
const CHAPTER: Record<string, string> = { fr: 'chapitre', es: 'capítulo' }
const heading = (s: Spot) => `${bookTitle(s.book, s.lang)}, ${CHAPTER[s.lang.split('-')[0]] ?? 'chapter'} ${s.chapter}.`
const speechTag = (lang: string) => lang.startsWith('fr') ? 'fr-FR' : lang.startsWith('es') ? 'es-ES' : lang.startsWith('en') ? 'en-US' : lang

const NO_SOUND = N_('No sound? Flip the side switch off Silent, then tap play.')

function say(text: string, lang: string, my: number, then: () => void) {
  if (!synth || my !== run) return
  const u = new SpeechSynthesisUtterance(text)
  // No voice named: the phone speaks with the one set for the language.
  u.lang = speechTag(lang)
  u.rate = rate()
  // If the phone never starts talking, say so instead of looking busy.
  const quiet = setTimeout(() => { if (my === run) pauseListening(t(NO_SOUND)) }, 5000)
  u.onstart = () => clearTimeout(quiet)
  u.onend = () => { clearTimeout(quiet); if (my === run) then() }
  u.onerror = e => {
    clearTimeout(quiet)
    if (my !== run || e.error === 'interrupted' || e.error === 'canceled') return
    // Stay where we were, paused, and say so, rather than vanish.
    pauseListening(e.error === 'not-allowed' ? t('Tap play to start.') : t('The phone couldn’t read this aloud. Tap play to try again.'))
  }
  synth.speak(u)
}

function next(my: number) {
  const n = now
  if (!n || my !== run) return
  const chapters = n.bible.books[n.book] ?? []
  const verses = chapters[n.chapter - 1] ?? []
  if (n.verse > verses.length) {
    // On into the next chapter, or the next book.
    let book = n.book, chapter = n.chapter + 1
    if (chapter > chapters.length) {
      const after = BOOKS.slice(BOOK_INDEX[n.book] + 1).find(b => n.bible.books[b.id]?.length)
      if (!after) return stopListening()
      book = after.id; chapter = 1
    }
    // The page follows, if you're reading along.
    const r = parseHash().path
    const following = r[0] === 'read' && r[2] === n.book && +r[3] === n.chapter
    now = { ...n, book, chapter, verse: 1 }
    emit()
    if (following) go(readPath(n.version, book, chapter))
    return say(heading(now), n.lang, my, () => next(my))
  }
  const text = plain(verses[n.verse - 1] ?? '').replace(/[[\]¶*]/g, '').trim()
  if (!text) { now = { ...n, verse: n.verse + 1 }; return next(my) }
  emit()
  say(text, n.lang, my, () => { if (now) { now = { ...now, verse: now.verse + 1 }; next(my) } })
}

function begin() {
  if (!synth || !now) return
  const my = ++run
  const busy = synth.speaking || synth.pending
  synth.cancel()
  synth.resume?.()
  now = { ...now, playing: true, trouble: undefined }
  emit()
  // iPhones only let speech start inside the tap itself, so speak right away.
  // Only when something was already talking, wait a moment: some browsers
  // drop a request made right after cancel().
  if (busy) setTimeout(() => next(my), 60)
  else next(my)
}

/** Starts reading aloud at a verse. */
export function startListening(spot: Spot, bible: Bible) {
  now = { ...spot, bible, playing: true }
  begin()
}

export function pauseListening(trouble?: string) {
  if (!now) return
  run++
  synth?.cancel()
  now = { ...now, playing: false, trouble }
  emit()
}

export function stopListening() {
  run++
  synth?.cancel()
  now = undefined
  emit()
}

function useNow() {
  const [, tick] = useState(0)
  useEffect(() => {
    const on = () => tick(x => x + 1)
    addEventListener(EVENT, on)
    return () => removeEventListener(EVENT, on)
  }, [])
  return now
}

/** The small player above the search bar while something is read aloud. */
export function ListenPlayer() {
  const n = useNow()
  const [, redraw] = useState(0)

  // Mark the verse being read, and keep it in view, when its chapter is on screen.
  useEffect(() => {
    document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'))
    if (!n) return
    const r = parseHash().path
    if (!(r[0] === 'read' && r[2] === n.book && +r[3] === n.chapter)) return
    const timer = setTimeout(() => {
      const el = document.getElementById('v' + n.verse)
      if (!el) return
      el.classList.add('speaking')
      const box = el.getBoundingClientRect()
      if (box.top < 90 || box.bottom > innerHeight - 170) scrollTo({ top: scrollY + box.top - innerHeight / 3, behavior: 'smooth' })
    }, 120)
    return () => clearTimeout(timer)
  }, [n?.book, n?.chapter, n?.verse, !!n])
  useEffect(() => () => { document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking')) }, [])

  // iPhones mute web speech in Silent mode, so say so gently the first few
  // times reading starts there.
  const [tip, setTip] = useState(false)
  useEffect(() => {
    if (!n || !IPHONE) return
    const seen = Number(get(TIP_KEY)) || 0
    if (seen >= 5) return
    put(TIP_KEY, String(seen + 1))
    setTip(true)
    const timer = setTimeout(() => setTip(false), 9000)
    return () => clearTimeout(timer)
  }, [!!n])

  if (!n) return null
  const r = rate()
  const cycle = () => { put(RATE_KEY, String(RATES[(RATES.indexOf(r) + 1) % RATES.length])); redraw(x => x + 1); if (n.playing) begin() }
  return (
    <div class="listen" role="region" aria-label={t('Reading aloud')}>
      <button class="listen-play" onClick={() => n.playing ? pauseListening() : begin()} aria-label={n.playing ? t('Pause') : t('Play')}>
        {n.playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
      </button>
      <div class="listen-what">
        <strong>{bookTitle(n.book, n.lang)} {n.chapter}:{n.verse}</strong>
        <span class={n.trouble || tip ? 'listen-trouble' : 'muted'}>{n.trouble ?? (tip ? t('Flip the side switch off Silent to hear') : t('Reading aloud'))}</span>
      </div>
      <button class="listen-rate" onClick={cycle} aria-label={t('Speed {rate} times. Change', { rate: r })}>{r.toLocaleString(locale())}×</button>
      <button class="listen-stop" onClick={stopListening} aria-label={t('Stop reading aloud')}><CloseIcon size={22} /></button>
    </div>
  )
}
