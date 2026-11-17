// Apple's and Google's own instructions for putting a web app on a Home
// Screen, in the reader's language. Apple has pages for its own regions only;
// the rest read Apple's English. Used by the app and the welcome page.
const APPLE_REGION: Record<string, string> = {
  fr: 'fr-fr', es: 'es-es', de: 'de-de', it: 'it-it', pt: 'pt-br', nl: 'nl-nl', da: 'da-dk', sv: 'sv-se', nb: 'no-no', fi: 'fi-fi',
  pl: 'pl-pl', cs: 'cs-cz', hu: 'hu-hu', ru: 'ru-ru', uk: 'uk-ua', el: 'el-gr', hr: 'hr-hr', ar: 'ar-ae', he: 'he-il',
  ja: 'ja-jp', ko: 'ko-kr', 'zh-hans': 'zh-cn', 'zh-hant': 'zh-tw', vi: 'vi-vn', id: 'id-id', hi: 'hi-in',
}
export const appleHelp = (lang: string) => `https://support.apple.com/${APPLE_REGION[lang] ? APPLE_REGION[lang] + '/' : ''}guide/iphone/iph42ab2f3a7/ios`
const googleLang = (lang: string) => lang === 'zh-hans' ? 'zh-CN' : lang === 'zh-hant' ? 'zh-TW' : lang
export const google = (platform: 'Android' | 'Desktop', lang: string) => `https://support.google.com/chrome/answer/9658361?hl=${googleLang(lang)}&co=GENIE.Platform%3D${platform}`
