import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Catalog, DataSource } from './lib/data'
import { Reader } from './reader'
import { Search } from './search'
import { AppContext, defaultSettings, FONTS, go, loadSettings, readPath, resumePath, Route, saveSettings, Settings, useApp, useRoute } from './state'
import { Versions } from './versions'
import { SearchBar } from './searchbar'
import { Saved } from './saved'
import { DataTools } from './import'
import { VersionPicker } from './ui'
import { HistoryIcon } from './icons'
import { loadTrail, onTrail, previous, Trail, visit, Visit } from './lib/history'
import { formatRef } from './lib/refs'
import { plain } from './lib/text'
import { hasContent, loadMarks, Marks, saveMarks } from './lib/marks'
import { AccountSection, touchSettings, useSync } from './account'
import { loadPlace, savePlace, withoutVerse } from './lib/place'

// The status bar colour the page loaded with (set in index.html before first paint).
const LOAD_TINT = document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
const IOS_HOME_SCREEN = (navigator as { standalone?: boolean }).standalone === true
/** At most one reload every few seconds, so a broken setup can't loop. */
function reloadOk() {
  try {
    const last = Number(sessionStorage.getItem('plain-bible:tint-reload') || 0)
    if (Date.now() - last < 5000) return false
    sessionStorage.setItem('plain-bible:tint-reload', String(Date.now()))
    return true
  } catch { return false }
}

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
    root.dataset.hl = settings.highlight
    root.dataset.vn = settings.verseNumbers
    root.style.setProperty('--font-size', settings.fontSize + 'px')
    root.style.setProperty('--reading', FONTS.find(f => f.id === settings.font)!.family)
    // Match the phone's status bar (and the browser bar) to the chosen theme.
    // iPhone home-screen apps only read this colour when the page loads, so
    // there a theme change reloads the page (it comes back on the same verse).
    const tint = () => {
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
      if (IOS_HOME_SCREEN && bg !== LOAD_TINT && reloadOk()) {
        // The reader saves the verse on top as the page goes; drop any
        // jump-to verse so it comes back on that one.
        history.replaceState(history.state, '', withoutVerse(location.hash))
        return location.reload()
      }
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
    }
    tint()
    const dark = matchMedia('(prefers-color-scheme: dark)')
    dark.addEventListener('change', tint)
    return () => dark.removeEventListener('change', tint)
  }, [settings])

  // Keep the Default Bible (or, before one is chosen, the current version)
  // saved for offline use, and ask the browser not to clear saved Bibles.
  // With Strong's numbers on, the Hebrew and Greek lexicons are kept too.
  const offlineId = settings && (settings.favorite || settings.version)
  const strongs = !!settings?.strongs
  useEffect(() => {
    if (!offlineId) return
    // The iOS app ships everything else inside the app, and keeps every version
    // it has opened, so loading it is enough.
    if (data.native) { data.bible(offlineId).catch(() => {}); return }
    if (!('caches' in window)) return
    navigator.storage?.persist?.().catch(() => {})
    const paths = [`bibles/${offlineId}.json`, ...(strongs ? ['strongs-hebrew.json', 'strongs-greek.json'] : [])]
    caches.open('bible-data').then(c => Promise.all(paths.map(async p => {
      const url = data.url(p)
      if (!(await c.match(url))) await c.add(url)
    }))).catch(() => {})
  }, [offlineId, strongs])

  // The reader manages its own scroll position; other pages start at the top.
  const page = route.path[0] || 'read'
  useEffect(() => { if (page !== 'read') window.scrollTo(0, 0) }, [page])

  const byId = useMemo(() => new Map(catalog?.translations.map(t => [t.id, t]) ?? []), [catalog])
  const sync = useSync(marks, setMarksState, settings, setSettings, id => byId.has(id))

  if (error) return (
    <div class="center">
      <p class="error">Could not load the list of versions: {error}</p>
      <p><button onClick={() => location.reload()}>Try again</button></p>
    </div>
  )
  if (!catalog || !settings) return <p class="muted center">Loading…</p>

  const update = (patch: Partial<Settings>) => {
    setSettings(s => {
      const next = { ...s!, ...patch }
      touchSettings(Object.keys(patch).filter(k => JSON.stringify((next as any)[k]) !== JSON.stringify((s as any)[k])))
      return next
    })
  }
  const view = route.path[0] || 'read'

  return (
    <AppContext.Provider value={{ data, catalog, byId, settings, update, marks, setMarks, sync }}>
      <header class="top">
        <a class="brand" href="#/read" title="Back to where you were reading">Plain Bible</a>
        <nav>
          <HistoryButton route={route} />
          <VersionMenu route={route} />
          {/* Settings live in the search panel; without the search bar they come back here. */}
          {!settings.searchBar && <a class={view === 'settings' ? 'on' : ''} href="#/settings" aria-label="Settings" title="Settings">
            <svg class="gear" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" /></svg>
          </a>}
        </nav>
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
      const last = loadPlace()
      go(readPath(route.path[1] || settings.favorite || settings.version, last?.book ?? 'Gen', last?.chapter ?? 1), true)
    } else {
      // A new chapter starts at its top (or the verse you jumped to); the
      // reader keeps the verse up to date as you scroll.
      const last = loadPlace(), book = route.path[2], chapter = +route.path[3]
      const verse = +(route.params.get('v') || route.params.get('at') || 0) || 1
      if (last?.book !== book || last.chapter !== chapter) savePlace({ book, chapter, verse })
      visit({ book, chapter, verse })
    }
  }, [route.path.join('/')])
  return route.path.length >= 4 ? <Reader route={route} /> : null
}

