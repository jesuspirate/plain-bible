// Settings. Everything lives here, behind the one button in the top right
// corner: sync, the Bible you read, reading, your data. (Prayer and Circles
// have their own buttons beside search.) They rise as
// a sheet; pulling it down (or Done) goes back to the word. #/settings still
// opens them as a page, for old links.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { AWAY_ATTR, useLeave } from './motion'
import { defaultSettings, DEFAULT_FONT_SIZE, FONTS, go, readPath, Settings, useApp, useRoute, openTour, showVerseBar, showSearchWays, takeSettingsPage } from './state'
import { canHear } from './listen'
import { fine, Glyph } from './gesture'
import { DataTools } from './import'
import { VersionPicker } from './ui'
import { AddHomeIcon, BackIcon, BookIcon, BookmarkIcon, BooksIcon, CompareIcon, CompassIcon, DataIcon, GlobeIcon, InfoIcon, LayoutIcon, RefreshIcon, ReturnIcon, SpinnerIcon, SearchIcon, SpeakerIcon, ReadIcon, SuggestIcon, TextSizeIcon, ThemeIcon, VideoIcon, HideBarsIcon } from './icons'
import type { ComponentChildren } from 'preact'
import { copyText } from './lib/native'
import { fromPlayStore, inStoreApp, homeScreenHelps, isAndroid, isIPhone, openHomeScreen } from './lib/install'
import { checkForUpdate, useUpdate } from './lib/update'
import { hasContent, hlVars, yellowHidden } from './lib/marks'
import { QUICK, draw, penAllowed } from './lib/pen'
import { AccountSection } from './account'
import { canSuggest, reopenReport, SuggestPage } from './suggest'
import { Saved } from './saved'
import { Search } from './search'
import { Versions } from './versions'
import { saveRecording, useRecording } from './lib/recordMode'
import { StreakRow } from './streaks'
import { UNFOLDED, useWide } from './lib/spread'
import { clearSteps } from './lib/steps'
import { currentLang, deviceLang, intlTag, LANGS, locale, N_, t, tj } from './i18n'

// The version, quietly at the very bottom of Settings. Tap it to copy it
// (handy for reporting a problem). The line under it is the whole update:
// it looks for a new version and switches to it if there is one, or says
// you're up to date.
function VersionLine() {
  const state = useUpdate()
  const [copied, setCopied] = useState(false)
  const version = `My Quiet Bible ${__BUILD__}`
  const copy = async () => {
    try { await copyText(version); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* nothing to do */ }
  }
  const note = t({ idle: N_('Tap to check for updates'), checking: N_('Checking…'), ready: N_('New version: tap to update'), current: N_('Up to date'), offline: N_('Offline, try later') }[state])
  return (
    <div class={'version-line' + (state === 'ready' ? ' ready' : '')}>
      <button class="version-copy" onClick={copy} aria-label={t('Version {build}. Tap to copy', { build: __BUILD__ })}>{copied ? t('Copied ✓') : t('Version {build}', { build: __BUILD__ })}</button>
      {/* What an in-app browser (Fedi) gives the page, to tell why its sign-in shows or not. */}
      <button class="version-note" disabled={state === 'checking'} onClick={() => checkForUpdate()}>
        {state === 'checking' ? <SpinnerIcon size={14} class="spin" /> : <RefreshIcon size={14} />} {note}
      </button>
    </div>
  )
}

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Slide `box` away (downwards, or `to` the right), then run `done`.
 *  `done` waits for the slide to really end: run any sooner and the card
 *  was taken away while still partly on screen, so its fading copy (see
 *  motion.ts) showed the old view again for a moment before the new one.
 *  The card is marked as having gone by itself, so no copy is left at all.
 *  Downwards it goes all the way off the screen: a card that sits higher up
 *  (Circles, Your prayers) moved only its own height before, so it stopped
 *  with its top still showing and then vanished in one go.
 *  `dim`, the shade behind the card, fades out with it, so the two leave
 *  together instead of the shade waiting for the card and then going. */
export function slideAway(box: HTMLElement | null, done: () => void, to?: string, dim?: HTMLElement | null) {
  if (!box || still()) { done(); return }
  if (!to) {
    // Where the card is without any pull-down already applied to it.
    const pulled = new DOMMatrix(getComputedStyle(box).transform).m42
    const top = box.getBoundingClientRect().top - pulled
    // A little more than the screen, so its shadow goes too.
    to = `translate3d(0, ${Math.ceil(Math.max(box.offsetHeight, innerHeight - top) + 40)}px, 0)`
  }
  box.setAttribute(AWAY_ATTR, '')
  box.style.transition = 'transform .2s ease-in'
  box.style.transform = to
  if (dim) {
    dim.setAttribute(AWAY_ATTR, '')
    dim.style.transition = 'opacity .2s ease-in'
    dim.style.opacity = '0'
  }
  let over = false
  const end = () => { if (over) return; over = true; box.removeEventListener('transitionend', ended); done() }
  const ended = (e: TransitionEvent) => { if (e.target === box && e.propertyName === 'transform') end() }
  box.addEventListener('transitionend', ended)
  // In case the end never comes (the slide was cut short, a busy phone).
  setTimeout(end, 320)
}

