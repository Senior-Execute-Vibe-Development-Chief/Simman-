// Early-game progression probe: WHEN do roads, sea lanes, and states appear,
// and how far do they reach, relative to the tech the world has actually earned?
// Written for the 2026-07 balance pass ("roads/sea lanes too long too early",
// "Stone Age lasts too long", "do we need stateless settlements?").
//
//   node tools/probe_progression.mjs [seed=8817] [steps=24000] [interval=2000]
//
// Per checkpoint: the leading civ's era + best knowledge tracks, settlement /
// stateless / country counts, road-tile census by quality band, the longest
// active land trade link, sea-lane count + the longest lane, and how many ports
// are projecting lanes with vs without the Sailing tech (embark ability).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { techEff } from "../src/sim/peopleSim/settlement.js";
import { ERAS } from "../src/sim/peopleSim/tech.js";

const SEED = parseInt(process.argv[2] || "8817", 10);
const STEPS = parseInt(process.argv[3] || "24000", 10);
const IVL = parseInt(process.argv[4] || "2000", 10);

const world = buildSim({ W: 480, H: 240, seed: SEED });
const tw = world.tw;

const dist = (a, b) => {
  let dx = Math.abs(a.x - b.x); if (dx > tw / 2) dx = tw - dx;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

console.log("step | era | lead k(cons/org/nav/met) | setts free ctry | roadT (<=.1/.1-.3/>.3) maxLink | lanes maxLane | ports sail:noSail | ships");
for (let t = 0; t < STEPS; t += IVL) {
  stepPeopleSim(world, IVL);
  // Leading knowledge across settled settlements.
  let kc = 0, ko = 0, kn = 0, km = 0;
  let setts = 0, free = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    setts++;
    if (s.countryId < 0) free++;
    const k = s.knowledge || {};
    if ((k.construction || 0) > kc) kc = k.construction;
    if ((k.organization || 0) > ko) ko = k.organization;
    if ((k.navigation || 0) > kn) kn = k.navigation;
    if ((k.metallurgy || 0) > km) km = k.metallurgy;
  }
  const nCtry = world.countries ? world.countries.size : 0;
  const era = (world._eraAt || [0]).length - 1;
  // Road census by quality band.
  let rArt = 0, rRoad = 0, rTrail = 0;
  if (world.roadQuality) {
    const rq = world.roadQuality;
    for (const ti of (world._roadTiles || [])) {
      const q = rq[ti];
      if (q <= 0.1) rArt++; else if (q <= 0.3) rRoad++; else rTrail++;
    }
  }
  // Longest active land trade link (Euclidean between the endpoints).
  let maxLink = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s._tradeReach) continue;
    for (const pid of s._tradeReach.keys()) {
      const p = world._byId && world._byId.get(pid);
      if (p) { const d = dist(s.pos, p.pos); if (d > maxLink) maxLink = d; }
    }
  }
  // Sea lanes.
  const lanes = world._seaLanes || [];
  let maxLane = 0;
  for (const ln of lanes) {
    const p = ln.tiles;
    if (!p || p.length < 2) continue;
    const a = { x: (p[0] % tw) + 0.5, y: ((p[0] / tw) | 0) + 0.5 };
    const b = { x: (p[p.length - 1] % tw) + 0.5, y: ((p[p.length - 1] / tw) | 0) + 0.5 };
    const d = dist(a, b);
    if (d > maxLane) maxLane = d;
  }
  // Ports actively projecting sea reach, split by whether they hold Sailing.
  let portsSail = 0, portsNoSail = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s._seaReach || s._seaReach.size === 0) continue;
    if (techEff(s).embark) portsSail++; else portsNoSail++;
  }
  console.log(
    `${String(world.step).padStart(5)} | ${ERAS[era].padEnd(10)} | ` +
    `${kc.toFixed(2)}/${ko.toFixed(2)}/${kn.toFixed(2)}/${km.toFixed(2)} | ` +
    `${String(setts).padStart(4)} ${String(free).padStart(4)} ${String(nCtry).padStart(3)} | ` +
    `${String(rArt).padStart(5)}/${String(rRoad).padStart(5)}/${String(rTrail).padStart(5)} ${maxLink.toFixed(0).padStart(3)} | ` +
    `${String(lanes.length).padStart(3)} ${maxLane.toFixed(0).padStart(3)} | ` +
    `${String(portsSail).padStart(3)}:${String(portsNoSail).padStart(3)} | ` +
    `${(world.ships || []).length}`);
}
