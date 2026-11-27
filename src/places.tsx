// Recent places: where you were reading before your last jumps, each with a
// line of its verse. It used to be the clock button in the top bar (one tap
// back, hold for more); that spot now holds the Bible versions button, and
// the places live here, in Settings, one tap from the Yours card.
import { useEffect, useState } from 'preact/hooks'
import { resumePath, useApp, useRoute } from './state'
import { loadTrail, onTrail, previous, Trail, Visit } from './lib/history'
import { formatRef } from './lib/refs'
import { plain } from './lib/text'
import { t } from './i18n'

/** The reading history as it changes. */
export function useTrail() {
  const [trail, setTrail] = useState<Trail>(loadTrail)
  useEffect(() => onTrail(setTrail), [])
  return trail
}

export const placeName = (p: Visit) => formatRef({ book: p.book, chapter: p.chapter, verse: p.verse > 1 ? p.verse : undefined })

/** The places to go back to, most recent first, and the Bible to open them in. */
export function usePlaces() {
  const { settings, byId } = useApp()
  const route = useRoute()
  const trail = useTrail()
  const reading = route.path[0] === 'read' && route.path.length >= 4
  // Away from the reader (Settings over Saved, say) the first place is the
  // one you were reading.
  const places = reading ? previous(trail) : trail.items.slice().reverse()
  const version = reading && byId.has(route.path[1]) ? route.path[1] : settings.version
  const parallel = (reading && route.params.get('p')?.split(',')) || []
  const href = (p: Visit) => '#/' + resumePath(version, p.book, p.chapter, p.verse, parallel)
  return { places, version, href }
}

/** The Settings page: big rows, each a link (a link leaves Settings). */
export function RecentPlaces() {
  const { data } = useApp()
  const { places, version, href } = usePlaces()
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    data.bible(version).then(b => setLines(places.map(p => {
      const raw = b.books[p.book]?.[p.chapter - 1]?.[p.verse - 1]
      return raw ? plain(raw) : ''
    }))).catch(() => {})
  }, [version, places.map(placeName).join()])
  if (!places.length) return <p class="muted places-empty">{t('When you jump to another passage, the place you left shows here so you can come back with one tap.')}</p>
  return (
    <div class="places">
      {places.map((p, i) => (
        <a class={'place' + (i ? '' : ' first')} href={href(p)}>
          {!i && <span class="peek-kicker">{t('Back to')}</span>}
          <strong>{placeName(p)}</strong>
          {lines[i] && <span class={'peek-line' + (i ? ' one' : '')}>{lines[i]}</span>}
        </a>
      ))}
    </div>
  )
}
