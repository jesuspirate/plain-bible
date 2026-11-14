import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { swipeAxis, swipeGoes, swipeTo } from './tabswipe'

const TABS = ['highlights', 'notes', 'bookmarks'] as const

describe('swiping between saved tabs', () => {
  it('goes to the tab on the right when the finger moves left', () => {
    expect(swipeTo(TABS, 'highlights', -80)).toBe('notes')
    expect(swipeTo(TABS, 'notes', -80)).toBe('bookmarks')
    expect(swipeTo(TABS, 'notes', 80)).toBe('highlights')
  })
  it('springs back past the first and last tab', () => {
    expect(swipeTo(TABS, 'highlights', 80)).toBeUndefined()
    expect(swipeTo(TABS, 'bookmarks', -80)).toBeUndefined()
    expect(swipeTo(TABS, 'notes', 0)).toBeUndefined()
  })
  it('turns the other way when the page reads right to left', () => {
    expect(swipeTo(TABS, 'highlights', 80, true)).toBe('notes')
    expect(swipeTo(TABS, 'notes', -80, true)).toBe('highlights')
  })
  it('goes on past half way, or with a flick that way', () => {
    // Slow drags: only past half the width.
    expect(swipeGoes(-150, 0, 414)).toBe(false)
    expect(swipeGoes(-220, 0, 414)).toBe(true)
    // A quick flick goes even when short.
    expect(swipeGoes(-60, -.8, 414)).toBe(true)
    // Dragged far, then flicked back: stays.
    expect(swipeGoes(-260, .6, 414)).toBe(false)
    // A tiny twitch isn't a flick.
    expect(swipeGoes(-8, -1, 414)).toBe(false)
  })
  it('tells a scroll from a swipe', () => {
    expect(swipeAxis(4, 5)).toBeUndefined()
    expect(swipeAxis(30, 6)).toBe('x')
    expect(swipeAxis(12, 30)).toBe('y')
    // Diagonal-ish stays a scroll, so reading down a long list never slides.
    expect(swipeAxis(20, 19)).toBe('y')
  })
  it('keeps the list scrolling up and down while sliding sideways', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.saved-swipe\s*\{[^}]*touch-action:\s*pan-y pinch-zoom/)
    // The lists beside sit off to the side, not under the one you're on.
    expect(css).toMatch(/\.saved-page\.beside\s*\{[^}]*position:\s*absolute/)
  })
})
