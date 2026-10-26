// Read aloud with the phone's own voices (the browser's speech synthesis).
// Nothing is downloaded or bundled, so the app stays as light and as quick
// to open as before; most voices work offline. Reading goes verse by verse:
// the verse being read is marked and kept in view, the reader follows into
// the next chapter, and pausing or stopping is instant.
import { useEffect, useState } from 'preact/hooks'
import { BOOKS, BOOK_INDEX, bookName } from './lib/books'
import type { Bible } from './lib/data'
import { plain } from './lib/text'
import { go, parseHash, readPath } from './state'
import { CloseIcon, PauseIcon, PlayIcon } from './icons'
import { Sheet } from './ui'
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
const RATE_KEY = 'plain-bible:listen-rate', VOICE_KEY = 'plain-bible:listen-voice:', TIP_KEY = 'plain-bible:listen-tip'
const IPHONE = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const rate = () => { const r = Number(get(RATE_KEY)); return RATES.includes(r) ? r : 1 }

/** How natural a voice is: iPhones name the better downloads "Enhanced" or
 * "Premium", sometimes only in the voice's id. */
export function quality(v: SpeechSynthesisVoice): '' | 'Enhanced' | 'Premium' {
  const s = v.name + ' ' + v.voiceURI
  return /premium/i.test(s) ? 'Premium' : /enhanced|améliorée|mejorada|natural|neural|wavenet/i.test(s) ? 'Enhanced' : ''
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

const PHONE = 'phone' // no voice named: the phone speaks with the one picked in its own settings

/** The voice someone picked for a language, if they did and it can speak now.
 * Otherwise none: the phone's own voice, so nobody is surprised by an odd one. */
function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const chosen = get(VOICE_KEY + lang.split('-')[0])
  if (!chosen || chosen === PHONE) return undefined
  // Offline, only a voice on the phone itself can speak.
  return voicesFor(lang).find(v => v.voiceURI === chosen && (navigator.onLine || v.localService))
}
const phoneChoice = (lang: string) => !voiceFor(lang)

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
  const v = voiceFor(lang)
  if (v) try { u.voice = v } catch { /* not a voice this browser accepts */ }
  u.lang = v?.lang ?? speechTag(lang)
  u.rate = rate()
  // If the phone never starts talking, say so instead of looking busy.
  const quiet = setTimeout(() => { if (my === run) pauseListening(t(NO_SOUND)) }, 5000)
  u.onstart = () => clearTimeout(quiet)
  u.onend = () => { clearTimeout(quiet); if (my === run) then() }
  u.onerror = e => {
    clearTimeout(quiet)
    if (my !== run || e.error === 'interrupted' || e.error === 'canceled') return
    // Stay where we were, paused, and say so, rather than vanish.
    pauseListening(e.error === 'not-allowed' ? t('Tap play to start.') : t('This voice couldn’t speak. Pick another voice.'))
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
  const voice = voiceFor(n.lang)
  const cycle = () => { put(RATE_KEY, String(RATES[(RATES.indexOf(r) + 1) % RATES.length])); redraw(x => x + 1); if (n.playing) begin() }
  return (
    <>
      <div class="listen" role="region" aria-label={t('Reading aloud')}>
        <button class="listen-play" onClick={() => n.playing ? pauseListening() : begin()} aria-label={n.playing ? t('Pause') : t('Play')}>
          {n.playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
        </button>
        <button class="listen-what" onClick={() => setVoices(true)} aria-label={t('Choose the voice')}>
          <strong>{bookTitle(n.book, n.lang)} {n.chapter}:{n.verse}</strong>
          <span class={n.trouble || tip ? 'listen-trouble' : 'muted'}>{n.trouble ?? (tip ? t('Flip the side switch off Silent to hear') : voice && !phoneChoice(n.lang) ? voice.name : t('Phone’s own voice'))} ▾</span>
        </button>
        <button class="listen-rate" onClick={cycle} aria-label={t('Speed {rate} times. Change', { rate: r })}>{r.toLocaleString(locale())}×</button>
        <button class="listen-stop" onClick={stopListening} aria-label={t('Stop reading aloud')}><CloseIcon size={22} /></button>
      </div>
      {voices && <VoiceSheet lang={n.lang} onClose={() => setVoices(false)} onPick={() => { setVoices(false); redraw(x => x + 1); if (n.playing) begin() }} />}
    </>
  )
}

const SAMPLE: Record<string, string> = {
  en: 'The Lord is my shepherd; I shall not want.',
  fr: 'L’Éternel est mon berger: je ne manquerai de rien.',
  es: 'Jehová es mi pastor; nada me faltará.',
}

// How to get more natural voices, step by step, for each kind of phone. The
// one in your hand comes first.
const iphoneHelp = () => (
  <details class="account-more voice-help">
    <summary>{t('Add better voices on iPhone or iPad')}</summary>
    <ol class="muted small">
      <li>{t('Open the Settings app and search “Voices” (Accessibility → Read & Speak → Voices, called Spoken Content on older iPhones).')}</li>
      <li>{t('Pick your language, download a voice marked “Enhanced” or “Premium”, and tap it so it’s checked.')}</li>
      <li>{t('Come back here and use “Phone’s own voice”. Tap ▶ to hear it.')}</li>
    </ol>
    <p class="muted small">{t('Downloaded voices don’t show up in this list on iPhone, but “Phone’s own voice” speaks with the one you checked. Siri voices are kept for Apple’s own apps and can’t be used here.')}</p>
  </details>
)
const androidHelp = () => (
  <details class="account-more voice-help">
    <summary>{t('Add better voices on Android')}</summary>
    <ol class="muted small">
      <li>{t('Open the Settings app and search “Text-to-speech” (often under Accessibility).')}</li>
      <li>{t('Choose “Speech Services by Google” as the engine, tap its ⚙, then “Install voice data”, and pick your language.')}</li>
      <li>{t('Tap the voice you like best, then come back and pick “Phone’s own voice” here.')}</li>
    </ol>
    <p class="muted small">{t('Android shows one voice per language here; it speaks with the one you chose in step 3.')}</p>
  </details>
)

function VoiceSheet({ lang, onClose, onPick }: { lang: string; onClose: () => void; onPick: () => void }) {
  const code = lang.split('-')[0]
  // Ask the phone again each time the sheet opens: a voice downloaded a
  // moment ago can take a while to show.
  const [, fresh] = useState(0)
  useEffect(() => {
    const on = () => fresh(x => x + 1)
    synth?.getVoices()
    synth?.addEventListener?.('voiceschanged', on)
    const timer = setTimeout(on, 400)
    return () => { clearTimeout(timer); synth?.removeEventListener?.('voiceschanged', on) }
  }, [])
  const list = voicesFor(lang)
  const current = voiceFor(lang)
  const mine = phoneChoice(lang)
  const sample = (v?: SpeechSynthesisVoice) => {
    pauseListening()
    const u = new SpeechSynthesisUtterance(SAMPLE[code] ?? SAMPLE.en)
    if (v) u.voice = v
    u.lang = v?.lang ?? speechTag(lang); u.rate = rate()
    synth?.speak(u)
  }
  const named = list.map(v => (
    <div class={'voice-row' + (!mine && v.voiceURI === current?.voiceURI ? ' on' : '')}>
      <button class="voice-pick" onClick={() => { put(VOICE_KEY + code, v.voiceURI); onPick() }}>
        <strong>{v.name.replace(/\s*\((enhanced|premium|améliorée|mejorada)\)/i, '')}{quality(v) && <span class="voice-tag">{quality(v)}</span>}</strong>
        <span class="muted small">{v.lang}{v.localService ? '' : ' · ' + t('needs a connection')}</span>
      </button>
      <button class="voice-try" onClick={() => sample(v)} aria-label={t('Hear {voice}', { voice: v.name })}><PlayIcon size={20} /></button>
    </div>
  ))
  return (
    <Sheet title={t('Voice')} onClose={onClose}>
      <p class="muted small">{IPHONE
        ? t('On iPhone, “Phone’s own voice” is the one you pick in the iPhone’s settings. Voices you download there don’t show up in this list.')
        : t('These are the voices on this phone. Every phone has its own list, so yours may not match someone else’s. Tap ▶ to hear one, then tap its name to use it.')}</p>
      {IPHONE ? <>{iphoneHelp()}{androidHelp()}</> : <>{androidHelp()}{iphoneHelp()}</>}
      <div class="voice-list">
        <div class={'voice-row' + (mine ? ' on' : '')}>
          <button class="voice-pick" onClick={() => { put(VOICE_KEY + code, PHONE); onPick() }}>
            <strong>{t('Phone’s own voice')}</strong>
            <span class="muted small">{t('The voice picked in your phone’s settings')}</span>
          </button>
          <button class="voice-try" onClick={() => sample()} aria-label={t('Hear the phone’s own voice')}><PlayIcon size={20} /></button>
        </div>
        {!IPHONE && named}
      </div>
      {IPHONE && list.length > 0 && (
        // iPhones list only their basic built-in voices here, which can look
        // like a download failed: keep them out of the way.
        <details class="account-more voice-help" open={!mine}>
          <summary>{t('Other voices on this phone')}</summary>
          <div class="voice-list">{named}</div>
        </details>
      )}
    </Sheet>
  )
}
