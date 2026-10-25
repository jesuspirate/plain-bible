// The welcome page: what Quiet Bible is, in the app's own colours and fonts,
// and the way in. Plain HTML; this script only does the theme buttons, the
// verse in other languages, the Home Screen steps, and the way in.
import '@fontsource-variable/literata'
import '@fontsource-variable/inter'
import './welcome.css'

const THEME_KEY = 'plain-bible:welcome-theme'
const WELCOMED_KEY = 'plain-bible:welcomed'
const COLORS = { light: '#faf8f3', sepia: '#f4ecd8', dark: '#16161a' } as const
type Theme = keyof typeof COLORS

const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel))

// ---- theme: the one the page started in (set before the first paint, see index.html) ----
function applyTheme(t: Theme, remember: boolean) {
  document.documentElement.dataset.theme = t
  $<HTMLMetaElement>('meta[name="theme-color"]')!.content = COLORS[t]
  // Installing from here takes the window colour of the theme in use, as the app does.
  let link = $<HTMLLinkElement>('link[rel="manifest"]')
  if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link) }
  link.href = `../manifest-${t}.webmanifest`
  for (const b of $$<HTMLButtonElement>('.themes button')) b.setAttribute('aria-pressed', String(b.dataset.theme === t))
  // The Bible opens in this theme too, the first time (src/state.ts).
  if (remember) set(THEME_KEY, t)
}
applyTheme((document.documentElement.dataset.theme as Theme) || 'sepia', false)
for (const b of $$<HTMLButtonElement>('.themes button')) b.addEventListener('click', () => applyTheme(b.dataset.theme as Theme, true))

// ---- the way in ----
// The old address still serves this page while devices move. Someone new
// there goes to the new address; someone with the Bible already on this
// device stays, and its Move button brings everything over.
const newcomerOnOldAddress = location.hostname === 'bible.chama.community' && !get('plain-bible:settings')
const home = newcomerOnOldAddress ? 'https://myquietbible.com/#/read' : '../#/read'
for (const a of $$<HTMLAnchorElement>('a[data-open]')) {
  a.href = home
  // Once you've gone in, the bare address opens the Bible, not this page (index.html).
  a.addEventListener('click', () => set(WELCOMED_KEY, '1'))
}

// On phones, the way in floats at the bottom, as the search bar does in the
// app: once the first button has scrolled away, and until the last one shows.
const float = $('.float')!, floatLink = float.querySelector('a')!
if ('IntersectionObserver' in window) {
  let pastFirst = false, atLast = false
  const update = () => {
    const show = pastFirst && !atLast
    float.classList.toggle('show', show)
    float.setAttribute('aria-hidden', String(!show))
    floatLink.tabIndex = show ? 0 : -1
  }
  new IntersectionObserver(([e]) => { pastFirst = !e.isIntersecting && e.boundingClientRect.top < 0; update() }).observe($('.hero .btn.primary')!)
  new IntersectionObserver(([e]) => { atLast = e.isIntersecting; update() }).observe($('.closing .btn.primary')!)
}

// ---- the lamp verse, in a few of the languages ----
// Each is the verse as that version has it in the app; the Hebrew without
// its cantillation marks, which are hard to read at this size.
const VERSES: Record<string, { lang: string; text: string; version: string; psalm118?: true }> = {
  en: { lang: 'en', text: 'Thy word is a lamp unto my feet, and a light unto my path.', version: 'King James Version' },
  fr: { lang: 'fr', text: 'Ta parole est une lampe à mes pieds, Et une lumière sur mon sentier.', version: 'Louis Segond 1910' },
  de: { lang: 'de', text: 'Dein Wort ist meines Fußes Leuchte und ein Licht auf meinem Wege.', version: 'Luther 1545' },
  es: { lang: 'es', text: 'Lámpara es á mis pies tu palabra, y lumbrera á mi camino.', version: 'Reina-Valera 1909' },
  la: { lang: 'la', text: 'Lucerna pedibus meis verbum tuum, et lumen semitis meis.', version: 'Clementine Vulgate', psalm118: true },
  ru: { lang: 'ru', text: 'Слово Твое — светильник ноге моей и свет стезе моей.', version: 'Russian Synodal Bible', psalm118: true },
  zh: { lang: 'zh-Hant', text: '你的話是我腳前的燈，是我路上的光。', version: 'Chinese Union Version' },
  he: { lang: 'he', text: 'נֵר־לְרַגְלִי דְבָרֶךָ וְאוֹר לִנְתִיבָתִי׃', version: 'Westminster Leningrad Codex' },
}
const verse = $<HTMLQuoteElement>('#verse')!, ref = $('#verse-ref')!
for (const b of $$<HTMLButtonElement>('.chips button')) b.addEventListener('click', () => {
  const v = VERSES[b.dataset.verse!]
  verse.lang = v.lang
  verse.dir = v.lang === 'he' ? 'rtl' : 'ltr'
  verse.innerHTML = '<span class="vn" aria-hidden="true">105</span>'
  verse.appendChild(document.createTextNode(v.text))
  // The Vulgate and the Russian Bible count the Psalms one behind here.
  ref.textContent = `Psalm 119:105 · ${v.version}` + (v.psalm118 ? ', where it is Psalm 118' : '')
  for (const o of $$<HTMLButtonElement>('.chips button')) o.setAttribute('aria-pressed', String(o === b))
})

// ---- Home Screen: the steps for the device in hand first ----
const ua = navigator.userAgent
const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const android = /Android/i.test(ua)
function showPanel(id: string) {
  for (const t of $$<HTMLButtonElement>('.seg button')) {
    const on = t.id === `tab-${id}`
    t.setAttribute('aria-pressed', String(on))
    $(`#${t.getAttribute('aria-controls')}`)!.hidden = !on
  }
}
for (const t of $$<HTMLButtonElement>('.seg button')) t.addEventListener('click', () => showPanel(t.id.slice(4)))
showPanel(iOS ? 'iphone' : android ? 'android' : 'computer')
// A computer has no Home Screen.
if (!iOS && !android) for (const el of $$('[data-device-label]')) el.textContent = 'Install it on your computer'

// Where the browser offers to install (Chrome on Android and computers), one button does it.
interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let install: BeforeInstallPromptEvent | undefined
addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  install = e as BeforeInstallPromptEvent
  for (const el of $$('.install-now')) el.hidden = false
})
for (const b of $$<HTMLButtonElement>('[data-install]')) b.addEventListener('click', async () => {
  if (!install) return
  b.disabled = true
  try {
    await install.prompt()
    const { outcome } = await install.userChoice
    if (outcome === 'accepted') installed()
  } catch { /* the browser said no; the steps are still there */ }
  b.disabled = false
})
function installed() {
  install = undefined
  for (const el of $$('.install-now')) el.hidden = true
  for (const el of $$('.installed')) el.hidden = false
  set(WELCOMED_KEY, '1')
}
addEventListener('appinstalled', installed)

// Fetch the Bible itself in the background, so it opens at once and works
// offline from the first tap. The same worker the app registers; a page
// already open is never taken over (vite.config.ts: clientsClaim off). Not
// when the phone is saving data.
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
if (import.meta.env.PROD && 'serviceWorker' in navigator && navigator.onLine && !saveData) {
  addEventListener('load', () => setTimeout(() => { navigator.serviceWorker.register('../sw.js').catch(() => {}) }, 2500))
}
