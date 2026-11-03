// Groyper Rewards: unofficial, read-only SOL holder-rewards tracker for $GROYPER. No build step, no dependencies.
// Payout history comes from data/*.json, built on a server (scripts/): StonkFun's public payout ledger for the mint,
// every transaction re-checked on-chain. The browser only reads live balances and prices.
'use strict';

// ---------- constants ----------
const SOL = 'So11111111111111111111111111111111111111112';
const MINT = '7QAn5wqkBcGuvfLLC16iLvX8fPyqXrzkMqnzHLS9NNna';
const SYMBOL = 'GROYPER';
const POOL = '9MUPm3gpptBNqiBGyhwWnJdfekei2anpaUyTfzsB193P';
const DISTRIBUTOR = '5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROG = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const EXAMPLE = 'CEhXie1UcSDezZBEQu4ZkzSphbr3kVSRcEpo2vkSLeY';
const MIN_HOLD = 100000; // observed: smallest recipient of recent payout rounds holds ~100K GROYPER (estimate)
const FREE_RPCS = ['https://solana-rpc.publicnode.com', 'https://rpc.solanatracker.io/public'];

// ---------- tiny utils ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
function fmtNum(n, dp) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (dp == null) dp = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  return n.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}
function fmtUsd(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (a >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (a >= 0.01) return '$' + n.toFixed(3);
  if (a === 0) return '$0';
  return '$' + n.toPrecision(2);
}
function fmtPrice(n) {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1) return '$' + n.toFixed(2);
  const s = n.toPrecision(3);
  return '$' + (Number(s) < 1e-6 ? Number(s).toExponential(2) : Number(s).toString());
}
const etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtET = ts => ts ? etFmt.format(new Date(ts * 1000)) + ' ET' : '—';
const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
const fmtDay = ts => ts ? etDay.format(new Date(ts * 1000)) : '—';
function ago(ts) {
  if (!ts) return '';
  const s = Date.now() / 1000 - ts;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
  if (s < 86400 * 2) return (s / 3600).toFixed(1).replace('.0', '') + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

// ---------- base58 + PDA (for the ATA balance fallback) ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58dec(s) {
  const out = [];
  for (const ch of s) { let c = B58.indexOf(ch); if (c < 0) throw new Error('bad base58'); for (let j = 0; j < out.length; j++) { c += out[j] * 58; out[j] = c & 255; c >>= 8; } while (c) { out.push(c & 255); c >>= 8; } }
  for (const ch of s) { if (ch === '1') out.push(0); else break; }
  return Uint8Array.from(out.reverse());
}
function b58enc(bytes) {
  const d = [];
  for (const b of bytes) { let c = b; for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
  let s = ''; for (const b of bytes) { if (b === 0) s += '1'; else break; }
  for (let i = d.length - 1; i >= 0; i--) s += B58[d[i]];
  return s;
}
function isAddress(s) { try { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && b58dec(s).length === 32; } catch { return false; } }
const P = 2n ** 255n - 19n;
const modp = a => ((a % P) + P) % P;
function powm(b, e) { let r = 1n; b = modp(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; }
const D = modp(-121665n * powm(121666n, P - 2n));
function onCurve(bytes) {
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  if (y >= P) return false;
  const y2 = y * y % P, x2 = modp((y2 - 1n) * powm(D * y2 + 1n, P - 2n));
  return x2 === 0n || powm(x2, (P - 1n) / 2n) === 1n;
}
async function findPda(seeds, programId) {
  const tail = new TextEncoder().encode('ProgramDerivedAddress'), prog = b58dec(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), prog, tail];
    const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    if (!onCurve(h)) return b58enc(h);
  }
  throw new Error('no pda');
}
const ata = (owner, mint, tokenProgram) => findPda([b58dec(owner), b58dec(tokenProgram), b58dec(mint)], ATA_PROG);

// ---------- public RPC (live balances only) ----------
let rid = 1;
async function rpc(method, params, tries = 4) {
  let last;
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(FREE_RPCS[t % FREE_RPCS.length], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rid++, method, params }) });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      const j = await r.json(); if (j.error) throw new Error(j.error.message || 'rpc error');
      return j.result;
    } catch (e) { last = e; await sleep(400 * (t + 1)); }
  }
  throw last;
}

// ---------- prices / market data ----------
const market = {};
async function loadMarket() {
  const solP = fetch('https://lite-api.jup.ag/price/v3?ids=' + SOL).then(r => r.json()).then(j => j[SOL]?.usdPrice).catch(() => null);
  try {
    const pairs = await (await fetch('https://api.dexscreener.com/tokens/v1/solana/' + MINT)).json();
    const p = (pairs || []).find(x => x.pairAddress === POOL) || (pairs || [])[0];
    if (p) market[MINT] = { price: p.priceUsd ? Number(p.priceUsd) : null, priceNative: Number(p.priceNative) || null, mcap: p.marketCap || p.fdv || null, liq: p.liquidity?.usd ?? null, vol: p.volume?.h24 ?? null, chg: p.priceChange?.h24 ?? null, image: p.info?.imageUrl || null, url: p.url };
  } catch (e) { console.warn('dexscreener', e); }
  let sol = await solP;
  if (!sol && market[MINT]?.price && market[MINT]?.priceNative) sol = market[MINT].price / market[MINT].priceNative;
  market[SOL] = { price: sol || null };
}
const priceOf = m => market[m]?.price ?? null;

