// Sliding left and right between tabs laid side by side, like turning pages:
// Highlights, Notes, Bookmarks. Only the choice of where a swipe goes lives
// here, so it can be tested without a finger.

/** Which tab a finished swipe lands on, or undefined to spring back. `dx`
 *  is how far the finger went (negative = to the left). A swipe to the left
 *  brings in the tab on the right, unless the page reads right to left. */
export function swipeTo<T>(order: readonly T[], current: T, dx: number, rtl = false): T | undefined {
  if (!dx) return undefined
  const i = order.indexOf(current)
  if (i < 0) return undefined
  const step = (dx < 0 ? 1 : -1) * (rtl ? -1 : 1)
  return order[i + step]
}

/** Whether a swipe that ended went far enough, or fast enough, to count. */
export function swipeCounts(dx: number, ms: number, width: number): boolean {
  const d = Math.abs(dx)
  return d > Math.min(width * .22, 120) || (ms < 300 && d > 40)
}

/** Whether a touch that moved this far is going sideways (a swipe) rather
 *  than up and down (a scroll); undefined while it's too small to tell. */
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | undefined {
  if (Math.hypot(dx, dy) <= 10) return undefined
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
}

/** What a touch must not start a swipe on: typing, the order switch, the
 *  colors, a card asking something, anything held to delete. */
export const NO_SWIPE = 'input, textarea, select, [contenteditable], .seg, .swatches, .confirm-card, .holdable, .hold-confirm'
