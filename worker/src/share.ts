// share.myquietbible.com: the address a verse shared to Facebook points to.
// Facebook takes only a link, and builds the post's card from that link's own
// page, so this page names the verse: its words are the card's bold title,
// under the lamp picture. People who tap it go straight on to the passage in
// the app (myquietbible.com/?r=…, which opens it in their own Bible).
//
// Served by Cloudflare Pages (scripts/share-page, scripts/deploy_share.sh).
// Cheap on purpose: the Bible file is cached, and only the one book is read.
import { plainBookName } from '../../src/lib/bookList'

const APP = 'https://myquietbible.com'
const ID = /^[\w-]{1,24}$/

export interface Shared { version: string; book: string; chapter: number; first: number; last: number }

/** ?r=KJV/John/3/16-18 (as src/lib/shareTo.ts makes it). */
export function parseShared(r: string | null): Shared | undefined {
  if (!r) return
  const [version, book, chapter, vs, extra] = r.split('/')
  if (extra !== undefined || !ID.test(version ?? '') || !ID.test(book ?? '') || !/^\d{1,3}$/.test(chapter ?? '')) return
  const m = /^(\d{1,3})(?:-(\d{1,3}))?$/.exec(vs ?? '')
  if (!m || +chapter < 1) return
  const first = +m[1], last = Math.max(first, +(m[2] ?? m[1]))
  if (first < 1 || last - first > 200) return
  return { version, book, chapter: +chapter, first, last }
}

const TAG = /\{([^{}|]*)\|[^{}]*\}/g
const plain = (s: string) => s.indexOf('{') < 0 ? s : s.replace(TAG, '$1')

/** One book out of a whole Bible file, without reading the rest of it. */
export function bookOf(json: string, book: string): string[][] | undefined {
  const key = `"${book}":`
  let at = -1
  for (let from = 0; ; from = at + 1) {
    at = json.indexOf(key, from)
    if (at < 0) return
    if (json[at - 1] !== '\\') break
  }
  let i = json.indexOf('[', at + key.length)
  if (i < 0) return
  const start = i
  let depth = 0, inStr = false
  for (; i < json.length; i++) {
    const c = json[i]
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === '[') depth++
    else if (c === ']' && --depth === 0) {
      try { return JSON.parse(json.slice(start, i + 1)) } catch { return }
    }
  }
}

export function wordsOf(chapters: string[][], s: Shared): string | undefined {
  const ch = chapters[s.chapter - 1]
  if (!ch) return
  const vs: string[] = []
  for (let v = s.first; v <= s.last; v++) if (ch[v - 1]) vs.push(s.first === s.last ? plain(ch[v - 1]) : `${v} ${plain(ch[v - 1])}`)
  return vs.length ? vs.join(' ').replace(/\s+/g, ' ').trim() : undefined
}

export const clipTitle = (s: string, room = 200) => {
  if (s.length <= room) return s
  const cut = s.slice(0, room - 1), space = cut.lastIndexOf(' ')
  return (space > room * .7 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '…'
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

/** Link previews (Facebook, X, WhatsApp, iMessage…) read the page; people go on. */
const PREVIEW = /facebookexternalhit|Facebot|meta-externalagent|Twitterbot|WhatsApp|TelegramBot|Slackbot|Discordbot|LinkedInBot|SkypeUriPreview|Pinterest|redditbot|Applebot|bingbot|Googlebot|Embedly|vkShare|Viber|Signal|Iframely|Mastodon|Bluesky/i

export function pageFor(s: Shared, words: string | undefined, lang: string, self: string) {
  const vs = s.last > s.first ? `${s.first}-${s.last}` : `${s.first}`
  const ref = `${plainBookName(s.book, lang)} ${s.chapter}:${vs} (${s.version})`
  const title = words ? `“${clipTitle(words)}”` : ref
  const desc = words ? `${ref} · My Quiet Bible` : 'My Quiet Bible'
  const to = `${APP}/?r=${[s.version, s.book, s.chapter, vs].join('/')}`
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<meta property="og:type" content="article"><meta property="og:site_name" content="My Quiet Bible">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(self)}">
<meta property="og:image" content="${APP}/share.png"><meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A lit lamp beside the words My Quiet Bible.">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${APP}/share.png">
<meta http-equiv="refresh" content="0; url=${esc(to)}"></head>
<body><p><a href="${esc(to)}">${esc(ref)}</a></p></body></html>`
}

type Fetcher = (url: string) => Promise<Response>

/** The whole answer for one request. `get` fetches (and caches) a Bible file. */
export async function answer(req: Request, get: Fetcher): Promise<Response> {
  const url = new URL(req.url)
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405 })
  const s = parseShared(url.searchParams.get('r'))
  if (!s) return Response.redirect(APP + '/', 302)
  const vs = s.last > s.first ? `${s.first}-${s.last}` : `${s.first}`
  const to = `${APP}/?r=${[s.version, s.book, s.chapter, vs].join('/')}`
  // People go straight on; only link previews need the page.
  if (!PREVIEW.test(req.headers.get('User-Agent') ?? '')) return Response.redirect(to, 302)
  let words: string | undefined, lang = 'en'
  try {
    const [bible, catalog] = await Promise.all([get(`${APP}/data/bibles/${s.version}.json`), get(`${APP}/data/catalog.json`)])
    if (bible.ok) { const b = bookOf(await bible.text(), s.book); if (b) words = wordsOf(b, s) }
    if (catalog.ok) {
      const c = await catalog.json() as { translations?: { id: string; lang: string }[] }
      lang = c.translations?.find(t => t.id === s.version)?.lang ?? 'en'
    }
  } catch { /* the card still names the passage */ }
  const self = `${url.origin}/?r=${[s.version, s.book, s.chapter, vs].join('/')}`
  return new Response(pageFor(s, words, lang, self), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'X-Robots-Tag': 'noindex' },
  })
}
