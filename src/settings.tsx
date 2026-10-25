// Settings. Everything lives here, behind the one button in the top right
// corner: sync, the Bible you read, reading, your data. (Prayer and Circles
// live behind the 🙏 button.) They rise as
// a sheet; pulling it down (or Done) goes back to the word. #/settings still
// opens them as a page, for old links.
import { useEffect, useRef, useState } from 'preact/hooks'
import { defaultSettings, FONTS, go, readPath, Settings, useApp, useRoute } from './state'
import { DataTools } from './import'
import { VersionPicker } from './ui'
import { BackIcon, BookmarkIcon, RefreshIcon } from './icons'
import type { ComponentChildren } from 'preact'
import { copyText } from './lib/native'
import { checkForUpdate, useUpdate } from './lib/update'
import { hasContent } from './lib/marks'
import { AccountSection } from './account'
import { MoveInSection } from './move'
import { Saved } from './saved'
import { Search } from './search'
import { Versions } from './versions'
import { StreakRow } from './streaks'

// The version, quietly at the very bottom of Settings. Tap it to copy it
// (handy for reporting a problem). The line under it is the whole update:
// it looks for a new version and switches to it if there is one, or says
// you're up to date.
function VersionLine() {
  const state = useUpdate()
  const [copied, setCopied] = useState(false)
  const version = `Quiet Bible ${__BUILD__}`
  const copy = async () => {
    try { await copyText(version); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* nothing to do */ }
  }
  const note = { idle: 'Tap to check for updates', checking: 'Checking…', ready: 'New version: tap to update', current: 'Up to date', offline: 'Offline, try later' }[state]
  return (
    <div class={'version-line' + (state === 'ready' ? ' ready' : '')}>
      <button class="version-copy" onClick={copy} aria-label={`Version ${__BUILD__}. Tap to copy`}>{copied ? 'Copied ✓' : `Version ${__BUILD__}`}</button>
      <button class="version-note" disabled={state === 'checking'} onClick={() => checkForUpdate()}>
        <RefreshIcon size={14} class={state === 'checking' ? 'spin' : undefined} /> {note}
      </button>
    </div>
  )
}

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Slide `box` away downwards, then run `done`. */
export function slideAway(box: HTMLElement | null, done: () => void) {
  if (!box || still()) { done(); return }
  box.style.transition = 'transform .2s ease-in'
  box.style.transform = 'translate3d(0, 100%, 0)'
  setTimeout(done, 190)
}

// Pull down from the top to close, like the search panel. Only a pull that
// starts with `scroller` at its very top, heads clearly downwards (not
// sideways) and goes far enough, or is flicked, closes; anything else is a
// normal scroll. The non-passive touchmove listener is added only for such a
// pull, so scrolling never waits on it. Only transforms move, nothing blurs.
export function usePullDown(box: { current: HTMLElement | null }, scrollTop: () => number, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!box.current) return
    const el: HTMLElement = box.current
    let start: { x: number; y: number } | undefined
    let pulling = false, dy = 0, last = { y: 0, t: 0 }, v = 0
    const back = () => { el.style.transition = 'transform .25s cubic-bezier(.2, .8, .2, 1)'; el.style.transform = '' }
    const stop = () => {
      start = undefined
      removeEventListener('touchmove', move)
      removeEventListener('touchend', end)
      removeEventListener('touchcancel', cancel)
    }
    function move(e: TouchEvent) {
      if (!start || e.touches.length > 1) { cancel(); return }
      const t = e.touches[0], dx = t.clientX - start.x
      dy = t.clientY - start.y
      if (!pulling) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        if (dy <= 0 || Math.abs(dx) * 1.5 > dy || scrollTop() > 0) { stop(); return }
        pulling = true
        el.style.transition = 'none'
      }
      // Keep Safari from bouncing or scrolling while the sheet follows the finger.
      e.preventDefault()
      if (e.timeStamp > last.t) v = (t.clientY - last.y) / (e.timeStamp - last.t)
      last = { y: t.clientY, t: e.timeStamp }
      el.style.transform = `translate3d(0, ${Math.max(0, dy) * .7}px, 0)`
    }
    function end() {
      const was = pulling
      stop(); pulling = false
      if (!was) return
      if (dy > 120 || (dy > 50 && v > .5)) slideAway(el, close.current)
      else back()
    }
    function cancel() { const was = pulling; stop(); pulling = false; if (was) back() }
    const down = (e: TouchEvent) => {
      stop()
      // One finger, from the very top, and not inside a picker that's open on top.
      if (e.touches.length !== 1 || scrollTop() > 0 || document.querySelector('dialog[open]')) return
      if ((e.target as Element).closest?.('input, textarea, select, [contenteditable]')) return
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY }
      last = { y: t.clientY, t: e.timeStamp }; v = 0; dy = 0
      addEventListener('touchmove', move, { passive: false })
      addEventListener('touchend', end)
      addEventListener('touchcancel', cancel)
    }
    el.addEventListener('touchstart', down, { passive: true })
    return () => { el.removeEventListener('touchstart', down); stop() }
  }, [])
}

