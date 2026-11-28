import { withTags } from './text'

export interface Translation {
  id: string; name: string; lang: string; langName: string; langNative: string
  license: string; strongs: boolean; rtl: boolean; books: string[]; source: string
  /** Its Strong's numbers come in bibles/<id>.strongs.json, loaded only when
   *  they are shown, so the Bible itself stays as light as before. */
  strongsFile?: boolean
}
/** books[bookId][chapter - 1][verse - 1]: the verse's tags (see withTags). */
interface StrongsFile { id: string; books: Record<string, string[][]> }
export interface Catalog { translations: Translation[] }
/** books[bookId][chapter - 1][verse - 1] */
export interface Bible { id: string; books: Record<string, string[][]> }

export interface LexEntry { lemma?: string; xlit?: string; translit?: string; pron?: string; derivation?: string; strongs_def?: string; kjv_def?: string }

const CATALOG_KEY = 'plain-bible:catalog'
const CHECKED_KEY = 'plain-bible:saved-checked'
const DAY = 24 * 3600 * 1000

/** Bibles (and word dictionaries) saved on this device are read from the saved copy first, so a fix
 *  to a text (say a typo) would never reach them. Once a day, online, each
 *  saved Bible asks the site whether it changed: an unchanged one costs a tiny
 *  "not modified" answer, a changed one is downloaded again. */
export async function refreshSaved(base: string, now = Date.now()) {
  if (typeof caches === 'undefined' || !navigator.onLine) return
  try {
    if (now - Number(localStorage.getItem(CHECKED_KEY) || 0) < DAY) return
    localStorage.setItem(CHECKED_KEY, String(now))
  } catch { return }
  const c = await caches.open('bible-data')
  // The word dictionaries (src/lib/dict.ts) sit beside the data folder.
  const prefixes = [new URL('bibles/', base).href, new URL('../dict/', base).href]
  for (const req of await c.keys()) {
    if (!prefixes.some(p => req.url.startsWith(p))) continue
    const old = await c.match(req)
    const tag = old?.headers.get('etag')
    if (!old || !tag) continue
    // The saved copy steps aside, so the request reaches the site.
    await c.delete(req)
    try {
      const res = await fetch(req.url, { cache: 'no-store', headers: { 'If-None-Match': tag } })
      await c.put(req.url, res.status === 200 ? res : old)
    } catch {
      await c.put(req.url, old)
    }
  }
}

export class DataSource {
  private bibles = new Map<string, Promise<Bible>>()
  /** The Bibles already loaded, to hand over at once (no empty frame). */
  private ready = new Map<string, Bible>()
  private lex = new Map<string, Promise<Record<string, LexEntry>>>()
  constructor(private base: string) {}

  url(path: string) { return new URL(path, this.base).href }

  async json<T>(path: string): Promise<T> {
    const res = await fetch(this.url(path))
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`)
    return res.json()
  }

  /** The list of versions. If it can't be fetched (offline, or the site is
   *  mid-update and briefly answers 404), the last copy that loaded is used. */
  async catalog(): Promise<Catalog> {
    try {
      const c = await this.json<Catalog>('catalog.json')
      if (!c?.translations?.length) throw new Error('The list of versions is empty')
      try { localStorage.setItem(CATALOG_KEY, JSON.stringify(c)) } catch { /* storage full or blocked */ }
      return c
    } catch (e) {
      try {
        const kept: Catalog = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null')
        if (kept?.translations?.length) return kept
      } catch { /* fall through */ }
      throw e
    }
  }

  /** The last list of versions that loaded, at once and without the
   *  network, so the app opens instantly even on a slow connection. */
  keptCatalog(): Catalog | undefined {
    try {
      const kept: Catalog = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null')
      if (kept?.translations?.length) return kept
    } catch { /* nothing kept */ }
  }

  /** strongs: with its Strong's numbers, for a version that keeps them in a
   *  file of their own (Translation.strongsFile). If that file can't be had
   *  (offline, the first time), the plain text comes back, and the numbers
   *  are tried again next time. */
  bible(id: string, strongs = false): Promise<Bible> {
    if (strongs) {
      const key = id + '#strongs'
      let p = this.bibles.get(key)
      if (!p) {
        const tags = this.json<StrongsFile>(`bibles/${id}.strongs.json`)
        p = Promise.all([this.bible(id), tags]).then(([b, s]) => ({
          id: b.id,
          books: Object.fromEntries(Object.entries(b.books).map(([book, chs]) =>
            [book, chs.map((vs, c) => vs.map((v, i) => withTags(v, s.books[book]?.[c]?.[i] ?? '')))])),
        }))
        p.then(b => this.ready.set(key, b), () => this.bibles.delete(key))
        this.bibles.set(key, p)
      }
      return p.catch(() => this.bible(id))
    }
    let p = this.bibles.get(id)
    if (!p) {
      p = this.json<Bible>(`bibles/${id}.json`)
      p.then(b => this.ready.set(id, b), () => this.bibles.delete(id))
      this.bibles.set(id, p)
    }
    return p
  }

  /** The Bible if it has already loaded this session, else undefined. Switching
   *  back to it then shows the chapter in the same frame, with no blank page. */
  bibleNow(id: string, strongs = false): Bible | undefined {
    return (strongs && this.ready.get(id + '#strongs')) || (strongs && this.bibles.has(id + '#strongs') ? undefined : this.ready.get(id))
  }

  lexicon(num: string): Promise<LexEntry | undefined> {
    const which = num[0] === 'H' ? 'hebrew' : 'greek'
    let p = this.lex.get(which)
    if (!p) {
      p = this.json(`strongs-${which}.json`)
      // Offline the first time: try again next time, not never.
      p.catch(() => this.lex.delete(which))
      this.lex.set(which, p)
    }
    return p.then(d => d[num])
  }
}

