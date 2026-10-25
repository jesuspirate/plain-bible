import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Catalog, DataSource } from './lib/data'
import { Reader } from './reader'
import { Search } from './search'
import { AppContext, defaultSettings, FONTS, go, loadSettings, PRAY_EVENT, readPath, resumePath, Route, saveSettings, Settings, SETTINGS_EVENT, PrayAt, SHARE_EVENT, ShareRequest, inCircles, useApp, useRoute } from './state'
import { Versions } from './versions'
import { SearchBar } from './searchbar'
import { Saved } from './saved'
import { HistoryIcon, RefreshIcon } from './icons'
import { applyUpdate, useUpdate } from './lib/update'
import { loadTrail, onTrail, previous, Trail, visit, Visit } from './lib/history'
import { formatRef } from './lib/refs'
import { plain } from './lib/text'
import { loadMarks, Marks, saveMarks } from './lib/marks'
import { touchSettings, useSync } from './account'
import { closeSettingsPage, noteSettingsFrom, SettingsSheet, SettingsView } from './settings'
import { loadPlace, savePlace, withoutVerse } from './lib/place'
import { MoveBanner, MoveWelcome } from './move'
import { DAYS_EVENT } from './lib/streaks'
import { checkCircleNews } from './lib/circleNews'
import { readerVersions } from './lib/passage'
import { fromStandard } from './lib/versification'

// The status bar colour the page loaded with (set in index.html before first paint).
const LOAD_TINT = document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
const IOS_HOME_SCREEN = (navigator as { standalone?: boolean }).standalone === true

/** Match the phone's status bar (and the browser bar) to the theme. iPhone
 *  home-screen apps only read this colour when the page loads, and reloading
 *  on the tap made every theme change pause. So the theme switches at once,
 *  and the page reloads quietly the next time the app goes to the
 *  background (it comes back on the same verse, with the bar matching). */
function setTint(bg: string) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
  // Installing on Android takes the window colour from this theme's manifest
  // (vite.config.ts), so the keyboard doesn't slide in over a light window.
  const theme = ({ '#faf8f3': 'light', '#f4ecd8': 'sepia', '#16161a': 'dark' } as Record<string, string>)[bg]
  if (theme) document.querySelector('link[rel="manifest"]')?.setAttribute('href', `./manifest-${theme}.webmanifest`)
}
if (IOS_HOME_SCREEN) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (document.querySelector('meta[name="theme-color"]')?.getAttribute('content') === LOAD_TINT) return
    // The reader saves the verse on top as the page goes; drop any
    // jump-to verse so it comes back on that one.
    history.replaceState(history.state, '', withoutVerse(location.hash))
    location.reload()
  })
}

// Nothing saved yet: this is the app's very first start on this address.
const FIRST_START = (() => { try { return !localStorage.getItem('plain-bible:settings') } catch { return false } })()

const data = new DataSource(new URL('data/', document.baseURI).href)

