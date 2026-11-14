// Read aloud. A Bible that has a recorded reading (lib/recordings.ts) is read
// by its narrator: the chapter's recording plays from where its publisher
// keeps it, and the highlight follows the narrator's words. Every other Bible,
// and a recorded one with no connection, is read by the phone's own voice (the
// browser's speech synthesis). Either way nothing is bundled, so the app
// stays as light and as quick to open as before. Reading goes verse by verse:
// the verse being read is marked and kept in view, the reader follows into
// the next chapter, and pausing or stopping is instant.
//
// Follow-along: each word lights up as it's said (word by word, when the
// phone tells us where it is, or else at the voice's own pace), and with no
// voice at all the highlight walks through the words at a calm reading pace
// you can slow down or speed up. The word sits on a soft rounded mark that
// glides from word to word, laid behind the text, so the page itself is
// never changed.
//
// It's a mode: once started it stays until you tap X. Tap any verse to read
// from there; turn the page or go to another chapter and it starts again at
// the top of the new page. Leaving the app and coming back (an iPhone Home
// Screen app reloads) brings it back paused where you were.
import { useEffect, useState } from 'preact/hooks'
import { pace, sweep, wordAt, words, type Span } from './lib/follow'
import { useApp } from './state'
import { BOOKS, BOOK_INDEX, bookName } from './lib/books'
import type { Bible } from './lib/data'
import { plain } from './lib/text'
import { chapterUrl, loadTimes, locate, nextTimed, recordingsFor, type ChapterTimes, type Recording } from './lib/recordings'
import { nowPlaying } from './lib/nowplaying'
import { formatRef } from './lib/refs'
import { go, parseHash, readPath } from './state'
import { CloseIcon, PauseIcon, PlayIcon } from './icons'
import { Sheet } from './ui'
import { locale, N_, t } from './i18n'

export interface Spot {
  version: string; lang: string; book: string; chapter: number; verse: number
  /** Listen: just these verses (in order, skipping the others), then stop.
   *  Read along has none: it goes on until X. */
  only?: number[]
}
interface Now extends Spot { playing: boolean; bible: Bible; trouble?: string }

const synth = typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis
export const canListen = !!synth && typeof SpeechSynthesisUtterance !== 'undefined'

const EVENT = 'qb-listen'
let now: Now | undefined
let run = 0 // bumped on every start, pause and stop, so old utterances stand down
const PLACE_KEY = 'plain-bible:reading-aloud'
// While reading aloud plays, the screen stays awake: nobody touches it while
// they follow along, and the phone would otherwise dim and lock. Let go on
// pause or X. The phone drops it when the app goes to the background, so it's
// asked for again on return.
let lock: WakeLockSentinel | undefined, asking = false
function stayAwake() {
  const want = !!now?.playing && document.visibilityState === 'visible'
  if (!want) { lock?.release().catch(() => {}); lock = undefined; return }
  if ((lock && !lock.released) || asking || !navigator.wakeLock) return
  asking = true
  navigator.wakeLock.request('screen').then(l => {
    asking = false
    if (now?.playing) lock = l; else l.release().catch(() => {})
  }, () => { asking = false })
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => stayAwake())

const emit = () => {
  dispatchEvent(new Event(EVENT))
  // The lock screen: the chapter being read, and the app's own icon.
  if (now) nowPlaying(formatRef({ book: now.book, chapter: now.chapter }), now.version)
  stayAwake()
  // While it's on, a press held on a verse bookmarks it: no text selection or callout in the way.
  document.documentElement.classList.toggle('reading-aloud', !!now)
  if (now && !now.only) put(PLACE_KEY, JSON.stringify({ version: now.version, lang: now.lang, book: now.book, chapter: now.chapter, verse: now.verse }))
  else try { localStorage.removeItem(PLACE_KEY) } catch { /* private mode */ }
}

const RATES = [0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3]
const RATE_KEY = 'plain-bible:listen-rate', REC_KEY = 'plain-bible:listen-recording:', TIP_KEY = 'plain-bible:listen-tip'
const IPHONE = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const rate = () => { const r = Number(get(RATE_KEY)); return RATES.includes(r) ? r : 1 }

/** The narrator reading a Bible, if it has a recorded reading: the one picked,
 * or its first. */
