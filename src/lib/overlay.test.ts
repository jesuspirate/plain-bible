import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OVERLAY, overlayOpen } from './overlay'

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const fake = (match: boolean) => ({ querySelector: (s: string) => (expect(s).toBe(OVERLAY), match ? ({} as Element) : null) })

describe('something open over the word', () => {
  it('is seen from the page', () => {
    expect(overlayOpen(fake(true))).toBe(true)
    expect(overlayOpen(fake(false))).toBe(false)
    expect(overlayOpen(undefined)).toBe(false)
  })
  it('covers every kind of sheet the app opens', () => {
    for (const s of ['dialog[open]', '[role="dialog"]', '[aria-modal="true"]', '.sb-open']) expect(OVERLAY).toContain(s)
    // Sheets (notes, share to a circle, voices, lexicon...) are <dialog>s.
    expect(src('ui.tsx')).toMatch(/<dialog ref=\{ref\} class=\{'sheet'/)
    // The Settings sheet and the prayer screen (where Circles live) say so.
    expect(src('settings.tsx')).toMatch(/class="settings-sheet"[^>]*aria-modal="true"/)
    expect(src('prayer.tsx')).toMatch(/class="pray" role="dialog" aria-modal="true"/)
  })
  it('stops touch swipes, trackpad and mouse swipes, and arrow keys from turning the chapter', () => {
    const reader = src('reader.tsx')
    const body = (from: string) => reader.slice(reader.indexOf(from), reader.indexOf(from) + 1500)
    expect(body('const onTouchStart')).toContain('if (overlayOpen()) return')
    expect(body('const onWheel')).toContain('if (overlayOpen())')
    expect(body("closest('input, textarea, dialog')")).toMatch(/^[^\n]*overlayOpen\(\)/)
  })
})
