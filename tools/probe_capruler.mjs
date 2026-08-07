// WHAT DOES ONE KM² OF THE BEST LAND FEED? — the capacity ruler's TOP END and
// its DYNAMIC RANGE, the quantity the Fertile-Crescent investigation landed on
// (docs/state-birth-2026-08.md, 2026-08-06).
//
// The food economy is scored everywhere else by RATIOS (fill %, shares, cross-
// grid bands), all of which pass while an absolute ceiling could be wrong. This
// prints the absolute.
//
// READ THE ANCHORS CAREFULLY — two mistakes were made against this probe's own
// first output (2026-08-06) and both are easy to repeat:
//   1. DATE MISMATCH. Compare at the MATCHED WORLD POPULATION, never against a
//      famous later figure. This world at 25M people is ~3500 BC, when Egypt
//      held ~0.4M — not the Old Kingdom's ~1.5M a millennium later.
//   2. MEAN vs PEAK. A band's MEAN density is not a floodplain's PEAK density,
//      and a 4,427 km² TILE on the Nile is ~1,000 km² of floodplain plus ~3,400
//      of desert. A real such tile at 3500 BC reads ~4 people/km² — NOT the
//      ~18-50 people/km² of the floodplain itself.
// Getting either wrong manufactures a 10x "defect" that is not there: it was,
// and the corrected reading (peak-to-peak, rank-to-rank, date-matched) found
// the ruler broadly SOUND. Prefer the RANK of history's cradles among all
// tiles, printed below — it is immune to both errors.
//
//   node tools/probe_capruler.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "25000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
stepPeopleSim(world, STEPS);
const tw = world.tw, th = world.th, KM2 = 510e6 / world.N;
const br = world._onePopScale || 0;
const ll = (ti) => { const y = (ti / tw) | 0, x = ti - y * tw; return [x / tw * 360 - 180, 90 - y / th * 180]; };

let wp = 0;
for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) wp += world.popField[i];
const worldM = wp * br * 1000 / 1e6;
console.log(`seed ${SEED} · tw=${tw} · step ${world.step} · world ${worldM.toFixed(1)}M people`);
console.log(`(world 25M ≈ real ~3500 BC · 50M ≈ ~1000 BC — compare the anchors below at the MATCHED world total)\n`);

function band(name, pick, anchor) {
  let n = 0, p = 0, c = 0, f = 0, w = 0;
  for (let ti = 0; ti < world.N; ti++) {
    if (world.elev[ti] <= 0 || !pick(ti)) continue;
    n++; p += world.popField[ti]; c += world.capField[ti];
    f += world.fert[ti] || 0; w += world.worksField ? world.worksField[ti] : 0;
  }
  if (!n) { console.log(`${name.padEnd(30)} | (none)`); return 0; }
  const dens = (p * br * 1000) / (n * KM2);
  const mult = 1 + (T.LAND_WORKS || 0) * (w / n);
  console.log(`${name.padEnd(30)} | ${String(n).padStart(5)} tiles | fert ${(f / n).toFixed(2)} | works ${mult.toFixed(2)}x | fill ${(100 * p / Math.max(1e-9, c)).toFixed(0).padStart(3)}% | ${dens.toFixed(2).padStart(6)} ppl/km²   ${anchor}`);
  return dens;
}
console.log("band                           | tiles       | fert | works  | fill | density        anchor (MEANS — see header)");
const prime = band("prime land (fert>0.85)", ti => (world.fert[ti] || 0) > 0.85, "");
band("river ribbon (rMag>=3)", ti => (world.riverMag ? world.riverMag[ti] : 0) >= 3, "");
band("middling (0.4<fert<0.85)", ti => { const f = world.fert[ti] || 0; return f > 0.4 && f <= 0.85; }, "");
const marg = band("marginal (fert<0.4)", ti => (world.fert[ti] || 0) <= 0.4, "");
band("ALL LAND", () => true, "← real world average at 25M: ~0.17");

// THE READING THAT MATTERS: peak, concentration curve, and where history's
// cradles RANK. Rank is immune to both the date and mean/peak traps.
{
  const arr = [];
  for (let ti = 0; ti < world.N; ti++) if (world.elev[ti] > 0) arr.push([world.popField[ti] * br * 1000 / KM2, ti]);
  arr.sort((a, b) => b[0] - a[0]);
  const tot = arr.reduce((a, b) => a + b[0], 0);
  console.log(`\npeak tile ${arr[0][0].toFixed(1)} ppl/km²   [a real Nile-valley tile at THIS world date ≈ 4]`);
  console.log(`concentration — share of people on the densest N% of land:`);
  for (const p of [0.5, 1, 5]) {
    let acc = 0; const u = Math.floor(p / 100 * arr.length);
    for (let i = 0; i < u; i++) acc += arr[i][0];
    console.log(`   densest ${String(p).padStart(4)}% → ${(100 * acc / tot).toFixed(1).padStart(5)}% of people${p === 0.5 ? "   [real ~3500 BC ≈ 15-20%]" : ""}`);
  }
  const at = (lon, lat) => Math.round((90 - lat) / 180 * th) * tw + Math.round((lon + 180) / 360 * tw);
  console.log(`where history's cradles RANK among all ${arr.length} land tiles:`);
  for (const [n, lo, la] of [["Nile", 28.5, 27], ["Sumer", 47, 30], ["Mid-Euphrates", 44, 33], ["Yellow R.", 114, 35], ["Yangtze", 117, 31]]) {
    const ti = at(lo, la), rank = arr.findIndex(([, t]) => t === ti) + 1;
    console.log(`   ${n.padEnd(14)} ${(world.popField[ti] * br * 1000 / KM2).toFixed(2).padStart(6)} ppl/km²  rank ${String(rank).padStart(5)}  (top ${(100 * rank / arr.length).toFixed(2)}%)`);
  }
}

// Band MEANS, so this is a mean-to-mean ratio — do NOT compare it to history's
// peak-floodplain-to-desert ratio (that is the mean/peak trap in the header).
console.log(`\nband-mean dynamic range prime/marginal: ${(prime / Math.max(1e-9, marg)).toFixed(1)}x`);
console.log(`\nThe ruler: cap = fert x CAP_PER_FERT x (DEV_BASE + DEV_TECH*devF) x reach x works x ...`);
console.log(`  LAND_WORKS=${T.LAND_WORKS} ⇒ fully-improved land is ${1 + (T.LAND_WORKS || 0)}x (its own note cites 2-3x basin irrigation .. 5-15x wet rice)`);
