// Slave-market distance-pricing probe (Tier-B4, [I13]/[D9]).
// Measures, per report window, the quantities the residual diagnosis named:
//   • world slave-income share of all income
//   • realm ranking: realms where the slave trade ranks top-3 / carries >10%
//     of realm income (the taxonomy statistic the crafts-unbundling targets)
//   • LOCALIZATION: seller slave income binned by Euclidean distance (ref
//     tiles) to the nearest posted cash-backed demand — the profile that
//     should fall with distance under distance-priced clearing and be flat
//     under the pooled clearing
//   • market scarcity distribution: r and price multiplier per market key
//   • unfree share, captive stock, seller/buyer counts
//   • executed-trade telemetry (SLAVE_FREIGHT arm): trades, value, value-
//     weighted mean network path cost, max path cost (world.debug counters)
// Read-only; app-identical pipeline. A/B via SIM_TUNE="SLAVE_FREIGHT=0".
// node tools/probe_slavemarket.mjs [steps] [seed] [W] [H]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { slavePull } from "../src/sim/peopleSim/slavery.js";
import { rNormPop, T } from "../src/sim/peopleSim/tuning.js";
import { IN_SLAVE_TRADE, IN_LABELS, IN_GOODS, IN_ORE, IN_METAL, IN_CLOTH, IN_WARES } from "../src/sim/peopleSim/money.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W     = parseInt(process.argv[4] || "480", 10);
const H     = parseInt(process.argv[5] || "240", 10);
const REPORT = parseInt(process.env.REPORT || "2000", 10);
const EPS = 0.005;   // the display's own live-channel threshold

const world = buildSim({ W, H, seed: SEED });
console.log(`slave-market probe ${W}x${H} seed=${SEED} steps=${STEPS} SLAVE_FREIGHT=${T.SLAVE_FREIGHT}`);

const BINS = [4, 8, 16, 32, Infinity];   // ref-tile distance bin edges
const binLabel = ["0-4", "4-8", "8-16", "16-32", "32+"];

let lastTradeN = 0, lastTradeVal = 0, lastTradeCostVal = 0;

