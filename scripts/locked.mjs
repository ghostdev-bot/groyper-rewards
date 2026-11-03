// "Locked wallet supply": GROYPER held by addresses that provably cannot move it.
// Every refresh reads ALL GROYPER token accounts (getProgramAccounts) and includes an owner only when
// one of these rules holds, with the rule shown as the reason:
//   1. Solana incinerator (1nc1nerator…): a hand-picked off-curve constant, no private key, no program signs for it.
//   2. System Program address (111…1) as owner: no key; the System Program never signs as itself.
//   3. Hand-picked vanity address (name + 20 or more trailing "1"s, e.g. BoboBurn111…): not generated from a
//      keypair, so nobody holds a private key, AND its full history shows it has never signed a transaction.
//   4. Token-lock escrow (Streamflow / Jupiter Lock / Bonfida vesting): locked until that contract's schedule
//      releases it (shown as time-locked, not permanent).
// Pools, bonding curves, multisigs, staking programs and normal wallets (exchanges included) are never counted.
import { rpc, CFG, b58dec, b58enc } from './lib.mjs';
const MINT = CFG.mint, DIV = 10 ** CFG.decimals;

const P = 2n ** 255n - 19n; const modp = a => ((a % P) + P) % P;
function powm(b, e) { let r = 1n; b = modp(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; }
const D = modp(-121665n * powm(121666n, P - 2n));
export function onCurve(addr) {
  const bytes = b58dec(addr);
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  if (y >= P) return false;
  const y2 = y * y % P, x2 = modp((y2 - 1n) * powm(D * y2 + 1n, P - 2n));
  return x2 === 0n || powm(x2, (P - 1n) / 2n) === 1n;
}
const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
const SYSTEM = '11111111111111111111111111111111';
const LOCK_PROGS = {
  strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m: 'Streamflow token lock',
  LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn: 'Jupiter Lock',
  CChTq6PthWU82YZkbveA3WDf7s97BWhBK4Vx9bmsT743: 'Bonfida token vesting',
};
const KNOWN_PROGS = {
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: 'Raydium CPMM pool (GROYPER/SOL liquidity, traders can swap it out)',
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: 'Raydium LaunchLab bonding curve (StonkFun launch)',
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'PumpSwap AMM pool',
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'Meteora DLMM pool',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'Raydium CLMM pool',
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca Whirlpool',
  pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ: 'pump.fun fee program',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'program-derived token account (the program that created it can sign)',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'program-derived token account (the program that created it can sign)',
};
const NAMED = {
  GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL: 'Raydium CPMM vault authority: GROYPER/SOL pool reserves (traders swap it out)',
};
const HISTORY_HINTS = {
  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf: 'Squads multisig vault (its members can spend)',
  M6eGHRUFPHWxk5K9iZT7B2LTxPomvm8Bd8nxsUSTAKE: 'staking program pool (stakers can withdraw)',
};
const isVanity = a => /1{20,}$/.test(a) && a !== SYSTEM;

// Has `addr` ever signed a transaction, or sent GROYPER out? Incremental via st.lockScan[addr].
async function history(addr, st) {
  const s = st.lockScan[addr] ||= { newestSlot: null, scanned: 0, signed: 0, tokOut: '0' };
  let token = null;
  do {
    const p = { transactionDetails: 'full', limit: 1000, encoding: 'json', maxSupportedTransactionVersion: 1, sortOrder: 'asc', filters: { tokenAccounts: 'all' } };
    if (token) p.paginationToken = token; else if (s.newestSlot != null) p.filters.slot = { gt: s.newestSlot };
    const r = await rpc('getTransactionsForAddress', [addr, p]);
    const d = r?.data || [];
    for (const tx of d) {
      s.scanned++; if (s.newestSlot == null || tx.slot > s.newestSlot) s.newestSlot = tx.slot;
      const m = tx.transaction.message, nSig = m.header.numRequiredSignatures;
      if (m.accountKeys.slice(0, nSig).includes(addr)) s.signed++;
      if (tx.meta && !tx.meta.err) {
        const bal = arr => (arr || []).filter(b => b.mint === MINT && b.owner === addr).reduce((x, b) => x + BigInt(b.uiTokenAmount.amount), 0n);
        const dlt = bal(tx.meta.postTokenBalances) - bal(tx.meta.preTokenBalances);
        if (dlt < 0n) s.tokOut = (BigInt(s.tokOut) - dlt).toString();
      }
    }
    token = d.length ? r.paginationToken : null;
  } while (token);
  return s;
}
async function firstPrograms(addr, st) {
  if (st.firstProgs[addr]) return st.firstProgs[addr];
  const r = await rpc('getTransactionsForAddress', [addr, { transactionDetails: 'full', limit: 3, encoding: 'json', maxSupportedTransactionVersion: 1, sortOrder: 'asc' }]);
  const progs = new Set();
  for (const tx of r?.data || []) { const k = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable || []), ...(tx.meta?.loadedAddresses?.readonly || [])]; for (const ix of tx.transaction.message.instructions) progs.add(k[ix.programIdIndex]); }
  return (st.firstProgs[addr] = [...progs]);
}

