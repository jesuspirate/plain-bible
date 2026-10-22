// Floating search bar at the bottom of the screen, in the style of the iOS
// search field. Tapping it opens a panel with instant results: a reference
// jump with the verse itself, matching books, live search hits, and recent
// searches. It tucks away while scrolling down and returns on scroll up.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BOOKS } from './lib/books'
import { parseRef, formatRef, Ref } from './lib/refs'
import { plain } from './lib/text'
import { call } from './searchClient'
import type { PageResponse, PageVerse, SearchResponse } from './search.worker'
import { go, readPath, useApp } from './state'
import { VerseText } from './ui'

const RECENT = 'plain-bible:recent'
const loadRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]') } catch { return [] } }
export function rememberSearch(q: string) {
  const list = [q, ...loadRecent().filter(x => x !== q)].slice(0, 8)
  try { localStorage.setItem(RECENT, JSON.stringify(list)) } catch { /* ignore */ }
}

type Recognition = { lang: string; interimResults: boolean; start(): void; stop(): void; onresult: (e: any) => void; onend: () => void; onerror: () => void }
const SpeechRecognition: (new () => Recognition) | undefined =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined

export function SearchBar() {
  const { settings, data, byId } = useApp()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [listening, setListening] = useState(false)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [live, setLive] = useState<{ q: string; total: number; verses: PageVerse[] }>()
  const [preview, setPreview] = useState<{ ref: Ref; lines: [number, string][] }>()
  const input = useRef<HTMLInputElement>(null)
  const recognizer = useRef<Recognition>()
  const version = settings.version
  const t = byId.get(version)

  // Hide while scrolling down, show again when scrolling up.
  useEffect(() => {
    let last = scrollY
    const on = () => {
      const y = scrollY
      if (Math.abs(y - last) < 8) return
      setHidden(y > last && y > 120)
      last = y
    }
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [])

  // "/" or Cmd/Ctrl+K focuses the bar.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select, dialog')
      if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault(); setHidden(false); input.current?.focus()
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
    r.onerror = () => setListening(false)
    recognizer.current = r
    setListening(true); setOpen(true)
    r.start()
  }

  return (
    <>
      {open && <div class="sb-scrim" onClick={close} />}
      <div class={'sb' + (open ? ' sb-open' : '') + (hidden && !open ? ' sb-hidden' : '')}>
        {open && (
          <div class="sb-panel" role="listbox" aria-label="Suggestions">
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
            {!trimmed && (
              <>
                {recent.length > 0 && (
                  <div class="sb-recent">
                    <div class="sb-kicker">Recent <button class="link small" onClick={() => { localStorage.removeItem(RECENT); setRecent([]) }}>Clear</button></div>
                    {recent.map(r => <button class="sb-row" onClick={() => searchAll(r)}><Glass small />{r}</button>)}
                  </div>
                )}
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
        <form class="sb-field" onSubmit={submit} role="search">
          <Glass />
          <input ref={input} type="search" enterKeyHint={ref ? 'go' : 'search'} value={q} aria-label={`Search ${version} or go to a passage`}
            placeholder={listening ? 'Listening…' : `Search ${version} or go to John 3:16`}
            onFocus={() => setOpen(true)} onInput={e => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === 'Escape') close() }} autoComplete="off" autoCorrect="off" spellcheck={false} />
          {q && <button type="button" class="sb-clear" aria-label="Clear" onClick={() => { setQ(''); input.current?.focus() }}>✕</button>}
          {SpeechRecognition && (
            <button type="button" class={'sb-mic' + (listening ? ' on' : '')} aria-label={listening ? 'Stop dictation' : 'Search by voice'} onClick={toggleMic}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" /></svg>
            </button>
          )}
          {open && <button type="button" class="sb-cancel" onClick={close}>Cancel</button>}
        </form>
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
