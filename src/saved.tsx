// Your highlights, notes and bookmarks, each on its own tab, shown in the
// version you read. Notes and bookmarks open with the most recent first.
import { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Bible } from './lib/data'
import { compareKeys, hasContent, Mark, Marks, notesOf, PALETTE, parseKey, tidy } from './lib/marks'
import { NotesSheet, NotesTarget, verseRanges } from './reader'
import { BookmarkIcon, EditIcon, HighlightIcon, NoteIcon, TrashIcon } from './icons'
import { bookName } from './lib/books'
import { plain } from './lib/text'
import { readPath, useApp } from './state'
import { N_, t } from './i18n'
import { NO_SWIPE, swipeAxis, swipeGoes, swipeTo } from './lib/tabswipe'

const PAGE = 60
/** How many cards the lists beside yours show, ready to slide in. */
const PEEK = 12
/** The space between two lists while they slide. */
const GAP = 24
const TAB = 'plain-bible:saved-tab'
type Tab = 'highlights' | 'notes' | 'bookmarks'
const TABS: readonly Tab[] = ['highlights', 'notes', 'bookmarks']

/** Verses next to each other in one color read as one highlight. */
interface Run { keys: string[]; book: string; chapter: number; verses: number[]; color: string }
function runsOf(keys: string[], marks: Marks): Run[] {
  const out: Run[] = []
  for (const k of keys) {
    const c = marks[k].c
    if (!c) continue
    const r = parseKey(k), last = out[out.length - 1]
    if (last && last.book === r.book && last.chapter === r.chapter && last.color === c && last.verses[last.verses.length - 1] === r.verse - 1) {
      last.keys.push(k); last.verses.push(r.verse)
    } else out.push({ keys: [k], book: r.book, chapter: r.chapter, verses: [r.verse], color: c })
  }
  return out
}

/** Lower case and without accents, so "priere" finds "Prière". */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/** With `onImport`, it's a page of Settings: no title of its own, and the
 *  import link opens Your data there. */
