// WHAT IS THE CRADLE'S CAPACITY MADE OF? (2026-08-26, the cradle-inversion
// lap. probe_where convicted the LAND: the settled tiles of Greece/Italy
// (213k) and the East European plain (163k) carry 3.5-13x the weighted
// capacity of the Nile (47k), Mesopotamia (31k) and the Indus (12k) — exactly
// backwards from the record, where irrigated alluvium ran 10:1 seed yields
// against Europe's 3-4:1, needed no fallow, and was renewed with silt yearly.
// Before ANY mechanism is built, decompose capField into its own terms at the
// richest tile of each region, so the defect is attributed and not guessed.)
//
// cap = fEff x capPerFert x (DEV_BASE + DEV_TECH*devF) x reach x reliefMul
//       x indMul x wkMul, then the FIELD_CRADLE post-pass multiplies crop by
//       irr x allu = (1 + IRRIG_BOOST*arid*water*farmTech)
//                  x (1 + ALLUVIUM*(water + 0.5*coast)*farmTech).
// The question this answers: is the ribbon's cradle multiplier FIRING (arid,
// water, farmTech all ~1 => x7.5), and if so, is it multiplying a fertility
// so small that x7.5 still loses to temperate rain-fed land? Those are two
// different bugs with two different fixes.
//
//   node tools/probe_capterms.mjs [steps=30000] [W=480] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
import { RM_FULL, ACCESS_RIVER, ACCESS_COAST, ACCESS_DEV0, ACCESS_DEVK, DEV_BASE, DEV_TECH, RELIEF_PEN } from "../src/sim/peopleSim/popFieldKernel.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 480), H = W >> 1, SEED = +(process.argv[4] || 8817);
const rc = await import("../src/realClimateData.js");
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
const world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });

const REGIONS = [
  ["Egypt/Nile",        15,  32,   24,  36],
  ["Mesopotamia",       28,  38,   38,  50],
  ["Indus/NW India",    20,  34,   66,  80],
  ["N China",           28,  42,  103, 122],
  ["Greece/Italy",      35,  46,   12,  28],
  ["E Europe/Russia",   45,  62,   20,  55],
  ["W Europe",          43,  55,   -8,  15],
];
const tw = world.tw, th = world.th;
const xOf = lon => Math.max(0, Math.min(tw - 1, Math.round((lon + 180) / 360 * tw)));
const yOf = lat => Math.max(0, Math.min(th - 1, Math.round((90 - lat) / 180 * th)));

for (let done = 0; done < STEPS; done += 1000) stepPeopleSim(world, 1000);

console.log(`\n=== CAPACITY TERMS AT EACH REGION'S RICHEST TILE  ${W}x${H} (tw=${tw}) seed ${SEED} ${STEPS} steps ===`);
console.log(`  FIELD_CRADLE=${T.FIELD_CRADLE} IRRIG_BOOST=${T.IRRIG_BOOST} ALLUVIUM=${T.ALLUVIUM} IRRIG_ARID0=${T.IRRIG_ARID0}\n`);
console.log(`  ${"region".padEnd(17)} ${"fert".padStart(5)} ${"devT".padStart(5)} ${"reach".padStart(5)} ${"relf".padStart(5)} ${"indMul".padStart(7)} ${"wkMul".padStart(6)} ${"cradle".padStart(6)} ${"pastr".padStart(8)} ${"PREDICT".padStart(9)} ${"cap".padStart(9)} ${"ratio".padStart(5)} ${"WILDcap".padStart(9)}`);

