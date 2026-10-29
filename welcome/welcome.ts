// The welcome page: what My Quiet Bible is, in the app's own colours and fonts,
// and the way in. Plain HTML; this script only does the theme and language
// buttons, the verse in other languages, the Home Screen steps, and the way in.
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
  for (const b of $$<HTMLButtonElement>('.themes button[data-theme]')) b.setAttribute('aria-pressed', String(b.dataset.theme === t))
  // The Bible opens in this theme too, the first time (src/state.ts).
  if (remember) set(THEME_KEY, t)
}
applyTheme((document.documentElement.dataset.theme as Theme) || 'sepia', false)
for (const b of $$<HTMLButtonElement>('.themes button[data-theme]')) b.addEventListener('click', () => applyTheme(b.dataset.theme as Theme, true))

// ---- the way in ----
// The old address still serves this page while devices move. Someone new
// there goes to the new address; someone with the Bible already on this
// device stays, and its Move button brings everything over.
const newcomerOnOldAddress = location.hostname === 'bible.chama.community' && !get('plain-bible:settings')
const home = newcomerOnOldAddress ? 'https://myquietbible.com/#/read' : '../#/read'
// Called again when the words change: the steps' links are new then.
function wireLinks() {
  for (const a of $$<HTMLAnchorElement>('a[data-open]')) {
    if (a.dataset.wired) continue
    a.dataset.wired = '1'
    a.href = home
    // Once you've gone in, the bare address opens the Bible, not this page (index.html).
    a.addEventListener('click', () => set(WELCOMED_KEY, '1'))
  }
}
wireLinks()

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
let chip = 'en'
function showVerse(id: string) {
  const v = VERSES[id]
  chip = id
  verse.lang = v.lang
  verse.dir = v.lang === 'he' ? 'rtl' : 'ltr'
  verse.innerHTML = '<span class="vn" aria-hidden="true">105</span>'
  verse.appendChild(document.createTextNode(v.text))
  // The Vulgate and the Russian Bible count the Psalms one behind here.
  ref.textContent = word('verseRef').replace('{version}', v.version) + (v.psalm118 ? word('psalm118') : '')
  for (const o of $$<HTMLButtonElement>('.chips button')) o.setAttribute('aria-pressed', String(o.dataset.verse === id))
}
for (const b of $$<HTMLButtonElement>('.chips button')) b.addEventListener('click', () => showVerse(b.dataset.verse!))

// ---- the page's words: English as written in index.html, French and
// Spanish each a small file of their own, loaded only when read ----
type Lang = 'en' | 'fr' | 'es'
type Words = typeof import('./fr').default
const LANG_KEY = 'plain-bible:welcome-lang'
const LOAD: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Words }>> = { fr: () => import('./fr'), es: () => import('./es') }
const root = document.documentElement
const description = $<HTMLMetaElement>('meta[name="description"]')!
const mock = $$<HTMLParagraphElement>('.m-chapter p')
const closing = $('#closing-verse')!
const EN: Words = {
  title: document.title,
  description: description.content,
  homeScreen: 'Put it on your Home Screen',
  computerInstall: 'Install it on your computer',
  verseRef: 'Psalm 119:105 · {version}',
  psalm118: ', where it is Psalm 118',
  mbar: 'Ps 119 · KJV',
  mock: mock.map(p => p.textContent!.replace(/^\d+/, '')),
  closing: closing.textContent!,
} as Words
const html = new Map($$('[data-t]').map(el => [el, el.innerHTML]))
const labels = new Map($$('[data-t-label]').map(el => [el, el.getAttribute('aria-label')!]))
let words: Partial<Words> = {}
const word = <K extends keyof Words>(k: K): Words[K] => words[k] ?? EN[k]
// {svg} puts back the English's drawn icons, in order; the counts are the build's.
const fill = (s: string, svgs: string[] = []) => {
  let i = 0
  return s.replace(/\{svg\}/g, () => svgs[i++] ?? '')
    .replace(/\{(versions|languages)\}/g, (_, k: 'versions' | 'languages') => root.dataset[k] ?? '')
}

async function applyLang(l: Lang, remember: boolean) {
  try { words = l === 'en' ? {} : (await LOAD[l]()).default } catch { words = {}; l = 'en' }
  root.lang = l
  for (const [el, en] of html) {
    const w = words[el.dataset.t as keyof Words]
    el.innerHTML = typeof w === 'string' ? fill(w, en.match(/<svg[\s\S]*?<\/svg>/g) ?? []) : en
  }
  for (const [el, en] of labels) el.setAttribute('aria-label', (words[el.dataset.tLabel as keyof Words] as string) ?? en)
  document.title = word('title')
  description.content = fill(word('description'))
  for (const el of $$('[data-device-label]')) el.textContent = word(computer ? 'computerInstall' : 'homeScreen')
  // The reader in the picture shows the Bible this language opens in.
  mock.forEach((p, i) => {
    const n = String(103 + i), text = word('mock')[i]
    p.innerHTML = `<sup>${n}</sup>`
    if (n === '105') p.appendChild(document.createElement('mark')).textContent = text
    else p.appendChild(document.createTextNode(text))
  })
  closing.textContent = word('closing')
  showVerse(l === 'en' ? (chip === 'fr' || chip === 'es' ? 'en' : chip) : l)
  for (const b of $$<HTMLButtonElement>('.langs button')) b.setAttribute('aria-pressed', String(b.dataset.lang === l))
  // Apple's and Google's own pages, in the same language.
  for (const el of $$<HTMLAnchorElement>('[data-help]')) el.href = el.dataset.help === 'apple'
    ? `https://support.apple.com/${l === 'en' ? '' : l + '-' + l + '/'}guide/iphone/iph42ab2f3a7/ios`
    : `https://support.google.com/chrome/answer/9658361?hl=${l}&co=GENIE.Platform%3D${el.dataset.help === 'android' ? 'Android' : 'Desktop'}`
  wireLinks()
  root.classList.remove('i18n-wait')
  // The Bible starts in this language too, the first time (src/state.ts).
  if (remember) set(LANG_KEY, l)
}
for (const b of $$<HTMLButtonElement>('.langs button')) b.addEventListener('click', () => applyLang(b.dataset.lang as Lang, true))

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
const computer = !iOS && !android
applyLang((['en', 'fr', 'es'].includes(root.lang) ? root.lang : 'en') as Lang, false)

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
