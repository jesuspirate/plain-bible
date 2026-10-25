// A quiet moment to pray out loud. One glowing microphone over the page you
// were reading, dimmed just enough that the words are still there. What you
// say is recorded and kept on this device only; nothing is sent anywhere.
import { useEffect, useRef, useState } from 'preact/hooks'
import { AskApproval } from './approve'
import { canRecord, duration, partsOf, prayers, PrayerInfo, recordingType } from './lib/prayers'
import { plain } from './lib/text'
import { awaitVerse, go, inCircles, openSettings, PrayAt, readPath, shareWithCircle, useApp, verseToPrayOver } from './state'
import { BackIcon, CircleIcon, CloseIcon } from './icons'
import { PrayerVerse, verseLabel } from './lib/prayerVerses'
import { Comfort, pickComfort } from './lib/comfort'
import type { Bible } from './lib/data'
import { deletedHere, prayerKeyCode, prayerSyncOn, syncPrayers, turnOffPrayerSync, turnOnPrayerSync } from './lib/prayerSync'
import { loadAccount, SYNC_URL } from './lib/sync'
import { slideAway, usePullDown } from './settings'
import { DeviceLink } from './move'
import { addDays, dayOf, loadDays, markDay, PRAY, streak } from './lib/streaks'
import './prayer.css'
import { locale, N_, t, tj, tn } from './i18n'

// paused: the phone locked mid-prayer. What was said is kept, and the next
// tap carries on in the same prayer.
type Phase = 'idle' | 'asking' | 'recording' | 'paused' | 'heard'

/** The words of `v` in `b`, or undefined if that Bible lacks any of them. */
function wordsOf(b: Bible | undefined, v: PrayerVerse) {
  const raw = v.verses.map(n => b?.books[v.book]?.[v.chapter - 1]?.[n - 1])
  return raw.every(Boolean) ? raw.map(r => plain(r!)).join(' ') : undefined
}

