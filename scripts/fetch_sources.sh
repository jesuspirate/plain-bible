#!/usr/bin/env bash
# Download the openly licensed source texts into ./sources (not committed).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p sources && cd sources

if [ ! -d bible_databases ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/scrollmapper/bible_databases.git
  (cd bible_databases && git sparse-checkout set --no-cone '/sources/*/*/README.md' '/formats/json/*.json' \
    '/sources/en/KJV/KJV-osis.json' '/sources/en/BSB/BSB-osis.json' '/sources/grc/StatResGNT/StatResGNT-osis.json')
fi
[ -d morphhb ] || git clone --depth 1 https://github.com/openscriptures/morphhb.git
if [ ! -d strongs ]; then
  mkdir strongs
  base=https://raw.githubusercontent.com/openscriptures/strongs/master
  curl -fsSL -o strongs/strongs-hebrew-dictionary.js $base/hebrew/strongs-hebrew-dictionary.js
  curl -fsSL -o strongs/strongs-greek-dictionary.js $base/greek/strongs-greek-dictionary.js
fi
if [ ! -d deuterocanonical ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/scrollmapper/bible_databases_deuterocanonical.git deuterocanonical
  (cd deuterocanonical && git sparse-checkout set --no-cone '/sources/en/1-enoch/*.json' '/sources/en/book-of-jubilees/*.json' \
    '/sources/en/4-baruch/*.json')
fi
# Ge'ez (Ethiopic) scripture, from Beta Masaheft TEI transcriptions (CC BY-SA 4.0).
[ -d ethiopian-bible ] || git clone --depth 1 https://github.com/LPettay/ethiopian-bible.git

mkdir -p beblia
for f in FrenchBible; do
  [ -f beblia/$f.xml ] || curl -fsSL -o beblia/$f.xml https://raw.githubusercontent.com/Beblia/Holy-Bible-XML-Format/master/$f.xml
done
