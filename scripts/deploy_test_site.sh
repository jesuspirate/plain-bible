#!/usr/bin/env bash
# The test site: every pull request is built and put at its own address,
# https://pr-<number>.<project>.pages.dev (Cloudflare Pages), to try on a
# phone before it reaches anyone. myquietbible.com never changes until the
# pull request is merged.
#
# Kept apart from the real app on purpose:
#  - another address, so the phone keeps its own storage for it: prayers,
#    highlights and settings on the test site never mix with the real ones;
#  - its own sync service and database (plain-bible-sync-test), so test
#    accounts, circles and usage counts never touch the real ones;
#  - hidden from search engines (robots.txt here, and Cloudflare marks every
#    preview address noindex).
#
#   deploy_test_site.sh sync        before the app build: prints VITE_* lines
#   deploy_test_site.sh site <pr>   after it: puts dist/ up, prints url=<address>
#
# Needs CLOUDFLARE_API_TOKEN (Pages and Workers edit, as the other deploys)
# and CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT=myquietbible-test
export CI=1

cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJECT$1" "${@:2}"; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);process.stdout.write(r.success?String(r.result[process.argv[1]]??""):"")}catch{}})' "$1"; }
wr() { (cd "$ROOT/worker" && npm ci --silent >&2) && "$ROOT/worker/node_modules/.bin/wrangler" "$@"; }

case "${1:-}" in
  sync)
    sub=$(cf "" | field subdomain)
    if [ -z "$sub" ]; then
      # Made once. Its "production" branch is one nothing is ever sent to, so
      # every address is a preview (marked noindex by Cloudflare).
      (cd "$(mktemp -d)" && wr pages project create "$PROJECT" --production-branch never-live >&2) || true
      sub=$(cf "" | field subdomain)
    fi
    [ -n "$sub" ] || { echo "No Pages project $PROJECT." >&2; exit 1; }
    SYNC_NAME=plain-bible-sync-test SYNC_ORIGINS="https://*.$sub" bash "$ROOT/scripts/deploy_sync.sh"
    echo "VITE_TEST_SITE=1"
    echo "TEST_SITE_DOMAIN=$sub"
    ;;
  site)
    pr=${2:?pull request number}
    dist="$ROOT/dist"
    printf 'User-agent: *\nDisallow: /\n' > "$dist/robots.txt"
    rm -f "$dist/sitemap.xml"
    # Away from worker/wrangler.toml, which describes the sync Worker, not this.
    out=$(cd "$(mktemp -d)" && wr pages deploy "$dist" --project-name "$PROJECT" --branch "pr-$pr" --commit-dirty=true 2>&1) || { echo "$out" >&2; exit 1; }
    echo "$out" >&2
    sub=$(cf "" | field subdomain)
    echo "url=https://pr-$pr.$sub"
    ;;
  *) echo "usage: $0 sync | site <pr>" >&2; exit 2 ;;
esac
