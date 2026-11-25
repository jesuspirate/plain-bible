// The daily posts to X (@myquietbible) and the Facebook page: plain data and
// checks, shared by the posting job (scripts/social/post.ts) and its test.
// Nothing here posts anything. Posts come only from social/posts.json on
// main, so merging a pull request that adds posts is the yes for them.

export interface Post {
  /** The day it goes out, in New York time (YYYY-MM-DD). */
  date: string
  /** The verse on the picture and the Facebook card: VERSION/Book/chapter/verse[-last], as share links name it. */
  verse: string
  /** The words of the post, the same on X and Facebook. No link: X shows
   *  posts with links to fewer people and charges 13 times more for them. */
  text: string
  /** The picture's look; sepia unless named. */
  look?: 'light' | 'sepia' | 'dark'
}

export interface Verse { version: string; book: string; chapter: number; first: number; last: number }

/** "BSB/Matt/11/28-30" → its parts, or undefined if it isn't one. */
export function parseVerse(s: string): Verse | undefined {
  const m = /^([\w-]{1,24})\/([\w-]{1,24})\/(\d{1,3})\/(\d{1,3})(?:-(\d{1,3}))?$/.exec(s)
  if (!m) return
  const first = +m[4], last = +(m[5] ?? m[4])
  if (+m[3] < 1 || first < 1 || last < first) return
  return { version: m[1], book: m[2], chapter: +m[3], first, last }
}

/** How long X counts a post: most letters as one, wide letters and emoji as
 *  two, any link as 23 (developer.x.com, "Counting characters"). */
export function xLength(text: string) {
  let n = 0
  for (const part of text.split(/(https?:\/\/\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|app|io)\b\S*)/)) {
    if (/^(https?:\/\/|[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|app|io)\b)/.test(part)) { n += 23; continue }
    for (const ch of part.normalize('NFC')) {
      const c = ch.codePointAt(0)!
      n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2
    }
  }
  return n
}

/** True when the words hold a web address (X would charge for a link post). */
export const hasLink = (text: string) => /https?:\/\/|\b[\w-]+\.(?:com|org|net|app|io)\b/i.test(text)

/** Everything wrong with the list of posts, in plain words (empty = fine). */
export function checkPosts(posts: unknown): string[] {
  if (!Array.isArray(posts)) return ['social/posts.json must be a list of posts']
  const wrong: string[] = [], seen = new Set<string>()
  posts.forEach((p: Partial<Post>, i) => {
    const at = `post ${i + 1}${p?.date ? ` (${p.date})` : ''}`
    if (!p || typeof p !== 'object') { wrong.push(`${at}: not a post`); return }
    if (typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || isNaN(Date.parse(p.date))) wrong.push(`${at}: date must be YYYY-MM-DD`)
    else if (seen.has(p.date)) wrong.push(`${at}: two posts on one day`)
    else seen.add(p.date)
    if (typeof p.verse !== 'string' || !parseVerse(p.verse)) wrong.push(`${at}: verse must look like BSB/John/3/16`)
    if (typeof p.text !== 'string' || !p.text.trim()) wrong.push(`${at}: no words`)
    else {
      if (xLength(p.text) > 280) wrong.push(`${at}: ${xLength(p.text)} characters on X, over 280`)
      if (hasLink(p.text)) wrong.push(`${at}: no links in the words (the link goes in the X bio; Facebook gets its own card)`)
    }
    if (p.look !== undefined && !['light', 'sepia', 'dark'].includes(p.look)) wrong.push(`${at}: look must be light, sepia or dark`)
    for (const k of Object.keys(p)) if (!['date', 'verse', 'text', 'look'].includes(k)) wrong.push(`${at}: unknown field "${k}"`)
  })
  return wrong
}

/** Today's date in New York (the posts' days). */
export function newYorkDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** How many posts are waiting from `today` on. */
export const postsLeft = (posts: Post[], today: string) => posts.filter(p => p.date >= today).length
