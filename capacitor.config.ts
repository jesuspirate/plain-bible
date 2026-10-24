// The iOS app: the same web app, built with scripts/build_ios.sh and
// wrapped in a native shell. See ios/README.md.
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'community.chama.plainbible',
  appName: 'Plain Bible',
  webDir: 'dist',
  ios: {
    // The app draws its own safe areas (viewport-fit=cover), like the PWA.
    contentInset: 'never',
    backgroundColor: '#f4ecd8',
    scheme: 'Plain Bible',
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#f4ecd8',
      showSpinner: false,
    },
    CapacitorPasskey: {
      // Passkeys belong to the website, so the same passkey signs in on the
      // web and in the app. Needs the website's apple-app-site-association.
      origin: 'https://bible.chama.community',
      domains: ['bible.chama.community'],
    },
  },
}

export default config
