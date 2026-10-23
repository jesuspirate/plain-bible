import { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { BOOKS, BOOK_INDEX, bookById } from './lib/books'
import { Bible } from './lib/data'
import { formatRef } from './lib/refs'
import { loadPlace, savePlace, withoutVerse } from './lib/place'
import { FoundNote, lastColor, markKey, newNoteId, notesCovering, notesOf, PALETTE, rememberColor, setNote, tidy } from './lib/marks'
import { touch as touchTrail } from './lib/history'
import { chapterNotes, LinkedNote, linkNotes, NoteLinks, related } from './lib/notelinks'
import { plain } from './lib/text'
import { canShare, copyText, share, shareLink, tap } from './lib/native'
import { go, readPath, Route, useApp } from './state'
import { LexiconSheet, Sheet, VerseText } from './ui'
import { BookmarkIcon, CompareIcon, CopyIcon, LinkIcon, NoteIcon, ShareIcon } from './icons'

export function Reader({ route }: { route: Route }) {
  const { settings, update, byId, data, marks, setMarks } = useApp()
  const [, , bookParam, chParam] = route.path
  const version = byId.has(route.path[1]) ? route.path[1] : settings.version
  const book = bookParam && BOOK_INDEX[bookParam] !== undefined ? bookParam : 'Gen'
  const chapter = Math.max(1, +chParam || 1)
  const target = +(route.params.get('v') || 0)
  // Back to a place in your history: that verse at the top, not marked.
  const resumeAt = +(route.params.get('at') || 0)
  const parallel = (route.params.get('p')?.split(',') ?? settings.parallel).filter(id => byId.has(id) && id !== version)
  const versions = [version, ...parallel]

  const [bibles, setBibles] = useState<Record<string, Bible>>({})
  const [error, setError] = useState('')
  const [lex, setLex] = useState<string>()
  const [selected, setSelected] = useState<number[]>([])
  // The verses whose notes are open.
  const [noteFor, setNoteFor] = useState<NotesTarget>()
  const [chapterSheet, setChapterSheet] = useState(false)
  // Which of your notes mention which passages, and their #tags. Read once
  // the page is on screen, so opening the app is never slower for it.
  const [links, setLinks] = useState<NoteLinks>()
  useEffect(() => {
    if (!settings.noteReminders) return setLinks(undefined)
    const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300))
    const cancel = window.cancelIdleCallback ?? clearTimeout
    const id = idle(() => setLinks(linkNotes(marks)))
    return () => cancel(id)
  }, [marks, settings.noteReminders])

  // A version that isn't on the device can't open offline; it tries again
  // by itself once the connection is back.
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (version !== settings.version || parallel.join() !== settings.parallel.join()) update({ version, parallel })
    setError('')
    Promise.all(versions.map(v => data.bible(v)))
      .then(bs => setBibles(Object.fromEntries(bs.map(b => [b.id, b]))))
      .catch(e => setError(navigator.onLine === false || e instanceof TypeError
        ? `${versions.filter(v => !bibles[v]).join(', ') || version} isn’t saved on this device yet. Connect to the internet once and it stays available offline.`
        : String(e.message || e)))
  }, [versions.join(), retry])
  useEffect(() => {
    if (!error) return
    const again = () => setRetry(n => n + 1)
    addEventListener('online', again)
    return () => removeEventListener('online', again)
  }, [error])

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
      touchTrail({ ...here.current, verse: topVerse.current })
      // From here on the address leads to where you are, not to a verse you
      // jumped to, so a reload or a restored tab lands on the right verse.
      if (/[?&](v|at)=/.test(location.hash)) history.replaceState(history.state, '', withoutVerse(location.hash))
    }
    const measure = () => {
      frame = 0
      if (settling.current) return
      const top = headerBottom()
      // Ignore the moment between chapters or versions when no verses show.
      const els = [...document.querySelectorAll<HTMLElement>('.chapter [id^="v"]')]
      // The verses run down the page in order, so halve the list to find the
      // first one still on screen rather than measuring every verse above it
      // (Psalm 119 has 176) on every frame of a scroll.
      const above = (el: HTMLElement) => { const r = el.getClientRects(); return !r.length || r[r.length - 1].bottom <= top + 12 }
      let lo = 0, hi = els.length
      while (lo < hi) { const mid = (lo + hi) >> 1; if (above(els[mid])) lo = mid + 1; else hi = mid }
      for (let i = lo; i < els.length; i++) {
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
    // Turning the phone (or resizing the window) re-flows the text; stay on
    // the verse you were reading rather than wherever that pixel lands.
    let width = innerWidth
    const onResize = () => {
      if (innerWidth === width) return // the keyboard, or the browser bar
      width = innerWidth
      if (topVerse.current && !peekDir.current) toVerse(topVerse.current)
    }
    const onHide = (e: Event) => { if (e.type === 'pagehide' || document.visibilityState !== 'visible') save() }
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onHide)
    addEventListener('pagehide', onHide)
    return () => {
      save(); cancelAnimationFrame(frame)
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onHide)
      removeEventListener('pagehide', onHide)
    }
  }, [])

  const shown = useRef<{ book: string; chapter: number; target: number; at: number }>()
  useEffect(() => {
    document.title = `${formatRef({ book, chapter })} (${version}) · Plain Bible`
    if (!loaded) return
    const prev = shown.current
    shown.current = { book, chapter, target, at: resumeAt }
    const same = prev && prev.book === book && prev.chapter === chapter
    if (!same) topVerse.current = 0
    requestAnimationFrame(() => {
      // Same chapter, different version, columns, layout or text size: keep your verse.
      if (same && prev.target === target && prev.at === resumeAt) toVerse(topVerse.current)
      else if (target) document.getElementById('v' + target)?.scrollIntoView({ block: 'center' })
      else if (resumeAt) toVerse(resumeAt)
      // Opening the app, or coming back from Settings: the verse you were on.
      else if (!prev) { const p = loadPlace(); toVerse(p && p.book === book && p.chapter === chapter ? p.verse : 1) }
      else window.scrollTo(0, 0)
      settling.current = false
      if (peekDir.current) close()
    })
  }, [book, chapter, version, target, resumeAt, loaded, versions.join(), settings.layout, settings.fontSize, settings.font])

  useEffect(() => setSelected([]), [book, chapter, version])

  const nav = (b: string, c: number, v?: number) => go(readPath(version, b, c, v, parallel))
  const primary = bibles[version]
  const chapterCount = (b: string) => primary?.books[b]?.length ?? 0
  // The chapter before or after this one, if there is one.
  const dest = (dir: 1 | -1): [string, number] | undefined => {
    if (!primary) return
    if (dir === 1 && chapter < chapterCount(book)) return [book, chapter + 1]
    if (dir === -1 && chapter > 1) return [book, chapter - 1]
    const order = BOOKS.filter(b => primary.books[b.id])
    const i = order.findIndex(b => b.id === book) + dir
    if (i >= 0 && i < order.length) return [order[i].id, dir === 1 ? 1 : chapterCount(order[i].id)]
  }
  const step = (dir: 1 | -1) => { const d = dest(dir); if (d) nav(...d) }

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
  // After the verse number: a ribbon if it's bookmarked, and a note icon
  // (tap it to read or edit the note). The note icon stays put while the
  // note is open, even before anything is typed.
  const editing = noteFor?.verses[0]
  const marksAfter = (v: number) => {
    const ns = notesOf(mark(v))
    return <>
      {mark(v)?.b && <BookmarkIcon class="bm-mark" />}
      {(ns.length > 0 || editing === v) && (
        <button class="note-mark" aria-label={ns.length > 1 ? `${ns.length} notes on verse ${v}` : `Note on verse ${v}`} title={ns[0]?.n} onClick={e => { e.stopPropagation(); openNote([v], true) }}>
          <NoteIcon />
        </button>
      )}
    </>
  }
  // Notes on one verse or on several: the list of them, or a new note when
  // there are none yet. From a verse's note icon, notes that all cover the
  // same passage open as that passage, so "Add note" adds to it too.
  const openNote = (vs: number[], fromIcon = false) => {
    const all = notesCovering(marks, book, chapter, vs[0])
    const mine = vs.length === 1 ? all : all.filter(x => x.verses.join() === vs.join())
    const same = fromIcon && all.length > 0 && all.every(x => x.verses.join() === all[0].verses.join())
    setNoteFor({ verses: same ? all[0].verses : vs, start: mine.length ? undefined : 'new' })
  }
  // One tap selects a verse; a quick second tap on it instead highlights it
  // in the colour you used last, or takes its highlight off.
  const lastTap = useRef<{ v: number; t: number; before: number[] }>()
  // Whether words were already selected when the finger went down.
  const selectedBefore = useRef(false)
  useEffect(() => {
    const down = () => { selectedBefore.current = !!String(getSelection() ?? '').trim() }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [])
  const tapVerse = (e: MouseEvent, v: number) => {
    if ((e.target as HTMLElement).closest('.w') && settings.strongs) return
    // Selecting words isn't a tap, and neither is a tap on the selected
    // words (that's for the copy menu). A tap elsewhere while words are still
    // selected clears them and counts, so it isn't lost.
    const sel = getSelection()
    if (String(sel ?? '').trim()) {
      if (!selectedBefore.current || sel!.containsNode(e.target as Node, true)) return
      sel!.removeAllRanges()
    }
    const now = Date.now(), prev = lastTap.current
    if (prev && prev.v === v && now - prev.t < 350) {
      lastTap.current = undefined
      setSelected(prev.before)
      const key = markKey(book, chapter, v), had = marks[key]?.c
      tap()
      setMarks(all => {
        const next = { ...all[key], t: now } as Record<string, unknown>
        if (had) delete next.c; else { next.c = lastColor(); next.v = version }
        return { ...all, [key]: tidy(next as never) }
      })
      return
    }
    lastTap.current = { v, t: now, before: selected }
    setSelected(s => s.includes(v) ? s.filter(x => x !== v) : [...s, v].sort((a, b) => a - b))
  }
  // Swipe left/right to change chapter. Two ways to turn (a setting):
  // 'stack', as in Apple Books: going forward your page slides away over the
  // next chapter, which waits underneath; going back, the previous chapter
  // slides in over yours. 'slide', as in Kindle: the two chapters sit side by
  // side and move across together. Off in Settings, or with reduced motion,
  // the chapter just changes.
  const article = useRef<HTMLElement>(null)
  const touch = useRef<{ x: number; y: number; t: number; axis?: 'x' | 'y'; dx: number }>()
  const mode = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : settings.turn
  const animate = mode !== 'off'
  const [peek, setPeek] = useState<{ dir: 1 | -1; from: string; b: string; c: number; top: number; left: number; width: number }>()
  const peekDir = useRef<1 | -1>()
  const peekEl = useRef<HTMLElement>(null), dimEl = useRef<HTMLDivElement>(null)
  const x = useRef(0), busy = useRef(false)
  // How far a page goes to be off screen; a stacked page has a shadow to hide too.
  const away = () => innerWidth + (mode === 'stack' ? 48 : 0)
  // Where the page, the chapter beside it and the shade over the page
  // underneath are, dx pixels into a turn.
  const looks = (dx: number) => {
    const dir = peekDir.current ?? 1, k = Math.min(1, Math.abs(dx) / innerWidth)
    return {
      page: (mode === 'slide' || dir === 1) && dx ? `translateX(${dx}px)` : 'none',
      peek: mode === 'slide' ? `translateX(${dx + dir * innerWidth}px)` : dir === -1 ? `translateX(${dx - away()}px)` : 'none',
      // The page underneath is in shadow while it's covered.
      dim: mode === 'stack' ? .3 * (dir === -1 ? k : 1 - k) : 0,
    }
  }
  const setX = (dx: number) => {
    x.current = dx
    const l = looks(dx)
    if (article.current) article.current.style.transform = l.page
    if (peekEl.current) peekEl.current.style.transform = l.peek
    if (dimEl.current) dimEl.current.style.opacity = String(l.dim)
  }
  const open = (dir: 1 | -1) => {
    const d = dest(dir), a = article.current
    if (!d || !a || peekDir.current === dir) return
    a.style.transform = ''
    const r = a.getBoundingClientRect()
    peekDir.current = dir
    document.documentElement.classList.add('page-turning')
    setPeek({ dir, from: `${book}.${chapter}`, b: d[0], c: d[1], top: r.top + scrollY, left: r.left, width: r.width })
  }
  const close = () => {
    peekDir.current = undefined
    document.documentElement.classList.remove('page-turning')
    x.current = 0
    if (article.current) article.current.style.transform = ''
    setPeek(undefined)
  }
  useEffect(() => () => document.documentElement.classList.remove('page-turning'), [])
  // Glide to dx, quick at first and settling at the end. Run as browser
  // animations of transform and opacity, which stay smooth off the main thread.
  const glide = (to: number, then: () => void) => {
    const from = looks(x.current), end = looks(to)
    const opts = { duration: 340 * Math.max(.45, Math.min(1, Math.abs(to - x.current) / innerWidth)), easing: 'cubic-bezier(.2, .7, .25, 1)' }
    const runs = [
      article.current?.animate([{ transform: from.page }, { transform: end.page }], opts),
      peekEl.current?.animate([{ transform: from.peek }, { transform: end.peek }], opts),
      dimEl.current?.animate([{ opacity: from.dim }, { opacity: end.dim }], opts),
    ].filter(a => a) as Animation[]
    setX(to)
    busy.current = true
    const done = () => { busy.current = false; then() }
    Promise.all(runs.map(a => a.finished)).then(done, done)
  }
  const finish = (dir: 1 | -1) => glide(-dir * away(), () => step(dir))
  const turn = (dir: 1 | -1) => {
    if (!dest(dir) || busy.current) return
    if (!animate) return step(dir)
    open(dir)
    // Let the chapter beside it be drawn first.
    requestAnimationFrame(() => requestAnimationFrame(() => finish(dir)))
  }
  // The page follows a sideways drag of dx pixels; at the start or end of the
  // Bible it only gives a little.
  const follow = (dx: number) => {
    if (!animate || busy.current || !dx) return
    const dir = dx < 0 ? 1 : -1
    if (!dest(dir)) { if (article.current) article.current.style.transform = `translateX(${dx * .2}px)`; return }
    open(dir)
    setX(dx)
  }
  // Let go: turn to the next (1) or previous (-1) chapter, or put the page back (0).
  const release = (dir: 1 | -1 | 0) => {
    if (!animate || busy.current) return
    if (dir && dest(dir) && peekDir.current === dir) return finish(dir)
    if (!peekDir.current) { if (article.current) article.current.style.transform = ''; return }
    glide(0, close)
  }
  // A second finger (a pinch) ends the swipe and puts the page back, rather
  // than leaving it stuck half way.
  const abandon = () => { const s = touch.current; touch.current = undefined; if (s?.axis === 'x') release(0) }
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length > 1) return abandon()
    const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY, t: Date.now(), dx: 0 }
  }
  const onTouchMove = (e: TouchEvent) => {
    const s = touch.current, p = e.touches[0]
    if (!s) return
    if (e.touches.length > 1) return abandon()
    const dx = p.clientX - s.x, dy = p.clientY - s.y
    if (!s.axis && Math.hypot(dx, dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
    if (s.axis === 'x') { s.dx = dx; follow(dx) }
  }
  const onTouchEnd = () => {
    const s = touch.current
    touch.current = undefined
    if (!s || s.axis !== 'x') return
    const fast = Date.now() - s.t < 300 && Math.abs(s.dx) > 40
    release(Math.abs(s.dx) > innerWidth * .25 || fast ? s.dx < 0 ? 1 : -1 : 0)
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
      w.timer = window.setTimeout(() => { if (!w.done) release(0); w.dx = 0; w.done = false }, 160)
      if (w.done) return
      w.dx -= e.deltaX
      follow(w.dx)
      if (Math.abs(w.dx) > Math.min(innerWidth * .25, 160)) {
        w.done = true
        release(w.dx < 0 ? 1 : -1)
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  })

  const rows = loaded ? Math.max(...versions.map(v => bibles[v].books[book]?.[chapter - 1]?.length ?? 0)) : 0
  const showStrongs = settings.strongs
  const t = byId.get(version)

  // Your notes on this chapter: a quiet line under the title, there only
  // when you have some. Tap it for the list.
  const inChapter = loaded && settings.noteReminders ? chapterNotes(marks, book, chapter, rows) : []
  const elsewhere = links && loaded ? related(links, book, chapter, inChapter) : []
  const reminder = (inChapter.length > 0 || elsewhere.length > 0) && (
    <button class="chapter-notes" onClick={() => setChapterSheet(true)}>
      <NoteIcon size={18} />
      <span>{[inChapter.length && `${inChapter.length} ${inChapter.length === 1 ? 'note' : 'notes'} here`,
        elsewhere.length && `${elsewhere.length} elsewhere`].filter(Boolean).join(' · ')}</span>
    </button>
  )
  const goNote = (x: LinkedNote) => go(readPath(version, x.book, x.chapter, x.verse, parallel))

  // A chapter's verses. The live page is the one you read; the other is the
  // chapter beside it while you turn, which can't be tapped and has no ids.
  const page = (b: string, c: number, live: boolean) => {
    const mark = (v: number) => marks[markKey(b, c, v)]
    const rowsOf = Math.max(...versions.map(v => bibles[v].books[b]?.[c - 1]?.length ?? 0))
    const cls = (base: string, v: number) => base + (live && target === v ? ' target' : '') + (mark(v)?.c ? ' hl' : '') + (mark(v)?.b ? ' bm' : '') + (live && selected.includes(v) ? ' picked' : '')
    const verse = (v: number) => live
      ? { id: 'v' + v, onClick: (e: MouseEvent) => tapVerse(e, v) }
      : { id: undefined, onClick: undefined }
    const hl = (v: number) => mark(v)?.c ? { '--hl': mark(v)!.c } : undefined
    const after = (v: number) => {
      if (live) return marksAfter(v)
      return <>
        {mark(v)?.b && <BookmarkIcon class="bm-mark" />}
        {notesOf(mark(v)).length > 0 && <span class="note-mark"><NoteIcon /></span>}
      </>
    }
    const lex = live ? setLex : undefined
    return <>
      <h1 class="chapter-title"><span class="ct-book">{bookById(b).name}</span> <span class="ct-num">{c}</span></h1>
      {live && reminder}
      {versions.length > 1 && (
        <div class="vrow-head">{versions.map(v => <div class="colhead" title={byId.get(v)?.name}>{v}</div>)}</div>
      )}
      {versions.length === 1 && settings.layout === 'paragraph' ? (
        <p class="para" dir={t?.rtl ? 'rtl' : undefined}>
          {primary.books[b][c - 1].map((raw, i) => raw && (
            <span id={verse(i + 1).id} class={cls('pv', i + 1)} style={hl(i + 1)} onClick={verse(i + 1).onClick}>
              <sup class="vn">{i + 1}</sup>{after(i + 1)}
              <span class="vt"><VerseText raw={raw} strongs={showStrongs} numbers={settings.strongsNumbers} onStrongs={lex} /></span>{' '}
            </span>
          ))}
        </p>
      ) : Array.from({ length: rowsOf }, (_, i) => (
        <div id={verse(i + 1).id} class={cls('verse', i + 1)} style={hl(i + 1)} onClick={verse(i + 1).onClick}>
          {versions.map(v => {
            const raw = bibles[v].books[b]?.[c - 1]?.[i]
            const tv = byId.get(v)
            return (
              <div class="cell" dir={tv?.rtl ? 'rtl' : undefined} lang={tv?.lang}>
                <button class="vn" aria-label={`Verse ${i + 1} options`} tabIndex={live ? undefined : -1}>{i + 1}</button>{v === version && after(i + 1)}
                {raw ? <span class="vt"><VerseText raw={raw} strongs={showStrongs} numbers={settings.strongsNumbers} onStrongs={lex} /></span> : <span class="muted">—</span>}
              </div>
            )
          })}
        </div>
      ))}
    </>
  }

  return (
    <div class="reader">
      {error && <div class="center"><p class="error">{error}</p><p><button onClick={() => setRetry(n => n + 1)}>Try again</button></p></div>}
      {!loaded && !error && <p class="muted center">Loading…</p>}
      {loaded && rows === 0 && <p class="muted center">{t?.name} does not include {bookById(book).name} {chapter}.</p>}

      {loaded && rows > 0 && (
        <article key={`${book}.${chapter}`} ref={article} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
          class={`chapter ${settings.layout} cols-${versions.length}${mode === 'stack' && peek?.dir === 1 && peek.from === `${book}.${chapter}` ? ' turning' : ''}`} style={{ '--cols': versions.length }}>
          {page(book, chapter, true)}
        </article>
      )}

      {peek && (
        <div class={'turn-peek' + (mode === 'stack' && peek.dir === 1 ? ' under' : '')} aria-hidden="true">
          <div class="turn-dim" ref={dimEl} style={{ opacity: mode === 'stack' && peek.dir === 1 ? .3 : 0 }} />
          <article ref={peekEl} class={`chapter ${settings.layout} cols-${versions.length}${mode === 'stack' && peek.dir === -1 ? ' turning' : ''}`}
            style={{ '--cols': versions.length, top: peek.top + 'px', left: peek.left + 'px', width: peek.width + 'px', transform: looks(x.current).peek }}>
            {page(peek.b, peek.c, false)}
          </article>
        </div>
      )}

      <nav class="pager">
        <button onClick={() => turn(-1)}><span aria-hidden="true">‹</span> Previous</button>
        <button onClick={() => turn(1)}>Next <span aria-hidden="true">›</span></button>
      </nav>
      {t && <p class="credit muted small">{t.name}. {t.license}.</p>}

      {lex && <LexiconSheet num={lex} onClose={() => setLex(undefined)} onSearch={n => { setLex(undefined); go(`search?q=${n}&v=${versions.filter(v => byId.get(v)?.strongs).join(',') || 'KJV'}`) }} />}
      {selected.length > 0 && <SelectionBar book={book} chapter={chapter} verses={selected} versions={versions} bibles={bibles} onClose={() => setSelected([])}
        onNote={vs => { setSelected([]); openNote(vs) }} />}
      {noteFor && <NotesSheet book={book} chapter={chapter} {...noteFor} dir={t?.rtl ? 'rtl' : undefined} links={links} onGo={x => { setNoteFor(undefined); goNote(x) }}
        text={v => plain(primary?.books[book]?.[chapter - 1]?.[v - 1] ?? '')} onClose={() => setNoteFor(undefined)} />}
      {chapterSheet && (
        <Sheet title={`Your notes · ${bookById(book).name} ${chapter}`} onClose={() => setChapterSheet(false)}>
          {inChapter.length > 0 && <>
            <h3 class="notes-head">In this chapter</h3>
            <NoteCards notes={inChapter} book={book} chapter={chapter} onPick={x => { setChapterSheet(false); toVerse(x.verse); setNoteFor({ verses: x.verses, start: { key: x.key, id: x.id } }) }} />
          </>}
          {elsewhere.length > 0 && <>
            <h3 class="notes-head">From your other notes</h3>
            <NoteCards notes={elsewhere} onPick={x => { setChapterSheet(false); goNote(x as LinkedNote) }} />
          </>}
        </Sheet>
      )}
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
  book: string; chapter: number; verses: number[]; versions: string[]; bibles: Record<string, Bible>; onClose: () => void; onNote: (vs: number[]) => void
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
  const hasNote = notesCovering(marks, book, chapter, verses[0]).length > 0

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
              style={{ background: p.color }} onClick={() => { if (current !== p.color) rememberColor(p.color); apply({ c: current === p.color ? null : p.color }); onClose() }}>
              {current === p.color && <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#222" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>}
            </button>
          ))}
          {colors.size > 0 && <button class="swatch none" aria-label="Remove highlight" onClick={() => { apply({ c: null }); onClose() }}>✕</button>}
        </div>
        <div class="actions">
          <button class={allBookmarked ? 'on' : ''} aria-pressed={allBookmarked} onClick={() => { apply({ b: allBookmarked ? null : 1 }); onClose() }}>
            <BookmarkIcon size={22} class="bm-icon" filled={allBookmarked} /><span>{allBookmarked ? 'Saved' : 'Bookmark'}</span>
          </button>
          <button class={hasNote ? 'on' : ''} onClick={() => onNote(verses)}><NoteIcon size={22} /><span>Note</span></button>
          <button onClick={() => copy(quote)}><CopyIcon size={22} /><span>Copy</span></button>
          {canShare
            ? <button onClick={() => share({ title: ref, text: quote, url: link })}><ShareIcon size={22} /><span>Share</span></button>
            : <button onClick={() => copy(link)}><LinkIcon size={22} /><span>Link</span></button>}
          <button onClick={showCompare}><CompareIcon size={22} /><span>Compare</span></button>
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

export interface NotesTarget {
  /** the verses the sheet is about; a new note covers these */
  verses: number[]
  /** open straight to a new note, or to one note by id (on `key`) */
  start?: 'new' | { key: string; id: string }
}

/** Notes on a verse or a passage: a list of them with "Add note", and the
 *  editor for one note. The verses are shown above as a reminder. Notes are
 *  saved as you type. A sheet opened straight to one note closes when you're
 *  done with it; opened on the list, it goes back to the list. */
export function NotesSheet({ book, chapter, verses, start, text, dir, links, onGo, onClose }: NotesTarget & {
  book: string; chapter: number; text: (v: number) => string; dir?: 'rtl'; links?: NoteLinks; onGo?: (x: LinkedNote) => void; onClose: () => void
}) {
  const { marks } = useApp()
  const list = verses.length === 1
    ? notesCovering(marks, book, chapter, verses[0])
    : notesCovering(marks, book, chapter, verses[0]).filter(x => x.verses.join() === verses.join())
  const fresh = () => ({ key: markKey(book, chapter, verses[0]), id: newNoteId(), verses })
  const [editing, setEditing] = useState<{ key: string; id: string; verses: number[] } | undefined>(() => {
    if (start === 'new' || !list.length) return fresh()
    if (start) return { ...start, verses: list.find(x => x.id === start.id)?.verses ?? verses }
  })
  const fromList = useRef(!editing)
  const ref = (vs: number[]) => `${bookById(book).name} ${chapter}:${verseRanges(vs)}`
  const passage = (vs: number[]) => <Passage verses={vs} text={text} dir={dir} />
  const done = () => fromList.current ? setEditing(undefined) : onClose()
  return (
    <Sheet title={editing ? `Note · ${ref(editing.verses)}` : `${list.length > 1 ? 'Notes' : 'Note'} · ${ref(verses)}`} onClose={onClose}>
      {editing ? <NoteEditor key={editing.id} at={editing.key} id={editing.id} verses={editing.verses} passage={passage(editing.verses)} onDone={done} /> : <>
      {passage(verses)}
      <ul class="note-list">
        {list.map(x => (
          <li><button class="note-card" onClick={() => setEditing(x)}>
            <span class="nc-meta muted small">
              {x.verses.join() !== verses.join() && <strong>{ref(x.verses)} · </strong>}
              {new Date(x.c).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(x.c).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}
            </span>
            <span class="nc-text">{x.n}</span>
          </button></li>
        ))}
      </ul>
      <div class="row">
        <button class="primary" onClick={() => setEditing(fresh())}>+ Add note</button>
      </div>
      {links && onGo && (() => {
        const more = related(links, book, chapter, list, verses)
        return more.length > 0 && <>
          <h3 class="notes-head">Also in your notes</h3>
          <NoteCards notes={more} onPick={x => onGo(x as LinkedNote)} />
        </>
      })()}
      </>}
    </Sheet>
  )
}

/** Notes as cards: where each one is (when not obvious) and its text. */
function NoteCards({ notes, book, chapter, onPick }: {
  notes: (FoundNote & { book?: string; chapter?: number; why?: string })[]; book?: string; chapter?: number; onPick: (x: FoundNote) => void
}) {
  return (
    <ul class="note-list">
      {notes.map(x => (
        <li><button class="note-card" onClick={() => onPick(x)}>
          <span class="nc-meta muted small">
            <strong>{x.book && (x.book !== book || x.chapter !== chapter)
              ? `${bookById(x.book).name} ${x.chapter}:${verseRanges(x.verses)}`
              : `${x.verses.length > 1 ? 'Verses' : 'Verse'} ${verseRanges(x.verses)}`}</strong>
            {x.why && ` · ${x.why}`}
          </span>
          <span class="nc-text">{x.n}</span>
        </button></li>
      ))}
    </ul>
  )
}

/** The verses a note is about, as a quiet quote. A long passage is folded
 *  to its first lines; tap to see it all. */
function Passage({ verses, text, dir }: { verses: number[]; text: (v: number) => string; dir?: 'rtl' }) {
  const [full, setFull] = useState(false)
  const shown = verses.map(v => [v, text(v)] as const).filter(([, s]) => s)
  if (!shown.length) return null
  const long = shown.length > 3 || shown.reduce((n, [, s]) => n + s.length, 0) > 420
  return (
    <figure class={'note-passage' + (long && !full ? ' folded' : '')} dir={dir}>
      <blockquote>
        {shown.map(([v, s]) => <span class="np-verse">{verses.length > 1 && <sup>{v}</sup>}{s} </span>)}
      </blockquote>
      {long && <button class="link np-more" onClick={() => setFull(f => !f)} aria-expanded={full}>
        {full ? 'Show less' : `Show all ${shown.length > 1 ? shown.length + ' verses' : 'of the verse'}`}</button>}
    </figure>
  )
}

/** Write, edit or delete one note (on the mark `at`). */
function NoteEditor({ at: markK, id, verses, passage, onDone }: {
  at: string; id: string; verses: number[]; passage: ComponentChildren; onDone: () => void
}) {
  const { marks, setMarks } = useApp()
  const initial = marks[markK]?.ns?.[id]?.n ?? ''
  const [draft, setDraft] = useState(initial)
  const area = useRef<HTMLTextAreaElement>(null)
  const saved = useRef(initial)
  const save = (s: string) => {
    if (s.trim() === saved.current.trim()) return
    saved.current = s
    setMarks(m => setNote(m, markK, id, s, undefined, verses))
  }
  useEffect(() => { if (!draft) area.current?.focus() }, [])
  useEffect(() => { const t = setTimeout(() => save(draft), 600); return () => clearTimeout(t) }, [draft])
  // Switching away (or an app update reloading the page) mustn't lose the
  // last words typed.
  const latest = useRef(draft)
  latest.current = draft
  useEffect(() => {
    const flush = (e: Event) => { if (e.type === 'pagehide' || document.visibilityState !== 'visible') save(latest.current) }
    document.addEventListener('visibilitychange', flush)
    addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush); removeEventListener('pagehide', flush)
      // Closing the sheet, or going back to the list, keeps what was typed.
      save(latest.current)
    }
  }, [])
  return (
    <>
      {passage}
      <textarea ref={area} class="note-text" rows={6} placeholder={verses.length > 1 ? 'Write a note on these verses…' : 'Write a note on this verse…'} value={draft}
        onInput={e => setDraft((e.target as HTMLTextAreaElement).value)} />
      <div class="row">
        <button class="primary" onClick={onDone}>Done</button>
        {saved.current && <button onClick={() => { latest.current = ''; save(''); onDone() }}>Delete note</button>}
      </div>
    </>
  )
}
