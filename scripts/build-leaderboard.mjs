// Builds site/data/leaderboard.json (+ wallets.json for wallet lookups) for the GROYPER SOL reward stream.
// Source of attribution: StonkFun's public payout ledger for this mint (payouts come from a distributor shared by every
// StonkFun reward token, so a transfer alone does not say which token it was for). Every ledger signature is then
// re-checked on-chain with getTransaction: the holder's wSOL balance change in that tx must equal the ledger amount.
import { CFG, rpc, credits, getJson, readJson, writeJson, tokenDeltas, allKeys, sleep, SOL } from './lib.mjs';
const ROOT = new URL('..', import.meta.url).pathname;
const C = ROOT + '.cache/', OUT = ROOT + 'site/data/';
const t0 = Date.now();

// 1) Ledger, incremental: newest first until we reach rows we already have.
const ledger = readJson(C + 'ledger.json', []);
const known = new Set(ledger.map(r => (r.s || r.signature) + ':' + (r.h || r.holder)));
let cur = null, fresh = [], pages = 0;
for (;;) {
  const j = await getJson(`${CFG.stonkApi}/rewards/payouts?limit=100&order=desc` + (cur ? `&cursor=${encodeURIComponent(cur)}` : ''));
  if (!j) throw new Error('StonkFun ledger unavailable');
  pages++;
  const rows = j.rows || [];
  const nw = rows.filter(r => !known.has(r.signature + ':' + r.holder));
  fresh.push(...nw);
  if (!rows.length || nw.length < rows.length || !j.page?.nextCursor) break;
  cur = j.page.nextCursor; await sleep(250);
}
for (const r of fresh) { ledger.push({ s: r.signature, h: r.holder, a: r.amountRaw, t: Date.parse(r.createdAt) / 1000 | 0, m: r.assetMint }); known.add(r.signature + ':' + r.holder); }
// normalise old-format rows (first run may import the research copy)
for (const r of ledger) if (r.signature) { r.s = r.signature; r.h = r.holder; r.a = r.amountRaw; r.t = Date.parse(r.createdAt) / 1000 | 0; r.m = r.assetMint; delete r.signature; delete r.holder; delete r.amountRaw; delete r.amountTokens; delete r.createdAt; delete r.assetMint; }
ledger.sort((a, b) => a.t - b.t || (a.s < b.s ? -1 : 1));
writeJson(C + 'ledger.json', ledger);
process.stderr.write(`ledger: ${pages} pages, ${fresh.length} new rows, ${ledger.length} total\n`);

// 2) On-chain check of every signature not yet verified.
const ver = readJson(C + 'verify.json', {});
const bySig = new Map(); for (const r of ledger) { if (!bySig.has(r.s)) bySig.set(r.s, []); bySig.get(r.s).push(r); }
let nv = 0;
for (const [s, rows] of bySig) {
  if (ver[s] && ver[s].ok !== undefined) continue;
  const tx = await rpc('getTransaction', [s, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
  if (!tx) { ver[s] = { ok: false, miss: true }; continue; }
  const d = tokenDeltas(tx, SOL), keys = allKeys(tx);
  const oc = {}; let ok = !tx.meta.err;
  for (const r of rows) {
    let got = d.get(r.h) || 0n;
    if (!got) { const i = keys.indexOf(r.h); if (i >= 0) got = BigInt(tx.meta.postBalances[i] - tx.meta.preBalances[i]); } // unwrapped to native SOL
    oc[r.h] = got.toString(); if (got.toString() !== String(r.a)) ok = false;
  }
  const payer = keys[0], senders = [...d].filter(([, v]) => v < 0n).map(([k]) => k);
  const extra = [...d].filter(([k, v]) => v > 0n && !rows.some(r => r.h === k)).length; // other recipients in the same batch (other tokens' holders)
  ver[s] = { ok, slot: tx.slot, t: tx.blockTime, payer, from: senders, extra, oc };
  if (++nv % 100 === 0) { process.stderr.write(`verified ${nv}\n`); writeJson(C + 'verify.json', ver); }
}
writeJson(C + 'verify.json', ver);

// 3) Current GROYPER balances of every holder (one getProgramAccounts on Token-2022, filtered by mint).
const accs = await rpc('getProgramAccounts', [CFG.tokenProgram, { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: CFG.mint } }] }]);
const { b58enc } = await import('./lib.mjs');
const bal = new Map(); const holdersRaw = [];
for (const a of accs) {
  const b = Buffer.from(a.account.data[0], 'base64'); const owner = b58enc(b.subarray(0, 32)); const amt = b.readBigUInt64LE(32);
  holdersRaw.push([a.pubkey, owner, amt.toString()]);
  if (amt) bal.set(owner, (bal.get(owner) || 0n) + amt);
}
writeJson(C + 'holders.json', { t: Date.now() / 1000 | 0, accounts: holdersRaw });