// ---------- balances ----------
async function loadBalance(wallet) {
  const out = { sol: null, tok: null, src: null };
  try {
    const j = await (await fetch('https://lite-api.jup.ag/ultra/v1/holdings/' + wallet)).json();
    if (j && (j.tokens || j.uiAmount != null)) { out.tok = (j.tokens?.[MINT] || []).reduce((s, a) => s + Number(a.uiAmount || 0), 0); out.sol = j.uiAmount ?? null; out.src = 'Jupiter'; return out; }
  } catch {}
  try {
    const a = await ata(wallet, MINT, TOKEN22);
    const [acc, bal] = await Promise.all([rpc('getAccountInfo', [a, { encoding: 'jsonParsed' }]), rpc('getBalance', [wallet])]);
    out.tok = Number(acc?.value?.data?.parsed?.info?.tokenAmount?.uiAmount || 0); out.sol = (bal?.value ?? 0) / 1e9; out.src = 'public RPC (main token account)';
  } catch { out.src = null; }
  return out;
}

// ---------- data files ----------
const dataCache = {};
async function loadData(name) {
  if (!dataCache[name]) dataCache[name] = fetch('data/' + name + '.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).catch(e => { delete dataCache[name]; throw e; });
  return dataCache[name];
}
const card = (k, v, sub, hl) => `<div class="card${hl ? ' hl' : ''}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
const KNOWN = { [DISTRIBUTOR]: 'StonkFun reward wallet', GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL: 'Raydium pool' };
function walletCell(w) {
  const lbl = KNOWN[w] ? `<span class="lbl">${esc(KNOWN[w])}</span>` : '';
  return `<a class="mono" href="https://solscan.io/account/${esc(w)}" target="_blank" rel="noopener" title="${esc(w)}">${esc(short(w))}</a>${lbl}<a class="x" href="#/w/${esc(w)}" title="Open this wallet's rewards">rewards ›</a>`;
}
const rankCell = i => i < 3 ? `<span class="medal g${i + 1}">${i + 1}</span>` : `<span class="rk">${i + 1}</span>`;

// ---------- wallet ----------
let curWallet = null;
async function showWallet(wallet) {
  curWallet = wallet;
  $('#wallet').classList.remove('hidden');
  $('#wAddr').textContent = short(wallet); $('#wAddr').title = wallet;
  $('#wLinks').innerHTML = `<a href="https://solscan.io/account/${esc(wallet)}" target="_blank" rel="noopener">Solscan</a> · full address <span class="mono">${esc(wallet)}</span>`;
  $('#sumCards').innerHTML = ''; $('#tokCards').innerHTML = ''; $('#payRows').innerHTML = ''; $('#winNote').textContent = '';
  const prog = (t, f) => { $('#prog').classList.remove('hidden'); $('#progTxt').textContent = t; $('#progBar').style.width = Math.round((f || 0) * 100) + '%'; };
  setBusy(true);
  try {
    prog('Loading payout history and live balance…', 0.2);
    const [W, L, bal] = await Promise.all([loadData('wallets'), loadData('leaderboard'), loadBalance(wallet), market[SOL] ? null : loadMarket()]);
    if (curWallet !== wallet) return;
    const w = W.w[wallet] || null, solPx = priceOf(SOL), tokPx = priceOf(MINT);
    const pays = w ? w.p.map(([ts, lam, si]) => ({ ts, sol: lam / 1e9, sig: W.sigs[si] })).sort((a, b) => b.ts - a.ts) : [];
    const tot = pays.reduce((s, p) => s + p.sol, 0), first = pays.length ? pays[pays.length - 1].ts : null, lastP = pays.length ? pays[0].ts : null;
    const days = first ? Math.max(1, (Date.now() / 1000 - first) / 86400) : null;
    $('#winNote').innerHTML = `<b>Lifetime history</b> from the snapshot built ${esc(fmtET(Date.parse(L.generatedAt) / 1000))} (${esc(ago(Date.parse(L.generatedAt) / 1000))}): every SOL payout for holding $GROYPER since launch (first payout ${esc(fmtET(L.first))}). Payouts newer than the snapshot appear at the next refresh.`;
    const L30 = pays.filter(p => p.ts >= Date.now() / 1000 - 30 * 86400).reduce((s, p) => s + p.sol, 0);
    $('#sumCards').innerHTML =
      card('SOL received · lifetime', `${fmtNum(tot, 4)} SOL`, `${fmtUsd(tot * (solPx || 0))} at today's SOL price`, true)
      + card('Rank', w ? `#${w.r.toLocaleString()}` : '—', `of ${L.wallets.toLocaleString()} wallets ever paid`)
      + card('Last 30 days', `${fmtNum(L30, 4)} SOL`, `${fmtUsd(L30 * (solPx || 0))} · ${pays.filter(p => p.ts >= Date.now() / 1000 - 30 * 86400).length} payouts`)
      + card('Average per day', days ? `${fmtNum(tot / days, 5)} SOL` : '—', first ? `since first payout ${esc(fmtDay(first))} (${Math.round(days)} days)` : 'no payouts yet');
    const b = bal.tok, bUsd = b != null && tokPx ? b * tokPx : null;
    const elig = b == null ? '<span class="tag">balance unknown</span>' : !b ? '<span class="tag">not held</span>' : b >= MIN_HOLD ? '<span class="tag ok">above ~100K minimum</span>' : '<span class="tag no">below ~100K minimum</span>';
    const m = market[MINT] || {};
    $('#tokCards').innerHTML = `<div class="tok"><div class="tokH"><img src="img/groyper.jpg" alt="GROYPER logo"><div><div class="nm">$GROYPER<small>Groyper</small></div><div class="muted sm">3% transfer tax · paid in SOL</div></div>
      <div class="rw">${fmtPrice(m.price)}<br>${m.mcap ? 'mcap ' + fmtUsd(m.mcap) : ''}</div></div>
      <div class="kv">
        <span>Balance now</span><span>${b == null ? '—' : fmtNum(b)} GROYPER${bUsd != null && b ? ` · ${fmtUsd(bUsd)}` : ''}</span>
        <span>Eligibility <span class="est">estimate</span></span><span>${elig}</span>
        <span>Received · lifetime</span><span class="big">${fmtNum(tot, 5)} SOL</span>
        <span>Value at today's price</span><span>${solPx ? fmtUsd(tot * solPx) : '—'}</span>
        <span>Payouts</span><span>${pays.length.toLocaleString()}${lastP ? ` · last ${esc(ago(lastP))}` : ''}</span>
        <span>First payout</span><span>${first ? esc(fmtET(first)) : '—'}</span>
        <span>Balance source</span><span>${esc(bal.src || 'unavailable')}</span>
      </div></div>`;
    const rows = pays.slice(0, 300);
    $('#payCount').textContent = pays.length ? `(${pays.length.toLocaleString()} total${pays.length > 300 ? ', latest 300 shown' : ''})` : '';
    $('#payRows').innerHTML = rows.map(p => `<tr><td>${esc(fmtET(p.ts))}</td><td class="r">${fmtNum(p.sol, 6)} SOL</td><td class="r">${solPx ? fmtUsd(p.sol * solPx) : '—'}</td><td><a href="https://solscan.io/tx/${esc(p.sig)}" target="_blank" rel="noopener">${esc(p.sig.slice(0, 8))}…</a></td></tr>`).join('');
    $('#payEmpty').textContent = pays.length ? '' : `This wallet has not received a $GROYPER SOL payout up to the snapshot. Payouts go to wallets holding about ${MIN_HOLD.toLocaleString()}+ GROYPER, every 1–3 days.`;
    const btn = $('#btnCsv'); btn.classList.toggle('hidden', !pays.length);
    btn.onclick = () => {
      const lines = ['time_utc,reward_asset,amount_sol,signature'].concat(pays.map(p => [new Date(p.ts * 1000).toISOString(), 'SOL', p.sol, p.sig].join(',')));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      a.download = `groyper-rewards-${wallet.slice(0, 8)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    prog(`Done. ${pays.length.toLocaleString()} payout${pays.length === 1 ? '' : 's'} found.`, 1);
    fcSetWallet(wallet, b);
  } catch (e) {
    console.error(e); prog('Could not load the data right now. Try again in a minute.', 0);
  } finally { setBusy(false); }
}

// ---------- overview ----------
async function renderOverview() {
  let L; try { L = await loadData('leaderboard'); } catch { $('#ovRows').innerHTML = '<tr><td colspan="8" class="muted">Could not load data.</td></tr>'; return; }
  const m = market[MINT] || {}, solPx = priceOf(SOL);
  const days = Math.max(1, (L.last - L.first) / 86400);
  const pend = L.pending;
  $('#ovCards').innerHTML = card('SOL paid to holders', `${fmtNum(L.totalSol, 2)} SOL`, `${solPx ? fmtUsd(L.totalSol * solPx) + ' at today\'s price · ' : ''}lifetime`, true)
    + card('Wallets paid', L.wallets.toLocaleString(), `${L.payouts.toLocaleString()} payouts · ${L.txs.toLocaleString()} txs`)
    + card('Last payout', esc(fmtDay(L.last)), esc(ago(L.last)))
    + card('Waiting to be paid', pend ? `${fmtNum(pend.undistributed, 3)} SOL` : '—', pend ? 'undistributed, per StonkFun at build time' : '');
  const chg = m.chg != null ? `<span class="${m.chg >= 0 ? 'up' : 'down'} sm"> ${m.chg >= 0 ? '+' : ''}${m.chg.toFixed(1)}%</span>` : '';
  const links = [m.url && `<a href="${esc(m.url)}" target="_blank" rel="noopener">chart</a>`, `<a href="https://www.stonkfun.xyz/" target="_blank" rel="noopener">stonkfun</a>`, `<a href="https://solscan.io/token/${MINT}" target="_blank" rel="noopener">mint</a>`, `<a href="https://x.com/groyperpump" target="_blank" rel="noopener">X</a>`].filter(Boolean).join(' · ');
  $('#ovRows').innerHTML = `<tr><td><div class="tcell"><img src="img/groyper.jpg" alt="GROYPER logo"><div><b>$GROYPER</b> <span class="muted sm">Groyper</span><br><span class="sm">${links}</span></div></div></td>
    <td class="r">${fmtPrice(m.price)}${chg}</td><td class="r">${fmtUsd(m.mcap)}${m.liq != null ? `<br><span class="muted sm">liq ${fmtUsd(m.liq)}</span>` : ''}</td><td class="r">${fmtUsd(m.vol)}</td>
    <td>SOL <span class="muted sm">3% tax</span></td><td class="r dist">${fmtNum(L.totalSol, 2)} SOL<span class="muted sm">${fmtUsd(L.totalSol * (solPx || 0))} today · ${L.txs.toLocaleString()} payout txs · ${L.wallets.toLocaleString()} wallets</span></td>
    <td class="r">${fmtNum(L.totalSol / days, 2)} SOL</td><td>${esc(fmtET(L.last))}<br><span class="muted sm">${esc(ago(L.last))}</span></td></tr>`;
  const v = L.verify;
  $('#ovNote').innerHTML = `Lifetime totals from StonkFun's payout ledger for this mint, built ${esc(fmtET(Date.parse(L.generatedAt) / 1000))}. On-chain check: all ${L.payouts.toLocaleString()} payouts re-read from Solana; ${v.rowsExact.toLocaleString()} match the holder's wSOL balance change exactly, ${v.rowsCombined} were paid in a batch that also paid the same wallet for another StonkFun token (on-chain amount ≥ ledger), ${v.rowsZero} are zero-amount ledger rows, ${v.rowsShort} fall short. Avg per day = lifetime ÷ days between first and last payout (launch day alone paid ${fmtNum(L.daily[0]?.[1], 1)} SOL). USD uses today's SOL price.`;
}

// ---------- SOL leaders ----------
let lbShown = 25;
async function renderLbSol() {
  let d; try { d = await loadData('leaderboard'); } catch { $('#lbSolRows').innerHTML = '<tr><td colspan="6" class="muted">Could not load the leaderboard data.</td></tr>'; return; }
  const px = priceOf(SOL);
  const t25 = d.top.slice(0, 25).reduce((s, r) => s + r.sol, 0);
  $('#lbSolCards').innerHTML = card('SOL paid to holders', `${fmtNum(d.totalSol, 2)} SOL`, px ? fmtUsd(d.totalSol * px) + ' today' : '', true)
    + card('Payout txs', d.txs.toLocaleString(), `${d.payouts.toLocaleString()} payouts`)
    + card('Wallets paid', d.wallets.toLocaleString(), `since ${esc(fmtDay(d.first))}`)
    + card('Top 25 share', d.totalSol ? (t25 / d.totalSol * 100).toFixed(1) + '%' : '—', 'of all SOL paid');
  $('#lbSolNote').innerHTML = `Covers <b>every</b> $GROYPER SOL payout (${d.txs.toLocaleString()} transactions from StonkFun's reward wallets) from <b>${esc(fmtET(d.first))}</b> to <b>${esc(fmtET(d.last))}</b>. Snapshot built ${esc(fmtET(Date.parse(d.generatedAt) / 1000))} (${esc(ago(Date.parse(d.generatedAt) / 1000))}). Attribution: StonkFun's public ledger for this mint, every row re-checked against the holder's on-chain wSOL balance change. "GROYPER now" is the wallet's balance at the snapshot. USD uses today's SOL price.`;
  $('#lbSolRows').innerHTML = d.top.slice(0, lbShown).map((r, i) => `<tr><td class="r">${rankCell(i)}</td><td class="w">${walletCell(r.w)}</td><td class="r"><b>${fmtNum(r.sol, 3)}</b> SOL</td><td class="r">${px ? fmtUsd(r.sol * px) : '—'}</td><td class="r">${r.n.toLocaleString()}</td><td class="r">${r.bal ? fmtNum(r.bal, 0) : '<span class="muted">0</span>'}</td></tr>`).join('');
  $('#btnLbMore').classList.toggle('hidden', lbShown >= d.top.length);
}
$('#btnLbMore').addEventListener('click', () => { lbShown = 100; renderLbSol(); });

// ---------- burns + locks ----------
async function renderBurns() {
  let d; try { d = await loadData('burns'); } catch { $('#burnRows').innerHTML = '<tr><td colspan="5" class="muted">Could not load the burn data.</td></tr>'; return; }
  const px = priceOf(MINT), init = d.supply.initial || 1e9, bu = d.burned;
  const pct = x => (x / init * 100).toFixed(x / init < 0.0001 ? 5 : 3) + '%';
  const full = x => x.toLocaleString('en-US', { maximumFractionDigits: 0 });
  $('#burnCards').innerHTML = card('Burned (destroyed)', `${fmtNum(bu.amount, 0)} GROYPER`, `${pct(bu.amount)} of supply${px ? ' · ' + fmtUsd(bu.amount * px) : ''}`, true)
    + card('Burn transactions', bu.count.toLocaleString(), `${bu.burners.toLocaleString()} wallet${bu.burners === 1 ? '' : 's'}`)
    + card('Supply now', `${fmtNum(d.supply.current, 0)}`, `of ${fmtNum(init, 0)} initial`)
    + card('Tax withheld on mint', d.transferFee ? `${fmtNum(d.transferFee.withheldOnMint, 0)} GROYPER` : '—', d.transferFee ? `3% transfer fee waiting to be swapped to SOL${px ? ' · ' + fmtUsd(d.transferFee.withheldOnMint * px) : ''}` : '');
  const check = bu.matchesSupply ? `Cross-check passed: initial supply ${init.toLocaleString('en-US')} − current supply ${d.supply.current.toLocaleString('en-US', { maximumFractionDigits: 6 })} = ${fmtNum(d.supply.burnedBySupply, 2)} GROYPER, exactly the sum of the burns listed.`
    : `Note: initial − current supply = ${fmtNum(d.supply.burnedBySupply, 2)} GROYPER, while the listed burns add to ${fmtNum(bu.amount, 2)}.`;
  $('#burnNote').innerHTML = `Scanned <b>every</b> successful transaction that touched the GROYPER mint (${d.range.txsScanned.toLocaleString()} txs) from its creation on <b>${esc(fmtET(d.range.from))}</b> up to the snapshot at <b>${esc(fmtET(d.generatedAt))}</b> (${esc(ago(d.generatedAt))}). ${check} Burns are small: there is no burn program or buyback-burn for GROYPER; the tax goes to holders as SOL. USD uses today's price.`;
  $('#burnTopRows').innerHTML = d.topBurners.length ? d.topBurners.map((r, i) => `<tr><td class="r">${rankCell(i)}</td><td>${walletCell(r.w)}</td><td class="r"><b>${fmtNum(r.amount, 2)}</b></td><td class="r">${px ? fmtUsd(r.amount * px) : '—'}</td><td class="r">${r.n}</td><td>${esc(fmtET(r.last))}</td></tr>`).join('') : '<tr><td colspan="6" class="muted">No burns found.</td></tr>';
  $('#burnCount').textContent = `(${bu.count.toLocaleString()} total, newest first)`;
  $('#burnRows').innerHTML = d.burns.map(b => `<tr><td>${esc(fmtET(b.ts))}</td><td class="r">${fmtNum(b.amount, b.amount < 1 ? 6 : 2)}</td><td class="r">${px ? fmtUsd(b.amount * px) : '—'}</td><td>${walletCell(b.w)}</td><td><a href="https://solscan.io/tx/${esc(b.sig)}" target="_blank" rel="noopener">${esc(b.sig.slice(0, 8))}…</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No burns found.</td></tr>';
  const lk = d.locked, lq = d.liquidity;
  $('#lockCards').innerHTML = (lq ? card('Pool liquidity locked', `${lq.lockedPct.toFixed(lq.lockedPct === 100 ? 0 : 2)}%`, `of the GROYPER/SOL LP tokens, since ${esc(fmtDay(lq.lockTx?.ts))}`, true) : '')
    + card('Locked wallet supply', `${fmtNum(lk.total, 0)} GROYPER`, lk.wallets.length ? `${lk.wallets.length} wallet(s)` : 'no provably locked wallets found')
    + card('Holders checked', (lk.holdersScanned || 0).toLocaleString(), `${(lk.tokenAccounts || 0).toLocaleString()} token accounts`);
  $('#lpNote').innerHTML = lq ? `<b>Liquidity lock:</b> all ${fmtNum(lq.supply, 2)} LP tokens of the Raydium CPMM pool <a class="mono" href="https://solscan.io/account/${esc(lq.pool)}" target="_blank" rel="noopener">${esc(short(lq.pool))}</a> sit in one account <a class="mono" href="https://solscan.io/account/${esc(lq.lockAccount)}" target="_blank" rel="noopener">${esc(short(lq.lockAccount))}</a> owned by Raydium's lock authority <a class="mono" href="https://solscan.io/account/${esc(lq.lockOwner)}" target="_blank" rel="noopener">${esc(short(lq.lockOwner))}</a> (a program address, no private key). It was locked by Raydium's <code>LockCpLiquidity</code> in the graduation transaction <a href="https://solscan.io/tx/${esc(lq.lockTx?.sig)}" target="_blank" rel="noopener">${esc((lq.lockTx?.sig || '').slice(0, 8))}…</a> (${esc(fmtET(lq.lockTx?.ts))}), and that is the only transaction that has ever touched it. The pool's ~${fmtNum(lk.checkedNotCounted?.[0]?.amount, 0)} GROYPER can still be bought out by traders, so it is <b>not</b> counted as locked supply.` : '';
  $('#lockNote').innerHTML = `Locked wallet supply: checked all ${(lk.tokenAccounts || 0).toLocaleString()} GROYPER token accounts (${(lk.holdersScanned || 0).toLocaleString()} holders with a balance) at the snapshot. ${esc(lk.rules || '')} Result: <b>${lk.wallets.length ? lk.wallets.length + ' locked wallet(s)' : 'none'}</b>. The Solana incinerator holds ${fmtNum(d.incinerator?.balance || 0, 0)} GROYPER.`;
  $('#lockCheckedRows').innerHTML = (lk.checkedNotCounted || []).map(r => `<tr><td class="w"><a class="mono" href="https://solscan.io/account/${esc(r.w)}" target="_blank" rel="noopener">${esc(short(r.w))}</a></td><td class="r">${full(r.amount)}</td><td class="r">${pct(r.amount)}</td><td class="why">${esc(r.why)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None.</td></tr>';
  if (location.hash === '#/burns/locked' && !renderBurns.jumped) { renderBurns.jumped = true; setTimeout(() => $('#locked').scrollIntoView({ block: 'start' }), 0); }
}

// ---------- rewards forecast ----------
// Estimate only: SOL to all holders per day = projected daily volume (USD) x reward rate (USD paid / USD volume, measured
// from past payouts in data/forecast.json) / SOL price. Your share = holding / eligible supply (measured from recent payouts).
const FC_H = [[1, '1 day'], [7, '7 days'], [30, '30 days'], [182, '6 months']];
const FC_PRE = [[1, 'Now'], [2, '2x MC'], [5, '5x MC'], [10, '10x MC']];
let fc = null, fcD = null;
function parseAmt(v) {
  const m = /^\s*\$?\s*([0-9][0-9,]*\.?[0-9]*|\.[0-9]+)\s*([kmb])?\s*$/i.exec(String(v || ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1);
  return isFinite(n) ? n : null;
}
const logPos = (v, lo, hi) => Math.round(1000 * Math.log(Math.max(lo, Math.min(hi, v)) / lo) / Math.log(hi / lo));
const logVal = (p, lo, hi) => lo * Math.pow(hi / lo, p / 1000);
const nice = v => { const e = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / e) * e; };
const fmtIn = v => v >= 1e4 ? fmtUsd(v).replace('$', '') : Math.round(v).toLocaleString('en-US');
const pctS = (x, dp = 2) => x == null || !isFinite(x) ? '—' : (x * 100).toFixed(dp) + '%';
function fcModel() {
  const s = fcD.src.sol, st = fc;
  const px = priceOf(SOL) || fcD.prices.solUsd;
  const rate = s.d30.rewardRate;
  const wr = (s.weeks || []).slice(0, 6).map(w => w.rate).filter(x => x > 0);
  const mean = wr.length ? wr.reduce((a, b) => a + b, 0) / wr.length : null;
  const lo = mean ? Math.min(1, Math.min(...wr) / mean) : 0.5, hi = mean ? Math.max(1, Math.max(...wr) / mean) : 1.5;
  const perDay = px ? st.vol * rate / px : null;
  const tot = perDay * st.h, elig = s.eligible?.supply || s.supply;
  const share = st.hold > 0 && elig ? Math.min(1, st.hold / elig) : 0;
  const holdUsd = st.hold > 0 && s.supply ? st.hold * st.mc / s.supply : null;
  return { s, px, rate, lo, hi, perDay, tot, elig, share, holdUsd };
}
function fcChart(s) {
  const days = (s.days || []).slice(-30); if (days.length < 5) return '';
  const rate = s.d30.rewardRate, W = 600, H = 120, Pd = 4;
  const mv = d => d.solUsd ? d.volUsd * rate / d.solUsd : 0;
  const max = Math.max(...days.map(d => Math.max(d.paid, mv(d)))) || 1, bw = (W - 2 * Pd) / days.length;
  const y = v => H - Pd - (v / max) * (H - 2 * Pd);
  const bars = days.map((d, i) => `<rect x="${(Pd + i * bw + 1).toFixed(1)}" y="${y(d.paid).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${(H - Pd - y(d.paid)).toFixed(1)}" rx="1.5" fill="#6fae2f"><title>${esc(d.d)}: ${fmtNum(d.paid)} SOL paid · volume ${fmtUsd(d.volUsd)}</title></rect>`).join('');
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${(Pd + i * bw + bw / 2).toFixed(1)} ${y(mv(d)).toFixed(1)}`).join(' ');
  return `<div class="fcChart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily SOL paid vs. volume times rate, last 30 days">${bars}<path d="${line}" fill="none" stroke="#f6c26b" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="fcLeg"><span><i class="b"></i>SOL actually paid per day</span><span><i class="l"></i>volume × ${pctS(rate)} (the model)</span><span class="muted">last 30 full days (UTC) · ${esc(days[0].d)} → ${esc(days[days.length - 1].d)} · payouts are batched every 1–3 days, so single days jump around</span></div></div>`;
}
function fcDraw() {
  const root = $('#fcSol'); if (!root || !fc || !fcD) return;
  const m = fcModel(), q = id => root.querySelector('[data-fc="' + id + '"]'); if (!q('mc')) return;
  const st = fc;
  if (document.activeElement !== q('mc')) q('mc').value = fmtIn(st.mc);
  if (document.activeElement !== q('vol')) q('vol').value = fmtIn(st.vol);
  q('mcR').value = logPos(st.mc, st.mcLo, st.mcHi); q('volR').value = logPos(st.vol, st.volLo, st.volHi);
  root.querySelectorAll('[data-h]').forEach(b => b.classList.toggle('on', Number(b.dataset.h) === st.h));
  root.querySelectorAll('[data-pre]').forEach(b => b.classList.toggle('on', st.pre === Number(b.dataset.pre)));
  const hl = FC_H.find(h => h[0] === st.h)[1];
  const usd = x => m.px ? fmtUsd(x * m.px) : '—';
  const rng = x => `${fmtNum(x * m.lo, 3)} – ${fmtNum(x * m.hi, 3)} SOL`;
  const you = m.tot * m.share;
  q('out').innerHTML =
    card(`All GROYPER holders · ${esc(hl)}`, `${fmtNum(m.tot, 3)} SOL`, `≈ ${usd(m.tot)} · range ${rng(m.tot)}`, true)
    + card(`Your estimate · ${esc(hl)}`, st.hold > 0 ? `${fmtNum(you, 4)} SOL` : '—', st.hold > 0 ? `≈ ${usd(you)} · ${pctS(m.share, m.share < 0.001 ? 4 : 2)} of eligible supply` : 'Enter a holding or wallet below')
    + card('Per day · all holders', `${fmtNum(m.perDay, 3)} SOL`, `≈ ${usd(m.perDay)} at ${fmtUsd(st.vol)}/day volume`)
    + card(`Per 1M GROYPER held · ${esc(hl)}`, `${fmtNum(m.elig ? m.tot * 1e6 / m.elig : null, 4)} SOL`, `≈ ${m.elig ? usd(m.tot * 1e6 / m.elig) : '—'}`);
  q('rate').innerHTML = `Reward rate used: <b>${pctS(m.rate)}</b> of trading volume paid to holders as SOL (measured, last 30 days; the token's transfer tax is 3%). SOL price ${fmtPrice(m.px)} (today).`;
  q('hold').classList.toggle('bad', st.holdErr);
  q('holdNote').innerHTML = st.holdMsg || (st.hold > 0 ? `${fmtNum(st.hold, 0)} GROYPER ≈ ${fmtUsd(m.holdUsd)} at this market cap${st.hold < MIN_HOLD ? ' · <span class="tag no">below the ~100K minimum, may receive nothing</span>' : ''}` : `Eligible supply ≈ ${fmtNum(m.elig, 0)} GROYPER (measured from recent payouts)`);
  q('warn').classList.toggle('hidden', st.h < 30);
}
function fcSetWallet(w, bal) { if (!fc) { fcPending = [w, bal]; return; } const i = $('#fcSol [data-fc="hold"]'); if (i && !i.value) { i.value = w; fc.hold = bal || 0; fc.holdMsg = `Wallet <span class="mono">${esc(short(w))}</span> holds <b>${fmtNum(fc.hold, 0)} GROYPER</b>.`; fcDraw(); } }
let fcPending = null;
async function renderForecast() {
  const root = $('#fcSol'); if (!root) return;
  try { fcD = await loadData('forecast'); } catch { root.innerHTML = '<p class="muted">Could not load the forecast data.</p>'; return; }
  const s = fcD.src.sol, live = market[MINT] || {};
  const liveMc = live.mcap || s.live?.mcUsd, liveVol = live.vol ?? s.live?.vol24Usd ?? s.d7.volUsdPerDay;
  if (!fc) {
    fc = { mc: liveMc, vol: liveVol, h: 30, pre: 1, hold: 0, holdMsg: '', holdErr: false, baseMc: liveMc, baseVol: liveVol };
    fc.mcLo = nice(liveMc / 20); fc.mcHi = nice(liveMc * 200); fc.volLo = 50; fc.volHi = nice(Math.max(liveVol, s.d30.volUsdPerDay, 1000) * 200);
    const wk = (s.weeks || []).slice(0, 6), el = s.eligible;
    root.innerHTML = `
      <div class="secHead"><div><h2>Rewards forecast <span class="est">estimate</span></h2>
        <p class="muted">What $GROYPER holders could receive in <b>SOL</b> at a market cap and daily trading volume you choose, using the reward rate measured from past payouts. Estimate only: not a guarantee and not financial advice.</p></div></div>
      <div class="fcGrid">
        <div class="fcIn">
          <div class="fcPre" role="group" aria-label="Presets">${FC_PRE.map(([x, l]) => `<button type="button" class="chip" data-pre="${x}">${l}</button>`).join('')}</div>
          <p class="muted sm fcPreNote">Presets multiply today's market cap and scale daily volume by the same factor (same turnover as now).</p>
          <label class="fcF"><span>$GROYPER market cap (USD)</span><input data-fc="mc" type="text" inputmode="decimal" aria-label="Projected market cap in USD"></label>
          <input data-fc="mcR" type="range" min="0" max="1000" aria-label="Projected market cap slider">
          <p class="muted sm">Now ${fmtUsd(liveMc)} · the 3% tax is flat, so market cap changes your holding's value, not the reward rate</p>
          <label class="fcF"><span>Daily trading volume (USD)</span><input data-fc="vol" type="text" inputmode="decimal" aria-label="Projected daily volume in USD"></label>
          <input data-fc="volR" type="range" min="0" max="1000" aria-label="Projected daily volume slider">
          <p class="muted sm">Use: <button type="button" class="btn link sm" data-v="${liveVol}">24h ${fmtUsd(liveVol)}</button> · <button type="button" class="btn link sm" data-v="${s.d7.volUsdPerDay}">7d avg ${fmtUsd(s.d7.volUsdPerDay)}</button> · <button type="button" class="btn link sm" data-v="${s.d30.volUsdPerDay}">30d avg ${fmtUsd(s.d30.volUsdPerDay)}</button></p>
          <div class="fcF"><span>Time horizon</span><div class="seg" role="group" aria-label="Time horizon">${FC_H.map(([d, l]) => `<button type="button" data-h="${d}">${l}</button>`).join('')}</div></div>
          <label class="fcF"><span>Your $GROYPER holding</span><span class="fcHold"><input data-fc="hold" type="text" spellcheck="false" placeholder="Amount (e.g. 5m) or wallet address" aria-label="Your holding amount or wallet address"><button type="button" class="btn sm" data-fc="holdGo">Apply</button></span></label>
          <p class="muted sm" data-fc="holdNote"></p>
        </div>
        <div class="fcRes">
          <div class="cards fcCards" data-fc="out"></div>
          <p class="sm fcRate" data-fc="rate"></p>
          <div class="note fcWarn hidden" data-fc="warn"><b>Long horizon:</b> 30-day and especially 6-month numbers are extra uncertain. They assume today's volume, holder base and SOL price hold for the whole period, which rarely happens for small-cap coins. Treat them as a what-if, not an expectation.</div>
        </div>
      </div>
      ${fcChart(s)}
      <details class="fcHow"><summary>How this estimate works</summary>
        <p><b>Formula.</b> SOL to all holders per day = daily volume (USD) × reward rate ÷ SOL price (USD). Period total = per day × days. Your rewards = that × your holding ÷ eligible supply.</p>
        <p><b>Reward rate.</b> USD value of SOL paid to holders ÷ USD trading volume of the GROYPER/SOL pool. Last 30 full days: ${fmtNum(s.d30.paid, 2)} SOL (${fmtUsd(s.d30.paidUsd)}) on ${fmtUsd(s.d30.volUsd)} volume = <b>${pctS(s.d30.rewardRate)}</b>; last 7 days: ${fmtNum(s.d7.paid, 2)} SOL on ${fmtUsd(s.d7.volUsd)} = <b>${pctS(s.d7.rewardRate)}</b>; lifetime ${fmtNum(s.lifetime.paid, 1)} SOL (${fmtUsd(s.lifetime.paidUsd)}) on ${fmtUsd(s.lifetime.volUsd)} = ${pctS(s.lifetime.paidUsd / s.lifetime.volUsd)}. That matches the token's 3% transfer tax (a 3% Token-2022 fee on each buy and sell, harvested and swapped to SOL by StonkFun). ${fmtNum(s.d30.rewardPerUsdVol, 7)} SOL paid per $1 of volume (30d).</p>
        <p><b>Range.</b> Lowest and highest weekly reward rate of the last ${wk.length} weeks: ${wk.map(w => pctS(w.rate)).join(' · ') || '—'}. Payouts arrive in batches every 1–3 days, so weeks vary.</p>
        <p><b>Eligible supply.</b> ${fmtNum(el?.supply, 0)} GROYPER of ${fmtNum(s.supply, 0)} total: measured from the last 2 days of payouts (${el?.wallets ?? '—'} wallets paid; each wallet's share of payouts matches its share of this amount). The Raydium pool and wallets under the minimum (~${MIN_HOLD.toLocaleString()} GROYPER; smallest recent recipient holds ${fmtNum(el?.smallestRecipient, 0)}) are not paid.</p>
        <p><b>Assumes:</b> the volume you enter is sustained every day; StonkFun keeps the same 3% tax and payout process; USD uses today's SOL price; your holding and other holders' balances don't change. Data: StonkFun payout ledger (every payout re-checked on Solana), GeckoTerminal daily volume and prices for the GROYPER/SOL pool, DexScreener live market cap and 24h volume. Snapshot built ${esc(fmtET(fcD.generatedAt))} (${esc(ago(fcD.generatedAt))}).</p>
      </details>
      <p class="muted sm fcDisc">Estimate based on past payout rates. Not a guarantee of future rewards and not financial advice. Rewards depend on future trading volume, which nobody can predict.</p>`;
    const q = id => root.querySelector('[data-fc="' + id + '"]');
    root.querySelectorAll('[data-pre]').forEach(b => b.addEventListener('click', () => { const x = Number(b.dataset.pre); fc.pre = x; fc.mc = fc.baseMc * x; fc.vol = fc.baseVol * x; fcDraw(); }));
    root.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => { fc.h = Number(b.dataset.h); fcDraw(); }));
    root.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { fc.vol = Number(b.dataset.v); fc.pre = null; fcDraw(); }));
    q('mcR').addEventListener('input', e => { fc.mc = nice(logVal(+e.target.value, fc.mcLo, fc.mcHi)); fc.pre = null; fcDraw(); });
    q('volR').addEventListener('input', e => { fc.vol = nice(logVal(+e.target.value, fc.volLo, fc.volHi)); fc.pre = null; fcDraw(); });
    q('mc').addEventListener('change', e => { const v = parseAmt(e.target.value); if (v > 0) { fc.mc = v; fc.pre = null; } fcDraw(); });
    q('vol').addEventListener('change', e => { const v = parseAmt(e.target.value); if (v >= 0) { fc.vol = v; fc.pre = null; } fcDraw(); });
    const applyHold = async () => {
      const raw = q('hold').value.trim(); fc.holdErr = false; fc.holdMsg = '';
      if (!raw) { fc.hold = 0; return fcDraw(); }
      if (isAddress(raw)) {
        fc.holdMsg = 'Looking up the wallet…'; fcDraw();
        const b = await loadBalance(raw);
        if (b.tok == null) { fc.holdErr = true; fc.holdMsg = 'Could not read that wallet right now. Enter the amount instead.'; }
        else { fc.hold = b.tok; fc.holdMsg = `Wallet <span class="mono">${esc(short(raw))}</span> holds <b>${fmtNum(fc.hold, 0)} GROYPER</b>${fc.hold ? '' : ' (nothing to forecast)'}.`; }
        return fcDraw();
      }
      const v = parseAmt(raw); if (v == null) { fc.holdErr = true; fc.holdMsg = 'Enter an amount like 2500000 or 2.5m, or a Solana wallet address.'; } else fc.hold = v;
      fcDraw();
    };
    q('holdGo').addEventListener('click', applyHold);
    q('hold').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyHold(); } });
    if (fcPending) { const [w, b] = fcPending; fcPending = null; fcSetWallet(w, b); }
  } else if (fc.pre === 1 && liveMc && (liveMc !== fc.baseMc || liveVol !== fc.baseVol)) {
    fc.baseMc = fc.mc = liveMc; fc.baseVol = fc.vol = liveVol;
  }
  fcDraw();
  if (/\/forecast$/.test(location.hash) && !renderForecast.jumped) { renderForecast.jumped = true; setTimeout(() => root.scrollIntoView({ block: 'start' }), 0); }
}