function recordingFor(version: string): Recording | undefined {
  const all = recordingsFor(version)
  return all.find(r => r.id === get(REC_KEY + version)) ?? all[0]
}
/** Whether a Bible can be heard here: by a recording, or by the phone. */
export const canHear = (version: string) => canListen || recordingsFor(version).length > 0
// A recording that can't be reached (no connection): the phone's own voice
// reads instead, until reading is next started.
let unreachable = false

// Book names and the chapter heading in the language of the Bible being read
// (they're spoken with its words), not the app's.
const bookTitle = (id: string, lang: string) => bookName(id, lang.split('-')[0])
const CHAPTER: Record<string, string> = { fr: 'chapitre', es: 'capítulo' }
const heading = (s: Spot) => `${bookTitle(s.book, s.lang)}, ${CHAPTER[s.lang.split('-')[0]] ?? 'chapter'} ${s.chapter}.`
const speechTag = (lang: string) => lang.startsWith('fr') ? 'fr-FR' : lang.startsWith('es') ? 'es-ES' : lang.startsWith('en') ? 'en-US' : lang

// How to follow along, from Settings: word by word or the verse only, and
// with the phone's voice or silently. With no voices on this device at all,
// it's always silent.
let follow = { words: true, silent: false }
/** Kept in step with Settings by the app, so reading starts the right way. */
export function followSettings(s: { follow: 'words' | 'verse'; readSilent: boolean }) {
  follow = { words: s.follow !== 'verse', silent: s.readSilent }
}
/** The narrator reading now, if a recording is. */
const recorded = () => now && !follow.silent && !unreachable ? recordingFor(now.version) : undefined
const silentNow = () => follow.silent || (!canListen && !recorded())

// The verse being read: its words, and the word lit now.
let cur: { text: string; spans: Span[] } | undefined
let wordNow = 0
let resumeAt = 0 // where a silent reading picks up after a pause

let lit: { el: Element; ranges: Range[] } | undefined

/** The words of the verse being read, as they sit on the page, if its chapter
 * is open. In a parallel view, the column whose words match what's read. */
function wordsOnPage(): Range[] | undefined {
  const n = now, c = cur
  if (!n || !c) return
  const r = parseHash().path
  if (!(r[0] === 'read' && r[2] === n.book && +r[3] === n.chapter)) return
  const el = document.getElementById('v' + n.verse)
  if (!el) return
  if (lit?.el === el && lit.ranges[0]?.startContainer.isConnected && lit.ranges.length === c.spans.length) return lit.ranges
  const said = c.spans.map(([a, b]) => c.text.slice(a, b))
  for (const vt of el.querySelectorAll('.vt')) {
    // The words as shown, leaving out inline Strong's numbers.
    const nodes: Text[] = [], starts: number[] = []
    let text = ''
    const walk = document.createTreeWalker(vt, NodeFilter.SHOW_TEXT, {
      acceptNode: x => x.parentElement?.closest('.sn') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    })
    while (walk.nextNode()) { const x = walk.currentNode as Text; starts.push(text.length); nodes.push(x); text += x.data }
    const spans = words(text)
    if (spans.length !== said.length || spans.some(([a, b], i) => text.slice(a, b) !== said[i])) continue
    const at = (off: number, end: boolean) => {
      let i = 0
      while (i < nodes.length - 1 && (end ? off > starts[i] + nodes[i].data.length : off >= starts[i] + nodes[i].data.length)) i++
      return [nodes[i], off - starts[i]] as const
    }
    const ranges = spans.map(([a, b]) => {
      const range = document.createRange()
      range.setStart(...at(a, false)); range.setEnd(...at(b, true))
      return range
    })
    lit = { el, ranges }
    return ranges
  }
}

// Karaoke style: a soft rounded band of color flows through the letters of
// each line, at the pace of the reading, so the eye glides along with it
// instead of hopping from word to word. Lines already read stay lightly
// colored until the verse is done. One band per line, in the chapter's own
// layer, behind the letters.
let bands: { el: HTMLElement; top: number; rtl: boolean; edge: number }[] = []
let bandLayer: HTMLElement | undefined
export const WORD_EVENT = 'qb-listen-word'

/** The band for a line, made empty at its first letter if it's new. */
function bandAt(layer: HTMLElement, top: number, height: number, start: number, rtl: boolean, fs: number) {
  let b = bands.find(x => Math.abs(x.top - top) < fs * .5)
  if (b) return b
  const el = document.createElement('span')
  el.className = rtl ? 'follow-band rtl' : 'follow-band'
  el.setAttribute('aria-hidden', 'true')
  Object.assign(el.style, { top: top + 'px', height: height + 'px', width: '0px', transition: 'none',
    ...(rtl ? { right: layer.clientWidth - start + 'px' } : { left: start + 'px' }) })
  layer.appendChild(el)
  void el.offsetWidth
  b = { el, top, rtl, edge: start }
  bands.push(b)
  return b
}

