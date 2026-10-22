import { useEffect, useMemo, useState } from 'preact/hooks'
import { Catalog, DataSource } from './lib/data'
import { Reader } from './reader'
import { Search } from './search'
import { AppContext, defaultSettings, FONTS, go, loadSettings, readPath, Route, saveSettings, Settings, useApp, useRoute } from './state'
import { Versions } from './versions'
import { SearchBar } from './searchbar'
import { Saved } from './saved'
import { DataTools } from './import'
import { loadMarks, Marks, saveMarks } from './lib/marks'

const data = new DataSource(new URL('data/', document.baseURI).href)

export function App() {
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Settings>()
  const [marks, setMarksState] = useState<Marks>(loadMarks)
  const route = useRoute()
  const setMarks = (fn: (m: Marks) => Marks) => setMarksState(m => { const n = fn(m); saveMarks(n); return n })

  useEffect(() => {
    data.catalog().then(c => {
      const ids = new Set(c.translations.map(t => t.id))
      const s = { ...defaultSettings(c), ...loadSettings() }
      s.myVersions = s.myVersions.filter(id => ids.has(id))
      if (!ids.has(s.version)) s.version = c.translations[0].id
      setCatalog(c); setSettings(s)
    }).catch(e => setError(String(e.message || e)))
  }, [])

  useEffect(() => {
    if (!settings) return
    saveSettings(settings)
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.style.setProperty('--font-size', settings.fontSize + 'px')
    root.style.setProperty('--reading', FONTS.find(f => f.id === settings.font)!.family)
  }, [settings])

  // The reader manages its own scroll position; other pages start at the top.
  const page = route.path[0] || 'read'
  useEffect(() => { if (page !== 'read') window.scrollTo(0, 0) }, [page])

  const byId = useMemo(() => new Map(catalog?.translations.map(t => [t.id, t]) ?? []), [catalog])

  if (error) return <p class="error center">Could not load the library: {error}</p>
  if (!catalog || !settings) return <p class="muted center">Loading…</p>

  const update = (patch: Partial<Settings>) => setSettings(s => ({ ...s!, ...patch }))
  const view = route.path[0] || 'read'

  return (
    <AppContext.Provider value={{ data, catalog, byId, settings, update, marks, setMarks }}>
      <header class="top">
        <a class="brand" href={'#/' + readPath(settings.version, 'John', 1)}>Plain Bible</a>
        <nav>
          <a class={view === 'read' ? 'on' : ''} href="#/read">Read</a>
          <a class={view === 'search' ? 'on' : ''} href="#/search">Search</a>
          <a class={view === 'saved' ? 'on' : ''} href="#/saved">Saved</a>
          <a class={view === 'versions' ? 'on' : ''} href="#/versions">Versions</a>
          <a class={view === 'settings' ? 'on' : ''} href="#/settings" aria-label="Settings" title="Settings">
            <svg class="gear" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" /></svg>
          </a>
        </nav>
        <ThemeToggle />
      </header>
      <main class={settings.searchBar && view !== 'search' ? 'with-bar' : ''}>
        {view === 'search' ? <Search route={route} />
          : view === 'versions' ? <Versions />
          : view === 'saved' ? <Saved />
          : view === 'settings' ? <SettingsView />
          : <ReaderRoute route={route} />}
      </main>
      {settings.searchBar && view !== 'search' && <SearchBar here={view === 'read' && route.path.length >= 4
        ? { version: route.path[1], book: route.path[2], chapter: +route.path[3] } : undefined} />}
    </AppContext.Provider>
  )
}

function ReaderRoute({ route }: { route: Route }) {
  const { settings } = useApp()
  // "#/read" with no reference resumes the last place read.
  useEffect(() => {
    if (route.path.length < 4) {
      const last = loadLast()
      go(readPath(route.path[1] || settings.version, last?.[0] ?? 'John', last?.[1] ?? 1), true)
    } else saveLast(route.path[2], +route.path[3])
  }, [route.path.join('/')])
  return route.path.length >= 4 ? <Reader route={route} /> : null
}

