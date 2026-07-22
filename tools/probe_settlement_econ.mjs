// Observational probe: WATCH the settlement economy at 480 res.
// What does each settlement buy, sell, specialise in — given its location,
// resources, situation, and its realm's temperament? Dumps a curated sample
// plus aggregate diversity metrics so we can judge whether the emergent
// economy is realistic & varied or flat & boring.
//
//   node tools/probe_settlement_econ.mjs [steps] [seed] [W] [H]
//   node tools/probe_settlement_econ.mjs 20000 8817 480 240

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { getExportBreakdown, getTradeProfile, TIER_NAME, monetization } from "../src/sim/peopleSim/settlement.js";
import { IN_LABELS, OUT_LABELS } from "../src/sim/peopleSim/money.js";
import { personalityOf } from "../src/sim/peopleSim/personality.js";
import { GOODS } from "../src/sim/peopleSim/goods.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "20000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);
const H = parseInt(process.argv[5] || "240", 10);

const world = buildSim({ W, H, seed: SEED });
console.log(`\n=== settlement-economy watch  ${W}x${H} seed=${SEED} steps=${STEPS} ===`);

const t0 = Date.now();
for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % 4000 === 0) {
    const st = peopleSimStats(world);
    process.stderr.write(`  step ${s}: setts=${st.settlements} cities=${st.cities + st.metropolises} countries=${st.countries} pop=${st.totalPeople} wealth=${st.totalWealth} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
}

const setts = world.settlements.filter((s) => s.mode === "settled");
const st = peopleSimStats(world);

// ── Helpers ───────────────────────────────────────────────────────────
const rr = (x, n = 2) => (x == null ? "-" : (+x).toFixed(n));
function tempLabel(s) {
  if (s.countryId < 0 || !world.countries) return "(stateless)";
  const c = world.countries.get(s.countryId);
  if (!c) return "(stateless)";
  const p = personalityOf(world, c);
  if (!p) return "(no personality)";
  return `${p._label}  [agg ${rr(p.aggression)}, comm ${rr(p.commerce)}, exp ${rr(p.expansionism)}]`;
}
function resList(s, thr = 0.08) {
  const r = s.localRes || {};
  return Object.entries(r).filter(([, v]) => v > thr).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${rr(v)}`).join(" ") || "(none)";
}
function inFlows(s) {
  const a = s._mInRate; if (!a) return "(none)";
  return Array.from(a).map((v, i) => [IN_LABELS[i], v]).filter(([, v]) => v > 0.02)
    .sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} +${rr(v)}`).join(", ") || "(none)";
}
function outFlows(s) {
  const a = s._mOutRate; if (!a) return "(none)";
  return Array.from(a).map((v, i) => [OUT_LABELS[i], v]).filter(([, v]) => v > 0.02)
    .sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} -${rr(v)}`).join(", ") || "(none)";
}
function exportMix(s) {
  return getExportBreakdown(s, world).slice(0, 5).map((e) => `${e.label} ${rr(e.value)}`).join(", ");
}
function partners(s, n = 4) {
  const prof = getTradeProfile(s, world).slice(0, n);
  if (!prof.length) return "(no partners)";
  return prof.map((p) => {
    const dir = p.netPerTick >= 0 ? "+" : "";
    const barter = (p.give || p.get) ? ` {give ${p.give || "-"} / get ${p.get || "-"}}` : "";
    const food = p.foodRole ? ` (${p.foodRole})` : "";
    return `${p.partner} net${dir}${rr(p.netPerTick)}${food}${barter}`;
  }).join(" | ");
}
function dump(s, tag) {
  console.log(`\n── ${tag}: ${s.name}  [${TIER_NAME[s.tier | 0]}, ${Math.round(s.people)} ppl, $${Math.round(s.wealth)}] ──`);
  console.log(`   realm: ${tempLabel(s)}`);
  console.log(`   site:  lat ${rr(s._climLat)}  temp ${rr(s._climTemp)}  moist ${rr(s._climMoist)}  water ${rr(s.waterAccess)}  monetiz ${rr(monetization(s))}`);
  console.log(`   resources: ${resList(s)}`);
  console.log(`   SPECIALTY: ${s._specKey || "(none)"}  (strength ${rr(s._specStr)})`);
  console.log(`   export mix: ${exportMix(s)}`);
  console.log(`   food: supply ${rr(s._foodSupply)} demand ${rr(s._foodDemand)}   luxury: supply ${rr(s._luxSupply)} demand ${rr(s._luxDemand)}`);
  if (s._unfree > 1) console.log(`   coerced labour: ${Math.round(s._unfree)} (ratio ${rr(s._unfreeRatio)})  cashCrop ${rr(s._cashFrac)}`);
  console.log(`   SELLS (income):  ${inFlows(s)}`);
  console.log(`   BUYS  (spending): ${outFlows(s)}`);
  console.log(`   partners: ${partners(s)}`);
  if (T.GOODS_PRICES && s._gPrice) {
    console.log(`   goods prices: ${GOODS.map((g, i) => `${g} ${rr(s._gPrice[i])}`).join("  ")}`);
    if (s._gShare) console.log(`   craft labour: ore ${rr(s._gShare[0])} metal ${rr(s._gShare[1])} cloth ${rr(s._gShare[2])} wares ${rr(s._gShare[3])} services ${rr(s._gShare[4])}`);
    if (T.GOODS_TRADE && s._gNet) {
      const flows = GOODS.map((g, i) => [g, s._gNet[i]]).filter(([, v]) => Math.abs(v) > 0.005)
        .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
        .map(([g, v]) => `${v > 0 ? "imports" : "exports"} ${g} ${rr(Math.abs(v))}`).join(", ");
      console.log(`   goods flows (/tick): ${flows || "(balanced)"}`);
    }
  }
}