function report(step) {
  const rn = rNormPop(world);
  const tw = world.tw;
  // buyers with posted demand (the demand side the market sees)
  const buyers = [];
  let pop = 0, unfree = 0, captives = 0, sellersN = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    pop += Math.max(0, s.people || 0);
    unfree += s._unfree || 0;
    const c = s._captives || 0;
    captives += c;
    if (c > 0.5) sellersN++;
    if ((s._slaveDemand || 0) > 0.5) buyers.push(s);
  }
  const distToBuyer = (s) => {
    let best = Infinity;
    for (const b of buyers) {
      if (b === s) return 0;
      let dx = Math.abs(s.pos.x - b.pos.x); if (dx > tw / 2) dx = tw - dx;
      const dy = s.pos.y - b.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best) / rn;
  };
  // income accounting: world + per-realm ranking + seller distance profile
  let slaveIn = 0, allIn = 0;
  const realmIn = new Map();   // cid → Float64Array per channel
  const binInc = [0, 0, 0, 0, 0];
  let distIncSum = 0, distIncW = 0, earners = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const a = s._mInRate;
    if (!a) continue;
    let tot = 0; for (let i = 0; i < a.length; i++) tot += a[i];
    slaveIn += a[IN_SLAVE_TRADE]; allIn += tot;
    if (s.countryId >= 0) {
      let e = realmIn.get(s.countryId);
      if (!e) realmIn.set(s.countryId, e = new Float64Array(a.length));
      for (let i = 0; i < a.length; i++) e[i] += a[i];
    }
    const si = a[IN_SLAVE_TRADE];
    if (si > EPS && buyers.length) {
      earners++;
      const d = distToBuyer(s);
      distIncSum += si * d; distIncW += si;
      for (let k = 0; k < BINS.length; k++) if (d < BINS[k] || k === BINS.length - 1) { binInc[k] += si; break; }
    }
  }
  let top3 = 0, top3B = 0, over10 = 0, realmN = 0;
  // The pre-unbundling ranking view: goods + the four crafts as ONE channel —
  // isolates the taxonomy effect from the clearing effect on the same world.
  const BUNDLE = new Set([IN_GOODS, IN_ORE, IN_METAL, IN_CLOTH, IN_WARES]);
  for (const [, e] of realmIn) {
    realmN++;
    const si = e[IN_SLAVE_TRADE];
    if (!(si > EPS)) continue;
    let tot = 0, higher = 0, higherB = 0, bundled = 0;
    for (let i = 0; i < e.length; i++) {
      tot += e[i];
      if (i === IN_SLAVE_TRADE) continue;
      if (e[i] > si) higher++;
      if (BUNDLE.has(i)) bundled += e[i]; else if (e[i] > si) higherB++;
    }
    if (bundled > si) higherB++;
    if (higher < 3) top3++;
    if (higherB < 3) top3B++;
    if (tot > 0 && si / tot > 0.10) over10++;
  }
  // market scarcity distribution (force the lazy index for THIS step)
  let rq = "-", muls = "-";
  {
    let any = null;
    for (const s of world.settlements) if (s.mode === "settled") { any = s; break; }
    if (any) slavePull(world, any);
    const sc = world._slaveScarcity;
    if (sc && sc.size) {
      const rs = [...sc.values()].sort((a, b) => a - b);
      const q = (f) => rs[Math.min(rs.length - 1, Math.floor(f * rs.length))];
      rq = `n=${rs.length} p25/50/75=${q(0.25).toFixed(2)}/${q(0.5).toFixed(2)}/${q(0.75).toFixed(2)} max=${q(1).toFixed(1)}`;
      const mulOf = (r) => 1 + (T.SLAVE_PULL || 0) * (Math.min(3, Math.max(0, r - 1)) - Math.min(0.5, Math.max(0, 1 - r)));
      let atCap = 0, over2 = 0, under1 = 0;
      for (const r of rs) { const m = mulOf(r); if (m >= 1 + (T.SLAVE_PULL || 0) * 3 - 1e-9) atCap++; else if (m > 2) over2++; if (m < 1) under1++; }
      muls = `atCap=${atCap}/${rs.length} in(2,cap)=${over2} glut(<1)=${under1}`;
    }
  }
  // executed-trade telemetry deltas (only the SLAVE_FREIGHT arm writes these)
  const dbg = world.debug || {};
  const dN = (dbg.slaveTradeN || 0) - lastTradeN;
  const dV = (dbg.slaveTradeVal || 0) - lastTradeVal;
  const dCV = (dbg.slaveTradeCostVal || 0) - lastTradeCostVal;
  lastTradeN = dbg.slaveTradeN || 0; lastTradeVal = dbg.slaveTradeVal || 0; lastTradeCostVal = dbg.slaveTradeCostVal || 0;
  const era = world._eraAt ? world._eraAt.length - 1 : 0;

  console.log(`@${String(step).padStart(6)} era=${era} | slave% ${(100 * slaveIn / Math.max(1e-9, allIn)).toFixed(2)} | realms top3 ${top3}/${realmN} (as-if-bundled ${top3B}) >10% ${over10} | unfree ${(100 * unfree / Math.max(1, pop)).toFixed(1)}% stock ${Math.round(captives)} sellers ${sellersN} buyers ${buyers.length}`);
  const binStr = binInc.map((v, k) => `${binLabel[k]}:${distIncW > 0 ? (100 * v / Math.max(1e-9, slaveIn)).toFixed(0) : 0}%`).join(" ");
  console.log(`        localization: earners=${earners} incomeWeightedDist=${distIncW > 0 ? (distIncSum / distIncW).toFixed(1) : "-"}rt | income by dist ${binStr}`);
  console.log(`        market r: ${rq} | mul: ${muls}${dN > 0 ? ` | trades ${dN} val ${dV.toFixed(0)} meanPathCost ${(dCV / Math.max(1e-9, dV)).toFixed(1)} maxPathCost ${(dbg.slaveTradeMaxCost || 0).toFixed(1)}` : ""}`);
}

const t0 = Date.now();
for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % REPORT === 0) report(s);
}
// realm-level channel leaderboard at the end (which channels realms live on)
{
  const chanTop = new Float64Array(IN_LABELS.length);
  const realmIn = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;
    const a = s._mInRate; if (!a) continue;
    let e = realmIn.get(s.countryId);
    if (!e) realmIn.set(s.countryId, e = new Float64Array(a.length));
    for (let i = 0; i < a.length; i++) e[i] += a[i];
  }
  for (const [, e] of realmIn) {
    const order = [...e.keys()].sort((x, y) => e[y] - e[x]);
    for (let r = 0; r < 3 && r < order.length; r++) if (e[order[r]] > EPS) chanTop[order[r]]++;
  }
  const rows = [...chanTop.keys()].filter(i => chanTop[i] > 0).sort((x, y) => chanTop[y] - chanTop[x])
    .map(i => `${IN_LABELS[i]}:${chanTop[i]}`).join("  ");
  console.log(`realm top-3 channel census (${realmIn.size} realms): ${rows}`);
}
console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`);
