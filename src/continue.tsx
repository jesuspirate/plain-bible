// "Continue at Romans 8": a quiet offer above the bottom bar when another of
// your devices read later than this one. It only offers. Tap it to go there
// (with the search you were stepping through, if any); close it, or turn to
// another chapter here, and it's gone.
import { useEffect, useRef, useState } from 'preact/hooks'
import { answerOffer, continueSearch, type Device, loadPlace, PLACE_EVENT, placeOffer, type SyncedPlace } from './lib/place'
import { formatRef } from './lib/refs'
import { go, resumePath, useApp } from './state'
import { useReadingAloud } from './listen'
import { CloseIcon } from './icons'
import { N_, t } from './i18n'

const FROM: Record<Device, string> = {
  iphone: N_('From your iPhone'), ipad: N_('From your iPad'), mac: N_('From your Mac'),
  android: N_('From your Android phone'), computer: N_('From your computer'),
}

export function ContinueOffer({ mini }: { mini: boolean }) {
  const { byId, settings } = useApp()
  const aloud = useReadingAloud()
  const [offer, setOffer] = useState<SyncedPlace | undefined>(placeOffer)
  // The chapter open here when the offer came up: scrolling down it leaves
  // the offer be, another chapter takes it away.
  const here = useRef('')
  const chapter = () => { const p = loadPlace(); return p ? p.book + ' ' + p.chapter : '' }
  if (offer && !here.current) here.current = chapter()
  useEffect(() => {
    const on = () => setOffer(cur => {
      const fresh = placeOffer()
      if (fresh) { if (fresh.t !== cur?.t) here.current = chapter(); return fresh }
      return cur && placeOffer.answered() < cur.t && here.current === chapter() ? cur : undefined
    })
    addEventListener(PLACE_EVENT, on)
    return () => removeEventListener(PLACE_EVENT, on)
  }, [])
  if (!offer || aloud) return null

  const take = () => {
    answerOffer(offer); setOffer(undefined)
    // In the Bible it was read in, if this device has it; else in yours.
    const version = offer.version && byId.has(offer.version) && (navigator.onLine !== false || offer.version === settings.version) ? offer.version : settings.version
    // The verse that was at the top there, not marked: with a search, the
    // strip lights the result's own verse, and only that one.
    if (offer.s) continueSearch(offer.s)
    go(resumePath(version, offer.book, offer.chapter, offer.verse))
  }
  const place = formatRef({ book: offer.book, chapter: offer.chapter, verse: offer.s ? offer.verse : undefined })
  return (
    <div class={'continue' + (mini ? ' continue-mini' : '')} role="status">
      <button type="button" class="continue-go" onClick={take}>
        <strong>{t('Continue on {place}', { place })}</strong>
        <span>{t(FROM[offer.on])}{offer.s && <> · {t('Search')} “{offer.s.q}”</>}</span>
      </button>
      <button type="button" class="close-btn" aria-label={t('Close')} title={t('Close')} onClick={() => { answerOffer(offer); setOffer(undefined) }}><CloseIcon size={22} /></button>
    </div>
  )
}