export function App() {
  const [catalog, setCatalog] = useState<Catalog>()
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Settings>()
  const [marks, setMarksState] = useState<Marks>(loadMarks)
  const route = useRoute()
  const setMarks = (fn: (m: Marks) => Marks) => setMarksState(m => { const n = fn(m); saveMarks(n); return n })

  useEffect(() => {
    const start = (c: Catalog) => {
      const ids = new Set(c.translations.map(t => t.id))
      const s = { ...defaultSettings(c), ...loadSettings() }
      s.myVersions = s.myVersions.filter(id => ids.has(id))
      if (!ids.has(s.version)) s.version = c.translations[0].id
      setCatalog(c); setSettings(s)
    }
    // Open straight away with the list of versions kept from last time, and
    // swap in the fresh one when it arrives. Waiting for the network first
    // would hold the app on "Loading…" for seconds on a weak connection.
    const kept = data.keptCatalog()
    if (kept) start(kept)
    data.catalog().then(c => {
      if (!kept) start(c)
      else if (JSON.stringify(c) !== JSON.stringify(kept)) setCatalog(c)
    }).catch(e => { if (!kept) setError(String(e.message || e)) })
  }, [])

  useEffect(() => { if (settings) saveSettings(settings) }, [settings])

  // Before the paint, so a theme tap shows in the very next frame.
  useLayoutEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.dataset.hl = settings.highlight
    root.dataset.vn = settings.verseNumbers
    root.style.setProperty('--font-size', settings.fontSize + 'px')
    root.style.setProperty('--reading', FONTS.find(f => f.id === settings.font)!.family)
    const tint = () => setTint(getComputedStyle(root).getPropertyValue('--bg').trim())
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

  // The prayer overlay loads only when first opened, so it costs nothing at startup.
  const [Prayer, setPrayer] = useState<typeof import('./prayer').Prayer>()
  const [praying, setPraying] = useState(false)
  const [prayAt, setPrayAt] = useState<PrayAt>()
  useEffect(() => {
    const on = (e: Event) => { setPrayAt((e as CustomEvent<PrayAt | undefined>).detail); setPraying(true); import('./prayer').then(m => setPrayer(() => m.Prayer)).catch(() => setPraying(false)) }
    addEventListener(PRAY_EVENT, on)
    return () => removeEventListener(PRAY_EVENT, on)
  }, [])

  // Settings rise as a sheet from the button in the top right corner.
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    const on = () => setSettingsOpen(true)
    addEventListener(SETTINGS_EVENT, on)
    return () => removeEventListener(SETTINGS_EVENT, on)
  }, [])
  useEffect(() => { setSettingsOpen(false) }, [route.path.join('/')])

  // Circles load only when opened, or when something is shared with one.
  const [circles, setCircles] = useState<typeof import('./circles')>()
  const [sharing, setSharing] = useState<ShareRequest>()
  const loadCircles = () => import('./circles').then(m => setCircles(() => m)).catch(() => {})
  useEffect(() => {
    const on = (e: Event) => { setSharing((e as CustomEvent<ShareRequest>).detail); loadCircles() }
    addEventListener(SHARE_EVENT, on)
    return () => removeEventListener(SHARE_EVENT, on)
  }, [])
  useEffect(() => { if (page === 'circles' || page === 'join') loadCircles() }, [page])

  const byId = useMemo(() => new Map(catalog?.translations.map(t => [t.id, t]) ?? []), [catalog])
  // Remember whether Settings was opened over the reader, so closing it can
  // step back in history instead of piling up another reader page.
  const lastPage = useRef(page)
  if (lastPage.current !== page) { if (page === 'settings') noteSettingsFrom(lastPage.current); lastPage.current = page }
  const sync = useSync(marks, setMarksState, settings, setSettings, id => byId.has(id))

  // Circles you show your streaks to hear about each new day read or prayed
  // (and once a day). Nothing loads unless you've turned that on.
  const sharedWith = settings?.shareStreaks.join() ?? ''
  useEffect(() => {
    const ids = sharedWith ? sharedWith.split(',') : []
    if (!ids.length || !sync.account) return
    let t = 0
    const push = () => {
      clearTimeout(t)
      t = window.setTimeout(() => {
        if (navigator.onLine === false || document.visibilityState !== 'visible') return
        import('./lib/circles').then(m => m.pushStreaks(ids)).catch(() => {})
      }, 3000)
    }
    push()
    const back = () => { if (document.visibilityState === 'visible') push() }
    addEventListener(DAYS_EVENT, push)
    addEventListener('online', push)
    document.addEventListener('visibilitychange', back)
    return () => { clearTimeout(t); removeEventListener(DAYS_EVENT, push); removeEventListener('online', push); document.removeEventListener('visibilitychange', back) }
  }, [sharedWith, sync.account?.token])

  // Something new in your circles? One small request when the app opens or
  // comes back (at most once a minute), only for people in a circle.
  useEffect(() => {
    if (!sync.account || !inCircles()) return
    const t = window.setTimeout(() => checkCircleNews(), 2500)
    const back = () => { if (document.visibilityState === 'visible') checkCircleNews() }
    document.addEventListener('visibilitychange', back)
    addEventListener('online', back)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', back); removeEventListener('online', back) }
  }, [sync.account?.token])

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
        <a class="brand" href="#/read" title="Back to where you were reading">Quiet Bible</a>
        <nav>
          <HistoryButton route={route} />
          <UpdateButton />
          {/* #/settings opened as a page has its own Done, and so do the pages
              Settings opens (Circles, Saved): Done takes you back to the word. */}
          {view === 'settings' ? <button class="done-btn" onClick={closeSettingsPage}>Done</button>
            : view === 'circles' || view === 'join' || view === 'saved' ? <button class="done-btn" onClick={() => go('read')}>Done</button>
            : <ProfileButton onOpen={() => setSettingsOpen(true)} />}
        </nav>
      </header>
      <MoveBanner />
      <main class={view === 'search' ? '' : settings.searchBar ? 'with-bar' : 'with-mini'}>
        {view === 'search' ? <Search route={route} />
          : view === 'versions' ? <Versions />
          : view === 'saved' ? <Saved />
          : view === 'settings' ? <SettingsView />
          : view === 'circles' || view === 'join' ? circles ? <circles.CirclesPage route={route} /> : null
          : <ReaderRoute route={route} />}
      </main>
      {/* With the full bar hidden, a small round search button takes its place,
          and opens the same panel. */}
      {view !== 'search' && <SearchBar mini={!settings.searchBar} here={view === 'read' && route.path.length >= 4
        ? { version: route.path[1], book: route.path[2], chapter: +route.path[3] } : undefined} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {praying && Prayer && <Prayer at={prayAt} onClose={() => { setPraying(false); setPrayAt(undefined) }} />}
      {sharing && circles && <circles.ShareSheet request={sharing} onClose={() => setSharing(undefined)} />}
      <MoveWelcome firstStart={FIRST_START} />
    </AppContext.Provider>
  )
}