// THE CITY OVERLAY vs THE LAND. capField at a settled tile is not the ground:
// ONE_POP stamps an URBAN CAPACITY SPIKE on a settlement's home tile (what its
// ECONOMY supports beyond what its land feeds — imports, granary, housing) and
// FOOD_K replaces worked-catchment capacity with the settlement's real food
// ledger. Both are OUTPUTS of a city's economy, so reading "richest tile" in a
// region reads whichever metropolis stands there and calls it soil. Excluding
// settlement tiles and their immediate neighbours leaves the wild proxy — the
// land's own capacity, which is what the atlas question actually asks about.
const cityMask = new Set();
for (const s of world.settlements) {
  if (s.mode !== "settled") continue;
  const sx = s.pos.x | 0, sy = s.pos.y | 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const yy = sy + dy; if (yy < 0 || yy >= th) continue;
    cityMask.add(yy * tw + ((sx + dx + tw) % tw));
  }
}
for (const r of REGIONS) {
  let best = -1, bi = -1, wildBest = -1;
  for (let y = yOf(r[2]); y <= yOf(r[1]); y++)
    for (let x = xOf(r[3]); x <= xOf(r[4]); x++) {
      const ti = y * tw + x;
      if (!(world.elev[ti] > 0)) continue;
      if (world.capField[ti] > best) { best = world.capField[ti]; bi = ti; }
      if (!cityMask.has(ti) && world.capField[ti] > wildBest) wildBest = world.capField[ti];
    }
  if (bi < 0) { console.log(`  ${r[0].padEnd(17)}  (no land)`); continue; }
  const moist = world.moist[bi], fert = world.fert ? world.fert[bi] : -1;
  const devF = world.devField ? world.devField[bi] : 0;
  const rm = world.riverMag ? world.riverMag[bi] : 0;
  const cst = world.coast ? world.coast[bi] : 0;
  const water = Math.min(1, rm / RM_FULL);
  const arid = Math.max(0, Math.min(1, ((T.IRRIG_ARID0 ?? 0.52) - moist) / 0.20));
  const farmTech = Math.min(1, devF / 0.5);
  const irr = 1 + (T.IRRIG_BOOST || 0) * (T.FIELD_CRADLE || 0) * arid * water * farmTech;
  const allu = 1 + (T.ALLUVIUM || 0) * (T.FIELD_CRADLE || 0) * (water + 0.5 * cst) * farmTech;
  const access = ACCESS_RIVER * water + ACCESS_COAST * cst;
  const reach = 1 + access * (ACCESS_DEV0 + ACCESS_DEVK * devF);
  // the remaining terms of capBand, so the product can be RECONSTRUCTED and
  // any residual names the term actually responsible.
  const relief = world.relief ? world.relief[bi] : 0;
  const reliefMul = 1 / (1 + RELIEF_PEN * relief);
  const devT = DEV_BASE + DEV_TECH * devF;
  const pastureV = world._pastureCap ? world._pastureCap[bi] : -1;
  const worksV = world.worksField ? world.worksField[bi] : -1;
  const wkMul = (T.LAND_WORKS > 0 && worksV >= 0) ? 1 + T.LAND_WORKS * worksV : 1;
  let indMul = 1;
  const own = world._indOwner || world._landOwner || world._countryOwner;
  if (own && world._byId) { const sid = own[bi]; const so = sid >= 0 ? world._byId.get(sid) : null; if (so && so._indCap > 1) indMul = so._indCap; }
  const CAP_PER_FERT = 1200;                       // popField.js module constant
  const rnF = Math.max(1e-9, tw / 240);            // rNormPop at the reference width
  const capPerFert = CAP_PER_FERT / (rnF * rnF);   // per REAL area
  const predict = fert * capPerFert * devT * reach * reliefMul * indMul * wkMul * (irr * allu);
  console.log(`  ${r[0].padEnd(17)} ${fert.toFixed(2).padStart(5)} ${devT.toFixed(2).padStart(5)} ${reach.toFixed(2).padStart(5)} ${reliefMul.toFixed(2).padStart(5)} ${indMul.toFixed(2).padStart(7)} ${wkMul.toFixed(2).padStart(6)} ${(irr * allu).toFixed(2).padStart(6)} ${(pastureV < 0 ? "   — " : Math.round(pastureV).toString()).padStart(8)} ${Math.round(predict).toString().padStart(9)} ${Math.round(best).toString().padStart(9)} ${(best > 0 ? (best / Math.max(1e-9, predict)) : 0).toFixed(2).padStart(5)} ${Math.round(Math.max(0, wildBest)).toString().padStart(9)}`);
}
console.log(`\nREAD: ratio ~1 ⇒ the printed terms EXPLAIN the capacity and the biggest column is the`);
console.log(`defect. ratio far from 1 ⇒ a term here is wrong or missing (a field read under the wrong`);
console.log(`name reads -, and CAP_PER_FERT/works/industry are the usual suspects); fix the`);
console.log(`reconstruction before drawing any conclusion from the columns.`);
