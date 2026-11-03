# GROYPER Rewards (unofficial)

Live: https://groyperrewards.surge.sh

Unofficial, read-only tracker for **$GROYPER** (`7QAn5wqkBcGuvfLLC16iLvX8fPyqXrzkMqnzHLS9NNna`), a StonkFun reward token on Solana: a 3% Token-2022 transfer fee is harvested, swapped to SOL and paid to holders as wSOL.

Tabs: **Rewards** (wallet lookup + overview), **SOL Leaders** (+ rewards forecast, estimate only), **Burn Tracker** (burns, LP lock, locked supply).

- `site/` – static site (no build step). Data comes from `site/data/*.json`, built server-side.
- `scripts/config.mjs` – mint config; `build-leaderboard.mjs` (StonkFun payout ledger, every payout re-checked on-chain), `build-burns.mjs` + `locked.mjs`, `build-forecast.mjs` (GeckoTerminal/DexScreener).
- `scripts/refresh.sh` – rebuild data incrementally and redeploy.

Server-side scripts read a Helius RPC URL from `HELIUS_RPC` or a local secrets file (never committed). `site/js/config.js` ships with an empty key.

Not affiliated with the Groyper team, StonkFun or Raydium. Not financial advice.
