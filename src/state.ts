import type { SyncApi } from './account'
import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { holdUpdate } from './lib/update'
import { Catalog, DataSource, Translation } from './lib/data'
import type { SearchOptions } from './lib/query'
import type { Marks } from './lib/marks'
import type { PrayerVerse } from './lib/prayerVerses'
import { knownLang, langOf, N_, type Lang } from './i18n'
import type { Away } from './sideways'

export type FontId = 'literata' | 'source-serif' | 'garamond' | 'inter' | 'atkinson' | 'system'

export const FONTS: { id: FontId; label: string; note: string; family: string }[] = [
  { id: 'literata', label: 'Literata', note: N_('Book serif made for long reading'), family: "'Literata Variable', Georgia, serif" },
  { id: 'source-serif', label: 'Source Serif', note: N_('Crisp, modern serif'), family: "'Source Serif 4 Variable', Georgia, serif" },
  { id: 'garamond', label: 'Garamond', note: N_('Classic printed-Bible feel'), family: "'EB Garamond Variable', Garamond, Georgia, serif" },
  { id: 'inter', label: 'Inter', note: N_('Clean sans-serif'), family: "'Inter Variable', system-ui, sans-serif" },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', note: N_('Designed for low vision; very easy to read'), family: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  { id: 'system', label: N_('System'), note: N_("Your device's own font"), family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
]

export interface Settings {
  /** the language of the app's own words; 'auto' follows the phone */
  language: 'auto' | Lang
  theme: 'system' | 'light' | 'dark' | 'sepia'
  fontSize: number
  font: FontId
  searchBar: boolean
  /** what slides away while you read with the phone on its side (none: nothing does) */
  sideways: Away[]
  /** the bars picked in `sideways` slide away whichever way the device is
   *  held, as in Teaching mode (off: only with the phone on its side) */
  hideBars: boolean
  layout: 'paragraph' | 'verses'
  /** how highlights look: behind the letters like a pen, a full block, or colored letters */
  highlight: 'marker' | 'block' | 'text'
  /** a new highlight is drawn in slowly, line by line, like a marker in your
   *  hand (off: a quick swipe). Was penDraw, on by default; renamed so everyone
   *  starts with the quick swipe and only those who pick it get the slow pen. */
  penSlow: boolean
  /** highlight colors, the one used last first, so the pickers show them in that order */
  recentColors: string[]
  /** reading aloud lights up each word as it's said, or just the verse */
  follow: 'words' | 'verse'
  /** read along with no voice: the highlight moves through the words by itself */
  readSilent: boolean
  /** a small Read along button just above 🙏 (off unless picked under Audio) */
  /** The Bible switcher pill in the search bar (11-28: a choice, off by default). */
  versionPill: boolean
  /** Read along's icon in the search bar, joined to the Bible switcher when that's on (Extras; off by default). */
  alongPill: boolean
  /** verse number size */
  verseNumbers: 'small' | 'medium' | 'large'
  /** how the page turns when you swipe to another chapter: over the next one, or side by side */
  turn: 'stack' | 'slide' | 'off'
  /** on a wide screen (an iPad on its side, a computer): an open book of two pages, or one page that scrolls */
  spread: 'double' | 'single'
  /** skin tone of the 🙏 on the prayer button: a modifier character, or '' for the plain one */
  prayTone: string
  /** The look of 🙏 and Circles: quiet (their glass look, the default), or a disc with a gold ring, brown or honey, the same for every skin tone. */
  discs: 'quiet' | 'brown' | 'honey'
  /** a quiet line under the chapter title when you have notes on it */
  noteReminders: boolean
  /** show how many days in a row you've read and prayed */
  streaks: boolean
  /** count this device's prayers, by country only, on the prayer map (src/world.tsx) */
  worldMap: boolean
  /** the circles that see your streaks (ids); none unless you turn it on */
  shareStreaks: string[]
  // Circles list order the person arranged (circle ids, top first).
  circleOrder: string[]
  strongs: boolean
  strongsNumbers: boolean
  myVersions: string[]
  /** your Bible: the one you picked, and the one the app opens in. Reading
   *  another version (a search result, a link) doesn't change it. */
  version: string
  parallel: string[]
  searchVersions: string[]
  searchOptions: SearchOptions
}

/** The skin tones of 🙏, plain first. */
/** The text size everyone starts on, and the one "Back to default size" returns to. */
export const DEFAULT_FONT_SIZE = 22

export const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']

const KEY = 'plain-bible:settings'

