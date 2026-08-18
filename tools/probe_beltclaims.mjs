// The late-belt over-claiming diagnosis (owner, 2026-08-18): at the caravels
// moment the world holds ~37M km2 claimed where history held ~15-20M, and the
// excess sits BEYOND the hegemon's belt (belt#2: 14.3M across 53 confetti
// realms — the real Americas at contact held ~2.5M of state-organized land
// total). PORTER_BOUND capped the SIZE of horseless-belt states, but nothing
// caps their coverage — the swarm re-fills the continent. This instrument
// separates the two candidate mechanisms:
//   A. COUNT: too many states (each rightly small, together blanketing);
//   B. CLAIM: states claiming march land they don't actually administer
//      (claims outrunning worked catchment + population density).
// Per belt (probe_beltshare's contact-connected components): claimed km2,
// realm count + size dist, WORKED share of claimed land (world._fpWorked —
// the economic catchment vs the admin march), popField density on claimed
// vs on worked land (and vs the top belt's core density), mean capital
// mobility/navigation (the PORTER_BOUND logistic profile), centroid lat/lon
// (so a belt id has a NAME on the map).
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_beltclaims.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
const STEPS = +(process.argv[2] || 45000), W = +(process.argv[3] || 960), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
const EVERY = 5000;
for (let s = 1; s <= STEPS; s++) { stepPeopleSim(world, 1); if (s % EVERY === 0) report(s); }

function report(step) {
  const co = world._countryOwner, elev = world.elev, tw = world.tw, th = world.th, N = world.N;
  const worked = world._fpWorked, pf = world.popField;
  let landN = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) landN++;
  const km2 = (510e6 * 0.29) / landN;
  // contact-connected belts (probe_beltshare's GAP-dilated components)
  const GAP = 6;
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (co[i] >= 0) mask[i] = 1;
  for (let g = 0; g < GAP; g++) {
    const nx = new Uint8Array(mask);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const i = y * tw + x;
      if (mask[i] || !(elev[i] > 0)) continue;
      const n = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), i - tw, i + tw];
      for (const j of n) if (j >= 0 && j < N && mask[j]) { nx[i] = 1; break; }
    }
    mask.set(nx);
  }
  const belt = new Int32Array(N).fill(-1);
  let nb = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!mask[s0] || belt[s0] >= 0) continue;
    const q = [s0]; belt[s0] = nb;
    while (q.length) {
      const i = q.pop(); const y = (i / tw) | 0, x = i - y * tw;
      for (const j of [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), i - tw, i + tw])
        if (j >= 0 && j < N && mask[j] && belt[j] < 0) { belt[j] = nb; q.push(j); }
    }
    nb++;
  }
  // per-belt tallies over CLAIMED tiles
  const B = new Map();   // belt → agg
  let globTot = 0;
  for (let i = 0; i < N; i++) {
    if (co[i] < 0) continue;
    globTot++;
    const b = belt[i];
    let e = B.get(b); if (!e) B.set(b, e = { n: 0, w: 0, pop: 0, popW: 0, sx: 0, sy: 0, realms: new Map() });
    e.n++;
    const isW = worked && worked[i] ? 1 : 0;
    e.w += isW;
    const p = pf ? pf[i] : 0;
    e.pop += p; if (isW) e.popW += p;
    const y = (i / tw) | 0; e.sy += y; e.sx += i - y * tw;
    e.realms.set(co[i], (e.realms.get(co[i]) || 0) + 1);
  }
  // per-belt realm capital knowledge profile
  const capKn = new Map();   // belt → {mob, nav, n}
  if (world.countries) for (const [cid, c] of world.countries) {
    if (!c.capital) continue;
    const ti = (c.capital.pos.y | 0) * tw + (c.capital.pos.x | 0);
    const b = belt[ti]; if (b < 0) continue;
    let e = capKn.get(b); if (!e) capKn.set(b, e = { mob: 0, nav: 0, n: 0 });
    e.mob += (c.capital.knowledge.mobility || 0); e.nav += (c.capital.knowledge.navigation || 0); e.n++;
  }
  const belts = [...B.entries()].sort((a, b2) => b2[1].n - a[1].n);
  // cradle core density reference: the densest belt's worked-land density
  let refDens = 0;
  for (const [, e] of belts) { const d = e.w ? e.popW / e.w : 0; if (d > refDens) refDens = d; }
  console.log(`[beltclaims] step ${step} belts=${belts.length} claimed=${(globTot * km2 / 1e6).toFixed(1)}M km2 (${(globTot * 100 / landN).toFixed(1)}% of land)`);
  for (const [b, e] of belts.slice(0, 6)) {
    const sizes = [...e.realms.values()].sort((x, y) => y - x);
    const top = sizes[0] || 0, med = sizes[(sizes.length / 2) | 0] || 0;
    const kn = capKn.get(b) || { mob: 0, nav: 0, n: 1 };
    const lat = 90 - (e.sy / e.n / th) * 180, lon = (e.sx / e.n / tw) * 360 - 180;
    const dClaim = e.n ? e.pop / e.n : 0, dWork = e.w ? e.popW / e.w : 0;
    console.log(`  belt#${b} @(${lat.toFixed(0)},${lon.toFixed(0)}): ${(e.n * km2 / 1e6).toFixed(1)}M km2, realms=${e.realms.size} top=${(top * km2 / 1e6).toFixed(1)}M med=${(med * km2 / 1e6).toFixed(2)}M | ` +
      `workedShare=${(100 * e.w / e.n).toFixed(0)}% densClaim=${(100 * dClaim / (refDens || 1)).toFixed(0)}%ofCradleCore densWorked=${(100 * dWork / (refDens || 1)).toFixed(0)}% | ` +
      `capMob=${(kn.mob / Math.max(1, kn.n)).toFixed(2)} capNav=${(kn.nav / Math.max(1, kn.n)).toFixed(2)}`);
  }
}
