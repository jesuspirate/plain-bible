// A quiet moment to pray out loud. One glowing microphone over the page you
// were reading, dimmed just enough that the words are still there. What you
// say is recorded and kept on this device only; nothing is sent anywhere.
import { useEffect, useRef, useState } from 'preact/hooks'
import { canRecord, duration, partsOf, prayers, PrayerInfo, recordingType } from './lib/prayers'
import { plain } from './lib/text'
import { tap } from './lib/native'
import { awaitVerse, go, readPath, useApp, verseToPrayOver } from './state'
import { PrayerVerse, verseLabel } from './lib/prayerVerses'
import { Comfort, pickComfort } from './lib/comfort'
import type { Bible } from './lib/data'
import { deletedHere, prayerKeyCode, prayerSyncOn, syncPrayers, turnOffPrayerSync, turnOnPrayerSync } from './lib/prayerSync'
import { loadAccount, SYNC_URL } from './lib/sync'
import './prayer.css'

// paused: the phone locked mid-prayer. What was said is kept, and the next
// tap carries on in the same prayer.
type Phase = 'idle' | 'asking' | 'recording' | 'paused' | 'heard'

/** The words of `v` in `b`, or undefined if that Bible lacks any of them. */
function wordsOf(b: Bible | undefined, v: PrayerVerse) {
  const raw = v.verses.map(n => b?.books[v.book]?.[v.chapter - 1]?.[n - 1])
  return raw.every(Boolean) ? raw.map(r => plain(r!)).join(' ') : undefined
}

export function Prayer({ onClose }: { onClose: () => void }) {
  const { data, settings } = useApp()
  const version = settings.favorite || settings.version
  const [phase, setPhase] = useState<Phase>('idle')
  const [view, setView] = useState<'pray' | 'list'>('pray')
  const [note, setNote] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [list, setList] = useState<PrayerInfo[]>()
  const [bible, setBible] = useState<Bible>()
  // Said back once a prayer is kept: a verse picked at random, in the Bible you read.
  const [comfort, setComfort] = useState<Comfort>(pickComfort)
  // The verses this prayer is prayed over. Verses you just selected are
  // offered; Pray on the selection bar ties them straight away.
  const [offer] = useState(verseToPrayOver)
  const [verse, setVerseNow] = useState<PrayerVerse | undefined>(offer?.sure ? offer.verse : undefined)
  const verseRef = useRef(verse)
  const setVerse = (v: PrayerVerse | undefined) => { verseRef.current = v; setVerseNow(v) }
  // The prayer just kept, and the verse it's tied to.
  const [kept, setKept] = useState<{ id: string; verse?: PrayerVerse }>()
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; started: number; timer: number; lock?: WakeLockSentinel; interrupted?: boolean }>()
  // The prayer a paused recording carries on, and how long it already is.
  const resume = useRef<{ id: string; ms: number }>()
  const alive = useRef(true)

  const refresh = () => prayers.list().then(l => { if (alive.current) setList(l) }, () => setList([]))
  // With sync on, bring in what was prayed on other devices, and send what's new here.
  const sync = () => syncPrayers().then(changed => { if (changed) refresh() }, () => {})
  useEffect(() => {
    refresh(); sync()
    data.bible(version).then(b => { if (alive.current) setBible(b) }).catch(() => {})
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
    // A voice needs far less than music: smaller files to keep, and to sync.
    try { recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 64_000 }) } catch {
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
        const tie = verseRef.current
        if (id) await prayers.append(id, part).catch(() => { id = undefined })
        if (id && tie) await prayers.setVerse(id, tie).catch(() => {})
        if (!id) await prayers.put({ id: id = started.toString(36) + Math.random().toString(36).slice(2, 6), at: started, ...part, ...(tie ? { verse: tie } : {}) })
        navigator.storage?.persist?.().catch(() => {})
        resume.current = interrupted ? { id, ms: (before?.ms ?? 0) + ms } : undefined
        if (alive.current) {
          if (interrupted) setPhase('paused')
          else heardNow(id)
          refresh()
        }
        sync()
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

  // Amen: a new verse to take away, and the prayer's own verse, if it has one.
  function heardNow(id?: string) {
    setComfort(pickComfort())
    if (id) prayers.get(id).then(p => { if (alive.current && p) setKept({ id, verse: p.verse }) }, () => {})
    setVerse(undefined)
    setPhase('heard')
  }
  const amen = () => { const id = resume.current?.id; resume.current = undefined; heardNow(id) }
  const read = (v: PrayerVerse) => { onClose(); go(readPath(version, v.book, v.chapter, v.verses[0])) }
  // After Amen, the next verse you tap on the page is tied to this prayer.
  const addVerse = () => { if (kept) { awaitVerse(kept.id); onClose() } }
  const busy = phase === 'recording' || phase === 'paused' || phase === 'asking'
  const toggle = () => phase === 'recording' ? stop() : phase !== 'asking' && start()
  const count = list?.length ?? 0

  return (
    <div class="pray" role="dialog" aria-modal="true" aria-label="Prayer">
      <button class="pray-close" aria-label="Close" onClick={onClose}>✕</button>
      {view === 'pray' && phase !== 'heard' && (verse
        ? <div class="pray-over">
            <span>Praying over <strong>{verseLabel(verse)}</strong></span>
            <button class="pray-over-x" aria-label={`Don’t tie this prayer to ${verseLabel(verse)}`} onClick={() => setVerse(undefined)}>✕</button>
          </div>
        : offer && !busy && <button class="pray-over offer" onClick={() => setVerse(offer.verse)}>
            <span>+ Pray over <strong>{verseLabel(offer.verse)}</strong></span>
          </button>)}
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
                  <button class="pray-verse" onClick={() => read(comfort)}>
                    “{wordsOf(bible, comfort) ?? comfort.kjv}” <span class="pray-ref">{verseLabel(comfort)}</span>
                  </button>
                  {kept?.verse
                    ? <button class="pray-tied" onClick={() => read(kept.verse!)}>Prayed over <strong>{verseLabel(kept.verse)}</strong> ›</button>
                    : kept && <button class="pray-pill pray-add" onClick={addVerse}>+ Add a verse</button>}
                </>
              : <p>Tap and speak to God. Only you will hear this again.</p>}
          </div>
        </div>
      ) : <PrayerList list={list} onChange={refresh} onClose={onClose} onRead={read} />}
      <div class="pray-foot">
        {view === 'list'
          ? <button class="pray-pill" onClick={() => setView('pray')}>Pray</button>
          : phase !== 'recording' && phase !== 'paused' && <button class="pray-pill" onClick={() => setView('list')}>Your prayers{count ? ` · ${count}` : ''}</button>}
        <p class="pray-private">{prayerSyncOn() ? 'Encrypted on this device, then synced.' : 'Kept on this device only.'}</p>
      </div>
    </div>
  )
}