// ── 1. Macro ──────────────────────────────────────────────────────────
console.log(`\n### MACRO`);
console.log(`settlements ${st.settlements} | villages ${st.villages} towns ${st.towns} cities ${st.cities} metros ${st.metropolises} | countries ${st.countries} | pop ${st.totalPeople} | wealth ${st.totalWealth}`);

// Aggregate income by channel across the whole world — what IS the economy made of?
const agg = new Array(IN_LABELS.length).fill(0);
let aggTot = 0;
for (const s of setts) {
  const a = s._mInRate; if (!a) continue;
  for (let i = 0; i < a.length; i++) { agg[i] += a[i]; aggTot += a[i]; }
}
console.log(`\n### WORLD INCOME COMPOSITION (share of all $/tick earned, by channel)`);
agg.map((v, i) => [IN_LABELS[i], v]).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  if (v / aggTot > 0.002) console.log(`   ${(100 * v / aggTot).toFixed(1).padStart(5)}%  ${k}`);
});

// ── 1b. Endowment homogenization (analysis F3) ────────────────────────
// How many resources does each settlement read as "having"? Under the MAX
// endowment big cities converge on 8-10; under RES_SCARCITY a city should
// read rich only in what it genuinely commands.
function nRes(s, thr) { const r = s.localRes || {}; let n = 0; for (const k in r) if (r[k] >= thr) n++; return n; }
const big10 = [...setts].sort((a, b) => b.people - a.people).slice(0, 10);
const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
console.log(`\n### ENDOWMENT BREADTH (resources per settlement at richness thresholds)`);
console.log(`   all ${setts.length} setts:  ≥0.10 ${mean(setts.map((s) => nRes(s, 0.10))).toFixed(1)}   ≥0.25 ${mean(setts.map((s) => nRes(s, 0.25))).toFixed(1)}   ≥0.40 ${mean(setts.map((s) => nRes(s, 0.40))).toFixed(1)}`);
console.log(`   top-10 by pop:   ≥0.10 ${mean(big10.map((s) => nRes(s, 0.10))).toFixed(1)}   ≥0.25 ${mean(big10.map((s) => nRes(s, 0.25))).toFixed(1)}   ≥0.40 ${mean(big10.map((s) => nRes(s, 0.40))).toFixed(1)}`);

// ── 1c. Goods-price dispersion (Stage 1: the gradient Stage 2 trades against) ──
if (T.GOODS_PRICES) {
  console.log(`\n### LOCAL PRICE DISPERSION per good (min / median / max across ${setts.length} settlements)`);
  for (let g = 0; g < GOODS.length; g++) {
    const ps = setts.filter((s) => s._gPrice).map((s) => s._gPrice[g]).sort((a, b) => a - b);
    if (!ps.length) break;
    const med = ps[(ps.length / 2) | 0];
    console.log(`   ${GOODS[g].padEnd(10)} ${rr(ps[0])} / ${rr(med)} / ${rr(ps[ps.length - 1])}`);
  }
}