// The Bible a newcomer starts in, for languages with more than one: the
// usual one, not whichever sorts first (for French that was the Ethiopian
// canon's EthFr, ahead of the Louis Segond).
const USUAL: Record<string, string> = { fr: 'LSG', es: 'SpaRV' }

export function defaultSettings(catalog?: Catalog): Settings {
  const picked = welcomeLang()
  const lang = picked ?? langOf(navigator.language ?? 'en')
  const rank = (id: string) => id === USUAL[lang] ? 0 : id.startsWith('Eth') ? 2 : 1
  const local = catalog?.translations.filter(t => (t.lang === lang || t.lang.split('-')[0] === lang) && lang !== 'en')
    .sort((a, b) => rank(a.id) - rank(b.id)).slice(0, 3).map(t => t.id) ?? []
  return {
    language: picked ?? 'auto', theme: 'sepia', fontSize: DEFAULT_FONT_SIZE, font: 'literata', searchBar: true, sideways: ['top', 'search', 'pray'], hideBars: false, layout: 'verses', highlight: 'marker', penSlow: false, recentColors: [], follow: 'words', readSilent: false, versionPill: false, alongPill: false, verseNumbers: 'medium', turn: 'stack', spread: 'double', prayTone: '', discs: 'quiet', noteReminders: true, streaks: true, worldMap: true, shareStreaks: [], circleOrder: [], strongs: false, strongsNumbers: false,
    myVersions: ['BSB', 'NHEB', 'KJV', 'ASV', 'DRC', 'YLT', ...local, 'OSHB', 'StatResGNT'],
    version: local[0] ?? 'KJV', parallel: [], searchVersions: [local[0] ?? 'KJV'],
    searchOptions: { caseSensitive: false, accentSensitive: false, partialWords: false },
  }
}

/** The theme picked on the welcome page before the Bible was first opened, if any (welcome/welcome.ts). */
export function welcomeTheme(): Settings['theme'] | undefined {
  try {
    const t = localStorage.getItem('plain-bible:welcome-theme')
    return t === 'light' || t === 'sepia' || t === 'dark' ? t : undefined
  } catch { return undefined }
}

/** The language picked on the welcome page before the Bible was first opened, if any. */
export function welcomeLang(): Lang | undefined {
  try {
    return knownLang(localStorage.getItem('plain-bible:welcome-lang'))
  } catch { return undefined }
}

export function loadSettings(): Partial<Settings> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}')
    // Fonts were once just 'serif' or 'sans'.
    if (s.font === 'serif') s.font = 'literata'
    if (s.font === 'sans') s.font = 'inter'
    if (s.font && !FONTS.some(f => f.id === s.font)) delete s.font
    // The fold turn was tried and dropped.
    if (s.turn === 'fold') s.turn = 'stack'
    return s
  } catch { return {} }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}

export interface AppState {
  data: DataSource
  catalog: Catalog
  byId: Map<string, Translation>
  settings: Settings
  update: (patch: Partial<Settings>) => void
  marks: Marks
  setMarks: (fn: (m: Marks) => Marks) => void
  sync: SyncApi
}
export const AppContext = createContext<AppState>(null!)
export const useApp = () => useContext(AppContext)

/** Open the prayer overlay over whatever is on screen: to pray, or on
 *  Circles (and one circle), which have their own button but open there. */
export const PRAY_EVENT = 'plain-bible:pray'
export type PrayAt = { circles: true; circle?: { id: string; name: string } }
export const openPrayer = (at?: PrayAt) => window.dispatchEvent(new CustomEvent(PRAY_EVENT, { detail: at }))
export const openCircles = (circle?: { id: string; name: string }) => openPrayer({ circles: true, circle })
/** The 🙏 on the iPhone Home Screen widget (#/pray): the prayer screen opens
 *  already listening, with no second tap. */
let listenNow = false
export const prayNow = () => { listenNow = true; openPrayer() }
/** Asked once by the prayer screen as it opens. */
export const takePrayNow = () => { const n = listenNow; listenNow = false; return n }
/** Pray for someone's prayer request in a circle: the prayer screen opens
 *  listening, with their words on top, and once the prayer is kept the
 *  request is marked prayed. */
export type PrayFor = { circle: string; circleName: string; item: string; by: string; note: string
  /** your own request: what's already in your sealed row on it, kept as is */
  own?: { me: string; e: string[]; a?: number } }
