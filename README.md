# Quiet Bible

Live at https://myquietbible.com (formerly Plain Bible, at bible.chama.community).

Just the Bible. Many versions and languages, thorough search, and nothing else:
no reading plans, devotionals, accounts, or feeds.

- **120 versions in 48 languages**, all public domain or openly licensed
  (KJV, Berean Standard Bible, ASV, YLT, Douay-Rheims, Reina-Valera 1909, Luther 1545,
  French (Louis Segond 1910, Martin 1744, Darby, Crampon), Russian Synodal, Chinese Union, Korean, Japanese, Latin Vulgate,
  the Hebrew Westminster Leningrad Codex, Greek New Testaments, and many more).
- **The Ethiopian Orthodox Tewahedo canon**, the widest canon in use, in three languages:
  `EthEn` in English (the King James with the Apocrypha, plus 1 Enoch and Jubilees in
  R. H. Charles' translations), `EthFr` in French (Crampon 1923, Giguet's Septante, and Hénoch),
  and `GEZ`, 25 books in Ge'ez itself from the Beta Masaheft transcriptions. 1 Enoch, Jubilees,
  the Meqabyan and 4 Baruch have their own section in the book picker and answer to
  `in:ethiopian` in search. No openly licensed Amharic Bible was found; the published ones are
  under Bible Society copyright.
- **Strong's numbers** in KJV, BSB, the Hebrew OT (Open Scriptures Hebrew Bible) and the Greek NT
  (Statistical Restoration GNT). Tap a word to see the Hebrew or Greek and its dictionary entry.
- **Search** across one or many versions at once, with a per-book breakdown of results.
- **Always-there search bar** in the style of the iOS search field, pinned while you read. It shows where you
  are, opens to a strip of the book's chapters, and gives instant results as you type, a verse preview when you
  type a reference (English or French book names), recent searches, and voice input where supported.
  Press `/` or Cmd/Ctrl+K to focus it.
- **Tap a verse** to highlight it in one of eight colors, bookmark, copy, share or compare it. Swipe left or right
  to change chapters. Highlights belong to the verse, so they show in every version. Highlights can look like a
  marker pen (default), colored text, or a full block (Settings). Double-tap a verse to highlight it in the last color
  you used (or take the highlight off). Select several verses to write one note on all of them.
- **History button** (top right): one tap goes back to the previous chapter and verse, a second tap brings you back,
  so you can bounce between two passages. Hold it to see your last 3 places. Kept on the device only.
- **Minimal top bar**: history and version. The theme toggle sits in the search bar; Settings and Saved at the bottom of
  the search panel. Settings shows text size, theme and your Bible; everything else is under "More settings". The version
  picker shows the 5 versions you use most, with a search for the rest.
- **Saved** page listing your highlights and bookmarks in Bible order, filterable by color.
- **Import** highlights and saved verses exported from other Bible apps (a .zip, .html or .txt export) or any
  list of references, and back up your data to a JSON file.
- **Reading fonts**: Literata, Source Serif, EB Garamond, Inter, Atkinson Hyperlegible, or the system font.
  Light, dark and sepia themes.
- **Parallel reading** of up to six versions side by side.
- **Works offline** as an installable web app (PWA): the app itself, your Default Bible and any version you open or save are kept on the device. It reopens on the exact verse you were reading. Settings, highlights and bookmarks stay on your device; only passkey sign-in and sync use the network.

## Search syntax

| Query | Finds |
| --- | --- |
| `faith` | the whole word, any case or accent |
| `"in the beginning"` | an exact phrase |
| `faith works` / `faith AND works` | verses with both words |
| `mercy OR grace` / `mercy \| grace` | either word |
| `love -hate` / `love NOT hate` | love but not hate |
| `(mercy OR grace) peace` | grouping |
| `redeem*`, `l?ve` | wildcards |
| `light NEAR/3 darkness` | words at most 3 words apart |
| `H430`, `G26` | a Strong's number |
| `/^And it came to pass/` | a regular expression |
| `kingdom in:gospels` | limit to books: `in:nt`, `in:ot`, `in:john`, `in:gen-deut`, `in:romans,galatians` |
| `John 3:16` | jumps to the passage |

Options: match case, match accents and Hebrew vowel points, match inside words.
Accents and vowel points are ignored by default, so `θεος` finds `Θεὸς` and `אלהים` finds `אֱלֹהִ֑ים`.
Chinese and Japanese text is matched without needing word breaks.

## Optional account sync

Signing in is optional and passkey-only (no email, no password). A small Cloudflare Worker in
[`worker/`](worker) keeps one JSON document per account in D1: highlights, bookmarks and settings.
Each verse keeps its newest change, so edits on two devices merge cleanly.

To turn it on, add two repository secrets: `CLOUDFLARE_API_TOKEN` (an API token from the
"Edit Cloudflare Workers" template plus Account → D1 → Edit) and `CLOUDFLARE_ACCOUNT_ID`.
The next push to `main` creates the database, deploys the Worker and builds the app pointing at it.
Passkeys are tied to the `RP_ID` domain in `worker/wrangler.toml`.

### Moving addresses

The app moved from bible.chama.community to myquietbible.com. Browsers keep each address's
storage and passkeys apart, so the old address shows a "Move" button (`src/move.tsx`,
`src/lib/move.ts`): it packs everything on the device (highlights, notes, settings, history,
prayers and the prayer sync key, plus a fresh sign-in for the same account), encrypts it with a
key that only travels in the move link's `#fragment`, and leaves it with the sync Worker
(`/move`) for 7 days. The new address takes it in from the link, or from "Paste move link"
(iPhone Home Screen apps keep their own storage). A passkey is then saved for the new domain;
the Worker picks the passkey domain from each request's `Origin` (both are in `ORIGINS`).

GitHub Pages serves myquietbible.com; the same build is deployed to Cloudflare Pages
(`scripts/deploy_old_address.sh`, needs the token to have Cloudflare Pages → Edit) for
bible.chama.community until every device has moved.

Local development: `cd worker && npm install && npx wrangler d1 migrations apply plain-bible-sync --local &&
npx wrangler dev --var RP_ID:localhost --var ORIGINS:http://localhost:5173`, then run the app with
`VITE_SYNC_URL=http://localhost:8787 npm run dev`.

## Development

```sh
npm install
npm run data      # downloads source texts into ./sources and builds public/data (~440 MB)
npm run dev
npm test
```

The Bible data is generated, not committed. `scripts/build_data.py` reads:

- [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases): most translations,
  plus KJV, BSB and the Greek NT with Strong's tagging. Only translations whose license is public domain,
  CC0, CC BY, CC BY-SA or GPL are included; non-commercial and no-derivatives licenses are skipped.
- [openscriptures/morphhb](https://github.com/openscriptures/morphhb): Hebrew Bible with Strong's (CC BY 4.0).
- [Beblia/Holy-Bible-XML-Format](https://github.com/Beblia/Holy-Bible-XML-Format): Louis Segond 1910 (public domain).
- [openscriptures/strongs](https://github.com/openscriptures/strongs): Strong's dictionary (CC BY-SA).

## Deploying

`.github/workflows/deploy.yml` builds the data and the app and publishes to GitHub Pages on every push to `main`.
In the repository settings, set **Pages → Source** to **GitHub Actions**, and add a custom domain there if you like.
The app uses relative paths, so it works on a custom domain or under `/plain-bible/`.