// The version button in the top bar: switch version, compare side by side,
// Strong's numbers, and a way to the full Versions page.
function VersionMenu({ route }: { route: Route }) {
  const { settings, update, byId } = useApp()
  const [open, setOpen] = useState<'' | 'version' | 'compare'>('')
  const reading = route.path[0] === 'read' && route.path.length >= 4
  const version = reading && byId.has(route.path[1]) ? route.path[1] : settings.version
  const parallel = ((reading && route.params.get('p')?.split(',')) || settings.parallel).filter(id => byId.has(id) && id !== version)
  const goTo = (v: string, p: string[]) => {
    const others = p.filter(id => id !== v)
    if (reading) go(readPath(v, route.path[2], +route.path[3], +(route.params.get('v') || 0) || undefined, others))
    else { update({ version: v, parallel: others }); go('read/' + v) }
  }
  const tagged = [version, ...parallel].some(v => byId.get(v)?.strongs)
  return (
    <>
      <button class={'version-btn' + (route.path[0] === 'versions' ? ' on' : '')} onClick={() => setOpen('version')}
        aria-label={`Version: ${byId.get(version)?.name ?? version}. Change version`}>
        {version}{parallel.length > 0 && <span class="muted"> +{parallel.length}</span>} <span aria-hidden="true">▾</span>
      </button>
      {open === 'version' && (
        <VersionPicker title="Version" selected={[version]} onClose={() => setOpen('')} onChange={([id]) => goTo(id, parallel)}
          extra={<VersionOptions version={version} parallel={parallel} tagged={tagged} onCompare={() => setOpen('compare')} onClose={() => setOpen('')} />} />
      )}
      {open === 'compare' && (
        <VersionPicker title="Compare with" multi max={5} selected={parallel} onClose={() => setOpen('')}
          onChange={ids => { update({ parallel: ids }); goTo(version, ids) }} />
      )}
    </>
  )
}

// Compare, Strong's, default and downloads: folded away under the list.
function VersionOptions({ version, parallel, tagged, onCompare, onClose }: { version: string; parallel: string[]; tagged: boolean; onCompare: () => void; onClose: () => void }) {
  const { settings, update } = useApp()
  const [open, setOpen] = useState(parallel.length > 0)
  if (!open) return <button class="more-toggle" onClick={() => setOpen(true)}>More options <span aria-hidden="true">▾</span></button>
  return (
    <div class="vm-extra">
      <button class="vm-row" onClick={onCompare}>
        <strong>Compare side by side</strong><span class="muted">{parallel.length ? parallel.join(', ') : 'Off'} ›</span>
      </button>
      {tagged && (
        <label class="vm-row">
          <strong>Strong's numbers</strong>
          <input type="checkbox" checked={settings.strongs} onChange={e => update({ strongs: (e.target as HTMLInputElement).checked })} />
        </label>
      )}
      <button class="vm-row" onClick={() => update({ favorite: version })} disabled={settings.favorite === version}>
        <strong>{settings.favorite === version ? `★ ${version} opens every time` : `☆ Open ${version} every time`}</strong>
      </button>
      <a class="vm-row" href="#/versions" onClick={onClose}><strong>Download and manage versions</strong><span class="muted">›</span></a>
    </div>
  )
}