// Pull down from the top to close, like the search panel. Only a pull that
// starts with `scroller` at its very top, heads clearly downwards (not
// sideways) and goes far enough, or is flicked, closes; anything else is a
// normal scroll. The non-passive touchmove listener is added only for such a
// pull, so scrolling never waits on it. Only transforms move, nothing blurs.
export function usePullDown(box: { current: HTMLElement | null }, scrollTop: () => number, onClose: () => void, dim?: () => HTMLElement | null) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!box.current) return
    const el: HTMLElement = box.current
    let start: { x: number; y: number } | undefined
    let pulling = false, dy = 0, last = { y: 0, t: 0 }, v = 0
    const back = () => { el.removeAttribute(AWAY_ATTR); el.style.transition = 'transform .25s cubic-bezier(.2, .8, .2, 1)'; el.style.transform = '' }
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
      if (dy > 120 || (dy > 50 && v > .5)) slideAway(el, close.current, undefined, dim?.())
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
// Font and layout is a short list too: each of its rows opens a page with
// just that one thing, and ‹ back goes to the list.
type LayoutPage = 'font' | 'layout' | 'verseNums' | 'highlights' | 'turning' | 'searchBar' | 'extras'
type Page = 'home' | 'sync' | 'reading' | 'audio' | 'saved' | 'search' | 'versions' | 'data' | 'about' | 'language' | 'recording' | 'suggest' | LayoutPage
const PAGE_TITLE: Record<Page, string> = {
  home: N_('Settings'), sync: N_('Account'), reading: N_('Font and layout'), audio: N_('Audio'), saved: N_('Saved'), search: N_('Advanced search'),
  versions: N_('Versions'), data: N_('Your data'), about: N_('About'), language: N_('Language'), recording: N_('Teaching mode'),
  suggest: N_('Report a problem'),
  font: N_('Font'), layout: N_('Layout'), verseNums: N_('Verse numbers'), highlights: N_('Highlights'), turning: N_('Turning pages'),
  searchBar: N_('Search bar'), extras: N_('Extras'),
}
const LAYOUT_PAGES: Page[] = ['font', 'layout', 'verseNums', 'highlights', 'turning', 'searchBar', 'extras']

/** Where you are in Settings: the first page, one page in, or (under Font and layout) two. */
function useSettingsNav() {
  const [page, setPage] = useState<Page>(() => reopenReport() ? 'suggest' : (takeSettingsPage() as Page | undefined) ?? 'home')
  // Going back from Report a problem cancels it: the recorded steps go too,
  // so they don't wait on the device for a report that was never sent.
  // (Closing Settings, or Record again, keeps them: that's not a cancel.)
  const back = () => { if (page === 'suggest') clearSteps(); setPage(LAYOUT_PAGES.includes(page) ? 'reading' : 'home') }
  return { page, setPage, back, title: t(PAGE_TITLE[page]), depth: page === 'home' ? 0 : LAYOUT_PAGES.includes(page) ? 2 : 1 }
}
type SettingsNav = ReturnType<typeof useSettingsNav>

// On a wide screen Settings is a panel at the right, with the text still in view.
const wide = () => matchMedia('(min-width: 900px)').matches
/** Put Settings away: down on a phone, off to the right on a wide screen. */
function putAway(box: HTMLElement | null, done: () => void) {
  slideAway(box, done, wide() ? 'translate3d(100%, 0, 0)' : undefined)
}

