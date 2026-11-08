// An open book on a wide screen: the chapter flows down two pages side by
// side, and you turn the page instead of scrolling. The pages are the CSS
// columns of one block (`.spread-flow`); the page window shows two of them
// at a time and slides along to show the next two. Nothing here loads or
// stores anything, so the book opens as quickly as the phone page does.

/** Where the open book is used: an iPad on its side and computers, not phones or an iPad held upright. */
export const WIDE = '(min-width: 1000px) and (min-aspect-ratio: 5/4) and (min-height: 600px)'

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

/** One page of a copy, `page` pages along, in a pane the size of a page. */
function pane(copy: HTMLElement, page: number, pw: number, side: 'left' | 'right', face = '') {
  const p = document.createElement('div')
  p.className = `leaf-pane ${side} ${face}`.trim()
  const c = copy.cloneNode(true) as HTMLElement
  const flow = c.querySelector<HTMLElement>('.spread-flow') ?? c
  if (page) flow.style.transform = `translateX(${-page * pw}px)`
  p.append(c)
  const shade = document.createElement('div')
  shade.className = 'leaf-shade'
  p.append(shade)
  return p
}

export interface Leaf {
  /** Put the page that will show when it lands in place (the next chapter, once drawn). */
  fill(copy: HTMLElement, page: number): void
  /** Turn it over; resolves once it has landed and is gone. */
  turn(): Promise<void>
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
  layer.append(pane(from, dir === 1 ? 2 * k : 2 * k + 1, pw, dir === 1 ? 'left' : 'right'))
  const sheet = document.createElement('div')
  sheet.className = 'leaf'
  // Going on, the side you see first is today's right page; going back,
  // the leaf starts over on the left showing today's left page.
  const shown = pane(from, dir === 1 ? 2 * k + 1 : 2 * k, pw, 'right', dir === 1 ? 'front' : 'back')
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
      const p = pane(copy, page, pw, 'right', dir === 1 ? 'back' : 'front')
      hidden.replaceWith(p)
      hidden = p
    },
    turn() {
      if (gone) return Promise.resolve()
      const ease = 'cubic-bezier(.45, .05, .25, 1)'
      const [a, b] = dir === 1 ? ['rotateY(0deg)', 'rotateY(-180deg)'] : ['rotateY(-180deg)', 'rotateY(0deg)']
      const opts = { duration: ms, easing: ease, fill: 'forwards' as FillMode }
      // The page in the air darkens as it rises from the paper, and the one
      // it uncovers comes out of its shadow.
      const rising = shown.querySelector('.leaf-shade') as HTMLElement
      const landing = hidden.querySelector('.leaf-shade') as HTMLElement
      runs = [
        sheet.animate([{ transform: a }, { transform: b }], opts),
        rising.animate([{ opacity: 0 }, { opacity: 1 }], { ...opts, easing: 'ease-in' }),
        landing.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, easing: 'ease-out' }),
      ]
      return new Promise<void>(done => {
        // iPhone and iPad can leave an animation frozen (Low Power Mode, the
        // app put away); it lands anyway a little after it should have.
        const late = window.setTimeout(end, ms + 400)
        function end() { clearTimeout(late); drop(); done() }
        Promise.all(runs.map(r => r.finished)).then(end, end)
      })
    },
    drop,
  }
}
