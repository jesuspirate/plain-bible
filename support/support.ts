// The support page: how to give, in the welcome page's colours and fonts.
// Plain HTML; this script only does the theme and language buttons, and the
// Bitcoin section once it is filled in (index.html, #bitcoin).
import '@fontsource-variable/literata'
import '@fontsource-variable/inter'
import '../welcome/welcome.css'
import './support.css'

const COLORS = { light: '#faf8f3', sepia: '#f4ecd8', dark: '#16161a' } as const
type Theme = keyof typeof COLORS
type Lang = 'en' | 'fr' | 'es'
type Words = typeof import('./fr').default

const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel))
const root = document.documentElement

// ---- theme: shared with the welcome page, and the Bible's first start ----
function applyTheme(t: Theme, remember: boolean) {
  root.dataset.theme = t
  $<HTMLMetaElement>('meta[name="theme-color"]')!.content = COLORS[t]
  for (const b of $$<HTMLButtonElement>('.themes button[data-theme]')) b.setAttribute('aria-pressed', String(b.dataset.theme === t))
  if (remember) set('plain-bible:welcome-theme', t)
}
applyTheme((root.dataset.theme as Theme) || 'sepia', false)
for (const b of $$<HTMLButtonElement>('.themes button[data-theme]')) b.addEventListener('click', () => applyTheme(b.dataset.theme as Theme, true))

// ---- words: English as written in index.html, French and Spanish loaded when read ----
const LOAD: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Words }>> = { fr: () => import('./fr'), es: () => import('./es') }
const description = $<HTMLMetaElement>('meta[name="description"]')!
const EN = { title: document.title, description: description.content } as Words
const html = new Map($$('[data-t]').map(el => [el, el.innerHTML]))
const labels = new Map($$('[data-t-label]').map(el => [el, el.getAttribute('aria-label')!]))
let words: Partial<Words> = {}

async function applyLang(l: Lang, remember: boolean) {
  try { words = l === 'en' ? {} : (await LOAD[l]()).default } catch { words = {}; l = 'en' }
  root.lang = l
  for (const [el, en] of html) {
    const w = words[el.dataset.t as keyof Words]
    // The back arrow is drawn, and stays.
    el.innerHTML = typeof w === 'string' ? (en.match(/^<svg[\s\S]*?<\/svg>/)?.[0] ?? '') + w : en
  }
  for (const [el, en] of labels) el.setAttribute('aria-label', (words[el.dataset.tLabel as keyof Words] as string) ?? en)
  document.title = words.title ?? EN.title
  description.content = words.description ?? EN.description
  for (const b of $$<HTMLButtonElement>('.langs button')) b.setAttribute('aria-pressed', String(b.dataset.lang === l))
  root.classList.remove('i18n-wait')
  if (remember) set('plain-bible:welcome-lang', l)
}
for (const b of $$<HTMLButtonElement>('.langs button')) b.addEventListener('click', () => applyLang(b.dataset.lang as Lang, true))
applyLang((['en', 'fr', 'es'].includes(root.lang) ? root.lang : 'en') as Lang, false)

// ---- Bitcoin: shown only once index.html has a pay link or an address ----
const btc = $('#bitcoin')!
const { btcpay = '', address = '', lightning = '' } = btc.dataset
if (btcpay || address || lightning) {
  btc.hidden = false
  if (btcpay) {
    $('.btc-pay', btc)!.hidden = false
    $<HTMLAnchorElement>('.btc-pay a', btc)!.href = btcpay
  }
  const shown: [HTMLElement, string][] = []
  for (const [kind, value, uri] of [['address', address, 'bitcoin:' + address], ['lightning', lightning, 'lightning:' + lightning]]) {
    if (!value) continue
    const fig = $(`.qr[data-kind="${kind}"]`, btc)!
    const code = $('code', fig)!, copy = $<HTMLButtonElement>('.copy', fig)!
    code.textContent = value
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value)
        copy.textContent = (words.copied ?? 'Copied') + ' ✓'
        setTimeout(() => { copy.textContent = words.copy ?? 'Copy' }, 2000)
      } catch { getSelection()?.selectAllChildren(code) }
    })
    fig.hidden = false
    shown.push([$('.qr-code', fig)!, uri])
  }
  // The QR drawing is loaded only here, and only when there is something to draw.
  if (shown.length) import('qrcode-generator').then(({ default: qrcode }) => {
    for (const [box, uri] of shown) {
      const qr = qrcode(0, 'M')
      qr.addData(uri)
      qr.make()
      const n = qr.getModuleCount()
      let d = ''
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
      // Always dark on white, with a quiet border, whatever the theme: what phone cameras read best.
      box.innerHTML = `<svg viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#111"/></svg>`
    }
  }).catch(() => { for (const [box] of shown) box.hidden = true })
}