// ---------- routing ----------
const PANES = { rewards: renderOverview, sol: () => { renderLbSol(); renderForecast(); }, burns: renderBurns };
let curPane = null, lastWallet = null;
function route() {
  const h = location.hash || '#/';
  const hb = h.replace(/\/forecast$/, '');
  const pane = hb === '#/leaders/sol' ? 'sol' : (h === '#/burns' || h === '#/burns/locked') ? 'burns' : 'rewards';
  document.querySelectorAll('[data-pane]').forEach(el => el.classList.toggle('hidden', el.dataset.pane !== pane));
  document.querySelectorAll('.tab').forEach(el => { const on = el.dataset.tab === pane; el.classList.toggle('on', on); el.setAttribute('aria-selected', on); });
  const changed = curPane !== pane; curPane = pane;
  PANES[pane]?.();
  if (pane === 'rewards') {
    const m = /^#\/w\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(h);
    if (m && m[1] !== lastWallet) { lastWallet = m[1]; $('#addr').value = m[1]; go(m[1]); return; }
    const anchor = /^#([a-z]+)$/.exec(h);
    if (anchor && document.getElementById(anchor[1])) { setTimeout(() => document.getElementById(anchor[1]).scrollIntoView({ block: 'start' }), 0); return; }
  }
  if (changed) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- UI wiring ----------
function setBusy(b) { $('#btnGo').disabled = b; $('#btnRefresh').disabled = b; $('#btnGo').textContent = b ? 'Loading…' : 'Check rewards'; }
function go(addr) {
  addr = (addr || '').trim();
  if (!isAddress(addr)) { $('#addr').setCustomValidity('That does not look like a Solana address'); $('#addr').reportValidity(); return; }
  $('#addr').setCustomValidity('');
  lastWallet = addr;
  if (location.hash !== '#/w/' + addr) history.replaceState(null, '', '#/w/' + addr);
  showWallet(addr);
  setTimeout(() => $('#wallet').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}
$('#f').addEventListener('submit', e => { e.preventDefault(); go($('#addr').value); });
$('#addr').addEventListener('input', () => $('#addr').setCustomValidity(''));
$('#btnExample').addEventListener('click', () => { $('#addr').value = EXAMPLE; go(EXAMPLE); });
$('#btnRefresh').addEventListener('click', () => curWallet && showWallet(curWallet));
$('#btnWallet').addEventListener('click', async () => {
  const p = window.phantom?.solana || window.solflare || window.backpack?.solana || window.solana;
  if (!p?.connect) { alert('No Solana wallet extension found. You can paste your address instead.'); return; }
  try { const r = await p.connect(); const pk = (r?.publicKey || p.publicKey)?.toString(); if (pk) { $('#addr').value = pk; go(pk); } } catch { /* closed */ }
});

(async function init() {
  route();
  await loadMarket();
  PANES[curPane]?.(); // re-render with live prices
  if (curWallet && curPane === 'rewards') showWallet(curWallet);
})();
