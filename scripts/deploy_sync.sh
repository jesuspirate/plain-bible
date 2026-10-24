#!/usr/bin/env bash
# Deploy the optional sync service (worker/) to Cloudflare: creates the D1
# database on first run, applies migrations, deploys the Worker, and prints
# VITE_SYNC_URL=<url> for the app build. Needs CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID in the environment; RESEND_API_KEY turns on email sign-in.
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

# Email sign-in: on once RESEND_API_KEY is a repository secret. EMAIL_SECRET
# (the key for email fingerprints) is made once and then never changed, or
# no one could sign in by email again.
if [ -n "${RESEND_API_KEY:-}" ]; then
  secrets=$(npx wrangler secret list 2>/dev/null || echo '[]')
  printf '%s' "$RESEND_API_KEY" | npx wrangler secret put RESEND_API_KEY >&2
  if ! echo "$secrets" | grep -q '"EMAIL_SECRET"'; then
    openssl rand -base64 32 | tr -d '\n' | npx wrangler secret put EMAIL_SECRET >&2
  fi
fi
url=$(echo "$out" | grep -oE 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -1)
if [ -z "$url" ]; then
  echo "Deployed, but no workers.dev URL was printed. Is the workers.dev subdomain set up in the Cloudflare dashboard?" >&2
  exit 1
fi
echo "VITE_SYNC_URL=$url"
