// WHERE IS CIVILIZATION, HOW BIG ARE ITS CITIES, AND HOW FAR DOES GRAIN MOVE?
// (2026-08-26, the owner's play report on the v49 world: "most cities at 12k?
// ... food seems to be shipped globally to few points? ... civilization is
// strong in eastern europe, some in india, west sahel, not really anywhere
// else." Three claims, three instruments, one run — at the grid that ships.)
//
//   1. THE ATLAS. Named real-world regions (lat/lon boxes) scored by what
//      actually stands there: settlements, urban people, largest city, and
//      realms seated in the box. History's answer is unambiguous — the arid
//      river corridors (Egypt, Mesopotamia, Indus, N China) carry the first
//      civilizations; the north-European plain and the Sahel do NOT. The
//      caging field exists to price exactly that, so a Europe-heavy atlas is
//      the "false pristine" failure it was built to retire (cageField.js).
//   2. THE URBAN LADDER. A histogram of urban cores in REAL people. The
//      owner's "12k" is the CITY_CORE minting floor — a world whose cities
//      all sit at their founding minimum is a world where nothing grows
//      past its own fields, which is what the v47/v48 grain waves attack.
//   3. THE GRAIN SHED. Every market haul this run, by GREAT-CIRCLE KM
//      (p50/p90/max), and the share of all landed grain taken by the top 3
//      importers. History's grain sheds: overland ~20-100 km (oxcart eats
//      its own load), riverine/coastal hundreds to ~1,500 km (Egypt→Rome).
//      A p90 in the thousands overland means the haul physics is not biting.
//
//   SIM_TUNE="..." node tools/probe_where.mjs [steps=30000] [W=960] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { POP_SCALE } from "../src/sim/units.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 960), H = W >> 1, SEED = +(process.argv[4] || 8817);
const rc = await import("../src/realClimateData.js");
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
const world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });
world._wantGoodsFlows = true;   // the render-only recorder — the same entries the owner's overlay draws

// [label, lat0, lat1, lon0, lon1] — real boxes, generous enough to hold a basin
const REGIONS = [
  ["Egypt/Nile",        15,  32,   24,  36],
  ["Mesopotamia",       28,  38,   38,  50],
  ["Indus/NW India",    20,  34,   66,  80],
  ["N China",           28,  42,  103, 122],
  ["Anatolia/Levant",   30,  42,   26,  45],
  ["Greece/Italy",      35,  46,   12,  28],
  ["W Europe",          43,  55,   -8,  15],
  ["E Europe/Russia",   45,  62,   20,  55],
  ["W Sahel",            8,  18,  -17,  10],
  ["Ethiopia/E Africa", -6,  15,   30,  45],
  ["SE Asia",          -10,  22,   95, 118],
  ["Mesoamerica",       12,  25, -105, -86],
  ["Andes",            -20,   2,  -80, -66],
];
const twm = world.tw, thm = world.th;
const xOf = lon => Math.max(0, Math.min(twm - 1, Math.round((lon + 180) / 360 * twm)));
const yOf = lat => Math.max(0, Math.min(thm - 1, Math.round((90 - lat) / 180 * thm)));
const inBox = (s, r) => {
  const x = s.pos.x | 0, y = s.pos.y | 0;
  return x >= xOf(r[3]) && x <= xOf(r[4]) && y >= yOf(r[2]) && y <= yOf(r[1]);
};

// ── the grain shed: accumulate every recorded market haul ──
const EARTH_KM = 40075;
const hauls = [];                 // great-circle km per landed haul
const landedBy = new Map();       // settlement id → total landed (concentration)
const tileLL = ti => { const y = (ti / twm) | 0, x = ti - y * twm; return [90 - (y + 0.5) / thm * 180, (x + 0.5) / twm * 360 - 180]; };
const gcKm = (a, b) => {
  const [la1, lo1] = tileLL(a), [la2, lo2] = tileLL(b);
  const R = EARTH_KM / (2 * Math.PI), t = Math.PI / 180;
  const dla = (la2 - la1) * t, dlo = (lo2 - lo1) * t;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1 * t) * Math.cos(la2 * t) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const CADENCE = 250;
for (let done = 0; done < STEPS; done += CADENCE) {
  stepPeopleSim(world, CADENCE);
  const gf = world._goodsFlowsGrain;
  if (gf) for (const f of gf) {
    if (f.kind !== "grainM" || !f.pts || f.pts.length < 2) continue;
    hauls.push(gcKm(f.pts[0], f.pts[f.pts.length - 1]));
    // buyer end: toEnd=true means the stream runs pts[0]→pts[last] (seller→buyer)
    const buyerTi = f.toEnd ? f.pts[f.pts.length - 1] : f.pts[0];
    landedBy.set(buyerTi, (landedBy.get(buyerTi) || 0) + f.mag);
  }
}

const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
const settled = world.settlements.filter(s => s.mode === "settled");
const urbanOf = s => (s._urbanPop || 0) * POP_SCALE;

console.log(`\n=== WHERE IS CIVILIZATION  ${W}x${H} (tw=${world.tw})  seed ${SEED}  ${STEPS} steps ===`);
console.log(`  ${settled.length} settled · ${world.countries ? world.countries.size : 0} realms\n`);

