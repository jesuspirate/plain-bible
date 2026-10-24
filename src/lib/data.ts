export interface Translation {
  id: string; name: string; lang: string; langName: string; langNative: string
  license: string; strongs: boolean; rtl: boolean; books: string[]; source: string
}
export interface Catalog { translations: Translation[] }
/** books[bookId][chapter - 1][verse - 1] */
export interface Bible { id: string; books: Record<string, string[][]> }

export interface LexEntry { lemma?: string; xlit?: string; translit?: string; pron?: string; derivation?: string; strongs_def?: string; kjv_def?: string }

const CATALOG_KEY = 'plain-bible:catalog'

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

  bible(id: string): Promise<Bible> {
    let p = this.bibles.get(id)
    if (!p) {
      p = this.json<Bible>(`bibles/${id}.json`)
      p.catch(() => this.bibles.delete(id))
      this.bibles.set(id, p)
    }
    return p
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

