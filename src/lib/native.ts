// The device's own features: the share sheet, the clipboard, a haptic tick.
/** A link to `hash` (e.g. `#/KJV/JHN/3/16`) that opens in any browser. */
export function shareLink(hash: string) {
  return `${location.origin}${location.pathname}${hash}`
}

export const canShare = 'share' in navigator

/** Safari on iPhone or iPad (iPads say they're Macs, but have touch). */
export const isIOS = typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export async function share(o: { title: string; text: string; url?: string }) {
  await navigator.share(o).catch(() => {})
}

export async function copyText(s: string) {
  await navigator.clipboard.writeText(s)
}

/** The buzz of a press-and-hold, like holding a key on the iPhone keyboard.
 *  The web has no haptics API on iPhone, but tapping a hidden switch
 *  (iOS 18 and later) gives the same small tick; Android can vibrate. */
let tick: HTMLLabelElement | undefined
export function holdTap() {
  if (navigator.vibrate) {
    navigator.vibrate(12)
  } else {
    if (!tick) {
      tick = document.createElement('label')
      tick.setAttribute('aria-hidden', 'true')
      tick.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none'
      const box = document.createElement('input')
      box.type = 'checkbox'; box.setAttribute('switch', ''); box.tabIndex = -1
      tick.append(box)
      document.body.append(tick)
    }
    tick.click()
  }
}
