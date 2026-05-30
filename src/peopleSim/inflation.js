// ── Per-component inflation (quantity theory of money, Tier B) ──────
//
// Money in the sim is a closed system: coin is created by mining (one
// faucet) and circulates by trade. As more coin is dug into a connected
// trading network, prices in THAT NETWORK rise — but a region that has
// no trade link to the mine doesn't see the inflation. This is exactly
// the Spanish-silver-vs-Ming-China story: Potosí silver inflated Europe
// but not isolated Chinese components, because trade between them was
// thin. When a road bridges two components their money supplies merge
// and prices equalise.
//
// We track one price level P per NETWORK COMPONENT (from roads.js), as a
// slow EMA so the number reads as a steady trend rather than tick-jitter.
//
//   P  =  M_component / T_component      (relative to a reference)
//   M  =  sum of coin held in the component
//   T  =  real output proxy, sum over members of
//             max(1, exportValue × √pop)
//         — exportValue × √pop is the existing trade-volume basis; using
//         the same shape as TRADE_RATE keeps T meaningful at any tech
//         level (a backward populous region produces less per capita than
//         a literate one).
//
// All sim prices that should respond to inflation read `localP(world, s)`
// (or `localPByCountry` for state-level money). At P=1 (the reference)
// behaviour is unchanged from the pre-inflation calibration.

import { computeExportValue } from "./settlement.js";

const INFLATION_INTERVAL = 50;        // ticks between recompute passes (slow drift)
const EMA_ALPHA          = 0.05;      // per-pass smoothing — over many passes the
                                      // level moves to its new target gradually
const P_MIN              = 0.5;       // clamped price-level range for the SIM
const P_MAX              = 1.8;       // — sim prices respond modestly so the
                                      // existing calibration isn't broken even
                                      // when raw M/T diverges by 10x. The HUD
                                      // ticker shows the un-clamped indicator
                                      // separately (see globalIndicator below).
const RAW_MIN            = 0.3;       // wider band for the DISPLAY indicator —
const RAW_MAX            = 6.0;       // lets the wheat-price ticker show real
                                      // boom/bust drama while sim stays sane.
const P_REF              = 1.0;       // anchored baseline; calibrated below
// Soft response curve: the raw ratio (m/T)/REF is squashed through
// y = 1 + (x-1) * RESPONSE so a 10x divergence in coin/output becomes a
// ~30% price move in the SIM. Realistic at the macro level (real-world
// money supply changes do NOT translate 1:1 to consumer-price changes
// because velocity and supply respond) and small enough to keep the army
// wage / building cost calibration alive.
const RESPONSE           = 0.04;

// Reference M/T: at the world's initial steady state the average component
// has M/T near this number. P is divided by REF so it lands near 1 at the
// baseline calibration we already have. Computed lazily on the first pass.

