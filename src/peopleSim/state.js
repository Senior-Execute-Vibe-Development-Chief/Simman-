// World state for the people sim. Single container passed to every
// entity update. Reads worldgen output (elevation, temperature, etc)
// and downsamples to tile resolution; no political state, no per-tile
// ownership — just terrain plus the entity arrays.

import { mkRng } from "./rng.js";
import { makeBand, resetBandIds } from "./band.js";
import { resetSettlementIds } from "./settlement.js";

const TILE_RES = 2;

// "Intimate (~50 entities)" — locked design choice. The cap below is
// enforced at split / settle / spawn time so the world never exceeds
// the user's target density.
//   bands       — wandering hunter-gatherers
//   settlements — permanent villages/towns/cities
//   total       — hard ceiling across both kinds
const CAP = {
  bands: 40,
  settlements: 30,
  total: 50,
  caravans: 40,
  armies: 20,
};

// True if the world has room for another entity overall.
export function hasEntityRoom(world) {
  const aliveBands = world.bands.reduce((n, b) => n + (b.mode === "dead" ? 0 : 1), 0);
  const aliveSetts = world.settlements.reduce((n, s) => n + (s.mode === "dead" ? 0 : 1), 0);
  return aliveBands + aliveSetts < world.cap.total;
}

// Robust "is this tile a continental land cell" check — used by both
// the cradle finder and wander target selection so the two stay in sync.
// Excludes 1-tile islets and pixels where the elevation downsample
// happens to land just above 0.
function isContinentalLand(world, ti) {
  const { tw, th, elev } = world;
  if (elev[ti] <= 0.005) return false;
  const ty = (ti / tw) | 0;
  if (ty <= 0 || ty >= th - 1) return false;
  const tx = ti - ty * tw;
  // Need at least 2 of 4 neighbours also above sea level.
  let n = 0;
  if (elev[ti - 1]  > 0) n++;
  if (elev[ti + 1]  > 0) n++;
  if (elev[ti - tw] > 0) n++;
  if (elev[ti + tw] > 0) n++;
  return n >= 2;
}
export { isContinentalLand };

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
  seedCradleBand(world);
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

// Cradle of humankind: scan the whole map, pick the single best site
// for the founding band. Mirrors the East African Rift conditions —
// warm but not roasting, modest moisture, low elevation, fertile soil,
// with bonus for nearby water (river or coast).
//
// One band, ~10 people. Everything else descends from this point.
function seedCradleBand(world) {
  resetBandIds();
  resetSettlementIds();
  const { tw, th, elev, temp, moist, fert, coast, riverMag, N } = world;
  let bestTi = -1, bestScore = -Infinity;
  for (let ti = 0; ti < N; ti++) {
    if (!isContinentalLand(world, ti)) continue;
    if (elev[ti] > 0.30) continue;          // no plateaus, no mountains
    const t = temp[ti], m = moist[ti], f = fert[ti];
    if (t < 0.55 || t > 0.85) continue;     // savannah / mild tropical
    if (m < 0.30 || m > 0.75) continue;     // not desert, not swamp
    if (f < 0.40) continue;                  // rich soil
    // Bonus: water access — rivers especially. Real cradle sites
    // (Rift Valley, Levant, Nile, Indus) all clustered near water.
    let waterBonus = 0;
    if (coast[ti])                            waterBonus += 0.5;
    if (riverMag && riverMag[ti] >= 3)        waterBonus += 1.5;
    else if (riverMag && riverMag[ti] >= 2)   waterBonus += 0.8;
    // Fit-to-ideal scores.
    const tempFit  = 1 - Math.abs(t - 0.70) * 2;
    const moistFit = 1 - Math.abs(m - 0.50) * 2;
    const elevFit  = 1 - elev[ti] * 2;        // prefer low ground
    const score = f * 2 + tempFit + moistFit + elevFit + waterBonus;
    if (score > bestScore) { bestScore = score; bestTi = ti; }
  }
  if (bestTi < 0) {
    // Fallback: any continental fertile tile.
    for (let ti = 0; ti < N; ti++) {
      if (!isContinentalLand(world, ti)) continue;
      if (fert[ti] < 0.25) continue;
      if (fert[ti] > bestScore) { bestScore = fert[ti]; bestTi = ti; }
    }
  }
  if (bestTi < 0) {
    console.warn("[peopleSim] no viable cradle site found — world all water?");
    return;
  }
  const ty = (bestTi / tw) | 0, tx = bestTi - ty * tw;
  const band = makeBand(world, tx + 0.5, ty + 0.5, 10);
  world.bands.push(band);
  // Log so the user knows where their species started.
  const e = elev[bestTi].toFixed(2), t = temp[bestTi].toFixed(2);
  const m = moist[bestTi].toFixed(2), f = fert[bestTi].toFixed(2);
  const rm = riverMag ? riverMag[bestTi] : 0;
  console.log(
    `[peopleSim] cradle at tile (${tx},${ty}) — elev:${e} temp:${t} moist:${m} fert:${f}` +
    `${coast[bestTi]?" coast":""}${rm>=2?` river(mag${rm})`:""} score:${bestScore.toFixed(2)}`
  );
}

// Prune dead entities (called periodically to keep arrays bounded).
export function pruneDead(world) {
  world.bands       = world.bands.filter(b => b.mode !== "dead");
  world.settlements = world.settlements.filter(s => s.mode !== "dead");
  world.caravans    = world.caravans.filter(c => c.mode !== "done");
  world.armies      = world.armies.filter(a => a.mode !== "dead");
}
