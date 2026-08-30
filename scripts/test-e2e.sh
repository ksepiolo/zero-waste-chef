#!/usr/bin/env bash
# Automates the local e2e workflow documented in
# context/archive/2026-08-18-testing-generate-approve-e2e/plan.md:
# tests/generate-approve.spec.ts binds a fixed stub port (4399) that is set
# once at dev-server startup, so browser projects must run one at a time,
# not via playwright.config.ts's default fully-parallel multi-project run.
set -euo pipefail

BASE_URL="http://localhost:4321"

echo "==> Ensuring local Supabase is running"
npx supabase start >/dev/null

echo "==> Freeing port 4321 (stale/broken dev server, if any)"
lsof -ti :4321 | xargs -r kill -9 2>/dev/null || true

echo "==> Starting dev:e2e server"
npm run dev:e2e >/tmp/dev-e2e.log 2>&1 &
DEV_PID=$!

cleanup() {
  echo "==> Stopping dev:e2e server"
  kill "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Waiting for $BASE_URL"
for i in $(seq 1 30); do
  if curl -sf "$BASE_URL" -o /dev/null; then
    echo "Dev server ready."
    break
  fi
  if [ "$i" = "30" ]; then
    echo "Dev server did not become ready in time; see /tmp/dev-e2e.log" >&2
    exit 1
  fi
  sleep 1
done

STATUS=0
for project in chromium firefox webkit; do
  echo "==> Running Playwright project: $project"
  npx playwright test --project="$project" || STATUS=$?
done

exit "$STATUS"
