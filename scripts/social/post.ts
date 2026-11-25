// The daily post to X (@myquietbible) and the Facebook page, run each
// morning by .github/workflows/social.yml. Run it through scripts/social/run.sh.
//
//   run.sh                     today's post (New York date), posted for real
//   run.sh --dry               draws and prints today's post, posts nothing
//   run.sh --dry --all         every post still to come (to look them over)
//   run.sh --date 2026-12-01   that day's post instead of today's
//   run.sh --check             tests the keys, the Bible, the pictures and the
//                              Facebook card for the next post; posts nothing
//
// What goes out comes only from social/posts.json, so merging it is the yes.
// X gets the words and the tall verse picture (no link: a link post costs 13
// times more and reaches fewer people). Facebook gets the words and the verse
// link (share.myquietbible.com), whose card shows the wide verse picture.
//
// Keys come from the environment (repository secrets), never the command line:
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET   (X app with Read and Write)
//   FB_PAGE_ID, FB_PAGE_TOKEN                                 (page token with pages_manage_posts)
// A platform with no keys is skipped, with a note.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { BOOKS } from '../../src/lib/bookList'
import { cardLink, SHARE_ORIGIN } from '../../src/lib/shareTo'
import { oauthHeader } from './oauth'
import { checkPosts, newYorkDate, parseVerse, postsLeft, type Post, type Verse } from '../../src/lib/socialPosts'

const APP = 'https://myquietbible.com'
const SYNC = process.env.SYNC_URL || ''
const GRAPH = `https://graph.facebook.com/${process.env.FB_GRAPH_VERSION || 'v24.0'}`
const ROOT = process.env.ROOT!, OUT = process.env.OUT || join(ROOT, 'social-out')

const args = process.argv.slice(2)
const dry = args.includes('--dry'), all = args.includes('--all'), check = args.includes('--check')
const day = args[args.indexOf('--date') + 1] && args.includes('--date') ? args[args.indexOf('--date') + 1] : newYorkDate()

const note = (s: string) => console.log(s)
const warn = (s: string) => console.log(`::warning::${s}`)
const fail = (s: string): never => { console.log(`::error::${s}`); process.exit(1) }

// ---- The verse, from the app's own Bible file --------------------------------

const bibles = new Map<string, Promise<{ books: Record<string, string[][]> }>>()
const TAG = /\{([^{}|]*)\|[^{}]*\}/g
async function verseWords(v: Verse) {
  if (!bibles.has(v.version)) bibles.set(v.version, data(`bibles/${v.version}.json`))
  const ch = (await bibles.get(v.version)!).books[v.book]?.[v.chapter - 1]
  const words: string[] = []
  for (let n = v.first; n <= v.last; n++) if (ch?.[n - 1]) words.push(ch[n - 1].replace(TAG, '$1'))
  if (!words.length) throw new Error(`no such verse: ${v.version} ${v.book} ${v.chapter}:${v.first}`)
  return words.join(' ').replace(/\s+/g, ' ').trim()
}
// The live app's data, or a local copy (DATA_DIR, e.g. public/data after `npm run data`).
async function data(path: string) {
  if (process.env.DATA_DIR) return JSON.parse(readFileSync(join(process.env.DATA_DIR, path), 'utf8'))
  const r = await fetch(`${APP}/data/${path}`)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json()
}
let catalog: Promise<{ translations: { id: string; name: string }[] }> | undefined
async function bibleName(id: string) {
  catalog ??= data('catalog.json')
  return (await catalog).translations.find(t => t.id === id)?.name ?? id
}
function reference(v: Verse) {
  const name = BOOKS.find(b => b.id === v.book)?.name ?? v.book
  const one = name === 'Psalms' ? 'Psalm' : name
  return `${one} ${v.chapter}:${v.first}${v.last > v.first ? `–${v.last}` : ''}`
}

// ---- The pictures, drawn by the app's own code (src/lib/versePicture.ts) ----

async function draw(pics: { words: string; reference: string; bible: string; look: string; wide: boolean }[]) {
  const nm = join(ROOT, 'node_modules')
  const page = join(OUT, 'draw.html')
  writeFileSync(page, `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(join(nm, '@fontsource-variable/literata/index.css'))}">
<link rel="stylesheet" href="${pathToFileURL(join(nm, '@fontsource-variable/inter/index.css'))}">
<style>:root{--serif:'Literata Variable',Georgia,serif;--sans:'Inter Variable',system-ui,sans-serif;--reading:var(--serif)}</style>
<script src="${pathToFileURL(join(OUT, 'picture.js'))}"></script>`)
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
  try {
    const tab = await browser.newPage()
    await tab.goto(pathToFileURL(page).href)
    const out: Buffer[] = []
    for (const p of pics) {
      const b64 = await tab.evaluate(async p => {
        const blob: Blob = await (window as any).VersePicture.drawPicture(p)
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let s = ''
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(s)
      }, p)
      out.push(Buffer.from(b64, 'base64'))
    }
    return out
  } finally { await browser.close() }
}

