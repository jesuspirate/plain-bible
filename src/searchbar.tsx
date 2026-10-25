// Floating search bar at the bottom of the screen, in the style of the iOS
// search field. Tapping it opens a panel with instant results: a reference
// jump with the verse itself, matching books, live search hits, and recent
// searches, and the chapters of the book you are reading. It stays pinned
// while you read, showing where you are.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BOOKS, bookById } from './lib/books'
import { parseRef, formatRef, Ref } from './lib/refs'
import { plain } from './lib/text'
import { call } from './searchClient'
import type { PageResponse, PageVerse, SearchResponse } from './search.worker'
import { go, inCircles, openCircles, openPrayer, readPath, TONES, useApp } from './state'
import { circlesWithNews, useCircleNews } from './lib/circleNews'
import { SYNC_URL } from './lib/sync'
import { CircleIcon } from './icons'
import { VerseText } from './ui'
import { useHoldPick } from './hold'
import { isIOS } from './lib/native'

const TONE_NAMES = ['Yellow', 'Light skin tone', 'Medium-light skin tone', 'Medium skin tone', 'Medium-dark skin tone', 'Dark skin tone']

/** 🙏: tap to pray. Press and hold for the skin tones. */
function PrayButton() {
  const { settings, update } = useApp()
  const { button, picker } = useHoldPick({
    options: TONES.map((t, i) => ({ value: t, label: TONE_NAMES[i], body: '🙏' + t })),
    value: settings.prayTone, onPick: t => update({ prayTone: t }), onTap: () => openPrayer(),
    label: 'Prayer button skin tone', cls: 'tone-pick', cell: 42,
  })
  return (
    <>
      <button {...button} type="button" class="sb-pray holdable" aria-label="Pray" title="Pray · hold for skin tones">
        <span class="sb-pray-emoji" aria-hidden="true">{'🙏' + settings.prayTone}</span>
      </button>
      {picker}
    </>
  )
}

/** Circles: the people you read and pray with, one tap away beside 🙏.
 *  A dot when someone shared, replied or prayed with you since you last looked. */
function CirclesButton() {
  useCircleNews()
  const news = inCircles() && circlesWithNews() > 0
  return (
    <button type="button" class="sb-circles" onClick={() => openCircles()}
      aria-label={news ? 'Circles · something new' : 'Circles'} title="Circles">
      <CircleIcon size={30} />
      {news && <span class="sb-news-dot" aria-hidden="true" />}
    </button>
  )
}

// On a phone the bar shares its row with Circles and 🙏, so long book names
// are shortened (1 Thess, Deut) to keep the version in view.
const shortName = (id: string) => { const b = bookById(id); return innerWidth < 430 && b.name.length > 10 ? b.abbr : b.name }

const RECENT = 'plain-bible:recent'
const loadRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]') } catch { return [] } }
export function rememberSearch(q: string) {
  const list = [q, ...loadRecent().filter(x => x !== q)].slice(0, 8)
  try { localStorage.setItem(RECENT, JSON.stringify(list)) } catch { /* ignore */ }
}

