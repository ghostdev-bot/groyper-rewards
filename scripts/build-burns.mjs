#!/usr/bin/env node
// Builds site/data/burns.json: every Burn / BurnChecked of the GROYPER mint (Token-2022), the Solana incinerator balance,
// the Token-2022 transfer fee still withheld on the mint, and the "locked wallet supply" (locked.mjs).
// Source: Helius getTransactionsForAddress on the mint (every Burn instruction lists the mint account), oldest first.
// Cross-check: initial supply (first MintTo) - current getTokenSupply must equal the summed burns.
// Incremental + resumable: state in .cache/burns-state.json (outside the site). --full rebuilds.
import path from 'path';
import { fileURLToPath } from 'url';
import { buildLocked } from './locked.mjs';
import { CFG, rpc, allKeys, b58dec, b58enc, sig, readJson, writeJson, credits, addCredits } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.cache/burns-state.json');
const OUT = path.join(ROOT, 'site/data/burns.json');
const MINT = CFG.mint, DEC = CFG.decimals;
const TOKEN_PROGS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
const full = process.argv.includes('--full');
const st = (!full && readJson(STATE, null)) || { v: 1, mint: { token: null, newestSlot: null, done: false, scanned: 0 }, initial: null, burns: [], feeOps: 0 };
const seen = new Set(st.burns.map(b => b.sig + ':' + b.i));

function scanBurns(tx) {
  const keys = allKeys(tx), m = tx.meta, s = sig(tx);
  const owners = {}; for (const b of [...(m.preTokenBalances || []), ...(m.postTokenBalances || [])]) if (b.owner) owners[b.accountIndex] = b.owner;
  const ixs = [...tx.transaction.message.instructions, ...(m.innerInstructions || []).flatMap(g => g.instructions)];
  let i = 0;
  for (const ix of ixs) {
    i++;
    if (!TOKEN_PROGS.has(keys[ix.programIdIndex])) continue;
    let d; try { d = b58dec(ix.data); } catch { continue; }
    if (d[0] === 7 || d[0] === 14) { // MintTo / MintToChecked (first one = initial supply)
      if (keys[ix.accounts[0]] === MINT && st.initial == null) st.initial = new DataView(d.buffer, d.byteOffset).getBigUint64(1, true).toString();
      continue;
    }
    if (d[0] === 26 && d[1] >= 2 && d[1] <= 4 && keys[ix.accounts[0]] === MINT) st.feeOps++; // transfer-fee harvest/withdraw
    if (!(d[0] === 8 || d[0] === 15) || d.length < 9) continue;
    if (keys[ix.accounts[1]] !== MINT) continue;
    const key = s + ':' + i; if (seen.has(key)) continue; seen.add(key);
    const amount = new DataView(d.buffer, d.byteOffset).getBigUint64(1, true);
    const acct = ix.accounts[0], auth = keys[ix.accounts[2]];
    st.burns.push({ sig: s, i, ts: tx.blockTime, slot: tx.slot, raw: amount.toString(), owner: owners[acct] || auth, auth });
  }
}
async function scan(address, part, filters, fn, label) {
  let token = part.token || null, pages = 0;
  do {
    const p = { transactionDetails: 'full', limit: 1000, encoding: 'json', maxSupportedTransactionVersion: 1, sortOrder: 'asc', filters: { status: 'succeeded', ...filters } };
    if (token) p.paginationToken = token; else if (part.newestSlot != null) p.filters.slot = { gt: part.newestSlot };
    const r = await rpc('getTransactionsForAddress', [address, p]);
    const d = r?.data || []; pages++; addCredits(Math.max(10, Math.ceil(d.length / 100) * 10));
    for (const tx of d) { fn(tx); part.scanned++; if (part.newestSlot == null || tx.slot > part.newestSlot) part.newestSlot = tx.slot; if (!part.firstTs) part.firstTs = tx.blockTime; }
    token = d.length ? r.paginationToken : null;
    part.token = token;
    if (pages % 5 === 0 || !token) { writeJson(STATE, st); process.stderr.write(`${label}: page ${pages}, ${part.scanned} txs total, last ${d.length ? new Date(d.at(-1).blockTime * 1000).toISOString() : '-'}\n`); }
  } while (token);
  part.done = true; writeJson(STATE, st);
}
await scan(MINT, st.mint, {}, scanBurns, 'GROYPER mint');