export function Saved({ onImport }: { onImport?: () => void } = {}) {
  const { marks, setMarks, settings, data, byId } = useApp()
  const [bible, setBible] = useState<Bible>()
  // The version isn't on the device and there's no connection to fetch it.
  const [missing, setMissing] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<NotesTarget & { key: string }>()
  // The highlight whose colors are open.
  const [recolor, setRecolor] = useState<string>()
  const [color, setColor] = useState('all')
  const [find, setFind] = useState('')
  const [recent, setRecent] = useState(true)
  // What was just removed, to put back.
  const [undo, setUndo] = useState<{ what: string; before: Marks }>()
  const [askBm, setAskBm] = useState<string>()
  const version = settings.version
  const rtl = byId.get(version)?.rtl ? 'rtl' as const : undefined
  useEffect(() => { document.title = t('Saved') + ' · My Quiet Bible'; setMissing(false); data.bible(version).then(setBible, () => setMissing(true)) }, [version])

  const keys = useMemo(() => Object.keys(marks).filter(k => hasContent(marks[k])).sort(compareKeys), [marks])
  const runs = useMemo(() => runsOf(keys, marks), [keys])
  const notes = useMemo(() => keys.flatMap(key => {
    const r = parseKey(key)
    return notesOf(marks[key]).map(x => ({ ...x, key, book: r.book, chapter: r.chapter, verses: x.v ?? [r.verse] }))
  }), [keys])
  const bookmarks = useMemo(() => keys.filter(k => marks[k].b), [keys])
  const counts: Record<Tab, number> = { highlights: runs.length, notes: notes.length, bookmarks: bookmarks.length }

  const [tab, setTabState] = useState<Tab>(() => {
    let last: string | null = null
    try { last = localStorage.getItem(TAB) } catch { /* private mode */ }
    // Open on the tab you used last, if it still has something in it.
    if ((last === 'highlights' || last === 'notes' || last === 'bookmarks') && counts[last]) return last
    return (['highlights', 'notes', 'bookmarks'] as Tab[]).find(x => counts[x]) ?? 'highlights'
  })
  const shownTab = tab
  const setTab = (to: Tab) => {
    setTabState(to); setLimit(PAGE); setRecolor(undefined); setUndo(undefined); setFind('')
    try { localStorage.setItem(TAB, to) } catch { /* private mode */ }
  }

  // The three lists lie side by side like pages. A swipe drags the row of
  // them with the finger, so the next list comes in under it as the one
  // you're on goes out; let go and it carries on at the finger's speed and
  // settles, and the tabs above follow. Tapping a tab slides the same way.
  // A two-finger swipe on a trackpad does it too. Up and down stays a scroll.
  const root = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null), tabBar = useRef<HTMLDivElement>(null)
  // How far down the list beside was drawn, to keep it in place once it's yours.
  const landed = useRef<number>()
  const busy = useRef(false)
  const now = useRef({ tab, setTab, busy: !!editing || !!askBm })
  now.current = { tab, setTab, busy: !!editing || !!askBm }
  const uiRtl = () => document.documentElement.dir === 'rtl'
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  /** What scrolls the lists: the Settings sheet, or the page. */
  const scroller = (): HTMLElement => {
    for (let x = root.current?.parentElement; x; x = x.parentElement) {
      const o = getComputedStyle(x).overflowY
      if ((o === 'auto' || o === 'scroll') && x.scrollHeight > x.clientHeight) return x
    }
    return document.scrollingElement as HTMLElement
  }
  /** Lists beside yours are drawn level with the top of what you see, so
   *  far down a long list the next one still slides in from its top. */
  const peekAt = () => {
    const tr = track.current
    if (!tr) return 0
    const sc = scroller()
    // Below the bar that stays at the top: the app's, or the sheet's own.
    const bar = sc === document.scrollingElement ? document.querySelector('header.top') : sc.querySelector('.settings-head')
    const top = Math.max(0, sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top, bar?.getBoundingClientRect().bottom ?? 0)
    const y = Math.max(0, Math.round(top - tr.getBoundingClientRect().top))
    tr.style.setProperty('--peek-y', y + 'px')
    return y
  }
  const width = () => (track.current?.offsetWidth || innerWidth) + GAP
  const move = (x: number, ms = 0, ease = 'cubic-bezier(.25, .8, .25, 1)') => {
    const tr = track.current
    if (!tr) return
    tr.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none'
    tr.style.transform = x ? `translate3d(${x}px,0,0)` : ''
  }
  /** Carry on to the list beside, from `dx`, at about `v` px/ms. */
  const settle = (to: Tab, dx: number, v: number) => {
    const tr = track.current
    const way = (TABS.indexOf(to) > TABS.indexOf(now.current.tab) ? -1 : 1) * (uiRtl() ? -1 : 1)
    const target = way * width(), dist = Math.abs(target - dx)
    // The curve starts about three times faster than its average, so this
    // picks up at the speed the finger let go.
    const ms = still() ? 0 : Math.round(Math.min(380, Math.max(180, 3.2 * dist / Math.max(Math.abs(v), .6))))
    // The tab lights up as the list starts on its way.
    tabBar.current?.querySelectorAll('[role="tab"]').forEach((b, i) => b.classList.toggle('on', TABS[i] === to))
    busy.current = true
    const y = parseFloat(tr?.style.getPropertyValue('--peek-y') || '0') || 0
    let done = false
    const land = () => { if (done) return; done = true; busy.current = false; landed.current = y; now.current.setTab(to) }
    if (!ms || !tr) return land()
    move(target, ms)
    tr.addEventListener('transitionend', land, { once: true })
    setTimeout(land, ms + 80)
  }
  const springBack = () => move(0, still() ? 0 : 260, 'cubic-bezier(.2, .9, .3, 1.1)')
  const pick = (to: Tab) => {
    if (to === tab || busy.current) return
    if (Math.abs(TABS.indexOf(to) - TABS.indexOf(tab)) === 1) { peekAt(); settle(to, 0, 1.2) }
    // Two lists over: it simply comes up in place.
    else { landed.current = undefined; setTab(to) }
  }
  useLayoutEffect(() => {
    const tr = track.current, y = landed.current
    landed.current = undefined
    if (!tr) return
    move(0)
    tr.style.removeProperty('--peek-y')
    // The list that slid in was drawn level with the top of the view: keep it
    // just where it is now that it's the list on the page.
    if (y) scroller().scrollTop -= y
  }, [tab])
  useEffect(() => {
    const el = root.current
    if (!el) return
    /** Not for us: typing, buttons that need a still finger, or a sheet
     *  (like editing a note) opened from inside the list. */
    const mine = (target: EventTarget | null) => {
      const x = target as Element | null
      if (!x?.closest || busy.current || now.current.busy || x.closest(NO_SWIPE)) return false
      const sheet = x.closest('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]')
      return !(sheet && el.contains(sheet))
    }
    /** Where the row is drawn for a drag of `dx`: past the first or last
     *  list it only gives a little. */
    const at = (dx: number) => swipeTo(TABS, now.current.tab, dx, uiRtl()) ? dx : dx / (1 + Math.abs(dx) / 120) * .5
    let s: { x: number; y: number; axis?: 'x' | 'y'; dx: number; pts: [number, number][] } | undefined
    const stop = () => {
      s = undefined
      removeEventListener('touchmove', onMove); removeEventListener('touchend', end); removeEventListener('touchcancel', cancel)
    }
    const onMove = (e: TouchEvent) => {
      if (!s) return
      if (e.touches.length > 1) return cancel()
      const p = e.touches[0], dx = p.clientX - s.x
      if (!s.axis) {
        s.axis = swipeAxis(dx, p.clientY - s.y)
        if (s.axis === 'y') return stop()
        if (!s.axis) return
        // Start from where the finger is now, so the list doesn't jump.
        s.x = p.clientX; peekAt()
      }
      // Sideways: the lists follow the finger and the page doesn't scroll.
      if (e.cancelable) e.preventDefault()
      s.dx = p.clientX - s.x
      s.pts.push([e.timeStamp, p.clientX]); if (s.pts.length > 6) s.pts.shift()
      move(at(s.dx))
    }
    const end = (e: TouchEvent) => {
      const was = s
      stop()
      if (was?.axis !== 'x') return
      // The finger's speed over its last few moves, in px/ms.
      const recent = was.pts.filter(([t]) => e.timeStamp - t < 100)
      const v = recent.length > 1 ? (recent[recent.length - 1][1] - recent[0][1]) / Math.max(1, recent[recent.length - 1][0] - recent[0][0]) : 0
      const to = swipeTo(TABS, now.current.tab, was.dx, uiRtl())
      if (to && swipeGoes(was.dx, v, width())) settle(to, was.dx, v)
      else springBack()
    }
    // Taken away (a call, a system swipe): the list goes back.
    const cancel = () => { const was = s; stop(); if (was?.axis === 'x') springBack() }
    const down = (e: TouchEvent) => {
      stop()
      if (e.touches.length !== 1 || !mine(e.target)) return
      const p = e.touches[0]
      s = { x: p.clientX, y: p.clientY, dx: 0, pts: [] }
      addEventListener('touchmove', onMove, { passive: false })
      addEventListener('touchend', end)
      addEventListener('touchcancel', cancel)
    }

    // Trackpad: a gesture is a scroll or a swipe, decided from its first few
    // pixels. After a slide the Mac keeps sending the swipe's fading glide;
    // that's ignored until it stops, or a new, stronger swipe begins.
    let w = { sx: 0, sy: 0, px: 0, axis: '', last: 0, done: false, low: 0, peak: 0, timer: 0 }
    const wheel = (e: WheelEvent) => {
      const t = Date.now(), ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY)
      if (t - w.last > 200) { clearTimeout(w.timer); w = { sx: 0, sy: 0, px: 0, axis: '', last: t, done: false, low: 0, peak: 0, timer: 0 } }
      w.last = t
      if (w.done) {
        if (!busy.current && ax > Math.max(w.low * 2, w.low + 6) && w.low <= w.peak / 2) { w.done = false; w.px = 0; w.peak = 0; w.axis = 'x'; peekAt() }
        else { w.low = Math.min(w.low, ax); if (w.axis === 'x') e.preventDefault(); return }
      }
      if (!w.axis) {
        if (!mine(e.target)) return
        w.sx += ax; w.sy += ay
        if (w.sx + w.sy < 12) return
        w.axis = w.sx > w.sy * 2 ? 'x' : 'y'
        if (w.axis === 'x') peekAt()
      }
      if (w.axis !== 'x') return
      e.preventDefault()
      w.px += e.deltaX; w.peak = Math.max(w.peak, ax)
      const dx = -w.px, to = swipeTo(TABS, now.current.tab, dx, uiRtl())
      move(at(dx))
      clearTimeout(w.timer)
      // The fingers lifted without going far enough: the list goes back.
      w.timer = window.setTimeout(() => { if (!w.done) springBack(); w.axis = ''; w.px = 0 }, 160)
      if (to && Math.abs(dx) > Math.min(el.offsetWidth * .22, 100)) {
        w.done = true; w.low = w.peak; clearTimeout(w.timer)
        settle(to, dx, 1.2)
      }
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    return () => { el.removeEventListener('touchstart', down); el.removeEventListener('wheel', wheel); clearTimeout(w.timer); stop() }
  }, [!keys.length])
  useEffect(() => setLimit(PAGE), [color, find, recent])

  const verseText = (book: string, chapter: number, vs: number[]) => vs.map(v => {
    const raw = bible?.books[book]?.[chapter - 1]?.[v - 1]
    return raw ? plain(raw) : ''
  }).filter(Boolean).join(' ')
  const refOf = (book: string, chapter: number, vs: number[]) => `${bookName(book)} ${chapter}:${verseRanges(vs)}`
  const Ref = ({ book, chapter, verses }: { book: string; chapter: number; verses: number[] }) =>
    <a class="ref" href={'#/' + readPath(version, book, chapter, verses[0])}>{refOf(book, chapter, verses)}</a>
  /** The verses as the reader shows them: each on its own line, with its
   *  number in the same thick style, so a passage reads like the Bible. */
  const Text = ({ book, chapter, verses }: { book: string; chapter: number; verses: number[] }) => {
    const lines = verses.map(v => [v, bible?.books[book]?.[chapter - 1]?.[v - 1]] as const).filter(([, raw]) => raw)
    if (!lines.length) return <p class="saved-text" dir={rtl}>{bible && <span class="muted">{t('Not in {version}', { version })}</span>}</p>
    return (
      <div class="saved-text" dir={rtl}>
        {lines.map(([v, raw]) => <p class="sv"><span class="vn" aria-hidden="true">{v}</span>{plain(raw!)}</p>)}
      </div>
    )
  }

  /** Change some verses' marks, keeping what they were so it can be undone. */
  const change = (ks: string[], patch: Partial<Mark>, what?: string) => {
    const before: Marks = {}
    for (const k of ks) before[k] = marks[k]
    setMarks(m => {
      const out = { ...m }, now = Date.now()
      for (const k of ks) {
        const next = { ...m[k], ...patch, t: now } as Record<string, unknown>
        for (const [f, v] of Object.entries(patch)) if (v === undefined) delete next[f]
        out[k] = tidy(next as unknown as Mark)
      }
      return out
    })
    setUndo(what ? { what, before } : undefined)
  }
  const putBack = () => {
    if (!undo) return
    const now = Date.now()
    // Only the highlight and bookmark come back; notes were never touched.
    setMarks(m => {
      const out = { ...m }
      for (const [k, was] of Object.entries(undo.before)) out[k] = tidy({ ...m[k], c: was.c, b: was.b, t: now } as Mark)
      return out
    })
    setUndo(undefined)
  }

  if (!keys.length) {
    return (
      <div class="saved">
        {!onImport && <h1>{t('Saved')}</h1>}
        <p class="muted">{t('Nothing saved yet. Tap any verse while reading to highlight, bookmark or add a note to it.')}{' '}
          {t('Coming from another app?')} {onImport ? <><button class="link" onClick={onImport}>{t('Import your highlights')}</button> {t('under Your data.')}</> : <><a href="#/settings">{t('Import your highlights')}</a> {t('in Settings.')}</>}</p>
      </div>
    )
  }

  const tabs: [Tab, string, ComponentChildren][] = [
    ['highlights', t('Highlights'), <HighlightIcon size={24} />],
    ['notes', t('Notes'), <NoteIcon size={24} />],
    ['bookmarks', t('Bookmarks'), <BookmarkIcon size={24} filled={false} />],
  ]
  const more = (n: number, lim: number) => n > lim && <button class="more" onClick={() => setLimit(l => l + PAGE)}>{t('Show more ({n} left)', { n: n - lim })}</button>
  const emptyOf = (which: Tab) => t({
    highlights: N_('No highlights yet. Tap a verse while reading and pick a color, or tap a verse twice quickly.'),
    notes: N_('No notes yet. Tap a verse while reading, then the note button, to write one.'),
    bookmarks: N_('No bookmarks yet. Tap a verse while reading, then Bookmark.'),
  }[which])

  /** Find box and order, on the notes and bookmarks tabs. */
  const tools = (placeholder: string, active: boolean) => (
    <div class="saved-tools">
      <input type="search" class="saved-find" placeholder={placeholder} value={active ? find : ''} onInput={e => setFind((e.target as HTMLInputElement).value)} />
      <div class="seg" role="radiogroup" aria-label={t('Order')}>
        <button role="radio" aria-checked={recent} class={recent ? 'on' : ''} onClick={() => setRecent(true)}>{t('Recent')}</button>
        <button role="radio" aria-checked={!recent} class={!recent ? 'on' : ''} onClick={() => setRecent(false)}>{t('Bible order')}</button>
      </div>
    </div>
  )
  /** One tab's list. The lists beside the one you're on are drawn too, a
   *  little shorter, so a swipe shows them coming in under the finger. */
  const bodyOf = (which: Tab, active: boolean) => {
  if (!counts[which]) return <p class="muted">{emptyOf(which)}</p>
  const f = active ? find : '', lim = active ? limit : PEEK
  let body
  if (which === 'highlights') {
    const used = PALETTE.map(p => p.color).filter(c => runs.some(r => r.color === c))
    const colors = [...used, ...[...new Set(runs.map(r => r.color))].filter(c => !used.includes(c))]
    const shown = runs.filter(r => color === 'all' || r.color === color)
    body = <>
      {colors.length > 1 && (
        <div class="chips saved-colors">
          <button class={'chip' + (color === 'all' ? ' on' : '')} onClick={() => setColor('all')}>{t('All')}</button>
          {colors.map(c => (
            <button class={'chip swatch-chip' + (color === c ? ' on' : '')} onClick={() => setColor(c)} aria-label={t('{color} highlights', { color: t(PALETTE.find(p => p.color === c)?.name ?? c) })}>
              <span class="dot" style={{ background: c }} />{runs.filter(r => r.color === c).length}
            </button>
          ))}
        </div>
      )}
      <ol class="saved-list">
        {shown.slice(0, lim).map(r => {
          const id = r.keys[0], ref = refOf(r.book, r.chapter, r.verses)
          return (
            <li class="hl" style={{ '--hl': r.color }}>
              <div class="saved-head">
                <Ref {...r} />
                <span class="spacer" />
                <button class={'saved-act' + (active && recolor === id ? ' on' : '')} aria-expanded={active && recolor === id} onClick={() => setRecolor(active && recolor === id ? undefined : id)}>
                  <span class="dot big" style={{ background: r.color }} />{t('Color')}
                </button>
              </div>
              <Text {...r} />
              {active && recolor === id && (
                <div class="saved-palette">
                  <div class="swatches">
                    {PALETTE.map(p => (
                      <button class={'swatch' + (p.color === r.color ? ' on' : '')} style={{ background: p.color }} aria-label={t(p.name)}
                        onClick={() => { change(r.keys, { c: p.color }); setRecolor(undefined) }} />
                    ))}
                  </div>
                  <button class="saved-remove" onClick={() => { change(r.keys, { c: undefined }, t('Highlight on {ref} removed.', { ref })); setRecolor(undefined) }}>
                    <TrashIcon size={20} /> {t('Remove highlight')}
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {more(shown.length, lim)}
    </>
  } else if (which === 'notes') {
    const q = fold(f.trim())
    const list = notes.filter(x => !q || fold(x.n).includes(q) || fold(refOf(x.book, x.chapter, x.verses)).includes(q))
    if (recent) list.sort((a, b) => b.t - a.t)
    body = <>
      {notes.length > 3 && tools(t('Find in your notes'), active)}
      {!list.length && <p class="muted">{t('No note has “{words}” in it.', { words: f.trim() })}</p>}
      <ol class="saved-list">
        {list.slice(0, lim).map(x => {
          const open = () => setEditing({ key: x.key, verses: x.verses, start: { key: x.key, id: x.id } })
          return (
            <li>
              <div class="saved-head">
                <Ref {...x} />
                <span class="spacer" />
                <button class="saved-act" onClick={open}><EditIcon size={20} />{t('Edit')}</button>
              </div>
              <Text {...x} />
              <p class="saved-note" onClick={open}>{x.n}</p>
            </li>
          )
        })}
      </ol>
      {more(list.length, lim)}
    </>
  } else {
    const q = fold(f.trim())
    const list = bookmarks.filter(k => {
      if (!q) return true
      const r = parseKey(k)
      return fold(refOf(r.book, r.chapter, [r.verse])).includes(q) || fold(verseText(r.book, r.chapter, [r.verse])).includes(q)
    })
    // A bookmark has no time of its own; its verse's last change stands in.
    if (recent) list.sort((a, b) => marks[b].t - marks[a].t)
    body = <>
      {bookmarks.length > 3 && tools(t('Find in your bookmarks'), active)}
      {!list.length && <p class="muted">{t('No bookmark has “{words}” in it.', { words: f.trim() })}</p>}
      <ol class="saved-list">
        {list.slice(0, lim).map(k => {
          const r = parseKey(k), vs = [r.verse]
          return (
            <li>
              <div class="saved-head">
                <span class="bm-mark" aria-hidden="true"><BookmarkIcon /></span>
                <Ref book={r.book} chapter={r.chapter} verses={vs} />
                <span class="spacer" />
                <button class="saved-act" onClick={() => setAskBm(k)}>
                  <TrashIcon size={20} />{t('Remove')}
                </button>
              </div>
              {active && askBm === k && <div class="confirm-card danger" role="alertdialog" aria-labelledby={'bm-' + k}>
                <p id={'bm-' + k} class="confirm-title"><strong>{t('Remove this bookmark?')}</strong></p>
                <div class="confirm-buttons">
                  <button class="leave-confirm" onClick={() => { setAskBm(undefined); change([k], { b: undefined }, t('Bookmark on {ref} removed.', { ref: refOf(r.book, r.chapter, vs) })) }}>{t('Remove bookmark')}</button>
                  <button onClick={() => setAskBm(undefined)}>{t('Cancel')}</button>
                </div>
              </div>}
              <Text book={r.book} chapter={r.chapter} verses={vs} />
            </li>
          )
        })}
      </ol>
      {more(list.length, lim)}
    </>
  }
  return body
  }

  return (
    <div class="saved saved-swipe" ref={root}>
      {!onImport && <h1>{t('Saved')}</h1>}
      <div class="saved-tabs" role="tablist" ref={tabBar}>
        {tabs.map(([id, label, icon]) => (
          <button role="tab" aria-selected={shownTab === id} class={shownTab === id ? 'on' : ''} onClick={() => pick(id)}>
            {icon}<span class="st-label">{label}</span><span class="st-count">{counts[id]}</span>
          </button>
        ))}
      </div>
      {missing && <p class="note">{t('{version} isn’t saved on this device yet, so the verses can’t be shown. Connect to the internet once and they will be.', { version })}</p>}
      {undo && <div class="saved-undo" role="status"><span>{undo.what}</span><button onClick={putBack}>{t('Undo')}</button></div>}
      <div class="saved-track" ref={track}>
        {TABS.map((id, i) => {
          const d = i - TABS.indexOf(shownTab)
          if (Math.abs(d) > 1) return null
          return d === 0
            ? <div key={id} class="saved-page">{bodyOf(id, true)}</div>
            : <div key={id} class="saved-page beside" style={{ '--side': uiRtl() ? -d : d }} inert aria-hidden="true">{bodyOf(id, false)}</div>
        })}
      </div>
      {editing && (() => {
        const r = parseKey(editing.key)
        return <NotesSheet book={r.book} chapter={r.chapter} verses={editing.verses} start={editing.start} dir={rtl}
          text={v => plain(bible?.books[r.book]?.[r.chapter - 1]?.[v - 1] ?? '')} onClose={() => setEditing(undefined)} />
      })()}
    </div>
  )
}
