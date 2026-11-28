import { useState } from 'preact/hooks'
import { duration } from './lib/prayers'
import { t } from './i18n'
import './seekbar.css'

/** Where you are in a recording: drag anywhere along it to go there.
 *  Time gone on the left, time left on the right. */
export function SeekBar({ pos, total, onSeek }: { pos: number; total: number; onSeek: (ms: number) => void }) {
  // While a finger is on it, the bar follows the finger, not the sound.
  const [held, setHeld] = useState<number>()
  const at = Math.max(0, Math.min(total, held ?? pos))
  const fill = total ? (at / total) * 100 : 0
  const go = (e: Event) => { const v = +(e.target as HTMLInputElement).value; setHeld(undefined); onSeek(v) }
  return (
    <div class="seek">
      <input type="range" min={0} max={Math.max(1, Math.round(total))} step={1000} value={Math.round(at)}
        style={{ '--fill': `${fill}%` }}
        aria-label={t('Prayer')} aria-valuetext={`${duration(at)} / ${duration(total)}`}
        onInput={e => setHeld(+(e.target as HTMLInputElement).value)} onChange={go} />
      <span class="seek-times" aria-hidden="true"><span>{duration(at)}</span><span>−{duration(total - at)}</span></span>
    </div>
  )
}
