import { describe, expect, it } from 'vitest'
import { step } from '../sideways'

// A phone on its side: 390 tall, a chapter 4000 long.
const V = 390, P = 4000
const run = (moves: number[], away = false, y0 = 400) => {
  let y = y0, moved = 0
  for (const dy of moves) { y += dy; ({ away, moved } = step(away, y, dy, moved, V, P)) }
  return away
}

describe('sideways bars', () => {
  it('go away as you read on', () => expect(run([10, 10, 10])).toBe(true))
  it('stay for a tiny nudge down', () => expect(run([10, 10])).toBe(false))
  it('stay away for a small nudge back up to reread a line', () => expect(run([-30, -30], true)).toBe(true))
  it('come back when you scroll back up a bit more', () => expect(run([-40, -40], true)).toBe(false))
  it('ignore a jump to another chapter or verse', () => expect(run([-380], true)).toBe(true))
  it('come back at the end of the chapter', () => expect(run([10, 10, 10], true, P - V - 25)).toBe(false))
  it('stay at the very top of the page', () => expect(run([10, 10, 10], false, -10)).toBe(false))
})
