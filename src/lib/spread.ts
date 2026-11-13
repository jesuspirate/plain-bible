// An open book on a wide screen: the chapter flows down two pages side by
// side, and you turn the page instead of scrolling. The pages are the CSS
// columns of one block (`.spread-flow`); the page window shows two of them
// at a time and slides along to show the next two. Nothing here loads or
// stores anything, so the book opens as quickly as the phone page does.

/** A phone that unfolds, lying open (and a small tablet on its side): a touch
 *  screen too wide for a phone, about as wide as it is tall or wider. The
 *  fold runs down the middle of it, which is where the book's spine is. An
 *  iPad held upright is much taller than wide, and stays one page. */
export const UNFOLDED = '(hover: none) and (min-width: 600px) and (max-width: 999.98px) and (min-aspect-ratio: 4/5) and (min-height: 520px)'

/** Where the open book is used: an iPad on its side, computers and unfolded phones, not phones or an iPad held upright. */
export const WIDE = `(min-width: 1000px) and (min-aspect-ratio: 5/4) and (min-height: 600px), ${UNFOLDED}`

/** The width of one page in pixels. */
export const pageWidth = (win: HTMLElement) => win.clientWidth / 2

/** Which page (column, from 0) a box starting at `left` is on. */
const pageAt = (flow: HTMLElement, left: number, pw: number) =>
  Math.max(0, Math.floor((left - flow.getBoundingClientRect().left + 1) / pw))

/** How many spreads (pairs of pages) the chapter fills. */
export function sheetsOf(flow: HTMLElement, pw: number) {
  let last = 0
  for (const el of flow.querySelectorAll<HTMLElement>(':scope > *, :scope > .para > .pv')) {
    const r = el.getClientRects()
    if (r.length) last = Math.max(last, pageAt(flow, r[r.length - 1].left, pw))
  }
  return Math.floor(last / 2) + 1
}

/** The spread a verse starts on. */
export function sheetOf(flow: HTMLElement, el: HTMLElement, pw: number) {
  const r = el.getClientRects()
  return r.length ? Math.floor(pageAt(flow, r[0].left, pw) / 2) : 0
}

/** The first verse that starts on spread `k`, or the one carried over onto it. */
export function firstVerseOn(flow: HTMLElement, k: number, pw: number) {
  let n = 0
  for (const el of flow.querySelectorAll<HTMLElement>('[id^="v"]')) {
    const r = el.getClientRects()
    if (!r.length) continue
    // Starting on an earlier spread (carried over onto this one): not this
    // one, so that the spread it's saved on is the one it opens on again.
    if (Math.floor(pageAt(flow, r[0].left, pw) / 2) < k) continue
    n = +el.id.slice(1)
    break
  }
  return n
}

/** A still copy of the book (the page window and its pages), with nothing in it that can be tapped or found by id. */
export function copyOf(win: HTMLElement) {
  const c = win.cloneNode(true) as HTMLElement
  c.style.transform = ''
  const flow = c.querySelector<HTMLElement>('.spread-flow')
  if (flow) flow.style.transform = ''
  for (const el of c.querySelectorAll('[id]')) el.removeAttribute('id')
  for (const el of c.querySelectorAll('button')) el.tabIndex = -1
  return c
}

/** One page of a copy, `page` pages along, in a pane the size of a page.
 *  The copy is copied again unless it is `mine` to keep (nobody else uses it). */
function pane(copy: HTMLElement, page: number, pw: number, side: 'left' | 'right', face = '', mine = false) {
  const p = document.createElement('div')
  p.className = `leaf-pane ${side} ${face}`.trim()
  const c = mine ? copy : copy.cloneNode(true) as HTMLElement
  const flow = c.querySelector<HTMLElement>('.spread-flow') ?? c
  if (page) flow.style.transform = `translateX(${-page * pw}px)`
  p.append(c)
  // Two shadows over the page, both still until the page turns: the one
  // the turning page throws (leaf-shade), and the fold deepening as the
  // book bends at the spine (leaf-deep).
  for (const name of ['leaf-shade', 'leaf-deep']) {
    const d = document.createElement('div')
    d.className = name
    p.append(d)
  }
  return p
}

export interface Leaf {
  /** Put the page that will show when it lands in place (the next chapter, once drawn). */
  fill(copy: HTMLElement, page: number): void
  /** Turn it over; resolves once it has landed and is gone. */
  turn(): Promise<void>
  /** Land quickly from wherever it is: another turn is waiting behind it. */
  hurry(): void
  /** Take it away at once, wherever it is. */
  drop(): void
}

/**
 * Lays a page over the book that turns over the spine like paper: going on,
 * the right page lifts and comes down on the left; going back, the left page
 * comes over to the right. Under it, the page that stays where it is. Until
 * `fill` is called, the leaf's other side is blank, which nobody sees: it
 * faces down.
 */
