// Read aloud with the phone's own voices (the browser's speech synthesis).
// Nothing is downloaded or bundled, so the app stays as light and as quick
// to open as before; most voices work offline. Reading goes verse by verse:
// the verse being read is marked and kept in view, the reader follows into
// the next chapter, and pausing or stopping is instant.
import { useEffect, useState } from 'preact/hooks'
import { BOOKS, BOOK_INDEX, bookById, frenchName } from './lib/books'
import type { Bible } from './lib/data'
import { plain } from './lib/text'
import { go, parseHash, readPath } from './state'
import { CloseIcon, PauseIcon, PlayIcon } from './icons'
import { Sheet } from './ui'

export interface Spot { version: string; lang: string; book: string; chapter: number; verse: number }
interface Now extends Spot { playing: boolean; bible: Bible; trouble?: string }

const synth = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis
export const canListen = !!synth && typeof SpeechSynthesisUtterance !== 'undefined'

const EVENT = 'qb-listen'
let now: Now | undefined
let run = 0 // bumped on every start, pause and stop, so old utterances stand down
const emit = () => dispatchEvent(new Event(EVENT))

const RATES = [0.8, 0.9, 1, 1.15, 1.3]
const RATE_KEY = 'plain-bible:listen-rate', VOICE_KEY = 'plain-bible:listen-voice:'
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const rate = () => { const r = Number(get(RATE_KEY)); return RATES.includes(r) ? r : 1 }

/** How natural a voice is: iPhones name the better downloads "Enhanced" or
 * "Premium", sometimes only in the voice's id. */
export function quality(v: SpeechSynthesisVoice): '' | 'Enhanced' | 'Premium' {
  const s = v.name + ' ' + v.voiceURI
  return /premium/i.test(s) ? 'Premium' : /enhanced|natural|neural|wavenet/i.test(s) ? 'Enhanced' : ''
}

/** The phone's voices for a language, the most natural first, each once. */
export function voicesFor(lang: string): SpeechSynthesisVoice[] {
  const code = lang.split('-')[0].toLowerCase()
  const region = ({ en: 'en-us', fr: 'fr-fr' } as Record<string, string>)[code]
  const score = (v: SpeechSynthesisVoice) =>
    ({ Premium: 5, Enhanced: 4, '': 0 })[quality(v)] + (v.lang.toLowerCase().replace('_', '-') === region ? 2 : 0)
    + (v.localService ? 1 : 0) + (v.default ? 0.5 : 0) - (/compact/i.test(v.voiceURI) ? 0.25 : 0)
    - (/eloquence|novelty|bad news|bells|bubbles|jester|organ|whisper|zarvox|trinoids|cellos|bahh|boing|wobble|superstar|grandma|grandpa|rocko|shelley|flo|reed|sandy/i.test(v.name) ? 5 : 0)
  // iPhones often list the same voice twice (two copies of one download):
  // keep only the best copy of each name.
  const seen = new Set<string>()
  return (synth?.getVoices() ?? []).filter(v => v.lang.toLowerCase().startsWith(code)).sort((a, b) => score(b) - score(a))
    .filter(v => { const k = `${v.name.replace(/\s*\((enhanced|premium|compact)\)/i, '')}|${v.lang}|${quality(v)}`; return !seen.has(k) && !!seen.add(k) })
}

function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const list = voicesFor(lang), chosen = get(VOICE_KEY + lang.split('-')[0])
  // Offline, only a voice on the phone itself can speak.
  return list.find(v => v.voiceURI === chosen && (navigator.onLine || v.localService))
    ?? list.find(v => navigator.onLine || v.localService) ?? list[0]
}

const bookTitle = (id: string, lang: string) => (lang.startsWith('fr') && frenchName(id)) || bookById(id).name
const heading = (s: Spot) => s.lang.startsWith('fr')
  ? `${bookTitle(s.book, s.lang)}, chapitre ${s.chapter}.` : `${bookTitle(s.book, s.lang)}, chapter ${s.chapter}.`

function say(text: string, lang: string, my: number, then: () => void) {
  if (!synth || my !== run) return
  const u = new SpeechSynthesisUtterance(text)
  const v = voiceFor(lang)
  if (v) try { u.voice = v } catch { /* not a voice this browser accepts */ }
  u.lang = v?.lang ?? lang
  u.rate = rate()
  u.onend = () => { if (my === run) then() }
  u.onerror = e => {
    if (my !== run || e.error === 'interrupted' || e.error === 'canceled') return
    // Stay where we were, paused, and say so, rather than vanish.
    pauseListening(e.error === 'not-allowed' ? 'Tap play to start.' : 'This voice couldn’t speak. Pick another voice.')
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
  synth.cancel()
  now = { ...now, playing: true, trouble: undefined }
  emit()
  // Some browsers drop a request made right after cancel().
  setTimeout(() => next(my), 60)
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
    synth?.addEventListener?.('voiceschanged', on)
    return () => { removeEventListener(EVENT, on); synth?.removeEventListener?.('voiceschanged', on) }
  }, [])
  return now
}

