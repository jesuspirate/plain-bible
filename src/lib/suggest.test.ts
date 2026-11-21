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

describe('problem reports', () => {
  it('bring the screen, the spot and recent errors', () => {
    const r = suggestionMail({ kind: 'problem', text: 'Listen does nothing', screen: '#/read/LSG/JHN/3', size: '390×844', theme: 'sepia',
      where: '“Écouter” [div.verse-bar > button.listen] at 30% across, 80% down', errors: ['TypeError: x is undefined (listen.tsx:12)', 5] })
    if (!r.ok) throw new Error('expected ok')
    expect(r.mail.subject).toBe('Problem: Listen does nothing')
    expect(r.mail.text).toContain('Screen: #/read/LSG/JHN/3 · 390×844 · theme sepia')
    expect(r.mail.text).toContain('Spot shown: “Écouter” [div.verse-bar > button.listen]')
    expect(r.mail.text).toContain('  - TypeError: x is undefined (listen.tsx:12)')
  })
  it('bring the recorded steps, one per line', () => {
    const r = suggestionMail({ kind: 'problem', text: 'Page jumps', steps: ['0:00 Started on #/read', '0:03 Scrolled down in [main] to 40%', 7, '0:05 Tap “Écouter” [button.listen]\nx'] })
    if (!r.ok) throw new Error('expected ok')
    expect(r.mail.text).toContain('Steps recorded (3):\n  0:00 Started on #/read\n  0:03 Scrolled down in [main] to 40%\n  0:05 Tap “Écouter” [button.listen] x')
  })
  it('say so when nothing was shown', () => {
    const r = suggestionMail({ kind: 'problem', text: 'Hm' })
    expect(r.ok && r.mail.text).toContain('Steps recorded: none')
    expect(r.ok && r.mail.text).toContain('Errors the app noticed: none')
  })
  it('suggestions carry none of it', () => {
    const r = suggestionMail({ text: 'Idea', screen: '#/x', where: 'here' })
    expect(r.ok && r.mail.text).not.toContain('Screen:')
  })
})

describe('suggestionMail cleans what an older app sent', () => {
  const KEY43 = 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE'
  it('never mails a link key, a code or search words', () => {
    const r = suggestionMail({
      kind: 'problem', text: 'Stuck', screen: `#/join?i=abcdefghijklmnopqrstuv&k=${KEY43}`,
      steps: [`0:00 Started on #/move/abc.${KEY43} · 390×844`, '0:02 Screen #/search?q=private%20words'],
      where: `“1 2 3 4 5 6” [p.c-bigcode] at 50% across, 40% down`,
      errors: [`URL 'https://myquietbible.com/#/join?d=x&k=${KEY43}' cannot be created`],
    })
    if (!r.ok) throw new Error('expected ok')
    expect(r.mail.text).not.toContain(KEY43)
    expect(r.mail.text).not.toContain('private')
    expect(r.mail.text).toContain('Screen: #/join?i=…&k=…')
    expect(r.mail.text).toContain('0:00 Started on #/move/… · 390×844')
    expect(r.mail.text).toContain('0:02 Screen #/search?q=…')
  })
  it('hides a code someone tapped, in an older app\'s spot', () => {
    const r = suggestionMail({ kind: 'problem', text: 'x', where: '“1 2 3 4 5 6” [p.c-bigcode] at 50% across, 40% down' })
    if (!r.ok) throw new Error('expected ok')
    expect(r.mail.text).toContain('Spot shown: “…” [p.c-bigcode] at 50% across, 40% down')
  })
})
