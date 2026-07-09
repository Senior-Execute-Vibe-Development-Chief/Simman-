// Land-claimed / country-count / empire-area vs SIM resolution, at a FIXED map (W).
// The same map at different sim tile resolutions must yield the same POLITICAL shape:
// claimed FRACTION of land, country count, and largest-empire fraction should all be
// resolution-invariant (sampled at matched development, not fixed steps).
//   RES_INVARIANT_POP=1 node tools/probe_landclaim_res.mjs [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const W = parseInt(process.argv[2] || "480", 10), H = W >> 1;
const SEED = parseInt(process.argv[3] || "8817", 10);
T.RES_INVARIANT_POP = process.env.RES_INVARIANT_POP != null ? +process.env.RES_INVARIANT_POP : 1;
const ORG_MARKS = [0.35, 0.45, 0.55];
const DIVS = [1, 2, 4];   // simTileRes: tw = W/div (finer → coarser)
const CHUNK = 250, STEPS = 24000;

for (const div of DIVS) {
  const world = buildSim({ W, H, seed: SEED, simOpts: { simTileRes: div } });
  let land = 0; for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) land++;
  console.log(`\n== map ${W}px · simTileRes ${div} · tw=${world.tw} th=${world.th} · land tiles ${land} ==`);
  console.log(`org   step   claimed%  countries  largest%  meanEmpire%`);
  let next = 0;
  for (let s = 0; s < STEPS && next < ORG_MARKS.length; s += CHUNK) {
    stepPeopleSim(world, CHUNK);
    let leadOrg = 0;
    for (const c of (world.countries ? world.countries.values() : [])) {
      const k = c.capital && c.capital.knowledge;
      if (k && k.organization > leadOrg) leadOrg = k.organization;
    }
    while (next < ORG_MARKS.length && leadOrg >= ORG_MARKS[next]) {
      const st = peopleSimStats(world);
      const claimedPct = (100 * st.landPct).toFixed(1);
      const largestPct = (100 * st.largestEmpire / Math.max(1, st.landTiles)).toFixed(1);
      const meanEmpPct = st.countries > 0 ? (100 * st.claimedTiles / st.landTiles / st.countries).toFixed(2) : "0";
      console.log(`${ORG_MARKS[next].toFixed(2)}  ${String(world.step).padStart(5)}  ${claimedPct.padStart(7)}  ${String(st.countries).padStart(9)}  ${largestPct.padStart(7)}  ${meanEmpPct.padStart(9)}`);
      next++;
    }
  }
  if (next < ORG_MARKS.length) console.log(`(ended at step ${world.step} before org ${ORG_MARKS[next]})`);
}
