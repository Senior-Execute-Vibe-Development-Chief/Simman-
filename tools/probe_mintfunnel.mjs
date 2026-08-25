// THE MINT FUNNEL — which gate eats the cradle's cities at the APP grid?
// (2026-08-25, the owner's play report: densest popField on the globe on the
// Nile, yet "not even a single CITY spawns in the egypt middle east area",
// while India/Caspian/Pontic thrive.)
//
// probe_foundbar measured the STATIC founding-margin surface: at tw=480-obs
// the Nile's bulk cropland prices 4-5× (ghost tiles at desert cv) but the
// seat-class (top-fert / channel) tiles price 1.87-2.6× — payable. So the
// static surface alone doesn't convict leanAt; the binding gate must be
// watched LIVE. This steps a 960px observed-climate world under the full
// live arm and, each checkpoint, dumps every ledger site inside the boxes:
// cell mass vs its bad-year bar, the seat's margin/fert/flood, eligibility,
// the tally-bar organization, the gathered core vs the core bar, and the
// settled count — the whole funnel, per site, over time.
//
//   SIM_TUNE="<live arm>" node tools/probe_mintfunnel.mjs [steps=8000] [W=960] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { labelSiteLedger, siteClaims, URBAN_SHARE_REF } from "../src/sim/peopleSim/crystallize.js";
import { ensureYieldCv } from "../src/sim/peopleSim/harvest.js";
import { landKnowRec } from "../src/sim/peopleSim/landKnow.js";
import { URBAN_ORG } from "../src/sim/peopleSim/tech.js";
import { TIER_CORE } from "../src/sim/peopleSim/settlement.js";
import { urbanCoreR, diskSum } from "../src/sim/peopleSim/popField.js";

const STEPS = +(process.argv[2] || 8000);
const W = +(process.argv[3] || 960), H = W >> 1, SEED = +(process.argv[4] || 8817);

const rc = await import("../src/realClimateData.js");
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
const world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });

const TW = world.tw, TH = world.th;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
const R = [
  { k: "NILE",  lon: [28, 34], lat: [22, 32] },
  { k: "MESO",  lon: [38, 48], lat: [29, 37] },
  { k: "INDIA", lon: [72, 82], lat: [22, 30] },
];
const boxOf = (tx, ty) => {
  const lo = lonOf(tx), la = latOf(ty);
  for (const r of R) if (lo >= r.lon[0] && lo <= r.lon[1] && la >= r.lat[0] && la <= r.lat[1]) return r.k;
  return null;
};
const marginAt = (ti) => { const c = ensureYieldCv(world)[ti] || 0; return 1 / Math.max(0.2, 1 - 2.33 * c); };

console.log(`\n=== MINT FUNNEL  ${W}x${H} (tw=${TW})  seed ${SEED}  OBSERVED + live arm  ${STEPS} steps ===`);
for (let s = 0; s < STEPS; s += 1000) {
  stepPeopleSim(world, 1000);
  const L = labelSiteLedger(world);
  const claims = siteClaims(world);
  const elig = world._siteCityElig;
  const bridge = world._onePopScale > 0 ? world._onePopScale : 0.002;
  const bar1 = (TIER_CORE[2] / URBAN_SHARE_REF) / bridge;
  const coreBarF = TIER_CORE[2] / bridge;
  const coreR = urbanCoreR(world);
  console.log(`\n-- step ${world.step}  (bridge ${bridge.toExponential(2)}, coreR ${coreR})`);
  console.log(`   box  site@lon,lat      mass/bar1   margin  eligible  org/tally  core/bar  seated  seatFert flood`);
  for (let k = 0; k < L.sites.length; k++) {
    const st = L.sites[k];
    const b = boxOf(st.x, st.y);
    if (!b) continue;
    const m = marginAt(st.ti);
    const rec = landKnowRec(world, st.ti);
    const org = rec && rec.k ? (rec.k.organization || 0) : -1;
    const coreNow = world.popField ? diskSum(world.popField, TW, TH, st.x, st.y, coreR) : 0;
    const massR = claims.mass[k] / bar1;
    console.log(`   ${b.padEnd(5)} k${String(k).padStart(4)}@${lonOf(st.x).toFixed(0)},${latOf(st.y).toFixed(0)}   ${massR.toFixed(2)}/${m.toFixed(2)}   m${m.toFixed(2)}   ${elig ? elig[k] : "?"}        ${org < 0 ? " -- " : org.toFixed(2)}/${URBAN_ORG}   ${(coreNow / coreBarF).toFixed(2)}     ${claims.count[k] || 0}      ${(world.fert[st.ti] || 0).toFixed(2)}    ${world.tFlood ? world.tFlood[st.ti] : 0}`);
  }
  // settled register per box
  const cnt = { NILE: 0, MESO: 0, INDIA: 0 };
  for (const st of world.settlements) {
    if (st.mode !== "settled") continue;
    const b = boxOf(st.pos.x | 0, st.pos.y | 0);
    if (b) cnt[b]++;
  }
  console.log(`   settled: NILE ${cnt.NILE} · MESO ${cnt.MESO} · INDIA ${cnt.INDIA} · world ${world.settlements.filter(x => x.mode === "settled").length}`);
}
console.log(`\n  READ: mass/bar1 is the cell census in 1×-bar units — eligibility needs it ≥ margin.`);
console.log(`  If mass/bar1 ≥ margin and elig stays 0, the gate is downstream (devP, storable,`);
console.log(`  spacing); if org < tally the ledger never learned (it is only planted when`);
console.log(`  eligibility first passes — a too-high margin starves the LEARNING too).`);
