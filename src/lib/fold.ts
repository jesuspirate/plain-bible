// The fold chapter turn: the page you're reading folds over at the middle of
// the screen, the way a folding phone closes or a book page turns, and a few
// more pages riffle after it, because a whole chapter is turning, not one
// page. The new chapter is underneath and the last page to land shows it.
//
// It is built only while a turn happens, from a copy of the page, so it
// costs nothing at startup or while reading.

const MS = 340, STAGGER = 55, SHEETS = 3, BLUR = 8, EASE = 'cubic-bezier(.45, .05, .25, 1)'

export interface Fold {
  /** Follow the finger: 0 is flat, 1 is folded all the way over. */
  drag(p: number): void
  /** Finish the turn. `next` gives the new chapter once it's on screen. */
  commit(next: () => HTMLElement | null | undefined): void
  /** Put the page back. */
  cancel(): void
}

const div = (cls: string, style: Partial<CSSStyleDeclaration> = {}, ...kids: Node[]) => {
  const d = document.createElement('div')
  d.className = cls
  Object.assign(d.style, style)
  d.append(...kids)
  return d
}

// A copy of the page, cut to the part of the screen between x0 and x1.
function slice(article: HTMLElement, x0: number) {
  const r = article.getBoundingClientRect()
  const c = article.cloneNode(true) as HTMLElement
  c.removeAttribute('style')
  c.classList.remove('enter-next', 'enter-prev')
  c.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'))
  Object.assign(c.style, { position: 'absolute', margin: '0', left: r.left - x0 + 'px', top: r.top + 'px', width: r.width + 'px' })
  // The heading's top margin collapses through the page; in the copy it can't.
  const head = article.firstElementChild, copy = c.firstElementChild as HTMLElement | null
  if (head && copy) copy.style.marginTop = head.getBoundingClientRect().top - r.top + 'px'
  return c
}

