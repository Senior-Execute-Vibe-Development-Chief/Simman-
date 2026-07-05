// Probe: what is the TOP of emergent development a run actually reaches?
// Grounds the emergent-endgame design — the "arc complete" trigger must read the
// real ceiling of development, not an invented threshold. Samples, across the run,
// the leading state's organisation, its capital's era, and the six knowledge tracks
// (min/leader), plus the civYear the mapping assigns.
//   node tools/probe_devceiling.mjs [steps] [seed] [W] [H]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, civYearFromOrg } from "../src/sim/peopleSim/index.js";
import { techState, ERAS } from "../src/sim/peopleSim/tech.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);
const H = parseInt(process.argv[5] || "240", 10);
const TRACKS = ["agriculture", "construction", "organization", "metallurgy", "navigation", "mobility"];

const world = buildSim({ W, H, seed: SEED });
const SAMPLE = 1500;
console.log(`── dev-ceiling probe · seed ${SEED} · ${W}x${H} · ${STEPS} steps ──`);
console.log(`step   leadOrg civYear leadEra  minK   maxK   | agri con org met nav mob  (leader's capital)`);
for (let s = 0; s < STEPS; s += SAMPLE) {
  stepPeopleSim(world, Math.min(SAMPLE, STEPS - s));
  // leading state = the settled capital with the highest organisation
  let lead = null, leadOrg = 0;
  for (const c of (world.countries ? world.countries.values() : [])) {
    const k = c.capital && c.capital.knowledge;
    if (k && k.organization > leadOrg) { leadOrg = k.organization; lead = c.capital; }
  }
  if (!lead) { console.log(`${String(world.step).padEnd(6)} (no state yet)`); continue; }
  const k = lead.knowledge;
  const era = techState(k).era;
  const vals = TRACKS.map(t => k[t] || 0);
  const minK = Math.min(...vals), maxK = Math.max(...vals);
  const civY = Math.round(civYearFromOrg(leadOrg));
  console.log(
    `${String(world.step).padEnd(6)} ${leadOrg.toFixed(3).padStart(6)} ${String(civY).padStart(6)}  ${ERAS[era].padEnd(9)} ${minK.toFixed(2)}  ${maxK.toFixed(2)}  | ` +
    vals.map(v => v.toFixed(2)).join(" ")
  );
}
// end-of-run: how many realms ever reached each era, and the global leader
const eraCount = new Array(ERAS.length).fill(0);
let globalMaxEra = 0;
for (const c of world.countries.values()) {
  const k = c.capital && c.capital.knowledge; if (!k) continue;
  const e = techState(k).era; eraCount[e]++; if (e > globalMaxEra) globalMaxEra = e;
}
console.log(`\nend-of-run era census (realms per era): ${eraCount.map((n, i) => `${ERAS[i]}:${n}`).join("  ")}`);
console.log(`highest era reached by any realm: ${ERAS[globalMaxEra]} (index ${globalMaxEra})`);