// The parts of Settings. The first page has what most people reach for; each
// row below opens a page of its own, inside the sheet, with a way back.
// Nothing opened from Settings is a page on its own: only opening a verse
// leaves it.
type Page = 'home' | 'sync' | 'reading' | 'saved' | 'search' | 'versions' | 'data' | 'about'
const PAGE_TITLE: Record<Page, string> = {
  home: 'Settings', sync: 'Account', reading: 'Reading', saved: 'Saved', search: 'Advanced search',
  versions: 'Versions', data: 'Your data', about: 'About',
}

/** Where you are in Settings: the first page, or one page in. */
function useSettingsNav() {
  const [page, setPage] = useState<Page>('home')
  const back = () => setPage('home')
  return { page, setPage, back, title: PAGE_TITLE[page], depth: page === 'home' ? 0 : 1 }
}
type SettingsNav = ReturnType<typeof useSettingsNav>

// On a wide screen Settings is a panel at the right, with the text still in view.
const wide = () => matchMedia('(min-width: 900px)').matches
/** Put Settings away: down on a phone, off to the right on a wide screen. */
function putAway(box: HTMLElement | null, done: () => void) {
  if (!box || !wide() || still()) { slideAway(box, done); return }
  box.style.transition = 'transform .2s ease-in'
  box.style.transform = 'translate3d(100%, 0, 0)'
  setTimeout(done, 190)
}

