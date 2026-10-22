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
import { go, readPath, resumePath, useApp } from './state'
import { loadTrail, stepTo, Trail } from './lib/history'
import { VerseText } from './ui'

const RECENT = 'plain-bible:recent'
const loadRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]') } catch { return [] } }
export function rememberSearch(q: string) {
  const list = [q, ...loadRecent().filter(x => x !== q)].slice(0, 8)
  try { localStorage.setItem(RECENT, JSON.stringify(list)) } catch { /* ignore */ }
}

type Recognition = { lang: string; interimResults: boolean; start(): void; stop(): void; onresult: (e: any) => void; onend: () => void; onerror: (e: any) => void }
// iPhone and iPad expose speech recognition but refuse it inside home-screen
// apps; their keyboard has its own dictation key, so we leave voice to that.
const IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
const MIC_OFF = 'plain-bible:mic-off'
const micBroken = () => { try { return localStorage.getItem(MIC_OFF) === '1' } catch { return false } }
const SpeechRecognition: (new () => Recognition) | undefined =
  typeof window !== 'undefined' && !IOS ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined

export function SearchBar({ here }: { here?: { version: string; book: string; chapter: number } }) {
  const { settings, data, byId } = useApp()
  // Chapter counts per book in the current version, for the book and chapter browser.
  const [lens, setLens] = useState<Record<string, number>>({})
  const [browse, setBrowse] = useState<string>()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [micOk, setMicOk] = useState(() => !!SpeechRecognition && !micBroken())
  const [micNote, setMicNote] = useState('')
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [trail, setTrail] = useState<Trail>()
  const [showRead, setShowRead] = useState(false)
  const [live, setLive] = useState<{ q: string; total: number; verses: PageVerse[] }>()
  const [preview, setPreview] = useState<{ ref: Ref; lines: [number, string][] }>()
  const input = useRef<HTMLInputElement>(null)
  const recognizer = useRef<Recognition>()
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
  useEffect(() => { if (!open) { setBrowse(undefined); setShowRead(false) } else setTrail(loadTrail()) }, [open])
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

  const close = () => { setOpen(false); input.current?.blur() }
  const parallelOf = () => new URLSearchParams(location.hash.split('?')[1] || '').get('p')?.split(',') ?? []

  // Pull the panel down from its top to close it, like an iOS sheet.
  const pull = useRef<{ y: number; dy: number }>()
  const onPanelTouchStart = (e: TouchEvent) => {
    pull.current = panel.current && panel.current.scrollTop <= 0 ? { y: e.touches[0].clientY, dy: 0 } : undefined
  }
  const onPanelTouchMove = (e: TouchEvent) => {
    const p = pull.current, el = panel.current
    if (!p || !el) return
    p.dy = Math.max(0, e.touches[0].clientY - p.y)
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

  const toggleMic = () => {
    if (!SpeechRecognition) return
    if (listening) { recognizer.current?.stop(); return }
    const r = new SpeechRecognition()
    r.lang = navigator.language || 'en-US'
    r.interimResults = true
    r.onresult = (e: any) => setQ(Array.from(e.results).map((x: any) => x[0].transcript).join(''))
    r.onend = () => setListening(false)
    r.onerror = (e: any) => {
      setListening(false)
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        setMicNote('Voice input is blocked here. Allow the microphone for this site, or use your keyboard’s dictation key.')
        if (e.error === 'service-not-allowed') { try { localStorage.setItem(MIC_OFF, '1') } catch { /* ignore */ } setMicOk(false) }
      } else if (e?.error === 'no-speech') setMicNote('Didn’t catch that. Tap the mic and try again.')
      else if (e?.error !== 'aborted') setMicNote('Voice input isn’t working in this browser right now.')
    }
    recognizer.current = r
    setMicNote(''); setListening(true); setOpen(true)
    try { r.start() } catch { setListening(false); setMicNote('Voice input isn’t available in this browser.') }
  }

  return (
    <>
      {open && <div class="sb-scrim" onClick={close} />}
      <div class={'sb' + (open ? ' sb-open' : '') + ''}>
        {open && (
          <div class="sb-panel" ref={panel} role="listbox" aria-label="Suggestions"
            onTouchStart={onPanelTouchStart} onTouchMove={onPanelTouchMove} onTouchEnd={onPanelTouchEnd} onTouchCancel={onPanelTouchEnd}>
            <button type="button" class="sb-grabber" aria-label="Close search" onClick={close} />
            {micNote && <p class="sb-note">{micNote}</p>}
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
                {trail && trail.items.length > 1 && (
                  // Folded to one quiet line; tap to see the places.
                  <div class="sb-books sb-read">
                    <button class="sb-fold" aria-expanded={showRead} onClick={() => setShowRead(x => !x)}>
                      Recently read <span aria-hidden="true">{showRead ? '▴' : '▾'}</span>
                    </button>
                    {showRead && trail.items.map((_, i) => i).reverse().filter(i => !(here && trail.items[i].book === here.book && trail.items[i].chapter === here.chapter)).slice(0, 8).map(i => {
                      const p = trail.items[i]
                      return <button class="sb-chip" onClick={() => { stepTo(i); finish(resumePath(version, p.book, p.chapter, p.verse, here ? parallelOf() : [])) }}>
                        {formatRef({ book: p.book, chapter: p.chapter, verse: p.verse > 1 ? p.verse : undefined }, true)}</button>
                    })}
                  </div>
                )}
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
          <input ref={input} type="search" enterKeyHint={ref ? 'go' : 'search'} value={q} aria-label={`Search ${version} or go to a passage`}
            placeholder={listening ? 'Listening…' : here && !open ? `${bookById(here.book).name} ${here.chapter} · ${version}` : `Search ${version} or John 3:16`}
            onFocus={() => setOpen(true)} onInput={e => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === 'Escape') close() }} autoComplete="off" autoCorrect="off" spellcheck={false} />
          {q && <button type="button" class="sb-clear" aria-label="Clear" onClick={() => { setQ(''); input.current?.focus() }}>✕</button>}
          {micOk && (
            <button type="button" class={'sb-mic' + (listening ? ' on' : '')} aria-label={listening ? 'Stop dictation' : 'Search by voice'} onClick={toggleMic}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" /></svg>
            </button>
          )}
        </form>
        {open && <button type="button" class="sb-cancel" onClick={close}>Cancel</button>}
        </div>
      </div>
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
