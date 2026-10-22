import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BOOKS, SCOPES, bookById } from './lib/books'
import { parseQuery, queryStrongs, SearchOptions } from './lib/query'
import { formatRef, parseRef } from './lib/refs'
import { plain } from './lib/text'
import { go, readPath, Route, useApp } from './state'
import { LexiconSheet, VerseText, VersionPicker } from './ui'
import type { PageResponse, PageVerse, SearchResponse } from './search.worker'
import { call } from './searchClient'
import { rememberSearch } from './searchbar'

const PAGE = 40

const SCOPE_KEYS = ['ot', 'nt', 'law', 'history', 'wisdom', 'prophets', 'gospels', 'acts', 'pauline', 'general', 'deutero']

export function Search({ route }: { route: Route }) {
  const { settings, update, byId, data } = useApp()
  const q = route.params.get('q') ?? ''
  const versions = (route.params.get('v')?.split(',') ?? settings.searchVersions).filter(id => byId.has(id))
  const scope = route.params.get('s') ?? ''
  const bookFilter = route.params.get('b') ?? ''
  const opts = settings.searchOptions

  const [input, setInput] = useState(q)
  const [result, setResult] = useState<SearchResponse>()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [shown, setShown] = useState<PageVerse[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [picker, setPicker] = useState(false)
  const [help, setHelp] = useState(false)
  const [lex, setLex] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setInput(q), [q])
  useEffect(() => { if (!q) inputRef.current?.focus() }, [])

  const scopeBooks = (): string[] | undefined => {
    if (scope === 'acts') return ['Acts']
    if (scope.startsWith('range:')) {
      const [a, b] = scope.slice(6).split('-')
      const i = BOOKS.findIndex(x => x.id === a), j = BOOKS.findIndex(x => x.id === b)
      if (i >= 0 && j >= i) return BOOKS.slice(i, j + 1).map(x => x.id)
    }
    return SCOPES[scope]?.books
  }

  const setParams = (patch: Record<string, string | undefined>, replace = false) => {
    const p = new URLSearchParams({ q, v: versions.join(','), s: scope, b: bookFilter })
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k)
    for (const k of [...p.keys()]) if (!p.get(k)) p.delete(k)
    go('search?' + p.toString(), replace)
  }

  // Run the search when the query, versions, scope, or options change.
  useEffect(() => {
    setResult(undefined); setShown([]); setLimit(PAGE); setError('')
    if (!q.trim() || !versions.length) return
    document.title = `${q} · Search · Plain Bible`
    if (versions.join() !== settings.searchVersions.join()) update({ searchVersions: versions })
    rememberSearch(q.trim())
    let books = scopeBooks()
    if (bookFilter) books = [bookFilter]
    setBusy('Searching…')
    let stale = false
    call<SearchResponse>({ type: 'search', base: data.url(''), query: q, versions, options: opts, books }, m => !stale && setBusy(m))
      .then(r => { if (!stale) { setResult(r); setBusy('') } })
      .catch(e => { if (!stale) { setError(e.message); setBusy('') } })
    return () => { stale = true }
  }, [q, versions.join(), scope, bookFilter, JSON.stringify(opts)])

  const total = result ? result.hits.length / 4 : 0

  // Load verse texts for the visible page.
  useEffect(() => {
    if (!result || !total) return
    const from = shown.length, to = Math.min(limit, total)
    if (from >= to) return
    const refs: [string, number, number, number][] = []
    for (let i = from; i < to; i++) refs.push([BOOKS[result.hits[i * 4]].id, result.hits[i * 4 + 1], result.hits[i * 4 + 2], result.hits[i * 4 + 3]])
    let stale = false
    call<PageResponse>({ type: 'page', base: data.url(''), query: q, versions, options: opts, refs })
      .then(r => { if (!stale) setShown(s => [...s, ...r.verses]) })
    return () => { stale = true }
  }, [result, limit])

  const ref = useMemo(() => parseRef(q), [q])
  const parsed = useMemo(() => parseQuery(q), [q])
  const mark = queryStrongs(parsed.node)
  const maxCount = result ? Math.max(1, ...Object.values(result.perBook)) : 1

  const submit = (e: Event) => {
    e.preventDefault()
    const r = /\d/.test(input) ? parseRef(input) : undefined
    if (r) return go(readPath(versions[0] ?? settings.version, r.book, r.chapter, r.verse))
    setParams({ q: input.trim(), b: undefined })
  }
  const setOpt = (k: keyof SearchOptions, v: boolean) => update({ searchOptions: { ...opts, [k]: v } })

  const copyAll = async () => {
    const lines = shown.map(v => `${formatRef(v)} ${v.texts.map(t => `(${t.version}) ${plain(t.text)}`).join(' ')}`)
    try { await navigator.clipboard.writeText(lines.join('\n')) } catch { /* ignore */ }
  }

  return (
    <div class="search">
      <form class="searchbar" onSubmit={submit}>
        <input ref={inputRef} type="search" enterKeyHint="search" value={input} placeholder='Words, "a phrase", John 3:16, H430…'
          aria-label="Search" onInput={e => setInput((e.target as HTMLInputElement).value)} />
        <button class="primary" type="submit">Search</button>
      </form>

      <div class="filters">
        <button class="pick" onClick={() => setPicker(true)} title="Versions to search">In: {versions.join(', ') || 'choose versions'} ▾</button>
        <select value={scope.startsWith('range:') ? 'range' : scope} aria-label="Books to search"
          onChange={e => {
            const v = (e.target as HTMLSelectElement).value
            setParams({ s: v === 'range' ? 'range:Gen-Rev' : v, b: undefined })
          }}>
          <option value="">Whole Bible</option>
          {SCOPE_KEYS.map(k => <option value={k}>{k === 'acts' ? 'Acts' : SCOPES[k].label}</option>)}
          <option value="range">Book range…</option>
        </select>
        {scope.startsWith('range:') && <RangePicker value={scope.slice(6)} onChange={r => setParams({ s: 'range:' + r, b: undefined })} />}
        <details class="opts">
          <summary>Options</summary>
          <label><input type="checkbox" checked={opts.caseSensitive} onChange={e => setOpt('caseSensitive', (e.target as HTMLInputElement).checked)} /> Match case</label>
          <label><input type="checkbox" checked={opts.accentSensitive} onChange={e => setOpt('accentSensitive', (e.target as HTMLInputElement).checked)} /> Match accents and vowel points</label>
          <label><input type="checkbox" checked={opts.partialWords} onChange={e => setOpt('partialWords', (e.target as HTMLInputElement).checked)} /> Match inside words</label>
        </details>
        <button class="link" onClick={() => setHelp(h => !h)}>{help ? 'Hide tips' : 'Search tips'}</button>
      </div>

      {help && <SearchHelp />}

      {ref && (
        <button class="goto" onClick={() => go(readPath(versions[0] ?? settings.version, ref.book, ref.chapter, ref.verse))}>
          Go to {formatRef(ref)} →
        </button>
      )}

      {parsed.errors.length > 0 && q && <p class="warn">{parsed.errors.join('. ')}</p>}
      {error && <p class="error">{error}</p>}
      {busy && <p class="muted">{busy}</p>}

      {result && !(ref && total === 0) && (
        <>
          <div class="summary">
            <strong>{total.toLocaleString()}</strong> {total === 1 ? 'verse' : 'verses'}
            {versions.length > 1 && <span class="muted"> ({versions.map((v, i) => `${v}: ${result.perVersion[i].toLocaleString()}`).join(' · ')})</span>}
            <span class="muted small"> · {result.ms} ms</span>
            {bookFilter && <button class="chip" onClick={() => setParams({ b: undefined })}>{bookById(bookFilter).name} ✕</button>}
            {total > 0 && <button class="link small" onClick={copyAll} title="Copy the results shown below">Copy shown</button>}
          </div>

          {total > 0 && !bookFilter && Object.keys(result.perBook).length > 1 && (
            <div class="dist" role="list" aria-label="Results by book">
              {BOOKS.filter(b => result.perBook[b.id]).map(b => (
                <button role="listitem" class="bar" title={`${b.name}: ${result.perBook[b.id]}`} onClick={() => setParams({ b: b.id })}>
                  <span class="bar-label">{b.abbr}</span>
                  <span class="bar-fill" style={{ width: `${(result.perBook[b.id] / maxCount) * 100}%` }} />
                  <span class="bar-n">{result.perBook[b.id]}</span>
                </button>
              ))}
            </div>
          )}

          <ol class="results">
            {shown.map(v => (
              <li>
                <a class="ref" href={'#/' + readPath(versions[0], v.book, v.chapter, v.verse)}>{formatRef(v)}</a>
                {v.texts.map(t => {
                  const tv = byId.get(t.version)
                  return (
                    <p class={'hit' + (t.matched ? '' : ' nomatch')} dir={tv?.rtl ? 'rtl' : undefined} lang={tv?.lang}>
                      {versions.length > 1 && <span class="vtag">{t.version}</span>}
                      <VerseText raw={t.text} ranges={t.ranges} strongs={!!tv?.strongs && (settings.strongs || mark.length > 0)} mark={mark} onStrongs={setLex} />
                    </p>
                  )
                })}
              </li>
            ))}
          </ol>
          {shown.length < total && shown.length >= limit - 0 && (
            <button class="more" onClick={() => setLimit(l => l + PAGE)}>Show more ({(total - shown.length).toLocaleString()} left)</button>
          )}
        </>
      )}

      {!q && !help && <SearchHelp />}

      {picker && <VersionPicker title="Search in" multi selected={versions} onClose={() => setPicker(false)}
        onChange={ids => ids.length && setParams({ v: ids.join(',') })} />}
      {lex && <LexiconSheet num={lex} onClose={() => setLex(undefined)} onSearch={n => { setLex(undefined); setParams({ q: n, b: undefined }) }} />}
    </div>
  )
}

function RangePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [a, b] = value.split('-')
  return (
    <span class="range">
      <select value={a} aria-label="From book" onChange={e => onChange(`${(e.target as HTMLSelectElement).value}-${b}`)}>
        {BOOKS.map(x => <option value={x.id}>{x.name}</option>)}
      </select>
      –
      <select value={b} aria-label="To book" onChange={e => onChange(`${a}-${(e.target as HTMLSelectElement).value}`)}>
        {BOOKS.map(x => <option value={x.id}>{x.name}</option>)}
      </select>
    </span>
  )
}

function SearchHelp() {
  const ex = (q: string, what: string) => (
    <tr><td><a href={`#/search?q=${encodeURIComponent(q)}`}><code>{q}</code></a></td><td>{what}</td></tr>
  )
  return (
    <div class="help">
      <table>
        <tbody>
          {ex('faith', 'the whole word, any case or accent')}
          {ex('"in the beginning"', 'an exact phrase')}
          {ex('faith works', 'verses with both words (same as faith AND works)')}
          {ex('mercy OR grace', 'either word')}
          {ex('love -hate', 'love but not hate (also NOT hate)')}
          {ex('(mercy OR grace) peace', 'group with parentheses')}
          {ex('redeem*', 'wildcards: * any letters, ? one letter')}
          {ex('light NEAR/3 darkness', 'words at most 3 words apart')}
          {ex('H430', "a Strong's number (H = Hebrew, G = Greek) in KJV, BSB and the original-language texts")}
          {ex('/^And it came to pass/', 'a regular expression')}
          {ex('kingdom in:gospels', 'limit to books: in:nt, in:ot, in:john, in:gen-deut, in:romans,galatians')}
          {ex('John 3:16', 'a reference jumps straight to the passage')}
        </tbody>
      </table>
      <p class="muted small">Pick several versions to search them all at once. Tap a bar in the results chart to narrow to one book.</p>
    </div>
  )
}