/** Settings as a sheet that rises over the page (a panel from the right on a
 *  wide screen), from the button in the top right corner. The word stays in
 *  view behind it: a tap there, a pull down, or Done puts it away. Inside
 *  pages have only ‹ back. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const nav = useSettingsNav()
  const navRef = useRef(nav)
  navRef.current = nav
  usePullDown(box, () => box.current?.scrollTop ?? 0, onClose)
  const done = () => putAway(box.current, onClose)
  useEffect(() => { box.current?.scrollTo(0, 0) }, [nav.page])
  useEffect(() => {
    // Escape steps back a page, then closes.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return
      e.stopPropagation()
      if (navRef.current.depth) navRef.current.back()
      else putAway(box.current, onClose)
    }
    addEventListener('keydown', esc, true)
    box.current?.focus({ preventScroll: true })
    return () => removeEventListener('keydown', esc, true)
  }, [])
  return (
    <>
    <div class="settings-scrim" onClick={done} aria-hidden="true" />
    <div class="settings-sheet" ref={box} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}
      // A link inside (a verse, mostly) leaves Settings behind.
      onClick={e => { if ((e.target as Element).closest?.('a[href^="#"], .pray-open')) onClose() }}>
      <div class="settings-head">
        <button type="button" class="settings-grabber" aria-label="Close settings" onClick={done} />
        <div class="settings-title">
          {nav.page === 'home'
            ? <><h1>Settings</h1><button class="done-btn" onClick={done}>Done</button></>
            : <button class="settings-back" onClick={nav.back}><BackIcon class="back-ico" /> {nav.title}</button>}
        </div>
      </div>
      <div class="settings"><SettingsBody nav={nav} /></div>
    </div>
    </>
  )
}

// #/settings as a page of its own: Done (or a pull down) goes back to the word.
let overReader = false
export function noteSettingsFrom(page: string) { overReader = page === 'read' }
export function closeSettingsPage() {
  if (overReader) { overReader = false; history.back() }
  else go('read')
}

export function SettingsView() {
  useEffect(() => { document.title = 'Settings · Quiet Bible' }, [])
  const box = useRef<HTMLDivElement>(null)
  const nav = useSettingsNav()
  usePullDown(box, () => window.scrollY, closeSettingsPage)
  useEffect(() => { window.scrollTo(0, 0) }, [nav.page])
  return (
    <div class="settings" ref={box}>
      <button type="button" class="settings-grabber" aria-label="Close settings" onClick={closeSettingsPage} />
      {nav.page === 'home'
        ? <h1>Settings</h1>
        : <h1><button class="settings-back" onClick={nav.back}><BackIcon class="back-ico" /> {nav.title}</button></h1>}
      <SettingsBody nav={nav} />
    </div>
  )
}

const PersonIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="8.6" r="3.9" fill="currentColor" /><path d="M4.6 19.4c1.2-3.6 4-5.4 7.4-5.4s6.2 1.8 7.4 5.4" fill="currentColor" /></svg>
)

/** Under Account: what it's for, when sync last ran, or what went wrong. */
function syncNote(sync: ReturnType<typeof useApp>['sync']) {
  if (!sync.account) return 'Sync your highlights and prayers'
  if (sync.busy) return 'Syncing…'
  if (sync.error) return 'Couldn’t sync. Tap to see why'
  const at = sync.account.lastSync
  if (!at) return undefined
  const d = new Date(at)
  return 'Last synced ' + (d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
}

/** One row of a settings list: a name, what it's set to, and › to go on. */
function Row({ label, sub, value, onClick, href, icon }: { label: string; sub?: string; value?: string; onClick?: () => void; href?: string; icon?: ComponentChildren }) {
  const inner = <>
    {icon && <span class="set-icon" aria-hidden="true">{icon}</span>}
    {sub
      ? <span class="set-label">{label}<span class="set-sub">{sub}</span></span>
      : <span class="set-label">{label}</span>}
    {value && <span class="set-value">{value}</span>}
    <span class="set-chev" aria-hidden="true">›</span>
  </>
  return href ? <a class="set-row" href={href}>{inner}</a> : <button class="set-row" onClick={onClick}>{inner}</button>
}

// The Bible you're reading and the ones beside it. (This used to be the
// version button in the top bar.)
function BibleGroup({ setPage }: { setPage: (p: Page) => void }) {
  const { settings, update, byId } = useApp()
  const route = useRoute()
  const [open, setOpen] = useState<'' | 'version' | 'compare'>('')
  const reading = route.path[0] === 'read' && route.path.length >= 4
  const version = reading && byId.has(route.path[1]) ? route.path[1] : settings.version
  const parallel = ((reading && route.params.get('p')?.split(',')) || settings.parallel).filter(id => byId.has(id) && id !== version)
  const goTo = (v: string, p: string[]) => {
    const others = p.filter(id => id !== v)
    if (reading) go(readPath(v, route.path[2], +route.path[3], +(route.params.get('v') || 0) || undefined, others))
    else go('read/' + v)
  }
  // Picking a version here makes it your Bible (the reader never does that
  // by itself), and the one the app opens in.
  const choose = (v: string) => {
    update({ version: v, parallel: parallel.filter(id => id !== v) })
    goTo(v, parallel)
  }
  return (
    <section class="set-group">
      <h2 class="set-kicker">Bible</h2>
      <div class="set-list">
        <button class="set-row set-version" onClick={() => setOpen('version')}>
          <span class="set-vid">{version}</span>
          <span class="set-label">{byId.get(version)?.name ?? version}</span>
          <span class="set-chev" aria-hidden="true">›</span>
        </button>
        {version !== settings.version && byId.has(settings.version) &&
          <Row label={`Back to ${settings.version}`} sub="Your Bible" onClick={() => goTo(settings.version, parallel)} />}
        <Row label="Compare side by side" value={parallel.length ? parallel.join(', ') : 'Off'} onClick={() => setOpen('compare')} />
        <Row label="Manage versions" onClick={() => setPage('versions')} />
      </div>
      {open === 'version' && <VersionPicker title="Version" selected={[version]} onClose={() => setOpen('')} onChange={([id]) => choose(id)} />}
      {open === 'compare' && (
        <VersionPicker title="Compare with" multi max={5} selected={parallel} onClose={() => setOpen('')}
          onChange={ids => { update({ parallel: ids }); goTo(version, ids) }} />
      )}
    </section>
  )
}

function SettingsBody({ nav }: { nav: SettingsNav }) {
  const { page, setPage } = nav
  const { settings, update, catalog, marks, sync } = useApp()
  // Advanced search keeps its query here while you're in Settings.
  const [searchQuery, setSearchQuery] = useState('')
  const saved = Object.values(marks).filter(hasContent).length
  const sel = <K extends keyof Settings>(k: K, opts: [Settings[K], string][]) => (
    <div class="seg" role="radiogroup">
      {opts.map(([v, label]) => (
        <button role="radio" aria-checked={settings[k] === v} class={settings[k] === v ? 'on' : ''} onClick={() => update({ [k]: v } as Partial<Settings>)}>{label}</button>
      ))}
    </div>
  )
  const fontName = FONTS.find(f => f.id === settings.font)?.label

  if (page === 'reading') return <>
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
    <div class="field"><span>Layout</span>{sel('layout', [['verses', 'One verse per line'], ['paragraph', 'Paragraph']])}</div>
    <div class="field"><span>Verse numbers</span>{sel('verseNumbers', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])}</div>
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
    <div class="field"><span>Chapter turn</span>
      <div class="col">
        {sel('turn', [['stack', 'Stack'], ['slide', 'Side by side'], ['off', 'None']])}
        <span class="muted small">{settings.turn === 'slide' ? 'Both chapters slide across together.' : settings.turn === 'off' ? 'The chapter changes with no movement.' : 'Your page slides away over the next chapter, like a stack of pages.'}</span>
      </div>
    </div>
    <div class="field"><span>Notes</span>
      <label><input type="checkbox" checked={settings.noteReminders} onChange={e => update({ noteReminders: (e.target as HTMLInputElement).checked })} /> Under each chapter title, show how many notes you have on it, including notes elsewhere that mention it (like “see John 3:16”) or share a #tag with one here.</label>
    </div>
    <div class="field"><span>Streaks</span>
      <label><input type="checkbox" checked={settings.streaks} onChange={e => update({ streaks: (e.target as HTMLInputElement).checked })} /> At the top of Settings, show how many days in a row you’ve read the word and prayed. Nothing ever reminds you.</label>
    </div>
    <div class="field"><span>Strong's numbers</span>
      <div class="col">
        <label><input type="checkbox" checked={settings.strongs} onChange={e => update({ strongs: (e.target as HTMLInputElement).checked })} /> Make tagged words tappable (KJV, BSB, Hebrew and Greek texts)</label>
        <label><input type="checkbox" checked={settings.strongsNumbers} onChange={e => update({ strongsNumbers: (e.target as HTMLInputElement).checked })} /> Show the numbers inline</label>
      </div>
    </div>
    <div class="field"><span>Search bar</span>
      <label><input type="checkbox" checked={settings.searchBar} onChange={e => update({ searchBar: (e.target as HTMLInputElement).checked })} /> Show the full search bar at the bottom of the screen. When off, a small round search button sits in the corner instead.</label>
    </div>
  </>

  if (page === 'saved') return <Saved onImport={() => setPage('data')} />
  if (page === 'search') return <Search route={{ path: ['search'], params: new URLSearchParams(searchQuery) }} onGo={p => setSearchQuery(p.split('?')[1] ?? '')} />
  if (page === 'versions') return <Versions inSheet />
  if (page === 'sync') return <AccountSection />

  if (page === 'data') return <>
    <MoveInSection />
    <DataTools />
    <h2>Settings</h2>
    <p><button onClick={() => {
      // Only the settings: highlights, notes, history and the account stay.
      if (confirm('Reset font, theme, layout and version choices to their defaults?\n\nYour highlights, bookmarks and notes are kept, and you stay signed in.'
        + (sync.account ? ' Your other synced devices will get the default settings too.' : ''))) {
        update(defaultSettings(catalog))
      }
    }}>Reset settings</button></p>
  </>

  if (page === 'about') return <>
    <p>Quiet Bible is just the Bible: {catalog.translations.length} versions, a fast search, and nothing else. No plans, no tracking, and an account is optional. Your highlights and settings are stored on your device{sync.account ? ' and synced with your passkey account' : ''}.</p>
    <p class="muted small">Texts come from the <a href="https://github.com/scrollmapper/bible_databases" target="_blank" rel="noopener">Scrollmapper Bible databases</a> and
      the <a href="https://github.com/openscriptures/morphhb" target="_blank" rel="noopener">Open Scriptures Hebrew Bible</a> (CC BY 4.0).
      Strong's dictionary from <a href="https://github.com/openscriptures/strongs" target="_blank" rel="noopener">Open Scriptures</a> (CC BY-SA).
      Each version's license is listed on the Versions page.</p>
  </>

  return (
    <>
      {/* First: what you've kept while reading. Then sync, which brings it all to your other devices. */}
      <section class="set-group">
        <h2 class="set-kicker">Yours</h2>
        <div class="set-list">
          {settings.streaks && <StreakRow />}
          <Row icon={<BookmarkIcon size={24} />} label="Saved" sub="Bookmarks, notes, highlights" value={saved ? String(saved) : undefined} onClick={() => setPage('saved')} />
          <Row icon="🔎" label="Advanced search" onClick={() => setPage('search')} />
        </div>
      </section>
      {sync.enabled && <section class="set-group">
        <div class="set-list">
          <Row icon={<PersonIcon />} label={sync.account ? 'Account' : 'Sign in or sign up'} sub={syncNote(sync)}
            onClick={() => setPage('sync')} />
        </div>
      </section>}
      <BibleGroup setPage={setPage} />
      <section class="set-group">
        <h2 class="set-kicker">Reading</h2>
        <div class="set-list">
          <div class="set-row set-static">
            <span class="set-label">Text size</span>
            <button class="size-btn" onClick={() => update({ fontSize: Math.max(13, settings.fontSize - 1) })} aria-label="Smaller text">A−</button>
            <button class="size-btn big" onClick={() => update({ fontSize: Math.min(36, settings.fontSize + 1) })} aria-label="Larger text">A+</button>
          </div>
          <div class="set-row set-static set-theme">{sel('theme', [['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark'], ['system', 'Auto']])}</div>
          <Row label="Font and layout" value={fontName} onClick={() => setPage('reading')} />
        </div>
      </section>
      <section class="set-group">
        <div class="set-list">
          <Row label="Your data" onClick={() => setPage('data')} />
          <Row label="About" onClick={() => setPage('about')} />
        </div>
      </section>
      <VersionLine />
    </>
  )
}
