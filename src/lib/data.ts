import { WEB_URL } from './site'

export interface Translation {
  id: string; name: string; lang: string; langName: string; langNative: string
  license: string; strongs: boolean; rtl: boolean; books: string[]; source: string
  /** iOS app only: shipped inside the app rather than downloaded */
  bundled?: boolean
}
export interface Catalog { translations: Translation[] }
/** books[bookId][chapter - 1][verse - 1] */
export interface Bible { id: string; books: Record<string, string[][]> }

export interface LexEntry { lemma?: string; xlit?: string; translit?: string; pron?: string; derivation?: string; strongs_def?: string; kjv_def?: string }

export class DataSource {
  private bibles = new Map<string, Promise<Bible>>()
  private lex = new Map<string, Promise<Record<string, LexEntry>>>()
  constructor(private base: string) {}

  url(path: string) { return new URL(path, this.base).href }

  async json<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path))
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`)
    return res.json()
  }

  catalog() { return this.json<Catalog>('catalog.json') }

  /** In the iOS app (served from capacitor://), only a few versions ship
   *  inside the app. The rest download from the website once and are kept
   *  on the device. */
  get native() { return this.base.startsWith('capacitor:') }

  bible(id: string): Promise<Bible> {
    let p = this.bibles.get(id)
    if (!p) {
      const path = `bibles/${id}.json`
      p = !this.native ? this.json<Bible>(path) : this.json<Bible>(path).catch(async () => {
        const kept = await saved.get(id)
        if (kept) return kept
        const res = await fetch(new URL('data/' + path, WEB_URL).href)
        if (!res.ok) throw new Error(`Could not download ${id} (${res.status})`)
        const b: Bible = await res.json()
        await saved.put(id, b).catch(() => {})
        return b
      })
      p.catch(() => this.bibles.delete(id))
      this.bibles.set(id, p)
    }
    return p
  }

  lexicon(num: string): Promise<LexEntry | undefined> {
    const which = num[0] === 'H' ? 'hebrew' : 'greek'
    let p = this.lex.get(which)
    if (!p) { p = this.json(`strongs-${which}.json`); this.lex.set(which, p) }
    return p.then(d => d[num])
  }
}

// ---------------------------------------------------------------------------
// Versions downloaded in the iOS app, kept in IndexedDB (usable from the
// search worker too).

const DB = 'plain-bible-versions', STORE = 'bibles'
let db: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  return db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => { db = undefined; reject(r.error) }
  })
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const s = (await open()).transaction(STORE, mode).objectStore(STORE)
  return new Promise((resolve, reject) => { const r = fn(s); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}
export const saved = {
  get: (id: string) => tx<Bible | undefined>('readonly', s => s.get(id)),
  put: (id: string, b: Bible) => tx('readwrite', s => s.put(b, id)).then(() => {}),
  delete: (id: string) => tx('readwrite', s => s.delete(id)).then(() => {}),
  ids: () => tx('readonly', s => s.getAllKeys()).then(k => k.map(String)),
}