function PrayerList({ list, onChange, onClose, onRead }: { list?: PrayerInfo[]; onChange: () => void; onClose: () => void; onRead: (v: PrayerVerse) => void }) {
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
  // Send it to someone, or keep your own copy: the share sheet on phones
  // (Messages, Files, Voice Memos…), a download elsewhere. Each part is its own file.
  const ready = useRef<{ id: string; files: File[] }>()
  const [again, setAgain] = useState<string>()
  const save = async (p: PrayerInfo) => {
    let files = ready.current?.id === p.id ? ready.current.files : undefined
    if (!files) {
      const full = await prayers.get(p.id)
      if (!full) return
      const parts = partsOf(full), name = fileName(full.at)
      files = parts.map((x, i) => new File([x.audio], `${name}${parts.length > 1 ? ` (${i + 1} of ${parts.length})` : ''}.${extension(x.type)}`, { type: x.type }))
    }
    if (navigator.canShare?.({ files })) {
      try { await navigator.share({ files }); ready.current = undefined; setAgain(undefined) } catch (e) {
        // Safari wants the share right after the tap; if reading the
        // recording took too long, the next tap shares at once.
        if ((e as Error).name === 'NotAllowedError') { ready.current = { id: p.id, files }; setAgain(p.id) }
      }
      return
    }
    for (const f of files) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(f); a.download = f.name; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    }
  }
  const remove = async (id: string) => {
    if (playing === id) release()
    setConfirm(undefined)
    await prayers.delete(id).catch(() => {})
    await deletedHere(id).catch(() => {})
    onChange()
    syncPrayers().catch(() => {})
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
              <span class="pray-when">{when(p.at)}<span class="muted"> · {playing === p.id ? `${duration(pos)} / ` : ''}{duration(p.ms)}</span>
                {p.verse && <button class="link pray-list-verse" onClick={() => onRead(p.verse!)}>{verseLabel(p.verse)}</button>}</span>
              {confirm === p.id
                ? <span class="pray-confirm"><button class="small" onClick={() => setConfirm(undefined)}>Keep</button><button class="small danger" onClick={() => remove(p.id)}>{prayerSyncOn() ? 'Delete everywhere' : 'Delete'}</button></span>
                : <><button class="icon small pray-save" aria-label="Share or save this prayer" title="Share or save" onClick={() => save(p)}>
                    {again === p.id ? 'Share' : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>}
                  </button>
                  <button class="icon small" aria-label="Delete this prayer" onClick={() => setConfirm(p.id)}>✕</button></>}
            </li>
          ))}
        </ol>
      )}
      <PrayerSync onChange={onChange} onClose={onClose} />
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
function fileName(at: number) {
  const d = new Date(at)
  return `Prayer ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`
}
const extension = (type: string) => type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'

