// Your highlights, notes and bookmarks, each on its own tab, shown in the
// version you read. Notes and bookmarks open with the most recent first.
import { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Bible } from './lib/data'
import { afterUsing, colorsByUse, compareKeys, hasContent, Mark, Marks, notesOf, PALETTE, parseKey, tidy } from './lib/marks'
import { NotesSheet, NotesTarget, verseRanges } from './reader'
import { BookmarkIcon, EditIcon, HighlightIcon, NoteIcon, TrashIcon } from './icons'
import { bookName } from './lib/books'
import { plain } from './lib/text'
import { readPath, useApp } from './state'
import { N_, t } from './i18n'

const PAGE = 60
/** How many cards the lists beside yours show, ready to slide in. */
const PEEK = 12
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
  const { marks, setMarks, settings, update, data, byId } = useApp()
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
  const rtl = byId.get(version)?.rtl ? 'rtl' as const : 'ltr' as const
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

  // The three lists lie side by side in a row that scrolls sideways, and
  // snaps to one list at a time. The phone itself moves the row with the
  // finger, carries a flick on and settles it, the same way it scrolls
  // anything, so a slow drag can never stall half way. The tab lights up as
  // a list passes half way, and becomes yours once the row comes to rest.
  // Trackpad swipes and tab taps scroll the same row. Up and down stays the
  // page's scroll.
  const root = useRef<HTMLDivElement>(null), row = useRef<HTMLDivElement>(null), tabBar = useRef<HTMLDivElement>(null)
  // How far down the list beside was drawn, to keep it in place once it's yours.
  const landed = useRef<number>()
  const nowTab = useRef(tab)
  nowTab.current = tab
  /** What scrolls the lists up and down: the Settings sheet, or the page. */
  const scroller = (): HTMLElement => {
    for (let x = root.current?.parentElement; x; x = x.parentElement) {
      const o = getComputedStyle(x).overflowY
      if ((o === 'auto' || o === 'scroll') && x.scrollHeight > x.clientHeight) return x
    }
    return document.scrollingElement as HTMLElement
  }
  /** Before the row moves: the lists beside are drawn level with the top
   *  of what you see (far down a long list the next one still comes in from
   *  its top), and tall enough to fill the screen. */
  const ready = () => {
    const r = row.current
    if (!r || r.classList.contains('moving')) return
    const sc = scroller(), page = sc === document.scrollingElement
    // Below the bar that stays at the top: the app's, or the sheet's own.
    const bar = page ? document.querySelector('header.top') : sc.querySelector('.settings-head')
    const top = Math.max(0, page ? 0 : sc.getBoundingClientRect().top, bar?.getBoundingClientRect().bottom ?? 0)
    const y = Math.max(0, Math.round(top - r.getBoundingClientRect().top))
    r.style.setProperty('--peek-y', y + 'px')
    r.style.setProperty('--room', y + innerHeight + 'px')
    r.classList.add('moving')
  }
  const rest = () => {
    const r = row.current
    if (!r) return
    r.classList.remove('moving'); r.style.removeProperty('--peek-y'); r.style.removeProperty('--room')
  }
  const pick = (to: Tab) => {
    const r = row.current, el = r?.children[TABS.indexOf(to)] as HTMLElement | undefined
    if (!r || !el || to === tab) return
    ready()
    r.scrollTo({ left: el.offsetLeft - (r.firstElementChild as HTMLElement).offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  // The row shows your list: at first, and after a tab changes.
  useLayoutEffect(() => {
    const r = row.current, y = landed.current
    landed.current = undefined
    if (!r) return
    rest()
    const at = (r.children[TABS.indexOf(tab)] as HTMLElement | undefined)?.offsetLeft ?? 0
    const first = (r.firstElementChild as HTMLElement | null)?.offsetLeft ?? 0
    r.scrollLeft = at - first
    // The list that slid in was drawn level with the top of the view: keep it
    // just where it is now that it's the list on the page.
    if (y) scroller().scrollTop -= y
  }, [tab, !keys.length])
  useEffect(() => {
    const r = row.current
    if (!r) return
    let touching = 0, timer = 0
    const step = () => { const a = r.children[0] as HTMLElement, b = r.children[1] as HTMLElement | undefined; return b ? b.offsetLeft - a.offsetLeft : r.clientWidth }
    const index = () => Math.max(0, Math.min(TABS.length - 1, Math.round(r.scrollLeft / step())))
    const light = (i: number) => tabBar.current?.querySelectorAll('[role="tab"]').forEach((b, j) => b.classList.toggle('on', j === i))
    /** The row has come to rest on a list: it becomes yours. */
    const settle = () => {
      clearTimeout(timer)
      if (touching) return
      const i = index()
      // Still gliding to its place.
      if (Math.abs(r.scrollLeft - i * step()) > 2) { timer = window.setTimeout(settle, 120); return }
      const to = TABS[i]
      if (to === nowTab.current) { rest(); light(i); return }
      landed.current = parseFloat(r.style.getPropertyValue('--peek-y')) || 0
      setTab(to)
    }
    const onScroll = () => {
      ready()
      light(index())
      clearTimeout(timer)
      timer = window.setTimeout(settle, 140)
    }
    const down = (e: TouchEvent) => { touching = e.touches.length; ready() }
    const up = (e: TouchEvent) => { touching = e.touches.length; clearTimeout(timer); timer = window.setTimeout(settle, 140) }
    const wheel = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) ready() }
    r.addEventListener('scroll', onScroll, { passive: true })
    r.addEventListener('scrollend', settle)
    r.addEventListener('touchstart', down, { passive: true })
    r.addEventListener('touchend', up, { passive: true })
    r.addEventListener('touchcancel', up, { passive: true })
    r.addEventListener('wheel', wheel, { passive: true })
    return () => {
      clearTimeout(timer)
      r.removeEventListener('scroll', onScroll); r.removeEventListener('scrollend', settle)
      r.removeEventListener('touchstart', down); r.removeEventListener('touchend', up); r.removeEventListener('touchcancel', up)
      r.removeEventListener('wheel', wheel)
    }
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

  /** The whole verse opens it in the reader, not only the small reference. */
  const OpenText = ({ book, chapter, verses }: { book: string; chapter: number; verses: number[] }) =>
    <a class="saved-open" href={'#/' + readPath(version, book, chapter, verses[0])}><Text book={book} chapter={chapter} verses={verses} /></a>

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
    const used = colorsByUse(settings.recentColors).map(p => p.color).filter(c => runs.some(r => r.color === c))
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
              <OpenText {...r} />
              {active && recolor === id && (
                <div class="saved-palette">
                  <div class="swatches">
                    {colorsByUse(settings.recentColors).map(p => (
                      <button class={'swatch' + (p.color === r.color ? ' on' : '')} style={{ background: p.color }} aria-label={t(p.name)}
                        onClick={() => { if (p.color !== r.color) update({ recentColors: afterUsing(settings.recentColors, p.color) }); change(r.keys, { c: p.color }); setRecolor(undefined) }} />
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
              <OpenText {...x} />
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
              <OpenText book={r.book} chapter={r.chapter} verses={vs} />
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
    <div class="saved" ref={root}>
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
      <div class="saved-pages" ref={row} dir="ltr">
        {TABS.map(id => id === shownTab
          ? <div key={id} class="saved-page" dir="auto">{bodyOf(id, true)}</div>
          : <div key={id} class="saved-page beside" dir="auto" inert aria-hidden="true">{bodyOf(id, false)}</div>)}
      </div>
      {editing && (() => {
        const r = parseKey(editing.key)
        return <NotesSheet book={r.book} chapter={r.chapter} verses={editing.verses} start={editing.start} dir={rtl}
          text={v => plain(bible?.books[r.book]?.[r.chapter - 1]?.[v - 1] ?? '')} onClose={() => setEditing(undefined)} />
      })()}
    </div>
  )
}
