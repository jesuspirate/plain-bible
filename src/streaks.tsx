// Your streaks, shown quietly at the top of Settings: days in a row reading
// the word, and praying. A tap says how they count.
import { useEffect, useState } from 'preact/hooks'
import { addDays, dayOf, DAYS_EVENT, Days, loadDays, PRAY, streaks } from './lib/streaks'

/** The days you've read and prayed, as they change. */
export function useDays() {
  const [days, setDays] = useState<Days>(loadDays)
  useEffect(() => {
    const on = () => setDays(loadDays())
    addEventListener(DAYS_EVENT, on)
    // A new day may have begun while the app was away.
    const back = () => { if (document.visibilityState === 'visible') on() }
    document.addEventListener('visibilitychange', back)
    return () => { removeEventListener(DAYS_EVENT, on); document.removeEventListener('visibilitychange', back) }
  }, [])
  return days
}

const daysText = (n: number) => n === 1 ? '1 day' : `${n} days`

export function StreakRow() {
  const days = useDays()
  const [why, setWhy] = useState(false)
  // Prayers kept before streaks existed count too.
  useEffect(() => {
    import('./lib/prayers').then(({ prayers }) => prayers.list())
      .then(l => addDays(Object.fromEntries(l.map(p => [dayOf(p.at), PRAY])))).catch(() => {})
  }, [])
  const s = streaks(days)
  return (
    <>
      <button class="set-row streak-row" aria-expanded={why} onClick={() => setWhy(w => !w)}
        aria-label={`Reading: ${daysText(s.read)} in a row${s.readToday ? ', done today' : ''}. Prayer: ${daysText(s.pray)} in a row${s.prayToday ? ', done today' : ''}. Tap to see how streaks count.`}>
        <Streak icon="📖" n={s.read} today={s.readToday} />
        <Streak icon="🙏" n={s.pray} today={s.prayToday} />
      </button>
      {why && (
        <p class="set-row streak-why">
          A day counts when you read for about a minute (scrolling or turning chapters), or pray with 🙏. Today can still be done
          until midnight, and one missed day a week is forgiven. Nothing reminds you. To share them with a circle, open the circle; to hide them, see Font, layout and more.
        </p>
      )}
    </>
  )
}

function Streak({ icon, n, today }: { icon: string; n: number; today: boolean }) {
  return (
    <span class={'streak' + (today ? ' today' : '')}>
      <span class="set-icon" aria-hidden="true">{icon}</span>
      <span class="streak-n">{daysText(n)}</span>
      {today && <span class="streak-check" aria-hidden="true">✓</span>}
    </span>
  )
}
