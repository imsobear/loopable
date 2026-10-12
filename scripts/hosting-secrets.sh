#!/usr/bin/env bash
# Sets the hosted service's secrets on the Cloudflare Worker, asking for each
# one so nothing is written down. Run once, from a checkout, signed in to
# wrangler. The master key is generated here; keep a copy somewhere safe,
# because the stored credentials cannot be read without it.
set -euo pipefail

put() {
  local name="$1" prompt="$2" value
  read -r -s -p "$prompt: " value
  echo
  if [ -z "$value" ]; then
    echo "  skipped $name"
    return
  fi
  printf '%s' "$value" | npx wrangler secret put "$name" >/dev/null
  echo "  set $name"
}

echo "Database (Turso or another libSQL server)"
put LOOPABLE_DATABASE_URL "  URL, such as libsql://loopable-you.turso.io"
put LOOPABLE_DATABASE_AUTH_TOKEN "  Auth token"

echo "GitHub OAuth app for loop.goodone.si (callback https://loop.goodone.si/api/connectors/github/callback)"
put LOOPABLE_GITHUB_CLIENT_ID "  Client ID"
put LOOPABLE_GITHUB_CLIENT_SECRET "  Client secret"

echo "Google OAuth client, for Gmail (redirect https://loop.goodone.si/api/connectors/gmail/callback)"
put LOOPABLE_GMAIL_CLIENT_ID "  Client ID (empty to skip)"
put LOOPABLE_GMAIL_CLIENT_SECRET "  Client secret (empty to skip)"

if [ "${1:-}" != "--keep-master-key" ]; then
  key="$(openssl rand -base64 32)"
  printf '%s' "$key" | npx wrangler secret put LOOPABLE_MASTER_KEY >/dev/null
  echo "Master key set. Keep this copy safe: $key"
fi