/** Settings as a sheet that rises over the page (a panel from the right on a
 *  wide screen), from the button in the top right corner. The word stays in
 *  view behind it: a tap there, a pull down, or Done puts it away. Inside
 *  pages have only ‹ back. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const boxLeave = useLeave(box), scrimLeave = useLeave(undefined, 'fade')
  const page = useRef<HTMLDivElement>(null)
  const nav = useSettingsNav()
  const navRef = useRef(nav)
  navRef.current = nav
  usePullDown(box, () => box.current?.scrollTop ?? 0, onClose)
  const done = () => putAway(box.current, onClose)
  useEffect(() => { box.current?.scrollTo(0, 0) }, [nav.page])
  // A page inside comes in the same quiet way as everything else.
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return }
    if (!still()) page.current?.animate?.([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 200, easing: 'cubic-bezier(.2, .8, .2, 1)' })
  }, [nav.page])
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
    <div class="settings-scrim" ref={scrimLeave} onClick={done} aria-hidden="true" />
    <div class="settings-sheet" ref={boxLeave} role="dialog" aria-modal="true" aria-label={t('Settings')} tabIndex={-1}
      // A link inside (a verse, mostly) leaves Settings behind.
      onClick={e => { if ((e.target as Element).closest?.('a[href^="#"], .pray-open')) onClose() }}>
      <div class="settings-head">
        <button type="button" class="settings-grabber" aria-label={t('Close settings')} onClick={done} />
        <div class="settings-title">
          {nav.page === 'home'
            ? <><h1>{t('Settings')}</h1><button class="done-btn" onClick={done}>{t('Done')}</button></>
            : <button class="settings-back" onClick={nav.back}><BackIcon class="back-ico" /> {nav.title}</button>}
        </div>
      </div>
      <div class="settings" ref={page}><SettingsBody nav={nav} /></div>
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
  useEffect(() => { document.title = t('Settings') + ' · My Quiet Bible' }, [])
  const box = useRef<HTMLDivElement>(null)
  const nav = useSettingsNav()
  usePullDown(box, () => window.scrollY, closeSettingsPage)
  useEffect(() => { window.scrollTo(0, 0) }, [nav.page])
  return (
    <div class="settings" ref={box}>
      <button type="button" class="settings-grabber" aria-label={t('Close settings')} onClick={closeSettingsPage} />
      {nav.page === 'home'
        ? <h1>{t('Settings')}</h1>
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
  if (!sync.account) return t('Free. Needed for Circles')
  if (sync.busy) return t('Syncing…')
  if (sync.error) return t('Couldn’t sync. Tap to see why')
  const at = sync.account.lastSync
  if (!at) return undefined
  const d = new Date(at)
  return t('Last synced {when}', { when: d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) })
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
  const recording = useRecording()
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
      <h2 class="set-kicker">{t('Bible')}</h2>
      <div class="set-list">
        <button class="set-row set-version" onClick={() => setOpen('version')}>
          <span class="set-icon" aria-hidden="true"><BookIcon size={24} /></span>
          <span class="set-vid">{version}</span>
          <span class="set-label">{byId.get(version)?.name ?? version}</span>
          <span class="set-chev" aria-hidden="true">›</span>
        </button>
        {version !== settings.version && byId.has(settings.version) &&
          <Row icon={<ReturnIcon size={24} />} label={t('Back to {version}', { version: settings.version })} sub={t('Your Bible')} onClick={() => goTo(settings.version, parallel)} />}
        <Row icon={<CompareIcon size={24} />} label={t('Compare side by side')} value={parallel.length ? parallel.join(', ') : t('Off')} onClick={() => setOpen('compare')} />
        <Row icon={<BooksIcon size={24} />} label={t('Manage versions')} onClick={() => setPage('versions')} />
        <Row icon={<VideoIcon size={24} />} label={t('Teaching mode')} value={recording.on ? recording.version : t('Off')} onClick={() => setPage('recording')} />
      </div>
      {open === 'version' && <VersionPicker title={t('Version')} selected={[version]} onClose={() => setOpen('')} onChange={([id]) => choose(id)} />}
      {open === 'compare' && (
        <VersionPicker title={t('Compare with')} multi max={5} selected={parallel} onClose={() => setOpen('')}
          onChange={ids => { update({ parallel: ids }); goTo(version, ids) }} />
      )}
    </section>
  )
}

// The language of the app's own words (not the Bible's: that's the version).
// Automatic follows the phone. Each language is named in itself, so you can
// find yours whatever the app is in now.
// Each language's name in the app's own language under it ("Kiswahili ·
// Swahili"), so you can find one you can't read; left out when it's the same.
// English uses the names the Bible catalog does ("Ilocano", not Intl's "Iloko").
const ENGLISH: Record<string, string> = { ilo: 'Ilocano', lg: 'Luganda', nd: 'Ndebele', pon: 'Pohnpeian', luo: 'Dholuo', ny: 'Chichewa', tw: 'Twi', ckb: 'Kurdish (Sorani)', 'zh-hans': 'Chinese (Simplified)', 'zh-hant': 'Chinese (Traditional)', nb: 'Norwegian (Bokmål)', nn: 'Norwegian (Nynorsk)', nso: 'Sepedi (Northern Sotho)' }
function inYours(id: string, own: string): string | undefined {
  let n: string | undefined
  try { n = new Intl.DisplayNames([intlTag()], { type: 'language' }).of(intlTag(id)) } catch { /* an old browser */ }
  if (currentLang() === 'en' || !n || n.toLowerCase() === id) n = ENGLISH[id] ?? (n && n.toLowerCase() !== id ? n : undefined)
  return n && n.toLowerCase() !== own.toLowerCase() ? n[0].toLocaleUpperCase(intlTag()) + n.slice(1) : undefined
}
function LanguagePage() {
  const { settings, update } = useApp()
  const phone = LANGS.find(l => l.id === deviceLang())!.name
  const opts: [Settings['language'], string, string?][] = [['auto', t('Automatic'), t('Same as this device: {lang}', { lang: phone })], ...[...LANGS].sort((a, b) => a.name.localeCompare(b.name)).map(l => [l.id, l.name, inYours(l.id, l.name)] as [Settings['language'], string, string?])]
  return (
    <>
    <div class="set-list" role="radiogroup" aria-label={t('Language')}>
      {opts.map(([id, name, sub]) => (
        <button role="radio" aria-checked={settings.language === id} class={'set-row lang-row' + (settings.language === id ? ' on' : '')} onClick={() => update({ language: id })}>
          <span class="set-label"><span lang={id === 'auto' ? undefined : id}>{name}</span>{sub && <span class="set-sub">{sub}</span>}</span>
          {settings.language === id && <span class="lang-check" aria-hidden="true">✓</span>}
        </button>
      ))}
    </div>
    <p class="muted small lang-note">{t('This changes the words of the app. The Bible you read is chosen under Bible, in Settings.')}</p>
    </>
  )
}

