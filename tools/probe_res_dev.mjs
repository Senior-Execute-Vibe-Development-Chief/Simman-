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
//
// Reference finding #2 (2026-07-13, the rs=4 arc — road-wiring radii ×rn; same
// seed/step; full percentiles for the reference cell, never recorded before):
//   480 ref:   79 setts | census 39,364 | city p50  66 p90 763 max 9,483 | org mean .382 p50 .425 p90 .471 max .489 | 21 realms / 19.2%
//   tw=480:    88 setts | census 53,228 | city p50 204 p90 1031 max 6,535 | org mean .377 p50 .417 (0.99×/0.98× ref) | 27 / 21.2%
//   tw=960:    73 setts | census 27,040 | city p50  76 p90  763 max 3,745 | org mean .330 p50 .413 (0.86×/0.97× ref) | 12 / 12.9%
// → the MASSES' development clock tracks the reference at both grids post-fix
//   (org p50 0.97–0.98×; pre-fix tw=960 sat at ~0.4×). tw=960's 12k residuals:
//   org MEAN 0.86× (a stateless low-org tail — settlements that lay/receive no
//   roads and haven't crossed ORG_STATE_MIN to nucleate), realms/claimed low at
//   the snapshot (state birth later), apex city 0.39× (river-mag grid-variance
//   thins the free river-trade net: the Nile hearth reads mag4 at tw=240/480,
//   mag3 at tw=960 — see the founding logs). The windowed battery is the judge.
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