export function leaf(box: HTMLElement, from: HTMLElement, k: number, dir: 1 | -1, pw: number, ms: number): Leaf {
  const layer = document.createElement('div')
  layer.className = 'leaf-layer'
  layer.setAttribute('aria-hidden', 'true')
  // The page that stays still: the left one going on, the right one going back.
  const still = pane(from, dir === 1 ? 2 * k : 2 * k + 1, pw, dir === 1 ? 'left' : 'right')
  layer.append(still)
  // The shadow the page throws on the one it uncovers, lying on the book itself.
  const under = document.createElement('div')
  under.className = `leaf-under ${dir === 1 ? 'right' : 'left'}`
  layer.append(under)
  const sheet = document.createElement('div')
  sheet.className = 'leaf'
  // Going on, the side you see first is today's right page; going back,
  // the leaf starts over on the left showing today's left page.
  const shown = pane(from, dir === 1 ? 2 * k + 1 : 2 * k, pw, 'right', dir === 1 ? 'front' : 'back', true)
  let hidden = document.createElement('div')
  hidden.className = `leaf-pane right ${dir === 1 ? 'back' : 'front'}`
  sheet.append(shown, hidden)
  if (dir === -1) sheet.style.transform = 'rotateY(-180deg)'
  layer.append(sheet)
  box.append(layer)
  let runs: Animation[] = []
  let gone = false
  const drop = () => {
    if (gone) return
    gone = true
    runs.forEach(a => a.cancel())
    layer.remove()
  }
  return {
    fill(copy, page) {
      const p = pane(copy, page, pw, 'right', dir === 1 ? 'back' : 'front', true)
      hidden.replaceWith(p)
      hidden = p
    },
    turn() {
      if (gone) return Promise.resolve()
      // It moves from the first moment, as a page let go of does, and settles gently.
      const ease = 'cubic-bezier(.3, .2, .2, 1)'
      const [a, b] = dir === 1 ? ['rotateY(0deg)', 'rotateY(-180deg)'] : ['rotateY(-180deg)', 'rotateY(0deg)']
      const opts = { duration: ms, easing: ease, fill: 'forwards' as FillMode }
      // Every shadow follows the page's own movement (the same easing), so
      // nothing appears or goes at once: the page in the air darkens until
      // it stands on its edge, and its other side comes out of the shadow
      // from there; the page it comes down on darkens under it, and the one
      // it uncovers comes into the light; the fold deepens as the page
      // lifts and eases back as it lands. All of them start and end at
      // nothing, so the book looks the same just before the turn, and just
      // after, as it does lying still.
      const part = (pane: Element, name: string) => pane.querySelector<HTMLElement>('.' + name)
      const fade = (el: HTMLElement | null, frames: Keyframe[]) => el ? [el.animate(frames, opts)] : []
      runs = [
        sheet.animate([{ transform: a }, { transform: b }], opts),
        // A shadow on a side of the page that is turned away is at nothing.
        // Safari, and so the iPhone, iPad and Mac apps, can draw a layer on
        // the hidden side straight through the page: the shade left on the
        // side that went down showed over the page as it landed, in flashes.
        ...fade(part(shown, 'leaf-shade'), [{ opacity: 0 }, { opacity: 0, offset: .05 }, { opacity: 1, offset: .47 }, { opacity: 0, offset: .5 }, { opacity: 0 }]),
        ...fade(part(hidden, 'leaf-shade'), [{ opacity: 0 }, { opacity: 0, offset: .5 }, { opacity: 1, offset: .53 }, { opacity: 0, offset: .9 }, { opacity: 0 }]),
        ...fade(part(shown, 'leaf-deep'), [{ opacity: 0 }, { opacity: 0, offset: .05 }, { opacity: 1, offset: .3 }, { opacity: 1, offset: .47 }, { opacity: 0, offset: .5 }, { opacity: 0 }]),
        ...fade(part(hidden, 'leaf-deep'), [{ opacity: 0 }, { opacity: 0, offset: .5 }, { opacity: 1, offset: .53 }, { opacity: 1, offset: .7 }, { opacity: 0, offset: .92 }, { opacity: 0 }]),
        // Every shadow is also at nothing while the page in the air is
        // level, or nearly, with the pages lying flat (the first and last
        // tenth of the way). Lying level, a browser may draw either one on
        // top, frame by frame, so whatever differs between them flickers.
        ...fade(part(still, 'leaf-shade'), [{ opacity: 0 }, { opacity: 0, offset: .5 }, { opacity: .9, offset: .72 }, { opacity: 0, offset: .9 }, { opacity: 0 }]),
        ...fade(part(still, 'leaf-deep'), [{ opacity: 0 }, { opacity: 0, offset: .05 }, { opacity: 1, offset: .3 }, { opacity: 1, offset: .7 }, { opacity: 0, offset: .92 }, { opacity: 0 }]),
        ...fade(under, [{ opacity: 0 }, { opacity: 0, offset: .05 }, { opacity: .9, offset: .2 }, { opacity: 0, offset: .7 }, { opacity: 0 }]),
      ]
      return new Promise<void>(done => {
        // iPhone and iPad can leave an animation frozen (Low Power Mode, the
        // app put away); it lands anyway a little after it should have.
        const late = window.setTimeout(end, ms + 400)
        function end() { clearTimeout(late); drop(); done() }
        Promise.all(runs.map(r => r.finished)).then(end, end)
      })
    },
    hurry() {
      const sheetRun = runs[0]
      if (gone || !sheetRun) return
      const left = ms - Number(sheetRun.currentTime ?? 0)
      const rate = Math.max(1, left / 130)
      for (const r of runs) { try { r.updatePlaybackRate(rate) } catch { r.playbackRate = rate } }
    },
    drop,
  }
}