/** Sweep a band to `width`, never back: a voice that reports a word late
 * never pulls it back. Linear, so the flow is even. */
function grow(b: (typeof bands)[number], width: number, ms: number, delay: number) {
  if (width < b.el.getBoundingClientRect().width - 1) return false
  b.el.style.transition = `width ${ms}ms linear ${delay}ms`
  b.el.style.width = width + 'px'
  return true
}

/** The band flows through word `i` of the verse in `ms`. Every line before it
 * is filled to its last word read, even when a voice skipped some words, so
 * the lines read always line up as one shape. */
function place(ranges: Range[], i: number, ms: number) {
  const range = ranges[i]
  const verse = range.startContainer.parentElement?.closest<HTMLElement>('[id^="v"]')
  // In the open book, the pages' own flow, so the bands turn with the page.
  const layer = verse?.closest<HTMLElement>('.spread-flow') ?? verse?.closest<HTMLElement>('article')
  const rects = [...range.getClientRects()].filter(x => x.width > 0)
  if (!verse || !layer || !rects.length) return clearWord()
  if (bandLayer !== layer) { clearWord(); bandLayer = layer }
  document.body.classList.add('following')
  const box = layer.getBoundingClientRect()
  const ox = box.left + layer.clientLeft, oy = box.top + layer.clientTop
  const fs = parseFloat(getComputedStyle(verse).fontSize) || 18
  const rtl = getComputedStyle(verse).direction === 'rtl'
  const px = .18 * fs, py = .04 * fs
  // The lines read so far: where each starts and how far it has been read.
  const lines: { top: number; h: number; from: number; to: number }[] = []
  for (let j = 0; j < i; j++) for (const r of ranges[j].getClientRects()) {
    if (!r.width) continue
    const top = r.top - oy - py, l = lines.find(x => Math.abs(x.top - top) < fs * .5)
    if (l) { l.from = Math.min(l.from, r.left); l.to = Math.max(l.to, r.right) }
    else lines.push({ top, h: r.height + 2 * py, from: r.left, to: r.right })
  }
  for (const l of lines) {
    if (rects.some(r => Math.abs(r.top - oy - py - l.top) < fs * .5)) continue
    const start = rtl ? l.to - ox + px : l.from - ox - px
    const b = bandAt(layer, l.top, l.h, start, rtl, fs)
    grow(b, Math.max(0, rtl ? b.edge - (l.from - ox - px) : l.to - ox + px - b.edge), 160, 0)
  }
  // A word broken over two lines (a hyphen) sweeps one part, then the next.
  const share = rects.map(r => r.width / rects.reduce((n, x) => n + x.width, 0))
  let delay = 0
  rects.forEach((r, k) => {
    const top = r.top - oy - py, d = Math.max(60, ms * share[k])
    const l = lines.find(x => Math.abs(x.top - top) < fs * .5)
    const from = Math.min(r.left, l?.from ?? r.left), to = Math.max(r.right, l?.to ?? r.right)
    const b = bandAt(layer, top, r.height + 2 * py, rtl ? to - ox + px : from - ox - px, rtl, fs)
    if (grow(b, Math.max(0, b.rtl ? b.edge - (r.left - ox - px) : r.right - ox + px - b.edge), d, delay)) delay += d
  })
  // The soft leading edge is on the line being read only.
  const last = bands.find(x => Math.abs(x.top - (rects[rects.length - 1].top - oy - py)) < fs * .5)
  for (const b of bands) b.el.classList.toggle('lead', b === last)
}

function showWord(i: number, ms: number) {
  wordNow = i
  if (!follow.words) return
  const ranges = wordsOnPage(), range = ranges?.[i]
  if (!ranges || !range) return clearWord()
  place(ranges, i, ms)
  // The book on a big screen turns its page when the words run onto the next.
  dispatchEvent(new CustomEvent(WORD_EVENT, { detail: range }))
  // A long verse runs on below the bar: keep the word in view, but don't
  // chase someone who has scrolled somewhere else.
  const box = range.getBoundingClientRect()
  if (box.bottom > innerHeight - 110 && box.top < innerHeight + 120) scrollTo({ top: scrollY + box.top - innerHeight / 3, behavior: 'smooth' })
}
/** Paused: the band stops where it is. */
function holdBands() {
  for (const b of bands) { const w = b.el.getBoundingClientRect().width; b.el.style.transition = 'none'; b.el.style.width = w + 'px' }
}