// 4) Aggregate.
const W = new Map(), days = new Map(); let total = 0n, okRows = 0, overRows = 0, badRows = 0, zeroRows = 0, ocTotal = 0n;
for (const r of ledger) {
  const a = BigInt(r.a); total += a;
  // Row check: the holder's wSOL gain in that tx must be >= the ledger amount. It is larger only when the same
  // wallet was also paid for another StonkFun reward token in the same batch transaction.
  const v = ver[r.s]; const g = v?.oc?.[r.h] != null ? BigInt(v.oc[r.h]) : -1n;
  if (a === 0n) zeroRows++; else if (g === a) okRows++; else if (g > a) overRows++; else badRows++;
  if (g > 0n) ocTotal += g < a || a === 0n ? g : a;
  let w = W.get(r.h); if (!w) W.set(r.h, w = { sol: 0n, n: 0, first: r.t, last: r.t, p: [] });
  w.sol += a; w.n++; w.last = r.t; w.p.push(r);
  const day = new Date(r.t * 1000).toISOString().slice(0, 10); days.set(day, (days.get(day) || 0n) + a);
}
const sigList = [...bySig.keys()], sigIdx = new Map(sigList.map((s, i) => [s, i]));
const ranked = [...W].sort((a, b) => (b[1].sol > a[1].sol ? 1 : -1));
const rankOf = new Map(ranked.map(([k], i) => [k, i + 1]));
const toSol = x => Number(x) / 1e9, toTok = x => Number(x) / 10 ** CFG.decimals;
const summary = await getJson(`${CFG.stonkApi}/rewards`), pending = await getJson(`${CFG.stonkApi}/rewards/pending`);
const payers = {}; for (const s of sigList) { const p = ver[s]?.from?.[0] || ver[s]?.payer; if (p) payers[p] = (payers[p] || 0) + 1; }
const out = {
  generatedAt: new Date().toISOString(), mint: CFG.mint, sym: CFG.sym, quote: CFG.quoteSym,
  totalSol: toSol(total), payouts: ledger.length, wallets: W.size, txs: sigList.length,
  first: ledger[0]?.t, last: ledger.at(-1)?.t,
  verify: { rowsExact: okRows, rowsCombined: overRows, rowsZero: zeroRows, rowsShort: badRows, onchainSol: toSol(ocTotal), sigsChecked: Object.keys(ver).length, payers },
  api: summary ? { distributedSol: summary.rewards?.distributedTokens, payouts: summary.rewards?.payoutCount, wallets: summary.rewards?.walletsPaid, lastPayoutAt: summary.rewards?.lastPayoutAt } : null,
  pending: pending?.pending ? { undistributed: pending.pending.undistributedTokens, inFlight: pending.pending.inFlightTokens, stranded: pending.pending.strandedTokens, queued: pending.pending.queuedTokens } : null,
  holders: { accounts: holdersRaw.length, withBalance: bal.size },
  daily: [...days].sort().map(([d, v]) => [d, +toSol(v).toFixed(9)]),
  top: ranked.slice(0, 100).map(([w, x], i) => ({ r: i + 1, w, sol: +toSol(x.sol).toFixed(9), n: x.n, first: x.first, last: x.last, bal: +toTok(bal.get(w) || 0n).toFixed(2) })),
};
writeJson(OUT + 'leaderboard.json', out);
// wallets.json: every paid wallet's payouts, for the wallet lookup (no browser RPC key needed).
const wal = { sigs: sigList, w: {} };
for (const [w, x] of W) wal.w[w] = { r: rankOf.get(w), sol: +toSol(x.sol).toFixed(9), bal: +toTok(bal.get(w) || 0n).toFixed(2), p: x.p.map(r => [r.t, Number(r.a), sigIdx.get(r.s)]) };
writeJson(OUT + 'wallets.json', wal);
process.stderr.write(`leaderboard: ${out.totalSol} SOL, ${out.wallets} wallets, rows exact ${okRows}, combined ${overRows}, zero ${zeroRows}, short ${badRows} of ${ledger.length}, ${nv} txs verified this run, ~${credits} Helius credits, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
console.log(JSON.stringify({ totalSol: out.totalSol, wallets: out.wallets, exact: okRows, combined: overRows, zero: zeroRows, short: badRows, credits }));
