import { useEffect, useRef, useState } from 'preact/hooks'
import { BOOKS, BOOK_INDEX, bookById } from './lib/books'
import { Bible } from './lib/data'
import { formatRef } from './lib/refs'
import { markKey, PALETTE } from './lib/marks'
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

  useEffect(() => {
    if (version !== settings.version || parallel.join() !== settings.parallel.join()) update({ version, parallel })
    setError('')
    Promise.all(versions.map(v => data.bible(v)))
      .then(bs => setBibles(Object.fromEntries(bs.map(b => [b.id, b]))))
      .catch(e => setError(String(e.message || e)))
  }, [versions.join()])

  useEffect(() => {
    document.title = `${formatRef({ book, chapter })} (${version}) · Plain Bible`
    if (target) {
      requestAnimationFrame(() => document.getElementById('v' + target)?.scrollIntoView({ block: 'center' }))
    } else window.scrollTo(0, 0)
  }, [book, chapter, version, target, Object.keys(bibles).length])

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
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const mark = (v: number) => marks[markKey(book, chapter, v)]
  const verseClass = (base: string, v: number) =>
    base + (target === v ? ' target' : '') + (mark(v)?.c ? ' hl' : '') + (mark(v)?.b ? ' bm' : '') + (selected.includes(v) ? ' picked' : '')
  const hlStyle = (v: number) => mark(v)?.c ? { '--hl': mark(v)!.c } : undefined
  const tapVerse = (e: MouseEvent, v: number) => {
    if ((e.target as HTMLElement).closest('.w') && settings.strongs) return
    if (String(getSelection() ?? '').trim()) return
    setSelected(s => s.includes(v) ? s.filter(x => x !== v) : [...s, v].sort((a, b) => a - b))
  }
  // Swipe left/right to change chapter.
  const touch = useRef<{ x: number; y: number; t: number }>()
  const onTouchStart = (e: TouchEvent) => { const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY, t: Date.now() } }
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current, p = e.changedTouches[0]
    touch.current = undefined
    if (!s || Date.now() - s.t > 600) return
    const dx = p.clientX - s.x, dy = p.clientY - s.y
    if (Math.abs(dx) > 70 && Math.abs(dy) < Math.abs(dx) * 0.5) step(dx < 0 ? 1 : -1)
  }

  const loaded = versions.every(v => bibles[v])
  const rows = loaded ? Math.max(...versions.map(v => bibles[v].books[book]?.[chapter - 1]?.length ?? 0)) : 0
  const showStrongs = settings.strongs
  const t = byId.get(version)

  return (
    <div class="reader">
      {error && <p class="error">{error}</p>}
      {!loaded && !error && <p class="muted center">Loading…</p>}
      {loaded && rows === 0 && <p class="muted center">{t?.name} does not include {bookById(book).name} {chapter}.</p>}

      {loaded && rows > 0 && (
        <article onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} class={`chapter ${settings.layout} cols-${versions.length}`} style={{ '--cols': versions.length }}>
          <h1 class="chapter-title">{bookById(book).name} {chapter}</h1>
          {versions.length > 1 && (
            <div class="vrow-head">{versions.map(v => <div class="colhead" title={byId.get(v)?.name}>{v}</div>)}</div>
          )}
          {versions.length === 1 && settings.layout === 'paragraph' ? (
            <p class="para" dir={t?.rtl ? 'rtl' : undefined}>
              {primary.books[book][chapter - 1].map((raw, i) => raw && (
                <span id={'v' + (i + 1)} class={verseClass('pv', i + 1)} style={hlStyle(i + 1)} onClick={e => tapVerse(e, i + 1)}>
                  <sup class="vn">{i + 1}</sup>
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
                    <button class="vn" aria-label={`Verse ${i + 1} options`}>{i + 1}</button>
                    {raw ? <VerseText raw={raw} strongs={showStrongs} numbers={settings.strongsNumbers} onStrongs={setLex} /> : <span class="muted">—</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </article>
      )}

      <nav class="pager">
        <button onClick={() => step(-1)}>← Previous</button>
        <button onClick={() => step(1)}>Next →</button>
      </nav>
      {t && <p class="credit muted small">{t.name}. {t.license}.</p>}

      {lex && <LexiconSheet num={lex} onClose={() => setLex(undefined)} onSearch={n => { setLex(undefined); go(`search?q=${n}&v=${versions.filter(v => byId.get(v)?.strongs).join(',') || 'KJV'}`) }} />}
      {selected.length > 0 && <SelectionBar book={book} chapter={chapter} verses={selected} versions={versions} bibles={bibles} onClose={() => setSelected([])} />}
    </div>
  )
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
function SelectionBar({ book, chapter, verses, versions, bibles, onClose }: {
  book: string; chapter: number; verses: number[]; versions: string[]; bibles: Record<string, Bible>; onClose: () => void
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
      out[key] = (!next.c && !next.b ? { t } : next) as never
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
