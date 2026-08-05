// Per-CONTINENT and per-CRADLE development trajectories — the instrument for two
// owner reports (2026-08): "the Americas grow tech and civilization at the exact
// same speed as Eurasia" (the Diamond-mechanism levers exist — DIFF_CLIM, AXIS_BIAS,
// TSETSE, STATE_DISEASE, FOREST_LOCK, winter aptitude — so if the outcome is
// lockstep, something equalizes AROUND them), and "the Middle East doesn't become a
// centre of civilization even though a hearth is there."
//   Continents = connected landmasses (the sim's own landLabels equivalent, 4-neigh
// flood). Cradle regions = fixed fractional windows around the Earth-preset hearth
// sites (a PROBE may name places; sim code never does). Per checkpoint: settled
// count, field population, median/max organization+agriculture among settlements,
// era census, realm count — per landmass and per region.
//   node tools/probe_continents.mjs [steps] [W] [seed] [every]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 24000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = +(process.argv[5] || 3000);

const world = buildSim({ W, H, seed: SEED });
const { tw, th, N, elev } = world;

// Landmass labels (4-connected, longitude wraps) — computed once.
const lab = new Int32Array(N).fill(-1);
{
  const q = [];
  let next = 0;
  for (let s = 0; s < N; s++) {
    if (lab[s] >= 0 || elev[s] <= 0) continue;
    const id = next++;
    lab[s] = id; q.length = 0; q.push(s);
    while (q.length) {
      const ti = q.pop();
      const y = (ti / tw) | 0, x = ti - y * tw;
      const ns = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1];
      for (const ni of ns) if (ni >= 0 && elev[ni] > 0 && lab[ni] < 0) { lab[ni] = id; q.push(ni); }
    }
  }
}
const massSize = new Map();
for (let i = 0; i < N; i++) if (lab[i] >= 0) massSize.set(lab[i], (massSize.get(lab[i]) || 0) + 1);
const bigMasses = [...massSize.entries()].filter(([, n]) => n > N * 0.004).sort((a, b) => b[1] - a[1]).map(([id]) => id);
// Name the big masses by their centroid longitude/latitude (report labels only).
const massName = new Map();
for (const id of bigMasses) {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < N; i++) if (lab[i] === id) { sy += (i / tw) | 0; sx += i % tw; n++; }
  const fx = sx / n / tw, fy = sy / n / th;
  massName.set(id, `mass${id}(${fx.toFixed(2)},${fy.toFixed(2)},${Math.round(massSize.get(id) * 100 / (N * 0.29))}%land)`);
}

// Cradle regions on the Earth preset (fractional coords from the hearth seeder's own log).
const REGIONS = [
  ["Mesopotamia", 0.62, 0.315], ["Nile", 0.575, 0.335], ["Indus", 0.705, 0.345],
  ["YellowRiver", 0.82, 0.315], ["Europe", 0.50, 0.21], ["MesoAmer", 0.16, 0.42],
];
const RR = Math.round(7 * (tw / 240));

function report() {
  const co = world._countryOwner, pf = world.popField;
  const byMass = new Map(), byRegion = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    const m = lab[ti];
    if (m >= 0) { let a = byMass.get(m); if (!a) byMass.set(m, a = []); a.push(s); }
    for (const [name, fx, fy] of REGIONS) {
      let dx = Math.abs(s.pos.x - fx * tw); if (dx > tw / 2) dx = tw - dx;
      const dy = s.pos.y - fy * th;
      if (dx * dx + dy * dy <= RR * RR) { let a = byRegion.get(name); if (!a) byRegion.set(name, a = []); a.push(s); }
    }
  }
  const line = (tag, arr, popSum, realms) => {
    if (!arr.length) { console.log(`   ${tag.padEnd(34)} —`); return; }
    const orgs = arr.map(s => (s.knowledge && s.knowledge.organization) || 0).sort((a, b) => a - b);
    const agri = arr.map(s => (s.knowledge && s.knowledge.agriculture) || 0).sort((a, b) => a - b);
    const med = a => a[a.length >> 1] || 0, mx = a => a[a.length - 1] || 0;
    console.log(`   ${tag.padEnd(34)} sett=${String(arr.length).padStart(3)} realms=${String(realms).padStart(3)} pop=${(popSum / 1000).toFixed(0)}k  org ${med(orgs).toFixed(2)}/${mx(orgs).toFixed(2)}  agri ${med(agri).toFixed(2)}/${mx(agri).toFixed(2)}`);
  };
  console.log(`\n=== step ${world.step}`);
  for (const id of bigMasses) {
    const arr = byMass.get(id) || [];
    let pop = 0; if (pf) for (let i = 0; i < N; i++) if (lab[i] === id) pop += pf[i];
    const realms = new Set(); for (const s of arr) if (s.countryId >= 0) realms.add(s.countryId);
    line(massName.get(id), arr, pop, realms.size);
  }
  for (const [name, fx, fy] of REGIONS) {
    const arr = byRegion.get(name) || [];
    let pop = 0;
    if (pf) {
      const cx = Math.round(fx * tw), cy = Math.round(fy * th);
      for (let dy = -RR; dy <= RR; dy++) for (let dx = -RR; dx <= RR; dx++) {
        if (dx * dx + dy * dy > RR * RR) continue;
        const yy = cy + dy; if (yy < 0 || yy >= th) continue;
        const ti = yy * tw + (((cx + dx) % tw) + tw) % tw;
        if (elev[ti] > 0) pop += pf[ti];
      }
    }
    const realms = new Set(); for (const s of arr) if (s.countryId >= 0) realms.add(s.countryId);
    line(`  ${name}`, arr, pop, realms.size);
  }
}

while (world.step < STEPS) {
  const next = Math.min(STEPS, world.step + EVERY);
  while (world.step < next) stepPeopleSim(world, 1);
  report();
}
