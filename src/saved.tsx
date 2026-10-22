// Your highlights, bookmarks and notes, in Bible order, shown in the version you read.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { Bible } from './lib/data'
import { compareKeys, hasContent, PALETTE, parseKey } from './lib/marks'
import { NoteSheet } from './reader'
import { formatRef } from './lib/refs'
import { plain } from './lib/text'
import { readPath, useApp } from './state'

const PAGE = 60

export function Saved() {
  const { marks, setMarks, settings, data, byId } = useApp()
  const [filter, setFilter] = useState<string>('all')
  const [bible, setBible] = useState<Bible>()
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<string>()
  const version = settings.version
  useEffect(() => { document.title = 'Saved · Plain Bible'; data.bible(version).then(setBible) }, [version])
  useEffect(() => setLimit(PAGE), [filter])

  const keys = useMemo(() => Object.keys(marks).filter(k => hasContent(marks[k])).sort(compareKeys), [marks])
  const colors = useMemo(() => {
    const counts = new Map<string, number>()
    for (const k of keys) { const c = marks[k].c; if (c) counts.set(c, (counts.get(c) ?? 0) + 1) }
    const known = PALETTE.filter(p => counts.has(p.color)).map(p => p.color)
    return [...known, ...[...counts.keys()].filter(c => !known.includes(c))].map(c => [c, counts.get(c)!] as const)
  }, [keys])
  const shown = keys.filter(k => filter === 'all' || (filter === 'bookmarks' ? marks[k].b : filter === 'notes' ? marks[k].n : marks[k].c === filter))
  const bookmarks = keys.filter(k => marks[k].b).length
  const notes = keys.filter(k => marks[k].n).length

  // Removing clears the highlight and bookmark; a note is only deleted on purpose.
  const remove = (k: string) => setMarks(m => {
    const t = Date.now(), cur = m[k]
    return { ...m, [k]: cur.n ? { n: cur.n, nt: cur.nt, t } : { t, ...(cur.nt ? { nt: cur.nt } : {}) } }
  })

  if (!keys.length) {
    return (
      <div class="saved">
        <h1>Saved</h1>
        <p class="muted">Nothing saved yet. Tap any verse while reading to highlight, bookmark or add a note to it.
          Coming from another app? <a href="#/settings">Import your highlights</a> in Settings.</p>
      </div>
    )
  }

  return (
    <div class="saved">
      <h1>Saved</h1>
      <div class="chips" role="tablist">
        <button class={'chip' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>All {keys.length}</button>
        {bookmarks > 0 && <button class={'chip' + (filter === 'bookmarks' ? ' on' : '')} onClick={() => setFilter('bookmarks')}>🔖 {bookmarks}</button>}
        {notes > 0 && <button class={'chip' + (filter === 'notes' ? ' on' : '')} onClick={() => setFilter('notes')}>Notes {notes}</button>}
        {colors.map(([c, n]) => (
          <button class={'chip swatch-chip' + (filter === c ? ' on' : '')} onClick={() => setFilter(c)} aria-label={`${PALETTE.find(p => p.color === c)?.name ?? c} highlights`}>
            <span class="dot" style={{ background: c }} />{n}
          </button>
        ))}
      </div>
      <ol class="saved-list">
        {shown.slice(0, limit).map(k => {
          const r = parseKey(k), m = marks[k]
          const raw = bible?.books[r.book]?.[r.chapter - 1]?.[r.verse - 1]
          return (
            <li style={m.c ? { '--hl': m.c } : undefined} class={m.c ? 'hl' : ''}>
              <div class="saved-head">
                <a class="ref" href={'#/' + readPath(version, r.book, r.chapter, r.verse)}>{formatRef(r)}</a>
                {m.b && <span title="Bookmarked">🔖</span>}
                <span class="spacer" />
                <button class="small" onClick={() => setEditing(k)}>{m.n ? 'Edit note' : 'Add note'}</button>
                {(m.c || m.b) && <button class="icon small" aria-label={`Remove highlight and bookmark from ${formatRef(r)}`} onClick={() => remove(k)}>✕</button>}
              </div>
              <p class="saved-text" dir={byId.get(version)?.rtl ? 'rtl' : undefined}>
                {raw ? plain(raw) : <span class="muted">Not in {version}</span>}
              </p>
              {m.n && <p class="saved-note" onClick={() => setEditing(k)}>{m.n}</p>}
            </li>
          )
        })}
      </ol>
      {shown.length > limit && <button class="more" onClick={() => setLimit(l => l + PAGE)}>Show more ({shown.length - limit} left)</button>}
      {editing && (() => {
        const r = parseKey(editing), raw = bible?.books[r.book]?.[r.chapter - 1]?.[r.verse - 1]
        return <NoteSheet {...r} text={raw ? plain(raw) : undefined} onClose={() => setEditing(undefined)} />
      })()}
    </div>
  )
}
