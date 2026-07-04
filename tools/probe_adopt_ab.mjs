// Adoption-source A/B (adoption-off-render recon). Compares the realm-SIZE
// distribution under the two existing adoption sources so we can see what the
// render-crawl gating actually buys before replacing it:
//   default            → adopt off the CRAWLED claim (_countryClaim, the render)
//   SIM_ADOPT_TARGET=1 → adopt off the raw projected TARGET (_countryOwner) — the
//                        pre-crawl behaviour the comments blame for runaway growth.
// If the target run shows markedly BIGGER top realms / higher concentration, the
// crawl-gating IS the load-bearing anti-runaway throttle the refactor must preserve.
//   SIM_ADOPT_TARGET=1 node tools/probe_adopt_ab.mjs [steps] [seed] [W] [H]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "8000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);
const H = parseInt(process.argv[5] || "240", 10);
const w = buildSim({ W, H, seed: SEED });
stepPeopleSim(w, STEPS);

// tiles per country from the RENDERED claim (what's actually painted/adopted)
const claim = w._countryClaim || w._countryOwner;
const tally = new Map();
let land = 0;
for (let i = 0; i < claim.length; i++) {
  const c = claim[i];
  if (w.elev[i] > 0) land++;
  if (c >= 0) tally.set(c, (tally.get(c) || 0) + 1);
}
const sizes = [...tally.values()].sort((a, b) => b - a);
const claimed = sizes.reduce((a, b) => a + b, 0);
const top = sizes[0] || 0;
const top5 = sizes.slice(0, 5).reduce((a, b) => a + b, 0);
// Gini of realm sizes (concentration)
let gini = 0; const n = sizes.length;
if (n > 1) { let cum = 0; for (let i = 0; i < n; i++) cum += (i + 1) * sizes[n - 1 - i]; gini = (2 * cum) / (n * claimed) - (n + 1) / n; }
const st = peopleSimStats(w);
const mode = process.env.SIM_ADOPT_TARGET ? "TARGET (pre-crawl)" : "CRAWL (default)";
console.log(`adopt=${mode.padEnd(20)} seed=${SEED} ${W}x${H} @${STEPS}  realms=${n} setts=${st.settlements}`);
console.log(`  land=${land} claimed=${claimed} (${(100*claimed/land).toFixed(1)}%)  top=${top} (${(100*top/land).toFixed(1)}% of land)  top5=${(100*top5/land).toFixed(1)}%  gini=${gini.toFixed(3)}  pop=${st.totalPeople}`);
