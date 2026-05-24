// World state for the people sim. Single container passed to every
// entity update. Reads worldgen output (elevation, temperature, etc)
// and downsamples to tile resolution; no political state, no per-tile
// ownership — just terrain plus the entity arrays.

import { mkRng } from "./rng.js";
import { makeBand, resetBandIds } from "./band.js";

const TILE_RES = 2;

// Target entity caps — keep the world feeling intimate. The user picked
// "Intimate (~50 entities)" as the scale ceiling. Bands cap higher than
// settlements because many bands consolidate into fewer settlements.
const CAP = {
  bands: 60,
  settlements: 50,
  caravans: 40,
  armies: 20,
};

export function createWorld(w, opts = {}) {
  const tw = Math.ceil(w.width / TILE_RES);
  const th = Math.ceil(w.height / TILE_RES);
  const N = tw * th;

  const world = {
    // Geometry / world reference
    worldRef: w,
    width: w.width, height: w.height,
    tw, th, N, tileRes: TILE_RES,

    // Downsampled terrain (read-only inputs)
    elev:  new Float32Array(N),
    temp:  new Float32Array(N),
    moist: new Float32Array(N),
    fert:  new Float32Array(N),
    coast: new Uint8Array(N),
    diff:  new Float32Array(N),
    riverMag: null,

    // Entities — plain arrays, ID-indexed. Dead entries kept in place
    // (mode==="dead") for stable rendering; pruned periodically.
    bands:       [],
    settlements: [],
    caravans:    [],
    armies:      [],

    // Caps (used by entity update logic to throttle splits / spawns)
    cap: CAP,

    // Tick state
    step: 0,
    seed: opts.seed || w.seed || 1,
    rng: mkRng(opts.seed || w.seed || 1),

    // Debug + history
    events: [],                    // ring buffer
    debug:  { tickMs: 0, lastUpdateCount: 0 },
  };

  initTerrain(world, w);
  initRiverMag(world, w);
  seedInitialBands(world, opts.initialBands || 12);
  return world;
}

function initTerrain(world, w) {
  const { tw, th, elev, temp, moist, fert, coast, diff } = world;
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const px = Math.min(w.width - 1, tx * TILE_RES);
      const py = Math.min(w.height - 1, ty * TILE_RES);
      const wi = py * w.width + px;
      const ti = ty * tw + tx;
      const e = w.elevation[wi], t = w.temperature[wi], m = w.moisture[wi];
      elev[ti] = e; temp[ti] = t; moist[ti] = m;
      coast[ti] = w.coastal ? w.coastal[ti] : 0;
      let d = 0;
      if (e > 0.35)              d = Math.max(d, Math.min(1, (e - 0.35) * 3));
      if (t > 0.5 && m < 0.2)    d = Math.max(d, Math.min(0.85, (0.2 - m) * 3 * (t - 0.3)));
      if (t < 0.2)               d = Math.max(d, Math.min(0.9, (0.2 - t) * 4));
      diff[ti] = d;
      fert[ti] = bellFert(t, m, e);
    }
  }
}

// Carrying-capacity base from terrain. Same bell-curve shape as the
// legacy tileFert; lifted here so peopleSim is independent.
function bellFert(t, m, e) {
  if (e > 0.45 || e <= 0) return 0;
  const tFit = Math.exp(-((t - 0.45) * (t - 0.45)) / (2 * 0.18 * 0.18));
  const mFit = Math.exp(-((m - 0.50) * (m - 0.50)) / (2 * 0.22 * 0.22));
  return Math.min(1, tFit * mFit * 1.1);
}

function initRiverMag(world, w) {
  if (!w.rivers || !w.rivers.riverMag) return;
  const { tw, th, tileRes, N } = world;
  const rm = new Uint8Array(N);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const px = Math.min(w.width - 1, tx * tileRes);
      const py = Math.min(w.height - 1, ty * tileRes);
      rm[ty * tw + tx] = w.rivers.riverMag[py * w.width + px] || 0;
    }
  }
  world.riverMag = rm;
}

// Place initial hunter-gatherer bands at decent-quality land tiles,
// spread across the map.
function seedInitialBands(world, count) {
  resetBandIds();
  const { tw, th, elev, fert, rng } = world;
  const minSpacing = Math.max(8, Math.floor(tw * 0.06));
  let attempts = 0;
  while (world.bands.length < count && attempts < count * 200) {
    attempts++;
    const ti = rng.int(world.N);
    if (elev[ti] <= 0) continue;
    if (fert[ti] < 0.15) continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    // Spacing.
    let tooClose = false;
    for (const b of world.bands) {
      let dx = Math.abs(b.pos.x - tx);
      if (dx > tw / 2) dx = tw - dx;
      const dy = b.pos.y - ty;
      if (dx * dx + dy * dy < minSpacing * minSpacing) { tooClose = true; break; }
    }
    if (tooClose) continue;
    world.bands.push(makeBand(world, tx + 0.5, ty + 0.5, 8 + rng.int(12)));
  }
}

// Prune dead entities (called periodically to keep arrays bounded).
export function pruneDead(world) {
  world.bands       = world.bands.filter(b => b.mode !== "dead");
  world.settlements = world.settlements.filter(s => s.mode !== "dead");
  world.caravans    = world.caravans.filter(c => c.mode !== "done");
  world.armies      = world.armies.filter(a => a.mode !== "dead");
}
