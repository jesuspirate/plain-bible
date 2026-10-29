// "Put it on your Home Screen": a calm card for someone reading in a phone's
// browser. On Android (Chrome, Edge, Samsung Internet) one button installs it;
// on an iPhone, which can't be asked, three short steps with the same
// pictures Safari shows, and Apple's own page for the rest. Loaded only when it opens.
import { useEffect, useRef, useState } from 'preact/hooks'
import { currentLang, t, tj } from './i18n'
import { CloseIcon } from './icons'
import { canInstall, INSTALL_EVENT, installNow, installed, isAndroid, isIPhone } from './lib/install'
import './install.css'

// Apple's and Google's own instructions, in the reader's language.
const APPLE = { en: 'https://support.apple.com/guide/iphone/iph42ab2f3a7/ios', fr: 'https://support.apple.com/fr-fr/guide/iphone/iph42ab2f3a7/ios', es: 'https://support.apple.com/es-es/guide/iphone/iph42ab2f3a7/ios' }
const google = (platform: 'Android' | 'Desktop', lang: string) => `https://support.google.com/chrome/answer/9658361?hl=${lang}&co=GENIE.Platform%3D${platform}`

const ShareGlyph = () => <svg class="hs-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
const AddGlyph = () => <svg class="hs-glyph" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="2.2" /><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
const PageMenuGlyph = () => <svg class="hs-glyph hs-boxed" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M7 12h10M9 17h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
const ChevronGlyph = () => <svg class="hs-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
const MenuGlyph = () => <svg class="hs-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2.2" fill="currentColor" /><circle cx="12" cy="12" r="2.2" fill="currentColor" /><circle cx="12" cy="19" r="2.2" fill="currentColor" /></svg>

export function HomeScreen({ onClose }: { onClose: () => void }) {
  const [oneTap, setOneTap] = useState(canInstall)
  const [busy, setBusy] = useState(false)
  const main = useRef<HTMLButtonElement>(null)
  const lang = (['fr', 'es'].includes(currentLang()) ? currentLang() : 'en') as 'en' | 'fr' | 'es'
  const iphone = isIPhone(), android = isAndroid()

  useEffect(() => {
    main.current?.focus({ preventScroll: true })
    const on = () => { setOneTap(canInstall()); if (installed()) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    addEventListener(INSTALL_EVENT, on)
    addEventListener('keydown', key, true)
    return () => { removeEventListener(INSTALL_EVENT, on); removeEventListener('keydown', key, true) }
  }, [])

  const install = async () => {
    setBusy(true)
    try { if (await installNow()) onClose() } catch { /* the steps below still work */ }
    setBusy(false)
  }

  // As Safari draws it (iOS 26): the page menu in the address bar, Share,
  // View More, Add to Home Screen, then Add with Open as Web App left on.
  const steps = iphone ? [
    tj('Tap {menu} in the address bar, then {share}.', { menu: <PageMenuGlyph />, share: <strong class="nb">{t('Share')} <ShareGlyph /></strong> }),
    tj('Tap {more}, then {add}.', { more: <strong class="nb">{t('View More')} <ChevronGlyph /></strong>, add: <strong class="nb">{t('Add to Home Screen')} <AddGlyph /></strong> }),
    tj('Leave {webApp} on and tap {add}. The lamp appears on your Home Screen.', { webApp: <strong>{t('Open as Web App')}</strong>, add: <strong>{t('Add')}</strong> }),
  ] : android ? [
    tj('Tap the browser’s menu {icon}.', { icon: <MenuGlyph /> }),
    tj('Tap {install} or {add}.', { install: <strong>{t('Install app')}</strong>, add: <strong>{t('Add to Home screen')}</strong> }),
    t('Tap Install. The lamp appears with your other apps.'),
  ] : [
    t('In Chrome or Edge, click the install icon at the right end of the address bar.'),
    tj('In Safari on a Mac: {file}, then {dock}.', { file: <strong>{t('File')}</strong>, dock: <strong>{t('Add to Dock')}</strong> }),
  ]
  const help = iphone ? { href: APPLE[lang], label: t('Apple’s instructions') }
    : { href: google(android ? 'Android' : 'Desktop', lang), label: t('Google’s instructions') }

  return (
    <div class="hs" role="dialog" aria-modal="true" aria-labelledby="hs-title">
      <div class="hs-dim" onClick={onClose} />
      <div class="hs-card">
        <div class="hs-top">
          <img class="hs-icon" src="icon-192.png" alt="" width="56" height="56" />
          <h2 id="hs-title">{iphone || android ? t('Put it on your Home Screen') : t('Install it as an app')}</h2>
          <button class="close-btn" aria-label={t('Close')} title={t('Close')} onClick={onClose}><CloseIcon size={22} /></button>
        </div>
        <p class="hs-why">{t('It opens like any other app, full screen, and works with no connection.')}</p>
        {oneTap
          ? <button ref={main} class="primary hs-btn" disabled={busy} onClick={install}>{t('Install My Quiet Bible')}</button>
          : <ol class="hs-steps">{steps.map((s, i) => <li key={i}><span class="hs-n" aria-hidden="true">{i + 1}</span><span>{s}</span></li>)}</ol>}
        {iphone && !oneTap && <p class="hs-note">{tj('On older iPhones, {share} is right in the bar at the bottom.', { share: <strong class="nb">{t('Share')} <ShareGlyph /></strong> })}</p>}
        <a class="hs-help" href={help.href} target="_blank" rel="noopener">{help.label} ↗</a>
        {oneTap
          ? <button class="hs-btn" onClick={onClose}>{t('Not now')}</button>
          : <button ref={main} class="hs-btn" onClick={onClose}>{t('OK')}</button>}
      </div>
    </div>
  )
}
