#!/usr/bin/env bash
# Deploy the optional sync service (worker/) to Cloudflare: creates the D1
# database on first run, applies migrations, deploys the Worker, and prints
# VITE_SYNC_URL=<url> for the app build. Needs CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID in the environment.
set -euo pipefail
cd "$(dirname "$0")/../worker"
export CI=1
DB=plain-bible-sync
npm ci --silent >&2

db_id() { npx wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(d=>d.name===process.argv[1]);process.stdout.write(r?r.uuid:"")})' "$DB"; }
id=$(db_id)
if [ -z "$id" ]; then
  npx wrangler d1 create "$DB" >&2
  id=$(db_id)
fi
sed -i "s/^database_id = .*/database_id = \"$id\"/" wrangler.toml

npx wrangler d1 migrations apply "$DB" --remote >&2
out=$(npx wrangler deploy 2>&1) || { echo "$out" >&2; exit 1; }
echo "$out" >&2
url=$(echo "$out" | grep -oE 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -1)
if [ -z "$url" ]; then
  echo "Deployed, but no workers.dev URL was printed. Is the workers.dev subdomain set up in the Cloudflare dashboard?" >&2
  exit 1
fi
echo "VITE_SYNC_URL=$url"
