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

import { exportValueOf } from "./settlement.js";
import { TECHS } from "./tech.js";

// The organization level at which stamped coin exists — read from the tech
// tree's own Currency gate so the two can never drift apart. This is the
// STATE condition for calibrating the price baseline: prices are measured
// against the era when coin replaces barter, wherever and whenever a world
// actually reaches it.
const CURRENCY_ORG = (() => {
  const t = TECHS.find(t => t.id === "currency");
  if (!t || !t.gate) throw new Error("inflation.js: tech tree has no 'currency' gate — the price-baseline condition must track it");
  return t.gate[1];
})();

const INFLATION_INTERVAL = 50;        // ticks between recompute passes (slow drift)
const EMA_ALPHA          = 0.05;      // per-pass smoothing — over many passes the
                                      // level moves to its new target gradually
const P_MIN              = 0.4;       // clamped price-level range for the SIM
const P_MAX              = 3.0;       // widened (was 1.8) so sustained
                                      // monetary expansion keeps registering as
                                      // real fiscal pressure on army wages /
                                      // building costs. Hard cap at 3x still
                                      // prevents runaway, but the realm
                                      // genuinely feels the squeeze before then.
const RAW_MIN            = 0.2;       // very wide band for the DISPLAY indicator
const RAW_MAX            = 20.0;      // — lets the wheat-price ticker show real
                                      // boom/bust drama (Spanish silver flooded
                                      // Europe ~6x). Cap at 20x just so the
                                      // number doesn't run off the screen during
                                      // pathological pre-calibration noise.
// (The baseline M/T reference is calibrated live — world._inflRef below.)
// Response curve: instead of a flat linear y = 1 + (x-1) * RESPONSE that
// hits the SIM cap and stays there (looks static to the user), use a log-
// shaped curve that keeps nudging up logarithmically even at high raw M/T.
// At raw=1 the curve gives 1; at raw=5 it gives ~1.4; at raw=20 it gives
// ~1.9; at raw=100 it gives ~2.5 — gradually saturating but never quite
// pinned. The SIM still sees meaningful pressure differences between
// "modest inflation" and "massive inflation".
const RESPONSE           = 0.40;       // pre-log multiplier — controls steepness

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
    const ev = exportValueOf(s, world);
    const out = Math.max(1, ev * Math.sqrt(Math.max(1, s.people)));
    T.set(root, (T.get(root) || 0) + out);
  }

  // Calibrate REF once, when the world's monetary economy has actually
  // EMERGED — a state condition, never a step count (cardinal rule 1; the
  // old `step >= 5000` gate locked the baseline at whatever development the
  // clock happened to find, and broke under SIM_GRANULARITY). Conditions:
  //   * stamped coinage exists: the leading capital's organization has
  //     crossed the Currency tech's own gate — coin replaces barter exactly
  //     then, on any map, any seed, at any pace;
  //   * the coin economy is plural: >= 3 trading components actually hold
  //     coin, so the baseline is a cross-network mean rather than one
  //     mining town's ratio.
  // Stored on world._inflRef and used forever after — the whole point is
  // that *changes* from this baseline are what inflation/deflation report.
  let coined = 0;
  if (world._inflRef === undefined) for (const m of M.values()) if (m > 0) coined++;
  if (world._inflRef === undefined && (world._leadOrg || 0) >= CURRENCY_ORG && coined >= 3) {
    let totalM = 0, totalT = 0;
    for (const [root, m] of M) {
      const t = T.get(root) || 1;
      // Aggregate M/T across ALL components — the global coin-to-real-economy
      // ratio. Larger economies dominate the baseline naturally (their bigger M
      // and T both land in the sums) and a tiny coin-poor hamlet barely moves
      // it, without an explicit per-component weighting.
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
    // SIM price: log-shaped saturation. Below raw=1 (deflation) the curve
    // is linear down to P_MIN; above raw=1 (inflation) it grows as 1 +
    // RESPONSE * log(raw), so price keeps responding to monetary expansion
    // even when raw M/T diverges 10-100x — instead of pegging at a hard cap
    // and looking static. Final clamp at P_MAX is just a sanity ceiling.
    const simTarget = raw <= 1
      ? Math.max(P_MIN, 1 + (raw - 1) * RESPONSE)
      : Math.min(P_MAX, 1 + RESPONSE * Math.log(raw));
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
