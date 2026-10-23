// A quiet moment to pray out loud. One glowing microphone over the page you
// were reading, dimmed just enough that the words are still there. What you
// say is recorded and kept on this device only; nothing is sent anywhere.
import { useEffect, useRef, useState } from 'preact/hooks'
import { canRecord, duration, partsOf, prayers, PrayerInfo, recordingType } from './lib/prayers'
import { plain } from './lib/text'
import { tap } from './lib/native'
import { go, readPath, useApp } from './state'
import './prayer.css'

// paused: the phone locked mid-prayer. What was said is kept, and the next
// tap carries on in the same prayer.
type Phase = 'idle' | 'asking' | 'recording' | 'paused' | 'heard'

// Said back once a prayer is kept, in the Bible you read when it's on the device.
const HEARD = { book: 'Ps', chapter: 116, verse: 1, kjv: 'I love the LORD, because he hath heard my voice and my supplications.' }

export function Prayer({ onClose }: { onClose: () => void }) {
  const { data, settings } = useApp()
  const version = settings.favorite || settings.version
  const [phase, setPhase] = useState<Phase>('idle')
  const [view, setView] = useState<'pray' | 'list'>('pray')
  const [note, setNote] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [list, setList] = useState<PrayerInfo[]>()
  const [heard, setHeard] = useState(HEARD.kjv)
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; started: number; timer: number; lock?: WakeLockSentinel; interrupted?: boolean }>()
  // The prayer a paused recording carries on, and how long it already is.
  const resume = useRef<{ id: string; ms: number }>()
  const alive = useRef(true)

  const refresh = () => prayers.list().then(l => { if (alive.current) setList(l) }, () => setList([]))
  useEffect(() => {
    refresh()
    data.bible(version).then(b => {
      const raw = b.books[HEARD.book]?.[HEARD.chapter - 1]?.[HEARD.verse - 1]
      if (raw && alive.current) setHeard(plain(raw))
    }).catch(() => {})
    document.documentElement.classList.add('praying')
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // Phones cut the microphone off when the app goes to the background or
    // the screen locks: keep what was said so far, and offer to carry on.
    const hidden = () => { if (document.visibilityState === 'hidden') stop(true) }
    addEventListener('keydown', esc)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      alive.current = false
      stop()
      document.documentElement.classList.remove('praying')
      removeEventListener('keydown', esc)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [])

  const start = async () => {
    if (!canRecord()) { setNote('This browser can’t record audio. Try Safari or Chrome.'); return }
    setNote(''); setPhase('asking')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      setPhase('idle')
      setNote((e as DOMException)?.name === 'NotAllowedError'
        ? 'The microphone is blocked. Allow it for this app in your browser or phone settings, then tap again.'
        : 'No microphone could be found.')
      return
    }
    if (!alive.current) { stream.getTracks().forEach(t => t.stop()); return }
    const type = recordingType()
    let recorder: MediaRecorder
    try { recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined) } catch {
      stream.getTracks().forEach(t => t.stop())
      setPhase('idle'); setNote('This browser can’t record audio.')
      return
    }
    const chunks: Blob[] = []
    const started = Date.now()
    const before = resume.current
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const ms = Date.now() - started
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/mp4' })
      const interrupted = !!this_.interrupted
      if (!blob.size || ms < 800) { if (alive.current) setPhase(before ? (interrupted ? 'paused' : 'heard') : 'idle'); return }
      try {
        const part = { ms, type: blob.type, audio: await blob.arrayBuffer() }
        let id = before?.id
        if (id) await prayers.append(id, part).catch(() => { id = undefined })
        if (!id) await prayers.put({ id: id = started.toString(36) + Math.random().toString(36).slice(2, 6), at: started, ...part })
        navigator.storage?.persist?.().catch(() => {})
        resume.current = interrupted ? { id, ms: (before?.ms ?? 0) + ms } : undefined
        if (alive.current) { setPhase(interrupted ? 'paused' : 'heard'); refresh() }
      } catch {
        if (alive.current) { setPhase('idle'); setNote('Your prayer couldn’t be kept: this device may be out of space.') }
      }
    }
    // Hand over the audio every second, so an interruption loses little.
    recorder.start(1000)
    const this_: NonNullable<typeof rec.current> = { recorder, stream, started, timer: window.setInterval(() => setElapsed((before?.ms ?? 0) + Date.now() - started), 250) }
    rec.current = this_
    // Keep the screen awake while praying, so the phone doesn't lock itself
    // and cut the microphone off.
    navigator.wakeLock?.request('screen').then(l => { if (rec.current === this_) this_.lock = l; else l.release() }).catch(() => {})
    setElapsed(before?.ms ?? 0); setPhase('recording'); tap()
  }

  function stop(interrupted = false) {
    const r = rec.current
    if (!r) return
    r.interrupted = interrupted
    rec.current = undefined
    clearInterval(r.timer)
    r.lock?.release().catch(() => {})
    if (r.recorder.state !== 'inactive') r.recorder.stop()
    else r.stream.getTracks().forEach(t => t.stop())
    if (!interrupted) tap()
  }

  const amen = () => { resume.current = undefined; setPhase('heard') }
  const toggle = () => phase === 'recording' ? stop() : phase !== 'asking' && start()
  const count = list?.length ?? 0

  return (
    <div class="pray" role="dialog" aria-modal="true" aria-label="Prayer">
      <button class="pray-close" aria-label="Close" onClick={onClose}>✕</button>
      {view === 'pray' ? (
        <div class="pray-center">
          <button class={'pray-mic' + (phase === 'recording' ? ' on' : '')} onClick={toggle}
            aria-label={phase === 'recording' ? 'Amen: stop and keep this prayer' : phase === 'paused' ? 'Keep praying' : 'Start praying out loud'}>
            <svg viewBox="0 0 24 24" width="52" height="52" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12.5" rx="3.5" fill="currentColor" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" /></svg>
          </button>
          <div class="pray-words" aria-live="polite">
            {note ? <p>{note}</p>
              : phase === 'recording' ? <><p class="pray-time">{duration(elapsed)}</p><p>Tap when you’re done.</p></>
              : phase === 'asking' ? <p>…</p>
              : phase === 'paused' ? <>
                  <p class="pray-time">{duration(elapsed)}</p>
                  <p>The phone locked, so your prayer paused. Everything you said is kept.</p>
                  <p>Tap the light to keep praying, or</p>
                  <button class="pray-pill pray-amen-btn" onClick={amen}>Amen</button>
                </>
              : phase === 'heard' ? <>
                  <p class="pray-amen">Amen. He heard you.</p>
                  <button class="pray-verse" onClick={() => { onClose(); go(readPath(version, HEARD.book, HEARD.chapter, HEARD.verse)) }}>
                    “{heard}” <span class="pray-ref">Psalm 116:1</span>
                  </button>
                </>
              : <p>Tap and speak to God. Only you will hear this again.</p>}
          </div>
        </div>
      ) : <PrayerList list={list} onChange={refresh} />}
      <div class="pray-foot">
        {view === 'list'
          ? <button class="pray-pill" onClick={() => setView('pray')}>Pray</button>
          : count > 0 && phase !== 'recording' && phase !== 'paused' && <button class="pray-pill" onClick={() => setView('list')}>Your prayers · {count}</button>}
        <p class="pray-private">Kept on this device only.</p>
      </div>
    </div>
  )
}

