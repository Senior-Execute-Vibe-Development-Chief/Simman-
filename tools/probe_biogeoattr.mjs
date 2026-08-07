// CROP_BIOGEO claimed-land attribution — the 2×2 (grid × lever) decomposition.
//
// The distance field is cross-grid converged (probe_biogeodrift, post
// refBandwidth), yet resgate 8817 still fails claimed land at the app grid
// (0.36 vs 0.44) while 4242 clears (0.58). So the residual loss is DOWNSTREAM
// of the field. This prints the chain link by link at one grid so the 2×2
// across runs shows which link breaks fine-grid-only:
//
//   package coverage %  →  mean adaptMul on land  →  field population
//   →  settled count    →  claimed land %
//
//   SIM_TUNE="CROP_BIOGEO=1" node tools/probe_biogeoattr.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { bestPackageAt } from "../src/sim/peopleSim/agriculture.js";
import { packageAdaptMul, ensureDistFields } from "../src/sim/peopleSim/biogeography.js";
import { CROP_PACKAGES } from "../src/sim/cropPackages.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "6000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
for (let i = 0; i < STEPS; i++) stepPeopleSim(world);

const { tw, th, elev, N } = world;
if (T.CROP_BIOGEO) ensureDistFields(world);
let land = 0, covered = 0, adaptSum = 0, adaptN = 0;
for (let ti = 0; ti < N; ti++) {
  if (!(elev[ti] > 0)) continue;
  land++;
  const b = bestPackageAt(world, ti);
  if (b) {
    covered++;
    if (T.CROP_BIOGEO) {
      const pkg = CROP_PACKAGES.find((p) => p.id === b.id);
      if (pkg) { adaptSum += packageAdaptMul(world, ti, pkg); adaptN++; }
    }
  }
}
let fieldPop = 0;
if (world.popField) for (let ti = 0; ti < N; ti++) fieldPop += world.popField[ti];
const settled = world.settlements.filter((s) => s.mode === "settled").length;
const co = world._countryOwner;
let claimed = 0;
if (co) for (let ti = 0; ti < N; ti++) if (elev[ti] > 0 && co[ti] >= 0) claimed++;
const realms = world.countries ? world.countries.size : 0;

console.log(`BIOGEO=${T.CROP_BIOGEO}  tw=${tw} seed=${SEED} @${world.step}`);
console.log(`  package coverage      ${(100 * covered / Math.max(1, land)).toFixed(1)}% of land`);
console.log(`  mean adaptMul (covered land)  ${adaptN ? (adaptSum / adaptN).toFixed(3) : "n/a (lever off = 1)"}`);
console.log(`  field population      ${Math.round(fieldPop)}`);
console.log(`  settled               ${settled}`);
console.log(`  realms                ${realms}`);
console.log(`  claimed land          ${(100 * claimed / Math.max(1, land)).toFixed(2)}% of land`);