// With `mini`, the closed bar shrinks to a small round button in the corner;
// tapping it opens the same panel.
export function SearchBar({ here, mini }: { here?: { version: string; book: string; chapter: number }; mini?: boolean }) {
  const { settings, data, byId } = useApp()
  // Chapter counts per book in the current version, for the book and chapter browser.
  const [lens, setLens] = useState<Record<string, number>>({})
  const [browse, setBrowse] = useState<string>()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [live, setLive] = useState<{ q: string; total: number; verses: PageVerse[] }>()
  const [preview, setPreview] = useState<{ ref: Ref; lines: [number, string][] }>()
  const input = useRef<HTMLInputElement>(null)
  const version = here?.version ?? settings.version
  const t = byId.get(version)

  const chapterRow = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // While open, pin the bar and panel to the visible part of the screen,
  // above the keyboard. Opening is one step: the panel appears at once in
  // the place it will keep, and the keyboard rises into the space left for
  // it below. The phone's keyboard height is remembered from last time (a
  // close guess the very first time), so nothing has to move when it
  // arrives, and iOS sees the field already clear of it and doesn't shift
  // the screen. If the keyboard turns out a different size, the panel
  // follows it.
  useLayoutEffect(() => {
    if (!open) return
    const root = document.documentElement, vv = window.visualViewport
    const phone = !!vv && matchMedia('(pointer: coarse)').matches
    const key = `${innerWidth}x${innerHeight}`
    const set = (top: number, h: number) => {
      root.style.setProperty('--vv-top', top + 'px')
      root.style.setProperty('--vv-h', h + 'px')
    }
    const vk = overlayKeyboard(true)
    // The screen's full height, keyboard down; the keyboard counts as up once
    // it takes a good part of it.
    const full = innerHeight, kb = phone ? keyboardHeight(key) : 0
    if (vk && vk.boundingRect.height > 100) set(0, full - vk.boundingRect.height) // keyboard already up
    else if (vv && vv.height < full - 100) set(vv.offsetTop, vv.height)
    else if (kb) set(0, full - kb)
    else if (vv) set(vv.offsetTop, vv.height)
    let seen = false, last = 0
    const fit = () => {
      if (!vv) return
      // Over the page, the keyboard leaves the screen its full size and says
      // how tall it is instead.
      const h = vk ? full - vk.boundingRect.height : vv.height, up = h < full - 100
      // On a phone, ignore the in-between sizes while the keyboard is still
      // on its way; after that, follow it (the ✓ button can put it away).
      if (phone && !up && !seen) return
      if (up) seen = true
      if (phone && up && h !== last) { last = h; rememberKeyboard(key, full - h) }
      set(vv.offsetTop, h)
    }
    // iOS can scroll the page under the panel while the keyboard comes up;
    // closing puts you back where you were reading.
    const y = scrollY, at = location.hash
    root.classList.add('sb-lock')
    vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit)
    vk?.addEventListener('geometrychange', fit)
    return () => {
      vk?.removeEventListener('geometrychange', fit); overlayKeyboard(false)
      if (location.hash === at && Math.abs(scrollY - y) > 1) scrollTo(0, y)
      root.classList.remove('sb-lock')
      root.style.removeProperty('--vv-top'); root.style.removeProperty('--vv-h')
      vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit)
    }
  }, [open])

  // Chapter strip: a mouse wheel or a drag scrolls it sideways on desktop.
  const drag = useRef<{ x: number; left: number; moved: boolean }>()
  const onWheel = (e: WheelEvent) => {
    const row = chapterRow.current
    if (!row || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
    row.scrollBy({ left: e.deltaY, behavior: 'auto' }); e.preventDefault()
  }
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !chapterRow.current) return
    drag.current = { x: e.clientX, left: chapterRow.current.scrollLeft, moved: false }
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current, row = chapterRow.current
    if (!d || !row) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 4) { d.moved = true; row.scrollLeft = d.left - dx }
  }
  const endDrag = () => { setTimeout(() => { drag.current = undefined }, 0) }
  useEffect(() => { if (browse) panel.current?.scrollTo({ top: 0, behavior: 'smooth' }) }, [browse])
  useEffect(() => {
    const row = chapterRow.current, on = row?.querySelector<HTMLElement>('.on')
    if (row && on) row.scrollLeft = on.offsetLeft - row.clientWidth / 2 + on.clientWidth / 2
  }, [open, browse, lens])

  useEffect(() => {
    if (open) data.bible(version).then(b => setLens(Object.fromEntries(Object.entries(b.books).map(([k, v]) => [k, v.length]))))
  }, [open, version])
  useEffect(() => { if (!open) setBrowse(undefined) }, [open])
  const browseBook = browse ?? here?.book ?? 'Gen'
  const chapters = lens[browseBook] ?? 0

  // "/" or Cmd/Ctrl+K focuses the bar.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select, dialog')
      if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault(); input.current?.focus()
      }
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [])

  const trimmed = q.trim()
  const ref = useMemo(() => /\d/.test(trimmed) ? parseRef(trimmed) : undefined, [trimmed])
  const books = useMemo(() => {
    if (!trimmed || ref) return []
    const k = trimmed.toLowerCase()
    return BOOKS.filter(b => t?.books.includes(b.id) && (b.name.toLowerCase().startsWith(k) || b.abbr.toLowerCase() === k)).slice(0, 6)
  }, [trimmed, ref])

  // Reference preview: show the verse (or first verses of the chapter).
  useEffect(() => {
    setPreview(undefined)
    if (!ref) return
    let stale = false
    data.bible(version).then(b => {
      const ch = b.books[ref.book]?.[ref.chapter - 1]
      if (!ch || stale) return
      const from = ref.verse ?? 1, to = ref.verseEnd ?? (ref.verse ?? 3)
      const lines: [number, string][] = []
      for (let v = from; v <= Math.min(to, from + 5, ch.length); v++) lines.push([v, plain(ch[v - 1])])
      setPreview({ ref, lines })
    })
    return () => { stale = true }
  }, [ref?.book, ref?.chapter, ref?.verse, ref?.verseEnd, version])

  // Live results while typing.
  useEffect(() => {
    if (trimmed.length < 2 || ref) { setLive(undefined); return }
    let stale = false
    const timer = setTimeout(async () => {
      const base = data.url('')
      const options = settings.searchOptions
      try {
        const r = await call<SearchResponse>({ type: 'search', base, query: trimmed, versions: [version], options })
        if (stale) return
        const total = r.hits.length / 4
        const refs: [string, number, number, number][] = []
        for (let i = 0; i < Math.min(4, total); i++) refs.push([BOOKS[r.hits[i * 4]].id, r.hits[i * 4 + 1], r.hits[i * 4 + 2], r.hits[i * 4 + 3]])
        const page = refs.length ? await call<PageResponse>({ type: 'page', base, query: trimmed, versions: [version], options, refs }) : { verses: [] }
        if (!stale) setLive({ q: trimmed, total, verses: page.verses })
      } catch { if (!stale) setLive(undefined) }
    }, 220)
    return () => { stale = true; clearTimeout(timer) }
  }, [trimmed, version])

  // On iPhone, a tap on the closed bar would focus the field down at the
  // bottom of the screen, and iOS then slides the whole screen to keep it
  // above the keyboard: the panel jumped down and slid back up with the
  // keyboard. So the tap puts the bar in its open place first, where the
  // keyboard won't cover it, and only then focuses it, without scrolling.
  const sb = useRef<HTMLDivElement>(null)
  const tap = useRef<{ x: number; y: number }>()
  const onFieldTouchStart = (e: TouchEvent) => {
    if (!open) overlayKeyboard(true) // before the keyboard is asked for
    tap.current = !open && isIOS ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : undefined
  }
  const onFieldTouchEnd = (e: TouchEvent) => {
    const start = tap.current, end = e.changedTouches[0], el = sb.current
    tap.current = undefined
    if (!start || !el || open || Math.hypot(end.clientX - start.x, end.clientY - start.y) > 10) return
    e.preventDefault()
    const kb = keyboardHeight(`${innerWidth}x${innerHeight}`)
    if (kb) {
      const root = document.documentElement
      root.style.setProperty('--vv-top', '0px')
      root.style.setProperty('--vv-h', innerHeight - kb + 'px')
      el.classList.remove('sb-mini'); el.classList.add('sb-open')
      void el.offsetHeight
    }
    input.current?.focus({ preventScroll: true })
    setOpen(true)
  }

  const close = () => { setOpen(false); input.current?.blur() }

  // A tap only counts in the panel if the finger went down on that same
  // button and stayed put. The tap that opens search lands on the bar, but on
  // a phone its click can arrive after the panel has appeared and the
  // keyboard has moved things. And where nothing scrolls, Safari can treat
  // a swipe as a tap on whatever button it started on. Taps in the first
  // moment after opening are ignored too.
  const press = useRef<{ x: number; y: number; target: Element | null; moved: boolean }>()
  const openedAt = useRef(0)
  useEffect(() => { if (open) { press.current = undefined; openedAt.current = Date.now() } }, [open])
  const buttonOf = (t: EventTarget | null) => (t as Element | null)?.closest?.('button') ?? null
  const onPanelPointerDown = (e: PointerEvent) => { press.current = { x: e.clientX, y: e.clientY, target: buttonOf(e.target), moved: false } }
  const onPanelPointerMove = (e: PointerEvent) => {
    const p = press.current
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) p.moved = true
  }
  const onPanelPointerCancel = () => { if (press.current) press.current.moved = true }
  const guardClick = (e: MouseEvent) => {
    const button = buttonOf(e.target)
    // Keyboard or assistive tech: the button has focus, no finger involved.
    if (e.detail === 0 && button && button === document.activeElement) return
    const p = press.current
    const ok = p && !p.moved && p.target === button && Date.now() - openedAt.current >= 350
    press.current = undefined
    if (!ok) { e.stopPropagation(); e.preventDefault() }
  }

  // Pull the panel down from its top to close it, like an iOS sheet.
  const pull = useRef<{ y: number; dy: number }>()
  const onPanelTouchStart = (e: TouchEvent) => {
    pull.current = panel.current && panel.current.scrollTop <= 0 ? { y: e.touches[0].clientY, dy: 0 } : undefined
  }
  const onPanelTouchMove = (e: TouchEvent) => {
    const p = pull.current, el = panel.current
    if (!p || !el) return
    p.dy = Math.max(0, e.touches[0].clientY - p.y)
    if (p.dy > 10 && press.current) press.current.moved = true
    if (p.dy > 0 && el.scrollTop <= 0) { el.style.transition = 'none'; el.style.transform = `translateY(${p.dy * .6}px)`; el.style.opacity = String(1 - Math.min(p.dy / 400, .5)) }
  }
  const onPanelTouchEnd = () => {
    const p = pull.current, el = panel.current
    pull.current = undefined
    if (!p || !el) return
    el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''
    if (p.dy > 90) close()
  }
  const finish = (path: string) => { close(); setQ(''); go(path) }
  const searchAll = (query = trimmed) => {
    if (!query) return
    rememberSearch(query); setRecent(loadRecent())
    finish(`search?q=${encodeURIComponent(query)}&v=${version}`)
  }
  const submit = (e: Event) => {
    e.preventDefault()
    if (ref) finish(readPath(version, ref.book, ref.chapter, ref.verse))
    else searchAll()
  }

  return (
    <>
      {open && <div class="sb-scrim" onClick={close} />}
      <div ref={sb} class={'sb' + (open ? ' sb-open' : mini ? ' sb-mini' : '')}>
        {open && (
          <div class="sb-panel" ref={panel} role="listbox" aria-label="Suggestions"
            onTouchStart={onPanelTouchStart} onTouchMove={onPanelTouchMove} onTouchEnd={onPanelTouchEnd} onTouchCancel={onPanelTouchEnd}
            onPointerDownCapture={onPanelPointerDown} onPointerMoveCapture={onPanelPointerMove}
            onPointerCancelCapture={onPanelPointerCancel} onClickCapture={guardClick}>
            {/* A grabber to pull it closed. (Theme and the rest of Settings are
                in the top right corner.) */}
            <div class="sb-head">
              <span class="sb-head-side" />
              <button type="button" class="sb-grabber" aria-label="Close search" onClick={close} />
              <span class="sb-head-side end" />
            </div>
            {preview && (
              <button class="sb-item sb-ref" onClick={() => finish(readPath(version, preview.ref.book, preview.ref.chapter, preview.ref.verse))}>
                <span class="sb-kicker">Go to · {version}</span>
                <span class="sb-title">{formatRef(preview.ref)}</span>
                <span class="sb-verse" dir={t?.rtl ? 'rtl' : undefined}>
                  {preview.lines.map(([n, s]) => <><sup>{n}</sup>{s} </>)}
                </span>
              </button>
            )}
            {books.length > 0 && (
              <div class="sb-books">
                {books.map(b => <button class="sb-chip" onClick={() => finish(readPath(version, b.id, 1))}>{b.name}</button>)}
              </div>
            )}
            {live && live.q === trimmed && (
              <div class="sb-live">
                <div class="sb-kicker">{live.total ? `${live.total.toLocaleString()} ${live.total === 1 ? 'verse' : 'verses'} in ${version}` : `No verses in ${version}`}</div>
                {live.verses.map(v => (
                  <button class="sb-item" onClick={() => finish(readPath(version, v.book, v.chapter, v.verse))}>
                    <span class="sb-title">{formatRef(v)}</span>
                    <span class="sb-verse" dir={t?.rtl ? 'rtl' : undefined}><VerseText raw={v.texts[0]?.text ?? ''} ranges={v.texts[0]?.ranges} /></span>
                  </button>
                ))}
                {live.total > live.verses.length && <button class="sb-more" onClick={() => searchAll()}>See all {live.total.toLocaleString()} results, by book →</button>}
              </div>
            )}
            {!trimmed && chapters > 0 && (
              <div class="sb-chapters">
                <div class="sb-kicker">{bookById(browseBook).name}</div>
                <div class="sb-chapter-row" ref={chapterRow} onWheel={onWheel} onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}
                  onClickCapture={e => { if (drag.current?.moved) { e.stopPropagation(); e.preventDefault() } }}>
                  {Array.from({ length: chapters }, (_, i) => (
                    <button class={'sb-ch' + (here?.book === browseBook && i + 1 === here.chapter ? ' on' : '')}
                      onClick={() => finish(readPath(version, browseBook, i + 1))}>{i + 1}</button>
                  ))}
                </div>
              </div>
            )}
            {!trimmed && (
              <>
                {recent.length > 0 && (
                  <div class="sb-recent">
                    <div class="sb-kicker">Recent searches <button class="link small" onClick={() => { localStorage.removeItem(RECENT); setRecent([]) }}>Clear</button></div>
                    {recent.map(r => <button class="sb-row" onClick={() => searchAll(r)}><Glass small />{r}</button>)}
                  </div>
                )}
                <div class="sb-allbooks">
                  {([['Old Testament', (i: number) => i < 39], ['New Testament', (i: number) => i >= 39 && i < 66], ['Deuterocanon', (i: number) => i >= 66]] as const).map(([label, inGroup]) => {
                    const list = BOOKS.filter((b, i) => inGroup(i) && lens[b.id])
                    return list.length > 0 && (
                      <>
                        <div class="sb-kicker">{label}</div>
                        <div class="sb-bookgrid">
                          {list.map(b => (
                            <button class={'sb-book' + (b.id === browseBook ? ' on' : '')} title={b.name}
                              onClick={() => lens[b.id] === 1 ? finish(readPath(version, b.id, 1)) : setBrowse(b.id)}>{b.abbr}</button>
                          ))}
                        </div>
                      </>
                    )
                  })}
                </div>
                <div class="sb-tips">
                  <div class="sb-kicker">Try</div>
                  {['John 3:16', '"born again"', 'love NEAR/5 neighbour', 'H430', 'grace in:pauline'].map(x => (
                    <button class="sb-chip" onClick={() => setQ(x)}>{x}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div class="sb-bar">
        <form class="sb-field" onSubmit={submit} role="search">
          <Glass />
          <input ref={input} type="search" enterKeyHint={ref ? 'go' : 'search'} value={q} aria-label={mini && !open ? 'Search' : `Search ${version} or go to a passage`}
            placeholder={here && !open ? `${shortName(here.book)} ${here.chapter} · ${version}` : `Search ${version} or John 3:16`}
            onFocus={() => setOpen(true)} onTouchStart={onFieldTouchStart} onTouchEnd={onFieldTouchEnd} onInput={e => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === 'Escape') close() }} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellcheck={false} />
          {q && <button type="button" class="sb-clear" aria-label="Clear" onClick={() => { setQ(''); input.current?.focus() }}>✕</button>}
        </form>
        {/* Circles, then prayer, always one tap away just right of search.
            🙏 opens the glowing microphone over the page. */}
        {!open && SYNC_URL && <CirclesButton />}
        {!open && <PrayButton />}
        {open && <button type="button" class="sb-cancel" onClick={close}>Cancel</button>}
        </div>
      </div>
    </>
  )
}

// On Android the keyboard shrinks the app's window as it rises, and for a
// moment the gap shows the window behind the page, a light cream (the
// manifest's background), which flashed white under the keyboard in Dark.
// While search is open, Chrome is asked to lay the keyboard over the page
// instead (the VirtualKeyboard API; iPhone has none and is unaffected), so
// what is behind it is the dimmed page. Elsewhere, fields such as notes still
// get the usual resize; it is handed back only once the keyboard has
// finished sliding down, so it doesn't flash on the way down either.
type VK = EventTarget & { overlaysContent: boolean; boundingRect: DOMRect }
const vkApi = !isIOS && typeof navigator !== 'undefined' && matchMedia('(pointer: coarse)').matches
  ? (navigator as Navigator & { virtualKeyboard?: VK }).virtualKeyboard : undefined
let vkRelease = 0, vkDown: (() => void) | undefined
function overlayKeyboard(on: boolean): VK | undefined {
  const vk = vkApi
  if (!vk) return
  const settle = () => {
    clearTimeout(vkRelease)
    if (vkDown) vk.removeEventListener('geometrychange', vkDown)
    vkDown = undefined
  }
  settle()
  if (on) { vk.overlaysContent = true; return vk }
  const off = () => { settle(); vk.overlaysContent = false }
  // Chrome can report the keyboard gone as it starts to slide away.
  const soon = () => { clearTimeout(vkRelease); vkRelease = window.setTimeout(off, 700) }
  vkDown = () => { if (!vk.boundingRect.height) soon() }
  vk.addEventListener('geometrychange', vkDown)
  if (!vk.boundingRect.height) soon()
  else vkRelease = window.setTimeout(off, 2000)
}

// The keyboard's height on this phone, per screen size and orientation.
const KEYBOARD = 'plain-bible:keyboard'
function keyboardHeight(key: string): number {
  try {
    const kb = JSON.parse(localStorage.getItem(KEYBOARD) || '{}')[key]
    if (kb) return kb
  } catch { /* ignore */ }
  // First time on a phone held upright: about what an iPhone keyboard takes.
  return innerWidth < 600 && innerHeight > innerWidth ? Math.round(innerHeight * .41) : 0
}
function rememberKeyboard(key: string, kb: number) {
  try {
    const all = JSON.parse(localStorage.getItem(KEYBOARD) || '{}')
    all[key] = Math.round(kb)
    localStorage.setItem(KEYBOARD, JSON.stringify(all))
  } catch { /* ignore */ }
}

function Glass({ small }: { small?: boolean }) {
  const s = small ? 14 : 19
  return (
    <svg class="sb-glass" viewBox="0 0 24 24" width={s} height={s} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2.2" fill="none" />
      <path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    </svg>
  )
}
