# My Quiet Bible on Google Play

This folder is the Google Play app: a Trusted Web Activity, made with
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap). It opens
https://myquietbible.com full screen in the phone's Chrome, so it is the very
same Bible: offline, notifications for circles, passkeys, everything. A change
to the site reaches the Play app at once; the app only needs a new upload when
this folder changes.

- Package name: `com.myquietbible.app` (permanent once published)
- Launcher name: Quiet Bible

## Building

`.github/workflows/android.yml` does it on GitHub, no Android Studio needed.
Actions → Android app → Run workflow:

1. Add the repository secret `ANDROID_KEY_PASSWORD`: a long password you
   choose. Keep it in your password manager.
2. Run **Make upload key**. Download `upload-key` from the run (it is kept one
   day). Keep `upload.keystore` with the password. Paste the text of
   `upload.keystore.base64.txt` into a new secret `ANDROID_KEYSTORE_BASE64`.
3. Run **Build for Google Play**. Download the `.aab` from the run and upload
   it in Play Console. Each run gets a higher version number by itself.

With Play App Signing (the default), Google keeps the key that signs the app
for phones. The upload key only proves an upload came from you; if it is ever
lost, Play Console can reset it.

## Linking the app to the site

Android opens the app without an address bar only when the site lists the
app's signing key. Copy the SHA-256 fingerprint(s) from Play Console → Test
and release → App integrity → App signing (the app signing key, and the upload
key if you like), and put them in the repository variable
`ANDROID_CERT_SHA256`, separated by spaces. The next deploy writes
`/.well-known/assetlinks.json` (`scripts/assetlinks.sh`).

## Changing the app

`twa-manifest.json` holds the settings. After editing it, run
`npx @bubblewrap/cli update --skipVersionUpgrade` here to regenerate the
project (then put back the signing and version lines in `app/build.gradle`).

## Icon and launch screen

The home screen icon and the launch screen are drawn by hand, not by
Bubblewrap: the lamp with no square tile, on leather brown (ink in dark mode).

- `res/mipmap-anydpi-v26/ic_launcher.xml` + `res/drawable/ic_launcher_foreground.xml`:
  the icon (lamp inside the safe circle, ink background, themed-icon layer).
- `res/values-v31/styles.xml` + `res/drawable/splash_icon.xml`: Android 12+'s
  own launch screen.
- `res/drawable-*/splash.png` (light) and `res/drawable-night-*/splash.png`
  (dark): the splash Chrome shows next, the same lamp at the same size.
- Colours: `res/values/colors.xml`, `res/values-night/colors.xml`, and
  `backgroundColor` in `app/build.gradle`.

`bubblewrap update` overwrites the icon and splash files, so put these back
after running it.
