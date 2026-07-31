// DID STATEHOOD SPREAD FROM CRADLES, OR SPAWN EVERYWHERE AT ONCE?
//
// Owner: "In real life, early nations were almost entirely within a very specific
// area, be it the Fertile Crescent or Yangtze, and spread from there, they did NOT
// spawn across the whole area and grow independently."
//
// Three independent readings of that one claim, all emergent, none a distance
// constant the sim knows about:
//
//   SEED DISTANCE — for every realm born since the last checkpoint, how far its
//     seat is from the NEAREST ALREADY-EXISTING realm's seat. A world that spreads
//     puts new states next to old ones (small, roughly the reach of a frontier);
//     a world that spawns independently scatters them (large, ~the map).
//
//   CRADLE DISTANCE — every living realm's seat to the nearest genesis cradle.
//     Rises as civilisation radiates; should start near zero.
//
//   LINEAGE — the share of realms whose capital's people DESCEND from a cradle
//     people (cultures.js familyOf: the root of the culture tree, which a cradle
//     founds and every daughter inherits). This is the strongest reading, because
//     it is a fact about ancestry rather than geometry: a state founded by settlers
//     out of Sumer reads "descended" wherever it stands, and one that arose on its
//     own reads "independent" even if it is next door. Reported with the number of
//     distinct families among realms — 4-ish means the world has a few cradles of
//     civilisation, dozens means every valley invented the state by itself.
//
//   node tools/probe_dawnspread.mjs [W=960] [steps=8000] [ck=1000] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { familyOf, dominantCulture } from "../src/sim/peopleSim/cultures.js";
import { stepToYear } from "../src/sim/calendar.js";

const W = +(process.argv[2] || 960), H = W >> 1;
const STEPS = +(process.argv[3] || 8000), CK = +(process.argv[4] || 1000);
const SEED = +(process.argv[5] || 8817);

const w = buildSim({ W, H, seed: SEED });
const { tw, th } = w;
const yr = s => { const y = Math.round(stepToYear(s)); return y < 0 ? `${-y}BC` : `${y}AD`; };
const med = a => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
// Torus in x, not in y — the same wrap every pass in the sim uses.
const dist = (a, b) => {
  let dx = Math.abs(a.x - b.x); if (dx > tw / 2) dx = tw - dx;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};
const seatOf = (c) => (c && c.capital && c.capital.mode === "settled")
  ? { x: c.capital.pos.x | 0, y: c.capital.pos.y | 0 } : null;

// CRADLES: at step 0 the only settlements in the world ARE the genesis hearths
// (the four the log announces — Nile, Mesopotamia, Indus, Yellow River). Read
// them before the first tick rather than inferring them from polity records,
// which are not populated until the first pass.
const cradleSeats = [], cradleFams = new Set();
for (const s of w.settlements) {
  cradleSeats.push({ x: s.pos.x | 0, y: s.pos.y | 0 });
  const cul = dominantCulture(s);
  if (cul >= 0) cradleFams.add(familyOf(w, cul));
}
console.log(`tw=${tw} seed=${SEED}  cradles=${cradleSeats.length} at ${cradleSeats.map(s => `(${s.x},${s.y})`).join(" ")}  cradle families=${[...cradleFams].join(",")}`);
console.log("step\tyear\trealms\tnew\tseedDist med/p90\tcradleDist med\tdescended%\tfamilies");

let prev = new Map();   // realm id -> seat, as of the previous checkpoint
for (let t = CK; t <= STEPS; t += CK) {
  stepPeopleSim(w, CK);
  const now = new Map();
  const cradleD = [], fams = new Map();
  let descended = 0, counted = 0;
  if (w.countries) for (const [cid, c] of w.countries) {
    const s = seatOf(c); if (!s) continue;
    now.set(cid, s);
    if (cradleSeats.length) cradleD.push(Math.min(...cradleSeats.map(cs => dist(s, cs))));
    const cul = c.capital ? dominantCulture(c.capital) : -1;
    if (cul >= 0) {
      const fam = familyOf(w, cul);
      fams.set(fam, (fams.get(fam) || 0) + 1);
      counted++; if (cradleFams.has(fam)) descended++;
    }
  }
  // Where were the NEW realms born, relative to the states that already existed?
  const seedD = [];
  for (const [cid, s] of now) {
    if (prev.has(cid) || prev.size === 0) continue;
    let best = Infinity;
    for (const ps of prev.values()) { const d = dist(s, ps); if (d < best) best = d; }
    if (Number.isFinite(best)) seedD.push(best);
  }
  seedD.sort((a, b) => a - b);
  const p90 = seedD.length ? seedD[Math.min(seedD.length - 1, Math.floor(seedD.length * 0.9))] : NaN;
  const f = (x) => Number.isFinite(x) ? x.toFixed(1) : "-";
  console.log([t, yr(t), now.size, seedD.length,
    `${f(med(seedD))}/${f(p90)}`, f(med(cradleD)),
    counted ? `${Math.round(100 * descended / counted)}%` : "-", fams.size].join("\t"));
  prev = now;
}
