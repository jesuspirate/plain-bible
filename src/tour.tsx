// The guided tour: first read, pray, share, repeat without words (habits.tsx),
// then, for whoever taps More, the full tour: a handful of calm steps. Each one dims the
// page, leaves the one thing it's about lit, and says in a sentence or two
// what it does. Nothing can be pressed by mistake behind it, the × on every
// step puts it away, and it never comes back by itself once seen. Loaded only when it opens.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { t } from './i18n'
import { CloseIcon } from './icons'
import { defaultSettings, loadSettings, markTourSeen as markSeen } from './state'
import { canHear } from './listen'
import { inStoreApp, isIPhone } from './lib/install'
import { nativeNotify } from './lib/nativeNotify'
import { loadAccount } from './lib/sync'
import { inFedi } from './lib/nostr'
import { fine, Gesture, GESTURE_MS, Glyph, stillMotion, type Kind } from './gesture'
import { SpeakerIcon } from './icons'
import './tour.css'
import { useLeave } from './motion'
import { Habits, habitStops } from './habits'


/** A line of the card, with the gesture (or the real button) beside it. */
type Row = { glyph: Kind; text: string } | { glyph: 'bar' }
/** One gesture shown over the lit part, and the line of the card it goes with. */
type Move = { kind: Kind; row?: number; at?: (el: Element, r: DOMRect) => { x: number; y: number } }
type Step = { title: string; body?: string; rows?: Row[]; after?: string; find?: () => Element | null; moves?: Move[]
  /** more room between the lit part and the card, for a gesture that leaves it */ gap?: number }

const top = () => document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0
/** A verse fully on screen, clear of the top bar and the search bar: one in
 *  the lower half, if there is one, so the card (with its few
 *  lines) has the room above it. */
function verseInView() {
  const bar = document.querySelector('.sb-bar')?.getBoundingClientRect().top
  const from = top() + 8, to = (bar && bar > innerHeight / 2 ? bar : innerHeight - 170) - 8
  let first: Element | null = null
  for (const v of document.querySelectorAll('.reader article.chapter :is(.verse, .pv)')) {
    const r = v.getBoundingClientRect()
    if (r.top >= from && r.bottom <= to && r.height > 0) {
      if (r.top >= innerHeight * .5) return v
      first ??= v
    }
    if (r.top > to) break
  }
  return first
}
const onScreen = (sel: string) => () => {
  const el = document.querySelector(sel)
  const r = el?.getBoundingClientRect()
  return r && r.width > 0 && r.bottom > 0 && r.top < innerHeight ? el : null
}

/** The iPhone app with the Home Screen widget in it: an app new enough (its
 *  notify bridge came with the widget's release train), on iOS 17 or later
 *  (URL.canParse arrived with it; an iPad's name hides its version), and
 *  not the same app running on a Mac, which has no widgets for it. */
const hasWidget = () => inStoreApp() && isIPhone() && !!nativeNotify() && typeof URL.canParse === 'function'

