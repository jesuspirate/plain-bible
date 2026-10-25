// "Allow your new phone?": the new device asks (AskApproval, where prayers or
// circles are locked), the old one answers (ApproveCard, over everything,
// whenever the app opens). See lib/approve.ts.
import { useEffect, useRef, useState } from 'preact/hooks'
import { loadAccount, noPasskey } from './lib/sync'

type Lib = typeof import('./lib/approve')
let lib: Promise<Lib> | undefined
const load = () => (lib ??= import('./lib/approve'))
const spaced = (code: string) => code.split('').join(' ')

/** On a device that can't unlock prayers and circles: ask another one. */
export function AskApproval({ onDone, btn = 'c-btn' }: { onDone: () => void; btn?: string }) {
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const done = useRef(onDone)
  done.current = onDone
  const wait = useRef<HTMLDivElement>(null)
  useEffect(() => { if (code) wait.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [code])

  const ask = async () => {
    setBusy(true); setMsg('')
    try { setCode((await (await load()).askApproval()).code) } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  // Asked before (say, then switched to the other phone and back): keep waiting.
  useEffect(() => { load().then(l => l.waitingHere()).then(w => { if (w) ask() }).catch(() => {}) }, [])
  // While waiting, look every few seconds, and at once on coming back.
  useEffect(() => {
    if (!code) return
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try { if (await (await load()).checkApproval()) done.current() } catch (e) { setCode(''); setMsg((e as Error).message) }
    }
    const t = setInterval(check, 3000)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check) }
  }, [code])

  return code ? (
    <div class="approve-wait" ref={wait}>
      <p><strong>Open Quiet Bible on your other phone</strong> (or computer) where your prayers already open. Tap <strong>Allow</strong> when it shows:</p>
      <p class="approve-code">{spaced(code)}</p>
      <p class="muted small">Waiting… this unlocks here by itself.</p>
    </div>
  ) : <>
    <button class={btn + ' primary'} disabled={busy} onClick={ask}>{busy ? 'Asking…' : 'Approve from my other phone'}</button>
    {msg && <p class="note small">{msg}</p>}
  </>
}

/** On a device that holds the key: another of yours asking to be let in. */
export function ApproveCard() {
  const [asks, setAsks] = useState<Awaited<ReturnType<Lib['waitingApprovals']>>>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const last = useRef(0)
  useEffect(() => {
    const look = () => {
      if (!loadAccount() || navigator.onLine === false || document.visibilityState !== 'visible' || Date.now() - last.current < 20_000) return
      last.current = Date.now()
      load().then(l => l.waitingApprovals()).then(setAsks).catch(() => {})
    }
    look()
    document.addEventListener('visibilitychange', look)
    addEventListener('online', look)
    return () => { document.removeEventListener('visibilitychange', look); removeEventListener('online', look) }
  }, [])
  const ask = asks[0]
  if (!ask && !msg) return null
  const answer = (yes: boolean) => async () => {
    setBusy(true)
    try {
      const l = await load()
      await (yes ? l.allow(ask) : l.decline(ask))
      setAsks(a => a.slice(1))
      if (yes) { setMsg(`Done. Your ${ask.label} can open your prayers and circles now.`); setTimeout(() => setMsg(''), 4000) }
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div class="move-welcome approve-card" role="dialog" aria-live="polite">
      {ask ? <>
        <p><strong>Allow your {ask.label}?</strong> It’s signed in to your account and asks to open your prayers and circles.</p>
        <p class="small">Only allow it if it shows <strong class="approve-code inline">{spaced(ask.code)}</strong></p>
        <div class="row wrap">
          <button class="primary" disabled={busy} onClick={answer(true)}>{busy ? 'Allowing…' : 'Allow'}</button>
          <button disabled={busy} onClick={answer(false)}>Not me</button>
        </div>
      </> : <p>{msg}</p>}
    </div>
  )
}

/** Signed in by email alone, the key lives only on your devices: once, a
 *  nudge to keep a copy of it, from your own mail app. */
export function KeyBackup() {
  const SAVED = 'plain-bible:key-saved'
  const [code, setCode] = useState('')
  useEffect(() => {
    try { if (!noPasskey() || localStorage.getItem(SAVED)) return } catch { return }
    load().then(l => l.localKeyCode()).then(setCode).catch(() => {})
  }, [])
  if (!code) return null
  const saved = () => { try { localStorage.setItem(SAVED, '1') } catch { /* ignore */ } setCode('') }
  const body = `My Quiet Bible key:\n\n${code}\n\nIt opens my prayers and circles on a new phone, if I ever lose my old one. Keep it private.`
  return (
    <p class="muted small">Your prayers and circles open only on your own phones. In case you lose this one, keep a copy of your key:{' '}
      <a href={`mailto:?subject=${encodeURIComponent('My Quiet Bible key')}&body=${encodeURIComponent(body)}`} onClick={saved}>Email it to myself</a>
      {' · '}<button class="link" onClick={saved}>Not now</button></p>
  )
}
