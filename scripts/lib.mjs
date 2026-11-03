// Shared helpers for the box-side build scripts. Reads the Helius RPC URL from the environment
// (HELIUS_RPC) or from a local secrets file that is never part of the site or the repo.
import fs from 'fs';
export { CFG } from './config.mjs';

export const SOL = 'So11111111111111111111111111111111111111112';
function rpcUrl() {
  if (process.env.HELIUS_RPC) return process.env.HELIUS_RPC;
  const f = process.env.HELIUS_SECRETS || '/home/box/secrets/helius.json';
  return JSON.parse(fs.readFileSync(f, 'utf8')).rpc;
}
const URL_ = rpcUrl();
// The Helius key is domain-restricted in the Helius dashboard. groyperrewards.surge.sh is NOT on its allow-list (403),
// so these box-side builds send an allowed origin (override with HELIUS_ORIGIN once the new domain is added).
const ORIGIN = process.env.HELIUS_ORIGIN || 'https://groyperrewards.surge.sh';
export let credits = 0;
export const addCredits = n => { credits += n; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export { sleep };
let lastCall = 0;
export async function rpc(method, params, tries = 8) {
  let last;
  for (let t = 0; t < tries; t++) {
    const wait = lastCall + 130 - Date.now(); if (wait > 0) await sleep(wait); lastCall = Date.now();
    try {
      const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error('HTTP ' + r.status + ' (key rejected)'), { fatal: true });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
      if (method !== 'getTransactionsForAddress') credits += method === 'getProgramAccounts' ? 10 : 1;
      return j.result;
    } catch (e) { last = e; if (e.fatal) break; await sleep(1000 * (t + 1)); }
  }
  throw last;
}
// getTransactionsForAddress, full transactions, oldest first, optionally only slots > afterSlot.
export async function* gtfaAll(address, { afterSlot = null, fromTime = null, label = address.slice(0, 6), filters = {} } = {}) {
  let token = null, pages = 0, n = 0;
  do {
    const p = { transactionDetails: 'full', limit: 1000, encoding: 'json', maxSupportedTransactionVersion: 1, sortOrder: 'asc', filters: { status: 'succeeded', ...filters } };
    if (afterSlot != null) p.filters.slot = { gt: afterSlot };
    else if (fromTime != null) p.filters.blockTime = { gte: fromTime };
    if (token) p.paginationToken = token;
    const r = await rpc('getTransactionsForAddress', [address, p]);
    const d = r?.data || []; pages++; n += d.length; credits += Math.max(10, Math.ceil(d.length / 100) * 10);
    if (pages % 10 === 0 || !r?.paginationToken) process.stderr.write(`${label}: page ${pages}, ${n} txs, ~${credits} credits\n`);
    for (const tx of d) yield tx;
    token = d.length ? r.paginationToken : null;
  } while (token);
}
export async function getJson(url, tries = 4) {
  for (let t = 0; t < tries; t++) {
    try { const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'groyper-rewards-builder' } }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch {}
    await sleep(2500 * (t + 1));
  }
  return null;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58dec(s) {
  const out = [];
  for (const ch of s) { let c = B58.indexOf(ch); if (c < 0) throw new Error('bad base58'); for (let j = 0; j < out.length; j++) { c += out[j] * 58; out[j] = c & 255; c >>= 8; } while (c) { out.push(c & 255); c >>= 8; } }
  for (const ch of s) { if (ch === '1') out.push(0); else break; }
  return Uint8Array.from(out.reverse());
}
export function b58enc(bytes) {
  const d = [];
  for (const b of bytes) { let c = b; for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
  let s = ''; for (const b of bytes) { if (b === 0) s += '1'; else break; }
  for (let i = d.length - 1; i >= 0; i--) s += B58[d[i]];
  return s;
}
export function allKeys(tx) {
  const m = tx.transaction.message, la = tx.meta?.loadedAddresses || {};
  return [...m.accountKeys, ...(la.writable || []), ...(la.readonly || [])];
}
export const sig = tx => tx.transaction.signatures[0];
// Per-owner balance change of one mint in a tx (raw BigInt), from pre/post token balances.
export function tokenDeltas(tx, mint) {
  const bal = arr => { const o = new Map(); for (const b of arr || []) if (b.mint === mint && b.owner) o.set(b.owner, (o.get(b.owner) || 0n) + BigInt(b.uiTokenAmount.amount)); return o; };
  const pre = bal(tx.meta.preTokenBalances), post = bal(tx.meta.postTokenBalances), out = new Map();
  for (const k of new Set([...pre.keys(), ...post.keys()])) { const d = (post.get(k) || 0n) - (pre.get(k) || 0n); if (d) out.set(k, d); }
  return out;
}
export function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
export function writeJson(f, v) { fs.mkdirSync(f.replace(/\/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); }
