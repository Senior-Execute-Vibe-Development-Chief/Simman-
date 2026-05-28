// World state for the people sim. Single container passed to every
// entity update. Reads worldgen output (elevation, temperature, etc)
// and downsamples to tile resolution; no political state, no per-tile
// ownership — just terrain plus the entity arrays.

import { mkRng } from "./rng.js";
import { resetSettlementIds, makeSettlement } from "./settlement.js";

const TILE_RES = 2;

// No settlement cap — the world fills naturally. The crystallization
// sweep limits density via MIN_SETT_DIST spacing and the
// fertility / area-fertility filters; saturated regions reject all
// candidates, so spawn rate falls off automatically. Caravan/army caps
// remain for the scaffolded systems.
const CAP = {
  caravans: 40,
  armies: 20,
};

// Robust "is this tile a continental land cell" check. Excludes 1-tile
// islets and pixels where the elevation downsample lands just above 0.
function isContinentalLand(world, ti) {
  const { tw, th, elev } = world;
  if (elev[ti] <= 0.005) return false;
  const ty = (ti / tw) | 0;
  if (ty <= 0 || ty >= th - 1) return false;
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
    worldRef: w,
    width: w.width, height: w.height,
    tw, th, N, tileRes: TILE_RES,

    elev:  new Float32Array(N),
    temp:  new Float32Array(N),
    moist: new Float32Array(N),
    fert:  new Float32Array(N),
    coast: new Uint8Array(N),
    diff:  new Float32Array(N),
    riverMag: null,

    // Per-tile resource deposits, downsampled from worldgen at
    // peopleSim's TILE_RES. Each entry is a Float32Array(N), value
    // in [0,1] = deposit richness. Empty object when no deposits
    // were generated.
    deposits: {},

    // Entities. No bands — settlements-only model.
    settlements: [],
    caravans:    [],
    armies:      [],

    // Tile → settlement.id that farms it (or -1). Int32 so IDs can
    // grow without bound across long runs (each new settlement gets
    // _nextId++; we never recycle).
    _farmedBy: new Int32Array(N).fill(-1),

    cap: CAP,

    step: 0,
    seed: opts.seed || w.seed || 1,
    rng: mkRng(opts.seed || w.seed || 1),

    events: [],
    debug:  { tickMs: 0 },
  };

  initTerrain(world, w, opts.tCrop);
  initRiverMag(world, w);
  initDeposits(world, w, opts.deposits);
  seedCradleVillage(world);
  return world;
}

function initTerrain(world, w, tCrop) {
  const { tw, th, elev, temp, moist, fert, coast, diff } = world;
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const px = Math.min(w.width - 1, tx * TILE_RES);
      const py = Math.min(w.height - 1, ty * TILE_RES);
      const wi = py * w.width + px;
      const ti = ty * tw + tx;
      const e = w.elevation[wi], t = w.temperature[wi], m = w.moisture[wi];
      elev[ti] = e; temp[ti] = t; moist[ti] = m;
      coast[ti] = w.coastal ? (w.coastal[wi] ? 1 : 0) : 0;
      let d = 0;
      if (e > 0.35)              d = Math.max(d, Math.min(1, (e - 0.35) * 3));
      if (t > 0.5 && m < 0.2)    d = Math.max(d, Math.min(0.85, (0.2 - m) * 3 * (t - 0.3)));
      if (t < 0.2)               d = Math.max(d, Math.min(0.9, (0.2 - t) * 4));
      diff[ti] = d;
      // Use the same crop-suitability array the overlay renders, so
      // where you SEE green is where settlements actually thrive. Falls
      // back to the local bellFert formula if tCrop wasn't supplied.
      fert[ti] = tCrop ? tCrop[wi] : bellFert(t, m, e);
    }
  }
}

function bellFert(t, m, e) {
  if (e > 0.45 || e <= 0) return 0;
  const tFit = Math.exp(-((t - 0.45) * (t - 0.45)) / (2 * 0.18 * 0.18));
  const mFit = Math.exp(-((m - 0.50) * (m - 0.50)) / (2 * 0.22 * 0.22));
  return Math.min(1, tFit * mFit * 1.1);
}