export function updateInflation(world) {
  if (world.step % INFLATION_INTERVAL !== 0) return;
  const comps = world._networkComponents;
  if (!comps) return;

  // Per-component sums.
  const M = new Map();   // rootId → coin
  const T = new Map();   // rootId → real-output proxy
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const root = comps.has(s.id) ? comps.get(s.id) : s.id;
    M.set(root, (M.get(root) || 0) + Math.max(0, s.wealth || 0));
    const ev = computeExportValue(s);
    const out = Math.max(1, ev * Math.sqrt(Math.max(1, s.people)));
    T.set(root, (T.get(root) || 0) + out);
  }

  // Calibrate REF once, late enough that the world has a real economy
  // (multiple monetised components, total coin enough that the population-
  // weighted mean M/T is a meaningful baseline). Stored on world._inflRef
  // and used forever after — the whole point is that *changes* from this
  // baseline are what inflation/deflation report.
  if (world._inflRef === undefined && world.step >= 5000) {
    let totalM = 0, totalT = 0;
    for (const [root, m] of M) {
      const t = T.get(root) || 1;
      // Weight components by their T (real economy size) so a tiny coin-poor
      // hamlet doesn't drag the baseline down.
      totalM += m;
      totalT += t;
    }
    if (totalM > 0 && totalT > 0) world._inflRef = totalM / totalT;
  }
  // Until the baseline is locked, behave as if every component's price is 1
  // (no inflation effect on sim prices) so the early game isn't whipsawed by
  // pre-calibration noise.
  if (world._inflRef === undefined) return;
  const REF = world._inflRef;

  // EMA two parallel maps:
  //   _inflP        — SIM-facing price level (tight band, soft response).
  //                   Used by localP() / localPByCountry() to scale wages,
  //                   food prices, building costs. Keeps the calibration
  //                   sane even when raw coin balances diverge by 10x.
  //   _inflRaw      — DISPLAY-facing raw indicator (wide band, linear).
  //                   Shown on the wheat-price ticker so the user sees real
  //                   boom/bust drama from mining + circulation.
  if (!world._inflP) world._inflP = new Map();
  if (!world._inflRaw) world._inflRaw = new Map();
  const Pmap = world._inflP, Rmap = world._inflRaw;
  for (const [root, m] of M) {
    const t = T.get(root) || 1;
    const raw = (m / t) / REF;
    // SIM price: soft squash + tight clamp.
    const simTarget = Math.max(P_MIN, Math.min(P_MAX, 1 + (raw - 1) * RESPONSE));
    const prevP = Pmap.get(root);
    Pmap.set(root, prevP === undefined ? simTarget : prevP * (1 - EMA_ALPHA) + simTarget * EMA_ALPHA);
    // Display indicator: linear, wide clamp.
    const rawTarget = Math.max(RAW_MIN, Math.min(RAW_MAX, raw));
    const prevR = Rmap.get(root);
    Rmap.set(root, prevR === undefined ? rawTarget : prevR * (1 - EMA_ALPHA) + rawTarget * EMA_ALPHA);
  }
  // Drop entries for components that no longer exist (merged / split).
  const live = new Set();
  for (const root of M.keys()) live.add(root);
  for (const root of Pmap.keys()) if (!live.has(root)) Pmap.delete(root);
  for (const root of Rmap.keys()) if (!live.has(root)) Rmap.delete(root);
}

// Look up a settlement's local price level. Falls back to P=1 (baseline) when
// inflation hasn't been computed yet or the settlement isn't in any component.
export function localP(world, s) {
  const Pmap = world._inflP;
  if (!Pmap || !world._networkComponents) return 1;
  const root = world._networkComponents.has(s.id) ? world._networkComponents.get(s.id) : s.id;
  const p = Pmap.get(root);
  return p === undefined ? 1 : p;
}

// Country-level price level — used for state finances (army wages, colony
// grants). Returns the population-weighted average price across the country's
// members, so a realm spanning multiple components pays at the right blend.
export function localPByCountry(world, c) {
  const Pmap = world._inflP;
  if (!Pmap || !world._networkComponents || !c || !c.members) return 1;
  let num = 0, den = 0;
  for (const s of c.members) {
    if (s.mode !== "settled") continue;
    const root = world._networkComponents.has(s.id) ? world._networkComponents.get(s.id) : s.id;
    const p = Pmap.get(root);
    if (p === undefined) continue;
    const w = Math.max(1, s.people);
    num += p * w; den += w;
  }
  return den > 0 ? num / den : 1;
}

// DISPLAY-facing raw indicator (per settlement) — for the wheat-price ticker
// and the per-realm "price level" line. Wider band than the sim-facing P;
// this is what the user sees.
export function displayP(world, s) {
  const Rmap = world._inflRaw;
  if (!Rmap || !world._networkComponents) return 1;
  const root = world._networkComponents.has(s.id) ? world._networkComponents.get(s.id) : s.id;
  const p = Rmap.get(root);
  return p === undefined ? 1 : p;
}

export function displayPByCountry(world, c) {
  const Rmap = world._inflRaw;
  if (!Rmap || !world._networkComponents || !c || !c.members) return 1;
  let num = 0, den = 0;
  for (const s of c.members) {
    if (s.mode !== "settled") continue;
    const root = world._networkComponents.has(s.id) ? world._networkComponents.get(s.id) : s.id;
    const p = Rmap.get(root);
    if (p === undefined) continue;
    const w = Math.max(1, s.people);
    num += p * w; den += w;
  }
  return den > 0 ? num / den : 1;
}
