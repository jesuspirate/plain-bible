# Plain Bible for iOS

The App Store version is the same app as the website, in a native shell
([Capacitor](https://capacitorjs.com)). What it adds over the web version:

- The most used versions ship inside the app (see `scripts/ios_bundle.py`), so
  it reads offline from the first launch. Every other version downloads once,
  from the Versions page or the first time you open it, and stays on the phone.
- The iOS share sheet, haptic taps when highlighting or copying, a status bar
  that follows the theme, and a launch screen.
- Passkey sign-in with the same passkeys as the website (associated domains).

GPL-licensed texts are left out of the app build, since the GPL's terms don't
fit App Store distribution. They stay on the website.

## Building without a Mac

The **iOS app** workflow in GitHub Actions builds on GitHub's Macs.

- Every pull request that touches the app does a test build (no Apple account needed).
- Actions → **iOS app** → **Run workflow** signs the app and uploads it to
  App Store Connect, where it appears in TestFlight. Apple keeps the signing
  certificates (cloud signing), so the only things to store are below.

## One-time Apple setup

1. **Join the Apple Developer Program** ($99/year) at
   <https://developer.apple.com/programs/enroll/>. Enrolling as an individual
   is quickest (your name shows as the seller); an organization needs a D-U-N-S number.
2. **Note your Team ID**: <https://developer.apple.com/account> → Membership details.
3. **Register the App ID**: Certificates, Identifiers & Profiles → Identifiers → **+** →
   App IDs → App. Bundle ID (explicit): `community.chama.plainbible`. Tick
   **Associated Domains**. Save.
4. **Create the app** in <https://appstoreconnect.apple.com> → Apps → **+** → New App:
   iOS, name "Plain Bible" (or another available name), the bundle ID above,
   SKU `plainbible`.
5. **Create an API key**: App Store Connect → Users and Access → Integrations →
   App Store Connect API → **+**. Access: **Admin** (needed for cloud signing).
   Download the `.p8` file (only possible once) and note the Key ID and Issuer ID.
6. **Add them to GitHub**: repository Settings → Secrets and variables → Actions.
   - Variable `APPLE_TEAM_ID`: your Team ID.
   - Secret `ASC_KEY_ID`: the Key ID.
   - Secret `ASC_ISSUER_ID`: the Issuer ID.
   - Secret `ASC_KEY_P8`: the whole contents of the `.p8` file.

   With `APPLE_TEAM_ID` set, the next website deploy also publishes
   `/.well-known/apple-app-site-association`, which lets the app use the site's passkeys.
7. **Paid app**: App Store Connect → Business → sign the **Paid Apps** agreement
   and add bank and tax details. Then in the app's Pricing and Availability, pick $1.99.

Then run the workflow. The build shows up in TestFlight in about 15 minutes.

## Submitting

App Store Connect needs, once:

- Screenshots (6.9" iPhone, and 13" iPad since the app runs on iPad).
- Description, keywords, support URL (`https://bible.chama.community`) and
  privacy policy URL (`https://bible.chama.community/privacy.html`).
- App Privacy: "Data not collected" except, if you count optional sync, "User
  Content" (highlights and bookmarks) linked to the user, not used for tracking.
- Age rating questionnaire (all "None"), category Reference or Books.

## Working on it with a Mac (optional)

```sh
npm install
npm run data
bash scripts/build_ios.sh
open ios/App/App.xcodeproj
```
