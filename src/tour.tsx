// The guided tour: a handful of calm steps for someone new. Each one dims the
// page, leaves the one thing it's about lit, and says in a sentence or two
// what it does. Nothing can be pressed by mistake behind it, the × on every
// step puts it away, and it never comes back by itself once seen. Loaded only when it opens.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { t } from './i18n'
import { CloseIcon } from './icons'
import { markTourSeen as markSeen } from './state'
import './tour.css'


type Step = { title: string; body: string; find?: () => Element | null }

const top = () => document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0
/** The first verse fully on screen, clear of the top bar and the search bar. */
function verseInView() {
  const from = top() + 8, to = innerHeight - 170
  for (const v of document.querySelectorAll('.reader > article.chapter :is(.verse, .pv)')) {
    const r = v.getBoundingClientRect()
    if (r.top >= from && r.bottom <= to && r.height > 0) return v
    if (r.top > to) break
  }
  return null
}
const onScreen = (sel: string) => () => {
  const el = document.querySelector(sel)
  const r = el?.getBoundingClientRect()
  return r && r.width > 0 && r.bottom > 0 && r.top < innerHeight ? el : null
}

function steps(): Step[] {
  const all: (Step | false)[] = [
    { title: t('Welcome to My Quiet Bible'), body: t('Just the Bible, quiet and simple. Here is a short look around. It takes about a minute.') },
    { title: t('Turn the page'), body: t('Swipe left or right to go to the next or the previous chapter.'), find: onScreen('.reader > article.chapter .chapter-title') },
    { title: t('Tap a verse'), body: t('Tap any verse to highlight it, write a note, save a bookmark or hear it read aloud.'), find: verseInView },
    { title: t('Search'), body: t('Type words you remember, or a passage like John 3:16. Tap here to pick a book and chapter too.'), find: onScreen('.sb-field') },
    !!document.querySelector('.sb-circles') && { title: t('Circles'), body: t('Share verses and prayers with a few people you trust, like your family or a small prayer group.'), find: onScreen('.sb-circles') },
    { title: t('Pray'), body: t('Tap 🙏 to pray out loud and keep your prayer. It stays private.'), find: onScreen('.sb-pray') },
    { title: t('Go back'), body: t('After you jump somewhere else, tap here to go back to where you were reading.'), find: onScreen('.history-btn') },
    { title: t('Settings'), body: t('Your Bible, text size, theme, language and account are all here. You can take this tour again from Settings.'), find: onScreen('.profile-btn') },
  ]
  return all.filter((s): s is Step => !!s)
}

type Box = { top: number; left: number; width: number; height: number }

export function Tour({ onClose }: { onClose: () => void }) {
  const [list] = useState(steps)
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box>()
  const next = useRef<HTMLButtonElement>(null)
  const step = list[i]
  const last = i === list.length - 1
  const close = () => { markSeen(); onClose() }
  const forward = () => last ? close() : setI(i + 1)
  const backward = () => i && setI(i - 1)

  useEffect(() => { markSeen() }, [])
  // Where the lit part is, kept up as the page settles or the phone turns.
  useLayoutEffect(() => {
    const measure = () => {
      const r = step.find?.()?.getBoundingClientRect()
      const pad = 8
      setBox(r ? { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 } : undefined)
    }
    measure()
    next.current?.focus({ preventScroll: true })
    addEventListener('resize', measure)
    addEventListener('scroll', measure, true)
    return () => { removeEventListener('resize', measure); removeEventListener('scroll', measure, true) }
  }, [i])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      else if (e.key === 'ArrowRight') forward()
      else if (e.key === 'ArrowLeft') backward()
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  })

  // The card sits on the side of the lit part with the most room.
  const below = box && box.top + box.height / 2 < innerHeight / 2
  const place = !box ? 'tour-mid' : below ? 'tour-below' : 'tour-above'
  const style = !box ? undefined : below ? { top: `${box.top + box.height + 14}px` } : { bottom: `${innerHeight - box.top + 14}px` }
  return (
    <div class="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {/* Takes every tap, so nothing behind is pressed by mistake. */}
      <div class="tour-block" onClick={e => e.stopPropagation()} />
      {box
        ? <div class="tour-hole" style={{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`,
            // A round button gets a round window.
            borderRadius: box.width < 90 && Math.abs(box.width - box.height) < 12 ? '50%' : undefined }} aria-hidden="true" />
        : <div class="tour-dim" aria-hidden="true" />}
      <div class={'tour-card ' + place} style={style} key={i}>
        <div class="tour-top">
          <p class="tour-count">{t('{n} of {total}', { n: i + 1, total: list.length })}</p>
          {/* Dismiss: the same bold × as every sheet, on every step. */}
          <button class="close-btn" aria-label={t('End the tour')} title={t('End the tour')} onClick={close}><CloseIcon size={22} /></button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div class="tour-buttons">
          {i === 0
            ? <button class="tour-btn" onClick={close}>{t('Not now')}</button>
            : <button class="tour-btn" onClick={backward}>{t('Back')}</button>}
          <button ref={next} class="tour-btn primary" onClick={forward}>
            {i === 0 ? t('Show me') : last ? t('Done') : t('Next')}
          </button>
        </div>
      </div>
    </div>
  )
}
