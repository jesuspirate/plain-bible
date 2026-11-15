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
  (cd deuterocanonical && git sparse-checkout set --no-cone '/sources/en/book-of-jubilees/*.json')
fi
# Ge'ez (Ethiopic) scripture, from Beta Masaheft TEI transcriptions (CC BY-SA 4.0).
[ -d ethiopian-bible ] || git clone --depth 1 https://github.com/LPettay/ethiopian-bible.git

mkdir -p beblia
for f in FrenchBible; do
  [ -f beblia/$f.xml ] || curl -fsSL -o beblia/$f.xml https://raw.githubusercontent.com/Beblia/Holy-Bible-XML-Format/master/$f.xml
done

# Openly licensed Bibles from eBible.org (their own USFM downloads), and the
# Paratext verse-numbering files that line them up with the KJV's numbering
# (from github.com/BibleNLP/ebible, pinned so a rebuild reads the same).
mkdir -p ebible
VRS=https://raw.githubusercontent.com/BibleNLP/ebible/2bde52b4c2cfd7056cf4ed07c48969647df79744/metadata
for f in eng.vrs org.vrs; do
  [ -f ebible/$f ] || curl -fsSL -o ebible/$f $VRS/$f
done
for id in swhonen swhulb arbnav arb-vd cmn-cu89s hincv hin2017 benirv pan guj2017 mar tel2017 \
  tam2017 kanokcv ory asmfb npiulb pesopcb pesOPV heb ita1927 ita1885 ind hausa yor ibo gaz nya \
  sna lin lug kik luo twi twiasante ewe nde ckb uigara haw1868 ton iloulb; do
  # One Bible that can't be had today must not stop the others: it is left
  # out of this build (build_data.py says so) and tried again next time.
  [ -f ebible/${id}_usfm.zip ] || curl -fsSL --retry 3 -o ebible/${id}_usfm.zip https://ebible.org/Scriptures/${id}_usfm.zip \
    || { echo "could not download $id from eBible.org" >&2; rm -f ebible/${id}_usfm.zip; }
done
