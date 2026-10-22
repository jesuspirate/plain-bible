import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'
import { Catalog, DataSource, Translation } from './lib/data'
import type { SearchOptions } from './lib/query'

export interface Settings {
  theme: 'system' | 'light' | 'dark' | 'sepia'
  fontSize: number
  font: 'serif' | 'sans'
  layout: 'paragraph' | 'verses'
  strongs: boolean
  strongsNumbers: boolean
  myVersions: string[]
  version: string
  parallel: string[]
  searchVersions: string[]
  searchOptions: SearchOptions
}

const KEY = 'plain-bible:settings'

export function defaultSettings(catalog?: Catalog): Settings {
  const lang = (navigator.language || 'en').toLowerCase().split('-')[0]
  const local = catalog?.translations.filter(t => t.lang.split('-')[0] === lang && lang !== 'en').slice(0, 3).map(t => t.id) ?? []
  return {
    theme: 'system', fontSize: 19, font: 'serif', layout: 'verses', strongs: false, strongsNumbers: false,
    myVersions: ['KJV', 'BSB', 'NHEB', 'ASV', 'YLT', 'DRC', ...local, 'OSHB', 'StatResGNT'],
    version: local[0] ?? 'KJV', parallel: [], searchVersions: [local[0] ?? 'KJV'],
    searchOptions: { caseSensitive: false, accentSensitive: false, partialWords: false },
  }
}

export function loadSettings(): Partial<Settings> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
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
}
export const AppContext = createContext<AppState>(null!)
export const useApp = () => useContext(AppContext)

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
