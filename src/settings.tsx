// Settings. They live inside the search panel: the Settings button there
// raises them as a sheet over it, and pulling the sheet down goes back to
// search (pull again, or Done, and you're back to the word). #/settings still
// opens them as a page, for old links.
import { useEffect, useRef, useState } from 'preact/hooks'
import { defaultSettings, FONTS, go, openPrayer, Settings, useApp } from './state'
import { DataTools } from './import'
import { VersionPicker } from './ui'
import { RefreshIcon } from './icons'
import { copyText, isNative } from './lib/native'
import { checkForUpdate, useUpdate } from './lib/update'
import { hasContent } from './lib/marks'
import { AccountSection } from './account'

// The version, quietly at the very bottom of Settings. Tap it to copy it
// (handy for reporting a problem). The line under it is the whole update:
// it looks for a new version and switches to it if there is one, or says
// you're up to date.
function VersionLine() {
  const state = useUpdate()
  const [copied, setCopied] = useState(false)
  const version = `Plain Bible ${__BUILD__}`
  const copy = async () => {
    try { await copyText(version); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* nothing to do */ }
  }
  const note = { idle: 'Tap to check for updates', checking: 'Checking…', ready: 'New version: tap to update', current: 'Up to date', offline: 'Offline, try later' }[state]
  return (
    <div class={'version-line' + (state === 'ready' ? ' ready' : '')}>
      <button class="version-copy" onClick={copy} aria-label={`Version ${__BUILD__}. Tap to copy`}>{copied ? 'Copied ✓' : `Version ${__BUILD__}`}</button>
      {!isNative && <button class="version-note" disabled={state === 'checking'} onClick={() => checkForUpdate()}>
        <RefreshIcon size={14} class={state === 'checking' ? 'spin' : undefined} /> {note}
      </button>}
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
function usePullDown(box: { current: HTMLElement | null }, scrollTop: () => number, onClose: () => void) {
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

/** Settings as a sheet that rises over the search panel. `onBack` returns
 *  to search; `onDone` closes search too, back to the word. */
export function SettingsSheet({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  usePullDown(box, () => box.current?.scrollTop ?? 0, onBack)
  const done = () => slideAway(box.current, onDone)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.stopPropagation(); slideAway(box.current, onBack) } }
    addEventListener('keydown', esc, true)
    box.current?.focus({ preventScroll: true })
    return () => removeEventListener('keydown', esc, true)
  }, [])
  return (
    <div class="settings-sheet" ref={box} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}
      // A link inside (Saved, Advanced search, Prayer) leaves Settings and search behind.
      onClick={e => { if ((e.target as Element).closest?.('a[href^="#"], .pray-open')) onDone() }}>
      <div class="settings-head">
        <button type="button" class="settings-grabber" aria-label="Back to search" onClick={() => slideAway(box.current, onBack)} />
        <div class="settings-title">
          <h1>Settings</h1>
          <button class="done-btn" onClick={done}>Done</button>
        </div>
      </div>
      <div class="settings"><SettingsBody /></div>
    </div>
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
  useEffect(() => { document.title = 'Settings · Plain Bible' }, [])
  const box = useRef<HTMLDivElement>(null)
  usePullDown(box, () => window.scrollY, closeSettingsPage)
  return (
    <div class="settings" ref={box}>
      <button type="button" class="settings-grabber" aria-label="Close settings" onClick={closeSettingsPage} />
      <h1>Settings</h1>
      <SettingsBody />
    </div>
  )
}

function SettingsBody() {
  const { settings, update, catalog, marks, sync, byId } = useApp()
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
    <>
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
      <div class="field"><span>Prayer</span>
        <div class="col">
          <button class="link pray-open" onClick={openPrayer}>Pray out loud; kept on this device only ›</button>
          <div class="seg tones" role="radiogroup" aria-label="Prayer button">
            {['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'].map(t => (
              <button role="radio" aria-checked={settings.prayTone === t} class={settings.prayTone === t ? 'on' : ''} onClick={() => update({ prayTone: t })}>{'🙏' + t}</button>
            ))}
          </div>
        </div>
      </div>
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
        <label><input type="checkbox" checked={settings.searchBar} onChange={e => update({ searchBar: (e.target as HTMLInputElement).checked })} /> Show the full search bar at the bottom of the screen. When off, a small round search button sits in the corner instead.</label>
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
          {sel('turn', [['stack', 'Stack'], ['slide', 'Side by side'], ['off', 'None']])}
          <span class="muted small">{settings.turn === 'slide' ? 'Both chapters slide across together.' : settings.turn === 'off' ? 'The chapter changes with no movement.' : 'Your page slides away over the next chapter, like a stack of pages.'}</span>
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
      <p><button onClick={() => {
        // Only the settings: highlights, notes, history and the account stay.
        if (confirm('Reset font, theme, layout and version choices to their defaults?\n\nYour highlights, bookmarks and notes are kept, and you stay signed in.'
          + (sync.account ? ' Your other synced devices will get the default settings too.' : ''))) {
          update({ ...defaultSettings(catalog), favorite: undefined })
        }
      }}>Reset settings</button></p>
      </>}
      <VersionLine />
    </>
  )
}
