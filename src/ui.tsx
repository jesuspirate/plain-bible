import { ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BOOKS, bookById } from './lib/books'
import { LexEntry, Translation } from './lib/data'
import type { Range } from './lib/query'
import { segments } from './lib/text'
import { useApp } from './state'

export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  // Keep the latest onClose: callers close over state that changes while open.
  const latest = useRef(onClose)
  latest.current = onClose
  useEffect(() => {
    const d = ref.current!
    d.showModal()
    const close = () => latest.current()
    d.addEventListener('close', close)
    return () => d.removeEventListener('close', close)
  }, [])
  return (
    <dialog ref={ref} class={'sheet' + (wide ? ' wide' : '')} onClick={e => { if (e.target === ref.current) ref.current!.close() }}>
      <div class="sheet-inner">
        <header class="sheet-head">
          <h2>{title}</h2>
          <button class="icon" aria-label="Close" onClick={() => ref.current!.close()}>✕</button>
        </header>
        <div class="sheet-body">{children}</div>
      </div>
    </dialog>
  )
}

/** Verse text with optional highlight ranges (plain-text offsets) and Strong's tagging. */
export function VerseText({ raw, ranges = [], strongs, numbers, onStrongs, mark = [] }: {
  raw: string; ranges?: Range[]; strongs?: boolean; numbers?: boolean
  onStrongs?: (num: string) => void; mark?: string[]
}) {
  const segs = segments(raw)
  const out: preact.JSX.Element[] = []
  let off = 0, ri = 0, key = 0
  for (const s of segs) {
    const start = off, end = off + s.text.length
    off = end
    // split this segment's text by highlight ranges
    const pieces: preact.JSX.Element[] = []
    let p = start
    while (ri < ranges.length && ranges[ri][0] < end) {
      const [a, b] = ranges[ri]
      if (a > p) pieces.push(<>{s.text.slice(p - start, a - start)}</>)
      const hs = Math.max(a, p), he = Math.min(b, end)
      if (he > hs) pieces.push(<mark>{s.text.slice(hs - start, he - start)}</mark>)
      p = Math.max(p, he)
      if (b <= end) ri++
      else break
    }
    if (p < end) pieces.push(<>{s.text.slice(p - start)}</>)
    if (s.strongs && strongs) {
      const marked = s.strongs.some(n => mark.includes(n))
      out.push(
        <span key={key++} class={'w' + (marked ? ' w-mark' : '')} role="button" tabIndex={0} title={s.strongs.join(' ')}
          onClick={e => { e.stopPropagation(); onStrongs?.(s.strongs![s.strongs!.length - 1]) }}
          onKeyDown={e => { if (e.key === 'Enter') onStrongs?.(s.strongs![s.strongs!.length - 1]) }}>
          {pieces}
          {numbers && <sup class="sn">{s.strongs.join(' ')}</sup>}
        </span>)
    } else out.push(<span key={key++}>{pieces}</span>)
  }
  return <>{out}</>
}

export function useLexicon(num: string | undefined): LexEntry | undefined | null {
  const { data } = useApp()
  const [e, setE] = useState<LexEntry | undefined | null>(null)
  useEffect(() => {
    setE(null)
    if (num) data.lexicon(num).then(setE, () => setE(undefined))
  }, [num])
  return e
}

export function LexiconSheet({ num, onClose, onSearch }: { num: string; onClose: () => void; onSearch: (num: string) => void }) {
  const e = useLexicon(num)
  return (
    <Sheet title={`Strong's ${num}`} onClose={onClose}>
      {e === null ? <p class="muted">Loading…</p> : !e ? <p class="muted">No entry for {num}.</p> : (
        <div class="lex">
          <p class="lex-lemma" lang={num[0] === 'H' ? 'hbo' : 'grc'}>{e.lemma}</p>
          <p class="muted">{[e.xlit || e.translit, e.pron].filter(Boolean).join(' · ')}</p>
          {e.strongs_def && <p><strong>Definition:</strong> {e.strongs_def}</p>}
          {e.kjv_def && <p><strong>KJV renders:</strong> {e.kjv_def}</p>}
          {e.derivation && <p class="muted"><strong>Derivation:</strong> {e.derivation}</p>}
        </div>
      )}
      <div class="row">
        <button class="primary" onClick={() => onSearch(num)}>Find every {num}</button>
      </div>
    </Sheet>
  )
}

