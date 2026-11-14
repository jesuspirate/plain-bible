#!/usr/bin/env bash
# Download the Wiktionary extracts the word dictionaries are built from
# (scripts/build_dict.py) into ./sources/dict (not committed). About 1 GB.
# Wiktionary text is CC BY-SA 4.0; the extracts are made by Wiktextract and
# published at kaikki.org.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p sources/dict && cd sources/dict
get() { [ -f "$1.jsonl.gz" ] || curl -fL --retry 3 -o "$1.jsonl.gz" "$2"; }
get en "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz"
get fr "https://kaikki.org/frwiktionary/Fran%C3%A7ais/kaikki.org-dictionary-Fran%C3%A7ais.jsonl.gz"
get es "https://kaikki.org/eswiktionary/Espa%C3%B1ol/kaikki.org-dictionary-Espa%C3%B1ol.jsonl.gz"
