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

const APP_STORE = 'https://apps.apple.com/app/my-quiet-bible/id6831915876'
const APPLE_LOGO = 'M16.37 12.6c-.02-2.33 1.9-3.45 1.99-3.5-1.08-1.59-2.77-1.8-3.37-1.83-1.43-.15-2.8.84-3.53.84-.73 0-1.85-.82-3.04-.8-1.57.02-3.01.91-3.82 2.31-1.63 2.82-.42 7 1.17 9.29.78 1.12 1.7 2.38 2.91 2.33 1.17-.05 1.61-.75 3.02-.75 1.41 0 1.81.75 3.04.73 1.26-.02 2.05-1.14 2.82-2.27.89-1.3 1.25-2.56 1.27-2.62-.03-.01-2.44-.94-2.46-3.73zM14.06 5.75c.64-.78 1.08-1.86.96-2.94-.93.04-2.05.62-2.72 1.4-.6.69-1.12 1.79-.98 2.85 1.04.08 2.1-.53 2.74-1.31z'

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
    // As Chrome draws it: ⋮, Install and create shortcut, then Install
    // (Create shortcut only opens the site in Chrome), then Install again.
    tj('Tap the menu {icon} at the top right.', { icon: <MenuGlyph /> }),
    tj('Tap {install}. Some browsers say {add}.', { install: <strong>{t('Install and create shortcut')}</strong>, add: <strong>{t('Add to Home screen')}</strong> }),
    tj('Choose {install}, not {shortcut}. Then tap {install} again. The lamp appears with your other apps.', { install: <strong>{t('Install')}</strong>, shortcut: <strong>{t('Create shortcut')}</strong> }),
  ] : [
    t('In Chrome or Edge, click the install icon at the right end of the address bar.'),
    tj('In Safari on a Mac: click {share} at the top right, then {dock}.', { share: <strong class="nb">{t('Share')} <ShareGlyph /></strong>, dock: <strong>{t('Add to Dock')}</strong> }),
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
        {/* The same Bible from the App Store (ios/), for whoever would rather. */}
        {iphone && !oneTap && <a class="hs-store" href={APP_STORE} target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={APPLE_LOGO} /></svg>
          <span><small>{t('Download on the')}</small> App Store</span>
        </a>}
        <a class="hs-help" href={help.href} target="_blank" rel="noopener">{help.label} ↗</a>
        {oneTap
          ? <button class="hs-btn" onClick={onClose}>{t('Not now')}</button>
          : <button ref={main} class="hs-btn" onClick={onClose}>{t('OK')}</button>}
      </div>
    </div>
  )
}