function ThemeToggle() {
  const { settings, update } = useApp()
  const prefersDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark)
  return (
    <button class="icon theme-toggle" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}
      onClick={() => update({ theme: dark ? 'light' : 'dark' })}>
      {dark
        ? <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor" /><g stroke="currentColor" stroke-width="2" stroke-linecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map(a => <line x1="12" y1="2.5" x2="12" y2="4.5" transform={`rotate(${a} 12 12)`} />)}</g></svg>
        : <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor" /></svg>}
    </button>
  )
}

const LAST = 'plain-bible:last'
function loadLast(): [string, number] | undefined { try { return JSON.parse(localStorage.getItem(LAST) || 'null') ?? undefined } catch { return undefined } }
function saveLast(book: string, ch: number) { try { localStorage.setItem(LAST, JSON.stringify([book, ch])) } catch { /* ignore */ } }

function SettingsView() {
  const { settings, update, catalog } = useApp()
  useEffect(() => { document.title = 'Settings · Plain Bible' }, [])
  const sel = <K extends keyof Settings>(k: K, opts: [Settings[K], string][]) => (
    <div class="seg" role="radiogroup">
      {opts.map(([v, label]) => (
        <button role="radio" aria-checked={settings[k] === v} class={settings[k] === v ? 'on' : ''} onClick={() => update({ [k]: v } as Partial<Settings>)}>{label}</button>
      ))}
    </div>
  )
  return (
    <div class="settings">
      <h1>Settings</h1>
      <div class="field"><span>Theme</span>{sel('theme', [['system', 'Auto'], ['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark']])}</div>
      <div class="field"><span>Text size</span>
        <div class="row">
          <button onClick={() => update({ fontSize: Math.max(13, settings.fontSize - 1) })} aria-label="Smaller">A−</button>
          <span class="muted">{settings.fontSize}px</span>
          <button onClick={() => update({ fontSize: Math.min(32, settings.fontSize + 1) })} aria-label="Larger">A+</button>
        </div>
      </div>
      <div class="field"><span>Font</span>
        <div class="fonts" role="radiogroup" aria-label="Reading font">
          {FONTS.map(f => (
            <button role="radio" aria-checked={settings.font === f.id} class={'font-card' + (settings.font === f.id ? ' on' : '')}
              style={{ fontFamily: f.family }} onClick={() => update({ font: f.id })}>
              <span class="font-sample">In the beginning was the Word</span>
              <span class="font-name">{f.label}<span class="muted"> · {f.note}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div class="field"><span>Search bar</span>
        <label><input type="checkbox" checked={settings.searchBar} onChange={e => update({ searchBar: (e.target as HTMLInputElement).checked })} /> Show the floating search bar at the bottom of the screen</label>
      </div>
      <div class="field"><span>Layout</span>{sel('layout', [['verses', 'One verse per line'], ['paragraph', 'Paragraph']])}</div>
      <div class="field"><span>Strong's numbers</span>
        <div class="col">
          <label><input type="checkbox" checked={settings.strongs} onChange={e => update({ strongs: (e.target as HTMLInputElement).checked })} /> Make tagged words tappable (KJV, BSB, Hebrew and Greek texts)</label>
          <label><input type="checkbox" checked={settings.strongsNumbers} onChange={e => update({ strongsNumbers: (e.target as HTMLInputElement).checked })} /> Show the numbers inline</label>
        </div>
      </div>
      <h2>Your data</h2>
      <DataTools />
      <h2>About</h2>
      <p>Plain Bible is just the Bible: {catalog.translations.length} versions, a fast search, and nothing else. No accounts, no plans, no tracking. Your highlights and settings are stored on your device.</p>
      <p class="muted small">Texts come from the <a href="https://github.com/scrollmapper/bible_databases" target="_blank" rel="noopener">Scrollmapper Bible databases</a> and
        the <a href="https://github.com/openscriptures/morphhb" target="_blank" rel="noopener">Open Scriptures Hebrew Bible</a> (CC BY 4.0).
        Strong's dictionary from <a href="https://github.com/openscriptures/strongs" target="_blank" rel="noopener">Open Scriptures</a> (CC BY-SA).
        Each version's license is listed on the Versions page.</p>
      <p><button onClick={() => { if (confirm('Reset all settings?')) { localStorage.clear(); location.reload() } }}>Reset settings</button></p>
    </div>
  )
}
