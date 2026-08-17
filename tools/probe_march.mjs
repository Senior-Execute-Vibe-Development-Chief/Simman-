// MARCH_LAW attribution probe: does the law fire, and what rejects it?
// Prints the march funnel + realm-realm land adjacency count per checkpoint.
//   SIM_TUNE="DAWN_LIVE=1" node probe_march.mjs [steps] [W] [seed] [ivl]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport } from "../src/sim/peopleSim/telemetry.js";

const STEPS = +(process.argv[2] || 15000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const IVL = +(process.argv[5] || 3000);
const world = buildSim({ W, H, seed: SEED });
telEnable(world);

function borderPairs() {
  const { tw, th, N } = world;
  const co = world._countryOwner; if (!co) return { edges: 0, pairs: 0 };
  const seen = new Set();
  let edges = 0;
  for (let ti = 0; ti < N; ti++) {
    const a = co[ti]; if (a < 0) continue;
    const y = (ti / tw) | 0, x = ti - y * tw;
    const ns = [y * tw + ((x + 1) % tw), y < th - 1 ? ti + tw : -1];
    for (const ni of ns) {
      if (ni < 0) continue;
      const b = co[ni]; if (b < 0 || b === a) continue;
      edges++;
      seen.add(Math.min(a, b) + ":" + Math.max(a, b));
    }
  }
  return { edges, pairs: seen.size };
}

for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % IVL === 0) {
    const bp = borderPairs();
    console.log(`step ${s} borders: edges=${bp.edges} pairs=${bp.pairs} funnel=${JSON.stringify(telReport(world).march || {})}`);
  }
}
