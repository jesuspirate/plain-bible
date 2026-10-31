// Signing in another device with a code: the signed-in side shows six digits
// and allows; the new side types them. See lib/devicecode.ts.
import { useEffect, useRef, useState } from 'preact/hooks'
import { t } from './i18n'

type Lib = typeof import('./lib/devicecode')
let lib: Promise<Lib> | undefined
const load = () => (lib ??= import('./lib/devicecode'))
const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`
const message = (e: unknown) => (e as Error).message || String(e)

/** Checks something every few seconds while shown, until it says done. */
function useEvery(ms: number, fn: () => Promise<boolean | void>, on: boolean) {
  const f = useRef(fn)
  f.current = fn
  useEffect(() => {
    if (!on) return
    let stop = false, timer = 0
    const tick = async () => { if (stop) return; const done = await f.current().catch(() => false); if (!done && !stop) timer = window.setTimeout(tick, ms) }
    timer = window.setTimeout(tick, ms)
    return () => { stop = true; clearTimeout(timer) }
  }, [on, ms])
}

/** On the signed-in device: the code, then "Let your Mac in?". */
export function ShowDeviceCode({ onClose, onLink }: { onClose: () => void; onLink: () => void }) {
  const [code, setCode] = useState<{ code: string; expires: number }>()
  const [ask, setAsk] = useState<{ label: string; match: string; pub: string }>()
  const [done, setDone] = useState<{ label: string; locked: boolean }>()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { load().then(l => l.makeDeviceCode()).then(setCode, e => setMsg(message(e))) }, [])
  useEvery(2500, async () => {
    if (!code) return false
    if (Date.now() > code.expires) { (await load()).doneWithDeviceCode(); setMsg(t('This code has expired.')); return true }
    const a = await (await load()).deviceAsk(code.code)
    if (a) { setAsk(a); return true }
  }, !!code && !ask && !done && !msg)
  const close = () => { if (code && !done) load().then(l => l.dropDeviceCode(code.code)); onClose() }
  const allow = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await (await load()).allowDevice(code!.code, ask!.pub)
      setDone({ label: ask!.label, locked: r.locked })
    } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  return (
    <div class="move-card dc-card">
      {done ? <>
        <p><strong>{t('Your {device} is signing in.', { device: t(done.label) })}</strong></p>
        {done.locked && <p class="note small">{t('Your prayers are locked on this device, so they won’t open there yet. Unlock them here first under Your prayers.')}</p>}
        <button class="primary" onClick={onClose}>{t('Done')}</button>
      </> : ask ? <>
        <p><strong>{t('Sign in your {device}?', { device: t(ask.label) })}</strong></p>
        <p class="muted small">{t('Only if its screen shows these same digits:')}</p>
        <p class="dc-bigcode" aria-label={ask.match.split('').join(' ')}>{ask.match}</p>
        <div class="row wrap">
          <button class="primary" disabled={busy} onClick={allow}>{busy ? t('Signing in…') : t('Allow')}</button>
          <button disabled={busy} onClick={close}>{t('Not mine')}</button>
        </div>
      </> : <>
        <p class="muted small">{t('On the other device, open Settings → Account, tap “Signed in on another device?” and type:')}</p>
        <p class="dc-bigcode" aria-label={code?.code.split('').join(' ')}>{code ? spaced(code.code) : '··· ···'}</p>
        <p class="muted small">{t('Works once, for 15 minutes. Keep this open.')}</p>
        <div class="row wrap">
          <button onClick={close}>{t('Cancel')}</button>
          <button class="link" onClick={() => { close(); onLink() }}>{t('Make a link instead')}</button>
        </div>
      </>}
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}

/** On a device that isn't signed in: type the code, compare four digits,
 *  wait for Allow, then start over signed in. */
export function EnterDeviceCode() {
  const [text, setText] = useState('')
  const [typed, setTyped] = useState<import('./lib/devicecode').Typed>()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const digits = text.replace(/\D/g, '').slice(0, 6)
  const send = async () => {
    if (digits.length !== 6) return
    setBusy(true); setMsg('')
    try { setTyped(await (await load()).typeDeviceCode(digits)) } catch (e) { setMsg(message(e)) } finally { setBusy(false) }
  }
  useEvery(2500, async () => {
    try {
      if (!(await (await load()).takeDevice(typed!))) return false
      history.replaceState(null, '', location.pathname + '#/read')
      location.reload()
      return true
    } catch (e) { setMsg(message(e)); return true }
  }, !!typed && !msg)
  const cancel = () => { if (typed) load().then(l => l.stopTyped(typed)); setTyped(undefined); setText(''); setMsg('') }
  if (typed) return (
    <div class="dc-card">
      <p><strong>{t('Tap Allow on your other device')}</strong></p>
      <p class="muted small">{t('It shows these same digits:')}</p>
      <p class="dc-bigcode" aria-label={typed.match.split('').join(' ')}>{typed.match}</p>
      <p class="muted small">{msg ? '' : t('Waiting…')}</p>
      <button onClick={cancel}>{t('Cancel')}</button>
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
  return (
    <div class="dc-card">
      <p class="muted small">{t('On a device where you’re signed in, open Settings → Account → Link another device. Type the code it shows:')}</p>
      <input class="dc-input" value={digits} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000"
        aria-label={t('The 6-digit code')} onInput={e => { setText((e.target as HTMLInputElement).value); setMsg('') }}
        onKeyDown={e => { if (e.key === 'Enter') send() }} />
      <button class="primary" disabled={busy || digits.length !== 6} onClick={send}>{busy ? t('Checking…') : t('Sign in')}</button>
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}
