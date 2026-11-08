import { describe, expect, it } from 'vitest'
import { busy, holdUpdate } from './update'

// A page with nothing open, or with one thing matching `open`.
const page = (open = '', active?: { matches: (s: string) => boolean; isContentEditable?: boolean }) => ({
  activeElement: (active ?? null) as unknown as Element,
  querySelector: (s: string) => (open && s.split(', ').includes(open) ? {} : null) as Element | null,
})
const later = Date.now() + 60_000

describe('updating by itself', () => {
  it('goes ahead on a quiet page', () => {
    expect(busy(later, page())).toBe(false)
  })
  it('waits while something is open, selected or reading aloud', () => {
    for (const s of ['dialog[open]', '[role="dialog"]', '.sb-open', '.selbar', '.listen', '.picked']) expect(busy(later, page(s))).toBe(true)
  })
  it('waits while typing', () => {
    expect(busy(later, page('', { matches: s => s.includes('textarea') }))).toBe(true)
    expect(busy(later, page('', { matches: () => false, isContentEditable: true }))).toBe(true)
    expect(busy(later, page('', { matches: () => false }))).toBe(false)
  })
  it('waits while a prayer or a sync holds it', () => {
    holdUpdate('prayer', true)
    expect(busy(later, page())).toBe(true)
    holdUpdate('prayer', false)
    expect(busy(later, page())).toBe(false)
  })
})
