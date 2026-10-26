import { useEffect, useMemo, useState } from 'preact/hooks'
import { Translation } from './lib/data'
import { loadPlace } from './lib/place'
import { go, readPath, useApp } from './state'
import { BackIcon } from './icons'
import { languageName, t, tn } from './i18n'

const CACHE = 'bible-data'

async function cachedIds(): Promise<Set<string>> {
  if (!('caches' in window)) return new Set()
  try {
    const keys = await (await caches.open(CACHE)).keys()
    return new Set(keys.map(r => r.url.match(/bibles\/([^/]+)\.json$/)?.[1]).filter(Boolean) as string[])
  } catch { return new Set() }
}

/** With `inSheet`, it's a page of Settings: the sheet has the title and the way back. */
export function Versions({ inSheet }: { inSheet?: boolean } = {}) {
  const { catalog, settings, update, data } = useApp()
  const [filter, setFilter] = useState('')
  const [offline, setOffline] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  useEffect(() => { cachedIds().then(setOffline); document.title = t('Versions') + ' · My Quiet Bible' }, [])

  const f = filter.toLowerCase()
  const groups = useMemo(() => {
    const m = new Map<string, Translation[]>()
    for (const v of catalog.translations) {
      const name = languageName(v.lang, v.langName)
      if (f && ![v.id, v.name, v.langName, v.langNative, v.lang, name].some(x => x.toLowerCase().includes(f))) continue
      m.set(name, [...(m.get(name) ?? []), v])
    }
    return [...m.entries()]
  }, [f])
  // A version opens where you are reading, if it has that book.
  const here = loadPlace()?.book ?? 'Gen'
  const langs = new Set(catalog.translations.map(v => v.lang)).size

  const toggleMine = (id: string) => update({
    myVersions: settings.myVersions.includes(id) ? settings.myVersions.filter(x => x !== id) : [...settings.myVersions, id],
  })
  const download = async (id: string) => {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      if ('caches' in window) await (await caches.open(CACHE)).add(data.url(`bibles/${id}.json`))
      setOffline(await cachedIds())
    } catch { /* offline: the button stays, so they can try again */ } finally { setBusy(b => ({ ...b, [id]: false })) }
  }
  const remove = async (id: string) => {
    await (await caches.open(CACHE)).delete(data.url(`bibles/${id}.json`))
    setOffline(await cachedIds())
  }

  return (
    <div class="versions">
      {!inSheet && <h1>{t('Versions')}</h1>}
      <p class="muted">{t('{n} versions in {langs} languages. All are public domain or openly licensed.', { n: catalog.translations.length, langs })}{' '}
        {t('Star a version to keep it at the top of every list. Save it for offline use and it works without a connection.')}</p>
      <input class="filter" type="search" placeholder={t('Filter by name or language')} value={filter} onInput={e => setFilter((e.target as HTMLInputElement).value)} />
      {groups.map(([lang, ts]) => (
        <section>
          <h2>{lang}{ts[0].langNative.toLowerCase() !== lang.toLowerCase() && <span class="muted"> · {ts[0].langNative}</span>}</h2>
          <ul class="vlist">
            {ts.map(v => (
              <li>
                <button class={'star' + (settings.myVersions.includes(v.id) ? ' on' : '')} aria-pressed={settings.myVersions.includes(v.id)}
                  aria-label={t('Add {version} to my versions', { version: v.id })} onClick={() => toggleMine(v.id)}>★</button>
                <div class="vinfo">
                  <a onClick={() => update({ version: v.id })} href={'#/' + (v.books.includes(here) ? 'read/' + v.id : readPath(v.id, v.books.includes('John') ? 'John' : v.books[0], 1))}><strong>{v.id}</strong> {v.name}</a>
                  <div class="muted small">
                    {v.strongs && <span class="badge">Strong's</span>}
                    {tn(v.books.length, '{n} book', '{n} books')} · <a href={v.source} target="_blank" rel="noopener">{v.license}</a>
                  </div>
                </div>
                {offline.has(v.id)
                  ? <button class="small" onClick={() => remove(v.id)} title={t('Remove offline copy')}>{t('Saved ✓')}</button>
                  : <button class="small" disabled={busy[v.id]} onClick={() => download(v.id)}>{busy[v.id] ? t('Saving…') : t('Save offline')}</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!inSheet && <p><button class="back-link" onClick={() => go('read')}><BackIcon class="back-ico" /> {t('Back to reading')}</button></p>}
    </div>
  )
}
