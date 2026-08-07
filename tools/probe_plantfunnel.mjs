// Which gate binds the state-planted-town channel? maybePlantTowns keeps a live
// funnel (world.debug.plant: pop/org/strain/coin/cool → elig → cand/iso → planted);
// this prints it per checkpoint with the world's own context (median capital
// census vs the bar, org spread, median treasury) so the binding constraint is
// named by measurement, not guessed. PLANT_EARLY re-grounded the pop gate and the
// 16k shape run came back BYTE-IDENTICAL to control — zero plants either way —
// so the wall is further down the chain.
//   SIM_TUNE="PLANT_EARLY=1" node tools/probe_plantfunnel.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 16000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H, seed: SEED });
world.debug = world.debug || {};

let last = { pop: 0, org: 0, strain: 0, coin: 0, cool: 0, elig: 0, cand: 0, iso: 0, planted: 0 };
for (let ck = 2000; ck <= STEPS; ck += 2000) {
  while (world.step < ck) stepPeopleSim(world, 1);
  const d = (world.debug && world.debug.plant) || last;
  const delta = {};
  for (const k of Object.keys(last)) { delta[k] = (d[k] || 0) - last[k]; last[k] = d[k] || 0; }
  const caps = [], orgs = [], treas = [];
  if (world.countries) for (const [cid, c] of world.countries) {
    if (!c.capital || c.capital.mode !== "settled") continue;
    caps.push(c.capital.people || 0);
    orgs.push((c.capital.knowledge && c.capital.knowledge.organization) || 0);
    const p = world.polities && world.polities.get(cid);
    treas.push((p && p.treasury) || 0);
  }
  const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
  console.log(`step ${ck}: blocked pop=${delta.pop} org=${delta.org} strain=${delta.strain} coin=${delta.coin} cool=${delta.cool} | elig=${delta.elig} cand=${delta.cand} iso=${delta.iso} PLANTED=${delta.planted} | medians: capPeople=${med(caps).toFixed(0)} (townBar=${(world._townBar || 0).toFixed(0)}) org=${med(orgs).toFixed(2)} treasury=${med(treas).toFixed(0)}`);
}