export async function buildLocked(st, supplyRaw) {
  st.lockScan ||= {}; st.firstProgs ||= {};
  const accs = await rpc('getProgramAccounts', [CFG.tokenProgram, { encoding: 'base64', dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: MINT } }] }]) // Token-2022: accounts carry extensions, so no dataSize filter;
  const byOwner = new Map();
  for (const a of accs) {
    const b = Buffer.from(a.account.data[0], 'base64'); const amt = b.readBigUInt64LE(32); if (!amt) continue;
    const owner = b58enc(Uint8Array.from(b.subarray(0, 32)));
    byOwner.set(owner, (byOwner.get(owner) || 0n) + amt);
  }
  const owners = [...byOwner.keys()];
  const offCurve = owners.filter(o => !onCurve(o));
  const progOf = {};
  for (let i = 0; i < offCurve.length; i += 100) {
    const chunk = offCurve.slice(i, i + 100);
    const v = (await rpc('getMultipleAccounts', [chunk, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }])).value;
    chunk.forEach((o, j) => { progOf[o] = v[j] ? v[j].owner : null; });
  }
  const locked = [], rejected = [];
  for (const [o, raw] of byOwner) {
    let reason = null, kind = 'permanent', label = null;
    if (o === INCINERATOR) { label = 'Solana incinerator'; reason = 'Off-curve constant address with no private key; no program can sign for it.'; }
    else if (o === SYSTEM) { label = 'System Program address'; reason = 'Tokens owned by the System Program address: no private key, and the System Program never signs as itself.'; }
    else if (progOf[o] && LOCK_PROGS[progOf[o]]) { label = LOCK_PROGS[progOf[o]] + ' escrow'; kind = 'time-locked'; reason = `Escrow owned by the ${LOCK_PROGS[progOf[o]]} program; released only on that contract's schedule.`; }
    else if (isVanity(o)) {
      const h = await history(o, st);
      if (h.signed === 0 && BigInt(h.tokOut) === 0n) {
        label = 'Vanity burn address';
        reason = `Hand-picked vanity address (name + trailing 1s), not generated from a keypair, so no one holds its private key. Verified on-chain: in all ${h.scanned.toLocaleString('en-US')} transactions touching it, it never signed and never sent GROYPER out.`;
      } else rejected.push({ w: o, amount: Number(raw) / DIV, why: 'vanity-looking but has signed or sent GROYPER' });
    }
    if (reason) locked.push({ w: o, label, kind, reason, raw });
  }
  locked.sort((a, b) => (b.raw > a.raw ? 1 : -1));
  // Transparency: the biggest program-controlled holders we checked and did NOT count.
  const checked = [];
  for (const o of offCurve.filter(o => !locked.some(l => l.w === o)).sort((a, b) => (byOwner.get(b) > byOwner.get(a) ? 1 : -1)).slice(0, 8)) {
    let why = NAMED[o] || KNOWN_PROGS[progOf[o]];
    if (!why) { const ps = await firstPrograms(o, st); const hint = ps.find(p => HISTORY_HINTS[p]); why = hint ? HISTORY_HINTS[hint] : progOf[o] && progOf[o] !== SYSTEM ? `account of program ${progOf[o].slice(0, 4)}…${progOf[o].slice(-4)} (that program can move it)` : 'program-derived address (the program behind it can sign)'; }
    checked.push({ w: o, amount: Number(byOwner.get(o)) / DIV, why });
  }
  const sup = Number(BigInt(supplyRaw)) / DIV;
  return {
    holdersScanned: owners.length, tokenAccounts: accs.length,
    wallets: locked.map(l => ({ w: l.w, label: l.label, kind: l.kind, reason: l.reason, amount: Number(l.raw) / DIV })),
    total: locked.reduce((s, l) => s + Number(l.raw) / DIV, 0),
    checkedNotCounted: checked, rejected,
    rules: 'Counted only: the Solana incinerator, the System Program address, hand-picked vanity burn addresses that have never signed, and token-lock escrows (Streamflow, Jupiter Lock, Bonfida). Pools, bonding curves, multisigs, staking programs and regular wallets (exchanges included) are never counted.',
    supplyUi: sup,
  };
}