function clearWord() {
  // Read lines fade away rather than vanish.
  const old = bands
  bands = []; bandLayer = undefined
  for (const b of old) { b.el.style.transition = 'opacity .5s'; b.el.style.opacity = '0'; setTimeout(() => b.el.remove(), 520) }
  if (!old.length) document.body.classList.remove('following')
  else setTimeout(() => { if (!bands.length) document.body.classList.remove('following') }, 520)
}

/** With no voice: on through the words at a reading pace, then on to `then`.
 * The speed is read at every word, so changing it takes effect at once. */
function walkWords(my: number, i: number, then: () => void) {
  const c = cur
  if (my !== run || !c) return
  if (i >= c.spans.length) return void setTimeout(() => { if (my === run) then() }, Math.round(350 / rate()))
  showWord(i, sweep(c.spans[i], rate()))
  setTimeout(() => walkWords(my, i + 1, then), pace(c.text, c.spans[i], rate()))
}

const NO_SOUND = N_('No sound? Flip the side switch off Silent, then tap play.')

function say(text: string, lang: string, my: number, then: () => void, spans?: Span[]) {
  if (!synth || my !== run) return
  const u = new SpeechSynthesisUtterance(text)
  // No voice is named: the phone speaks with the one picked in its own settings.
  u.lang = speechTag(lang)
  u.rate = rate()
  // If the phone never starts talking, say so instead of looking busy.
  const quiet = setTimeout(() => { if (my === run) pauseListening(t(NO_SOUND)) }, 5000)
  // Word by word: the phone says where it is when it can; until it does (or
  // if it never does), move along at the voice's own pace.
  let ticker: ReturnType<typeof setTimeout> | undefined, heard = false
  const tick = (i: number) => {
    if (my !== run || heard || !spans) return
    showWord(i, sweep(spans[i], u.rate, true))
    if (i + 1 < spans.length) ticker = setTimeout(() => tick(i + 1), pace(text, spans[i], u.rate, true))
  }
  u.onstart = () => { clearTimeout(quiet); if (spans?.length) tick(0) }
  u.onboundary = e => {
    if (!spans?.length || my !== run || (e.name && e.name !== 'word')) return
    heard = true; clearTimeout(ticker)
    const w = wordAt(spans, e.charIndex)
    showWord(w, sweep(spans[w], u.rate, true))
  }
  u.onend = () => { clearTimeout(quiet); clearTimeout(ticker); if (my === run) then() }
  u.onerror = e => {
    clearTimeout(quiet); clearTimeout(ticker)
    if (my !== run) return
    // Stopped by the phone itself (a call, another app's sound): wait, paused, where it was.
    if (e.error === 'interrupted' || e.error === 'canceled') return pauseListening()
    // Stay where we were, paused, and say so, rather than vanish.
    pauseListening(e.error === 'not-allowed' ? t('Tap play to start.') : t('The phone’s voice couldn’t speak.'))
  }
  synth.speak(u)
}

/** On into the next chapter, or the next book; the page follows, if you're
 * reading along. At the end of the Bible: stay, paused on the last verse,
 * until X, and say so by returning false. */
function onward(): boolean {
  const n = now
  if (!n) return false
  const chapters = n.bible.books[n.book] ?? []
  let book = n.book, chapter = n.chapter + 1
  if (chapter > chapters.length) {
    const after = BOOKS.slice(BOOK_INDEX[n.book] + 1).find(b => n.bible.books[b.id]?.length)
    if (!after) { now = { ...n, verse: (chapters[n.chapter - 1] ?? []).length }; pauseListening(); keep = false; return false }
    book = after.id; chapter = 1
  }
  const r = parseHash().path
  const following = r[0] === 'read' && r[2] === n.book && +r[3] === n.chapter
  now = { ...n, book, chapter, verse: 1 }
  emit()
  if (following) go(readPath(n.version, book, chapter))
  cur = undefined; wordNow = 0; clearWord()
  return true
}

/** The words of a verse, as they're read and followed. */
function verseWords(n: Now, verse: number) {
  const text = plain((n.bible.books[n.book]?.[n.chapter - 1] ?? [])[verse - 1] ?? '').replace(/[[\]¶*]/g, '').trim()
  return { text, spans: words(text) }
}

