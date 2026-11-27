import { useState } from 'preact/hooks'
import { BOOKS, bookName } from './lib/books'
import { Bible } from './lib/data'
import { loadTrail } from './lib/history'
import { go, readPath, useApp } from './state'
import { recentVersions, rememberVersion } from './ui'
import { currentLang, t } from './i18n'
import { CloseIcon } from './icons'

// When the Bible you switched to (or a link, or Continue) lands on a chapter
// or a verse that Bible doesn't have, a calm card says so in plain words and
// offers a way on: the Bible you were just reading, another one that has it,
// or the nearest place this Bible does have. Never a blank page.

/** The Bibles that have `book`, the likeliest first: the ones you used
 *  lately, your own, the same language as this one, your language, then all. */
function useHavingBook(book: string, version: string): string[] {
  const { catalog, byId, settings } = useApp()
  const has = (id: string) => id !== version && !!byId.get(id)?.books.includes(book)
  const lang = byId.get(version)?.lang
  const ui = currentLang().split('-')[0]
  const all = catalog.translations.map(x => x.id)
  return [...new Set([
    ...recentVersions(), ...settings.myVersions,
    ...all.filter(id => byId.get(id)?.lang === lang),
    ...all.filter(id => byId.get(id)?.lang.split('-')[0] === ui),
    ...all,
  ])].filter(has)
}

/** Switches to `v` like the versions pill does: it becomes your Bible. */
function useSwitch(version: string, parallel: string[]) {
  const { update } = useApp()
  return (v: string, book: string, chapter: number, verse?: number) => {
    rememberVersion(version); rememberVersion(v)
    const others = parallel.filter(id => id !== v)
    update({ version: v, parallel: others })
    go(readPath(v, book, chapter, verse, others), true)
  }
}

function ReadIn({ id, onClick, primary }: { id: string; onClick: () => void; primary?: boolean }) {
  const { byId } = useApp()
  return (
    <button class={'miss-btn' + (primary ? ' primary' : '')} onClick={onClick}>
      <strong>{t('Read it in {version}', { version: id })}</strong>
      <span>{byId.get(id)?.name}</span>
    </button>
  )
}

/** The whole chapter is missing. */
export function MissingChapter({ version, bible, book, chapter, verse, parallel }: {
  version: string; bible: Bible; book: string; chapter: number; verse?: number; parallel: string[]
}) {
  const { byId } = useApp()
  const [more, setMore] = useState(false)
  const [all, setAll] = useState(false)
  const switchTo = useSwitch(version, parallel)
  const others = useHavingBook(book, version)
  const ref = `${bookName(book)} ${chapter}${verse ? ':' + verse : ''}`

  // The nearest place this Bible has: the last chapter of the book when the
  // chapter runs past its end; for a book it doesn't have, the place you were
  // reading before, else the start of the Bible.
  const count = bible.books[book]?.length ?? 0
  const back = loadTrail().items.slice().reverse().find(p => p.book !== book && (bible.books[p.book]?.length ?? 0) >= p.chapter)
  const first = BOOKS.find(b => bible.books[b.id])?.id
  const near: [string, number, number?] | undefined = count ? [book, count]
    : back ? [back.book, back.chapter, back.verse || undefined]
    : first ? [first, 1] : undefined

  const list = all ? others.slice(1) : others.slice(1, 6)
  return (
    <div class="miss" role="status">
      <h2>{t('{ref} isn’t in this Bible', { ref })}</h2>
      <p class="muted">{byId.get(version)?.name ?? version}</p>
      <div class="miss-actions">
        {others[0] && <ReadIn id={others[0]} primary onClick={() => switchTo(others[0], book, chapter, verse)} />}
        {others.length > 1 && !more && (
          <button class="miss-btn" aria-expanded={false} onClick={() => setMore(true)}>
            <strong>{t('Other Bibles that have it')}</strong>
          </button>
        )}
        {more && list.map(id => <ReadIn id={id} onClick={() => switchTo(id, book, chapter, verse)} />)}
        {more && !all && others.length > 6 && (
          <button class="miss-btn quiet" onClick={() => setAll(true)}>
            <strong>{t('All Bibles that have it ({n})', { n: others.length })}</strong>
          </button>
        )}
        {near && (
          <button class="miss-btn quiet" onClick={() => go(readPath(version, near[0], near[1], near[2], parallel))}>
            <strong>{t('Go to {ref}', { ref: `${bookName(near[0])} ${near[1]}` })}</strong>
          </button>
        )}
      </div>
    </div>
  )
}

/** The chapter is there, but the verse you went to isn't (this Bible
 *  numbers that chapter differently, or the verse was left out). */
export function MissingVerse({ version, book, chapter, verse, last, parallel, onClose }: {
  version: string; book: string; chapter: number; verse: number; last: number; parallel: string[]; onClose: () => void
}) {
  const { byId } = useApp()
  const switchTo = useSwitch(version, parallel)
  const before = recentVersions().find(id => id !== version && byId.get(id)?.books.includes(book))
  return (
    <div class="miss miss-verse" role="status">
      <button class="close-btn miss-close" aria-label={t('Close')} onClick={onClose}><CloseIcon /></button>
      <h2>{t('{ref} isn’t in this Bible', { ref: `${bookName(book)} ${chapter}:${verse}` })}</h2>
      <p class="muted">{t('Here this chapter ends at verse {n}.', { n: last })}</p>
      <div class="miss-actions">
        {before && <ReadIn id={before} primary onClick={() => switchTo(before, book, chapter, verse)} />}
        <button class="miss-btn quiet" onClick={() => { onClose(); go(readPath(version, book, chapter, last, parallel), true) }}>
          <strong>{t('Go to verse {n}', { n: last })}</strong>
        </button>
      </div>
    </div>
  )
}
