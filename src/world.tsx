// Prayers around the world: after Amen, the countries where people prayed
// with the app in the last 7 days, lit on a quiet map of dots. Countries
// only, never a city, a name or a word, and a country lights up only once at
// least 5 devices prayed there (the service's /world, see src/lib/world.ts).
// Loaded only once a prayer opens, with its ~6 KB of dots (lib/worldDots.ts).
import { useRef } from 'preact/hooks'
import { COLS, DOTS, ROWS, SMALL } from './lib/worldDots'
import { useApp } from './state'
import { slideAway } from './settings'
import { locale, t } from './i18n'
import { BackIcon } from './icons'

const STEP = 10

/** The world as dots, the lit countries brighter and a little bigger. A
 *  country too small for the grid is one dot, drawn bigger once it's lit. */
export function WorldMap({ lit, mini }: { lit: string[]; mini?: boolean }) {
  const on = new Set(lit)
  const at = (d: number[], k: number) => `M${d[k] * STEP + STEP / 2} ${d[k + 1] * STEP + STEP / 2}h0`
  // One path per kind: each dot a zero-length line with round ends.
  const dim: string[] = [], bright: string[] = []
  for (const [cc, d] of Object.entries(DOTS)) for (let k = 0; k < d.length; k += 2) (on.has(cc) ? bright : dim).push(at(d, k))
  const smallLit = lit.filter(cc => SMALL.has(cc) && DOTS[cc])
  return (
    <svg class={'world-map' + (mini ? ' mini' : '')} viewBox={`0 0 ${COLS * STEP} ${ROWS * STEP}`} aria-hidden="true">
      <path class="world-off" d={dim.join('')} stroke-width={mini ? 4.5 : 5} stroke-linecap="round" />
      <path class="world-on" d={bright.join('')} stroke-width={7.5} stroke-linecap="round" />
      {smallLit.map(cc => <circle class="world-on-dot" cx={DOTS[cc][0] * STEP + STEP / 2} cy={DOTS[cc][1] * STEP + STEP / 2} r={mini ? 8 : 6.5} />)}
    </svg>
  )
}

/** The line on the Amen screen: a little map and how many countries. */
export function WorldLine({ lit, onOpen }: { lit: string[]; onOpen: () => void }) {
  return (
    <button class="world-line" onClick={onOpen}>
      <WorldMap lit={lit} mini />
      <span class="world-line-words">
        <strong>{t('Praying with people around the world')}</strong>
        <small>{t('Countries this week: {n}', { n: lit.length.toLocaleString(locale()) })}</small>
      </span>
      <span class="world-line-go" aria-hidden="true">›</span>
    </button>
  )
}

/** The map, on a card like Your prayers: the number, the map, the promise,
 *  and the tick to count or not. ‹ back goes back to Amen (one layer in, so
 *  no Done). */
export function WorldCard({ lit, onBack }: { lit: string[]; onBack: () => void }) {
  const { settings, update } = useApp()
  const box = useRef<HTMLDivElement>(null)
  const done = () => slideAway(box.current, onBack)
  return (
    <div class="pray-list world-card" ref={box}>
      <div class="pray-head">
        <button type="button" class="settings-grabber" aria-label={t('Close')} onClick={done} />
        <div class="pray-title">
          <button class="settings-back" onClick={done}><BackIcon class="back-ico" /> <span class="back-name">{t('Prayers around the world')}</span></button>
        </div>
      </div>
      <p class="world-num"><strong>{lit.length.toLocaleString(locale())}</strong>{t('Countries where people prayed with My Quiet Bible this week')}</p>
      <WorldMap lit={lit} />
      <p class="world-note">🔒 {t('Countries only. Never a city, a name or a word of any prayer. A country lights up once at least 5 phones prayed there this week.')}</p>
      <label class="check world-tick"><input type="checkbox" checked={settings.worldMap} onChange={e => update({ worldMap: (e.target as HTMLInputElement).checked })} />
        <span class="check-text"><span class="check-name">{t('Count my prayers on the map')}</span></span></label>
    </div>
  )
}
