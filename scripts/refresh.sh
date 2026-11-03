#!/bin/bash
# Rebuild Groyper Rewards data (incremental) and redeploy to surge. No secrets are printed.
# Helius credits per run: ~10 (getProgramAccounts) + 1 per new payout tx (leaderboard) + ~30-40 (burns/locked, incremental gTFA) ≈ 50-80.
set -euo pipefail
cd /workspace/groyperrewards
mkdir -p .cache
node scripts/build-leaderboard.mjs 2>>.cache/refresh.log
node scripts/build-burns.mjs >/dev/null 2>>.cache/refresh.log
node scripts/build-forecast.mjs >/dev/null 2>>.cache/refresh.log || echo "build-forecast failed $(date -u +%FT%TZ)" >>.cache/refresh.log
SURGE_LOGIN="$(jq -r .email /home/box/secrets/surge.json)" SURGE_TOKEN="$(jq -r .token /home/box/secrets/surge.json)" npx --yes surge@0.53.0 /workspace/groyperrewards/site groyperrewards.surge.sh >>.cache/refresh.log 2>&1
echo "refreshed + deployed $(date -u +%FT%TZ)"
