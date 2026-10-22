/// <reference lib="webworker" />
// Runs searches off the main thread. Keeps loaded Bibles and per-verse search
// text in memory so repeated searches are fast.
import { BOOKS, BOOK_INDEX } from './lib/books'
import { Bible, DataSource } from './lib/data'
import { compile, highlight, parseQuery, Range, SearchOptions, VerseCtx } from './lib/query'
import { normalize, plain, segments } from './lib/text'

export interface SearchRequest {
  type: 'search'; seq: number; base: string; query: string; versions: string[]; options: SearchOptions; books?: string[]
}
export interface PageRequest {
  type: 'page'; seq: number; base: string; query: string; versions: string[]; options: SearchOptions
  refs: [string, number, number, number][]
}
export interface SearchResponse {
  type: 'search'; seq: number; errors: string[]
  /** flattened [bookIndex, chapter, verse, versionMask] */
  hits: number[]
  perBook: Record<string, number>
  perVersion: number[]
  ms: number
}
export interface PageVerse { book: string; chapter: number; verse: number; texts: { version: string; text: string; ranges: Range[]; matched: boolean }[] }
export interface PageResponse { type: 'page'; seq: number; verses: PageVerse[] }
export interface ProgressResponse { type: 'progress'; seq: number; message: string }
export interface ErrorResponse { type: 'error'; seq: number; message: string }

const WORD_RE = /[\p{L}\p{M}\p{N}]+/gu
let data: DataSource | undefined
const ctxCache = new Map<string, VerseCtx[][][]>()

class Ctx implements VerseCtx {
  private _plain?: string; private _full?: string; private _strongs?: string[]
  constructor(private raw: string, public normText: string, private o: SearchOptions) {}
  get plain() { return this._plain ??= plain(this.raw) }
  get normFull() { return this._full ??= normalize(this.plain, this.o) }
  get strongs() { return this._strongs ??= this.raw.indexOf('{') < 0 ? [] : segments(this.raw).flatMap(s => s.strongs ?? []) }
}

function contexts(bible: Bible, o: SearchOptions): VerseCtx[][][] {
  const key = `${bible.id}|${+o.caseSensitive}${+o.accentSensitive}`
  let c = ctxCache.get(key)
  if (c) return c
  c = []
  for (const b of BOOKS) {
    const chapters = bible.books[b.id]
    c[BOOK_INDEX[b.id]] = chapters ? chapters.map(vs => vs.map(v => {
      const words = normalize(plain(v), o).match(WORD_RE)
      return new Ctx(v, words ? ' ' + words.join(' ') + ' ' : ' ', o)
    })) : []
  }
  // Keep memory bounded: at most 12 indexed editions.
  if (ctxCache.size >= 12) ctxCache.delete(ctxCache.keys().next().value!)
  ctxCache.set(key, c)
  return c
}

async function search(req: SearchRequest): Promise<SearchResponse> {
  const t0 = performance.now()
  const parsed = parseQuery(req.query)
  const empty: SearchResponse = { type: 'search', seq: req.seq, errors: parsed.errors, hits: [], perBook: {}, perVersion: req.versions.map(() => 0), ms: 0 }
  if (!parsed.node || parsed.errors.some(e => e.startsWith('Add at least') || e.startsWith('Invalid'))) return empty
  const match = compile(parsed.node, req.options)
  let allowed: Set<string> | undefined = parsed.books
  if (req.books) {
    const ui = new Set(req.books)
    allowed = allowed ? new Set([...allowed].filter(b => ui.has(b))) : ui
  }
  data ??= new DataSource(req.base)
  const masks = new Map<number, number>() // key = book<<20 | ch<<10 | v
  const perVersion = req.versions.map(() => 0)
  for (let vi = 0; vi < req.versions.length; vi++) {
    post({ type: 'progress', seq: req.seq, message: `Searching ${req.versions[vi]}…` })
    const bible = await data.bible(req.versions[vi])
    const ctx = contexts(bible, req.options)
    for (let bi = 0; bi < ctx.length; bi++) {
      if (allowed && !allowed.has(BOOKS[bi].id)) continue
      const chapters = ctx[bi]
      for (let ci = 0; ci < chapters.length; ci++) {
        const verses = chapters[ci]
        for (let v = 0; v < verses.length; v++) {
          if (verses[v].normText.length > 1 && match(verses[v])) {
            const key = (bi << 20) | ((ci + 1) << 10) | (v + 1)
            masks.set(key, (masks.get(key) ?? 0) | (1 << vi))
            perVersion[vi]++
          }
        }
      }
    }
  }
  const keys = [...masks.keys()].sort((a, b) => a - b)
  const hits: number[] = []
  const perBook: Record<string, number> = {}
  for (const k of keys) {
    const bi = k >> 20
    hits.push(bi, (k >> 10) & 1023, k & 1023, masks.get(k)!)
    perBook[BOOKS[bi].id] = (perBook[BOOKS[bi].id] ?? 0) + 1
  }
  return { type: 'search', seq: req.seq, errors: parsed.errors, hits, perBook, perVersion, ms: Math.round(performance.now() - t0) }
}

async function page(req: PageRequest): Promise<PageResponse> {
  const parsed = parseQuery(req.query)
  data ??= new DataSource(req.base)
  const bibles = await Promise.all(req.versions.map(v => data!.bible(v)))
  const verses: PageVerse[] = req.refs.map(([book, chapter, verse, mask]) => ({
    book, chapter, verse,
    texts: bibles.flatMap((b, vi) => {
      const raw = b.books[book]?.[chapter - 1]?.[verse - 1]
      if (!raw) return []
      const text = plain(raw)
      const matched = !!(mask & (1 << vi))
      return [{ version: b.id, text: raw, matched, ranges: matched && parsed.node ? highlight(parsed.node, raw, text, req.options) : [] }]
    }),
  }))
  return { type: 'page', seq: req.seq, verses }
}

function post(msg: SearchResponse | PageResponse | ProgressResponse | ErrorResponse) { (self as unknown as Worker).postMessage(msg) }

self.onmessage = async (e: MessageEvent<SearchRequest | PageRequest>) => {
  const req = e.data
  try {
    post(req.type === 'search' ? await search(req) : await page(req))
  } catch (err) {
    post({ type: 'error', seq: req.seq, message: String((err as Error).message ?? err) })
  }
}
