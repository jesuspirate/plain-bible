#!/usr/bin/env bash
# Serve the same build at the old address, bible.chama.community, from
# Cloudflare Pages, so GitHub Pages can serve the new main address
# (myquietbible.com) and devices that haven't moved yet keep working.
# Needs CLOUDFLARE_API_TOKEN (with Account → Cloudflare Pages → Edit) and
# CLOUDFLARE_ACCOUNT_ID. Run after `npm run build`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT=plain-bible
DOMAIN=bible.chama.community
export CI=1
(cd "$ROOT/worker" && npm ci --silent >&2)
W="$ROOT/worker/node_modules/.bin/wrangler"
# Away from worker/wrangler.toml, which describes the sync Worker, not this.
cd "$(mktemp -d)"
"$W" pages project create "$PROJECT" --production-branch main >&2 || true
"$W" pages deploy "$ROOT/dist" --project-name "$PROJECT" --branch main --commit-dirty=true

cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT$1" "${@:2}"; }
# Attaching the domain is harmless before DNS points here: it waits as pending.
cf /domains -X POST --data "{\"name\":\"$DOMAIN\"}" > /dev/null || true
sub=$(cf "" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).result.subdomain||"")}catch{}})')
status=$(cf "/domains/$DOMAIN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).result.status||"")}catch{}})')
echo "Old address: point $DOMAIN (CNAME) at ${sub:-<project>.pages.dev}. Domain status: ${status:-unknown}"
