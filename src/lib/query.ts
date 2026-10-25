// Search query language.
//
//   love                  whole word (case- and accent-insensitive by default)
//   lov*  l?ve            wildcards
//   "in the beginning"    exact phrase (wildcards allowed inside)
//   faith AND works       both (AND is optional: `faith works` means the same)
//   mercy OR grace        either (also `|`)
//   NOT law  -law         exclude
//   (a OR b) c            grouping
//   love NEAR/5 neighbor  at most 5 words apart (NEAR alone = 10)
//   H430  G26             Strong's number (editions with Strong's tagging)
//   /regex/               regular expression on the verse text
//   in:nt  in:john  in:gen-deut  in:gospels,acts    limit to books
import { NO_SPACE_SCRIPT, NormOptions, normalize, segments, tokenize } from './text'
import { BOOKS, BOOK_INDEX, SCOPES, findBook } from './books'

export type Node =
  | { type: 'term'; text: string }
  | { type: 'phrase'; words: string[] }
  | { type: 'strongs'; num: string }
  | { type: 'regex'; source: string; flags: string }
  | { type: 'and' | 'or'; items: Node[] }
  | { type: 'not'; item: Node }
  | { type: 'near'; a: Node; b: Node; dist: number }

export interface ParsedQuery { node?: Node; books?: Set<string>; errors: string[] }

export type Tok =
  | { k: 'word'; v: string } | { k: 'phrase'; v: string } | { k: 'regex'; v: string; flags: string }
  | { k: 'and' | 'or' | 'not' | 'lp' | 'rp' } | { k: 'near'; n: number } | { k: 'in'; v: string }

