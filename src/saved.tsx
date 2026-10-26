// Your highlights, notes and bookmarks, each on its own tab, in Bible order
// and shown in the version you read.
import { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { Bible } from './lib/data'
import { compareKeys, hasContent, Mark, Marks, notesOf, PALETTE, parseKey, tidy } from './lib/marks'
import { NotesSheet, NotesTarget, verseRanges } from './reader'
import { BookmarkIcon, EditIcon, HighlightIcon, NoteIcon, TrashIcon } from './icons'
import { bookName } from './lib/books'
import { plain } from './lib/text'
import { readPath, useApp } from './state'
import { N_, t } from './i18n'

const PAGE = 60
const TAB = 'plain-bible:saved-tab'
type Tab = 'highlights' | 'notes' | 'bookmarks'

/** Verses next to each other in one colour read as one highlight. */
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
  // The highlight whose colours are open.
  const [recolor, setRecolor] = useState<string>()
  const [color, setColor] = useState('all')
  const [find, setFind] = useState('')
  const [newest, setNewest] = useState(false)
  // What was just removed, to put back.
  const [undo, setUndo] = useState<{ what: string; before: Marks }>()
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
    setTabState(to); setLimit(PAGE); setRecolor(undefined); setUndo(undefined)
    try { localStorage.setItem(TAB, to) } catch { /* private mode */ }
  }
  useEffect(() => setLimit(PAGE), [color, find, newest])

  const verseText = (book: string, chapter: number, vs: number[]) => vs.map(v => {
    const raw = bible?.books[book]?.[chapter - 1]?.[v - 1]
    return raw ? (vs.length > 1 ? `${v} ` : '') + plain(raw) : ''
  }).filter(Boolean).join(' ')
  const refOf = (book: string, chapter: number, vs: number[]) => `${bookName(book)} ${chapter}:${verseRanges(vs)}`
  const Ref = ({ book, chapter, verses }: { book: string; chapter: number; verses: number[] }) =>
    <a class="ref" href={'#/' + readPath(version, book, chapter, verses[0])}>{refOf(book, chapter, verses)}</a>
  const Text = ({ book, chapter, verses }: { book: string; chapter: number; verses: number[] }) => {
    const words = verseText(book, chapter, verses)
    return <p class="saved-text" dir={rtl}>{words || (bible && <span class="muted">{t('Not in {version}', { version })}</span>)}</p>
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
  const more = (n: number) => n > limit && <button class="more" onClick={() => setLimit(l => l + PAGE)}>{t('Show more ({n} left)', { n: n - limit })}</button>
  const empty = t({
    highlights: N_('No highlights yet. Tap a verse while reading and pick a colour, or tap a verse twice quickly.'),
    notes: N_('No notes yet. Tap a verse while reading, then the note button, to write one.'),
    bookmarks: N_('No bookmarks yet. Tap a verse while reading, then Bookmark.'),
  }[shownTab])

  let body
  if (shownTab === 'highlights') {
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
        {shown.slice(0, limit).map(r => {
          const id = r.keys[0], ref = refOf(r.book, r.chapter, r.verses)
          return (
            <li class="hl" style={{ '--hl': r.color }}>
              <div class="saved-head">
                <Ref {...r} />
                <span class="spacer" />
                <button class={'saved-act' + (recolor === id ? ' on' : '')} aria-expanded={recolor === id} onClick={() => setRecolor(recolor === id ? undefined : id)}>
                  <span class="dot big" style={{ background: r.color }} />{t('Colour')}
                </button>
              </div>
              <Text {...r} />
              {recolor === id && (
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
      {more(shown.length)}
    </>
  } else if (shownTab === 'notes') {
    const q = fold(find.trim())
    const list = notes.filter(x => !q || fold(x.n).includes(q) || fold(refOf(x.book, x.chapter, x.verses)).includes(q))
    if (newest) list.sort((a, b) => b.t - a.t)
    body = <>
      {notes.length > 3 && (
        <div class="saved-tools">
          <input type="search" class="saved-find" placeholder={t('Find in your notes')} value={find} onInput={e => setFind((e.target as HTMLInputElement).value)} />
          <div class="seg" role="radiogroup" aria-label={t('Order')}>
            <button role="radio" aria-checked={!newest} class={!newest ? 'on' : ''} onClick={() => setNewest(false)}>{t('Bible order')}</button>
            <button role="radio" aria-checked={newest} class={newest ? 'on' : ''} onClick={() => setNewest(true)}>{t('Newest')}</button>
          </div>
        </div>
      )}
      {!list.length && <p class="muted">{t('No note has “{words}” in it.', { words: find.trim() })}</p>}
      <ol class="saved-list">
        {list.slice(0, limit).map(x => {
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
      {more(list.length)}
    </>
  } else {
    body = <>
      <ol class="saved-list">
        {bookmarks.slice(0, limit).map(k => {
          const r = parseKey(k), vs = [r.verse]
          return (
            <li>
              <div class="saved-head">
                <span class="bm-mark" aria-hidden="true"><BookmarkIcon /></span>
                <Ref book={r.book} chapter={r.chapter} verses={vs} />
                <span class="spacer" />
                <button class="saved-act" onClick={() => change([k], { b: undefined }, t('Bookmark on {ref} removed.', { ref: refOf(r.book, r.chapter, vs) }))}>
                  <TrashIcon size={20} />{t('Remove')}
                </button>
              </div>
              <Text book={r.book} chapter={r.chapter} verses={vs} />
            </li>
          )
        })}
      </ol>
      {more(bookmarks.length)}
    </>
  }

  return (
    <div class="saved">
      {!onImport && <h1>{t('Saved')}</h1>}
      <div class="saved-tabs" role="tablist">
        {tabs.map(([id, label, icon]) => (
          <button role="tab" aria-selected={shownTab === id} class={shownTab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {icon}<span class="st-label">{label}</span><span class="st-count">{counts[id]}</span>
          </button>
        ))}
      </div>
      {missing && <p class="note">{t('{version} isn’t saved on this device yet, so the verses can’t be shown. Connect to the internet once and they will be.', { version })}</p>}
      {undo && <div class="saved-undo" role="status"><span>{undo.what}</span><button onClick={putBack}>{t('Undo')}</button></div>}
      {counts[shownTab] ? body : <p class="muted">{empty}</p>}
      {editing && (() => {
        const r = parseKey(editing.key)
        return <NotesSheet book={r.book} chapter={r.chapter} verses={editing.verses} start={editing.start} dir={rtl}
          text={v => plain(bible?.books[r.book]?.[r.chapter - 1]?.[v - 1] ?? '')} onClose={() => setEditing(undefined)} />
      })()}
    </div>
  )
}
