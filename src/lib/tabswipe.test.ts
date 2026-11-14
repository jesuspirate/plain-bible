import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { swipeAxis, swipeCounts, swipeTo } from './tabswipe'

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
  it('counts a long drag or a quick flick, not a nudge', () => {
    expect(swipeCounts(30, 500, 390)).toBe(false)
    expect(swipeCounts(100, 500, 390)).toBe(true)
    expect(swipeCounts(-50, 150, 390)).toBe(true)
    expect(swipeCounts(-50, 600, 390)).toBe(false)
    // On a wide screen a drag doesn't have to cross a quarter of it.
    expect(swipeCounts(130, 800, 1400)).toBe(true)
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
  })
})