// ── A recorded reading ────────────────────────────────────────────────────
// One player for the app. It holds a chapter's recording and, once they've
// come, the times of its words.
let player: HTMLAudioElement | undefined
let held: { rec: Recording; url: string; times?: ChapterTimes; from?: number; tries?: number } | undefined
let keep = false // paused in the middle of a recording: play goes on from that very moment
let frame = 0

function audio(): HTMLAudioElement {
  if (player) return player
  const a = player = new Audio()
  a.preload = 'auto'
  a.addEventListener('timeupdate', track) // also keeps the verse right while the screen is off
  a.addEventListener('ended', () => { if (now?.playing && held) chapterDone() })
  // Stopped by the phone itself (a call, another app's sound): wait, paused, where it was.
  a.addEventListener('pause', () => { if (a.paused && !a.ended && now?.playing && held && recorded()) pauseListening() })
  a.addEventListener('error', () => { if (now?.playing && held) lost(run) })
  return a
}

function hush() {
  cancelAnimationFrame(frame)
  if (player && !player.paused) player.pause()
}

/** The lock screen's own play and pause buttons. */
function lockButtons(on: boolean) {
  try {
    navigator.mediaSession.setActionHandler('play', on ? () => { if (now && !now.playing) begin() } : null)
    navigator.mediaSession.setActionHandler('pause', on ? () => pauseListening() : null)
  } catch { /* an older phone */ }
}

/** The recording can't be had (no connection, or a book it hasn't got): the
 * phone's own voice goes on from the same verse, or the highlight alone. */
function lost(my: number) {
  if (my !== run || !now) return
  unreachable = true
  hush(); held = undefined; keep = false; lockButtons(false)
  cur = undefined; resumeAt = 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) listenNote(t('No connection: the phone’s own voice'))
  emit()
  next(my)
}

/** Play the recording of the chapter from the verse we're at. */
function hear(my: number) {
  const n = now, rec = recorded()
  if (!n || !rec || my !== run) return
  const url = chapterUrl(rec, n.book, n.chapter)
  if (!url) return lost(my)
  const a = audio()
  // Paused a moment ago, nothing changed: go on from that very moment.
  const resume = keep && held?.url === url && held.rec === rec && !!held.times
  keep = false
  if (!resume) {
    if (a.src !== url) a.src = url
    held = { rec, url }
    // Start inside the tap (iPhones ask for that), silently, until the verse's place is known.
    a.muted = true
  }
  a.playbackRate = rate()
  lockButtons(true)
  a.play()?.catch((e: { name?: string }) => {
    if (my !== run) return
    if (e?.name === 'NotAllowedError') pauseListening(t('Tap play to start.'))
    else if (e?.name !== 'AbortError') lost(my)
  })
  const loop = () => { if (!now?.playing || !held) return; track(); frame = requestAnimationFrame(loop) }
  cancelAnimationFrame(frame)
  if (resume) { frame = requestAnimationFrame(loop); return }
  loadTimes(rec, n.book).then(all => {
    if (my !== run || held?.url !== url || !now) return
    const times = all?.[n.chapter - 1]
    if (!times) return lost(my)
    // Listen: the first of the verses picked; otherwise the verse asked for.
    const verse = n.only ? n.only.find(x => x >= n.verse && times[x - 1]) : nextTimed(times, n.verse)
    if (verse === undefined) return chapterDone()
    held = { rec, url, times }
    // From the top of a chapter, the recording's own announcement of it ("John
    // chapter 3") is heard first, as when one chapter runs into the next, but
    // not what some recordings say before that (the name of the Bible).
    const at = verse === nextTimed(times, 1) && !n.only ? times.opening ?? 0 : jump(verse)
    const go = () => { if (my === run && held?.url === url) { a.currentTime = at; a.muted = false } }
    if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true })
    now = { ...now, verse }
    cur = verseWords(now, verse); wordNow = -1
    clearWord()
    emit()
    frame = requestAnimationFrame(loop)
  })
}

/** Where to put the player for a verse: a breath before its first word. Until
 * that word, the tail of the verse before isn't taken for where we are. */
function jump(verse: number): number {
  const start = held!.times![verse - 1]!.starts[0]
  held!.from = start
  return Math.max(0, start - 0.08)
}

