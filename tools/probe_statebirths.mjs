// WHICH DOOR does the late-belt state swarm walk through? STATE_OPEN lap 1
// (Carneiro bar at the pristine nucleation door) measured INERT: 45k belt
// composition unchanged. Two untested hypotheses: (a) seats read caged anyway
// (the cage field weights the HOME strip's quality, so any good river site
// reads hemmed relative to its plain); (b) the swarm never walks the pristine
// door at all — one state per belt, then fission/secession/tribal channels
// tile the continent. This tallies EVERY state birth by channel x region,
// prints the nucleate funnel (did 'openLand(uncaged)' ever fire?), and the
// cageAt distribution at live seats per region.
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_statebirths.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport } from "../src/sim/peopleSim/telemetry.js";
import { cageAt } from "../src/sim/peopleSim/cageField.js";

const STEPS = +(process.argv[2] || 35000), W = +(process.argv[3] || 960), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
telEnable(world);

const regionOf = (x, y) => {
  const lon = (x / world.tw) * 360 - 180, lat = 90 - (y / world.th) * 180;
  if (lon < -30) return "Americas";
  if (lat < -10 && lat > -45 && lon > 110 && lon < 155) return "Australia";
  return "OldWorld";
};

let lastEv = -1;
const births = new Map();   // `${region}:${channel}` → count
function tally() {
  for (const e of world.events || []) {
    if (e.id <= lastEv) continue;
    lastEv = e.id;
    let ch = null;
    if (e.type === "polity.founded") ch = `founded/${e.how || "emerged"}`;
    else if (e.type === "polity.seceded") ch = `seceded/${e.how || "split"}`;
    else if (e.type === "polity.restored") ch = "restored";
    else continue;
    let x = e.x, y = e.y;
    if (x === undefined) {
      // fall back to the polity's live seat if the event carries no coords
      const c = world.countries && world.countries.get(e.polity);
      if (c && c.capital) { x = c.capital.pos.x | 0; y = c.capital.pos.y | 0; }
    }
    const reg = x === undefined ? "unknown" : regionOf(x, y);
    const k = `${reg}:${ch}`;
    births.set(k, (births.get(k) || 0) + 1);
  }
}
for (let s = 1; s <= STEPS; s++) { stepPeopleSim(world, 1); if (s % 500 === 0) tally(); }
tally();

console.log(`[statebirths] ${STEPS} steps tw=${world.tw} seed=${SEED}`);
for (const reg of ["OldWorld", "Americas", "Australia", "unknown"]) {
  const rows = [...births.entries()].filter(([k]) => k.startsWith(reg + ":")).sort((a, b) => b[1] - a[1]);
  if (!rows.length) continue;
  console.log(`  ${reg}: ${rows.map(([k, v]) => `${k.split(":")[1]}=${v}`).join(" ")}`);
}
console.log(`  nucleateFunnel: ${JSON.stringify(telReport(world).nucleate || {})}`);
// live seats: cage distribution per region
const cages = new Map();
if (world.countries) for (const [, c] of world.countries) {
  if (!c.capital) continue;
  const x = c.capital.pos.x | 0, y = c.capital.pos.y | 0;
  const reg = regionOf(x, y);
  let a = cages.get(reg); if (!a) cages.set(reg, a = []);
  a.push(cageAt(world, y * world.tw + x));
}
for (const [reg, a] of cages) {
  a.sort((p, q) => p - q);
  const q = (p) => a.length ? a[Math.min(a.length - 1, (p * a.length) | 0)].toFixed(2) : "-";
  console.log(`  liveSeats ${reg}: n=${a.length} cage p10=${q(0.1)} p50=${q(0.5)} p90=${q(0.9)}`);
}
