// Matched-step DEVELOPMENT snapshot across resolutions — the instrument behind the
// 960 loop-closure's residual diagnosis (docs/empire-consolidation-2026-07.md "960
// LOOP CLOSED"; docs/audit-2026-07.md OPEN #5b). Run it at two grids with the same
// seed/steps and compare: it discriminates a founding-density residual (more,
// smaller cities at the finer grid) from a rate residual (same cities, slower
// learning) from a demographic-base residual (field level scaling with tile count).
//
//   node tools/probe_res_dev.mjs [W] [steps] [seed]
//   node tools/probe_res_dev.mjs 480 12000 8817
//   node tools/probe_res_dev.mjs 960 12000 8817
//
// Reference finding (2026-07-13, seed 8817, step 12k — the numbers that pinned
// audit OPEN #5b; re-measure after any invariance fix):
//   480: 79 setts | census 39,364 | popField  9,976,046 | city mean 498 max 9,483 | org mean .382 max .489
//   960: 87 setts | census 29,902 | popField 31,418,458 | city mean 344 max 4,376 | org mean .321 max .432
// → settlement count res-invariant (the audit's spacing fixes hold); the FIELD is
//   ~3.15× (CAP_PER_FERT/SEED_POP are per-tile); cities SMALLER and org SLOWER at
//   960 (per-edge transport costs unnormalized → trade/diffusion reach halves).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const STEPS = +(process.argv[3] || 12000);
const SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H, seed: SEED });
stepPeopleSim(world, STEPS);

const setts = world.settlements.filter(s => s.mode === "settled");
const pops = setts.map(s => s.people || 0).sort((a, b) => a - b);
const orgs = setts.map(s => (s.knowledge && s.knowledge.organization) || 0).sort((a, b) => a - b);
const sum = a => a.reduce((x, y) => x + y, 0);
const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0;
let pf = 0; if (world.popField) for (let i = 0; i < world.popField.length; i++) pf += world.popField[i];
const NG = world.tw * world.th;
let claimed = 0, landN = 0; const cs = new Set();
const co = world._countryOwner;
for (let i = 0; i < NG; i++) { if (!(world.elev[i] > 0)) continue; landN++; if (co && co[i] >= 0) { claimed++; cs.add(co[i]); } }
console.log(JSON.stringify({
  W, tw: world.tw, STEPS, SEED,
  settlements: setts.length,
  censusPop: Math.round(sum(pops)),
  popField: Math.round(pf),
  cityPop: { mean: Math.round(sum(pops) / Math.max(1, pops.length)), p50: Math.round(q(pops, 0.5)), p90: Math.round(q(pops, 0.9)), max: Math.round(pops[pops.length - 1] || 0) },
  org: { mean: +(sum(orgs) / Math.max(1, orgs.length)).toFixed(3), p50: +q(orgs, 0.5).toFixed(3), p90: +q(orgs, 0.9).toFixed(3), max: +(orgs[orgs.length - 1] || 0).toFixed(3) },
  realms: cs.size, claimedPct: +(100 * claimed / landN).toFixed(1),
}, null, 1));
