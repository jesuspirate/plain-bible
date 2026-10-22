export interface Translation {
  id: string; name: string; lang: string; langName: string; langNative: string
  license: string; strongs: boolean; rtl: boolean; books: string[]; source: string
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
    if (!p) { p = this.json(`strongs-${which}.json`); this.lex.set(which, p) }
    return p.then(d => d[num])
  }
}
