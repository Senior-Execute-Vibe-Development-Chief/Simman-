// SATRAPIZE instrument: does the second act fire, and does the top of the
// hierarchy finally rise? Reports per checkpoint: polity count, vassal-bond
// stock, integrations so far (polity.ended how:"integrated"), top-1 share of
// claimed land and top-5 areas — plus the integrate funnel (telemetry) at the
// end, so a zero is attributed to its binding gate, never guessed.
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_satrapize.mjs [steps] [W] [seed] [every]
//   A/B: SIM_TUNE="DAWN_LIVE=1,SATRAPIZE=0" ...
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport } from "../src/sim/peopleSim/telemetry.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = +(process.argv[5] || 3000);

const world = buildSim({ W, H, seed: SEED });
telEnable(world);
let landN = 0; for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) landN++;
const km2PerTile = (510e6 * 0.29) / landN;
console.log(`[satrapize] W=${W} (tw=${world.tw}) seed=${SEED} steps=${STEPS} SATRAPIZE=${T.SATRAPIZE}`);

function integrations() {
  let n = 0;
  const ev = world.events || [];
  for (const e of ev) if (e.type === "polity.ended" && e.how === "integrated") n++;   // events store fields flat
  return n;
}

function report(step) {
  const co = world._countryOwner, elev = world.elev, N = world.N;
  const tiles = new Map(); let claimed = 0;
  for (let i = 0; i < N; i++) { if (!(elev[i] > 0)) continue; const c = co ? co[i] : -1; if (c >= 0) { claimed++; tiles.set(c, (tiles.get(c) || 0) + 1); } }
  const areas = [...tiles.values()].sort((a, b) => b - a);
  const tot = areas.reduce((a, b) => a + b, 0) || 1;
  const bonds = world._overlordOf ? world._overlordOf.size : 0;
  console.log(`t=${step} polities=${areas.length} bonds=${bonds} integrated=${integrations()} ` +
    `top1=${(areas[0] * 100 / tot).toFixed(1)}% claimed=${(claimed * 100 / landN).toFixed(1)}% ` +
    `top5km2=${areas.slice(0, 5).map(a => Math.round(a * km2PerTile / 1000)).join("k,")}k`);
}

for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % EVERY === 0) report(s);
}
const rep = telReport(world);
console.log("[funnel integrate]", JSON.stringify(rep.integrate || {}));
console.log("[funnel submit]", JSON.stringify(rep.submit || {}));