/** The recording moved on: which verse and word it's at, shown on the page. */
function track() {
  const n = now, a = player, h = held
  if (!n?.playing || !a || !h?.times || a.muted || a.seeking) return
  if (h.from !== undefined) {
    // A jump the player didn't take (asked before it could move): ask again, a few times at most.
    if (a.currentTime < h.from - 1 && a.readyState >= 3 && (h.tries = (h.tries ?? 0) + 1) <= 3) a.currentTime = Math.max(0, h.from - 0.08)
    if (a.currentTime < h.from - 0.01) return
    h.from = undefined; h.tries = 0
  }
  const at = locate(h.times, a.currentTime + 0.03)
  if (!at) return // the chapter's name is being said
  if (n.only && !n.only.includes(at.verse)) {
    // Listen: past a verse picked into one that wasn't. On to the next one picked, or that's all.
    const more = n.only.find(x => x > at.verse && h.times![x - 1])
    if (more === undefined) return stopListening()
    a.currentTime = jump(more)
    return
  }
  if (at.verse !== n.verse || !cur) {
    now = { ...n, verse: at.verse }
    cur = verseWords(now, at.verse); wordNow = -1
    clearWord()
    emit()
  }
  if (at.word === wordNow || !cur) return
  wordNow = at.word
  // Word by word only where the recording's words are the page's words.
  const starts = h.times[at.verse - 1]!.starts
  if (starts.length !== cur.spans.length) return
  const gap = at.word + 1 < starts.length ? (starts[at.word + 1] - starts[at.word]) * 1000 : Infinity
  showWord(at.word, Math.round(Math.min(gap, sweep(cur.spans[at.word], 1, true) * 1.5) / a.playbackRate))
}

/** The chapter's recording ran out: on into the next chapter. */
function chapterDone() {
  const n = now
  if (!n) return
  if (n.only) return stopListening()
  if (onward()) hear(run)
}

function next(my: number) {
  const n = now
  if (!n || my !== run) return
  // Listen: the verses picked, and that's all; any left out in between are skipped.
  if (n.only) {
    const v = n.only.find(x => x >= n.verse)
    if (v === undefined) return stopListening()
    if (v !== n.verse) { now = { ...n, verse: v }; return next(my) }
  }
  const chapters = n.bible.books[n.book] ?? []
  const verses = chapters[n.chapter - 1] ?? []
  if (n.verse > verses.length) {
    if (!onward()) return
    if (silentNow()) return void setTimeout(() => next(my), Math.round(1200 / rate()))
    return say(heading(now!), n.lang, my, () => next(my))
  }
  const { text, spans } = verseWords(n, n.verse)
  if (!spans.length) { now = { ...n, verse: n.verse + 1 }; return next(my) }
  cur = { text, spans }
  const from = Math.min(resumeAt, spans.length - 1)
  resumeAt = 0
  emit()
  const then = () => { if (now) { now = { ...now, verse: now.verse + 1 }; wordNow = 0; next(my) } }
  // A new verse starts clean; picking up after a pause carries on the band.
  if (!from) clearWord()
  if (silentNow()) return walkWords(my, from, then)
  say(text, n.lang, my, then, follow.words ? spans : undefined)
}

function begin() {
  if (!now) return
  const my = ++run
  now = { ...now, playing: true, trouble: undefined }
  unreachable = typeof navigator !== 'undefined' && navigator.onLine === false
  if (recorded()) { synth?.cancel(); emit(); return hear(my) }
  hush(); held = undefined; lockButtons(false)
  if (silentNow() || !synth) {
    // Silently, pick up at the word where it was paused.
    synth?.cancel()
    emit()
    return next(my)
  }
  resumeAt = 0
  const busy = synth.speaking || synth.pending
  synth.cancel()
  synth.resume?.()
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
  resumeAt = 0; cur = undefined; keep = false
  begin()
}

export function pauseListening(trouble?: string) {
  if (!now) return
  run++
  resumeAt = Math.max(0, wordNow)
  synth?.cancel()
  keep = !!held?.times && !!player && !player.ended
  hush()
  holdBands()
  now = { ...now, playing: false, trouble }
  emit()
}

/** Whether reading aloud is on (playing or paused): the mode lasts until X. */
export const readingAloud = () => !!now

/** A word on the reading bar for a moment, where the voice's name is: what a gesture just did. */
let noteText: string | undefined, noteTimer = 0
export function listenNote(text: string) {
  noteText = text
  clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => { noteText = undefined; dispatchEvent(new Event(EVENT)) }, 2200)
  dispatchEvent(new Event(EVENT))
}