export function startFold(article: HTMLElement, dir: 1 | -1): Fold {
  const W = innerWidth, spine = W / 2
  // Going forward the right half lifts and folds over to the left.
  const lift = dir === 1 ? { left: spine + 'px', width: W - spine + 'px' } : { left: '0', width: spine + 'px' }
  const stay = dir === 1 ? { left: '0', width: spine + 'px' } : { left: spine + 'px', width: W - spine + 'px' }
  const liftX = dir === 1 ? spine : 0, stayX = dir === 1 ? 0 : spine
  const origin = dir === 1 ? 'left center' : 'right center'
  const angle = -180 * dir
  // Like a folding phone's screen, a page goes dark as it stands up toward
  // you, darkest away from the crease.
  const shade = `linear-gradient(to ${dir === 1 ? 'right' : 'left'}, rgba(0,0,0,.2), rgba(0,0,0,.6))`

  const face = (back: boolean, content?: Node) => {
    const s = div('fold-shade', { background: shade })
    const f = div('fold-face' + (back ? ' fold-back' : ''), {}, ...(content ? [content] : []), s)
    return { f, s }
  }
  // Leaf 0 is the page you were reading; the rest are the riffling pages.
  const leaves = Array.from({ length: SHEETS + 1 }, (_, i) => {
    const front = face(false, i === 0 ? slice(article, liftX) : undefined)
    const back = face(true)
    const el = div('fold-leaf', { ...lift, transformOrigin: origin, zIndex: String(100 - i) }, front.f, back.f)
    return { el, front, back }
  })
  // Either side of the crease the flat page is blurred, fading out away from it.
  const cw = W * .25
  const crease = (side: 1 | -1, z: number) => {
    const c = div('fold-crease', { left: (side === 1 ? spine : spine - cw) + 'px', width: cw + 'px', zIndex: String(z) })
    const mask = `linear-gradient(to ${side === 1 ? 'left' : 'right'}, #000, transparent)`
    c.style.setProperty('-webkit-mask-image', mask)
    c.style.setProperty('mask-image', mask)
    return c
  }
  const stayCrease = crease(dir === 1 ? -1 : 1, 2), liftCrease = crease(dir === 1 ? 1 : -1, 50)
  const root = div('fold-fx', {}, div('fold-face', { ...stay, zIndex: '1' }, slice(article, stayX)), stayCrease,
    liftCrease, ...leaves.map(l => l.el))
  document.body.append(root)
  article.style.visibility = 'hidden'

  // The words on a page go soft as it stands up and sharpen as it lies down.
  const blur = (f: HTMLElement, back: boolean, t: KeyframeAnimationOptions) => {
    const words = f.firstElementChild as HTMLElement | null
    if (!words || words.classList.contains('fold-shade')) return []
    const steps = [{ filter: 'blur(0px)' }, { filter: `blur(${BLUR}px)`, offset: .5 }, { filter: `blur(${BLUR}px)` }]
    return [words.animate(back ? steps.reverse() : steps, t)]
  }

  // Each leaf turns over the spine; once it passes upright it is no longer
  // under the pages still to turn but on top of the ones already over.
  const play = (l: typeof leaves[number], i: number, delay: number) => {
    const t = { duration: MS, delay, easing: EASE, fill: 'both' as const }
    return [
      l.el.animate([
        { transform: 'perspective(1800px) rotateY(0deg)', zIndex: 100 - i, offset: 0 },
        { zIndex: 100 - i, offset: .5 },
        { zIndex: 200 + i, offset: .501 },
        { transform: `perspective(1800px) rotateY(${angle}deg)`, zIndex: 200 + i, offset: 1 },
      ], t),
      l.front.s.animate([{ opacity: 0 }, { opacity: 1, offset: .5 }, { opacity: 1 }], t),
      l.back.s.animate([{ opacity: 1 }, { opacity: 1, offset: .5 }, { opacity: 0 }], t),
      ...blur(l.front.f, false, t),
    ]
  }
  const first = [...play(leaves[0], 0, 0),
    stayCrease.animate([{ opacity: 0 }, { opacity: 1, offset: .5 }, { opacity: 1 }], { duration: MS, easing: EASE, fill: 'both' })]
  first.forEach(a => a.pause())
  let done = false
  const remove = () => { done = true; root.remove() }

  return {
    drag(p) {
      if (done) return
      // The page follows the finger up to upright, not past it.
      first.forEach(a => { a.currentTime = Math.max(0, Math.min(p, .48)) * MS })
    },
    commit(next) {
      if (done) return
      first.forEach(a => a.play())
      const rest = leaves.slice(1).flatMap((l, i) => play(l, i + 1, (i + 1) * STAGGER))
      // The new chapter comes into focus as the last pages turn off it.
      rest.push(liftCrease.animate([{ opacity: 1 }, { opacity: 1, offset: .5 }, { opacity: 0 }], { duration: MS + SHEETS * STAGGER, fill: 'both' }))
      // The last page down carries the new chapter's first half.
      // Copied just before that page stands upright, by when the new
      // chapter is drawn and scrolled to its start.
      let tries = 0
      const look = () => {
        const n = next()
        if (n && n !== article && n.isConnected) {
          const last = leaves[SHEETS].back.f
          last.prepend(slice(n, stayX))
          blur(last, true, { duration: MS, delay: SHEETS * STAGGER, easing: EASE, fill: 'both' }).forEach(a => { a.startTime = rest[0].startTime })
        }
        else if (!done && ++tries < 20) requestAnimationFrame(look)
      }
      setTimeout(look, SHEETS * STAGGER + MS * .4)
      Promise.all([...first, ...rest].map(a => a.finished)).then(() => {
        root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120 }).finished.then(remove, remove)
      }, remove)
    },
    cancel() {
      if (done) return
      first.forEach(a => { a.playbackRate = -1; a.play() })
      Promise.all(first.map(a => a.finished)).then(() => { article.style.visibility = ''; remove() }, remove)
    },
  }
}