// Teaching mode (stored as recording mode), for filming the screen: one version large for the people watching, your
// Bible small under each verse for you. On this device only; it never
// changes your Bible (src/lib/recordMode.ts).
function RecordingPage() {
  const { settings, byId } = useApp()
  const rec = useRecording()
  const [picking, setPicking] = useState(false)
  return <>
    <p class="muted rec-about">{t('For teaching or sharing the Word on video or a big screen. The version you pick shows large for the people watching. Your Bible ({version}) shows small under each verse, so you can follow along. The bars slide away as you read: scroll up a little to bring them back.', { version: settings.version })}</p>
    <div class="set-list">
      <Row icon={<BookIcon size={24} />} label={t('Large on screen')} sub={byId.get(rec.version)?.name} value={rec.version} onClick={() => setPicking(true)} />
    </div>
    <button class={'rec-go' + (rec.on ? '' : ' primary')} onClick={() => saveRecording({ ...rec, on: !rec.on })}>
      {rec.on ? t('Turn off teaching mode') : t('Turn on teaching mode')}
    </button>
    <p class="muted small rec-about">{t('Only on this device. Your Bible doesn’t change.')}</p>
    {picking && <VersionPicker title={t('Large on screen')} selected={[rec.version]} onClose={() => setPicking(false)}
      onChange={([id]) => { if (id) saveRecording({ ...rec, version: id }); setPicking(false) }} />}
  </>
}

// Read along and Listen, shown more than told: each drawn as it looks
// where you find it (the icon at the search field's end, Listen on a verse's
// bar). Try it now closes Settings and the tour's fingertip taps the icon,
// then a verse in view, then Listen (taphint); the choice stays theirs.
function AudioHow() {
  const { settings, byId } = useApp()
  const route = useRoute()
  const version = route.path[0] === 'read' && byId.has(route.path[1]) ? route.path[1] : settings.version
  const hear = canHear(version, byId.get(version)?.lang)
  return <>
    <div class="audio-how">
      <span class="audio-pick audio-stack"><span class="like-btn"><ReadIcon size={24} />{t('Read along')}</span>
        <span class="what">{t('In the search bar, at its right end: reads on from the top of the screen as the words light up.')}</span></span>
      <p class="audio-also"><Glyph kind="tap" />{t('While it reads, tap any verse to read on from there.')}</p>
      <p class="audio-also"><Glyph kind="tap" />{t('Tap the verse being read to highlight or share it.')}</p>
      {hear && <>
        <p class="audio-also audio-first"><Glyph kind="tap" />{t('Tap a verse')}</p>
        <span class="audio-pick"><span class="like-btn"><SpeakerIcon size={22} />{t('Listen')}</span>
          <span class="what">{t('Only the verses you picked')}</span></span>
      </>}
    </div>
    {!hear && <p class="audio-note">{t('No voice for this Bible on this device: the words light up so you can read quietly.')}</p>}
    {/* Doesn't start anything for you: it shows you where to tap. */}
    <button class="primary audio-show" onClick={showVerseBar}><Glyph kind="tap" /> {t('Try it now')}</button>
  </>
}

// The search bar is the one way in the tour shows. The others are here, each
// with its gesture, and Try it now lets the fingertip show them on the real
// chapter title (taphint).
function SearchWays() {
  return <div class="search-ways">
    <h3>{t('Other ways to open search')}</h3>
    {fine
      ? <p class="audio-also"><Glyph kind="tap" />{t('Click the chapter title, or press /')}</p>
      : <p class="audio-also"><Glyph kind="tap" />{t('Tap the chapter title')}</p>}
    <p class="audio-note">{t('After a search, open it again to go back to your last result.')}</p>
    <button class="primary audio-show" onClick={showSearchWays}><Glyph kind="tap" /> {t('Try it now')}</button>
  </div>
}