export function BookPicker({ version, onPick, onClose }: { version?: Translation; onPick: (book: string, chapter: number) => void; onClose: () => void }) {
  const [book, setBook] = useState<string>()
  const { data } = useApp()
  const [chapters, setChapters] = useState<number>(0)
  useEffect(() => {
    if (!book || !version) return
    data.bible(version.id).then(b => setChapters(b.books[book]?.length ?? 0))
  }, [book])
  const available = new Set(version?.books ?? BOOKS.map(b => b.id))
  const groups: [string, typeof BOOKS][] = [
    ['Old Testament', BOOKS.slice(0, 39)], ['New Testament', BOOKS.slice(39, 66)],
    ['Deuterocanon / Apocrypha', BOOKS.slice(66)],
  ]
  if (book) {
    return (
      <Sheet title={bookById(book).name} onClose={onClose}>
        <button class="link" onClick={() => setBook(undefined)}>← All books</button>
        <div class="grid chapters">
          {Array.from({ length: chapters }, (_, i) => <button onClick={() => onPick(book, i + 1)}>{i + 1}</button>)}
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet title="Books" onClose={onClose} wide>
      {groups.map(([label, books]) => {
        const list = books.filter(b => available.has(b.id))
        if (!list.length) return null
        return (
          <section>
            <h3>{label}</h3>
            <div class="grid books">{list.map(b => <button onClick={() => setBook(b.id)}>{b.name}</button>)}</div>
          </section>
        )
      })}
    </Sheet>
  )
}

export function VersionPicker({ title, selected, multi, onChange, onClose, max = 20, extra }: {
  title: string; selected: string[]; multi?: boolean; onChange: (ids: string[]) => void; onClose: () => void; max?: number
  /** shown above the list, e.g. compare and Strong's options */
  extra?: ComponentChildren
}) {
  const { catalog, settings } = useApp()
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState(selected)
  const f = filter.toLowerCase()
  const list = useMemo(() => catalog.translations.filter(t =>
    !f || [t.id, t.name, t.langName, t.langNative, t.lang].some(x => x.toLowerCase().includes(f))), [f])
  const mine = list.filter(t => settings.myVersions.includes(t.id))
  const byLang = new Map<string, Translation[]>()
  for (const t of list) {
    const k = `${t.langName}${t.langNative !== t.langName ? ' · ' + t.langNative : ''}`
    byLang.set(k, [...(byLang.get(k) ?? []), t])
  }
  const toggle = (id: string) => {
    if (!multi) { onChange([id]); onClose(); return }
    setSel(s => s.includes(id) ? s.filter(x => x !== id) : s.length >= max ? s : [...s, id])
  }
  const row = (t: Translation) => (
    <label class={'vrow' + (sel.includes(t.id) ? ' on' : '')}>
      <input type={multi ? 'checkbox' : 'radio'} checked={sel.includes(t.id)} onChange={() => toggle(t.id)} />
      <span class="vid">{t.id}</span>
      <span class="vname">{t.name}{t.strongs && <span class="badge">Strong's</span>}</span>
    </label>
  )
  return (
    <Sheet title={title} onClose={() => { if (multi) onChange(sel); onClose() }} wide>
      {extra}
      <input class="filter" type="search" placeholder={`Filter ${catalog.translations.length} versions by name or language`} value={filter}
        onInput={e => setFilter((e.target as HTMLInputElement).value)} autoFocus={!matchMedia('(pointer: coarse)').matches} />
      {multi && <p class="muted small">{sel.length} selected (up to {max}). Close to apply.</p>}
      {mine.length > 0 && !f && <section><h3>My versions</h3>{mine.map(row)}</section>}
      {[...byLang.entries()].map(([lang, ts]) => <section><h3>{lang}</h3>{ts.map(row)}</section>)}
    </Sheet>
  )
}
