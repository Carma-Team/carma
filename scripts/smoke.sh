#!/usr/bin/env bash
# End-to-end smoke test against a running CARMA server on http://localhost:3000.
# Used both locally and from the `smoke` job in .github/workflows/ci-server.yml.
# Exits non-zero on any failure.

set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
EMAIL="${SMOKE_EMAIL:-daniel@carma.app}"
PASS="${SMOKE_PASSWORD:-password123}"

echo "==> $BASE — login as $EMAIL"
TOKEN=$(curl -fsS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r .token)
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || { echo "login: no token returned"; exit 1; }
echo "    OK token len=${#TOKEN}"

auth() { curl -fsS -H "Authorization: Bearer $TOKEN" "$@"; }

echo "==> GET /api/auth/me"
auth "$BASE/api/auth/me" | jq -e '.id' >/dev/null

echo "==> GET /api/users/me"
auth "$BASE/api/users/me" | jq -e '.id' >/dev/null

echo "==> GET /api/trips"
auth "$BASE/api/trips" | jq -e '.trips' >/dev/null

echo "==> GET /api/rewards"
auth "$BASE/api/rewards" | jq -e '.rewards' >/dev/null

echo "==> GET /api/vouchers"
auth "$BASE/api/vouchers" | jq -e '.vouchers' >/dev/null

echo "==> GET /api/leaderboard?type=national"
auth "$BASE/api/leaderboard?type=national" | jq -e '.entries' >/dev/null

echo "==> GET /api/notifications"
auth "$BASE/api/notifications" | jq -e 'type == "array"' >/dev/null

echo "==> GET /api/user/stats"
auth "$BASE/api/user/stats" | jq -e '.stats' >/dev/null

echo "==> GET /health"
curl -fsS "$BASE/health" | jq -e '.status == "ok"' >/dev/null

echo "All smoke checks passed."
