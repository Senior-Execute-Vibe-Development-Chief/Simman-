// WHAT DOES ONE KM² OF THE BEST LAND FEED? — the capacity ruler's TOP END and
// its DYNAMIC RANGE, the quantity the Fertile-Crescent investigation landed on
// (docs/state-birth-2026-08.md, 2026-08-06).
//
// The food economy is scored everywhere else by RATIOS (fill %, shares, cross-
// grid bands), all of which pass while the absolute ceiling is wrong. This
// prints the absolute: people per km² on prime land, on river ribbons, and on
// marginal land, with the works multiple that is already applied — against the
// historical anchors. A world whose capacity ruler is uniformly N× too low
// passes every existing gate, exactly as a world of uniformly 10×-too-small
// realms passed every empire ratio before tools/resgate.mjs existed.
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
console.log("band                           | tiles       | fert | works  | fill | density        historical anchor");
const prime = band("prime land (fert>0.85)", ti => (world.fert[ti] || 0) > 0.85, "← real prime pre-industrial: 15-50");
band("river ribbon (rMag>=3)", ti => (world.riverMag ? world.riverMag[ti] : 0) >= 3, "← real great-river floodplain: 20-50");
band("middling (0.4<fert<0.85)", ti => { const f = world.fert[ti] || 0; return f > 0.4 && f <= 0.85; }, "");
const marg = band("marginal (fert<0.4)", ti => (world.fert[ti] || 0) <= 0.4, "");
band("ALL LAND", () => true, "← real world average at 25M: ~0.17");

console.log(`\nDYNAMIC RANGE prime/marginal: ${(prime / Math.max(1e-9, marg)).toFixed(1)}x`);
console.log(`  (history's range is HUNDREDS: prime floodplain ~20-50 vs desert/steppe ~0.05-0.5)`);
console.log(`\nThe ruler: cap = fert x CAP_PER_FERT x (DEV_BASE + DEV_TECH*devF) x reach x works x ...`);
console.log(`  LAND_WORKS=${T.LAND_WORKS} ⇒ fully-improved land is ${1 + (T.LAND_WORKS || 0)}x (its own note cites 2-3x basin irrigation .. 5-15x wet rice)`);
if (prime > 0) console.log(`  prime land AT FULL WORKS would still be ~${(prime * (1 + (T.LAND_WORKS || 0)) / (1 + (T.LAND_WORKS || 0) * 0.4)).toFixed(1)} ppl/km²`);
