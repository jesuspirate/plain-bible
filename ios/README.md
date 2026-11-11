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
- **Apple Watch:** a 🙏 button on the wrist records a prayer and hands it to
  the app (see below).
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
2. Raise the build number by one for every upload, and the version only for
   a new App Store version. The iPhone app, the watch app and its watch-face
   button must carry the same numbers, so they are set once for all three:
   click **QuietBible** (blue icon, top left) → **QuietBible** under
   *Project* (not under Targets) → **Build Settings** → search "version" →
   **Current Project Version** (the build) and **Marketing Version**.
   Don't change them on a target's General tab: that changes only that one.
3. **Product → Archive**, then **Distribute App → App Store Connect → Distribute**.
4. It shows up in App Store Connect → TestFlight after 5 to 30 minutes.

## Apple Watch

The iPhone app carries a small watch app (`QuietBibleWatch/`): one 🙏 button
that records a spoken prayer, and a 🙏 for the watch face
(`QuietBibleWidgets/`). The watch can't show the website, so this part is
native. It needs watchOS 10 or later.

How a prayer travels:

1. The watch records it (AAC, like the iPhone) and keeps it on the watch.
   A soft tap marks the start, another the end. While recording, the app
   keeps running with the wrist down (a mindfulness session, up to an hour).
2. The watch sends the file to the iPhone app (WatchConnectivity), now or
   whenever the iPhone is next in reach, and then deletes its copy.
3. The iPhone app holds it (`QuietBible/WatchInbox.swift`) until the web app
   is open, which takes it (`src/lib/watch.ts`), keeps it in "Your prayers",
   and tells the iPhone app to delete its copy.

From there it is a prayer like any other: it can be shared with a circle, and
it syncs encrypted if "Sync my prayers" is on. The watch never has the prayer key.

To try it: pick the **QuietBible** scheme and your iPhone, then Run. The watch
app installs on the paired watch by itself (or from the Watch app on the
iPhone → My Quiet Bible → Install). The first time, Xcode asks to register
the watch (and needs Developer Mode on it: watch Settings → Privacy & Security).
With automatic signing, Xcode registers the two extra bundle IDs
(`com.myquietbible.ios.watchkitapp` and `.watchkitapp.widgets`) by itself:
pick the same team on both targets.

For the App Store, a version with a watch app also needs at least one Apple
Watch screenshot in App Store Connect.

Changes to the website reach the app by themselves. Only changes inside `ios/`
need a new upload.

`.github/workflows/ios.yml` checks that the app still builds whenever `ios/`
changes.