export function Prayer({ at, onClose }: { at?: PrayAt; onClose: () => void }) {
  const { data, settings } = useApp()
  const version = settings.version
  const [phase, setPhase] = useState<Phase>('idle')
  // Praying, Your prayers, or Circles (opened from its own button beside 🙏).
  const [view, setView] = useState<'pray' | 'list' | 'circles'>(at ? 'circles' : 'pray')
  useEffect(() => { if (at) setView('circles') }, [at])
  const [note, setNote] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [list, setList] = useState<PrayerInfo[]>()
  const [bible, setBible] = useState<Bible>()
  // Said back once a prayer is kept: a verse picked at random, in the Bible you read.
  const [comfort, setComfort] = useState<Comfort>(pickComfort)
  // The verses this prayer is prayed using. Verses you just selected are
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
  // The dim starts under the top bar: the clock strip above it keeps the
  // colour the app opened with (an installed iPhone app can't repaint it),
  // so dimming the bar too left a bright strip over a grey one.
  const [cut] = useState(() => Math.max(0, Math.round(document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0)))

  // Every prayer kept (here, or synced from another device) is a day prayed.
  const refresh = () => prayers.list().then(l => {
    addDays(Object.fromEntries(l.map(p => [dayOf(p.at), PRAY])))
    if (alive.current) setList(l)
  }, () => setList([]))
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
    if (!canRecord()) { setNote(t('This browser can’t record audio. Try Safari or Chrome.')); return }
    setNote(''); setPhase('asking')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      setPhase('idle')
      setNote((e as DOMException)?.name === 'NotAllowedError'
        ? t('The microphone is blocked. Allow it for this app in your browser or phone settings, then tap again.')
        : t('No microphone could be found.'))
      return
    }
    if (!alive.current) { stream.getTracks().forEach(track => track.stop()); return }
    const type = recordingType()
    let recorder: MediaRecorder
    // A voice needs far less than music: smaller files to keep, and to sync.
    try { recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 64_000 }) } catch {
      stream.getTracks().forEach(track => track.stop())
      setPhase('idle'); setNote(t('This browser can’t record audio.'))
      return
    }
    const chunks: Blob[] = []
    const started = Date.now()
    const before = resume.current
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    recorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop())
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
        markDay(PRAY, dayOf(started))
        navigator.storage?.persist?.().catch(() => {})
        resume.current = interrupted ? { id, ms: (before?.ms ?? 0) + ms } : undefined
        if (alive.current) {
          if (interrupted) setPhase('paused')
          else heardNow(id)
          refresh()
        }
        sync()
      } catch {
        if (alive.current) { setPhase('idle'); setNote(t('Your prayer couldn’t be kept: this device may be out of space.')) }
      }
    }
    // Hand over the audio every second, so an interruption loses little.
    recorder.start(1000)
    const this_: NonNullable<typeof rec.current> = { recorder, stream, started, timer: window.setInterval(() => setElapsed((before?.ms ?? 0) + Date.now() - started), 250) }
    rec.current = this_
    // Keep the screen awake while praying, so the phone doesn't lock itself
    // and cut the microphone off.
    navigator.wakeLock?.request('screen').then(l => { if (rec.current === this_) this_.lock = l; else l.release() }).catch(() => {})
    setElapsed(before?.ms ?? 0); setPhase('recording')
  }

  function stop(interrupted = false) {
    const r = rec.current
    if (!r) return
    r.interrupted = interrupted
    rec.current = undefined
    clearInterval(r.timer)
    r.lock?.release().catch(() => {})
    if (r.recorder.state !== 'inactive') r.recorder.stop()
    else r.stream.getTracks().forEach(track => track.stop())
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
    <div class="pray" role="dialog" aria-modal="true" aria-label={t('Prayer')} style={{ '--cut': `${cut}px` }}>
      {/* The list has its own Done, so only one close is ever on screen. */}
      {view === 'pray' && <button class="pray-close" aria-label={t('Close')} onClick={onClose}><CloseIcon size={26} /></button>}
      {view === 'pray' && phase !== 'heard' && (verse
        ? <div class="pray-over">
            <span>{tj('Praying using {verse}', { verse: <strong>{verseLabel(verse)}</strong> })}</span>
            <button class="pray-over-x" aria-label={t('Don’t tie this prayer to {verse}', { verse: verseLabel(verse) })} onClick={() => setVerse(undefined)}>✕</button>
          </div>
        : offer && !busy && <button class="pray-over offer" onClick={() => setVerse(offer.verse)}>
            <span>+ {tj('Pray using {verse}', { verse: <strong>{verseLabel(offer.verse)}</strong> })}</span>
          </button>)}
      {view === 'pray' ? (
        <div class="pray-center">
          <button class={'pray-mic' + (phase === 'recording' ? ' on' : '')} onClick={toggle}
            aria-label={phase === 'recording' ? t('Amen: stop and keep this prayer') : phase === 'paused' ? t('Keep praying') : t('Start praying out loud')}>
            <svg viewBox="0 0 24 24" width="52" height="52" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12.5" rx="3.5" fill="currentColor" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" /></svg>
          </button>
          <div class="pray-words" aria-live="polite">
            {note ? <p>{note}</p>
              : phase === 'recording' ? <><p class="pray-time">{duration(elapsed)}</p><p>{t('Tap when you’re done.')}</p></>
              : phase === 'asking' ? <p>…</p>
              : phase === 'paused' ? <>
                  <p class="pray-time">{duration(elapsed)}</p>
                  <p>{t('The phone locked, so your prayer paused. Everything you said is kept.')}</p>
                  <p>{t('Tap the light to keep praying, or')}</p>
                  <button class="pray-pill pray-amen-btn" onClick={amen}>{t('Amen')}</button>
                </>
              : phase === 'heard' ? <>
                  <p class="pray-amen">{t('Amen. He heard you.')}</p>
                  {settings.streaks && <PrayStreak />}
                  <button class="pray-verse" onClick={() => read(comfort)}>
                    “{wordsOf(bible, comfort) ?? comfort.kjv}” <span class="pray-ref">{verseLabel(comfort)}</span>
                  </button>
                  {kept?.verse
                    ? <button class="pray-tied" onClick={() => read(kept.verse!)}>{tj('Prayed using {verse}', { verse: <strong>{verseLabel(kept.verse)}</strong> })} ›</button>
                    : kept && <button class="pray-pill pray-add" onClick={addVerse}>+ {t('Add a verse')}</button>}
                </>
              : <p>{t('Tap and speak to God. Only you will hear this again.')}</p>}
          </div>
        </div>
      ) : view === 'list' ? <PrayerList list={list} onChange={refresh} onClose={onClose} onRead={read} />
        : <CirclesCard at={at} onClose={onClose} />}
      <div class="pray-foot">
        {view === 'list'
          ? <button class="pray-pill" onClick={() => setView('pray')}>{t('Pray')}</button>
          : view === 'pray' && phase !== 'recording' && phase !== 'paused' &&
            <button class="pray-pill" onClick={() => setView('list')}>{t('Your prayers')}{count ? ` · ${count}` : ''}</button>}
        {view !== 'circles' && <p class="pray-private">{prayerSyncOn() ? t('Encrypted on this device, then synced.') : t('Kept on this device only.')}</p>}
      </div>
    </div>
  )
}

