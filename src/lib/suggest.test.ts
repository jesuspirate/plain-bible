// Send a suggestion: what the sync service makes of it (worker/src/suggest.ts).
import { describe, expect, it } from 'vitest'
import { suggestionMail } from '../../worker/src/suggest'

describe('suggestionMail', () => {
  it('needs words, and not too many', () => {
    expect(suggestionMail({ text: '   ' })).toMatchObject({ ok: false, why: 'empty' })
    expect(suggestionMail(null)).toMatchObject({ ok: false, why: 'empty' })
    expect(suggestionMail({ text: 'x'.repeat(3001) })).toMatchObject({ ok: false, why: 'long' })
  })
  it('makes a plain mail with the app details', () => {
    const r = suggestionMail({ text: 'Bigger buttons please\nThanks', version: '2026.11.20', platform: 'iPhone browser', lang: 'fr' })
    if (!r.ok) throw new Error('expected ok')
    expect(r.mail.subject).toBe('Suggestion: Bigger buttons please')
    expect(r.mail.text).toContain('No reply address given.')
    expect(r.mail.text).toContain('App: 2026.11.20 · iPhone browser · fr')
    expect(r.mail.replyTo).toBeUndefined()
  })
  it('replies only to an address the person typed, and checks it', () => {
    const r = suggestionMail({ text: 'Hi', email: ' a@b.co ' })
    expect(r.ok && r.mail.replyTo).toBe('a@b.co')
    expect(suggestionMail({ text: 'Hi', email: 'not an email' })).toMatchObject({ ok: false, why: 'email' })
  })
  it('keeps the labels short and plain', () => {
    const r = suggestionMail({ text: 'Hi', platform: '<script>alert(1)</script>' + 'x'.repeat(80), lang: 5 })
    if (!r.ok) throw new Error('expected ok')
    expect(r.mail.text).not.toContain('<')
    expect(r.mail.text).toMatch(/· \?\n/)
  })
  it('shortens a long first line for the subject', () => {
    const r = suggestionMail({ text: 'a'.repeat(100) })
    expect(r.ok && r.mail.subject.length).toBe('Suggestion: '.length + 60)
  })
})