// Sync with your other devices: off until you turn it on, here.
// Removing a home-screen web app on iPhone deletes its storage, prayers included.
const LOCAL_ONLY = 'Until then, your prayers live only in this copy of the app. Removing it from your Home Screen, or clearing website data, deletes them.'

function PrayerSync({ onChange, onClose }: { onChange: () => void; onClose: () => void }) {
  const [on, setOn] = useState(prayerSyncOn)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [code, setCode] = useState('')
  const [shown, setShown] = useState('')
  if (!SYNC_URL) return null
  const signedIn = !!loadAccount()

  const act = (fn: () => Promise<void>) => async () => {
    setBusy(true); setMsg('')
    try { await fn() } catch (e) {
      const m = (e as Error).message
      setMsg(m === 'Cancelled' ? 'The passkey request was cancelled. Tap to try again.' : m)
    } finally { setBusy(false); setOn(prayerSyncOn()); onChange() }
  }
  const start = act(async () => {
    const r = await turnOnPrayerSync(needCode ? code : undefined)
    setNeedCode(r === 'needCode')
    if (r === 'on') { setCode(''); setMsg('Your prayers now sync with your other devices.') }
  })
  const stop = act(async () => { await turnOffPrayerSync(); setShown(''); setMsg('Prayers stay on this device and stop syncing here.') })
  const now = act(async () => { await syncPrayers() })

  return (
    <div class="pray-sync">
      {on ? <>
        <p><strong>Syncing with your devices.</strong> <span class="muted">Each prayer is encrypted on this device before it leaves it. Only your devices can hear it.</span></p>
        {shown && <p class="pray-key"><code>{shown.replace(/-/g, '-\u200B')}</code></p>}
        <div class="row wrap">
          <button class="small" disabled={busy} onClick={now}>{busy ? 'Syncing…' : 'Sync now'}</button>
          {shown
            ? <button class="small" onClick={() => navigator.clipboard?.writeText(shown).then(() => setMsg('Copied.'), () => {})}>Copy key</button>
            : <button class="small" onClick={() => prayerKeyCode().then(setShown)}>Show prayer key</button>}
          <button class="small" disabled={busy} onClick={stop}>Stop syncing here</button>
        </div>
        {shown && <p class="muted small">Only needed on a device whose passkey can’t unlock your prayers (say, an Android phone next to an iPhone). Keep it private: it opens your prayers.</p>}
      </> : !signedIn ? <>
        <p class="muted">To keep your prayers on all your devices, sign in first. They’re encrypted on this device before they leave it.</p>
        <p class="muted small">{LOCAL_ONLY}</p>
        <button class="small" onClick={() => { onClose(); go('settings') }}>Go to Settings → Account</button>
      </> : needCode ? <>
        <p class="muted">This passkey can’t unlock your prayers here. On a device where they already sync, open Your prayers → Show prayer key, and type it below.</p>
        <input class="pray-code" value={code} onInput={e => setCode((e.target as HTMLInputElement).value)} placeholder="Prayer key"
          autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellcheck={false} />
        <div class="row wrap">
          <button class="small primary" disabled={busy || !code.trim()} onClick={start}>{busy ? 'Unlocking…' : 'Unlock'}</button>
          <button class="small" onClick={() => { setNeedCode(false); setMsg('') }}>Cancel</button>
        </div>
      </> : <>
        <p class="muted">Keep your prayers on all your devices. Each one is encrypted on this device before it leaves it, so no one else, not even the server, can hear it.</p>
        <button class="small primary" disabled={busy} onClick={start}>{busy ? 'Waiting for passkey…' : 'Sync my prayers'}</button>
        <p class="muted small">{LOCAL_ONLY}</p>
      </>}
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}
