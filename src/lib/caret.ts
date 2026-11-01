/** Writing in a box on a phone: the box grows with the words, and the line
 *  being typed stays in plain view above the keyboard instead of slipping
 *  under it. */

const COPY = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize',
  'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'tabSize'] as const

/** Top and bottom of the caret's line, in px from the box's top edge. */
function caretLine(ta: HTMLTextAreaElement): [number, number] {
  const cs = getComputedStyle(ta)
  const m = document.createElement('div')
  for (const p of COPY) (m.style as any)[p] = (cs as any)[p]
  Object.assign(m.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', height: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' })
  m.textContent = ta.value.slice(0, ta.selectionEnd)
  const s = document.createElement('span')
  s.textContent = '​'
  m.append(s)
  document.body.append(m)
  const line: [number, number] = [s.offsetTop, s.offsetTop + s.offsetHeight]
  m.remove()
  return line
}

function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/** Grow the box to fit what's written (never below its own rows). */
export function grow(ta: HTMLTextAreaElement) {
  const box = scroller(ta) ?? ta.parentElement
  const keep = box?.scrollTop ?? 0
  ta.style.height = 'auto'
  const cs = getComputedStyle(ta)
  ta.style.height = ta.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) + 'px'
  if (box) box.scrollTop = keep
}

/** Scroll whatever holds the box so the caret's line sits well clear of the
 *  bottom edge (and of the keyboard), with a few lines of room below it. */
export function keepCaretInView(ta: HTMLTextAreaElement) {
  if (document.activeElement !== ta) return
  const box = scroller(ta)
  if (!box) return
  const [top, bottom] = caretLine(ta)
  const r = ta.getBoundingClientRect()
  const y0 = r.top + top - ta.scrollTop, y1 = r.top + bottom - ta.scrollTop
  const b = box.getBoundingClientRect()
  const vv = window.visualViewport
  const seenTop = Math.max(b.top, vv ? vv.offsetTop : 0)
  const seenBottom = Math.min(b.bottom, vv ? vv.offsetTop + vv.height : innerHeight)
  const room = Math.min((seenBottom - seenTop) / 3, (bottom - top) * 3)
  if (y1 > seenBottom - room) box.scrollTop += y1 - (seenBottom - room)
  else if (y0 < seenTop + 8) box.scrollTop -= seenTop + 8 - y0
}
