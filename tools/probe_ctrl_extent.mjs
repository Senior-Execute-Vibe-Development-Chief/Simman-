// Does the control field draw VASTER than the authoritative map — and does it MERGE weak realms
// into a dominant one (overwrite)? Compares, at a given resolution: total claimed %, the LARGEST
// realm's share, and the REALM COUNT, for the real _countryOwner vs the field _ctrlOwner. If the
// field's largest share >> real's, or its realm count << real's, the field over-floods / overwrites.
//   node tools/probe_ctrl_extent.mjs [W] [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

applyTuning({ CONTROL_FIELD: 1 });
const W = +(process.argv[2] || 480), H = W >> 1;
const STEPS = +(process.argv[3] || 6000);
const SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H, seed: SEED });
const N = world.N, elev = world.elev;

function stats(arr) {
  if (!arr) return null;
  const cnt = new Map(); let land = 0, owned = 0;
  for (let t = 0; t < N; t++) {
    if (elev[t] <= 0) continue; land++;
    const o = arr[t]; if (o < 0) continue; owned++;
    cnt.set(o, (cnt.get(o) || 0) + 1);
  }
  let max = 0; for (const v of cnt.values()) if (v > max) max = v;
  return { land, owned, realms: cnt.size, frac: owned / land, largest: max / land, largestOfOwned: owned ? max / owned : 0 };
}

stepPeopleSim(world, STEPS);
const real = stats(world._countryOwner);
const field = stats(world._ctrlOwner);
const pct = (x) => (x * 100).toFixed(1) + "%";
console.log(`\n  ${W}x${H}  step ${STEPS}`);
console.log(`  REAL  (_countryOwner): claimed ${pct(real.frac)}  realms ${real.realms}  largest ${pct(real.largest)} of map (${pct(real.largestOfOwned)} of claimed)`);
console.log(`  FIELD (_ctrlOwner)   : claimed ${pct(field.frac)}  realms ${field.realms}  largest ${pct(field.largest)} of map (${pct(field.largestOfOwned)} of claimed)`);
console.log(`  → field/real claimed ratio ${(field.frac/real.frac).toFixed(2)}×   largest-realm ratio ${(field.largest/real.largest).toFixed(2)}×   realmΔ ${field.realms-real.realms}`);