function SettingsBody({ nav }: { nav: SettingsNav }) {
  const { page, setPage } = nav
  const { settings, update, catalog, marks, sync } = useApp()
  // Advanced search keeps its query here while you're in Settings.
  const [searchQuery, setSearchQuery] = useState('')
  const saved = Object.values(marks).filter(hasContent).length
  // The open book is showing now (see Reader): then the page turns like a
  // book, and Chapter turn does nothing, so it's left out until one page is used.
  const wide = useWide(), recording = useRecording()
  const bigScreen = matchMedia(`(min-width: 1000px), ${UNFOLDED}`).matches
  const bookOn = wide && settings.spread !== 'single' && (recording.on || !settings.parallel.some(id => id !== settings.version))
  const sel = <K extends keyof Settings>(k: K, opts: [Settings[K], string][]) => (
    <div class="seg" role="radiogroup">
      {opts.map(([v, label]) => (
        <button role="radio" aria-checked={settings[k] === v} class={settings[k] === v ? 'on' : ''} onClick={() => update({ [k]: v } as Partial<Settings>)}>{label}</button>
      ))}
    </div>
  )
  const fontName = FONTS.find(f => f.id === settings.font)?.label

  // Grouped like the Settings page itself: a small heading over each kind of
  // choice. A tick box has a short bold name, and what it does in quiet words under it.
  const check = (k: 'penSlow' | 'noteReminders' | 'streaks' | 'worldMap' | 'strongs' | 'strongsNumbers' | 'searchBar', label: string, note?: string) => (
    <label class="check"><input type="checkbox" checked={settings[k]} onChange={e => update({ [k]: (e.target as HTMLInputElement).checked } as Partial<Settings>)} />
      <span class="check-text"><span class={note ? "check-name" : undefined}>{label}</span>{note && <span class="muted small">{note}</span>}</span></label>
  )
  // Font and layout: a short list, one row for each kind of choice with what
  // it's set to now. Each row opens a page with only that choice on it.
  const turnName = bookOn ? t('Two pages') : t(settings.turn === 'slide' ? 'Side by side' : settings.turn === 'off' ? 'None' : 'Stack')
  const extras = [settings.noteReminders && t('Notes'), settings.streaks && t('Streaks'), settings.strongs && t("Strong's numbers")].filter(Boolean).join(', ')
  if (page === 'reading') return <div class="layout-page">
    <section class="set-group"><div class="set-list">
      <Row label={t('Font')} value={fontName && t(fontName)} onClick={() => setPage('font')} />
      <Row label={t('Layout')} sub={settings.layout === 'paragraph' ? t('Paragraph') : t('One verse per line')} onClick={() => setPage('layout')} />
      <Row label={t('Verse numbers')} value={t(settings.verseNumbers === 'small' ? 'Small' : settings.verseNumbers === 'large' ? 'Large' : 'Medium')} onClick={() => setPage('verseNums')} />
    </div></section>
    <section class="set-group"><div class="set-list">
      <Row label={t('Highlights')} value={t(settings.highlight === 'text' ? 'Colored text' : settings.highlight === 'block' ? 'Block' : 'Marker')} onClick={() => setPage('highlights')} />
      {(!bookOn || bigScreen) && <Row label={t('Turning pages')} value={turnName} onClick={() => setPage('turning')} />}
      <Row label={t('Search bar')} value={settings.searchBar ? t('On') : t('Off')} onClick={() => setPage('searchBar')} />
    </div></section>
    <section class="set-group"><div class="set-list">
      <Row label={t('Extras')} sub={extras || t('Off')} onClick={() => setPage('extras')} />
    </div></section>
  </div>

  if (page === 'font') return <div class="layout-page">
    <div class="fonts" role="radiogroup" aria-label={t('Reading font')}>
      {FONTS.map(f => (
        <button role="radio" aria-checked={settings.font === f.id} class={'font-card' + (settings.font === f.id ? ' on' : '')}
          style={{ fontFamily: f.family }} onClick={() => update({ font: f.id })}>
          <span class="font-sample">{t('In the beginning was the Word')}</span>
          <span class="font-name">{t(f.label)}<span class="muted"> · {t(f.note)}</span></span>
        </button>
      ))}
    </div>
  </div>

  if (page === 'layout') return <div class="layout-page">
    <Sample />
    {sel('layout', [['verses', t('One verse per line')], ['paragraph', t('Paragraph')]])}
  </div>

  if (page === 'verseNums') return <div class="layout-page">
    <Sample />
    {sel('verseNumbers', [['small', t('Small')], ['medium', t('Medium')], ['large', t('Large')]])}
  </div>

  if (page === 'highlights') return <div class="layout-page">
    <div class="col">
      {sel('highlight', [['marker', t('Marker')], ['text', t('Colored text')], ['block', t('Block')]])}
      <HlPreview />
    </div>
    <div class="field">{check('penSlow', t('Draw each new highlight slowly, like a marker in your hand.'))}</div>
    <p class="muted small">{t('Tap a verse twice quickly to highlight it in the last color you used.')} {t('With a pen or stylus, draw across words to highlight just those words.')}</p>
  </div>

  if (page === 'turning') return <div class="layout-page">
    {!bookOn && <div class="field"><span>{t('Chapter turn')}</span>
      <div class="col">
        {sel('turn', [['stack', t('Stack')], ['slide', t('Side by side')], ['off', t('None')]])}
        <span class="muted small">{settings.turn === 'slide' ? t('Both chapters slide across together.') : settings.turn === 'off' ? t('The chapter changes with no movement.') : t('Your page slides away over the next chapter, like a stack of pages.')}</span>
      </div>
    </div>}
    {bigScreen && <div class="field"><span>{t('Big screen')}</span>
      <div class="col">
        {sel('spread', [['double', t('Two pages')], ['single', t('One page')]])}
        <span class="muted small">{settings.spread === 'single' ? t('One long page that scrolls, as on a phone.') : bookOn ? t('On now: an open book, two pages side by side, and you turn the page like a book. Chapter turn is only for one page.') : t('An open book: two pages side by side, and you turn the page. Used when the screen is wider than it is tall.')}</span>
      </div>
    </div>}
  </div>

  if (page === 'searchBar') return <div class="layout-page">
    <div class="field">{check('searchBar', t('Search bar'), t('Show the full search bar at the bottom of the screen. When off, a small round search button sits in the corner instead.'))}</div>
    <SearchWays />
  </div>

  if (page === 'extras') return <div class="layout-page">
    <div class="field"><span>{t('Prayer buttons')}</span>
      <div class="col">
        {sel('discs', [['quiet', t('Quiet')], ['brown', t('All brown')], ['honey', t('Honey')]])}
        <span class="muted small">{t('How 🙏 and Circles look at the bottom of the screen, in Light and Sepia.')}</span>
      </div>
    </div>
    <div class="field">{check('noteReminders', t('Notes'), t('Under each chapter title, show how many notes you have on it, including notes elsewhere that mention it (like “see John 3:16”) or share a #tag with one here.'))}</div>
    <div class="field">{check('streaks', t('Streaks'), t('At the top of Settings, show how many days in a row you’ve read the word and prayed. Nothing ever reminds you.'))}</div>
    <div class="field">{check('worldMap', t('Count my prayers on the map'), t('After Amen, a map shows the countries where people prayed this week. Your prayers count by country only: never a city, a name or a word.'))}</div>
    <div class="field"><div class="col">
      {check('strongs', t("Strong's numbers"), t('Make tagged words tappable (KJV, BSB, LSG, Hebrew and Greek texts)'))}
      {check('strongsNumbers', t('Show the numbers inline'))}
    </div></div>
  </div>

  // Read along is the icon at the search field's end, Listen is on a verse's
  // bar, where people don't think to look: this page shows both.
  if (page === 'audio') return <>
    <AudioHow />
    <div class="field"><span>{t('Read along')}</span>
      <label><input type="checkbox" checked={settings.alongButton} onChange={e => update({ alongButton: (e.target as HTMLInputElement).checked })} /> {t('Show the Read along icon in the search bar')}</label>
    </div>
    <div class="field"><span>{t('Read aloud')}</span>
      <div class="col">
        {sel('follow', [['words', t('Word by word')], ['verse', t('Verse by verse')]])}
        <label><input type="checkbox" checked={settings.readSilent} onChange={e => update({ readSilent: (e.target as HTMLInputElement).checked })} /> {t('No voice: the highlight moves through the words by itself, so you can read along quietly at your own pace.')}</label>
      </div>
    </div>
  </>

  if (page === 'saved') return <Saved onImport={() => setPage('data')} />
  if (page === 'search') return <Search route={{ path: ['search'], params: new URLSearchParams(searchQuery) }} onGo={p => setSearchQuery(p.split('?')[1] ?? '')} />
  if (page === 'versions') return <Versions inSheet />
  if (page === 'sync') return <AccountSection />
  if (page === 'language') return <LanguagePage />
  if (page === 'recording') return <RecordingPage />
  if (page === 'suggest') return <SuggestPage onDone={() => setPage('home')} />

  if (page === 'data') return <>
    <DataTools />
    <h2>{t('Settings')}</h2>
    <ResetSettings synced={!!sync.account} onReset={() => {
      // Only the settings: highlights, notes, history and the account stay.
      // The language stays: a reset shouldn't leave you in one you can't read.
      update({ ...defaultSettings(catalog), language: settings.language })
    }} />
  </>

  if (page === 'about') return <>
    <p>{t('My Quiet Bible: read, pray, share, repeat. {n} versions, a fast search, prayer with one button, and private circles. No plans, no tracking, and an account is optional.', { n: catalog.translations.length })}{' '}
      {sync.account ? t('Your highlights and settings are stored on your device and synced with your passkey account.') : t('Your highlights and settings are stored on your device.')}</p>
    {/* The welcome page is what a first visit to the bare address shows: what this is, and how to put it on a Home Screen. */}
    <p>{tj('To pass My Quiet Bible on, send {site}. It opens on a {welcome} that says what this is and how to put it on a Home Screen.', {
      site: <strong>myquietbible.com</strong>, welcome: <a href="welcome/">{t('welcome page')}</a> })}</p>
    {/* The only place the app asks: no banners, nothing inside the Bible.
        Never in the store apps: Apple doesn't allow it, and Google Play allows
        gifts only through Play itself. */}
    {!inStoreApp() && !fromPlayStore() && <p>{tj('My Quiet Bible is free for everyone, forever. If it helps you, you can {support}.', {
      support: <a href="support/">{t('help keep the lamp lit')}</a> })}</p>}
    <p class="muted small">{tj('Texts come from the {scrollmapper} and the {oshb} (CC BY 4.0).', {
      scrollmapper: <a href="https://github.com/scrollmapper/bible_databases" target="_blank" rel="noopener">{t('Scrollmapper Bible databases')}</a>,
      oshb: <a href="https://github.com/openscriptures/morphhb" target="_blank" rel="noopener">Open Scriptures Hebrew Bible</a> })}{' '}
      {tj('Strong’s dictionary from {source} (CC BY-SA).', { source: <a href="https://github.com/openscriptures/strongs" target="_blank" rel="noopener">Open Scriptures</a> })}{' '}
      {tj('Word definitions from {source} (CC BY-SA), through {kaikki}.', { source: <a href="https://www.wiktionary.org" target="_blank" rel="noopener">Wiktionary</a>, kaikki: <a href="https://kaikki.org" target="_blank" rel="noopener">kaikki.org</a> })}{' '}
      {t('Each version’s license is listed on the Versions page.')}</p>
  </>

  return (
    <>
      {/* First: what you've kept while reading. Then sync, which brings it all to your other devices. */}
      <section class="set-group">
        <h2 class="set-kicker">{t('Yours')}</h2>
        <div class="set-list">
          {settings.streaks && <StreakRow />}
          <Row icon={<BookmarkIcon size={24} />} label={t('Saved')} sub={t('Highlights, notes, bookmarks')} value={saved ? String(saved) : undefined} onClick={() => setPage('saved')} />
        </div>
      </section>
      {sync.enabled && <section class="set-group">
        <div class="set-list">
          <Row icon={<PersonIcon />} label={sync.account ? t('Account') : t('Sign in or sign up')} sub={syncNote(sync)}
            onClick={() => setPage('sync')} />
        </div>
      </section>}
      <BibleGroup setPage={setPage} />
      <section class="set-group">
        <h2 class="set-kicker">{t('Reading')}</h2>
        <div class="set-list">
          <div class="set-row set-static size-row">
            <span class="set-icon" aria-hidden="true"><TextSizeIcon size={24} /></span>
            <span class="set-label">{t('Text size')}</span>
            <button class="size-btn" onClick={() => update({ fontSize: Math.max(13, settings.fontSize - 1) })} aria-label={t('Smaller text')}>A−</button>
            <output class="size-num" aria-live="polite" aria-label={t('Text size') + ' ' + settings.fontSize}>{settings.fontSize}</output>
            <button class="size-btn big" onClick={() => update({ fontSize: Math.min(36, settings.fontSize + 1) })} aria-label={t('Larger text')}>A+</button>
          </div>
          {settings.fontSize !== DEFAULT_FONT_SIZE && <div class="set-row set-static size-reset-row">
            <button class="size-reset" onClick={() => update({ fontSize: DEFAULT_FONT_SIZE })}>{t('Back to default size ({n})', { n: DEFAULT_FONT_SIZE })}</button>
          </div>}
          <div class="set-row set-static set-theme"><span class="set-icon" aria-hidden="true"><ThemeIcon size={24} /></span>{sel('theme', [['light', t('Light')], ['sepia', t('Sepia')], ['dark', t('Dark')], ['system', t('Auto')]])}</div>
          {/* Right here, one tick: whether the bars slide away as you read
              upright. (With the phone on its side they always do.) */}
          <label class="set-row set-check">
            <span class="set-icon" aria-hidden="true"><HideBarsIcon size={24} /></span>
            <span class="set-label">{t('Hide bars while scrolling')}
              <span class="set-sub">{t('Scroll up a little to bring them back. With the phone on its side, they always slide away.')}</span></span>
            <input type="checkbox" checked={settings.hideBars} onChange={e => update({ hideBars: (e.target as HTMLInputElement).checked })} />
          </label>
          <Row icon={<SpeakerIcon size={24} />} label={t('Audio')} sub={t('Hear the Bible read aloud')} onClick={() => setPage('audio')} />
          <Row icon={<LayoutIcon size={24} />} label={t('Font and layout')} value={fontName && t(fontName)} onClick={() => setPage('reading')} />
        </div>
      </section>
      <section class="set-group">
        <div class="set-list">
          <Row icon={<GlobeIcon size={24} />} label={t('Language')} value={settings.language === 'auto' ? t('Automatic') : LANGS.find(l => l.id === settings.language)?.name}
            onClick={() => setPage('language')} />
          <Row icon={<DataIcon size={24} />} label={t('Your data')} onClick={() => setPage('data')} />
          {/* Gone once it's on the Home Screen. */}
          {homeScreenHelps() && <Row icon={<AddHomeIcon size={24} />} label={isIPhone() || isAndroid() ? t('Put it on your Home Screen') : t('Install it as an app')}
            sub={t('Opens like an app, works offline')} onClick={openHomeScreen} />}
          <Row icon={<CompassIcon size={24} />} label={t('Take the tour')} sub={t('A one-minute look around the app')} onClick={openTour} />
          {canSuggest() && <Row icon={<SuggestIcon size={24} />} label={t('Report a problem')} sub={t('Or send a suggestion')} onClick={() => setPage('suggest')} />}
          <Row icon={<InfoIcon size={24} />} label={t('About')} onClick={() => setPage('about')} />
        </div>
      </section>
      <VersionLine />
    </>
  )
}

