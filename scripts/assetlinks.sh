#!/usr/bin/env bash
# Writes dist/.well-known/assetlinks.json, the file that tells Android the
# Play Store app (com.myquietbible.app) belongs to myquietbible.com. With it
# the app opens full screen with no address bar, and shares passkeys with
# the site. It lists the SHA-256 fingerprints of the keys that sign the app,
# from the repository variable ANDROID_CERT_SHA256 (Play Console → Test and
# release → App integrity → App signing; several can be separated by spaces
# or commas). Without the variable no file is written.
set -euo pipefail
fingerprints="${ANDROID_CERT_SHA256:-}"
[ -z "$fingerprints" ] && exit 0
mkdir -p dist/.well-known
FPS="$fingerprints" python3 - <<'PY'
import json, os, re
fps = [f.upper() for f in re.split(r'[\s,]+', os.environ['FPS']) if f]
for f in fps:
    if not re.fullmatch(r'([0-9A-F]{2}:){31}[0-9A-F]{2}', f):
        raise SystemExit(f'Not a SHA-256 fingerprint: {f}')
statement = [{
    'relation': ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
    'target': {'namespace': 'android_app', 'package_name': 'com.myquietbible.app', 'sha256_cert_fingerprints': fps},
}]
with open('dist/.well-known/assetlinks.json', 'w') as out:
    json.dump(statement, out, indent=2)
print(f'assetlinks.json written with {len(fps)} fingerprint(s)')
PY