/** Circles, opened from its own button: the same card as Your prayers. Inside one circle the top
 *  has only ‹ back; on the list, Done (or a pull down) closes. */
function CirclesCard({ at, onClose }: { at?: PrayAt; onClose: () => void }) {
  const [mod, setMod] = useState<typeof import('./circles')>()
  useEffect(() => { import('./circles').then(m => setMod(() => m)).catch(() => {}) }, [])
  const [circle, setCircle] = useState(at?.circle)
  useEffect(() => setCircle(at?.circle), [at])
  const box = useRef<HTMLDivElement>(null)
  usePullDown(box, () => box.current?.scrollTop ?? 0, onClose)
  useEffect(() => { box.current?.scrollTo(0, 0) }, [circle?.id])
  const done = () => slideAway(box.current, onClose)
  return (
    // A link inside (a verse, mostly) goes to the word, so prayer steps aside.
    <div class="pray-list pray-circles" ref={box} onClick={e => { if ((e.target as Element).closest?.('a[href^="#"]')) onClose() }}>
      <div class="pray-head">
        <button type="button" class="settings-grabber" aria-label={t('Close')} onClick={done} />
        <div class="pray-title">
          {circle
            ? <button class="settings-back" onClick={() => setCircle(undefined)}><BackIcon class="back-ico" /> {circle.name}</button>
            : <><h2>{t('Circles')}</h2><button class="done-btn" onClick={done}>{t('Done')}</button></>}
        </div>
      </div>
      {mod ? <mod.CirclesPanel circle={circle?.id} onOpen={setCircle} onAway={onClose} /> : <p class="muted">{t('Opening…')}</p>}
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
      files = parts.map((x, i) => new File([x.audio], `${name}${parts.length > 1 ? ` (${t('{i} of {n}', { i: i + 1, n: parts.length })})` : ''}.${extension(x.type)}`, { type: x.type }))
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

  // One way out: Done, or pull the card down, like Settings.
  const box = useRef<HTMLDivElement>(null)
  usePullDown(box, () => box.current?.scrollTop ?? 0, onClose)
  const done = () => slideAway(box.current, onClose)
  const when = (at: number) => new Date(at).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div class="pray-list" ref={box}>
      <div class="pray-head">
        <button type="button" class="settings-grabber" aria-label={t('Close')} onClick={done} />
        <div class="pray-title">
          <h2>{t('Your prayers')}</h2>
          <button class="done-btn" onClick={done}>{t('Done')}</button>
        </div>
      </div>
      {!list?.length ? <p class="muted">{t('No prayers yet.')}</p> : (
        <ol>
          {list.map(p => (
            <li class={playing === p.id ? 'on' : ''}>
              <button class="pray-play" aria-label={playing === p.id ? t('Stop') : t('Play prayer from {when}', { when: when(p.at) })} onClick={() => play(p)}>
                {playing === p.id
                  ? <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
                  : <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>}
              </button>
              <span class="pray-when">{when(p.at)}<span class="muted"> · {playing === p.id ? `${duration(pos)} / ` : ''}{duration(p.ms)}</span>
                {p.verse
                  ? <button class="link pray-list-verse" onClick={() => onRead(p.verse!)}>{verseLabel(p.verse)}</button>
                  // Thought of a verse later? The next verse you tap is tied to this prayer.
                  : <button class="link pray-list-verse pray-list-add" onClick={() => { release(); awaitVerse(p.id); onClose() }}>+ {t('Add a verse')}</button>}</span>
              {confirm !== p.id && <>
                <button class="pray-icon" aria-label={t('Share or save this prayer')} title={t('Share or save')} onClick={() => save(p)}>
                  {again === p.id ? t('Share') : <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>}
                </button>
                {inCircles() && <button class="pray-icon" aria-label={t('Share this prayer with your circle')} title={t('Share with your circle')} onClick={() => shareWithCircle({ prayer: p.id })}>
                  <CircleIcon size={24} />
                </button>}
                {/* A bin, not a cross: a cross reads as close. */}
                <button class="pray-icon pray-bin" aria-label={t('Delete this prayer')} title={t('Delete')} onClick={() => setConfirm(p.id)}>
                  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button></>}
              {confirm === p.id && <div class="pray-confirm">
                <button class="pray-btn" onClick={() => setConfirm(undefined)}>{t('Keep')}</button>
                <button class="pray-btn danger" onClick={() => remove(p.id)}>{prayerSyncOn() ? t('Delete everywhere') : t('Delete')}</button>
              </div>}
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
  return `${t('Prayer')} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`
}
const extension = (type: string) => type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'

// Sync with your other devices: off until you turn it on, here.
// Removing a home-screen web app on iPhone deletes its storage, prayers included.
const LOCAL_ONLY = N_('Until then, your prayers live only in this copy of the app. Removing it from your Home Screen, or clearing website data, deletes them.')

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
      setMsg(m === 'Cancelled' ? t('The passkey request was cancelled. Tap to try again.') : m)
    } finally { setBusy(false); setOn(prayerSyncOn()); onChange() }
  }
  const start = act(async () => {
    const r = await turnOnPrayerSync(needCode ? code : undefined)
    setNeedCode(r === 'needCode')
    if (r === 'on') { setCode(''); setMsg(t('Your prayers now sync with your other devices.')) }
  })
  const stop = act(async () => { await turnOffPrayerSync(); setShown(''); setMsg(t('Prayers stay on this device and stop syncing here.')) })

  return (
    <div class="pray-sync">
      {on ? <>
        <p><strong>✓ {t('Synced with your devices.')}</strong> <span class="muted">{t('Encrypted, so only you can hear them.')}</span></p>
        <DeviceLink class="pray-link" />
        <details class="account-more">
          <summary>{t('More')}</summary>
          {shown && <p class="pray-key"><code>{shown.replace(/-/g, '-\u200B')}</code></p>}
          {/* Prayers sync by themselves each time this opens, so there's no Sync now. */}
          {shown
            ? <>
              <button class="pray-btn" onClick={() => navigator.clipboard?.writeText(shown).then(() => setMsg(t('Copied.')), () => {})}>{t('Copy prayer key')}</button>
              {/* From your own mail app, so the key never passes through the sync server. */}
              <a class="pray-btn" href={`mailto:?subject=${encodeURIComponent(t('My Quiet Bible prayer key'))}&body=${encodeURIComponent(
                t('My Quiet Bible prayer key:') + `\n\n${shown}\n\n` + t('It unlocks my synced prayers on a new device (Your prayers → Sync my prayers). Keep it private.'))}`}>{t('Email it to myself')}</a>
            </>
            : <button class="pray-btn" onClick={() => prayerKeyCode().then(setShown)}>{t('Show prayer key')}</button>}
          {shown && <p class="muted small">{t('Only needed on a device that can’t unlock your prayers by itself: one where you sign in by email, or whose passkey can’t. Easier: Link another device. Keep the key private: it opens your prayers. Emailed to yourself, it’s there if you ever lose this phone.')}</p>}
          <button class="pray-btn quiet" disabled={busy} onClick={stop}>{busy ? t('Stopping…') : t('Stop syncing on this device')}</button>
        </details>
      </> : !signedIn ? <>
        <p class="muted">{t('To keep your prayers on all your devices, sign in first. They’re encrypted on this device before they leave it.')}</p>
        <p class="muted small">{t(LOCAL_ONLY)}</p>
        <button class="pray-btn" onClick={() => { onClose(); openSettings() }}>{t('Go to Settings → Account')}</button>
      </> : needCode ? <>
        <p class="muted">{t('This device can’t unlock your prayers by itself yet. Let one where they already sync allow it:')}</p>
        <AskApproval btn="pray-btn" onDone={() => { setNeedCode(false); act(async () => { if (await turnOnPrayerSync() === 'on') setMsg(t('Your prayers now sync with your other devices.')) })() }} />
        <p class="muted small">{t('Or paste the prayer key from there (Your prayers → More → Show prayer key):')}</p>
        <input class="pray-code" value={code} onInput={e => setCode((e.target as HTMLInputElement).value)} placeholder={t('Prayer key')}
          autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellcheck={false} />
        <button class="pray-btn primary" disabled={busy || !code.trim()} onClick={start}>{busy ? t('Unlocking…') : t('Unlock')}</button>
        <button class="pray-btn" onClick={() => { setNeedCode(false); setMsg('') }}>{t('Cancel')}</button>
      </> : <>
        <p class="muted">{t('Keep your prayers on all your devices. Each one is encrypted on this device before it leaves it, so no one else, not even the server, can hear it.')}</p>
        <button class="pray-btn primary" disabled={busy} onClick={start}>{busy ? t('Waiting for passkey…') : t('Sync my prayers')}</button>
        <p class="muted small">{t(LOCAL_ONLY)}</p>
      </>}
      {msg && <p class="note small">{msg}</p>}
    </div>
  )
}

/** A quiet word after Amen, from the second day in a row. */
function PrayStreak() {
  const n = streak(loadDays(), PRAY)
  return n > 1 ? <p class="pray-streak">{tn(n, '{n} day of prayer in a row', '{n} days of prayer in a row')}</p> : null
}