function ReaderRoute({ route }: { route: Route }) {
  const { settings, byId, data } = useApp()
  // A link someone sent opens in the Bible YOU read, not theirs; theirs
  // only if none of yours has that book. Swapped before the reader opens,
  // so their version never shows and never becomes yours. The link is in
  // standard numbering, turned into your Bible's (see versification).
  const shared = route.path.length >= 4 && route.params.has('shared')
  // "#/read" with no reference resumes the last place read.
  useEffect(() => {
    if (shared) {
      const book = route.path[2], chapter = +route.path[3] || 1, verse = +(route.params.get('v') || 0)
      const own = readerVersions(settings, id => byId.get(id)?.lang).find(id => byId.get(id)?.books.includes(book)) ?? route.path[1]
      data.bible(own).catch(() => undefined).then(b => {
        const at = fromStandard(b, { book, chapter, verses: [verse || 1] })
        go(readPath(own, at.book, at.chapter, verse ? at.verses[0] : undefined), true)
      })
    } else if (route.path.length < 4) {
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
  }, [route.path.join('/'), shared])
  return route.path.length >= 4 && !shared ? <Reader route={route} /> : null
}

// The one button in the top right corner: everything else lives behind it.
function ProfileButton({ onOpen }: { onOpen: () => void }) {
  const { sync } = useApp()
  const on = !!sync.account
  return (
    <button class={'profile-btn' + (on ? ' synced' : '')} onClick={onOpen}
      aria-label={on ? 'Settings and account. Sync is on' : 'Settings and account'} title="Settings">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <circle cx="12" cy="8.6" r="3.9" fill="currentColor" />
        <path d="M4.6 19.4c1.2-3.6 4-5.4 7.4-5.4s6.2 1.8 7.4 5.4" fill="currentColor" />
      </svg>
    </button>
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
    // A tap outside just closes the list; it doesn't also select the verse
    // or press the button underneath.
    const away = (e: Event) => {
      if (box.current?.contains(e.target as Node)) return
      setPeek(false)
      if (e.type !== 'pointerdown') return
      const stop = (c: Event) => { c.stopPropagation(); c.preventDefault() }
      addEventListener('click', stop, { capture: true, once: true })
      setTimeout(() => removeEventListener('click', stop, { capture: true }), 600)
    }
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

// Shows only when a new version of the app is in: one tap switches to it,
// back on the same verse.
function UpdateButton() {
  const state = useUpdate()
  const [busy, setBusy] = useState(false)
  if (state !== 'ready') return null
  return (
    <button class={'update-btn' + (busy ? ' busy' : '')} aria-label="New version ready. Tap to update" title="New version ready: tap to update"
      onClick={() => { setBusy(true); applyUpdate() }}>
      <RefreshIcon size={24} />
    </button>
  )
}
