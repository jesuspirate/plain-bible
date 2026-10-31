import { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { BOOKS, BOOK_INDEX, bookName } from './lib/books'
import { Bible } from './lib/data'
import { formatRef, verseRanges } from './lib/refs'
import { loadPlace, savePlace, withoutVerse } from './lib/place'
import { FoundNote, lastColor, markKey, newNoteId, notesCovering, notesOf, PALETTE, rememberColor, setNote, tidy } from './lib/marks'
import { touch as touchTrail } from './lib/history'
import { chapterNotes, LinkedNote, linkNotes, NoteLinks, related } from './lib/notelinks'
import { plain } from './lib/text'
import { canShare, copyText, share, shareLink } from './lib/native'
import { go, inCircles, PICK_EVENT, pickVerses, prayEmoji, prayOver, versePick, readPath, Route, sharedPath, shareWithCircle, useApp, versesPicked } from './state'
import { TURN_EVENT, watchReading } from './lib/streaks'
import { toggleVerse, verseLabel } from './lib/prayerVerses'
import { LexiconSheet, Sheet, VerseText } from './ui'
import { toStandard } from './lib/versification'
import { BookmarkIcon, CircleIcon, CloseIcon, CompareIcon, CopyIcon, LinkIcon, NoteIcon, ShareIcon, SpeakerIcon } from './icons'
import { canListen, startListening } from './listen'
import { locale, t, tn } from './i18n'
import { overlayOpen } from './lib/overlay'

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

  // Reading counts toward your streak: about a minute with the page moving
  // (scrolling, tapping, turning chapters). It stops listening once today counts.
  useEffect(() => watchReading(), [])
  const turned = useRef(false)
  useEffect(() => { if (turned.current) dispatchEvent(new Event(TURN_EVENT)); turned.current = true }, [book, chapter])

  // A version that isn't on the device can't open offline; it tries again
  // by itself once the connection is back.
  // Your Bible changes only when you pick one (Settings, Versions). A
  // search result, a lexicon search or a link that opens another version
  // is a visit: it never becomes yours, here or on your other devices.
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (parallel.join() !== settings.parallel.join()) update({ parallel })
    setError('')
    Promise.all(versions.map(v => data.bible(v)))
      .then(bs => setBibles(Object.fromEntries(bs.map(b => [b.id, b]))))
      .catch(e => setError(navigator.onLine === false || e instanceof TypeError
        ? t('{version} isn’t saved on this device yet. Connect to the internet once and it stays available offline.', { version: versions.filter(v => !bibles[v]).join(', ') || version })
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
      // A page part way through a turn no longer fits; let it go.
      if (peekDir.current) swipe.current.drop()
      else if (topVerse.current) toVerse(topVerse.current)
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
    document.title = `${formatRef({ book, chapter })} (${version}) · My Quiet Bible`
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
      if (peekDir.current) { close(); settle() }
    })
  }, [book, chapter, version, target, resumeAt, loaded, versions.join(), settings.layout, settings.fontSize, settings.font])

  useEffect(() => setSelected([]), [book, chapter, version])
  // The verse the mouse last came to rest on (computers only): it keeps the ribbon.
  const [reading, setReading] = useState<number>()
  useEffect(() => setReading(undefined), [book, chapter, version])

  // The verse a search, link or reminder lands on glows long enough to find
  // and read it, then fades so you are just reading. A small scroll to read
  // keeps it; scrolling it off the screen lets it go sooner, and highlighting
  // or selecting it ends it for good. Back (the clock) still takes you to
  // where you were, so it needn't stay as a marker.
  const [glow, setGlow] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const landed = useRef('')
  useEffect(() => {
    // The clock starts once the verse is on screen, and only once per landing
    // (a version that loads later doesn't light it up again).
    const at = `${book}/${chapter}/${target}`
    if (!target) { landed.current = ''; return setGlow(0) }
    if (landed.current === at) return setGlow(0)
    if (!loaded) return
    landed.current = at
    setGlow(target); setLeaving(false)
    let gone = 0
    const letGo = () => {
      if (gone) return
      setLeaving(true)
      gone = window.setTimeout(() => setGlow(0), 600)
    }
    let seen = false
    const watch = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) seen = true
      else if (seen) letGo()
    })
    // After the scroll that brings it into view.
    const arm = setTimeout(() => { const el = document.getElementById('v' + target); if (el) watch.observe(el) }, 400)
    const done = setTimeout(() => setGlow(0), 8200)
    return () => { clearTimeout(arm); clearTimeout(done); clearTimeout(gone); watch.disconnect() }
  }, [book, chapter, target, loaded])
  useEffect(() => { if (glow && selected.includes(glow)) setGlow(0) }, [selected])
  useEffect(() => { if (glow && marks[markKey(book, chapter, glow)]?.c) setGlow(0) }, [marks])
  // Verses you select are offered if you go to pray soon after.
  useEffect(() => { if (selected.length) versesPicked({ book, chapter, verses: selected }) }, [selected])
  // "Add a verse" for a prayer: verses you tap are added to it, or taken off.
  const [picking, setPicking] = useState(versePick)
  const [tied, setTied] = useState('')
  useEffect(() => {
    const on = () => setPicking(versePick())
    addEventListener(PICK_EVENT, on)
    return () => removeEventListener(PICK_EVENT, on)
  }, [])
  useEffect(() => { if (tied) { const timer = setTimeout(() => setTied(''), 3000); return () => clearTimeout(timer) } }, [tied])
  const pickedHere = picking?.verses.find(x => x.book === book && x.chapter === chapter)?.verses ?? []
  const pickDone = async () => {
    const p = picking
    pickVerses(undefined)
    if (!p) return
    // The prayer about to be prayed opens again, with them.
    if (!p.prayer) return prayOver(...p.verses)
    const { prayers } = await import('./lib/prayers')
    // Prayers load only once you've prayed, so reading never waits on them.
    prayers.tie(p.prayer, p.verses).then(() => {
      setTied(p.verses.length ? t('Your prayer is tied to {verse}.', { verse: p.verses.map(verseLabel).join(', ') }) : t('Your prayer has no verses now.'))
      import('./lib/prayerSync').then(m => m.syncPrayers()).catch(() => {})
    }, () => setTied(t('That prayer is no longer on this device.')))
  }
  // Cancel leaves the prayer as it was; one about to be prayed opens again.
  const pickCancel = () => {
    const p = picking
    pickVerses(undefined)
    if (p && !p.prayer) prayOver(...p.from)
  }

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
      if ((e.target as HTMLElement).closest('input, textarea, dialog') || overlayOpen()) return
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
        <button class="note-mark" aria-label={ns.length > 1 ? t('{n} notes on verse {v}', { n: ns.length, v }) : t('Note on verse {v}', { v })} title={ns[0]?.n} onClick={e => { e.stopPropagation(); openNote([v], true) }}>
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
    if (picking) { pickVerses({ ...picking, verses: toggleVerse(picking.verses, book, chapter, v) }); return }
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
  const touch = useRef<{ x: number; y: number; t: number; axis?: 'x' | 'y'; dx: number; x0: number; tx: number; late: boolean }>()
  const mode = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : settings.turn
  const animate = mode !== 'off'
  const [peek, setPeek] = useState<{ dir: 1 | -1; from: string; b: string; c: number; top: number; left: number; width: number }>()
  const peekDir = useRef<1 | -1>()
  const peekEl = useRef<HTMLElement>(null), dimEl = useRef<HTMLDivElement>(null)
  const x = useRef(0), busy = useRef(false)
  // Turns asked for while a page is still turning (a quick run of swipes, or
  // arrow keys held down), counted forward (+) and back (-); each one turns
  // as soon as the page before it has landed, and quicker.
  const queued = useRef(0), lastTurn = useRef(0), runs = useRef<Animation[]>([]), stuck = useRef(0)
  const quick = () => queued.current !== 0 || Date.now() - lastTurn.current < 700
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
    // Read to the end of a chapter, the page stops part way down the screen;
    // the page you turn reaches to the bottom, not just a strip of its last verses.
    a.style.setProperty('--below', Math.max(0, innerHeight - r.bottom) + 'px')
    peekDir.current = dir
    document.documentElement.classList.add('page-turning')
    setPeek({ dir, from: `${book}.${chapter}`, b: d[0], c: d[1], top: r.top + scrollY, left: r.left, width: r.width })
  }
  const close = () => {
    peekDir.current = undefined
    document.documentElement.classList.remove('page-turning')
    x.current = 0
    if (article.current) { article.current.style.transform = ''; article.current.style.removeProperty('--below') }
    setPeek(undefined)
  }
  useEffect(() => () => { document.documentElement.classList.remove('page-turning'); clearTimeout(stuck.current) }, [])
  // Glide to dx, quick at first and settling at the end. Run as browser
  // animations of transform and opacity, which stay smooth off the main thread.
  const glide = (to: number, then: () => void) => {
    const from = looks(x.current), end = looks(to)
    const opts = { duration: (quick() ? 170 : 340) * Math.max(.45, Math.min(1, Math.abs(to - x.current) / innerWidth)), easing: 'cubic-bezier(.2, .7, .25, 1)' }
    const these = runs.current = [
      article.current?.animate([{ transform: from.page }, { transform: end.page }], opts),
      peekEl.current?.animate([{ transform: from.peek }, { transform: end.peek }], opts),
      dimEl.current?.animate([{ opacity: from.dim }, { opacity: end.dim }], opts),
    ].filter(a => a) as Animation[]
    setX(to)
    busy.current = true
    // iPhone can leave an animation frozen part way (the app put away, Low
    // Power Mode), and its end never comes: the page stayed half turned over
    // the next chapter, and every swipe after it waited for it. A little after
    // it should have ended, it ends anyway, right where it was going.
    let done = false
    const land = () => {
      if (done) return
      done = true
      clearTimeout(late)
      if (landNow.current === land) landNow.current = undefined
      these.forEach(a => a.cancel())
      then()
    }
    const late = window.setTimeout(land, opts.duration + 400)
    landNow.current = land
    Promise.all(these.map(a => a.finished)).then(land, land)
  }
  const landNow = useRef<() => void>()
  // Another swipe while a page is still on its way: let it land sooner.
  const hurry = () => runs.current.forEach(a => { if (a.playState === 'running') a.updatePlaybackRate ? a.updatePlaybackRate(3) : a.playbackRate = 3 })
  const queue = (dir: 1 | -1) => { queued.current = Math.max(-30, Math.min(30, queued.current + dir)); hurry() }
  // A page has landed (or gone back): ready for the next turn, which may
  // already be waiting.
  const settle = () => {
    clearTimeout(stuck.current)
    landNow.current = undefined
    busy.current = false
    runs.current = []
    const q = queued.current
    if (!q) return
    const dir = q > 0 ? 1 : -1
    queued.current -= dir
    if (dest(dir)) turn(dir)
    else queued.current = 0
  }
  // The next chapter is shown once it has been drawn (see above), which
  // settles the turn; in case that never comes, swiping still works after a bit.
  const finish = (dir: 1 | -1) => glide(-dir * away(), () => {
    lastTurn.current = Date.now()
    stuck.current = window.setTimeout(() => { if (peekDir.current) close(); settle() }, 1500)
    step(dir)
  })
  const turn = (dir: 1 | -1) => {
    if (!animate) return step(dir)
    if (busy.current) return queue(dir)
    if (!dest(dir)) return
    busy.current = true
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
  // A swipe while a page is still turning is kept for when it lands.
  const release = (dir: 1 | -1 | 0) => {
    if (!animate) { if (dir) step(dir); return }
    if (busy.current) { if (dir) queue(dir); return }
    if (dir && dest(dir)) {
      if (peekDir.current === dir) return finish(dir)
      if (!peekDir.current) return turn(dir)
    }
    if (!peekDir.current) { if (article.current) article.current.style.transform = ''; return }
    glide(0, () => { close(); settle() })
  }
  // A second finger (a pinch) ends the swipe and puts the page back, rather
  // than leaving it stuck half way.
  const abandon = () => { const s = touch.current; touch.current = undefined; if (s?.axis === 'x') release(0) }
  // Put away mid-turn (or turned on its side): finish at once, or put a half
  // swiped page back, so nothing is left part way when you come back.
  const drop = () => {
    touch.current = undefined
    if (landNow.current) landNow.current()
    else if (peekDir.current && !busy.current) { close(); settle() }
  }
  useEffect(() => {
    const onHide = () => { if (document.visibilityState !== 'visible') drop() }
    document.addEventListener('visibilitychange', onHide)
    addEventListener('pagehide', onHide)
    return () => { document.removeEventListener('visibilitychange', onHide); removeEventListener('pagehide', onHide) }
  }, [])
  // A swipe can start while the page before is still sliding away, when the
  // finger isn't on the page at all, so touches are heard on the whole window
  // and then followed on what the finger first touched (which hears them to
  // the end, even once the chapter it was in has gone).
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length > 1) return abandon()
    // A page left part way with no finger on it: its swipe ended without
    // word (iPhone took the touch for itself), so it stayed over the next
    // chapter. Any touch, even a tap on a button, puts it back first.
    if (!busy.current && peekDir.current && !trackpad()) { touch.current = undefined; release(0) }
    if (overlayOpen()) return
    const el = e.target as HTMLElement
    if (el.closest?.('.sb, dialog, .selbar, .pager, header') || !(el.closest?.('.reader') || busy.current || peekDir.current)) return
    if (busy.current) hurry()
    const p = e.touches[0]
    touch.current = { x: p.clientX, y: p.clientY, t: Date.now(), dx: 0, x0: p.clientX, tx: 0, late: busy.current }
    const move = (e: TouchEvent) => swipe.current.move(e)
    const off = () => { el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', cancel) }
    const end = () => { off(); swipe.current.end() }
    // Taken away (a call, a system swipe): not a turn, the page goes back.
    const cancel = () => { off(); if (touch.current?.axis === 'x') touch.current.dx = touch.current.tx = 0; swipe.current.end() }
    el.addEventListener('touchmove', move, { passive: true })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', cancel)
  }
  const onTouchMove = (e: TouchEvent) => {
    const s = touch.current, p = e.touches[0]
    if (!s) return
    if (e.touches.length > 1) return abandon()
    const tx = p.clientX - s.x0, dy = p.clientY - s.y
    if (!s.axis && Math.hypot(tx, dy) > 10) s.axis = Math.abs(tx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
    if (s.axis !== 'x') return
    s.tx = tx
    // Started while the page before was landing: the new page follows from
    // where the finger is once it's there, without a jump.
    if (busy.current) { s.late = true; return }
    if (s.late) { s.late = false; s.x = p.clientX - s.dx }
    s.dx = p.clientX - s.x
    follow(s.dx)
  }
  const onTouchEnd = () => {
    const s = touch.current
    touch.current = undefined
    if (!s || s.axis !== 'x') return
    const fast = Date.now() - s.t < 300 && Math.abs(s.tx) > 40
    const d = Math.abs(s.dx) > innerWidth * .25 ? s.dx : fast || Math.abs(s.tx) > innerWidth * .25 ? s.tx : 0
    release(d ? d < 0 ? 1 : -1 : 0)
  }
  const swipe = useRef({ start: onTouchStart, move: onTouchMove, end: onTouchEnd, drop })
  swipe.current = { start: onTouchStart, move: onTouchMove, end: onTouchEnd, drop }
  useEffect(() => {
    const start = (e: TouchEvent) => swipe.current.start(e)
    window.addEventListener('touchstart', start, { passive: true })
    return () => window.removeEventListener('touchstart', start)
  }, [])

  // Two-finger swipe on a trackpad (or a swipe on a Magic Mouse) does the
  // same as a touch swipe.
  const wheel = useRef({ dx: 0, done: false, timer: 0, at: 0, low: 0, peak: 0, axis: '' as '' | 'x' | 'y', sx: 0, sy: 0, px: 0, last: 0 })
  const trackpad = () => wheel.current.dx !== 0 && !wheel.current.done
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const w = wheel.current, ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY), now = Date.now()
      // With a sheet or Circles up, the swipe isn't for the page behind.
      // A swipe already turning the page lets go of it.
      if (overlayOpen()) { if (w.dx && !w.done) release(0); w.dx = 0; w.done = false; w.peak = 0; w.axis = ''; return }
      // A gesture is a scroll or a swipe, decided once from its first few
      // pixels: scrolling up and down always drifts a little sideways, and
      // that drift used to slide the page and sometimes turn it.
      if (now - w.last > 200) { w.axis = ''; w.sx = w.sy = w.px = 0 }
      w.last = now
      // After a turn the Mac keeps sending the swipe's glide, fading away, for
      // a second or more; a new swipe would only count once that stopped, so
      // swipes came through every other time. A new swipe shows itself
      // early: it goes the other way, it's up or down, or it's suddenly
      // stronger than the fading glide.
      if (w.done && now - w.at > 250) {
        const back = ax > 2 && Math.sign(e.deltaX) === Math.sign(w.dx)
        const stronger = w.low <= w.peak / 2 && ax > Math.max(w.low * 2, w.low + 6)
        if (back || ay > ax || stronger) {
          w.dx = 0; w.done = false; w.peak = 0
          w.axis = ay > ax ? '' : 'x'; w.sx = w.sy = w.px = 0
        }
        else w.low = Math.min(w.low, ax)
      }
      if (!w.axis) {
        w.sx += ax; w.sy += ay; w.px += e.deltaX
        if (w.sx + w.sy < 12) return
        w.axis = w.sx > w.sy * 2 ? 'x' : 'y'
        if (w.axis === 'x') w.dx = -(w.px - e.deltaX)
      }
      if (w.axis === 'y') return
      if ((e.target as HTMLElement).closest?.('.sb, dialog, .selbar, .sb-chapter-row')) return
      e.preventDefault()
      clearTimeout(w.timer)
      // A gesture ends when the events (including the trackpad's glide) stop.
      w.timer = window.setTimeout(() => { if (!w.done) release(0); w.dx = 0; w.done = false; w.peak = 0; w.axis = '' }, 160)
      if (w.done) return
      w.dx -= e.deltaX; w.peak = Math.max(w.peak, ax)
      follow(w.dx)
      if (Math.abs(w.dx) > Math.min(innerWidth * .25, 160)) {
        w.done = true; w.at = Date.now(); w.low = w.peak
        release(w.dx < 0 ? 1 : -1)
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  })

  const rows = loaded ? Math.max(...versions.map(v => bibles[v].books[book]?.[chapter - 1]?.length ?? 0)) : 0
  const showStrongs = settings.strongs
  const info = byId.get(version)

  // Your notes on this chapter: a quiet line under the title, there only
  // when you have some. Tap it for the list.
  const inChapter = loaded && settings.noteReminders ? chapterNotes(marks, book, chapter, rows) : []
  const elsewhere = links && loaded ? related(links, book, chapter, inChapter) : []
  const reminder = (inChapter.length > 0 || elsewhere.length > 0) && (
    <button class="chapter-notes" onClick={() => setChapterSheet(true)}>
      <NoteIcon size={18} />
      <span>{[inChapter.length && tn(inChapter.length, '{n} note here', '{n} notes here'),
        elsewhere.length && t('{n} elsewhere', { n: elsewhere.length })].filter(Boolean).join(' · ')}</span>
    </button>
  )
  const goNote = (x: LinkedNote) => go(readPath(version, x.book, x.chapter, x.verse, parallel))

  // A chapter's verses. The live page is the one you read; the other is the
  // chapter beside it while you turn, which can't be tapped and has no ids.
  const page = (b: string, c: number, live: boolean) => {
    const mark = (v: number) => marks[markKey(b, c, v)]
    const rowsOf = Math.max(...versions.map(v => bibles[v].books[b]?.[c - 1]?.length ?? 0))
    const cls = (base: string, v: number) => base + (live && glow === v && !mark(v)?.c && !selected.includes(v) ? (leaving ? ' target leaving' : ' target') : '') + (mark(v)?.c ? ' hl' : '') + (mark(v)?.b ? ' bm' : '') + (live && (selected.includes(v) || pickedHere.includes(v)) ? ' picked' : '')
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
    // With a mouse, a quiet ribbon sits at the end of the verse you're on,
    // just where you finish reading it: a sign that a verse has things you
    // can do. It stays there until the mouse comes to another verse, and it
    // opens the same bar as clicking the verse.
    // In a paragraph each verse keeps a little room for it, so it never sits
    // on the next verse's number and nothing moves as it goes from verse to verse.
    const tab = (v: number) => live && (fine || undefined) && <span class="tab-end">{!picking && reading === v && (
      <button class="verse-tab" tabIndex={-1} title={t('Verse {v} options', { v })} aria-hidden="true"
        onClick={e => { e.stopPropagation(); setSelected(s => s.includes(v) ? s : [...s, v].sort((a, b) => a - b)) }}>
        <BookmarkIcon size={20} filled={false} />
      </button>)}</span>
    const rest = (v: number) => live ? { onPointerEnter: (e: PointerEvent) => { if (e.pointerType === 'mouse' && fine) setReading(v) } } : {}
    return <>
      <h1 class="chapter-title"><span class="ct-book">{bookName(b)}</span> <span class="ct-num">{c}</span></h1>
      {live && reminder}
      {versions.length > 1 && (
        <div class="vrow-head">{versions.map(v => <div class="colhead" title={byId.get(v)?.name}>{v}</div>)}</div>
      )}
      {versions.length === 1 && settings.layout === 'paragraph' ? (
        <p class="para" dir={info?.rtl ? 'rtl' : undefined} lang={info?.lang}>
          {primary.books[b][c - 1].map((raw, i) => raw && (
            <span id={verse(i + 1).id} class={cls('pv', i + 1)} style={hl(i + 1)} onClick={verse(i + 1).onClick} {...rest(i + 1)}>
              <sup class="vn">{i + 1}</sup>{after(i + 1)}
              <span class="vt"><VerseText raw={raw} strongs={showStrongs} numbers={settings.strongsNumbers} onStrongs={lex} /></span>{tab(i + 1)}{' '}
            </span>
          ))}
        </p>
      ) : Array.from({ length: rowsOf }, (_, i) => (
        <div id={verse(i + 1).id} class={cls('verse', i + 1)} style={hl(i + 1)} onClick={verse(i + 1).onClick} {...rest(i + 1)}>
          {versions.map(v => {
            const raw = bibles[v].books[b]?.[c - 1]?.[i]
            const tv = byId.get(v)
            return (
              <div class="cell" dir={tv?.rtl ? 'rtl' : undefined} lang={tv?.lang}>
                <button class="vn" aria-label={t('Verse {v} options', { v: i + 1 })} tabIndex={live ? undefined : -1}>{i + 1}</button>{v === version && after(i + 1)}
                {raw ? <span class="vt"><VerseText raw={raw} strongs={showStrongs} numbers={settings.strongsNumbers} onStrongs={lex} /></span> : <span class="muted">—</span>}
                {v === version && tab(i + 1)}
              </div>
            )
          })}
        </div>
      ))}
    </>
  }

  return (
    <div class="reader">
      {error && <div class="center"><p class="error">{error}</p><p><button onClick={() => setRetry(n => n + 1)}>{t('Try again')}</button></p></div>}
      {!loaded && !error && <p class="muted center">{t('Loading…')}</p>}
      {loaded && rows === 0 && <p class="muted center">{t('{version} does not include {book} {chapter}.', { version: info?.name ?? version, book: bookName(book), chapter: String(chapter) })}</p>}

      {loaded && rows > 0 && (
        <article key={`${book}.${chapter}`} ref={article}
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
        <button onClick={() => turn(-1)}><span aria-hidden="true">‹</span> {t('Previous')}</button>
        <button onClick={() => turn(1)}>{t('Next')} <span aria-hidden="true">›</span></button>
      </nav>
      {info && <p class="credit muted small">{info.name}. {info.license}.</p>}

      {lex && <LexiconSheet num={lex} onClose={() => setLex(undefined)} onSearch={n => { setLex(undefined); go(`search?q=${n}&v=${versions.filter(v => byId.get(v)?.strongs).join(',') || 'KJV'}`) }} />}
      {selected.length > 0 && <SelectionBar book={book} chapter={chapter} verses={selected} versions={versions} bibles={bibles} onClose={() => setSelected([])}
        onNote={vs => { setSelected([]); openNote(vs) }} onPray={vs => { setSelected([]); prayOver({ book, chapter, verses: vs }) }} />}
      {picking && (
        <div class="pick-verse" role="region" aria-label={t('Verses for your prayer')}>
          <p class="pick-head"><span aria-hidden="true">{prayEmoji(settings)} </span>{t('Tap verses for your prayer')}</p>
          {picking.verses.length > 0 && <ul class="pick-list">
            {picking.verses.map(x => <li>
              <span>{verseLabel(x)}</span>
              <button class="pick-x" aria-label={t('Take {verse} off', { verse: verseLabel(x) })}
                onClick={() => pickVerses({ ...picking, verses: picking.verses.filter(y => y !== x) })}><CloseIcon size={18} /></button>
            </li>)}
          </ul>}
          <p class="pick-hint muted">{t('Turn the page, or search, to add verses from other chapters and books.')}</p>
          <div class="pick-btns">
            <button class="pick-btn" onClick={pickCancel}>{t('Cancel')}</button>
            <button class="pick-btn primary" onClick={pickDone}>{t('Done')}</button>
          </div>
        </div>
      )}
      {tied && <div class="pick-verse done" role="status">{tied}</div>}
      {noteFor && <NotesSheet book={book} chapter={chapter} version={version} {...noteFor} dir={info?.rtl ? 'rtl' : undefined} links={links} onGo={x => { setNoteFor(undefined); goNote(x) }}
        text={v => plain(primary?.books[book]?.[chapter - 1]?.[v - 1] ?? '')} onClose={() => setNoteFor(undefined)} />}
      {chapterSheet && (
        <Sheet title={`${t('Your notes')} · ${bookName(book)} ${chapter}`} onClose={() => setChapterSheet(false)}>
          {inChapter.length > 0 && <>
            <h3 class="notes-head">{t('In this chapter')}</h3>
            <NoteCards notes={inChapter} book={book} chapter={chapter} onPick={x => { setChapterSheet(false); toVerse(x.verse); setNoteFor({ verses: x.verses, start: { key: x.key, id: x.id } }) }} />
          </>}
          {elsewhere.length > 0 && <>
            <h3 class="notes-head">{t('From your other notes')}</h3>
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

export { verseRanges }

// A mouse or trackpad, not a finger.
const fine = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches

/** What you can do with some verses: marks, the quote and link, copying. */
function useVerseActions(book: string, chapter: number, verses: number[], versions: string[], bibles: Record<string, Bible>) {
  const { marks, setMarks } = useApp()
  const [note, setNote] = useState('')
  const version = versions[0]
  const keys = verses.map(v => markKey(book, chapter, v))
  const ref = `${bookName(book)} ${chapter}:${verseRanges(verses)}`
  const colors = new Set(keys.map(k => marks[k]?.c).filter(Boolean))
  const current = colors.size === 1 && keys.every(k => marks[k]?.c) ? [...colors][0] : undefined
  const allBookmarked = keys.every(k => marks[k]?.b)
  const hasNote = notesCovering(marks, book, chapter, verses[0]).length > 0
  const apply = (patch: { c?: string | null; b?: 1 | null }) => { setMarks(all => {
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
  // For someone else: numbered as everyone numbers it, to open in their Bible.
  const std = toStandard(bibles[version], { book, chapter, verses })
  const link = shareLink(`#/${sharedPath(version, std.book, std.chapter, std.verses[0])}`)
  const copy = async (s: string) => {
    try { await copyText(s); setNote(t('Copied')) } catch { setNote(t('Copy failed')) }
  }
  return { version, keys, ref, colors, current, allBookmarked, hasNote, apply, textOf, quote, link, copy, note, setNote }
}

// Shown while verses are selected: tap more verses to add them, then
// highlight, bookmark, copy, share or compare them together.
function SelectionBar({ book, chapter, verses, versions, bibles, onClose, onNote, onPray }: {
  book: string; chapter: number; verses: number[]; versions: string[]; bibles: Record<string, Bible>; onClose: () => void; onNote: (vs: number[]) => void
  onPray: (vs: number[]) => void
}) {
  const { settings, byId, data } = useApp()
  const [compare, setCompare] = useState<Bible[]>()
  const { version, ref, current, colors, allBookmarked, hasNote, apply, textOf, quote, link, copy, note } = useVerseActions(book, chapter, verses, versions, bibles)

  useEffect(() => {
    document.body.classList.add('selecting')
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => { document.body.classList.remove('selecting'); removeEventListener('keydown', onKey) }
  }, [])

  // A verse tapped low on the screen would sit under this bar: lift it into
  // view, never so far that its top goes under the top bar.
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = document.getElementById('v' + verses[0])
    if (!el || !bar.current) return
    const at = el.getBoundingClientRect(), over = at.bottom + 16 - bar.current.getBoundingClientRect().top
    if (over > 0) window.scrollBy({ top: Math.min(over, at.top - 90), behavior: 'smooth' })
  }, [])

  const showCompare = () => {
    const ids = settings.myVersions.filter(id => byId.get(id)?.books.includes(book))
    Promise.all(ids.map(id => data.bible(id))).then(setCompare)
  }

  return (
    <>
      <div class="selbar" ref={bar} role="toolbar" aria-label={t('{ref} selected', { ref })}>
        <div class="selbar-head">
          <strong>{ref}</strong>
          <span class="muted small">{verses.length > 1 ? tn(verses.length, '{n} verse', '{n} verses') : t('Tap more verses to add them')}</span>
          <span class="spacer" />
          <button class="close-btn" aria-label={t('Clear selection')} onClick={onClose}><CloseIcon size={22} /></button>
        </div>
        <div class="swatches" role="radiogroup" aria-label={t('Highlight color')}>
          {PALETTE.map(p => (
            <button role="radio" aria-checked={current === p.color} aria-label={t(p.name)} class={'swatch' + (current === p.color ? ' on' : '')}
              style={{ background: p.color }} onClick={() => { if (current !== p.color) rememberColor(p.color); apply({ c: current === p.color ? null : p.color }); onClose() }}>
              {current === p.color && <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#222" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg>}
            </button>
          ))}
          {colors.size > 0 && <button class="swatch none" aria-label={t('Remove highlight')} onClick={() => { apply({ c: null }); onClose() }}>✕</button>}
        </div>
        <div class="actions">
          <button class={allBookmarked ? 'on' : ''} aria-pressed={allBookmarked} onClick={() => { apply({ b: allBookmarked ? null : 1 }); onClose() }}>
            <BookmarkIcon size={22} class="bm-icon" filled={allBookmarked} /><span>{allBookmarked ? t('Saved') : t('Bookmark')}</span>
          </button>
          <button class={hasNote ? 'on' : ''} onClick={() => onNote(verses)}><NoteIcon size={22} /><span>{t('Note')}</span></button>
          {canListen && <button onClick={() => { startListening({ version, lang: byId.get(version)?.lang ?? 'en', book, chapter, verse: verses[0] }, bibles[version]); onClose() }}>
            <SpeakerIcon size={22} /><span>{t('Listen')}</span></button>}
          <button onClick={() => copy(quote)}><CopyIcon size={22} /><span>{t('Copy')}</span></button>
          {canShare
            ? <button onClick={() => share({ title: ref, text: quote, url: link })}><ShareIcon size={22} /><span>{t('Share')}</span></button>
            : <button onClick={() => copy(link)}><LinkIcon size={22} /><span>{t('Link')}</span></button>}
          <button onClick={showCompare}><CompareIcon size={22} /><span>{t('Compare')}</span></button>
          <button onClick={() => onPray(verses)}><span class="selbar-pray" aria-hidden="true">{prayEmoji(settings)}</span><span>{t('Pray')}</span></button>
          {inCircles() && <button onClick={() => { shareWithCircle({ verse: { book, chapter, verses }, version, text: textOf(bibles[version]) }); onClose() }}><CircleIcon size={22} /><span>{t('Circle')}</span></button>}
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
export function NotesSheet({ book, chapter, version, verses, start, text, dir, links, onGo, onClose }: NotesTarget & {
  book: string; chapter: number; version?: string; text: (v: number) => string; dir?: 'rtl'; links?: NoteLinks; onGo?: (x: LinkedNote) => void; onClose: () => void
}) {
  const { marks, settings } = useApp()
  // A note can go to your circle as it is, with the verses it's on.
  const share = inCircles() ? (note: string, vs: number[]) => {
    shareWithCircle({ verse: { book, chapter, verses: vs }, version: version ?? settings.version, text: vs.map(v => text(v)).filter(Boolean).join(' '), note })
  } : undefined
  const list = verses.length === 1
    ? notesCovering(marks, book, chapter, verses[0])
    : notesCovering(marks, book, chapter, verses[0]).filter(x => x.verses.join() === verses.join())
  const fresh = () => ({ key: markKey(book, chapter, verses[0]), id: newNoteId(), verses })
  const [editing, setEditing] = useState<{ key: string; id: string; verses: number[] } | undefined>(() => {
    if (start === 'new' || !list.length) return fresh()
    if (start) return { ...start, verses: list.find(x => x.id === start.id)?.verses ?? verses }
  })
  const fromList = useRef(!editing)
  const ref = (vs: number[]) => `${bookName(book)} ${chapter}:${verseRanges(vs)}`
  const passage = (vs: number[]) => <Passage verses={vs} text={text} dir={dir} />
  const done = () => fromList.current ? setEditing(undefined) : onClose()
  return (
    <Sheet title={editing ? `${t('Note')} · ${ref(editing.verses)}` : `${list.length > 1 ? t('Notes') : t('Note')} · ${ref(verses)}`} onClose={onClose}>
      {editing ? <NoteEditor key={editing.id} at={editing.key} id={editing.id} verses={editing.verses} passage={passage(editing.verses)} onDone={done} onShare={share} /> : <>
      {passage(verses)}
      <ul class="note-list">
        {list.map(x => (
          <li><button class="note-card" onClick={() => setEditing(x)}>
            <span class="nc-meta muted small">
              {x.verses.join() !== verses.join() && <strong>{ref(x.verses)} · </strong>}
              {new Date(x.c).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: new Date(x.c).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })}
            </span>
            <span class="nc-text">{x.n}</span>
          </button></li>
        ))}
      </ul>
      <div class="row">
        <button class="primary" onClick={() => setEditing(fresh())}>+ {t('Add note')}</button>
      </div>
      {links && onGo && (() => {
        const more = related(links, book, chapter, list, verses)
        return more.length > 0 && <>
          <h3 class="notes-head">{t('Also in your notes')}</h3>
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
              ? `${bookName(x.book)} ${x.chapter}:${verseRanges(x.verses)}`
              : `${x.verses.length > 1 ? t('Verses') : t('Verse')} ${verseRanges(x.verses)}`}</strong>
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
        {full ? t('Show less') : shown.length > 1 ? t('Show all {n} verses', { n: shown.length }) : t('Show all of the verse')}</button>}
    </figure>
  )
}

/** Write, edit or delete one note (on the mark `at`). */
function NoteEditor({ at: markK, id, verses, passage, onDone, onShare }: {
  at: string; id: string; verses: number[]; passage: ComponentChildren; onDone: () => void; onShare?: (note: string, verses: number[]) => void
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
  useEffect(() => { const timer = setTimeout(() => save(draft), 600); return () => clearTimeout(timer) }, [draft])
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
      <textarea ref={area} class="note-text" rows={6} placeholder={verses.length > 1 ? t('Write a note on these verses…') : t('Write a note on this verse…')} value={draft}
        onInput={e => setDraft((e.target as HTMLTextAreaElement).value)} />
      <div class="row">
        <button class="primary" onClick={onDone}>{t('Done')}</button>
        {onShare && draft.trim() && <button onClick={() => { save(draft); onShare(draft.trim(), verses) }}><CircleIcon size={18} /> {t('Share with circle')}</button>}
        {saved.current && <button onClick={() => { latest.current = ''; save(''); onDone() }}>{t('Delete note')}</button>}
      </div>
    </>
  )
}