/** Where reading aloud is, if it's on. */
export const readingAt = () => now && { version: now.version, book: now.book, chapter: now.chapter, verse: now.verse }
export const LISTEN_EVENT = EVENT

/** The verse being read, tapped: pause, or go on from where it stopped. */
export function toggleReading() {
  if (!now) return
  if (now.playing) pauseListening(); else begin()
}

/** A verse tapped while reading aloud: read from there. */
export function readFrom(spot: Spot, bible: Bible) {
  startListening(spot, bible)
}

/** The reader shows a chapter (or turns a page). While reading aloud, a
 * different place than the one being read is where reading goes on from,
 * playing or paused as it was; after the app was closed and opened again,
 * reading aloud comes back, paused. */
export function followPage(spot: Spot, bible: Bible) {
  if (!now) {
    let saved: Spot | undefined
    try { saved = JSON.parse(get(PLACE_KEY) || 'null') ?? undefined } catch { /* nothing saved */ }
    if (!saved) return
    const here = saved.version === spot.version && saved.book === spot.book && saved.chapter === spot.chapter
    now = { ...(here ? saved : { ...spot, verse: spot.verse || 1 }), bible, playing: false }
    resumeAt = 0; cur = undefined
    return emit()
  }
  if (now.version === spot.version && now.book === spot.book && now.chapter === spot.chapter && (now.verse === spot.verse || spot.verse === 0)) {
    if (now.bible !== bible) now = { ...now, bible }
    return
  }
  const playing = now.playing
  now = { ...spot, verse: spot.verse || 1, bible, playing }
  resumeAt = 0; cur = undefined; wordNow = 0; keep = false
  if (playing) begin()
  else { run++; synth?.cancel(); clearWord(); emit() }
}

export function stopListening() {
  run++
  synth?.cancel()
  hush(); held = undefined; keep = false; lockButtons(false)
  now = undefined; cur = undefined; lit = undefined
  clearWord()
  emit()
}

/** Whether reading aloud is on, kept up to date. */
export function useReadingAloud() { return !!useNow() }

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

/** The reading-aloud bar. It takes the search field's place in the bottom
 * bar while reading aloud is on, so there's only ever one bar; `floating`
 * where there's no search bar (the search page). */
