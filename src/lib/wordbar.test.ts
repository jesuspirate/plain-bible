import { describe, expect, it } from 'vitest'
import { placeBar, tidyWords, versesOf } from './wordbar'

const box = (top: number, left: number, width = 200, h = 24) => ({ top, bottom: top + h, left, width })
const size = { w: 400, h: 64 }, screen = { w: 1200, top: 60 }

describe('the bar over picked words', () => {
  it('sits just above the first line, centred on it', () => {
    expect(placeBar(box(300, 500), box(348, 100), size, screen)).toEqual({ x: 400, y: 226, below: false })
  })
  it('stays on screen at either edge', () => {
    expect(placeBar(box(300, 0, 40), box(300, 0), size, screen).x).toBe(12)
    expect(placeBar(box(300, 1150, 40), box(300, 0), size, screen).x).toBe(1200 - 400 - 12)
  })
  it('goes under the last line when the top bar is in the way', () => {
    expect(placeBar(box(100, 500), box(148, 100), size, screen)).toEqual({ x: 400, y: 182, below: true })
  })
})

describe('the verses the words are in', () => {
  it('reads verse ids, once each, in order', () => {
    expect(versesOf(['v17', 'v16', 'v16', 'chapter', 'vx', 'v3'])).toEqual([3, 16, 17])
    expect(versesOf([])).toEqual([])
  })
  it('quotes the words on one line', () => {
    expect(tidyWords('  For God so loved\n  the   world ')).toBe('For God so loved the world')
  })
})