// ---- X: OAuth 1.0a, as the @myquietbible account ------------------------------

function xAuth(method: string, url: string) {
  return oauthHeader(method, url, {
    consumerKey: process.env.X_API_KEY!, consumerSecret: process.env.X_API_SECRET!,
    token: process.env.X_ACCESS_TOKEN!, tokenSecret: process.env.X_ACCESS_SECRET!,
  }, randomBytes(16).toString('hex'), Math.floor(Date.now() / 1000))
}
async function xCall(url: string, body: FormData | object) {
  const form = body instanceof FormData
  const res = await fetch(url, { method: 'POST', headers: { Authorization: xAuth('POST', url), ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: form ? body : JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`X ${new URL(url).pathname}: ${res.status} ${text.slice(0, 300)}`)
  return JSON.parse(text)
}
async function postX(text: string, picture: Buffer) {
  const form = new FormData()
  form.append('media', new Blob([new Uint8Array(picture)], { type: 'image/png' }), 'verse.png')
  form.append('media_category', 'tweet_image')
  form.append('media_type', 'image/png')
  const media = await xCall('https://api.x.com/2/media/upload', form)
  const id = media?.data?.id ?? media?.media_id_string
  if (!id) throw new Error(`X picture: no id in ${JSON.stringify(media).slice(0, 200)}`)
  const post = await xCall('https://api.x.com/2/tweets', { text, media: { media_ids: [String(id)] } })
  return `https://x.com/myquietbible/status/${post.data.id}`
}

// ---- Facebook: a link post on the page ------------------------------------------

async function cardPicture(wide: Buffer) {
  if (!SYNC) return
  try {
    const r = await fetch(`${SYNC}/card`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(wide) })
    const j = r.ok ? await r.json() as { id?: string } : undefined
    if (j?.id && /^[a-f0-9]{32}$/.test(j.id)) return j.id
    warn(`verse picture for the Facebook card was refused (${r.status}); the card shows the lamp`)
  } catch (e) { warn(`verse picture for the Facebook card: ${e}`) }
}
async function postFacebook(text: string, link: string) {
  const body = new URLSearchParams({ message: text, link, access_token: process.env.FB_PAGE_TOKEN! })
  const res = await fetch(`${GRAPH}/${encodeURIComponent(process.env.FB_PAGE_ID!)}/feed`, { method: 'POST', body })
  const j = await res.json() as { id?: string; error?: { message?: string } }
  if (!res.ok || !j.id) throw new Error(`Facebook: ${res.status} ${j.error?.message ?? ''}`)
  return `https://www.facebook.com/${j.id}`
}

// ---- The day's run --------------------------------------------------------------

const posts: Post[] = JSON.parse(readFileSync(join(ROOT, 'social/posts.json'), 'utf8'))
const wrong = checkPosts(posts)
if (wrong.length) fail(`social/posts.json: ${wrong.join('; ')}`)

// ---- The check: everything a real post needs, without posting -------------------

async function runCheck() {
  let bad = 0
  const ok = (s: string) => note(`✓ ${s}`)
  const no = (s: string) => { bad++; console.log(`::error::✗ ${s}`) }
  const next = posts.find(p => p.date >= day)
  if (!next) no('no post still to come in social/posts.json')
  else ok(`next post: ${next.date} (${posts.filter(p => p.date >= day).length} still to come)`)

  let wide: Buffer | undefined, v: Verse | undefined
  if (next) {
    try {
      v = parseVerse(next.verse)!
      const [words, bible] = await Promise.all([verseWords(v), bibleName(v.version)])
      ok(`verse found: ${reference(v)} (${bible})`)
      const look = next.look ?? 'sepia'
      mkdirSync(OUT, { recursive: true })
      const [tall, w] = await draw([{ words, reference: reference(v), bible, look, wide: false }, { words, reference: reference(v), bible, look, wide: true }])
      writeFileSync(join(OUT, `${next.date}-x.png`), tall); writeFileSync(join(OUT, `${next.date}-facebook-card.png`), w)
      wide = w
      ok(`pictures drawn (${tall.length} and ${w.length} bytes)`)
    } catch (e) { no(`verse or pictures: ${e}`) }
  }

  // X: who these keys post as. A read costs a fraction of a cent.
  if (['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'].every(k => process.env[k])) {
    try {
      const url = 'https://api.x.com/2/users/me'
      const r = await fetch(url, { headers: { Authorization: xAuth('GET', url) } })
      const j = await r.json() as { data?: { username?: string }; title?: string; detail?: string }
      if (r.ok && j.data?.username) ok(`X keys work, posting as @${j.data.username}`)
      else no(`X keys refused: ${r.status} ${j.title ?? ''} ${j.detail ?? ''}`)
    } catch (e) { no(`X: ${e}`) }
  } else no('X keys are not all set')

  // Facebook: the page token, read by itself (debug_token).
  if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
    try {
      const tok = process.env.FB_PAGE_TOKEN
      const page = await (await fetch(`${GRAPH}/${encodeURIComponent(process.env.FB_PAGE_ID)}?fields=id,name&access_token=${encodeURIComponent(tok)}`)).json() as { name?: string; error?: { message?: string } }
      if (page.name) ok(`Facebook page found: ${page.name}`)
      else no(`Facebook page: ${page.error?.message ?? 'not found'}`)
      const d = (await (await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(tok)}&access_token=${encodeURIComponent(tok)}`)).json() as { data?: { type?: string; is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[] } }).data
      if (!d?.is_valid) no('Facebook token is not valid')
      else {
        if (d.type === 'PAGE') ok('Facebook token is a page token')
        else no(`Facebook token is a ${d.type} token, not a page token (use the access_token from me/accounts)`)
        if (d.scopes?.includes('pages_manage_posts')) ok('Facebook token may post on the page')
        else no('Facebook token lacks pages_manage_posts')
        if (!d.expires_at) ok('Facebook token never expires')
        else no(`Facebook token expires ${new Date(d.expires_at * 1000).toISOString().slice(0, 10)}: make it from an extended user token`)
        if (d.data_access_expires_at) note(`  (Facebook asks for a fresh sign-in to the app by ${new Date(d.data_access_expires_at * 1000).toISOString().slice(0, 10)})`)
      }
    } catch (e) { no(`Facebook: ${e}`) }
  } else no('Facebook keys are not both set')

  // The Facebook card: the wide picture kept by the sync service, shown by the share page.
  if (wide && v) {
    const id = await cardPicture(wide)
    if (!id) no('the sync service did not keep the card picture')
    else {
      ok('card picture kept by the sync service')
      try {
        const link = `${cardLink(SHARE_ORIGIN, v.version, v.book, v.chapter, v.first, v.last)}&p=${id}`
        const html = await (await fetch(link, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } })).text()
        if (html.includes(`/card/${id}.png`)) ok('the share page shows the verse picture as its card')
        else no('the share page does not show the verse picture')
      } catch (e) { no(`share page: ${e}`) }
    }
  }

  note(bad ? `\n${bad} problem${bad === 1 ? '' : 's'} to fix before the next post.` : '\nAll set: the next post should go out.')
  process.exit(bad ? 1 : 0)
}
if (check) await runCheck()

const today = all ? posts.filter(p => p.date >= day) : posts.filter(p => p.date === day)
const left = postsLeft(posts, day)
if (!today.length) {
  if (all) { note('No posts still to come.'); process.exit(0) }
  fail(`No post for ${day} in social/posts.json. Add more posts (a pull request) to keep the daily posts going.`)
}
if (!all && left <= 7) warn(`Only ${left} post${left === 1 ? '' : 's'} left, counting today. Time to add the next month.`)

mkdirSync(OUT, { recursive: true })
let broke = false
for (const p of today) {
  const v = parseVerse(p.verse)!
  const look = p.look ?? 'sepia'
  const [words, bible] = await Promise.all([verseWords(v), bibleName(v.version)])
  const ref = reference(v)
  const [tall, wide] = await draw([
    { words, reference: ref, bible, look, wide: false },
    { words, reference: ref, bible, look, wide: true },
  ])
  writeFileSync(join(OUT, `${p.date}-x.png`), tall)
  writeFileSync(join(OUT, `${p.date}-facebook-card.png`), wide)
  const link = cardLink(SHARE_ORIGIN, v.version, v.book, v.chapter, v.first, v.last)
  note(`\n=== ${p.date} · ${ref} (${v.version}) ===\n${p.text}\nFacebook link: ${link}&p=<picture>`)
  if (dry) continue

  const hasX = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'].every(k => process.env[k])
  const hasFb = ['FB_PAGE_ID', 'FB_PAGE_TOKEN'].every(k => process.env[k])
  if (!hasX) warn('X keys are not set: skipped X')
  if (!hasFb) warn('Facebook keys are not set: skipped Facebook')
  // One failing never stops the other.
  if (hasX) await postX(p.text, tall).then(u => note(`Posted on X: ${u}`), e => { broke = true; console.log(`::error::${e.message}`) })
  if (hasFb) {
    const id = await cardPicture(wide)
    await postFacebook(p.text, id ? `${link}&p=${id}` : link).then(u => note(`Posted on Facebook: ${u}`), e => { broke = true; console.log(`::error::${e.message}`) })
  }
}
note(`\nPictures are in ${OUT}`)
if (broke) process.exit(1)