function PrayerList({ list, onChange }: { list?: PrayerInfo[]; onChange: () => void }) {
  const [playing, setPlaying] = useState<string>()
  const [pos, setPos] = useState(0)
  const [confirm, setConfirm] = useState<string>()
  const audio = useRef<{ el: HTMLAudioElement; urls: string[] }>()
  const release = () => {
    const a = audio.current
    if (a) { a.el.pause(); a.urls.forEach(u => URL.revokeObjectURL(u)); audio.current = undefined }
    setPlaying(undefined); setPos(0)
  }
  useEffect(() => release, [])

  const play = async (p: PrayerInfo) => {
    if (playing === p.id) { release(); return }
    release()
    const full = await prayers.get(p.id)
    if (!full) return
    // A prayer picked up again after the phone locked plays its parts in turn.
    const parts = partsOf(full)
    const urls = parts.map(x => URL.createObjectURL(new Blob([x.audio], { type: x.type })))
    const el = new Audio()
    let i = 0, offset = 0
    el.ontimeupdate = () => setPos(offset + el.currentTime * 1000)
    el.onended = () => {
      if (++i >= urls.length) { release(); return }
      offset += parts[i - 1].ms
      el.src = urls[i]; el.play().catch(release)
    }
    audio.current = { el, urls }
    setPlaying(p.id)
    el.src = urls[0]
    el.play().catch(release)
  }
  const remove = async (id: string) => {
    if (playing === id) release()
    setConfirm(undefined)
    await prayers.delete(id).catch(() => {})
    onChange()
  }

  const when = (at: number) => new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div class="pray-list">
      <h2>Your prayers</h2>
      {!list?.length ? <p class="muted">No prayers yet.</p> : (
        <ol>
          {list.map(p => (
            <li class={playing === p.id ? 'on' : ''}>
              <button class="pray-play" aria-label={playing === p.id ? 'Stop' : `Play prayer from ${when(p.at)}`} onClick={() => play(p)}>
                {playing === p.id
                  ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
                  : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
              </button>
              <span class="pray-when">{when(p.at)}<span class="muted"> · {playing === p.id ? `${duration(pos)} / ` : ''}{duration(p.ms)}</span></span>
              {confirm === p.id
                ? <span class="pray-confirm"><button class="small" onClick={() => setConfirm(undefined)}>Keep</button><button class="small danger" onClick={() => remove(p.id)}>Delete</button></span>
                : <button class="icon small" aria-label="Delete this prayer" onClick={() => setConfirm(p.id)}>✕</button>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
