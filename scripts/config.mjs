// Token config for Groyper Rewards. Everything token-specific lives here; the build scripts read it.
// All values were checked on-chain (mint account, Token-2022 extensions) and against DexScreener / GeckoTerminal / StonkFun.
export const CFG = {
  site: 'groyperrewards.surge.sh',
  sym: 'GROYPER', name: 'Groyper',
  mint: '7QAn5wqkBcGuvfLLC16iLvX8fPyqXrzkMqnzHLS9NNna',
  tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022, 3% transfer fee extension
  decimals: 6,
  quote: 'So11111111111111111111111111111111111111112', // StonkFun reward launch paired with SOL: rewards paid in (wrapped) SOL
  quoteSym: 'SOL', quoteDec: 9,
  pool: '9MUPm3gpptBNqiBGyhwWnJdfekei2anpaUyTfzsB193P',    // Raydium CPMM GROYPER/SOL (graduated pool, where it trades)
  curvePool: '9cZvY4rZMB8VFTz7BnFt9ws9t9rvDuX6456UkGT4gnCH', // Raydium LaunchLab bonding curve (StonkFun), graduated seconds after launch
  // StonkFun reward wallets: 5KXDF6… is the mint's transfer-fee/withdraw-withheld authority and sends the payouts; HuBMeYW3… sent some later payouts.
  distributors: ['5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD', 'HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga'],
  feeAuthority: '5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD',
  lpMint: 'EuvY6WZcCYdEHxe1qH4s8ZxdP4TqqTtrBFb6h1sPEN4K', // CPMM LP token; 100% locked by Raydium LockCpLiquidity at migration
  stonkApi: 'https://www.stonkfun.xyz/api/v2/tokens/7QAn5wqkBcGuvfLLC16iLvX8fPyqXrzkMqnzHLS9NNna',
  launchTs: 1789090822, // 2026-09-11 01:40:22 UTC, mint creation
};
