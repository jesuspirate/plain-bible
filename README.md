# Plain Bible

Just the Bible. Many versions and languages, thorough search, and nothing else:
no reading plans, devotionals, accounts, or feeds.

- **116 versions in 48 languages**, all public domain or openly licensed
  (KJV, Berean Standard Bible, ASV, YLT, Douay-Rheims, Reina-Valera 1909, Luther 1545,
  French (Louis Segond 1910, Martin 1744, Darby, Crampon), Russian Synodal, Chinese Union, Korean, Japanese, Latin Vulgate,
  the Hebrew Westminster Leningrad Codex, Greek New Testaments, and many more).
- **Strong's numbers** in KJV, BSB, the Hebrew OT (Open Scriptures Hebrew Bible) and the Greek NT
  (Statistical Restoration GNT). Tap a word to see the Hebrew or Greek and its dictionary entry.
- **Search** across one or many versions at once, with a per-book breakdown of results.
- **Always-there search bar** in the style of the iOS search field, pinned while you read. It shows where you
  are, opens to a strip of the book's chapters, and gives instant results as you type, a verse preview when you
  type a reference (English or French book names), recent searches, and voice input where supported.
  Press `/` or Cmd/Ctrl+K to focus it.
- **Tap a verse** to highlight it in one of eight colors, bookmark, copy, share or compare it. Swipe left or right
  to change chapters. Highlights belong to the verse, so they show in every version.
- **Saved** page listing your highlights and bookmarks in Bible order, filterable by color.
- **Import** highlights and saved verses from a Life Bible export (the whole .zip or a single .html file) or any
  list of references, and back up your data to a JSON file.
- **Reading fonts**: Literata, Source Serif, EB Garamond, Inter, Atkinson Hyperlegible, or the system font.
  Light, dark and sepia themes.
- **Parallel reading** of up to six versions side by side.
- **Works offline** as an installable web app (PWA). Settings, highlights and bookmarks stay on your device.

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
