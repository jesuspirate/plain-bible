// The welcome and support pages' languages: the same ones the app speaks
// (src/i18n.ts). English is written in each page; every other language is a
// small file of its own (public/i18n/<page>/<lang>.json), fetched only when
// read. EN, FR and ES are buttons; the rest are in the 🌐 list beside them.
import { isRtl, LANGS } from '../src/i18n'

export type Lang = string
export const known = (l: string) => LANGS.some(x => x.id === l)

/** A page's words in a language; English needs none. */
export async function loadWords<W>(page: 'welcome' | 'support', l: Lang): Promise<Partial<W>> {
  if (l === 'en') return {}
  const r = await fetch(new URL(`../i18n/${page}/${l}.json`, location.href))
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** Wires the language buttons and the 🌐 list; pick is called with the choice. */
export function langPicker(pick: (l: Lang) => void) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.langs button[data-lang]'))
  for (const b of buttons) b.addEventListener('click', () => pick(b.dataset.lang!))
  const more = document.querySelector<HTMLLabelElement>('.more-lang')
  const select = more?.querySelector('select')
  if (more && select && LANGS.length > 3) {
    more.hidden = false
    for (const l of [...LANGS].sort((a, b) => a.name.localeCompare(b.name))) {
      const o = select.appendChild(document.createElement('option'))
      o.value = l.id; o.lang = l.id; o.textContent = l.name
    }
    select.addEventListener('change', () => pick(select.value))
  }
  /** Shows which language is in use. */
  return (l: Lang, label: string) => {
    document.documentElement.lang = l
    document.documentElement.dir = isRtl(l) ? 'rtl' : 'ltr'
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.lang === l))
    if (more && select) {
      const other = !buttons.some(b => b.dataset.lang === l)
      select.value = l
      select.setAttribute('aria-label', label)
      more.classList.toggle('on', other)
      more.querySelector('.more-code')!.textContent = other ? l.split('-')[0].toUpperCase() : ''
    }
  }
}