// Newer features ride along as one more sentence on the step they belong to,
// only where they apply, so the tour never grows a step for them.
// Each step shows its gesture, softly, on the real thing: a fingertip on a
// phone or tablet, the arrow with a mouse.
function steps(): Step[] {
  const settings = loadSettings()
  const version = settings.version ?? defaultSettings().version
  // The verse bar offers Listen only when this Bible can be heard aloud
  // (a narrator, or a voice on this device for its language).
  let lang: string | undefined
  try { lang = JSON.parse(localStorage.getItem('plain-bible:catalog') || 'null')?.translations?.find((x: { id: string }) => x.id === version)?.lang } catch { /* not kept */ }
  const hear = canHear(version, lang) && !settings.readSilent
  // Signed in or not, sync is on wherever the Circles button is.
  const sync = !!document.querySelector('.sb-circles')
  const tap: Move = { kind: 'tap' }
  // A verse is shown tapped on its number, where holding it bookmarks too.
  const onNumber = (el: Element, r: DOMRect) => {
    const n = el.querySelector('.vn')?.getBoundingClientRect()
    return n && n.width ? { x: n.left + n.width / 2, y: n.top + n.height / 2 } : { x: r.left + 24, y: r.top + Math.min(r.height / 2, 20) }
  }
  const all: (Step | false)[] = [
    { title: t('Welcome to My Quiet Bible'), body: t('Just the Bible, quiet and simple. Here is a short look around. It takes about a minute.') },
    { title: t('Turn the page'), find: onScreen('.reader article.chapter .chapter-title'),
      body: fine ? t('Swipe with two fingers on the trackpad, or press ← or →.') : t('Swipe left or right to go to the next or the previous chapter.'),
      moves: [{ kind: fine ? 'swipe2' : 'swipe' }] },
    { title: t('Tap a verse'), find: verseInView, rows: [
        { glyph: 'tap', text: fine ? t('Click: highlight, note, bookmark') : t('Tap: highlight, note, bookmark') },
        { glyph: fine ? 'triple' : 'double', text: fine ? t('Triple click: quick highlight') : t('Double tap: quick highlight') },
        // Listen lives in that verse's bar, where people miss it: a line like
        // the others, with its speaker. (Read along is on the Search step.)
        ...(hear ? [{ glyph: 'bar' } as Row] : []),
      ], moves: [{ kind: 'tap', row: 0, at: onNumber }, { kind: fine ? 'triple' : 'double', row: 1, at: onNumber }] },
    // The search bar is always there, so the tour points only to it; the
    // other ways in (the chapter title, a pull down, /) are for people to
    // find, and are told under Settings → Font and layout → Search bar.
    { title: t('Search'), body: t('Type words you remember, or a passage like John 3:16. Tap here to pick a book and chapter too.'), find: onScreen('.sb-field'), moves: [tap],
      after: [t('After a search, open it again to go back to your last result.'),
        // Read along, if ticked under Audio, sits at the field's right end.
        ...(document.querySelector('.sb-along') ? [t('The Read along icon at its right end reads on from the verse at the top of the screen.'), t('While it reads, tap any verse to read on from there.'), t('Tap the verse being read to highlight or share it.')] : []),
        // With a keyboard, / opens it from anywhere.
        ...(fine ? [t('You can also press / to open it.')] : [])].join(' ') },
    // Not signed in yet: one more sentence on how easy the free account is
    // (Fedi signs in by itself with its Nostr key).
    sync && { title: t('Circles'), body: t('Share verses and prayers with a few people you trust, like your family or a small prayer group.'), find: onScreen('.sb-circles'), moves: [tap],
      after: !loadAccount() && !inFedi() ? t('They need a free account: a passkey or a code by email, in Settings → Account. It takes a moment.') : undefined },
    { title: t('Pray'), find: onScreen('.sb-pray'), rows: [
        { glyph: 'tap', text: t('Tap 🙏 to pray out loud and keep your prayer. It stays private.') },
        { glyph: 'hold', text: t('Hold 🙏 to choose its skin tone') },
      ], after: hasWidget() ? t('A 🙏 widget for your Home Screen comes with the app.') : undefined,
      moves: [{ kind: 'tap', row: 0 }, { kind: 'hold', row: 1 }] },
    // Where the history clock was. Its places are in Settings now: one line
    // here says so, for those who used it.
    { title: t('Bible versions'), find: onScreen('.version-btn'), rows: [
        { glyph: 'tap', text: t('Tap to switch to the Bible you read before. Tap again to come back.') },
        { glyph: 'hold', text: t('Hold to choose from your Bibles, or any of them.') },
      ], after: t('The places you were reading are in Settings → Recent places.'),
      moves: [{ kind: 'tap', row: 0 }, { kind: 'hold', row: 1 }] },
    { title: t('Settings'), body: t('Your Bible, text size, theme, language and account are all here.') + ' ' + (sync ? t('Once signed in, your other devices offer to continue where you stopped reading.') + ' ' : '') + t('You can take this tour again from Settings.'), find: onScreen('.profile-btn'), moves: [tap] },
  ]
  return all.filter((s): s is Step => !!s)
}

type Box = { top: number; left: number; width: number; height: number }
type Spot = { x: number; y: number }

// First the habits, without words (habits.tsx); its "More" opens the full
// tour below, for those who like to read, from its second step (no welcome
// again). With the bottom bar hidden there are no habits to show: the full
// tour, as before.
export function Tour({ onClose }: { onClose: () => void }) {
  const [full, setFull] = useState(() => !habitStops().length)
  return full ? <Full onClose={onClose} more={!!habitStops().length} /> : <Habits onClose={onClose} onMore={() => setFull(true)} />
}

