import { useEffect, useMemo, useState } from 'preact/hooks'
import { Catalog, DataSource } from './lib/data'
import { Reader } from './reader'
import { Search } from './search'
import { AppContext, defaultSettings, go, loadSettings, readPath, Route, saveSettings, Settings, useApp, useRoute } from './state'
import { Versions } from './versions'

const data = new DataSource(new URL('data/', document.baseURI).href)

export function App() {
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Settings>()
  const route = useRoute()

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
    root.dataset.font = settings.font
  }, [settings])

  const byId = useMemo(() => new Map(catalog?.translations.map(t => [t.id, t]) ?? []), [catalog])

  if (error) return <p class="error center">Could not load the library: {error}</p>
  if (!catalog || !settings) return <p class="muted center">Loading…</p>

  const update = (patch: Partial<Settings>) => setSettings(s => ({ ...s!, ...patch }))
  const view = route.path[0] || 'read'

  return (
    <AppContext.Provider value={{ data, catalog, byId, settings, update }}>
      <header class="top">
        <a class="brand" href={'#/' + readPath(settings.version, 'John', 1)}>Plain Bible</a>
        <nav>
          <a class={view === 'read' ? 'on' : ''} href="#/read">Read</a>
          <a class={view === 'search' ? 'on' : ''} href="#/search">Search</a>
          <a class={view === 'versions' ? 'on' : ''} href="#/versions">Versions</a>
          <a class={view === 'settings' ? 'on' : ''} href="#/settings" aria-label="Settings">Settings</a>
        </nav>
      </header>
      <main>
        {view === 'search' ? <Search route={route} />
          : view === 'versions' ? <Versions />
          : view === 'settings' ? <SettingsView />
          : <ReaderRoute route={route} />}
      </main>
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
      <div class="field"><span>Font</span>{sel('font', [['serif', 'Serif'], ['sans', 'Sans-serif']])}</div>
      <div class="field"><span>Layout</span>{sel('layout', [['verses', 'One verse per line'], ['paragraph', 'Paragraph']])}</div>
      <div class="field"><span>Strong's numbers</span>
        <div class="col">
          <label><input type="checkbox" checked={settings.strongs} onChange={e => update({ strongs: (e.target as HTMLInputElement).checked })} /> Make tagged words tappable (KJV, BSB, Hebrew and Greek texts)</label>
          <label><input type="checkbox" checked={settings.strongsNumbers} onChange={e => update({ strongsNumbers: (e.target as HTMLInputElement).checked })} /> Show the numbers inline</label>
        </div>
      </div>
      <h2>About</h2>
      <p>Plain Bible is just the Bible: {catalog.translations.length} versions, a fast search, and nothing else. No accounts, no plans, no tracking. Everything is stored on your device.</p>
      <p class="muted small">Texts come from the <a href="https://github.com/scrollmapper/bible_databases" target="_blank" rel="noopener">Scrollmapper Bible databases</a> and
        the <a href="https://github.com/openscriptures/morphhb" target="_blank" rel="noopener">Open Scriptures Hebrew Bible</a> (CC BY 4.0).
        Strong's dictionary from <a href="https://github.com/openscriptures/strongs" target="_blank" rel="noopener">Open Scriptures</a> (CC BY-SA).
        Each version's license is listed on the Versions page.</p>
      <p><button onClick={() => { if (confirm('Reset all settings?')) { localStorage.clear(); location.reload() } }}>Reset settings</button></p>
    </div>
  )
}