/** The reading history as it changes. */
function useTrail() {
  const [trail, setTrail] = useState<Trail>(loadTrail)
  useEffect(() => onTrail(setTrail), [])
  return trail
}

const placeName = (p: Visit) => formatRef({ book: p.book, chapter: p.chapter, verse: p.verse > 1 ? p.verse : undefined })

// The history button. One tap takes you back to the previous chapter and
// verse; going back is a jump like any other, so a second tap brings you
// back again: handy for following a preacher between passages. Press and
// hold (or right-click) to see your last 3 places.
function HistoryButton({ route }: { route: Route }) {
  const { settings, byId, data } = useApp()
  const trail = useTrail()
  const [peek, setPeek] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  const hold = useRef<{ timer: number; fired: boolean }>()
  const down = () => { hold.current = { fired: false, timer: window.setTimeout(() => { hold.current!.fired = true; setPeek(true) }, 450) } }
  const up = () => clearTimeout(hold.current?.timer)
  const reading = route.path[0] === 'read' && route.path.length >= 4
  // Away from the reader (Settings, Saved) the first place is the one you're reading.
  const places = reading ? previous(trail) : trail.items.slice().reverse()
  const version = reading && byId.has(route.path[1]) ? route.path[1] : settings.favorite || settings.version
  const parallel = (reading && route.params.get('p')?.split(',')) || []
  const goTo = (p: Visit) => { setPeek(false); go(resumePath(version, p.book, p.chapter, p.verse, parallel)) }

  useEffect(() => { setPeek(false) }, [route.path.join('/')])
  useEffect(() => {
    if (!peek) return
    // A line of each place's verse, from the Bible already on the device.
    data.bible(version).then(b => setLines(places.map(p => {
      const raw = b.books[p.book]?.[p.chapter - 1]?.[p.verse - 1]
      return raw ? plain(raw) : ''
    }))).catch(() => {})
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setPeek(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPeek(false) }
    const t = setTimeout(() => setPeek(false), 8000)
    addEventListener('pointerdown', away); addEventListener('keydown', esc); addEventListener('scroll', away as never, { passive: true })
    return () => { clearTimeout(t); removeEventListener('pointerdown', away); removeEventListener('keydown', esc); removeEventListener('scroll', away as never) }
  }, [peek])

  const first = places[0]
  return (
    <div class="history" ref={box}>
      <button class={'history-btn' + (peek ? ' on' : '') + (first ? '' : ' idle')} aria-expanded={peek}
        aria-label={first ? `Back to ${placeName(first)}. Hold for recent places` : 'Reading history'} title={first ? `Back to ${placeName(first)} · hold for more` : undefined}
        onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
        onContextMenu={e => { e.preventDefault(); up(); setPeek(true) }}
        onClick={() => { if (hold.current?.fired) return; if (first) goTo(first); else setPeek(p => !p) }}>
        <HistoryIcon size={26} />
      </button>
      {peek && (
        <div class="peek" role="dialog" aria-label="Go back">
          {!first ? <p class="peek-empty">When you jump to another passage, the place you left shows here so you can come back with one tap.</p> : <>
            <button class="peek-main" onClick={() => goTo(first)}>
              <span class="peek-kicker">Back to</span>
              <strong>{placeName(first)}</strong>
              {lines[0] && <span class="peek-line">{lines[0]}</span>}
            </button>
            {places.slice(1, 3).map((p, i) => (
              <button class="peek-row" onClick={() => goTo(p)}>
                <strong>{placeName(p)}</strong>{lines[i + 1] && <span class="peek-line one">{lines[i + 1]}</span>}
              </button>
            ))}
          </>}
        </div>
      )}
    </div>
  )
}

