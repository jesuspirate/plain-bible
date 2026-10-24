import type { SyncApi } from './account'
import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { Catalog, DataSource, Translation } from './lib/data'
import type { SearchOptions } from './lib/query'
import type { Marks } from './lib/marks'
import type { PrayerVerse } from './lib/prayerVerses'

export type FontId = 'literata' | 'source-serif' | 'garamond' | 'inter' | 'atkinson' | 'system'

export const FONTS: { id: FontId; label: string; note: string; family: string }[] = [
  { id: 'literata', label: 'Literata', note: 'Book serif made for long reading', family: "'Literata Variable', Georgia, serif" },
  { id: 'source-serif', label: 'Source Serif', note: 'Crisp, modern serif', family: "'Source Serif 4 Variable', Georgia, serif" },
  { id: 'garamond', label: 'Garamond', note: 'Classic printed-Bible feel', family: "'EB Garamond Variable', Garamond, Georgia, serif" },
  { id: 'inter', label: 'Inter', note: 'Clean sans-serif', family: "'Inter Variable', system-ui, sans-serif" },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', note: 'Designed for low vision; very easy to read', family: "'Atkinson Hyperlegible', system-ui, sans-serif" },
  { id: 'system', label: 'System', note: "Your device's own font", family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
]

export interface Settings {
  theme: 'system' | 'light' | 'dark' | 'sepia'
  fontSize: number
  font: FontId
  searchBar: boolean
  layout: 'paragraph' | 'verses'
  /** how highlights look: behind the letters like a pen, a full block, or coloured letters */
  highlight: 'marker' | 'block' | 'text'
  /** verse number size */
  verseNumbers: 'small' | 'medium' | 'large'
  /** how the page turns when you swipe to another chapter: over the next one, or side by side */
  turn: 'stack' | 'slide' | 'off'
  /** skin tone of the 🙏 on the prayer button: a modifier character, or '' for the plain one */
  prayTone: string
  /** a quiet line under the chapter title when you have notes on it */
  noteReminders: boolean
  strongs: boolean
  strongsNumbers: boolean
  myVersions: string[]
  version: string
  /** the version the app always opens in */
  favorite?: string
  parallel: string[]
  searchVersions: string[]
  searchOptions: SearchOptions
}

/** The skin tones of 🙏, plain first. */
export const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']

const KEY = 'plain-bible:settings'

export function defaultSettings(catalog?: Catalog): Settings {
  const lang = (navigator.language || 'en').toLowerCase().split('-')[0]
  const local = catalog?.translations.filter(t => t.lang.split('-')[0] === lang && lang !== 'en').slice(0, 3).map(t => t.id) ?? []
  return {
    theme: 'sepia', fontSize: 22, font: 'literata', searchBar: true, layout: 'verses', highlight: 'marker', verseNumbers: 'medium', turn: 'stack', prayTone: '', noteReminders: true, strongs: false, strongsNumbers: false,
    myVersions: ['KJV', 'BSB', 'NHEB', 'ASV', 'YLT', 'DRC', ...local, 'OSHB', 'StatResGNT'],
    version: local[0] ?? 'KJV', parallel: [], searchVersions: [local[0] ?? 'KJV'],
    searchOptions: { caseSensitive: false, accentSensitive: false, partialWords: false },
  }
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

/** Open the prayer overlay over whatever is on screen. */
export const PRAY_EVENT = 'plain-bible:pray'
export const openPrayer = () => window.dispatchEvent(new Event(PRAY_EVENT))

/** Open Settings (the sheet behind the button in the top right corner). */
export const SETTINGS_EVENT = 'plain-bible:settings'
export const openSettings = () => window.dispatchEvent(new Event(SETTINGS_EVENT))

// A prayer can be tied to a verse. Verses you just selected are offered when
// you open prayer soon after; Pray on the selection bar ties them at once.
let picked: { verse: PrayerVerse; at: number; sure: boolean } | undefined
/** The reader calls this as verses are selected. */
export const versesPicked = (verse: PrayerVerse) => { picked = { verse, at: Date.now(), sure: false } }
/** Pray with these verses in mind. */
export const prayOver = (verse: PrayerVerse) => { picked = { verse, at: Date.now(), sure: true }; openPrayer() }
/** What to offer as the prayer opens: verses selected in the last two
 *  minutes, and whether they were chosen for this prayer. Asked once. */
export function verseToPrayOver() {
  const p = picked
  picked = undefined
  return p && Date.now() - p.at < 120_000 ? { verse: p.verse, sure: p.sure } : undefined
}

// Circles. Sharing buttons show only for people in at least one circle,
// known without loading anything (the count is kept from the last look).
const CIRCLES = 'plain-bible:circles'
export const inCircles = () => { try { return +(localStorage.getItem(CIRCLES) || 0) > 0 } catch { return false } }
export const setInCircles = (n: number) => { try { n ? localStorage.setItem(CIRCLES, String(n)) : localStorage.removeItem(CIRCLES) } catch { /* ignore */ } }
/** Something to share with a circle: verses with their words (and maybe
 *  the note being written on them), or a prayer. */
export type ShareRequest = { verse: PrayerVerse; version: string; text: string; note?: string } | { prayer: string }
export const SHARE_EVENT = 'plain-bible:share-circle'
export const shareWithCircle = (r: ShareRequest) => window.dispatchEvent(new CustomEvent(SHARE_EVENT, { detail: r }))

// After a prayer, "Add a verse" lets you tap one on the page.
export const PICK_EVENT = 'plain-bible:pick-verse'
let awaiting: string | undefined
/** The prayer waiting for a verse to be tapped, if any. */
export const prayerAwaitingVerse = () => awaiting
export const awaitVerse = (id: string | undefined) => { awaiting = id; window.dispatchEvent(new Event(PICK_EVENT)) }

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

export function readPath(version: string, book: string, chapter: number, verse?: number, parallel: string[] = []) {
  const q = new URLSearchParams()
  if (verse) q.set('v', String(verse))
  if (parallel.length) q.set('p', parallel.join(','))
  const qs = q.toString()
  return `read/${version}/${book}/${chapter}${qs ? '?' + qs : ''}`
}
/** Like readPath, but opens with `verse` at the top of the screen (where you
 *  left off) instead of marking it as a verse you jumped to. */
export function resumePath(version: string, book: string, chapter: number, verse: number, parallel: string[] = []) {
  const p = readPath(version, book, chapter, undefined, parallel)
  return verse > 1 ? `${p}${p.includes('?') ? '&' : '?'}at=${verse}` : p
}
