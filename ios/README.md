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
  On a Mac (the app runs there as "Designed for iPad") the web view has no
  passkeys of its own, so `PasskeyBridge.swift` hands the page's passkey
  calls to the system's passkey sheet.
- **Links:** myquietbible.com links (verses, circle invites) open the app
  (`applinks:`). Other sites, the welcome page and the privacy page open in Safari.
- **Prayers:** the microphone is asked for once, by iOS.
- **Downloads** ("Download everything", prayer audio) open the share sheet,
  which has Save to Files.
- **Apple Watch:** a 🙏 button on the wrist records a prayer and hands it to
  the app (see below).
- **Circle notifications** ("Notify me" in a circle) come through Apple's
  own push, because web notifications don't exist inside apps (see below).
- **Left out in the app:** the "help keep the lamp lit" link (Apple doesn't
  allow asking for gifts outside In-App Purchase).

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

## Sending a version to the App Store (without Xcode)

GitHub can build, sign and send the app, so Xcode is not needed:
**Actions → Send to App Store → Run workflow**, type the version (like 1.2),
and about 15 minutes later the build is in App Store Connect → TestFlight.
The build number is set by itself. Then make the version in App Store
Connect, pick the build and submit it, as before.

One-time setup, in App Store Connect with the account holder's sign-in:

1. **Users and Access → Integrations → App Store Connect API → Team Keys →
   +**. Name it "GitHub", access **Admin** (Apple only lets an Admin key
   sign for the App Store), **Generate**.
2. Note the **Issuer ID** (above the list) and the key's **Key ID**, and
   **Download** the `.p8` file. Apple offers that download only once.
3. In the GitHub repository: **Settings → Secrets and variables → Actions →
   New repository secret**, three times: `ASC_KEY_ID`, `ASC_ISSUER_ID`, and
   `ASC_KEY_P8` (open the `.p8` file in TextEdit and paste all of it).

The key can do anything in the Apple account, so it belongs only in those
secrets. If it is ever exposed, revoke it on the same Apple page and make a
new one. `.github/workflows/ios-release.yml` has the details.

## Circle notifications (Apple push)

The web app asks the iPhone app for this phone's push address when "Notify
me" is turned on (`QuietBible/Notify.swift`, `src/lib/nativeNotify.ts`) and
gives it to the sync service, which sends "something new in this circle"
through Apple (`worker/src/apns.ts`). The message carries only the circle's
id. A small extension (`QuietBibleNotify/`) puts the circle's name in on the
phone, from a copy the app keeps in its App Group
(`group.com.myquietbible.ios`, `Shared/SharedCircles.swift`). The Home Screen
widget reads the same copy to show a dot when a circle has something new.

One-time setup, at developer.apple.com with the account holder's sign-in:

1. **Certificates, Identifiers & Profiles → Keys → +**. Name it "Circle
   notifications", tick **Apple Push Notifications service (APNs)**,
   **Continue → Register**.
2. Note the **Key ID** and **Download** the `.p8` file (offered only once).
3. In the GitHub repository: **Settings → Secrets and variables → Actions →
   New repository secret**, twice: `APNS_KEY_ID`, and `APNS_KEY_P8` (open
   the `.p8` file in TextEdit and paste all of it).

The next deploy hands both to the sync service. Until then the switch says
notifications aren't set up yet. This key can only send notifications; it
is not the App Store Connect key above.

The push and App Group capabilities are added to the app's identifiers by
the "Send to App Store" build itself (automatic signing). If that build ever
stops with a message about App Groups, add them by hand: **Identifiers → +
→ App Groups** → `group.com.myquietbible.ios`, then tick **App Groups** (and
pick that group) on `com.myquietbible.ios`, `com.myquietbible.ios.widgets`
and `com.myquietbible.ios.notify`, and run the build again.

## Sending a version from Xcode instead

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
   A soft tap marks the start, another the end. The recording carries on
   with the wrist down (the audio background mode), for up to an hour.
2. The watch sends the file to the iPhone app (WatchConnectivity), now or
   whenever the iPhone is next in reach, and then deletes its copy.
3. The iPhone app holds it (`QuietBible/WatchInbox.swift`) until the web app
   is open, which takes it (`src/lib/watch.ts`), keeps it in "Your prayers",
   and tells the iPhone app to delete its copy.

From there it is a prayer like any other: it can be shared with a circle, and
it syncs encrypted if "Sync my prayers" is on. The watch never has the prayer key.

To try it on a watch:

1. Keep the iPhone plugged in and unlocked, the watch unlocked on the wrist,
   and all three (with the Mac) on the same Wi-Fi, without a VPN.
2. **Window → Devices and Simulators** must show the watch as connected. The
   first time, turn on Developer Mode on the watch (Settings → Privacy &
   Security) and, on the QuietBibleWatch target's Signing page, click
   **Register Device** if Xcode asks.
3. At the top of Xcode pick **QuietBibleWatch** and the watch, then Run.
   This entry runs without the debugger, which would first copy several GB
   of files from the watch.

Running **QuietBible** on the iPhone alone does not put a test build on the
watch. The team is preset in the project for all three targets, and Xcode
registers the two extra bundle IDs (`com.myquietbible.ios.watchkitapp` and
`.watchkitapp.widgets`) by itself.

For the App Store, a version with a watch app also needs at least one Apple
Watch screenshot in App Store Connect.

## Home Screen widgets

`QuietBibleHome/` is the iPhone's widget extension (bundle ID
`com.myquietbible.ios.widgets`, iOS 17 and later; on iOS 16 the app works
as before, only without widgets). It ships inside the app, so there is
nothing to switch on in App Store Connect: the next version uploaded carries it.

- **Pray**: small, and on the Lock Screen. Opens the app on the prayer screen.
- **Circles**: small, and on the Lock Screen. Opens Circles.
- **Pray and Circles**: medium and large, both buttons.

The buttons open `quietbible://pray` and `quietbible://circles`
(`CFBundleURLTypes` in `QuietBible/Info.plist`). The app turns them into the
site's `#/pray` and `#/circles`, over the page being read, without a reload
(`openWidgetLink` in `BibleViewController.swift`). The 🙏 is the plain yellow
one; following the skin tone picked in the app would need an App Group.

To add one on an iPhone: hold an empty spot on the Home Screen, tap **Edit**
→ **Add Widget**, search "Quiet Bible", pick a size.

Changes to the website reach the app by themselves. Only changes inside `ios/`
need a new upload.

`.github/workflows/ios.yml` checks that the app still builds whenever `ios/`
changes. `ios-release.yml` sends it to the App Store when asked.