// ── 2. Specialty diversity ────────────────────────────────────────────
const towns = setts.filter((s) => (s.tier | 0) >= 1);
const specCount = {};
for (const s of towns) { const k = s._specKey || "(none)"; specCount[k] = (specCount[k] || 0) + 1; }
const specEntropy = Object.values(specCount).reduce((h, n) => { const p = n / towns.length; return h - p * Math.log2(p); }, 0);
console.log(`\n### SPECIALTY DISTRIBUTION across ${towns.length} towns+ (the comparative-advantage sector each locks into)   [entropy ${specEntropy.toFixed(2)} bits of ${Math.log2(5).toFixed(2)} max]`);
Object.entries(specCount).sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
  console.log(`   ${(100 * n / towns.length).toFixed(1).padStart(5)}%  (${String(n).padStart(4)})  ${k}`));

// Distinct export-mix leaders: what is each town's single biggest export line?
const leadCount = {};
for (const s of towns) {
  const top = getExportBreakdown(s, world)[0];
  const k = top ? top.label : "(none)";
  leadCount[k] = (leadCount[k] || 0) + 1;
}
console.log(`\n### TOP EXPORT LINE across ${towns.length} towns+ (single biggest line in the export breakdown)`);
Object.entries(leadCount).sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
  console.log(`   ${(100 * n / towns.length).toFixed(1).padStart(5)}%  (${String(n).padStart(4)})  ${k}`));

// ── 3. Curated sample ─────────────────────────────────────────────────
const byPop = [...setts].sort((a, b) => b.people - a.people);
console.log(`\n\n########## SAMPLE: TOP 8 SETTLEMENTS BY POPULATION ##########`);
byPop.slice(0, 8).forEach((s, i) => dump(s, `#${i + 1} biggest`));

// Luxury producers (spice/fur/incense/dye/cashcrop) — the places that SHOULD be distinctive
const luxProd = [...setts].filter((s) => (s._luxSupply || 0) > 0.5).sort((a, b) => (b._luxSupply || 0) - (a._luxSupply || 0));
console.log(`\n\n########## SAMPLE: TOP 4 LUXURY PRODUCERS ##########`);
luxProd.slice(0, 4).forEach((s, i) => dump(s, `lux#${i + 1}`));

// Ore / metal towns
const oreTowns = [...towns].filter((s) => s._specKey === "Metalwork").sort((a, b) => b.people - a.people);
console.log(`\n\n########## SAMPLE: TOP 3 METALWORK TOWNS ##########`);
oreTowns.slice(0, 3).forEach((s, i) => dump(s, `metal#${i + 1}`));

// A couple of ordinary farming regions
const villages = [...setts].filter((s) => (s.tier | 0) === 0 && s.people > 100).sort((a, b) => b.people - a.people);
console.log(`\n\n########## SAMPLE: 3 LARGE FARMING REGIONS ##########`);
villages.slice(0, 3).forEach((s, i) => dump(s, `farm#${i + 1}`));

// ── 4. Are buy & sell just mirror images? (the abstract-flow tell) ─────
console.log(`\n\n### BUY-vs-SELL SYMMETRY CHECK (do big towns import the same category they export?)`);
console.log(`    For each top city: goods-sold vs goods-bought, food-sold vs food-bought ($/tick)`);
byPop.slice(0, 10).forEach((s) => {
  const i = s._mInRate || [], o = s._mOutRate || [];
  console.log(`   ${(s.name || "?").padEnd(16)} goods  sell ${rr(i[1]).padStart(6)} / buy ${rr(o[0]).padStart(6)}    food  sell ${rr(i[2]).padStart(6)} / buy ${rr(o[1]).padStart(6)}    mats  sell ${rr(i[3]).padStart(6)} / buy ${rr(o[2]).padStart(6)}`);
});
// Asymmetry index per category: |sell−buy|/(sell+buy), 0 = perfect mirror
// (the F2 pathology), 1 = pure one-way flow (real division of labour).
// Mean over the top-10 cities; goods+materials+luxury only (food rides the
// hierarchy, tolls/tariffs aren't goods).
{
  const cats = [[1, 0, "goods"], [3, 2, "materials"], [8, 9, "luxury"]];
  const parts = cats.map(([ci, co, label]) => {
    let sum = 0, n = 0;
    for (const s of byPop.slice(0, 10)) {
      const sell = (s._mInRate && s._mInRate[ci]) || 0, buy = (s._mOutRate && s._mOutRate[co]) || 0;
      if (sell + buy > 0.5) { sum += Math.abs(sell - buy) / (sell + buy); n++; }
    }
    return `${label} ${n ? (sum / n).toFixed(2) : "n/a"}`;
  });
  console.log(`   ASYMMETRY INDEX (top-10 mean; 0 = mirror trade, 1 = one-way): ${parts.join("   ")}`);
}

console.log(`\n(done in ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
