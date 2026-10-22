"""Trim the web build for the iOS app.

The website offers every version; the app ships the most used ones inside it
(so it works offline from the first launch) and downloads the rest on demand.
GPL-licensed files are left out of the app, since the GPL's terms don't fit
App Store distribution. The KJV's words are public domain; only the Strong's
tagging in that edition is GPL, so the app gets the KJV text without the tags.
Everything public domain or Creative Commons stays as on the website.
"""
import json, os, re, sys

# Versions that ship inside the app. Others download once from the website.
BUNDLED = [
    "KJV", "BSB", "NHEB", "ASV", "YLT", "DRC",
    "LSG", "SpaRV", "GerElb1905", "PorBLivre", "ChiUn", "KorRV", "RusSynodal",
    "OSHB", "StatResGNT",
]
# GPL editions of public domain texts: shipped with the tags stripped.
UNTAG = {"KJV", "KJVA"}
TAG = re.compile(r"\{([^{}|]*)\|[^{}]*\}")

dist = sys.argv[1] if len(sys.argv) > 1 else "dist"
data = os.path.join(dist, "data")
path = os.path.join(data, "catalog.json")
catalog = json.load(open(path, encoding="utf-8"))

kept = []
for t in catalog["translations"]:
    if "gpl" in t["license"].lower():
        if t["id"] not in UNTAG:
            continue
        f = os.path.join(data, "bibles", t["id"] + ".json")
        bible = json.load(open(f, encoding="utf-8"))
        for chapters in bible["books"].values():
            for ch in chapters:
                ch[:] = [TAG.sub(r"\1", v) for v in ch]
        json.dump(bible, open(f, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        t["strongs"] = False
        t["license"] = "Public Domain"
    if t["id"] in BUNDLED:
        t["bundled"] = True
    kept.append(t)
catalog["translations"] = kept
json.dump(catalog, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

missing = [i for i in BUNDLED if not any(t["id"] == i for t in kept)]
if missing:
    print("warning: not in the catalog:", ", ".join(missing), file=sys.stderr)

size = 0
for f in os.listdir(os.path.join(data, "bibles")):
    p = os.path.join(data, "bibles", f)
    if f.removesuffix(".json") in BUNDLED:
        size += os.path.getsize(p)
    else:
        os.remove(p)
# The service worker is for the website only.
for f in ("sw.js", "registerSW.js", "manifest.webmanifest"):
    if os.path.exists(os.path.join(dist, f)):
        os.remove(os.path.join(dist, f))
for f in os.listdir(dist):
    if f.startswith("workbox-"):
        os.remove(os.path.join(dist, f))
built_in = sum(1 for t in kept if t.get("bundled"))
print(f"iOS app: {len(kept)} versions, {built_in} built in ({size / 1e6:.0f} MB of text), the rest download on demand")
