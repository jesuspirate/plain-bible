// Your highlights, bookmarks and notes, in Bible order, shown in the version you read.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { Bible } from './lib/data'
import { compareKeys, hasContent, Mark, notesOf, PALETTE, parseKey } from './lib/marks'
import { NotesSheet, NotesTarget, verseRanges } from './reader'
import { BookmarkIcon } from './icons'
import { bookById } from './lib/books'
import { formatRef } from './lib/refs'
import { plain } from './lib/text'
import { readPath, useApp } from './state'

const PAGE = 60

/** One entry in the list: a verse with its highlight, bookmark and notes,
 *  or a passage with the notes written on it. */
interface Row { key: string; verses: number[]; mark?: Mark; notes: ReturnType<typeof notesOf> }
function rowsOf(key: string, m: Mark): Row[] {
  const { verse } = parseKey(key)
  const own: Row = { key, verses: [verse], mark: m, notes: [] }
  const passages = new Map<string, Row>()
  for (const x of notesOf(m)) {
    if (!x.v) { own.notes.push(x); continue }
    const id = x.v.join()
    if (!passages.has(id)) passages.set(id, { key, verses: x.v, notes: [] })
    passages.get(id)!.notes.push(x)
  }
  return [...(m.c || m.b || own.notes.length ? [own] : []), ...passages.values()]
}

/** With `onImport`, it's a page of Settings: no title of its own, and the
 *  import link opens Your data there. */
export function Saved({ onImport }: { onImport?: () => void } = {}) {
  const { marks, setMarks, settings, data, byId } = useApp()
  const [filter, setFilter] = useState<string>('all')
  const [bible, setBible] = useState<Bible>()
  // The version isn't on the device and there's no connection to fetch it.
  const [missing, setMissing] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<NotesTarget & { key: string }>()
  const version = settings.version
  useEffect(() => { document.title = 'Saved · Quiet Bible'; setMissing(false); data.bible(version).then(setBible, () => setMissing(true)) }, [version])
  useEffect(() => setLimit(PAGE), [filter])

  const keys = useMemo(() => Object.keys(marks).filter(k => hasContent(marks[k])).sort(compareKeys), [marks])
  const colors = useMemo(() => {
    const counts = new Map<string, number>()
    for (const k of keys) { const c = marks[k].c; if (c) counts.set(c, (counts.get(c) ?? 0) + 1) }
    const known = PALETTE.filter(p => counts.has(p.color)).map(p => p.color)
    return [...known, ...[...counts.keys()].filter(c => !known.includes(c))].map(c => [c, counts.get(c)!] as const)
  }, [keys])
  const rows = useMemo(() => keys.flatMap(k => rowsOf(k, marks[k])), [keys])
  const shown = rows.filter(r => filter === 'all' || (filter === 'bookmarks' ? r.mark?.b : filter === 'notes' ? r.notes.length : r.mark?.c === filter))
  const bookmarks = keys.filter(k => marks[k].b).length
  const notes = rows.reduce((n, r) => n + r.notes.length, 0)

  // Removing clears the highlight and bookmark; a note is only deleted on purpose.
  const remove = (k: string) => setMarks(m => {
    const t = Date.now(), cur = m[k]
    return { ...m, [k]: cur.ns ? { ns: cur.ns, t } : { t } }
  })

  if (!keys.length) {
    return (
      <div class="saved">
        {!onImport && <h1>Saved</h1>}
        <p class="muted">Nothing saved yet. Tap any verse while reading to highlight, bookmark or add a note to it.
          Coming from another app? {onImport ? <><button class="link" onClick={onImport}>Import your highlights</button> under Your data.</> : <><a href="#/settings">Import your highlights</a> in Settings.</>}</p>
      </div>
    )
  }

  return (
    <div class="saved">
      {!onImport && <h1>Saved</h1>}
      <div class="chips" role="tablist">
        <button class={'chip' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>All {rows.length}</button>
        {bookmarks > 0 && <button class={'chip' + (filter === 'bookmarks' ? ' on' : '')} onClick={() => setFilter('bookmarks')} aria-label={`${bookmarks} bookmarks`}><BookmarkIcon class="bm-mark" /> {bookmarks}</button>}
        {notes > 0 && <button class={'chip' + (filter === 'notes' ? ' on' : '')} onClick={() => setFilter('notes')}>Notes {notes}</button>}
        {colors.map(([c, n]) => (
          <button class={'chip swatch-chip' + (filter === c ? ' on' : '')} onClick={() => setFilter(c)} aria-label={`${PALETTE.find(p => p.color === c)?.name ?? c} highlights`}>
            <span class="dot" style={{ background: c }} />{n}
          </button>
        ))}
      </div>
      {missing && <p class="note">{version} isn’t saved on this device yet, so the verses can’t be shown. Connect to the internet once and they will be.</p>}
      <ol class="saved-list">
        {shown.slice(0, limit).map(row => {
          const r = parseKey(row.key), m = row.mark, vs = row.verses
          const text = vs.map(v => { const raw = bible?.books[r.book]?.[r.chapter - 1]?.[v - 1]; return raw ? (vs.length > 1 ? `${v} ` : '') + plain(raw) : '' }).filter(Boolean).join(' ')
          return (
            <li style={m?.c ? { '--hl': m.c } : undefined} class={m?.c ? 'hl' : ''}>
              <div class="saved-head">
                <a class="ref" href={'#/' + readPath(version, r.book, r.chapter, r.verse)}>{vs.length > 1 ? `${bookById(r.book).name} ${r.chapter}:${verseRanges(vs)}` : formatRef(r)}</a>
                {m?.b && <span title="Bookmarked" class="bm-mark"><BookmarkIcon /></span>}
                <span class="spacer" />
                <button class="small" onClick={() => setEditing({ key: row.key, verses: vs, start: 'new' })}>Add note</button>
                {(m?.c || m?.b) && <button class="icon small" aria-label={`Remove highlight and bookmark from ${formatRef(r)}`} onClick={() => remove(row.key)}>✕</button>}
              </div>
              <p class="saved-text" dir={byId.get(version)?.rtl ? 'rtl' : undefined}>
                {text || (bible && <span class="muted">Not in {version}</span>)}
              </p>
              {row.notes.map(x => <p class="saved-note" onClick={() => setEditing({ key: row.key, verses: vs, start: { key: row.key, id: x.id } })}>{x.n}</p>)}
            </li>
          )
        })}
      </ol>
      {shown.length > limit && <button class="more" onClick={() => setLimit(l => l + PAGE)}>Show more ({shown.length - limit} left)</button>}
      {editing && (() => {
        const r = parseKey(editing.key)
        return <NotesSheet book={r.book} chapter={r.chapter} verses={editing.verses} start={editing.start} dir={byId.get(version)?.rtl ? 'rtl' : undefined}
          text={v => plain(bible?.books[r.book]?.[r.chapter - 1]?.[v - 1] ?? '')} onClose={() => setEditing(undefined)} />
      })()}
    </div>
  )
}