/** Reset settings, asked in the app's own card rather than the browser's box. */
function ResetSettings({ synced, onReset }: { synced: boolean; onReset: () => void }) {
  const [asking, setAsking] = useState(false)
  const [done, setDone] = useState(false)
  if (!asking) return <>
    <p><button onClick={() => { setDone(false); setAsking(true) }}>{t('Reset settings')}</button></p>
    {done && <p class="muted small">{t('Settings are back to their defaults.')}</p>}
  </>
  return (
    <div class="confirm-card" role="alertdialog" aria-labelledby="reset-title">
      <p id="reset-title" class="confirm-title"><strong>{t('Reset font, theme, layout and version choices to their defaults?')}</strong></p>
      <p>{t('Your highlights, bookmarks and notes are kept, and you stay signed in.')}{synced ? ' ' + t('Your other synced devices will get the default settings too.') : ''}</p>
      <div class="confirm-buttons">
        <button class="primary" onClick={() => { onReset(); setAsking(false); setDone(true) }}>{t('Reset settings')}</button>
        <button onClick={() => setAsking(false)}>{t('Cancel')}</button>
      </div>
    </div>
  )
}

// Two highlighted lines, as the reader shows them. They're drawn in again
// (quick or slow) whenever you change how highlights look, so you can see it.
// Two verses as they'll look on the page, in your font, size, layout and
// verse numbers, so a choice shows the moment you tap it.
function Sample() {
  const { settings } = useApp()
  const vs = [t('In the beginning was the Word, and the Word was with God,'), t('and the Word was God.')]
  return <div class={'layout-sample' + (settings.layout === 'paragraph' ? ' para' : '')} aria-hidden="true">
    {vs.map((v, i) => <span class="ls-verse"><sup class="vn">{i + 1}</sup><span class="vt">{v}</span>{' '}</span>)}
  </div>
}

function HlPreview() {
  const { settings } = useApp()
  const box = useRef<HTMLParagraphElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const el = box.current
    if (!el || !penAllowed()) return
    const vs = [...el.querySelectorAll<HTMLElement>('.pv')]
    for (const v of vs) v.classList.add('hl-draw')
    return draw(vs, settings.highlight, el, () => {}, settings.penSlow ? undefined : QUICK)
  }, [settings.penSlow, settings.highlight])
  return (
    <p class="hl-preview" aria-hidden="true" ref={box}>
      <span class="pv hl" style={hlVars(yellowHidden(settings.highlight, settings.theme) ? '#dac6ff' : '#fff193')}><span class="vt">{t('In the beginning was the Word, and the Word was with God,')}</span></span>{' '}
      <span class="pv hl" style={hlVars('#b3e487')}><span class="vt">{t('and the Word was God.')}</span></span>
    </p>
  )
}