function Full({ onClose, more }: { onClose: () => void; more: boolean }) {
  const leave = useLeave(undefined, 'fade')
  const [list] = useState(() => more ? steps().slice(1) : steps())
  const [i, setI] = useState(0)
  const [box, setBox] = useState<Box>()
  // Where each of this step's gestures is shown, and which one is showing.
  const [spots, setSpots] = useState<Spot[]>([])
  const [tick, setTick] = useState(0)
  const next = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  // A card too tall for the room it was given keeps clear of the screen's edges.
  const [fit, setFit] = useState<number>()
  const step = list[i]
  const moves = step.moves ?? []
  const last = i === list.length - 1
  const close = () => { markSeen(); onClose() }
  const forward = () => last ? close() : setI(i + 1)
  const backward = () => i && setI(i - 1)

  useEffect(() => { markSeen() }, [])
  // Where the lit part is, kept up as the page settles or the phone turns.
  useLayoutEffect(() => {
    const measure = () => {
      const el = step.find?.()
      const r = el?.getBoundingClientRect()
      const pad = 8
      setBox(r ? { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 } : undefined)
      setSpots(el && r ? moves.map(m => m.at?.(el, r) ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 }) : [])
    }
    measure()
    next.current?.focus({ preventScroll: true })
    addEventListener('resize', measure)
    addEventListener('scroll', measure, true)
    return () => { removeEventListener('resize', measure); removeEventListener('scroll', measure, true) }
  }, [i])
  // One gesture at a time, each shown once, then the next, round and round,
  // starting a moment after the card. Held still with reduced motion.
  useLayoutEffect(() => {
    setFit(undefined)
  }, [i, box?.top, box?.height])
  useLayoutEffect(() => {
    const r = card.current?.getBoundingClientRect()
    if (fit === undefined && r && (r.top < 8 || r.bottom > innerHeight - 8)) setFit(Math.max(8, innerHeight - 8 - r.height))
  })
  useEffect(() => {
    setTick(0)
    if (!moves.length || stillMotion()) return
    let n = 0, timer = 0
    const go = () => { n++; setTick(n); timer = window.setTimeout(go, GESTURE_MS) }
    timer = window.setTimeout(go, 500)
    return () => clearTimeout(timer)
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

  const showing = moves.length && (tick || stillMotion()) ? (Math.max(tick, 1) - 1) % moves.length : -1
  const move = moves[showing], spot = spots[showing]
  // The card sits on the side of the lit part with the most room.
  const gap = step.gap ?? 14
  const below = box && box.top + box.height / 2 < innerHeight / 2
  const place = !box ? 'tour-mid' : below ? 'tour-below' : 'tour-above'
  const style = fit !== undefined ? { top: `${fit}px`, transform: 'none' } : !box ? undefined : below ? { top: `${box.top + box.height + gap}px` } : { bottom: `${innerHeight - box.top + gap}px` }
  return (
    <div ref={leave} class="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      {/* Takes every tap, so nothing behind is pressed by mistake. */}
      <div class="tour-block" onClick={e => e.stopPropagation()} />
      {box
        ? <div class="tour-hole" style={{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`,
            // A round button gets a round window.
            borderRadius: box.width < 90 && Math.abs(box.width - box.height) < 12 ? '50%' : undefined }} aria-hidden="true" />
        : <div class="tour-dim" aria-hidden="true" />}
      {move && spot && <Gesture key={`${i}-${tick}`} kind={move.kind} x={spot.x} y={spot.y} dx={Math.min(200, innerWidth * .4)} dy={56} />}
      <div ref={card} class={'tour-card ' + place} style={style} key={i}>
        <div class="tour-top">
          <p class="tour-count">{t('{n} of {total}', { n: i + 1, total: list.length })}</p>
          {/* Dismiss: the same bold × as every sheet, on every step. */}
          <button class="close-btn" aria-label={t('End the tour')} title={t('End the tour')} onClick={close}><CloseIcon size={22} /></button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <div id="tour-body">
          {step.body && <p>{step.body}</p>}
          {step.rows && <ul class="tour-rows">
            {step.rows.map((r, n) => (
              <li class={move?.row === n ? 'on' : undefined}>
                {r.glyph === 'bar'
                  ? <><span class="tour-icon"><SpeakerIcon size={24} /></span><span>{t('Listen: hear the verses you picked')}</span></>
                  : <><Glyph kind={r.glyph} /><span>{r.text}</span></>}
              </li>
            ))}
          </ul>}
          {step.after && <p class="tour-after">{step.after}</p>}
        </div>
        <div class="tour-buttons">
          {i > 0
            ? <button class="tour-btn" onClick={backward}>{t('Previous')}</button>
            : !more && <button class="tour-btn" onClick={close}>{t('Not now')}</button>}
          <button ref={next} class="tour-btn primary" onClick={forward}>
            {i === 0 && !more ? t('Show me') : last ? t('Done') : t('Next')}
          </button>
        </div>
      </div>
    </div>
  )
}
