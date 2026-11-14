import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Swiping between Highlights, Notes and Bookmarks is the browser's own
// sideways scrolling with snap points, so it follows the finger and always
// settles on a list (a hand-made drag could stall half way on a slow swipe).
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
const rule = (sel: string) => css.match(new RegExp(sel.replace(/[.*]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))?.[1] ?? ''

describe('swiping between saved lists', () => {
  it('is a sideways scroll that snaps to one list at a time', () => {
    expect(rule('.saved-pages')).toMatch(/overflow-x:\s*auto/)
    expect(rule('.saved-pages')).toMatch(/scroll-snap-type:\s*x mandatory/)
    expect(rule('.saved-page')).toMatch(/scroll-snap-stop:\s*always/)
  })
  it('never blocks the browser from moving it', () => {
    expect(css).not.toMatch(/\.saved-swipe\s*\{[^}]*touch-action/)
    expect(rule('.saved-pages')).not.toMatch(/touch-action/)
  })
  it('folds the lists beside away when resting, so short lists have no gap under them', () => {
    expect(rule('.saved-page.beside')).toMatch(/max-height:\s*0/)
  })
})
