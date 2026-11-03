#!/usr/bin/env node
// Builds site/data/forecast.json: inputs for the Forecast panel on the SOL Leaders tab.
// GROYPER is a StonkFun reward-mode Token-2022 coin: every transfer pays a 3% transfer fee in GROYPER, StonkFun harvests the
// withheld fees, swaps them to SOL and pays the SOL out pro rata to eligible holders.
// Per UTC day:  paid = SOL paid to holders (StonkFun ledger, every row re-checked on-chain by build-leaderboard.mjs)
//               volUsd = GROYPER/SOL trading volume in USD (GeckoTerminal daily OHLCV, Raydium CPMM pool)
// Empirical rate = paid (in USD at that day's SOL price) / volume (USD). No Helius credits are used here.
import path from 'path';
import { fileURLToPath } from 'url';
import { CFG, getJson, readJson, writeJson, sleep } from './lib.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site/data/forecast.json');
const ledger = readJson(path.join(ROOT, '.cache/ledger.json'), []);
const holders = readJson(path.join(ROOT, '.cache/holders.json'), { accounts: [] });
if (!ledger.length) throw new Error('run build-leaderboard.mjs first');
const day = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const sum = a => a.reduce((x, y) => x + y, 0);
const r8 = x => x == null || !isFinite(x) ? null : Number(x.toPrecision(6)), r4 = x => x == null || !isFinite(x) ? null : Math.round(x * 1e4) / 1e4;

const paid = {}; for (const r of ledger) { const d = day(r.t); const p = paid[d] ||= [0, 0]; p[0] += Number(r.a) / 1e9; p[1]++; }
const gtUsd = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${CFG.pool}/ohlcv/day?limit=200&currency=usd&token=base`);
await sleep(2500);
const gtSol = await getJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${CFG.pool}/ohlcv/day?limit=200&currency=token&token=base`);
if (!gtUsd) throw new Error('GeckoTerminal OHLCV unavailable');
const pxUsd = {}, volUsd = {}, solUsdDay = {};
for (const c of gtUsd.data.attributes.ohlcv_list) { pxUsd[day(c[0])] = c[4]; volUsd[day(c[0])] = c[5]; }
for (const c of gtSol?.data?.attributes?.ohlcv_list || []) { const d = day(c[0]); if (pxUsd[d] && c[4]) solUsdDay[d] = pxUsd[d] / c[4]; }
const ds = await getJson('https://api.dexscreener.com/tokens/v1/solana/' + CFG.mint);
const p = (ds || []).find(x => x.pairAddress === CFG.pool);
const live = p ? { priceUsd: Number(p.priceUsd) || null, priceNative: Number(p.priceNative) || null, mcUsd: p.marketCap || p.fdv || null, vol24Usd: p.volume?.h24 ?? null, liqUsd: p.liquidity?.usd ?? null } : null;
const solUsd = live?.priceUsd && live?.priceNative ? live.priceUsd / live.priceNative : null;

// Eligible supply, measured: over the last 2 days of payouts, implied eligible supply = wallet balance x window total / wallet's payout,
// median over the top 10 receivers that still hold (balances from this run's getProgramAccounts snapshot in .cache/holders.json).
const bal = {}; for (const [, o, a] of holders.accounts) bal[o] = (bal[o] || 0) + Number(a) / 10 ** CFG.decimals;
const lastT = ledger.at(-1).t, from = lastT - 2 * 86400, gains = {}; let tot = 0;
for (const r of ledger) if (r.t >= from) { gains[r.h] = (gains[r.h] || 0) + Number(r.a); tot += Number(r.a); }
const imp = Object.entries(gains).sort((a, b) => b[1] - a[1]).slice(0, 10).filter(([w]) => bal[w] > 0).map(([w, g]) => bal[w] * tot / g).sort((a, b) => a - b);
const recips = Object.keys(gains), recBal = recips.map(w => bal[w] || 0).filter(x => x > 0).sort((a, b) => a - b);
const eligible = imp.length >= 3 ? { supply: Math.round(imp[Math.floor(imp.length / 2)]), samples: imp.length, wallets: recips.length, from, to: lastT, recipientsHolding: Math.round(sum(recBal)), smallestRecipient: recBal[0] ? Math.round(recBal[0]) : null } : null;

const today = day(Date.now() / 1000 | 0);
const dayList = n => { const o = []; for (let i = n; i >= 1; i--) o.push(day((Date.now() / 1000 | 0) - i * 86400)); return o; };
const all = [...new Set([...Object.keys(paid), ...Object.keys(volUsd)])].sort().filter(d => d < today && d >= day(CFG.launchTs));
const rows = all.map(d => { const pp = paid[d] || [0, 0], s = solUsdDay[d] || solUsd; return { d, paid: r8(pp[0]), payouts: pp[1], volUsd: Math.round(volUsd[d] || 0), solUsd: s ? r8(s) : null, paidUsd: s ? Math.round(pp[0] * s * 100) / 100 : null, priceUsd: pxUsd[d] ? r8(pxUsd[d]) : null }; });
const by = Object.fromEntries(rows.map(r => [r.d, r]));
const win = n => dayList(n).map(d => by[d] || { d, paid: 0, volUsd: 0, paidUsd: 0 });
const agg = n => { const w = win(n), pd = sum(w.map(r => r.paid)), v = sum(w.map(r => r.volUsd)), pu = sum(w.map(r => r.paidUsd || 0));
  return { days: n, paid: r8(pd), paidUsd: Math.round(pu), volUsd: Math.round(v), paidPerDay: r8(pd / n), volUsdPerDay: Math.round(v / n), rewardRate: r8(pu / v), rewardPerUsdVol: r8(pd / v), payoutDays: w.filter(r => r.paid > 0).length }; };
const weeks = []; const w56 = win(56);
for (let i = 0; i < 8; i++) { const w = w56.slice(i * 7, i * 7 + 7); const v = sum(w.map(r => r.volUsd)), pu = sum(w.map(r => r.paidUsd || 0)), pd = sum(w.map(r => r.paid)); if (v > 0) weeks.push({ from: w[0].d, to: w[6].d, volUsd: Math.round(v), paid: r8(pd), rate: r8(pu / v) }); }
const supply = Number(readJson(path.join(ROOT, 'site/data/burns.json'), {})?.supply?.current) || null;
const out = {
  generatedAt: Date.now() / 1000 | 0, today, prices: { solUsd, tokenUsd: live?.priceUsd || null }, taxBps: 300,
  src: { sol: { key: 'sol', sym: CFG.sym, mint: CFG.mint, pay: 'SOL', pool: CFG.pool, supply, eligible, live, d7: agg(7), d30: agg(30), weeks: weeks.reverse(),
    lifetime: { from: all[0], paid: r8(sum(rows.map(r => r.paid))), volUsd: Math.round(sum(rows.map(r => r.volUsd))), paidUsd: Math.round(sum(rows.map(r => r.paidUsd || 0))) },
    days: rows.slice(-60) } },
  method: 'GROYPER charges a 3% Token-2022 transfer fee on every transfer (so on every buy and sell). StonkFun harvests the withheld GROYPER, swaps it to SOL and pays it out pro rata to eligible holders. rate = SOL paid (USD at that day\'s SOL price) / pool trading volume (USD).',
};
writeJson(OUT, out);
const s = out.src.sol; console.log(JSON.stringify({ solUsd, live, eligible, d7: s.d7, d30: s.d30, weeks: s.weeks.map(w => w.rate), lifetime: s.lifetime }, null, 1));
