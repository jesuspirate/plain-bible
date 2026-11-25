#!/usr/bin/env bash
# share.myquietbible.com, served from Cloudflare Pages: the link a verse shared
# to Facebook points to, so the post's card shows the verse words
# (worker/src/share.ts). DNS for myquietbible.com is at Njalla, so it needs one
# record there, once: CNAME "share" pointing at the address this prints.
# Needs CLOUDFLARE_API_TOKEN (with Account → Cloudflare Pages → Edit) and
# CLOUDFLARE_ACCOUNT_ID, as scripts/deploy_old_address.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT=myquietbible-share
DOMAIN=share.myquietbible.com
export CI=1
(cd "$ROOT/worker" && npm ci --silent >&2)
W="$ROOT/worker/node_modules/.bin/wrangler"
cd "$(mktemp -d)"
cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT$1" "${@:2}"; }
if ! (cf "" || true) | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.exit(JSON.parse(s).success?0:1)}catch{process.exit(1)}})'; then
  "$W" pages project create "$PROJECT" --production-branch main >&2 || true
fi
# Where verse pictures for link cards are kept: the sync service (set in
# GITHUB_ENV by scripts/deploy_sync.sh). Without it, cards show the lamp.
if [ -n "${VITE_SYNC_URL:-}" ]; then
  printf '// Filled in by scripts/deploy_share.sh.\nexport default %s\n' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$VITE_SYNC_URL")" > "$ROOT/scripts/share-page/cards.js"
fi
"$W" pages deploy "$ROOT/scripts/share-page" --project-name "$PROJECT" --branch main --commit-dirty=true

# Attaching the domain is harmless before DNS points here: it waits as pending.
cf /domains -X POST --data "{\"name\":\"$DOMAIN\"}" > /dev/null || true
sub=$(cf "" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).result.subdomain||"")}catch{}})')
status=$(cf "/domains/$DOMAIN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).result.status||"")}catch{}})')
echo "Share address: point $DOMAIN (CNAME) at ${sub:-$PROJECT.pages.dev}. Domain status: ${status:-unknown}"
