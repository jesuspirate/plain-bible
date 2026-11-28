// Enter (Go, Done, Search) on a phone keyboard: the keyboard goes away and
// the box's main action happens, everywhere a box is typed in. A box in a
// form already submits it; a box on its own presses the main button beside
// it, or moves on to the next empty box first (name of the circle, then
// your name). A filter that already shows its results as you type just
// puts the keyboard away. The search bar looks after itself.

const TEXT = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password'])

/** The main button for a box that isn't in a form: the first enabled
 *  primary button after it, in the nearest few containers. */
function mainAction(input: HTMLInputElement): HTMLButtonElement | undefined {
  let box: HTMLElement | null = input.parentElement
  for (let depth = 0; box && depth < 4; depth++, box = box.parentElement) {
    const after = [...box.querySelectorAll<HTMLButtonElement>('button.primary')]
      .filter(b => input.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    if (after.length) return after[0]
  }
}

/** The next empty box in the same group, to type in before the main button. */
function nextEmpty(input: HTMLInputElement): HTMLInputElement | undefined {
  const group = input.closest('.c-card, .pray-confirm, .c-row, .sheet, dialog') ?? input.parentElement?.parentElement
  if (!group) return
  const boxes = [...group.querySelectorAll<HTMLInputElement>('input')].filter(x => TEXT.has(x.type) && !x.disabled && x.offsetParent)
  return boxes.slice(boxes.indexOf(input) + 1).find(x => !x.value.trim())
}

export function enterPutsKeyboardAway(root: Window = window) {
  const on = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return
    const input = e.target
    if (!(input instanceof HTMLInputElement) || !TEXT.has(input.type) || input.id === 'sb-input') return
    // In a form: it submits by itself; then the keyboard goes.
    if (input.form) return void setTimeout(() => { if (document.activeElement === input) input.blur() })
    // A filter (its results show as you type): nothing to press, only the keyboard.
    if (!e.defaultPrevented && input.type !== 'search') {
      e.preventDefault()
      const next = nextEmpty(input)
      if (next) return next.focus()
      const btn = mainAction(input)
      input.blur()
      if (btn && !btn.disabled) btn.click()
      return
    }
    // Its own Enter did the action, or a filter: just the keyboard.
    input.blur()
  }
  root.addEventListener('keydown', on)
  return () => root.removeEventListener('keydown', on)
}
