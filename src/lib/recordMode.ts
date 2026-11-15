import { useEffect, useState } from 'preact/hooks'

// Recording mode: for filming the screen (a short daily video). The version
// picked here shows large, and the Bible you read shows small under each
// verse so you can follow along. It lives on this device only: it is not a
// setting that syncs, and it never changes your Bible.

const KEY = 'plain-bible:recording'
export const RECORDING_EVENT = 'plain-bible:recording'

export interface Recording {
  on: boolean
  /** the version shown large while recording */
  version: string
}

const FIRST: Recording = { on: false, version: 'BSB' }

export function loadRecording(): Recording {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null')
    return r && typeof r.version === 'string' ? { on: !!r.on, version: r.version } : FIRST
  } catch { return FIRST }
}

export function saveRecording(r: Recording) {
  try { localStorage.setItem(KEY, JSON.stringify(r)) } catch { /* private mode */ }
  dispatchEvent(new Event(RECORDING_EVENT))
}

/** The recording mode on this device, kept up to date as it changes. */
export function useRecording(): Recording {
  const [r, setR] = useState(loadRecording)
  useEffect(() => {
    const on = () => setR(loadRecording())
    addEventListener(RECORDING_EVENT, on)
    return () => removeEventListener(RECORDING_EVENT, on)
  }, [])
  return r
}
