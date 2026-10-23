import { useEffect, useMemo, useState } from 'preact/hooks'
import { saved, Translation } from './lib/data'
import { loadPlace } from './lib/place'
import { go, readPath, useApp } from './state'

const CACHE = 'bible-data'

async function cachedIds(native: boolean): Promise<Set<string>> {
  // The iOS app keeps downloaded versions in IndexedDB instead.
  if (native) return new Set(await saved.ids().catch(() => []))
  if (!('caches' in window)) return new Set()
  try {
    const keys = await (await caches.open(CACHE)).keys()
    return new Set(keys.map(r => r.url.match(/bibles\/([^/]+)\.json$/)?.[1]).filter(Boolean) as string[])
  } catch { return new Set() }
}

export function Versions() {
  const { catalog, settings, update, data } = useApp()
  const [filter, setFilter] = useState('')
  const [offline, setOffline] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  useEffect(() => { cachedIds(data.native).then(setOffline); document.title = 'Versions · Plain Bible' }, [])

  const f = filter.toLowerCase()
  const groups = useMemo(() => {
    const m = new Map<string, Translation[]>()
    for (const t of catalog.translations) {
      if (f && ![t.id, t.name, t.langName, t.langNative, t.lang].some(x => x.toLowerCase().includes(f))) continue
      m.set(t.langName, [...(m.get(t.langName) ?? []), t])
    }
    return [...m.entries()]
  }, [f])
  // A version opens where you are reading, if it has that book.
  const here = loadPlace()?.book ?? 'Gen'
  const langs = new Set(catalog.translations.map(t => t.lang)).size

  const toggleMine = (id: string) => update({
    myVersions: settings.myVersions.includes(id) ? settings.myVersions.filter(x => x !== id) : [...settings.myVersions, id],
  })
  const download = async (id: string) => {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      if (data.native) await data.bible(id)
      else if ('caches' in window) await (await caches.open(CACHE)).add(data.url(`bibles/${id}.json`))
      setOffline(await cachedIds(data.native))
    } catch { /* offline: the button stays, so they can try again */ } finally { setBusy(b => ({ ...b, [id]: false })) }
  }
  const remove = async (id: string) => {
    if (data.native) await saved.delete(id)
    else await (await caches.open(CACHE)).delete(data.url(`bibles/${id}.json`))
    setOffline(await cachedIds(data.native))
  }

  return (
    <div class="versions">
      <h1>Versions</h1>
      <p class="muted">{catalog.translations.length} versions in {langs} languages. All are public domain or openly licensed.
        Star a version to keep it at the top of every list. {data.native
          ? 'Versions marked Built in are always here. Download any other once and it works without a connection.'
          : 'Save it for offline use and it works without a connection.'}</p>
      <input class="filter" type="search" placeholder="Filter by name or language" value={filter} onInput={e => setFilter((e.target as HTMLInputElement).value)} />
      {groups.map(([lang, ts]) => (
        <section>
          <h2>{lang}{ts[0].langNative !== lang && <span class="muted"> · {ts[0].langNative}</span>}</h2>
          <ul class="vlist">
            {ts.map(t => (
              <li>
                <button class={'star' + (settings.myVersions.includes(t.id) ? ' on' : '')} aria-pressed={settings.myVersions.includes(t.id)}
                  aria-label={`Add ${t.id} to my versions`} onClick={() => toggleMine(t.id)}>★</button>
                <div class="vinfo">
                  <a href={'#/' + (t.books.includes(here) ? 'read/' + t.id : readPath(t.id, t.books.includes('John') ? 'John' : t.books[0], 1))}><strong>{t.id}</strong> {t.name}</a>
                  <div class="muted small">
                    {t.strongs && <span class="badge">Strong's</span>}
                    {t.books.length} books · <a href={t.source} target="_blank" rel="noopener">{t.license}</a>
                  </div>
                </div>
                {t.bundled
                  ? <span class="muted small">Built in</span>
                  : offline.has(t.id)
                  ? <button class="small" onClick={() => remove(t.id)} title="Remove offline copy">{data.native ? 'Downloaded ✓' : 'Saved ✓'}</button>
                  : <button class="small" disabled={busy[t.id]} onClick={() => download(t.id)}>{busy[t.id] ? (data.native ? 'Downloading…' : 'Saving…') : (data.native ? 'Download' : 'Save offline')}</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p><button class="link" onClick={() => go('read')}>← Back to reading</button></p>
    </div>
  )
}
