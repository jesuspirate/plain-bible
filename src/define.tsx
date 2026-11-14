import { useEffect, useState } from 'preact/hooks'
import { cleanWord, define, Definition, DICT_LANGS, DictLang, haveDict, isWord, loadDict, Sense } from './lib/dict'
import { Sheet } from './ui'
import { go } from './state'
import { currentLang, t } from './i18n'

/** The dictionary in the Bible's own language when there is one, else in
 *  the app's language. */
export const dictLangFor = (bibleLang: string | undefined): DictLang =>
  DICT_LANGS.includes(bibleLang as DictLang) ? bibleLang as DictLang : currentLang()

/** The word selected in the Bible's text, if just one word is, and the
 *  language of the version it's in when the page says (side by side
 *  versions). On a phone you hold a word to select it; with a mouse,
 *  double click it. */
export function useSelectedWord(within: () => HTMLElement | null | undefined): { word: string; lang?: string } | undefined {
  const [word, setWord] = useState<{ word: string; lang?: string }>()
  useEffect(() => {
    let timer = 0
    const check = () => {
      const sel = getSelection(), text = String(sel ?? '').trim()
      const root = within(), node = sel?.anchorNode
      const el = node?.parentElement
      const inside = !!root && !!el && root.contains(el) && !!el.closest('.vt')
      const tagged = el?.closest<HTMLElement>('[lang]')
      const w = inside && isWord(text) ? cleanWord(text) : undefined
      setWord(old => w === old?.word ? old : w ? { word: w, lang: tagged && root!.contains(tagged) ? tagged.lang : undefined } : undefined)
    }
    // While a finger drags the selection's handles it changes many times a second.
    const later = () => { clearTimeout(timer); timer = window.setTimeout(check, 150) }
    document.addEventListener('selectionchange', later)
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', later) }
  }, [])
  return word
}

/** The big glass button offered over the page while one word is selected. */
export function DefinePill({ word, onDefine }: { word: string; onDefine: () => void }) {
  return (
    <button class="define-pill" onClick={onDefine}
      // Keep the word selected while the button is pressed.
      onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}>
      <BookIcon />
      <span>{t('Define “{word}”', { word })}</span>
    </button>
  )
}

function BookIcon() {
  return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /><path d="M9 8h7M9 11.5h5" />
  </svg>
}

type State =
  | { at: 'loading'; first: boolean }
  | { at: 'offline' }
  | { at: 'done'; def?: Definition }

/** The meaning of one word, from the dictionary in `lang`. The dictionary
 *  downloads the first time it's needed and is kept for offline use. */
export function DefineSheet({ word, lang, version, onClose }: { word: string; lang: DictLang; version?: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ at: 'loading', first: false })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    haveDict(lang).then(have => {
      if (!live) return
      setState({ at: 'loading', first: !have })
      return loadDict(lang).then(d => { if (live) setState({ at: 'done', def: define(d, word) }) })
    }).catch(() => { if (live) setState({ at: 'offline' }) })
    return () => { live = false }
  }, [word, lang, retry])

  const search = () => { onClose(); go(`search?q=${encodeURIComponent(word)}${version ? '&v=' + version : ''}`) }

  return (
    <Sheet title={state.at === 'done' && state.def ? state.def.word : word} onClose={onClose}>
      <div class="define" lang={lang}>
        {state.at === 'loading' && <p class="muted">{state.first
          ? t('Getting the dictionary, just this once. After that it works offline.')
          : t('Loading…')}</p>}
        {state.at === 'offline' && <>
          <p>{t('The dictionary downloads the first time you use it. Connect to the internet, then try again.')}</p>
          <button class="define-big" onClick={() => setRetry(n => n + 1)}>{t('Try again')}</button>
        </>}
        {state.at === 'done' && (state.def ? <Meaning def={state.def} /> : <p>{t('No definition found for “{word}”.', { word })}</p>)}
        {state.at !== 'offline' && <button class="define-big" onClick={search}>{t('Find “{word}” in the Bible', { word })}</button>}
        <p class="muted small define-credit">{t('Definitions from Wiktionary (CC BY-SA).')}</p>
      </div>
    </Sheet>
  )
}

/** A form of a word ("begat") leads with its base word ("beget"), as that's
 *  usually what's meant; then the word's own meanings, if it has any. */
function Meaning({ def }: { def: Definition }) {
  return <>
    {def.bases.slice(0, 2).map(b => (
      <section class="define-base">
        <p class="define-how">{b.how || t('A form of “{word}”', { word: b.word })}</p>
        <h3 class="define-word">{b.word}</h3>
        <Senses senses={b.senses} />
      </section>
    ))}
    {def.senses.length > 0 && <section>
      {def.bases.length > 0 && <h3 class="define-word">{def.word}</h3>}
      <Senses senses={def.senses} />
    </section>}
  </>
}

function Senses({ senses }: { senses: Sense[] }) {
  return <>{senses.map(([kind, ...defs]) => <>
    <p class="define-kind">{kind}</p>
    <ol class="define-list">{defs.map(d => <li>{d}</li>)}</ol>
  </>)}</>
}
