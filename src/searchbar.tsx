// Floating search bar at the bottom of the screen, in the style of the iOS
// search field. Tapping it opens a panel with instant results: a reference
// jump with the verse itself, matching books, live search hits, and recent
// searches, and the chapters of the book you are reading. It stays pinned
// while you read, showing where you are.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BOOKS, bookById } from './lib/books'
import { parseRef, formatRef, Ref } from './lib/refs'
import { plain } from './lib/text'
import { call } from './searchClient'
import type { PageResponse, PageVerse, SearchResponse } from './search.worker'
import { go, openPrayer, readPath, useApp } from './state'
import { ThemeToggle, VerseText } from './ui'
import { SettingsSheet } from './settings'

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
  // Settings rise as a sheet out of the open panel; pulling them down goes back to it.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [live, setLive] = useState<{ q: string; total: number; verses: PageVerse[] }>()
  const [preview, setPreview] = useState<{ ref: Ref; lines: [number, string][] }>()
  const input = useRef<HTMLInputElement>(null)
  const version = here?.version ?? settings.version
  const t = byId.get(version)

  const chapterRow = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // While open, pin the bar and panel to the visible part of the screen, so
  // the iPhone keyboard doesn't push the page around or cut the panel off.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement, vv = window.visualViewport
    const fit = () => {
      if (!vv) return
      root.style.setProperty('--vv-top', vv.offsetTop + 'px')
      root.style.setProperty('--vv-h', vv.height + 'px')
    }
    fit()
    root.classList.add('sb-lock')
    vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit)
    return () => {
      root.classList.remove('sb-lock')
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

  const close = () => { setOpen(false); setSettingsOpen(false); input.current?.blur() }

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
      <div class={'sb' + (open ? ' sb-open' : mini ? ' sb-mini' : '')}>
        {open && (
          <div class="sb-panel" ref={panel} role="listbox" aria-label="Suggestions"
            onTouchStart={onPanelTouchStart} onTouchMove={onPanelTouchMove} onTouchEnd={onPanelTouchEnd} onTouchCancel={onPanelTouchEnd}
            onPointerDownCapture={onPanelPointerDown} onPointerMoveCapture={onPanelPointerMove}
            onPointerCancelCapture={onPanelPointerCancel} onClickCapture={guardClick}>
            {/* Settings at the top, in sight the moment search opens. With the
                small round button, the theme toggle sits here too. */}
            <div class="sb-head">
              <span class="sb-head-side">{mini && <ThemeToggle class="sb-head-btn sb-head-icon" />}</span>
              <button type="button" class="sb-grabber" aria-label="Close search" onClick={close} />
              <span class="sb-head-side end">
                <button type="button" class="sb-head-btn" onClick={() => { input.current?.blur(); setSettingsOpen(true) }}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" /></svg>
                  <span>Settings</span>
                </button>
              </span>
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
            placeholder={here && !open ? `${bookById(here.book).name} ${here.chapter} · ${version}` : `Search ${version} or John 3:16`}
            onFocus={() => setOpen(true)} onInput={e => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === 'Escape') close() }} autoComplete="off" autoCorrect="off" spellcheck={false} />
          {q && <button type="button" class="sb-clear" aria-label="Clear" onClick={() => { setQ(''); input.current?.focus() }}>✕</button>}
          {/* Light, sepia, dark: always one tap away, right in the bar. */}
          {!open && !mini && <ThemeToggle class="sb-theme" />}
          {/* Prayer, always one tap away: opens the glowing microphone over the page. */}
          {!open && !mini && (
            <button type="button" class="sb-pray" aria-label="Pray" title="Pray" onClick={openPrayer}>
              <span class="sb-pray-emoji" aria-hidden="true">{'🙏' + settings.prayTone}</span>
            </button>
          )}
        </form>
        {/* With the bar hidden, prayer gets its own round button above search. */}
        {mini && !open && <button type="button" class="sb-pray" aria-label="Pray" title="Pray" onClick={openPrayer}><span class="sb-pray-emoji" aria-hidden="true">{'🙏' + settings.prayTone}</span></button>}
        {open && <button type="button" class="sb-cancel" onClick={close}>Cancel</button>}
        </div>
      </div>
      {open && settingsOpen && <SettingsSheet onBack={() => setSettingsOpen(false)} onDone={() => { close(); setQ('') }} />}
    </>
  )
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
