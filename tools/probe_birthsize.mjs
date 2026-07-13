// Is the coverage-floor "minimum realm size" a constant FRACTION of the map
// across resolutions, or does a coarse (quarter-res) grid inflate it? Builds
// sims at several sim-tile widths, runs to a modest step, and reports the realm
// size distribution as a FRACTION OF LAND (res-invariant if the fix holds) plus
// the raw tile counts. tw=120 is the app's "Quarter" setting; tw=240 is the
// reference; tw=480 is "1×".
//   node tools/probe_birthsize.mjs [steps]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 6000);
const SEED = 8817;
for (const W of [240, 480, 960]) {   // tw = 120 (Quarter), 240 (reference), 480 (1×)
  const world = buildSim({ W, H: W >> 1, seed: SEED });
  stepPeopleSim(world, STEPS);
  const tw = world.tw, th = world.th, NG = tw * th;
  const co = world._countryOwner, elev = world.elev;
  let land = 0; const sz = new Map();
  for (let i = 0; i < NG; i++) {
    if (!(elev[i] > 0)) continue; land++;
    const c = co ? co[i] : -1;
    if (c >= 0) sz.set(c, (sz.get(c) || 0) + 1);
  }
  const counts = [...sz.values()].sort((a, b) => a - b);
  const q = (p) => counts.length ? counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] : 0;
  const asPct = (t) => (100 * t / land).toFixed(2) + "%";
  const min = counts[0] || 0, med = q(0.5), max = counts[counts.length - 1] || 0;
  console.log(`tw=${tw} land=${land} realms=${counts.length}`);
  console.log(`  smallest realm: ${min} tiles = ${asPct(min)} of land`);
  console.log(`  median realm:   ${med} tiles = ${asPct(med)} of land`);
  console.log(`  biggest realm:  ${max} tiles = ${asPct(max)} of land`);
}