const supply = await rpc('getTokenSupply', [MINT]);
const accts = async o => ((await rpc('getTokenAccountsByOwner', [o, { mint: MINT }, { encoding: 'jsonParsed' }]))?.value || []).reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
const incBal = await accts(INCINERATOR);
const mintAcc = await rpc('getAccountInfo', [MINT, { encoding: 'jsonParsed' }]);
const ext = mintAcc?.value?.data?.parsed?.info?.extensions || [];
const fee = ext.find(e => e.extension === 'transferFeeConfig')?.state;
const locked = await buildLocked(st, supply.value.amount); writeJson(STATE, st);
// Pool liquidity lock: who holds the CPMM LP tokens (checked every run).
let liquidity = null;
if (CFG.lpMint) {
  const ls = await rpc('getTokenSupply', [CFG.lpMint]);
  const la = (await rpc('getTokenLargestAccounts', [CFG.lpMint])).value || [];
  const top = la[0] ? await rpc('getAccountInfo', [la[0].address, { encoding: 'jsonParsed' }]) : null;
  const owner = top?.value?.data?.parsed?.info?.owner || null;
  liquidity = { lpMint: CFG.lpMint, pool: CFG.pool, supply: Number(ls.value.uiAmountString), lockAccount: la[0]?.address || null, lockOwner: owner, lockedPct: la[0] ? Number(la[0].amount) / Number(ls.value.amount) * 100 : 0, lockTx: st.lpLockTx || null };
  if (!st.lpLockTx && la[0]) {
    const r = await rpc('getTransactionsForAddress', [la[0].address, { transactionDetails: 'signatures', limit: 5, sortOrder: 'asc' }]); addCredits(10);
    const f = r?.data?.[0]; if (f) { st.lpLockTx = { sig: f.signature, ts: f.blockTime, txs: r.data.length }; liquidity.lockTx = st.lpLockTx; writeJson(STATE, st); }
  }
}
const ui = r => Number(BigInt(r)) / 10 ** DEC;
const burns = st.burns.slice().sort((a, b) => a.slot - b.slot || a.i - b.i);
const sumBurn = burns.reduce((s, b) => s + BigInt(b.raw), 0n);
const initial = st.initial ? BigInt(st.initial) : null;
const byOwner = {}; for (const b of burns) { const r = byOwner[b.owner] ||= { w: b.owner, raw: 0n, n: 0, last: 0 }; r.raw += BigInt(b.raw); r.n++; r.last = Math.max(r.last, b.ts); }
const out = {
  generatedAt: Math.floor(Date.now() / 1000),
  mint: MINT, decimals: DEC,
  range: { from: st.mint.firstTs, to: Math.max(...burns.map(b => b.ts), 0) || null, txsScanned: st.mint.scanned, newestSlot: st.mint.newestSlot },
  supply: { initial: initial != null ? ui(initial) : null, current: ui(supply.value.amount), burnedBySupply: initial != null ? ui(initial - BigInt(supply.value.amount)) : null },
  burned: { amount: ui(sumBurn), count: burns.length, burners: Object.keys(byOwner).length, matchesSupply: initial != null && initial - BigInt(supply.value.amount) === sumBurn },
  incinerator: { address: INCINERATOR, balance: ui(incBal) },
  transferFee: fee ? { bps: fee.newerTransferFee?.transferFeeBasisPoints, withheldOnMint: ui(fee.withheldAmount || 0), authority: fee.withdrawWithheldAuthority, feeOps: st.feeOps } : null,
  locked,
  liquidity,
  topBurners: Object.values(byOwner).sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0)).slice(0, 25).map(r => ({ w: r.w, amount: ui(r.raw), n: r.n, last: r.last })),
  burns: burns.reverse().slice(0, 5000).map(b => ({ ts: b.ts, amount: ui(b.raw), w: b.owner, sig: b.sig })),
};
writeJson(OUT, out);
console.log(JSON.stringify({ locked: { total: locked.total, wallets: locked.wallets.map(w => [w.label, w.w, w.amount]), checked: locked.checkedNotCounted, rejected: locked.rejected }, supply: out.supply, burned: out.burned, inc: out.incinerator, fee: out.transferFee, liq: out.liquidity, top: out.topBurners.slice(0, 5), credits }));