export function ListenPlayer({ floating = false }: { floating?: boolean }) {
  const n = useNow()
  const { settings, update } = useApp()
  followSettings(settings)
  useEffect(() => { if (!follow.words) clearWord() }, [settings.follow])
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
  useEffect(() => () => { document.querySelectorAll('.speaking').forEach(el => el.classList.remove('speaking')); clearWord() }, [])

  // iPhones mute web speech in Silent mode, so say so gently the first few
  // times reading starts there.
  const [tip, setTip] = useState(false)
  useEffect(() => {
    if (!n || !IPHONE || silentNow() || recorded()) return
    const seen = Number(get(TIP_KEY)) || 0
    if (seen >= 5) return
    put(TIP_KEY, String(seen + 1))
    setTip(true)
    const timer = setTimeout(() => setTip(false), 9000)
    return () => clearTimeout(timer)
  }, [!!n])

  if (!n) return null
  const r = rate()
  const rec = recorded()
  // Silently, the new speed takes effect at the next word, and a recording changes pace at once; the phone's voice has to start the verse again.
  const cycle = () => {
    const to = RATES[(RATES.indexOf(r) + 1) % RATES.length]
    put(RATE_KEY, String(to)); redraw(x => x + 1)
    if (rec) { if (player) player.playbackRate = to } else if (n.playing && !silentNow()) begin()
  }
  const silent = silentNow()
  // Picked in the voice sheet, inside the tap, so an iPhone lets the voice start.
  const pick = (quiet: boolean) => {
    setVoices(false)
    follow = { ...follow, silent: quiet }
    update({ readSilent: quiet })
    redraw(x => x + 1)
    if (n.playing) { if (!quiet) resumeAt = 0; begin() }
  }
  return (
    <>
      <div class={'listen' + (floating ? ' listen-float' : '')} role="region" aria-label={t('Reading aloud')}>
        <button class="listen-play" onClick={() => n.playing ? pauseListening() : begin()} aria-label={n.playing ? t('Pause') : t('Play')}>
          {n.playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
        </button>
        <button class="listen-what" onClick={() => setVoices(true)} aria-label={t('Choose the voice')}>
          <strong>{bookTitle(n.book, n.lang)} {n.chapter}:{n.verse}</strong>
          <span class={n.trouble || tip || noteText ? 'listen-trouble' : 'muted'}>{noteText ? '✓ ' + noteText : n.trouble ?? (tip ? t('Flip the side switch off Silent to hear') : silent ? t('No voice') : rec ? rec.name : t('Phone’s own voice'))}{noteText ? '' : ' ▾'}</span>
        </button>
        <button class="listen-rate" onClick={cycle} aria-label={t('Speed {rate} times. Change', { rate: r })}>{r.toLocaleString(locale())}×</button>
        <button class="close-btn listen-stop" onClick={stopListening} aria-label={t('Stop reading aloud')}><CloseIcon size={24} /></button>
      </div>
      {voices && <VoiceSheet version={n.version} lang={n.lang} silent={silent} onClose={() => setVoices(false)} onPick={pick} />}
    </>
  )
}

const SAMPLE: Record<string, string> = {
  en: 'The Lord is my shepherd; I shall not want.',
  fr: 'L’Éternel est mon berger: je ne manquerai de rien.',
  es: 'Jehová es mi pastor; nada me faltará.',
}

// How to get a more natural phone voice, step by step, for each kind of
// phone. The one in your hand comes first.
const iphoneHelp = () => (
  <details class="account-more voice-help">
    <summary>{t('Add better voices on iPhone or iPad')}</summary>
    <ol class="muted small">
      <li>{t('Open the Settings app and search “Voices” (Accessibility → Read & Speak → Voices, called Spoken Content on older iPhones).')}</li>
      <li>{t('Pick your language, download a voice marked “Enhanced” or “Premium”, and tap it so it’s checked.')}</li>
      <li>{t('Come back here and use “Phone’s own voice”. Tap ▶ to hear it.')}</li>
    </ol>
    <p class="muted small">{t('Siri voices are kept for Apple’s own apps and can’t be used here.')}</p>
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
  </details>
)

/** Who reads: for a Bible with a recorded reading, its narrators; for any
 * other, the phone's own voice. And always, no voice at all. */
function VoiceSheet({ version, lang, silent, onClose, onPick }: { version: string; lang: string; silent: boolean; onClose: () => void; onPick: (silent: boolean) => void }) {
  const code = lang.split('-')[0]
  const readers = recordingsFor(version)
  const reader = recordingFor(version)
  const sample = () => {
    pauseListening()
    const u = new SpeechSynthesisUtterance(SAMPLE[code] ?? SAMPLE.en)
    u.lang = speechTag(lang); u.rate = rate()
    synth?.speak(u)
  }
  return (
    <Sheet title={t('Voice')} onClose={onClose}>
      {readers.length > 0
        ? <p class="muted small">{t('This Bible has a recorded reading. It plays over the internet; with no connection, the phone’s own voice reads instead.')}</p>
        : <>
          <p class="muted small">{t('This Bible is read by your phone’s own voice: the one picked in the phone’s settings.')}</p>
          {IPHONE ? <>{iphoneHelp()}{androidHelp()}</> : <>{androidHelp()}{iphoneHelp()}</>}
        </>}
      <div class="voice-list">
        {readers.map(r => (
          <div class={'voice-row' + (!silent && r === reader ? ' on' : '')}>
            <button class="voice-pick" onClick={() => { put(REC_KEY + version, r.id); onPick(false) }}>
              <strong>{r.name}</strong>
              <span class="muted small">{t('A recorded reading')}</span>
            </button>
          </div>
        ))}
        {!readers.length && canListen && (
          <div class={'voice-row' + (!silent ? ' on' : '')}>
            <button class="voice-pick" onClick={() => onPick(false)}>
              <strong>{t('Phone’s own voice')}</strong>
              <span class="muted small">{t('The voice picked in your phone’s settings')}</span>
            </button>
            <button class="voice-try" onClick={sample} aria-label={t('Hear the phone’s own voice')}><PlayIcon size={20} /></button>
          </div>
        )}
        <div class={'voice-row' + (silent ? ' on' : '')}>
          <button class="voice-pick" onClick={() => onPick(true)}>
            <strong>{t('No voice')}</strong>
            <span class="muted small">{t('Just the highlight, moving through the words at your speed')}</span>
          </button>
        </div>
      </div>
      {readers.length > 0 && <p class="muted small">{t('The recordings come from openbible.com, the home of the Berean Bible.')}</p>}
    </Sheet>
  )
}
