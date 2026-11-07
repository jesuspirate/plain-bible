# My Quiet Bible for iPhone and iPad

A small native app that shows https://myquietbible.com in its own window,
exactly like the web app on a Home Screen. Nothing of the web app is copied
in, so the App Store app is always the same version as the website, and the
web app carries no extra weight for it.

- **Offline:** the site's own service worker runs in the app (the site is an
  app-bound domain, `WKAppBoundDomains` in `Info.plist`), so after the first
  start it opens without a connection, like the Home Screen app.
- **Passkeys:** the app and the site vouch for each other through
  `webcredentials:myquietbible.com`, so the same passkeys sign in.
- **Links:** myquietbible.com links (verses, circle invites) open the app
  (`applinks:`). Other sites, the welcome page and the privacy page open in Safari.
- **Prayers:** the microphone is asked for once, by iOS.
- **Downloads** ("Download everything", prayer audio) open the share sheet,
  which has Save to Files.
- **Left out in the app:** the "help keep the lamp lit" link (Apple doesn't
  allow asking for gifts outside In-App Purchase) and circle notifications
  (web notifications don't exist in apps; they would need Apple's own push).

The web app spots the app by `QuietBibleApp/` in its user agent
(`inStoreApp()` in `src/lib/install.ts`), and the app sets
`navigator.standalone`, so everything else behaves as on a Home Screen.

## One-time setup

1. In the GitHub repository: **Settings → Secrets and variables → Actions →
   Variables → New repository variable**, name `APPLE_TEAM_ID`, value the
   10-character Team ID from developer.apple.com → Account → Membership.
   The next deploy publishes `/.well-known/apple-app-site-association`, which
   passkeys and links in the app need.
2. Open `ios/QuietBible.xcodeproj` in Xcode (16 or later).
3. Click **QuietBible** (blue icon, top left) → target **QuietBible** →
   **Signing & Capabilities** → pick the team. The bundle ID is
   `com.myquietbible.ios`; Xcode registers it.

## Sending a version to the App Store

1. In Xcode, pick **Any iOS Device (arm64)** at the top.
2. Raise **Build** (same Signing page, General tab) by one for every upload.
   Raise **Version** (1.0 → 1.1) only for a new App Store version.
3. **Product → Archive**, then **Distribute App → App Store Connect → Distribute**.
4. It shows up in App Store Connect → TestFlight after 5 to 30 minutes.

Changes to the website reach the app by themselves. Only changes inside `ios/`
need a new upload.

`.github/workflows/ios.yml` checks that the app still builds whenever `ios/`
changes.