// Downsample worldgen's per-pixel deposit arrays into peopleSim's
// tile space. Sample at the same offset used for elev/temp/moist so
// everything lines up. Only resources relevant to the knowledge
// system are downsampled (the worldgen also has precious / oil /
// gems / salt which feed wealth/trade systems, kept here for future
// use but not gated on currently).
const TRACKED_RES = ['timber','stone','copper','tin','iron','coal','horses','salt','precious','gems'];
function initDeposits(world, w, deposits) {
  if (!deposits) return;
  const { tw, th, N } = world;
  for (const id of TRACKED_RES) {
    const src = deposits[id];
    if (!src) continue;
    const dst = new Float32Array(N);
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const px = Math.min(w.width - 1, tx * TILE_RES);
        const py = Math.min(w.height - 1, ty * TILE_RES);
        dst[ty * tw + tx] = src[py * w.width + px] || 0;
      }
    }
    world.deposits[id] = dst;
  }
  // Money-creating mines get a per-tile RESERVE (finite stock). When a
  // settlement extracts wealth from a mine, it draws from this reserve;
  // when 0, the mine is dry and produces no more money. Historical
  // pattern: Laurion silver depleted in ~180 years, Spanish New World
  // silver in cycles. Reserves are richness × calibration, so a top-
  // tier deposit yields ~150k wealth over its lifetime, modest tiles
  // proportionally less.
  world.depositReserve = {};
  if (world.deposits.precious) {
    const arr = world.deposits.precious;
    const res = new Float32Array(N);
    for (let i = 0; i < N; i++) res[i] = arr[i] * 150000;
    world.depositReserve.precious = res;
  }
  if (world.deposits.gems) {
    const arr = world.deposits.gems;
    const res = new Float32Array(N);
    for (let i = 0; i < N; i++) res[i] = arr[i] * 100000;
    world.depositReserve.gems = res;
  }
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

// Cradle village: a SINGLE village at the East African Rift-like site.
// Already has basic agriculture (settlements-only model — we skip the
// hunter-gatherer phase). Everything else descends from here, founded
// by daughter colonies sent out as the cradle and its descendants
// reach carrying capacity.
function seedCradleVillage(world) {
  resetSettlementIds();
  const { tw, th, elev, temp, moist, fert, coast, riverMag, N } = world;
  let bestTi = -1, bestScore = -Infinity;
  for (let ti = 0; ti < N; ti++) {
    if (!isContinentalLand(world, ti)) continue;
    if (elev[ti] > 0.30) continue;
    const t = temp[ti], m = moist[ti], f = fert[ti];
    if (t < 0.55 || t > 0.85) continue;
    if (m < 0.30 || m > 0.75) continue;
    if (f < 0.40) continue;
    let waterBonus = 0;
    if (coast[ti])                            waterBonus += 0.5;
    if (riverMag && riverMag[ti] >= 3)        waterBonus += 1.5;
    else if (riverMag && riverMag[ti] >= 2)   waterBonus += 0.8;
    const tempFit  = 1 - Math.abs(t - 0.70) * 2;
    const moistFit = 1 - Math.abs(m - 0.50) * 2;
    const elevFit  = 1 - elev[ti] * 2;
    const score = f * 2 + tempFit + moistFit + elevFit + waterBonus;
    if (score > bestScore) { bestScore = score; bestTi = ti; }
  }
  if (bestTi < 0) {
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
  makeSettlement(world, tx + 0.5, ty + 0.5, { people: 25, name: "cradle" });
  const e = elev[bestTi].toFixed(2), t = temp[bestTi].toFixed(2);
  const m = moist[bestTi].toFixed(2), f = fert[bestTi].toFixed(2);
  const rm = riverMag ? riverMag[bestTi] : 0;
  console.log(
    `[peopleSim] cradle at tile (${tx},${ty}) — elev:${e} temp:${t} moist:${m} fert:${f}` +
    `${coast[bestTi]?" coast":""}${rm>=2?` river(mag${rm})`:""} score:${bestScore.toFixed(2)}`
  );
}

export function pruneDead(world) {
  world.settlements = world.settlements.filter(s => s.mode !== "dead");
  world.caravans    = world.caravans.filter(c => c.mode !== "done");
  world.armies      = world.armies.filter(a => a.mode !== "dead");
}
