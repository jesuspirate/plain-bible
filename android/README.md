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
