// WHAT GROUND DOES A NATION OF THE LAND ACTUALLY HOLD? — owner-observed at
// the app grid: "a very large imprint with no city, in northern Australia,
// which somehow spread into southern Indonesian islands; then a city got made
// and it lost all that land." Measures every land-nation FORMATION (painted
// tiles, distinct landmasses spanned, share of paint off the seat's own
// landmass, gathered mass vs the founding bar) and every MATERIALISATION
// (painted ground at handover vs the realm's drawn claim shortly after), then
// prints the distributions. km² uses the same real-area convention as resgate
// (Earth surface / N tiles, land tiles only).
//
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_landpaint.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "25000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
const KM2_PER_TILE = 510e6 / world.N;   // whole-globe convention (matches resgate's real-area readout)

// landmass components (4-neighbour, x wraps) — the crawl's own connectivity
function comps(world) {
  const { N, tw, th, elev } = world;
  const comp = new Int32Array(N).fill(-1);
  const stack = [];
  for (let seed = 0; seed < N; seed++) {
    if (comp[seed] >= 0 || elev[seed] <= 0) continue;
    stack.length = 0; stack.push(seed); comp[seed] = seed;
    while (stack.length) {
      const ti = stack.pop();
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const ns = [ty * tw + (tx === 0 ? tw - 1 : tx - 1), ty * tw + (tx === tw - 1 ? 0 : tx + 1),
                  ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      for (let k = 0; k < 4; k++) {
        const ni = ns[k]; if (ni < 0 || comp[ni] >= 0 || elev[ni] <= 0) continue;
        comp[ni] = seed; stack.push(ni);
      }
    }
  }
  return comp;
}

let comp = null;
const known = new Map();   // id → {tiles, masses, offMass, seatComp, formedAt}
const handovers = [];      // {id, paintedTiles, claimAfter}
const pendingHand = new Map();  // id → {paintedTiles, at}
let formed = 0, multiMass = 0;

for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  const seats = world._landSeats, lo = world._landOwner;
  if (seats) {
    // formations: new ids in the seat register
    for (const [id, r] of seats) {
      if (known.has(id)) continue;
      if (!comp) comp = comps(world);
      const seatComp = comp[r.ti];
      let tiles = 0, off = 0; const masses = new Set();
      for (let t = 0; t < lo.length; t++) if (lo[t] === id) { tiles++; masses.add(comp[t]); if (comp[t] !== seatComp) off++; }
      known.set(id, { tiles, masses: masses.size, off, formedAt: world.step });
      formed++;
      if (masses.size > 1) multiMass++;
      console.log(`FORMED  id ${id} @${world.step}: ${tiles} tiles (${Math.round(tiles * KM2_PER_TILE / 1000)}k km²), ${masses.size} landmass(es), ${(100 * off / Math.max(1, tiles)).toFixed(0)}% off the seat's`);
    }
    // materialisations: known ids gone from the register
    for (const [id, rec] of known) {
      if (seats.has(id) || rec.done) continue;
      rec.done = true;
      pendingHand.set(id, { paintedTiles: rec.tiles, at: world.step });
      console.log(`MATERIALISED id ${id} @${world.step} (held ${rec.tiles} tiles at formation)`);
    }
  }
  // 500 steps after a handover, count the realm's drawn claim
  for (const [id, h] of pendingHand) {
    if (world.step - h.at < 500) continue;
    const claim = world._countryClaim;
    let n = 0;
    if (claim) for (let t = 0; t < claim.length; t++) if (claim[t] === id) n++;
    handovers.push({ id, painted: h.paintedTiles, claimAfter: n });
    console.log(`  → drawn claim of ${id} 500 steps on: ${n} tiles (${(100 * n / Math.max(1, h.paintedTiles)).toFixed(0)}% of the nation's ground)`);
    pendingHand.delete(id);
  }
}
const sizes = [...known.values()].map(r => r.tiles).sort((a, b) => a - b);
const med = sizes.length ? sizes[sizes.length >> 1] : 0;
console.log(`\nformations ${formed} · spanning >1 landmass: ${multiMass} (${(100 * multiMass / Math.max(1, formed)).toFixed(0)}%)`);
console.log(`imprint tiles min/med/max: ${sizes[0] || 0}/${med}/${sizes[sizes.length - 1] || 0}  (${Math.round((sizes[0] || 0) * KM2_PER_TILE / 1000)}k/${Math.round(med * KM2_PER_TILE / 1000)}k/${Math.round((sizes[sizes.length - 1] || 0) * KM2_PER_TILE / 1000)}k km²)`);
if (handovers.length) {
  const keep = handovers.map(h => h.claimAfter / Math.max(1, h.painted));
  keep.sort((a, b) => a - b);
  console.log(`materialisations ${handovers.length} · ground kept in the drawn map (median): ${(100 * keep[keep.length >> 1]).toFixed(0)}%`);
}
