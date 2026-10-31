import { ComponentChildren } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { LexEntry, Translation } from './lib/data'
import type { Range } from './lib/query'
import { segments } from './lib/text'
import { useApp } from './state'
import { CloseIcon } from './icons'
import { languageName, t } from './i18n'

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
    // On a phone the sheet sits at the bottom of the screen, where the
    // keyboard would cover it (and the note you're typing): lift it above
    // the keyboard and keep it within the space that's left. iPhone often
    // slides the page up too, a moment after the keyboard arrives (the note
    // was under it when tapped): follow that slide as well, or the sheet
    // jumped to the top of the screen with the Bible showing below it.
    const vv = window.visualViewport
    const fit = () => {
      if (!vv) return
      const up = vv.height < innerHeight - 100
      const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop)
      d.style.marginBottom = up ? kb + 'px' : ''
      d.style.maxHeight = up ? vv.height - 12 + 'px' : ''
    }
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    return () => { d.removeEventListener('close', close); vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit) }
  }, [])
  // Only a tap that starts and ends on the dimmed area closes the sheet, not
  // a drag (say, selecting text in a note) that happens to end there.
  const downOutside = useRef(false)
  return (
    <dialog ref={ref} class={'sheet' + (wide ? ' wide' : '')} onPointerDown={e => { downOutside.current = e.target === ref.current }}
      onClick={e => { if (e.target === ref.current && downOutside.current) ref.current!.close() }}>
      <div class="sheet-inner">
        <header class="sheet-head">
          <h2>{title}</h2>
          <button class="close-btn" aria-label={t('Close')} onClick={() => ref.current!.close()}><CloseIcon size={22} /></button>
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
    <Sheet title={t("Strong's {num}", { num })} onClose={onClose}>
      {e === null ? <p class="muted">{t('Loading…')}</p> : !e ? <p class="muted">{t('No entry for {num}.', { num })}</p> : (
        <div class="lex">
          <p class="lex-lemma" lang={num[0] === 'H' ? 'hbo' : 'grc'}>{e.lemma}</p>
          <p class="muted">{[e.xlit || e.translit, e.pron].filter(Boolean).join(' · ')}</p>
          {e.strongs_def && <p><strong>{t('Definition:')}</strong> {e.strongs_def}</p>}
          {e.kjv_def && <p><strong>{t('KJV renders:')}</strong> {e.kjv_def}</p>}
          {e.derivation && <p class="muted"><strong>{t('Derivation:')}</strong> {e.derivation}</p>}
        </div>
      )}
      <div class="row">
        <button class="primary" onClick={() => onSearch(num)}>{t('Find every {num}', { num })}</button>
      </div>
    </Sheet>
  )
}

const RECENT_VERSIONS = 'plain-bible:recent-versions'
const recentVersions = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_VERSIONS) || '[]') } catch { return [] } }
function rememberVersion(id: string) {
  try { localStorage.setItem(RECENT_VERSIONS, JSON.stringify([id, ...recentVersions().filter(x => x !== id)].slice(0, 5))) } catch { /* private mode */ }
}

// Picks a version. At first it shows only a handful (the ones you use),
// with a search to find any of the others; the full list by language is
// one tap further.
export function VersionPicker({ title, selected, multi, onChange, onClose, max = 20, extra }: {
  title: string; selected: string[]; multi?: boolean; onChange: (ids: string[]) => void; onClose: () => void; max?: number
  /** shown under the list, e.g. compare and Strong's options */
  extra?: ComponentChildren
}) {
  const { catalog, settings } = useApp()
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState(selected)
  const [all, setAll] = useState(false)
  const f = filter.toLowerCase()
  const list = useMemo(() => catalog.translations.filter(v =>
    !f || [v.id, v.name, v.langName, v.langNative, v.lang, languageName(v.lang, v.langName)].some(x => x.toLowerCase().includes(f))), [f])
  const byId = useMemo(() => new Map(catalog.translations.map(v => [v.id, v])), [catalog])
  const top = useMemo(() => [...new Set([...selected, ...recentVersions(), ...settings.myVersions])]
    .map(id => byId.get(id)).filter((v): v is Translation => !!v).slice(0, Math.max(5, selected.length)), [])
  const byLang = new Map<string, Translation[]>()
  for (const v of list) {
    const name = languageName(v.lang, v.langName)
    const k = `${name}${v.langNative.toLowerCase() !== name.toLowerCase() ? ' · ' + v.langNative : ''}`
    byLang.set(k, [...(byLang.get(k) ?? []), v])
  }
  const toggle = (id: string) => {
    if (!multi) { rememberVersion(id); onChange([id]); onClose(); return }
    setSel(s => s.includes(id) ? s.filter(x => x !== id) : s.length >= max ? s : [...s, id])
  }
  const row = (v: Translation) => (
    <label class={'vrow' + (sel.includes(v.id) ? ' on' : '')}>
      <input type={multi ? 'checkbox' : 'radio'} checked={sel.includes(v.id)} onChange={() => toggle(v.id)} />
      <span class="vid">{v.id}</span>
      <span class="vname">{v.name}</span>
    </label>
  )
  return (
    <Sheet title={title} onClose={() => { if (multi) onChange(sel); onClose() }} wide>
      <input class="filter" type="search" placeholder={t('Search {n} versions or a language', { n: catalog.translations.length })} value={filter}
        onInput={e => setFilter((e.target as HTMLInputElement).value)} autoFocus={!matchMedia('(pointer: coarse)').matches} />
      {multi && <p class="muted small">{t('{n} selected (up to {max}). Close to apply.', { n: sel.length, max })}</p>}
      {f || all
        ? <>{[...byLang.entries()].map(([lang, ts]) => <section><h3>{lang}</h3>{ts.map(row)}</section>)}
            {!list.length && <p class="muted">{t('No version matches “{filter}”.', { filter })}</p>}</>
        : <>
            <section class="vtop">{top.map(row)}</section>
            <button class="more-toggle" onClick={() => setAll(true)}>{t('All {n} versions, by language', { n: catalog.translations.length })} <span aria-hidden="true">›</span></button>
            {extra}
          </>}
    </Sheet>
  )
}