export function lex(q: string, errors: string[]): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < q.length) {
    const c = q[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '(') { out.push({ k: 'lp' }); i++; continue }
    if (c === ')') { out.push({ k: 'rp' }); i++; continue }
    if (c === '|') { out.push({ k: 'or' }); i++; continue }
    if (c === '&') { out.push({ k: 'and' }); i++; continue }
    if (c === '"' || c === '“' || c === '”') {
      const close = q.slice(i + 1).search(/["“”]/)
      const end = close < 0 ? q.length : i + 1 + close
      out.push({ k: 'phrase', v: q.slice(i + 1, end) })
      i = end + 1
      continue
    }
    if (c === '/' ) {
      let j = i + 1
      while (j < q.length && q[j] !== '/') j += q[j] === '\\' ? 2 : 1
      if (j < q.length) {
        const flags = (q.slice(j + 1).match(/^[a-z]*/) || [''])[0]
        out.push({ k: 'regex', v: q.slice(i + 1, j), flags })
        i = j + 1 + flags.length
        continue
      }
    }
    if (c === '-' && (i === 0 || /[\s(]/.test(q[i - 1])) && i + 1 < q.length && !/\s/.test(q[i + 1])) {
      out.push({ k: 'not' }); i++; continue
    }
    let j = i
    while (j < q.length && !/[\s()"“”|]/.test(q[j])) j++
    const w = q.slice(i, j)
    i = j
    const near = w.match(/^NEAR(?:\/(\d+))?$/)
    if (near) out.push({ k: 'near', n: near[1] ? +near[1] : 10 })
    else if (w === 'AND' || w === '&&') out.push({ k: 'and' })
    else if (w === 'OR' || w === '||') out.push({ k: 'or' })
    else if (w === 'NOT') out.push({ k: 'not' })
    else if (/^(in|book|books|scope):/i.test(w)) out.push({ k: 'in', v: w.slice(w.indexOf(':') + 1) })
    else if (w) out.push({ k: 'word', v: w })
  }
  if (out.length === 0 && q.trim()) errors.push('Nothing to search for')
  return out
}

const WORD_PART = /[\p{L}\p{M}\p{N}*?]+/gu

function wordNode(raw: string, errors: string[]): Node | undefined {
  const s = raw.match(/^(?:strong:)?([HGhg])0*(\d{1,5})[a-z]?$/)
  if (s) return { type: 'strongs', num: s[1].toUpperCase() + s[2] }
  const parts = raw.match(WORD_PART) || []
  if (parts.length === 0) { errors.push(`Ignored "${raw}"`); return undefined }
  return parts.length === 1 ? { type: 'term', text: parts[0] } : { type: 'phrase', words: parts }
}

function resolveBooks(spec: string, errors: string[]): string[] {
  const out: string[] = []
  for (const part of spec.split(',').filter(Boolean)) {
    const key = part.toLowerCase()
    if (SCOPES[key]) { out.push(...SCOPES[key].books); continue }
    const range = part.match(/^(.+?)[-–](.+)$/)
    if (range && !findBook(part)) {
      const a = findBook(range[1]), b = findBook(range[2])
      if (a && b) {
        const [i, j] = [BOOK_INDEX[a], BOOK_INDEX[b]].sort((x, y) => x - y)
        out.push(...BOOKS.slice(i, j + 1).map(x => x.id))
        continue
      }
    }
    const one = findBook(part.replace(/_/g, ' '))
    if (one) out.push(one)
    else errors.push(`Unknown book or section "${part}"`)
  }
  return out
}

export function parseQuery(q: string): ParsedQuery {
  const errors: string[] = []
  const toks = lex(q, errors)
  let books: Set<string> | undefined
  const rest: Tok[] = []
  for (const t of toks) {
    if (t.k === 'in') {
      books ??= new Set()
      for (const b of resolveBooks(t.v, errors)) books.add(b)
    } else rest.push(t)
  }
  let pos = 0
  const peek = () => rest[pos]

  function primary(): Node | undefined {
    const t = rest[pos++]
    if (!t) return undefined
    switch (t.k) {
      case 'lp': {
        const n = orExpr()
        if (peek()?.k === 'rp') pos++
        else errors.push('Missing )')
        return n
      }
      case 'word': return wordNode(t.v, errors)
      case 'phrase': {
        const words = t.v.match(WORD_PART) || []
        if (words.length === 0) return undefined
        return words.length === 1 ? { type: 'term', text: words[0] } : { type: 'phrase', words }
      }
      case 'regex':
        try { new RegExp(t.v, 'u'); return { type: 'regex', source: t.v, flags: t.flags } }
        catch { errors.push('Invalid regular expression'); return undefined }
      default:
        errors.push('Unexpected ' + t.k.toUpperCase())
        return undefined
    }
  }
  function unary(): Node | undefined {
    if (peek()?.k === 'not') { pos++; const n = unary(); return n && { type: 'not', item: n } }
    return primary()
  }
  function nearExpr(): Node | undefined {
    let a = unary()
    while (peek()?.k === 'near') {
      const n = (rest[pos++] as { n: number }).n
      const b = unary()
      if (a && b) a = { type: 'near', a, b, dist: n }
      else a = a || b
    }
    return a
  }
  function andExpr(): Node | undefined {
    const items: Node[] = []
    while (pos < rest.length && peek().k !== 'or' && peek().k !== 'rp') {
      if (peek().k === 'and') { pos++; continue }
      const n = nearExpr()
      if (n) items.push(n)
    }
    return items.length <= 1 ? items[0] : { type: 'and', items }
  }
  function orExpr(): Node | undefined {
    const items: Node[] = []
    const first = andExpr()
    if (first) items.push(first)
    while (peek()?.k === 'or') { pos++; const n = andExpr(); if (n) items.push(n) }
    return items.length <= 1 ? items[0] : { type: 'or', items }
  }
  let node = orExpr()
  while (pos < rest.length) { pos++; errors.push('Unbalanced )'); const more = orExpr(); if (more) node = node ? { type: 'and', items: [node, more] } : more }
  if (node && onlyNegative(node)) errors.push('Add at least one word to look for, not only words to exclude')
  return { node, books, errors }
}

function onlyNegative(n: Node): boolean {
  if (n.type === 'not') return true
  if (n.type === 'and') return n.items.every(onlyNegative)
  return false
}

// ---------------------------------------------------------------------------
// Matching

export interface SearchOptions extends NormOptions { partialWords: boolean }

/** Per-verse data the matcher reads. normText is " tok tok tok " (normalized tokens). */
export interface VerseCtx { plain: string; normText: string; normFull: string; strongs: string[] }

const esc = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')

function wordPattern(word: string, o: SearchOptions): string {
  const w = esc(word).replace(/\*/g, '[^ ]*').replace(/\?/g, '[^ ]')
  return o.partialWords ? '[^ ]*' + w + '[^ ]*' : w
}

function nodeRegex(n: Node, o: SearchOptions): RegExp | undefined {
  if (n.type === 'term') return new RegExp('(?<= )' + wordPattern(normalize(n.text, o), o) + '(?= )', 'gu')
  if (n.type === 'phrase') return new RegExp('(?<= )' + n.words.map(w => wordPattern(normalize(w, o), o)).join(' ') + '(?= )', 'gu')
  return undefined
}

const noSpace = (n: Node) => n.type === 'term' ? NO_SPACE_SCRIPT.test(n.text) : n.type === 'phrase' && n.words.some(w => NO_SPACE_SCRIPT.test(w))

function noSpaceRegex(n: Node, o: SearchOptions): RegExp {
  const words = n.type === 'term' ? [n.text] : (n as { words: string[] }).words
  return new RegExp(words.map(w => esc(normalize(w, o)).replace(/\*/g, '\\S*?').replace(/\?/g, '\\S')).join('\\s*'), 'gu')
}

/** Token indices where a term/phrase node starts (for NEAR). */
function positions(n: Node, ctx: VerseCtx, o: SearchOptions, cache: Map<Node, RegExp>): number[] {
  if (n.type === 'or') return n.items.flatMap(i => positions(i, ctx, o, cache))
  let re = cache.get(n)
  if (!re) { re = nodeRegex(n, o); if (!re) return []; cache.set(n, re) }
  const out: number[] = []
  re.lastIndex = 0
  for (const m of ctx.normText.matchAll(re)) {
    let spaces = 0
    for (let i = 0; i < m.index!; i++) if (ctx.normText.charCodeAt(i) === 32) spaces++
    out.push(spaces - 1)
  }
  return out
}

export type Matcher = (ctx: VerseCtx) => boolean

export function compile(node: Node, o: SearchOptions): Matcher {
  const cache = new Map<Node, RegExp>()
  const build = (n: Node): Matcher => {
    switch (n.type) {
      case 'term':
      case 'phrase': {
        if (noSpace(n)) {
          const re = noSpaceRegex(n, o)
          return ctx => { re.lastIndex = 0; return re.test(ctx.normFull) }
        }
        if (n.type === 'term' && !/[*?]/.test(n.text) && !o.partialWords) {
          const needle = ' ' + normalize(n.text, o) + ' '
          return ctx => ctx.normText.includes(needle)
        }
        const re = nodeRegex(n, o)!
        return ctx => { re.lastIndex = 0; return re.test(ctx.normText) }
      }
      case 'strongs': return ctx => ctx.strongs.includes(n.num)
      case 'regex': {
        const re = new RegExp(n.source, 'u' + (o.caseSensitive ? '' : 'i') + n.flags.replace(/[gu]/g, ''))
        return ctx => re.test(ctx.plain)
      }
      case 'and': { const ms = n.items.map(build); return ctx => ms.every(m => m(ctx)) }
      case 'or': { const ms = n.items.map(build); return ctx => ms.some(m => m(ctx)) }
      case 'not': { const m = build(n.item); return ctx => !m(ctx) }
      case 'near': {
        const ma = build(n.a), mb = build(n.b)
        return ctx => {
          if (!ma(ctx) || !mb(ctx)) return false
          const pa = positions(n.a, ctx, o, cache), pb = positions(n.b, ctx, o, cache)
          return pa.some(a => pb.some(b => Math.abs(a - b) - 1 <= n.dist))
        }
      }
    }
  }
  return build(node)
}

export function makeCtx(verse: string, plainText: string, o: NormOptions): VerseCtx {
  const toks = tokenize(plainText, o)
  return {
    plain: plainText,
    normText: ' ' + toks.map(t => t.norm).join(' ') + ' ',
    normFull: normalize(plainText, o),
    strongs: verse.indexOf('{') < 0 ? [] : segments(verse).flatMap(s => s.strongs ?? []),
  }
}

// ---------------------------------------------------------------------------
// Highlighting: character ranges in the plain text to mark.

export type Range = [number, number]

function positives(n: Node, out: Node[] = []): Node[] {
  if (n.type === 'and' || n.type === 'or') n.items.forEach(i => positives(i, out))
  else if (n.type === 'near') { positives(n.a, out); positives(n.b, out) }
  else if (n.type !== 'not') out.push(n)
  return out
}

export function highlight(node: Node, verse: string, plainText: string, o: SearchOptions): Range[] {
  const ranges: Range[] = []
  const toks = tokenize(plainText, o)
  const normText = ' ' + toks.map(t => t.norm).join(' ') + ' '
  // char offset in normText → token index
  const tokAt: number[] = []
  let ti = -1
  for (let i = 0; i < normText.length; i++) { if (normText[i] === ' ') ti++; tokAt.push(ti) }
  for (const n of positives(node)) {
    if (n.type === 'strongs') {
      let off = 0
      for (const s of segments(verse)) {
        if (s.strongs?.includes(n.num)) ranges.push([off, off + s.text.length])
        off += s.text.length
      }
    } else if (n.type === 'regex') {
      const re = new RegExp(n.source, 'gu' + (o.caseSensitive ? '' : 'i') + n.flags.replace(/[gu]/g, ''))
      for (const m of plainText.matchAll(re)) if (m[0]) ranges.push([m.index!, m.index! + m[0].length])
    } else if (noSpace(n)) {
      const normFull = normalize(plainText, o)
      if (normFull.length === plainText.length)
        for (const m of normFull.matchAll(noSpaceRegex(n, o))) if (m[0]) ranges.push([m.index!, m.index! + m[0].length])
    } else {
      const re = nodeRegex(n, o)
      if (!re) continue
      for (const m of normText.matchAll(re)) {
        const a = toks[tokAt[m.index!]], b = toks[tokAt[m.index! + m[0].length - 1]]
        if (a && b) ranges.push([a.start, b.end])
      }
    }
  }
  ranges.sort((x, y) => x[0] - y[0])
  const merged: Range[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** Strong's numbers mentioned positively in a query (to emphasize tagged words). */
export function queryStrongs(node: Node | undefined): string[] {
  return node ? positives(node).filter(n => n.type === 'strongs').map(n => (n as { num: string }).num) : []
}