function SettingsView() {
  const { settings, update, catalog, marks, sync, byId } = useApp()
  useEffect(() => { document.title = 'Settings · Plain Bible' }, [])
  const saved = Object.values(marks).filter(hasContent).length
  const [pickFav, setPickFav] = useState(false)
  // Three things most people want; the rest waits behind "More settings".
  const [more, setMore] = useState(false)
  const fav = settings.favorite || settings.version
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
      <div class="essentials">
        <div class="ess"><span class="ess-label">Text size</span>
          <div class="size-row">
            <button class="size-btn" onClick={() => update({ fontSize: Math.max(13, settings.fontSize - 1) })} aria-label="Smaller text">A−</button>
            <span class="size-sample" aria-label={`${settings.fontSize} pixels`}>In the beginning</span>
            <button class="size-btn big" onClick={() => update({ fontSize: Math.min(36, settings.fontSize + 1) })} aria-label="Larger text">A+</button>
          </div>
        </div>
        <div class="ess"><span class="ess-label">Theme</span>{sel('theme', [['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark'], ['system', 'Auto']])}</div>
        <div class="ess"><span class="ess-label">Bible</span>
          <button class="pick big-pick" onClick={() => setPickFav(true)}><strong>{fav}</strong> <span class="muted">{byId.get(fav)?.name}</span> <span aria-hidden="true">▾</span></button>
          <span class="muted small">Opens every time, and works offline.</span>
          {pickFav && <VersionPicker title="Your Bible" selected={[fav]} onClose={() => setPickFav(false)} onChange={([id]) => update({ favorite: id, version: id })} />}
        </div>
      </div>
      <button class="more-toggle" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? 'Fewer settings' : 'More settings'} <span aria-hidden="true">{more ? '▴' : '▾'}</span></button>
      {more && <>
      <div class="field"><span>Saved</span><a href="#/saved">{saved ? `${saved} highlights, bookmarks and notes` : 'Your highlights, bookmarks and notes'} ›</a></div>
      <div class="field"><span>Advanced search</span><a href="#/search">Search many versions at once, with filters ›</a></div>
      {sync.enabled && <section class="account-box"><h2>Account and sync</h2><AccountSection /></section>}
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
      <div class="field"><span>Highlights</span>
        <div class="col">
          <span class="muted small">Tap a verse twice quickly to highlight it in the last color you used.</span>
          {sel('highlight', [['marker', 'Marker'], ['text', 'Colored text'], ['block', 'Block']])}
          <p class="hl-preview" aria-hidden="true">
            <span class="pv hl" style={{ '--hl': '#fff193' }}><span class="vt">In the beginning was the Word, and the Word was with God,</span></span>{' '}
            <span class="pv hl" style={{ '--hl': '#b3e487' }}><span class="vt">and the Word was God.</span></span>
          </p>
        </div>
      </div>
      <div class="field"><span>Verse numbers</span>{sel('verseNumbers', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}</div>
      <div class="field"><span>Chapter turn</span>
        <div class="col">
          {sel('turn', [['fold', 'Fold'], ['slide', 'Slide'], ['off', 'None']])}
          <span class="muted small">How the page moves when you swipe to the next or previous chapter.</span>
        </div>
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
      <p>Plain Bible is just the Bible: {catalog.translations.length} versions, a fast search, and nothing else. No plans, no tracking, and an account is optional. Your highlights and settings are stored on your device{sync.account ? ' and synced with your passkey account' : ''}.</p>
      <p class="muted small">Texts come from the <a href="https://github.com/scrollmapper/bible_databases" target="_blank" rel="noopener">Scrollmapper Bible databases</a> and
        the <a href="https://github.com/openscriptures/morphhb" target="_blank" rel="noopener">Open Scriptures Hebrew Bible</a> (CC BY 4.0).
        Strong's dictionary from <a href="https://github.com/openscriptures/strongs" target="_blank" rel="noopener">Open Scriptures</a> (CC BY-SA).
        Each version's license is listed on the Versions page.</p>
      <p><button onClick={() => { if (confirm('Reset all settings?')) { localStorage.clear(); location.reload() } }}>Reset settings</button></p>
      </>}
    </div>
  )
}
