import { useEffect, useState } from 'preact/hooks'
import { BOOKS, BOOK_INDEX, bookById } from './lib/books'
import { Bible } from './lib/data'
import { formatRef } from './lib/refs'
import { plain } from './lib/text'
import { go, readPath, Route, useApp } from './state'
import { BookPicker, LexiconSheet, Sheet, VerseText, VersionPicker } from './ui'

export function Reader({ route }: { route: Route }) {
  const { settings, update, byId, data } = useApp()
  const [, , bookParam, chParam] = route.path
  const version = byId.has(route.path[1]) ? route.path[1] : settings.version
  const book = bookParam && BOOK_INDEX[bookParam] !== undefined ? bookParam : 'John'
  const chapter = Math.max(1, +chParam || 1)
  const target = +(route.params.get('v') || 0)
  const parallel = (route.params.get('p')?.split(',') ?? settings.parallel).filter(id => byId.has(id) && id !== version)
  const versions = [version, ...parallel]

  const [bibles, setBibles] = useState<Record<string, Bible>>({})
  const [error, setError] = useState('')
  const [picker, setPicker] = useState<'' | 'book' | 'version' | 'parallel'>('')
  const [lex, setLex] = useState<string>()
  const [verseMenu, setVerseMenu] = useState<number>()

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

  const loaded = versions.every(v => bibles[v])
  const rows = loaded ? Math.max(...versions.map(v => bibles[v].books[book]?.[chapter - 1]?.length ?? 0)) : 0
  const showStrongs = settings.strongs
  const t = byId.get(version)

  return (
    <div class="reader">
      <div class="toolbar">
        <button class="pick" onClick={() => setPicker('book')}>{bookById(book).name} {chapter} ▾</button>
        <button class="pick" onClick={() => setPicker('version')}>{version} ▾</button>
        <button class="pick ghost" onClick={() => setPicker('parallel')} title="Show other versions side by side">
          {parallel.length ? `+ ${parallel.join(', ')}` : '+ Compare'}
        </button>
        <span class="spacer" />
        {versions.some(v => byId.get(v)?.strongs) && (
          <label class="toggle" title="Tap tagged words to see the Hebrew or Greek behind them">
            <input type="checkbox" checked={settings.strongs} onChange={e => update({ strongs: (e.target as HTMLInputElement).checked })} /> Strong's
          </label>
        )}
      </div>

      {error && <p class="error">{error}</p>}
      {!loaded && !error && <p class="muted center">Loading…</p>}
      {loaded && rows === 0 && <p class="muted center">{t?.name} does not include {bookById(book).name} {chapter}.</p>}

      {loaded && rows > 0 && (
        <article class={`chapter ${settings.layout} cols-${versions.length}`} style={{ '--cols': versions.length }}>
          <h1 class="chapter-title">{bookById(book).name} {chapter}</h1>
          {versions.length > 1 && (
            <div class="vrow-head">{versions.map(v => <div class="colhead" title={byId.get(v)?.name}>{v}</div>)}</div>
          )}
          {versions.length === 1 && settings.layout === 'paragraph' ? (
            <p class="para" dir={t?.rtl ? 'rtl' : undefined}>
              {primary.books[book][chapter - 1].map((raw, i) => raw && (
                <span id={'v' + (i + 1)} class={'pv' + (target === i + 1 ? ' target' : '')}>
                  <sup class="vn" onClick={() => setVerseMenu(i + 1)}>{i + 1}</sup>
                  <VerseText raw={raw} strongs={showStrongs} numbers={settings.strongsNumbers} onStrongs={setLex} />{' '}
                </span>
              ))}
            </p>
          ) : Array.from({ length: rows }, (_, i) => (
            <div id={'v' + (i + 1)} class={'verse' + (target === i + 1 ? ' target' : '')}>
              {versions.map(v => {
                const raw = bibles[v].books[book]?.[chapter - 1]?.[i]
                const tv = byId.get(v)
                return (
                  <div class="cell" dir={tv?.rtl ? 'rtl' : undefined} lang={tv?.lang}>
                    <button class="vn" onClick={() => setVerseMenu(i + 1)} aria-label={`Verse ${i + 1} options`}>{i + 1}</button>
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

      {picker === 'book' && <BookPicker version={t} onClose={() => setPicker('')} onPick={(b, c) => { setPicker(''); nav(b, c) }} />}
      {picker === 'version' && <VersionPicker title="Version" selected={[version]} onClose={() => setPicker('')}
        onChange={([id]) => go(readPath(id, book, chapter, target || undefined, parallel.filter(p => p !== id)))} />}
      {picker === 'parallel' && <VersionPicker title="Compare with" multi max={5} selected={parallel} onClose={() => setPicker('')}
        onChange={ids => { update({ parallel: ids }); go(readPath(version, book, chapter, target || undefined, ids.filter(i => i !== version)), true) }} />}
      {lex && <LexiconSheet num={lex} onClose={() => setLex(undefined)} onSearch={n => { setLex(undefined); go(`search?q=${n}&v=${versions.filter(v => byId.get(v)?.strongs).join(',') || 'KJV'}`) }} />}
      {verseMenu && <VerseMenu book={book} chapter={chapter} verse={verseMenu} versions={versions} bibles={bibles} onClose={() => setVerseMenu(undefined)} />}
    </div>
  )
}

function VerseMenu({ book, chapter, verse, versions, bibles, onClose }: {
  book: string; chapter: number; verse: number; versions: string[]; bibles: Record<string, Bible>; onClose: () => void
}) {
  const { settings, byId, data } = useApp()
  const [compare, setCompare] = useState<Bible[]>()
  const [copied, setCopied] = useState('')
  const ref = formatRef({ book, chapter, verse })
  const text = (b: Bible) => plain(b.books[book]?.[chapter - 1]?.[verse - 1] ?? '')
  const copy = async (s: string, what: string) => {
    try { await navigator.clipboard.writeText(s); setCopied(what) } catch { setCopied('Copy failed') }
  }
  const showAll = () => {
    const ids = settings.myVersions.filter(id => byId.get(id)?.books.includes(book))
    Promise.all(ids.map(id => data.bible(id))).then(setCompare)
  }
  const link = `${location.origin}${location.pathname}#/${readPath(versions[0], book, chapter, verse)}`
  return (
    <Sheet title={ref} onClose={onClose}>
      <div class="row wrap">
        <button onClick={() => copy(`${text(bibles[versions[0]])}\n${ref} (${versions[0]})`, 'Copied verse')}>Copy verse</button>
        <button onClick={() => copy(link, 'Copied link')}>Copy link</button>
        <button onClick={showAll}>Compare in my versions</button>
      </div>
      {copied && <p class="muted small">{copied}</p>}
      {compare && (
        <dl class="compare">
          {compare.map(b => (
            <>
              <dt>{b.id} <span class="muted small">{byId.get(b.id)?.name}</span></dt>
              <dd dir={byId.get(b.id)?.rtl ? 'rtl' : undefined}>{text(b) || <span class="muted">—</span>}</dd>
            </>
          ))}
        </dl>
      )}
    </Sheet>
  )
}