let prayingFor: PrayFor | undefined
export const prayFor = (ask: PrayFor) => { prayingFor = ask; prayNow() }
export const takePrayFor = () => { const a = prayingFor; prayingFor = undefined; return a }
/** Just prayed for a request: the circle shows it prayed at once. */
let prayedNow: { item: string; at: number } | undefined
export const setPrayedNow = (item: string) => { prayedNow = { item, at: Date.now() } }
export const prayedNowFor = (item: string) => prayedNow?.item === item && Date.now() - prayedNow.at < 30 * 60_000
/** Sent once a request was marked prayed this way, so the circle shows it. */
export const ASK_PRAYED = 'plain-bible:ask-prayed'

/** Open Settings (the sheet behind the button in the top right corner). */
export const READ_HERE_EVENT = 'plain-bible:read-here'
export const readHere = () => window.dispatchEvent(new Event(READ_HERE_EVENT))
export const SETTINGS_EVENT = 'plain-bible:settings'
let settingsAt: string | undefined
/** With a page (say 'sync', Account), Settings open on it. */
export const openSettings = (page?: string) => { settingsAt = page; window.dispatchEvent(new Event(SETTINGS_EVENT)) }
/** Asked once by Settings as they open. */
export const takeSettingsPage = () => { const p = settingsAt; settingsAt = undefined; return p }

/** Open search (the bar at the bottom, or the round button in its place)
 *  with the keyboard up, as a tap on it does: from a tap on the chapter's
 *  title, or a pull down from the top of the chapter. Call it inside the
 *  tap or touch itself, so iPhone brings the keyboard up. */
export const SEARCH_EVENT = 'plain-bible:search'
export const openSearch = () => window.dispatchEvent(new Event(SEARCH_EVENT))

/** The guided tour: a few calm steps over the reader, shown once to someone
 *  new, and again from Settings whenever asked. */
/** Show me, under Audio in Settings: Settings close and the reader opens the
 *  bar of a verse in view, with Listen and Read along on it. The app passes
 *  it on to the reader as VERSE_BAR_EVENT once Settings are out of the way. */
export const SHOW_VERSE_BAR = 'plain-bible:show-verse-bar'
export const VERSE_BAR_EVENT = 'plain-bible:verse-bar'
export const showVerseBar = () => window.dispatchEvent(new Event(SHOW_VERSE_BAR))
/** Try it now, under Search bar in Settings: Settings close, and the
 *  fingertip shows the other ways to open search on the chapter title. */
export const SHOW_SEARCH_WAYS = 'plain-bible:show-search-ways'
export const showSearchWays = () => window.dispatchEvent(new Event(SHOW_SEARCH_WAYS))
/** The Read along button above 🙏: the reader starts reading along from the
 *  verse you picked, or else the verse at the top of the screen. */
/** The verse the page marks with a faint 🙏 (reader.tsx markPray): a prayer
 *  started now is kept with it. */
let prayHereAt: { book: string; chapter: number; verse: number } | undefined
export const setPrayHere = (p: typeof prayHereAt) => { prayHereAt = p }
export const prayHere = () => prayHereAt
export const TOUR_EVENT = 'plain-bible:tour'
export const openTour = () => window.dispatchEvent(new Event(TOUR_EVENT))
const TOUR = 'plain-bible:tour'
/** Everyone, new or not, gets the tour once on each device, until it has shown. */
export const tourDue = () => { try { return localStorage.getItem(TOUR) !== 'seen' } catch { return false } }
export const markTourSeen = () => { try { localStorage.setItem(TOUR, 'seen') } catch { /* ignore */ } }

// A prayer can be tied to verses. Verses you just selected are offered when
// you open prayer soon after; Pray on the selection bar ties them at once.
let picked: { verses: PrayerVerse[]; at: number; sure: boolean } | undefined
/** The reader calls this as verses are selected. */
export const versesPicked = (verse: PrayerVerse) => { picked = { verses: [verse], at: Date.now(), sure: false } }
/** The selection closed (or a double tap highlighted the verse and let it
 *  go): it's no longer what a prayer is about. A verse handed over by Pray
 *  on the selection bar stays. Kept, a verse picked a minute ago and let go
 *  was kept with the next prayer while the faint 🙏 sat elsewhere. */
export const versesUnpicked = () => { if (picked && !picked.sure) picked = undefined }
/** Pray using these verses. */
/** The verses a prayer is about while it's open: the page lights them up so
 *  you can read them as you pray. */
let prayingOn: PrayerVerse[] = []
export const PRAYING_EVENT = 'plain-bible:praying-over'
export const prayingOver = () => prayingOn
export const setPrayingOver = (verses: PrayerVerse[]) => { prayingOn = verses; dispatchEvent(new Event(PRAYING_EVENT)) }
export const prayOver = (...verses: PrayerVerse[]) => { picked = { verses, at: Date.now(), sure: true }; openPrayer() }
/** What to offer as the prayer opens: verses selected in the last two
 *  minutes, and whether they were chosen for this prayer. Asked once. */
