# Praying with an Apple Watch (draft)

Status: idea, not built. Start only after the iPhone app is live on the App Store.

## The idea

Raise your wrist, tap 🙏, speak, lower your wrist. The prayer lands in
"Your prayers" on the phone, the same as one recorded in the app. One button,
nothing to read, nothing to scroll. That fits the watch even better than the phone.

## What it could feel like

| Piece | What the person sees | Phase |
|---|---|---|
| Watch app | One big 🙏 button. Tap it to start. A glowing ring while recording, the timer below, a big **Amen** button to finish. Then "Amen. He heard you." | 1 |
| Haptics | A soft tap when recording starts and a double tap when it is saved. No sound. | 1 |
| Complication | A 🙏 on the watch face. One tap opens straight into recording. Also a Smart Stack card. | 1 |
| Siri and shortcuts | "Hey Siri, pray with Quiet Bible" starts a prayer. It also works from the Action button on Apple Watch Ultra and from the Shortcuts app. | 2 |
| Double tap | On watches that have it, pinching the fingers twice finishes the prayer, so the other hand stays free. | 2 |
| Mindful minutes | Opt-in: the time spent praying is saved to Apple Health as Mindful Minutes, so it shows next to breathing sessions. Off unless the person turns it on. | 2 |
| Circles | Notifications from circles reach the wrist, with a 🙏 reaction button ("I prayed for this"). This needs native iPhone notifications first (circle notifications are off in the iPhone app today). | 3 |
| Prayer reminders | Opt-in, chosen by the person (for example "remind me at 7:00"). No suggested schedules or plans, to keep with the app's no-plans rule. | Open question |

Left out on purpose: reading the Bible on the watch (the screen is too small,
and the app is about the phone for reading), streak badges, and anything that
nags.

## What is actually possible

The app today is a web app. The iPhone app is a thin native shell that opens
myquietbible.com in a web view (`ios/`). **The watch cannot do that.** watchOS
has no web view for apps, so a watch app must be written natively in Swift
(SwiftUI). The good news is that the watch part is small: it only records audio
and passes the file on.

How a prayer travels:

1. **Watch** records with `AVAudioRecorder` (AAC in `.m4a`, about 64 kbps, the
   same as the app). It saves the file on the watch first, so nothing is lost
   if the phone is away.
2. **Watch to phone** with WatchConnectivity `transferFile`, along with the
   start time and length. The system queues it and delivers it when the phone
   is in reach, even hours later.
3. **iPhone shell** puts the file in a small inbox folder inside the app.
   The web page is not running in the background, so it cannot take the file
   right away.
4. **Web app** asks the shell on start (and when it comes back to the front):
   "any prayers from the watch?" The shell hands them over through a script
   message bridge (`WKScriptMessageHandler`). The web app saves each one with the
   existing prayer code (`src/lib/prayers.ts`) and then the shell deletes its copy.
5. From there it is a normal prayer: it shows under "Your prayers", can be
   shared with a circle, and syncs end to end encrypted if sync is on. The watch
   never sees the prayer key.

The watch app only works with the App Store iPhone app, not with the Home
Screen web app or Safari. Each keeps its own storage, so a person who prays on
the watch should read in the App Store app.

### What has to be added

- A watchOS app target in `ios/QuietBible.xcodeproj`, bundle ID
  `com.myquietbible.ios.watchkitapp`, shipped inside the iPhone app (one App
  Store listing, one review).
- Watch code: recording screen, complication (WidgetKit), WatchConnectivity.
  Roughly 400 to 600 lines of Swift.
- iPhone shell: WatchConnectivity receiver, inbox folder, and the bridge.
  Roughly 100 lines.
- Web app: about 40 lines that only run inside the iPhone app (checked with
  `inStoreApp()`), loaded lazily. **No added weight and no change for the web
  or Android apps.**
- Words in English, French and Spanish (an Xcode String Catalog).
- Phase 2 only: App Intents (Siri), HealthKit permission and its privacy text.
- App Store: watch screenshots (same leather style), "microphone" and, in phase 2,
  "health" answers in the privacy form.

### Effort

- **Phase 1** (watch app, complication, haptics, hand-off to phone): about a week
  of work, most of it testing on a real watch. Code can be written here; building
  and testing must happen in Xcode on the Mac with an iPhone and a paired watch.
- **Phase 2** (Siri, Action button, double tap, Mindful Minutes): a few more days.
- **Phase 3** (circle notifications on the wrist): depends on native iPhone
  notifications (APNs), which is its own project; the watch then gets them for free.

Limits to know: the Mac mini is short on disk, and a watch simulator plus a
watch build adds a few GB. Watch apps need watchOS 10 or newer (Apple Watch
Series 4 and up).

## Phased plan

1. **Wait** for the iPhone app to be approved. Do not mix this into the first
   submission.
2. **Phase 1**: watch app that records and hands prayers to the phone, with the
   watch-face 🙏. Ship as an iPhone app update.
3. **Phase 2**: Siri, Action button, double tap, opt-in Mindful Minutes.
4. **Phase 3**: native notifications for circles, which also reach the watch.

## Open questions

- Is there an Apple Watch to test on, and which model? (Double tap needs Series 9
  or Ultra 2 and later; the Action button is Ultra only.)
- Should prayers recorded on the watch be marked "from the watch" in the list?
- Mindful Minutes: worth it, or does it feel like turning prayer into a statistic?
- Reminders: wanted at all? If yes, only times the person picks.
- Should the watch play back a prayer, or keep it record-only to stay simple?
- Wear OS (Android watches) later? Same shape, but a separate native app.
