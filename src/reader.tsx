import { useEffect, useRef, useState } from 'preact/hooks'
import { BOOKS, BOOK_INDEX, bookById } from './lib/books'
import { Bible } from './lib/data'
import { formatRef } from './lib/refs'
import { loadPlace, savePlace, withoutVerse } from './lib/place'
import { markKey, PALETTE, setNote, tidy } from './lib/marks'
import { plain } from './lib/text'
import { canShare, copyText, share, shareLink, tap } from './lib/native'
import { go, readPath, Route, useApp } from './state'
import { LexiconSheet, Sheet, VerseText } from './ui'

export function Reader({ route }: { route: Route }) {
  const { settings, update, byId, data, marks } = useApp()
  const [, , bookParam, chParam] = route.path
  const version = byId.has(route.path[1]) ? route.path[1] : settings.version
  const book = bookParam && BOOK_INDEX[bookParam] !== undefined ? bookParam : 'Gen'
  const chapter = Math.max(1, +chParam || 1)
  const target = +(route.params.get('v') || 0)
  const parallel = (route.params.get('p')?.split(',') ?? settings.parallel).filter(id => byId.has(id) && id !== version)
  const versions = [version, ...parallel]

  const [bibles, setBibles] = useState<Record<string, Bible>>({})
  const [error, setError] = useState('')
  const [lex, setLex] = useState<string>()
  const [selected, setSelected] = useState<number[]>([])
  const [noteFor, setNoteFor] = useState<number>()

  useEffect(() => {
    if (version !== settings.version || parallel.join() !== settings.parallel.join()) update({ version, parallel })
    setError('')
    Promise.all(versions.map(v => data.bible(v)))
      .then(bs => setBibles(Object.fromEntries(bs.map(b => [b.id, b]))))
      .catch(e => setError(String(e.message || e)))
  }, [versions.join()])

  const loaded = versions.every(v => bibles[v])

  // The verse at the top of the screen is saved as you read, so the app
  // reopens on it, and stays put when you switch versions or text size.
  const topVerse = useRef(0)
  const here = useRef({ book, chapter })
  here.current = { book, chapter }
  // While a version loads the page is briefly empty and jumps to the top;
  // that's not you scrolling, so it isn't counted until your verse is back.
  const settling = useRef(true)
  if (!loaded) settling.current = true
  useEffect(() => {
    let frame = 0, timer = 0
    const save = () => {
      clearTimeout(timer)
      if (!topVerse.current) return
      savePlace({ ...here.current, verse: topVerse.current })
      // From here on the address leads to where you are, not to a verse you
      // jumped to, so a reload or a restored tab lands on the right verse.
      if (/[?&]v=/.test(location.hash)) history.replaceState(history.state, '', withoutVerse(location.hash))
    }
    const measure = () => {
      frame = 0
      if (settling.current) return
      const top = headerBottom()
      // Ignore the moment between chapters or versions when no verses show.
      const els = [...document.querySelectorAll<HTMLElement>('.chapter [id^="v"]')]
      for (let i = 0; i < els.length; i++) {
        const lines = els[i].getClientRects()
        if (!lines.length || lines[lines.length - 1].bottom <= top + 12) continue
        let n = +els[i].id.slice(1)
        // In paragraph layout, when only a verse's last words share the top
        // line with the next verse, the next verse is the one you're on.
        const first = lines[0], last = lines[lines.length - 1], next = els[i + 1]?.getClientRects()[0]
        if (first.bottom <= top + 12 && last.top <= top + 12 && next && Math.abs(next.top - last.top) < 2) n = +els[i + 1].id.slice(1)
        if (n !== topVerse.current) { topVerse.current = n; clearTimeout(timer); timer = window.setTimeout(save, 300) }
        return
      }
    }
    const onScroll = () => { frame ||= requestAnimationFrame(measure) }
    const onHide = (e: Event) => { if (e.type === 'pagehide' || document.visibilityState !== 'visible') save() }
    addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onHide)
    addEventListener('pagehide', onHide)
    return () => {
      save(); cancelAnimationFrame(frame)
      removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onHide)
      removeEventListener('pagehide', onHide)
    }
  }, [])

  const shown = useRef<{ book: string; chapter: number; target: number }>()
  useEffect(() => {
    document.title = `${formatRef({ book, chapter })} (${version}) · Plain Bible`
    if (!loaded) return
    const prev = shown.current
    shown.current = { book, chapter, target }
    const same = prev && prev.book === book && prev.chapter === chapter
    if (!same) topVerse.current = 0
    requestAnimationFrame(() => {
      // Same chapter, different version, columns, layout or text size: keep your verse.
      if (same && prev.target === target) toVerse(topVerse.current)
      else if (target) document.getElementById('v' + target)?.scrollIntoView({ block: 'center' })
      // Opening the app, or coming back from Settings: the verse you were on.
      else if (!prev) { const p = loadPlace(); toVerse(p && p.book === book && p.chapter === chapter ? p.verse : 1) }
      else window.scrollTo(0, 0)
      settling.current = false
    })
  }, [book, chapter, version, target, loaded, versions.join(), settings.layout, settings.fontSize, settings.font])

  useEffect(() => setSelected([]), [book, chapter, version])

  const nav = (b: string, c: number, v?: number) => go(readPath(version, b, c, v, parallel))
  const primary = bibles[version]
  const chapterCount = (b: string) => primary?.books[b]?.length ?? 0
  const step = (dir: 1 | -1) => {
    if (!primary) return
    if (dir === 1 && chapter < chapterCount(book)) return nav(book, chapter + 1)
    if (dir === -1 && chapter > 1) return nav(book, chapter - 1)
    const order = BOOKS.filter(b => primary.books[b.id])
    const i = order.findIndex(b => b.id === book) + dir
    if (i >= 0 && i < order.length) nav(order[i].id, dir === 1 ? 1 : chapterCount(order[i].id))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, dialog')) return
      if (e.key === 'ArrowRight') turn(1)
      if (e.key === 'ArrowLeft') turn(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const mark = (v: number) => marks[markKey(book, chapter, v)]
  const verseClass = (base: string, v: number) =>
    base + (target === v ? ' target' : '') + (mark(v)?.c ? ' hl' : '') + (mark(v)?.b ? ' bm' : '') + (selected.includes(v) ? ' picked' : '')
  // A small note icon after the verse number; tap it to read or edit the note.
  const noteMark = (v: number) => mark(v)?.n && (
    <button class="note-mark" aria-label={`Note on verse ${v}`} title={mark(v)!.n} onClick={e => { e.stopPropagation(); setNoteFor(v) }}>
      <svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /><path d="M5.5 8h5M5.5 10.5h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
    </button>
  )
  const hlStyle = (v: number) => mark(v)?.c ? { '--hl': mark(v)!.c } : undefined
  const tapVerse = (e: MouseEvent, v: number) => {
    if ((e.target as HTMLElement).closest('.w') && settings.strongs) return
    if (String(getSelection() ?? '').trim()) return
    setSelected(s => s.includes(v) ? s.filter(x => x !== v) : [...s, v].sort((a, b) => a - b))
  }
  // Swipe left/right to change chapter: the page follows the finger, then
  // slides out, and the next chapter slides in from the other side.
  const article = useRef<HTMLElement>(null)
  const touch = useRef<{ x: number; y: number; t: number; axis?: 'x' | 'y'; dx: number }>()
  const [enter, setEnter] = useState<'' | 'next' | 'prev'>('')
  const turn = (dir: 1 | -1) => { setEnter(dir === 1 ? 'next' : 'prev'); step(dir) }
  const setDrag = (dx: number, ms = 0) => {
    const el = article.current
    if (!el) return
    el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, .8, .2, 1), opacity ${ms}ms` : 'none'
    el.style.transform = dx ? `translateX(${dx}px)` : ''
    el.style.opacity = dx ? String(1 - Math.min(Math.abs(dx) / innerWidth, .6)) : ''
  }
  const onTouchStart = (e: TouchEvent) => { const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY, t: Date.now(), dx: 0 } }
  const onTouchMove = (e: TouchEvent) => {
    const s = touch.current, p = e.touches[0]
    if (!s || e.touches.length > 1) return
    const dx = p.clientX - s.x, dy = p.clientY - s.y
    if (!s.axis && Math.hypot(dx, dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
    if (s.axis === 'x') { s.dx = dx; setDrag(dx * .85) }
  }
  const onTouchEnd = () => {
    const s = touch.current
    touch.current = undefined
    if (!s || s.axis !== 'x') return
    const fast = Date.now() - s.t < 300 && Math.abs(s.dx) > 40
    if (Math.abs(s.dx) > innerWidth * .25 || fast) {
      const dir = s.dx < 0 ? 1 : -1
      setDrag(-dir * innerWidth * .5, 160)
      const el = article.current
      setTimeout(() => {
        turn(dir)
        // Nowhere to go (start or end of the Bible): bring the page back.
        setTimeout(() => { if (article.current === el) setDrag(0, 220) }, 120)
      }, 150)
    } else setDrag(0, 220)
  }

  // Two-finger swipe on a trackpad does the same as a touch swipe.
  const wheel = useRef({ dx: 0, done: false, timer: 0 })
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const w = wheel.current
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) && !w.dx && !w.done) return
      if ((e.target as HTMLElement).closest?.('.sb, dialog, .selbar, .sb-chapter-row')) return
      e.preventDefault()
      clearTimeout(w.timer)
      // A gesture ends when the events (including the trackpad's glide) stop.
      w.timer = window.setTimeout(() => { if (!w.done) setDrag(0, 220); w.dx = 0; w.done = false }, 160)
      if (w.done) return
      w.dx -= e.deltaX
      setDrag(w.dx * .85)
      if (Math.abs(w.dx) > Math.min(innerWidth * .25, 160)) {
        w.done = true
        const dir = w.dx < 0 ? 1 : -1, el = article.current
        setDrag(-dir * Math.min(innerWidth * .5, 320), 160)
        setTimeout(() => { turn(dir); setTimeout(() => { if (article.current === el) setDrag(0, 220) }, 120) }, 150)
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  })

  const rows = loaded ? Math.max(...versions.map(v => bibles[v].books[book]?.[chapter - 1]?.length ?? 0)) : 0
  const showStrongs = settings.strongs
  const t = byId.get(version)

  return (
    <div class="reader">
      {error && <p class="error">{error}</p>}
      {!loaded && !error && <p class="muted center">Loading…</p>}
      {loaded && rows === 0 && <p class="muted center">{t?.name} does not include {bookById(book).name} {chapter}.</p>}

      {loaded && rows > 0 && (
        <article key={`${book}.${chapter}`} ref={article} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
          onAnimationEnd={() => setEnter('')} class={`chapter ${settings.layout} cols-${versions.length}${enter ? ' enter-' + enter : ''}`} style={{ '--cols': versions.length }}>
          <h1 class="chapter-title">{bookById(book).name} {chapter}</h1>
          {versions.length > 1 && (
            <div class="vrow-head">{versions.map(v => <div class="colhead" title={byId.get(v)?.name}>{v}</div>)}</div>
          )}
          {versions.length === 1 && settings.layout === 'paragraph' ? (
            <p class="para" dir={t?.rtl ? 'rtl' : undefined}>
              {primary.books[book][chapter - 1].map((raw, i) => raw && (
                <span id={'v' + (i + 1)} class={verseClass('pv', i + 1)} style={hlStyle(i + 1)} onClick={e => tapVerse(e, i + 1)}>
                  <sup class="vn">{i + 1}</sup>{noteMark(i + 1)}
                  <VerseText raw={raw} strongs={showStrongs} numbers={settings.strongsNumbers} onStrongs={setLex} />{' '}
                </span>
              ))}
            </p>
          ) : Array.from({ length: rows }, (_, i) => (
            <div id={'v' + (i + 1)} class={verseClass('verse', i + 1)} style={hlStyle(i + 1)} onClick={e => tapVerse(e, i + 1)}>
              {versions.map(v => {
                const raw = bibles[v].books[book]?.[chapter - 1]?.[i]
                const tv = byId.get(v)
                return (
                  <div class="cell" dir={tv?.rtl ? 'rtl' : undefined} lang={tv?.lang}>
                    <button class="vn" aria-label={`Verse ${i + 1} options`}>{i + 1}</button>{v === version && noteMark(i + 1)}
                    {raw ? <VerseText raw={raw} strongs={showStrongs} numbers={settings.strongsNumbers} onStrongs={setLex} /> : <span class="muted">—</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </article>
      )}

      <nav class="pager">
        <button onClick={() => turn(-1)}>← Previous</button>
        <button onClick={() => turn(1)}>Next →</button>
      </nav>
      {t && <p class="credit muted small">{t.name}. {t.license}.</p>}

      {lex && <LexiconSheet num={lex} onClose={() => setLex(undefined)} onSearch={n => { setLex(undefined); go(`search?q=${n}&v=${versions.filter(v => byId.get(v)?.strongs).join(',') || 'KJV'}`) }} />}
      {selected.length > 0 && <SelectionBar book={book} chapter={chapter} verses={selected} versions={versions} bibles={bibles} onClose={() => setSelected([])}
        onNote={v => { setSelected([]); setNoteFor(v) }} />}
      {noteFor && <NoteSheet book={book} chapter={chapter} verse={noteFor} text={plain(primary?.books[book]?.[chapter - 1]?.[noteFor - 1] ?? '')} onClose={() => setNoteFor(undefined)} />}
    </div>
  )
}

function headerBottom() {
  return document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0
}

/** Scrolls so verse `v` sits just under the top bar (verse 1: the top of the page). */
function toVerse(v: number) {
  const el = v > 1 && document.getElementById('v' + v)
  if (!el) return window.scrollTo(0, 0)
  const place = () => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - headerBottom() - 4)
  place()
  // The reading font may still be loading; once it has, line up again
  // (unless you've already scrolled on).
  const y = scrollY
  document.fonts?.ready.then(() => { if (Math.abs(scrollY - y) < 2) place() })
}

/** "16–18, 20" for a sorted list of verse numbers. */
export function verseRanges(vs: number[]) {
  const out: string[] = []
  for (let i = 0; i < vs.length; i++) {
    let j = i
    while (j + 1 < vs.length && vs[j + 1] === vs[j] + 1) j++
    out.push(i === j ? `${vs[i]}` : `${vs[i]}–${vs[j]}`)
    i = j
  }
  return out.join(', ')
}

// Shown while verses are selected: tap more verses to add them, then
// highlight, bookmark, copy, share or compare them together.
function SelectionBar({ book, chapter, verses, versions, bibles, onClose, onNote }: {
  book: string; chapter: number; verses: number[]; versions: string[]; bibles: Record<string, Bible>; onClose: () => void; onNote: (v: number) => void
}) {
  const { settings, byId, data, marks, setMarks } = useApp()
  const [compare, setCompare] = useState<Bible[]>()
  const [note, setNote] = useState('')
  const version = versions[0]
  const keys = verses.map(v => markKey(book, chapter, v))
  const ref = `${bookById(book).name} ${chapter}:${verseRanges(verses)}`
  const colors = new Set(keys.map(k => marks[k]?.c).filter(Boolean))
  const current = colors.size === 1 && keys.every(k => marks[k]?.c) ? [...colors][0] : undefined
  const allBookmarked = keys.every(k => marks[k]?.b)

  useEffect(() => {
    document.body.classList.add('selecting')
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => { document.body.classList.remove('selecting'); removeEventListener('keydown', onKey) }
  }, [])

  const apply = (patch: { c?: string | null; b?: 1 | null }) => { tap(); setMarks(all => {
    const out = { ...all }, t = Date.now()
    for (const key of keys) {
      const next = { ...all[key], t } as Record<string, unknown>
      for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v }
      if (patch.c) next.v = version
      out[key] = tidy(next as never)
    }
    return out
  }) }
  const textOf = (b: Bible | undefined) => verses.length === 1
    ? plain(b?.books[book]?.[chapter - 1]?.[verses[0] - 1] ?? '')
    : verses.map(v => { const raw = b?.books[book]?.[chapter - 1]?.[v - 1]; return raw ? `${v} ${plain(raw)}` : '' }).filter(Boolean).join(' ')
  const quote = `${textOf(bibles[version])}\n${ref} (${version})`
  const link = shareLink(`#/${readPath(version, book, chapter, verses[0])}`)
  const copy = async (s: string) => {
    try { await copyText(s); setNote('Copied') } catch { setNote('Copy failed') }
  }
  const showCompare = () => {
    const ids = settings.myVersions.filter(id => byId.get(id)?.books.includes(book))
    Promise.all(ids.map(id => data.bible(id))).then(setCompare)
  }

  return (
    <>
      <div class="selbar" role="toolbar" aria-label={`${ref} selected`}>
        <div class="selbar-head">
          <strong>{ref}</strong>
          <span class="muted small">{verses.length > 1 ? `${verses.length} verses` : 'Tap more verses to add them'}</span>
          <span class="spacer" />
          <button class="icon" aria-label="Clear selection" onClick={onClose}>✕</button>
        </div>
        <div class="swatches" role="radiogroup" aria-label="Highlight color">
          {PALETTE.map(p => (
            <button role="radio" aria-checked={current === p.color} aria-label={p.name} class={'swatch' + (current === p.color ? ' on' : '')}
              style={{ background: p.color }} onClick={() => { apply({ c: current === p.color ? null : p.color }); onClose() }} />
          ))}
          {colors.size > 0 && <button class="swatch none" aria-label="Remove highlight" onClick={() => { apply({ c: null }); onClose() }}>✕</button>}
        </div>
        <div class="row actions">
          <button class={allBookmarked ? 'on' : ''} onClick={() => { apply({ b: allBookmarked ? null : 1 }); onClose() }}>{allBookmarked ? '🔖 Saved' : '🔖 Bookmark'}</button>
          <button onClick={() => copy(quote)}>Copy</button>
          {canShare
            ? <button onClick={() => share({ title: ref, text: quote, url: link })}>Share</button>
            : <button onClick={() => copy(link)}>Link</button>}
          <button onClick={showCompare}>Compare</button>
          <button class={marks[keys[0]]?.n ? 'on' : ''} onClick={() => onNote(verses[0])}>Note</button>
        </div>
        {note && <p class="muted small selbar-note">{note}</p>}
      </div>
      {compare && (
        <Sheet title={ref} onClose={() => setCompare(undefined)}>
          <dl class="compare">
            {compare.map(b => (
              <>
                <dt>{b.id} <span class="muted small">{byId.get(b.id)?.name}</span></dt>
                <dd dir={byId.get(b.id)?.rtl ? 'rtl' : undefined}>{textOf(b) || <span class="muted">—</span>}</dd>
              </>
            ))}
          </dl>
        </Sheet>
      )}
    </>
  )
}

/** Write, edit or delete the note on one verse. Saved as you type. */
export function NoteSheet({ book, chapter, verse, text, onClose }: { book: string; chapter: number; verse: number; text?: string; onClose: () => void }) {
  const { marks, setMarks } = useApp()
  const key = markKey(book, chapter, verse)
  const [draft, setDraft] = useState(marks[key]?.n ?? '')
  const area = useRef<HTMLTextAreaElement>(null)
  const saved = useRef(marks[key]?.n ?? '')
  const save = (s: string) => {
    if (s.trim() === saved.current.trim()) return
    saved.current = s
    setMarks(m => setNote(m, key, s))
  }
  useEffect(() => { if (!draft) area.current?.focus() }, [])
  useEffect(() => { const t = setTimeout(() => save(draft), 600); return () => clearTimeout(t) }, [draft])
  const close = () => { save(draft); onClose() }
  return (
    <Sheet title={`Note · ${formatRef({ book, chapter, verse })}`} onClose={close}>
      {text && <p class="note-verse muted">{text}</p>}
      <textarea ref={area} class="note-text" rows={6} placeholder="Write a note on this verse…" value={draft}
        onInput={e => setDraft((e.target as HTMLTextAreaElement).value)} />
      <div class="row">
        <button class="primary" onClick={close}>Done</button>
        {saved.current && <button onClick={() => { setDraft(''); save(''); onClose() }}>Delete note</button>}
      </div>
    </Sheet>
  )
}