export function verseToPrayOver() {
  const p = picked
  picked = undefined
  return p && Date.now() - p.at < 120_000 ? { verses: p.verses, sure: p.sure } : undefined
}

// Circles. Sharing buttons show only for people in at least one circle,
// known without loading anything (the count is kept from the last look).
const CIRCLES = 'plain-bible:circles'
export const inCircles = () => { try { return +(localStorage.getItem(CIRCLES) || 0) > 0 } catch { return false } }
// Circles you can share into: not an Open door circle someone else leads.
const SHARE_TO = 'plain-bible:circles-share'
export const setInCircles = (n: number, shareable = n) => {
  try {
    n ? localStorage.setItem(CIRCLES, String(n)) : localStorage.removeItem(CIRCLES)
    shareable ? localStorage.setItem(SHARE_TO, String(shareable)) : localStorage.setItem(SHARE_TO, '0')
  } catch { /* ignore */ }
}
/** Whether the share-with-circle buttons show. Before this was kept, any circle counted. */
export const canShareInCircles = () => { try { const s = localStorage.getItem(SHARE_TO); return s === null ? inCircles() : +s > 0 } catch { return false } }
/** Something to share with a circle: verses with their words (and maybe
 *  the note being written on them), a prayer, or all of one day's prayers. */
export type ShareRequest = { verse: PrayerVerse; version: string; text: string; note?: string } | { prayer: string } | { prayers: string[] }
export const SHARE_EVENT = 'plain-bible:share-circle'
export const shareWithCircle = (r: ShareRequest) => window.dispatchEvent(new CustomEvent(SHARE_EVENT, { detail: r }))

// "Add a verse": the prayer steps aside, and verses you tap on the page are
// added to it (or taken off), turning pages or searching to reach others,
// until Done. `prayer`: a prayer already kept; without it, the one about to
// be prayed, which opens again with them.
export const PICK_EVENT = 'plain-bible:pick-verse'
export type VersePick = { prayer?: string; verses: PrayerVerse[]; from: PrayerVerse[]
  /** something you shared in a circle (a request or a prayer): Done changes
   *  its verses there (`body`: what it holds now, maybe with new words) and
   *  goes back to the circle */
  circle?: { id: string; name: string; item: string; body: unknown } }
let picking: VersePick | undefined
/** The verses being picked for a prayer, if any. */
export const versePick = () => picking
export const pickVerses = (p: VersePick | undefined) => { picking = p; holdUpdate('pick', !!p); window.dispatchEvent(new Event(PICK_EVENT)) }

// ---- hash routing ------------------------------------------------------------

export interface Route { path: string[]; params: URLSearchParams }

export function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  const [p, q] = h.split('?')
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(q || '') }
}

export function go(path: string, replace = false) {
  const url = '#/' + path.replace(/^\//, '')
  if (replace) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function useRoute(): Route {
  const [r, setR] = useState(parseHash)
  useEffect(() => {
    const on = () => setR(parseHash())
    window.addEventListener('hashchange', on)
    window.addEventListener('popstate', on)
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on) }
  }, [])
  return r
}

/** `end` is the last verse when you go to several (John 3:16-18). */
export function readPath(version: string, book: string, chapter: number, verse?: number, parallel: string[] = [], end?: number) {
  const q = new URLSearchParams()
  if (verse) q.set('v', String(verse))
  if (verse && end && end > verse) q.set('e', String(end))
  if (parallel.length) q.set('p', parallel.join(','))
  const qs = q.toString()
  return `read/${version}/${book}/${chapter}${qs ? '?' + qs : ''}`
}
/** A link to verses for someone else. It names your version, but opens in
 *  the version they read (see ReaderRoute), never in yours. */
export function sharedPath(version: string, book: string, chapter: number, verse?: number, end?: number) {
  const p = readPath(version, book, chapter, verse, [], end)
  return `${p}${p.includes('?') ? '&' : '?'}shared=1`
}

/** Like readPath, but opens with `verse` at the top of the screen (where you
 *  left off) instead of marking it as a verse you jumped to. */
export function resumePath(version: string, book: string, chapter: number, verse: number, parallel: string[] = []) {
  const p = readPath(version, book, chapter, undefined, parallel)
  return verse > 1 ? `${p}${p.includes('?') ? '&' : '?'}at=${verse}` : p
}