// Land area per box, so the atlas compares DENSITIES and not box sizes (the
// E Europe box is ~3x Egypt's — an un-normalized total flatters big boxes).
const kmPerTile = EARTH_KM / twm;
const boxLandMkm2 = (r) => {
  let n = 0;
  // yOf INVERTS latitude (north = low y), so the north edge r[2] is the LOW
  // bound — the same order inBox uses. Getting this backwards runs an empty
  // loop and silently floors every area to the 0.05 guard.
  for (let y = yOf(r[2]); y <= yOf(r[1]); y++)
    for (let x = xOf(r[3]); x <= xOf(r[4]); x++) {
      const ti = y * twm + x;
      if (world.elev && world.elev[ti] > 0) n++;
    }
  // cos(lat) shrinks a tile's real area away from the equator
  const midLat = (r[1] + r[2]) / 2;
  return n * kmPerTile * kmPerTile * Math.cos(midLat * Math.PI / 180) / 1e6;
};
// THE ROOT SPLIT: does the cradle land fail to FEED people (a capacity
// defect), or does it feed them and never form cities (a formation defect)?
// capField is what the land can carry, popField who actually stands on it —
// both in field units, so the ratio to urban people is what matters, not the
// absolute. Reported per Mkm² of the box's own land, alongside the urban read.
const fieldSums = (r) => {
  let cap = 0, pop = 0;
  const cf = world.capField, pf = world.popField;
  for (let y = yOf(r[2]); y <= yOf(r[1]); y++)
    for (let x = xOf(r[3]); x <= xOf(r[4]); x++) {
      const ti = y * twm + x;
      if (!(world.elev && world.elev[ti] > 0)) continue;
      if (cf) cap += cf[ti];
      if (pf) pop += pf[ti];
    }
  return [cap, pop];
};
console.log(`  ── 1. THE ATLAS (urban people by region, and per Mkm² of its land) ──`);
console.log(`  ${"region".padEnd(18)} ${"cities".padStart(6)} ${"urban ppl".padStart(11)} ${"per Mkm²".padStart(10)} ${"largest".padStart(9)} ${"realms".padStart(6)} ${"cap/Mkm²".padStart(9)} ${"pop/Mkm²".padStart(9)} ${"fill".padStart(5)}`);
const rows = [];
for (const r of REGIONS) {
  const inR = settled.filter(s => inBox(s, r));
  const urb = inR.reduce((a, s) => a + urbanOf(s), 0);
  const big = inR.length ? Math.max(...inR.map(urbanOf)) : 0;
  const area = Math.max(0.05, boxLandMkm2(r));
  let realms = 0;
  if (world.countries) for (const c of world.countries.values()) if (c.capital && inBox(c.capital, r)) realms++;
  const [cap, pop] = fieldSums(r);
  rows.push([r[0], inR.length, urb, urb / area, big, realms, cap / area, pop / area, cap > 0 ? pop / cap : 0]);
}
rows.sort((a, b) => b[3] - a[3]);   // by DENSITY — the honest comparison
for (const [lab, n, urb, dens, big, realms, capD, popD, fill] of rows)
  console.log(`  ${lab.padEnd(18)} ${String(n).padStart(6)} ${(Math.round(urb / 1000) + "k").padStart(11)} ${(Math.round(dens / 1000) + "k").padStart(10)} ${(Math.round(big / 1000) + "k").padStart(9)} ${String(realms).padStart(6)} ${Math.round(capD).toString().padStart(9)} ${Math.round(popD).toString().padStart(9)} ${fill.toFixed(2).padStart(5)}`);
console.log(`  (cap/pop are FIELD units per Mkm² — compare regions to each other, not to the urban column.`);
console.log(`   High cap+pop with no cities ⇒ a FORMATION defect; low cap ⇒ the land itself is under-fed.)`);

console.log(`\n  ── 2. THE URBAN LADDER (city cores, real people) ──`);
const BR = [[0, 15e3, "≤15k (the minting floor)"], [15e3, 30e3, "15-30k"], [30e3, 60e3, "30-60k"], [60e3, 120e3, "60-120k"], [120e3, 300e3, "120-300k"], [300e3, Infinity, ">300k"]];
for (const [lo, hi, lab] of BR) {
  const n = settled.filter(s => urbanOf(s) >= lo && urbanOf(s) < hi).length;
  console.log(`  ${lab.padEnd(26)} ${String(n).padStart(4)}  ${"█".repeat(Math.min(60, n))}`);
}
const urbs = settled.map(urbanOf);
console.log(`  urban core p50/p90/max: ${Math.round(q(urbs, .5) / 1000)}k / ${Math.round(q(urbs, .9) / 1000)}k / ${Math.round(Math.max(0, ...urbs) / 1000)}k`);

console.log(`\n  ── 3. THE GRAIN SHED (market hauls, great-circle km) ──`);
if (!hauls.length) console.log(`  no market hauls recorded in ${STEPS} steps — the market never fired`);
else {
  console.log(`  hauls ${hauls.length} · km p50 ${Math.round(q(hauls, .5))} · p90 ${Math.round(q(hauls, .9))} · max ${Math.round(Math.max(...hauls))}`);
  console.log(`  (history: overland grain ~20-100 km; riverine/coastal to ~1,500 km — Egypt→Rome)`);
  const tot = [...landedBy.values()].reduce((a, b) => a + b, 0);
  const top = [...landedBy.values()].sort((a, b) => b - a);
  const share = k => (tot > 0 ? (100 * top.slice(0, k).reduce((a, b) => a + b, 0) / tot).toFixed(0) : "0");
  console.log(`  importers ${landedBy.size} · top-3 take ${share(3)}% of all landed grain · top-10 ${share(10)}%`);
  console.log(`  (a handful of importers taking most of the grain = the owner's "shipped globally to few points")`);
}