/** The small player above the search bar while something is read aloud. */
export function ListenPlayer() {
  const n = useNow()
  const [voices, setVoices] = useState(false)
  const [, redraw] = useState(0)

  // Mark the verse being read, and keep it in view, when its chapter is on screen.
  useEffect(() => {
    document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking'))
    if (!n) return
    const r = parseHash().path
    if (!(r[0] === 'read' && r[2] === n.book && +r[3] === n.chapter)) return
    const t = setTimeout(() => {
      const el = document.getElementById('v' + n.verse)
      if (!el) return
      el.classList.add('speaking')
      const box = el.getBoundingClientRect()
      if (box.top < 90 || box.bottom > innerHeight - 170) scrollTo({ top: scrollY + box.top - innerHeight / 3, behavior: 'smooth' })
    }, 120)
    return () => clearTimeout(t)
  }, [n?.book, n?.chapter, n?.verse, !!n])
  useEffect(() => () => { document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking')) }, [])

  if (!n) return null
  const r = rate()
  const voice = voiceFor(n.lang)
  const cycle = () => { put(RATE_KEY, String(RATES[(RATES.indexOf(r) + 1) % RATES.length])); redraw(x => x + 1); if (n.playing) begin() }
  return (
    <>
      <div class="listen" role="region" aria-label="Reading aloud">
        <button class="listen-play" onClick={() => n.playing ? pauseListening() : begin()} aria-label={n.playing ? 'Pause' : 'Play'}>
          {n.playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </button>
        <button class="listen-what" onClick={() => setVoices(true)} aria-label="Choose the voice">
          <strong>{bookTitle(n.book, n.lang)} {n.chapter}:{n.verse}</strong>
          <span class={n.trouble ? 'listen-trouble' : 'muted'}>{n.trouble ?? (voice ? voice.name : 'Phone voice')} ▾</span>
        </button>
        <button class="listen-rate" onClick={cycle} aria-label={`Speed ${r} times. Change`}>{r}×</button>
        <button class="listen-stop" onClick={stopListening} aria-label="Stop reading aloud"><CloseIcon size={22} /></button>
      </div>
      {voices && <VoiceSheet lang={n.lang} onClose={() => setVoices(false)} onPick={() => { setVoices(false); redraw(x => x + 1); if (n.playing) begin() }} />}
    </>
  )
}

const SAMPLE: Record<string, string> = {
  en: 'The Lord is my shepherd; I shall not want.',
  fr: 'L’Éternel est mon berger: je ne manquerai de rien.',
}

function VoiceSheet({ lang, onClose, onPick }: { lang: string; onClose: () => void; onPick: () => void }) {
  const code = lang.split('-')[0]
  // Ask the phone again each time the sheet opens: a voice downloaded a
  // moment ago can take a while to show.
  const [, fresh] = useState(0)
  useEffect(() => {
    const on = () => fresh(x => x + 1)
    synth?.getVoices()
    synth?.addEventListener?.('voiceschanged', on)
    const t = setTimeout(on, 400)
    return () => { clearTimeout(t); synth?.removeEventListener?.('voiceschanged', on) }
  }, [])
  const list = voicesFor(lang)
  const current = voiceFor(lang)
  const sample = (v: SpeechSynthesisVoice) => {
    pauseListening()
    const u = new SpeechSynthesisUtterance(SAMPLE[code] ?? SAMPLE.en)
    u.voice = v; u.lang = v.lang; u.rate = rate()
    synth?.speak(u)
  }
  return (
    <Sheet title="Voice" onClose={onClose}>
      <p class="muted small">These are the voices on your phone. On iPhone, more natural ones ("Enhanced" or "Premium") can be added free in Settings → Accessibility → Spoken Content → Voices. After a download, close Quiet Bible fully (swipe it away) and open it again. Voices chosen for Live Speech are a separate list, and your Personal Voice can't be used by web apps.</p>
      <div class="voice-list">
        {list.length === 0 && <p class="muted">No voice for this language on this phone.</p>}
        {list.map(v => (
          <div class={'voice-row' + (v.voiceURI === current?.voiceURI ? ' on' : '')}>
            <button class="voice-pick" onClick={() => { put(VOICE_KEY + code, v.voiceURI); onPick() }}>
              <strong>{v.name.replace(/\s*\((enhanced|premium)\)/i, '')}{quality(v) && <span class="voice-tag">{quality(v)}</span>}</strong>
              <span class="muted small">{v.lang}{v.localService ? '' : ' · needs a connection'}</span>
            </button>
            <button class="voice-try" onClick={() => sample(v)} aria-label={`Hear ${v.name}`}><PlayIcon size={20} /></button>
          </div>
        ))}
      </div>
    </Sheet>
  )
}
