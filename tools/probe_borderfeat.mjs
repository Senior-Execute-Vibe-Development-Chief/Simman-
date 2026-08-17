// Cause IV instrument: do REALM-REALM borders lie on geography? For every
// adjacent pair of tiles with different realm owners, classify the border
// edge: RIVER (either side carries a major channel), RIDGE (relief high on
// either side), or PLAIN — and compare against the base rate over ALL land
// adjacencies. Real maps are strongly enriched; a cost-bisector map is not.
//
// Lap-3 extension (after four border-mover forms all measured ridge ≈1.0x
// while sparse contact had measured 2.43x): the aggregate can hide WHERE the
// phenomenon lives or an instrument blindness, so also print
//   1. the RELIEF DISTRIBUTION at border edges vs all land edges (quantiles +
//      band shares) — the 0.25 bar samples only range CORES (Alps p50 relief
//      is 0.145; a border wrapping a range FOOT is invisible to it);
//   2. per-pair composition for the longest borders (which pairs, how much
//      river/ridge, seat-to-seat geometry) — consolidation legitimately
//      interiorizes ranges (Rome held the Alps interior), so the residual may
//      live at particular seams, not in the aggregate;
//   3. a size-tier split: edges where the SMALLER partner is below the median
//      realm size (the refuge-statelet tier the REFUGE physics protects) vs
//      giant-giant seams.
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_borderfeat.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
const STEPS = +(process.argv[2] || 24000), W = +(process.argv[3] || 960), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);
const co = world._countryOwner, elev = world.elev, rm = world.riverMag, rel = world.relief, tw = world.tw, th = world.th;
const RIV = 2, RID = 0.25;   // major-channel bar; the measured Himalaya-front relief class
let bT = 0, bR = 0, bG = 0, aT = 0, aR = 0, aG = 0;
const bRelief = [], aRelief = [];            // max relief across each edge
const pairs = new Map();                     // "lo:hi" → {n, riv, rid}
const sizeOf = new Map();                    // cid → held tiles
for (let i = 0; i < tw * th; i++) { const c = co[i]; if (c >= 0 && elev[i] > 0) sizeOf.set(c, (sizeOf.get(c) || 0) + 1); }
const sizes = [...sizeOf.values()].sort((a, b) => a - b);
const medSize = sizes.length ? sizes[(sizes.length / 2) | 0] : 0;
let sT = 0, sR = 0, sG = 0, gT = 0, gR = 0, gG = 0;   // small-tier vs giant-giant border edges
for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
  const i = y * tw + x;
  if (!(elev[i] > 0)) continue;
  for (const j of [y * tw + ((x + 1) % tw), y < th - 1 ? i + tw : -1]) {
    if (j < 0 || !(elev[j] > 0)) continue;
    const river = (rm && (rm[i] >= RIV || rm[j] >= RIV)) ? 1 : 0;
    const ridge = (rel && (rel[i] >= RID || rel[j] >= RID)) ? 1 : 0;
    const relMax = rel ? Math.max(rel[i] || 0, rel[j] || 0) : 0;
    aT++; aR += river; aG += ridge; aRelief.push(relMax);
    if (co[i] >= 0 && co[j] >= 0 && co[i] !== co[j]) {
      bT++; bR += river; bG += ridge; bRelief.push(relMax);
      const lo = Math.min(co[i], co[j]), hi = Math.max(co[i], co[j]);
      const k = lo + ":" + hi;
      let e = pairs.get(k); if (!e) pairs.set(k, e = { lo, hi, n: 0, riv: 0, rid: 0 });
      e.n++; e.riv += river; e.rid += ridge;
      const small = Math.min(sizeOf.get(lo) || 0, sizeOf.get(hi) || 0);
      if (small < medSize) { sT++; sR += river; sG += ridge; } else { gT++; gR += river; gG += ridge; }
    }
  }
}
const f = (n, d) => (100 * n / Math.max(1, d)).toFixed(1);
console.log(`[borderfeat] step ${STEPS} borderEdges=${bT} realms=${sizeOf.size} medianRealmTiles=${medSize}`);
console.log(`  river: ${f(bR, bT)}% of borders vs ${f(aR, aT)}% of all land edges → enrichment ${(bR / Math.max(1, bT) / (aR / aT)).toFixed(2)}x`);
console.log(`  ridge: ${f(bG, bT)}% of borders vs ${f(aG, aT)}% of all land edges → enrichment ${(bG / Math.max(1, bT) / (aG / aT)).toFixed(2)}x`);
// 1. relief distribution at edges — is the border population shifted uphill at
//    bands the 0.25 bar never samples?
const qs = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s.length ? s[Math.min(s.length - 1, (p * s.length) | 0)] : 0;
  return `p50=${q(0.5).toFixed(3)} p75=${q(0.75).toFixed(3)} p90=${q(0.9).toFixed(3)} p95=${q(0.95).toFixed(3)}`;
};
const band = (arr, a, b) => f(arr.filter(v => v >= a && v < b).length, arr.length);
console.log(`  relief@borders: ${qs(bRelief)} | bands [0.07,0.15)=${band(bRelief, 0.07, 0.15)}% [0.15,0.25)=${band(bRelief, 0.15, 0.25)}% [0.25,∞)=${band(bRelief, 0.25, 9)}%`);
console.log(`  relief@allland: ${qs(aRelief)} | bands [0.07,0.15)=${band(aRelief, 0.07, 0.15)}% [0.15,0.25)=${band(aRelief, 0.15, 0.25)}% [0.25,∞)=${band(aRelief, 0.25, 9)}%`);
// 2. size-tier split — does the phenomenon live with the refuge statelets?
console.log(`  smallTier (min partner < median): edges=${sT} river=${f(sR, sT)}% ridge=${f(sG, sT)}%`);
console.log(`  giantSeam (both ≥ median):        edges=${gT} river=${f(gR, gT)}% ridge=${f(gG, gT)}%`);
// 3. the longest pair borders — where the map's real seams are
const top = [...pairs.values()].sort((p, q) => q.n - p.n).slice(0, 12);
for (const e of top) {
  const szLo = sizeOf.get(e.lo) || 0, szHi = sizeOf.get(e.hi) || 0;
  console.log(`  pair #${e.lo}(${szLo}t) ~ #${e.hi}(${szHi}t): edges=${e.n} river=${f(e.riv, e.n)}% ridge=${f(e.rid, e.n)}%`);
}
