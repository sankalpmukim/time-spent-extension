#!/usr/bin/env bash
# Deploys the landing + sign-in relay site to Cloudflare Workers
# (static assets via the Cloudflare Vite plugin).
#
# Injects the Google OAuth client ID into the auth page before building.
# The client ID is a public identifier (it ships in every web page that
# uses Google Sign-In), so it is committed after first injection.
#
# Usage:
#   ./scripts/deploy-site.sh <GOOGLE_CLIENT_ID>
set -euo pipefail

CLIENT_ID="${1:?Usage: ./scripts/deploy-site.sh <GOOGLE_CLIENT_ID>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/site"

if [[ "$(uname)" == "Darwin" ]]; then
  sed -i '' "s/__GOOGLE_CLIENT_ID__/$CLIENT_ID/g" "$SITE/public/auth/index.html"
else
  sed -i "s/__GOOGLE_CLIENT_ID__/$CLIENT_ID/g" "$SITE/public/auth/index.html"
fi

cd "$SITE" && cf deploy
