// World state for the people sim. Single container passed to every
// entity update. Reads worldgen output (elevation, temperature, etc)
// and downsamples to tile resolution; no political state, no per-tile
// ownership — just terrain plus the entity arrays.

import { makeSettlement } from "./settlement.js";
import { resetInvariantState } from "./invariants.js";
import { T, rNormPop } from "./tuning.js";
import { devInitYears } from "./popField.js";
import { jumpToFirstInvent } from "./hearthInvent.js";
import { bestPackageAt } from "./agriculture.js";
import { CROP_BY_ID } from "../cropPackages.js";
import { computeRelief } from "../worldgenUtils.js";

const TILE_RES = 2;

// No settlement cap — the world fills naturally. The crystallization
// sweep limits density via MIN_SETT_DIST spacing and the
// fertility / area-fertility filters; saturated regions reject all
// candidates, so spawn rate falls off automatically.

// Robust "is this tile a continental land cell" check. Excludes 1-tile
// islets and pixels where the elevation downsample lands just above 0.
function isContinentalLand(world, ti) {
  const { tw, th, elev } = world;
  if (elev[ti] <= 0.005) return false;
  const ty = (ti / tw) | 0;
  if (ty <= 0 || ty >= th - 1) return false;
  // Left / right wrap in longitude (x is periodic); up / down don't.
  // Neighbours use the same 0.005 floor as the centre tile, so a ring of
  // downsample-noise specks can't certify each other as continental.
  const tx = ti - ty * tw;
  const left  = ty * tw + (tx === 0 ? tw - 1 : tx - 1);
  const right = ty * tw + (tx === tw - 1 ? 0 : tx + 1);
  let n = 0;
  if (elev[left]    > 0.005) n++;
  if (elev[right]   > 0.005) n++;
  if (elev[ti - tw] > 0.005) n++;
  if (elev[ti + tw] > 0.005) n++;
  return n >= 2;
}
export { isContinentalLand };

export function createWorld(w, opts = {}) {
  // Sim tile resolution — how many world PIXELS each sim tile spans. Configurable
  // (opts.tileRes) so MAP resolution (terrain/coast crispness = w.width) and SIM
  // resolution (tile granularity = speed + emergent detail) are chosen independently.
  // Defaults to TILE_RES (2 = half the map). 1 makes the sim match the land at 4× the
  // tiles; 4 runs coarser/faster. A positive integer; all downsampling below reads it.
  // Read a DISTINCT opt name (not opts.tileRes): the probe/render tools historically pass
  // tileRes:1 which the old code ignored (they actually ran at the module default), so honouring
  // opts.tileRes would silently shift every recorded baseline. simTileRes is app-only; absent ⇒ 2.
  const tileRes = Math.max(1, Math.round(opts.simTileRes || TILE_RES));
  const tw = Math.ceil(w.width / tileRes);
  const th = Math.ceil(w.height / tileRes);
  const N = tw * th;

  const world = {
    worldRef: w,
    preset: w.preset,
    width: w.width, height: w.height,
    tw, th, N, tileRes,

    elev:  new Float32Array(N),
    temp:  new Float32Array(N),
    moist: new Float32Array(N),
    fert:  new Float32Array(N),
    relief: new Float32Array(N), // local vertical range (worldgenUtils computeRelief) — the ridge term in the edge cost; a range walls what its mean altitude never would
    tFlood: new Uint8Array(N),   // arid-river floodplain mask (Nile/Indus valley) — drives dense valley settlement + the floodplain biome
    coast: new Uint8Array(N),
    riverMag: null,

    // Per-tile resource deposits, downsampled from worldgen at
    // peopleSim's TILE_RES. Each entry is a Float32Array(N), value
    // in [0,1] = deposit richness. Empty object when no deposits
    // were generated.
    deposits: {},

    // Entities. No bands — settlements-only model.
    settlements: [],
    ships: [],                   // colony ships in transit (sea.js)

    step: 0,
    seed: opts.seed || w.seed || 1,
    // NO shared world.rng stream: randomness is drawn per system via
    // passRng/entityRng (rng.js) so systems never perturb each other's dice.

    debug:  { tickMs: 0 },
  };

  initTerrain(world, w, opts.tCrop, opts.tFlood);
  // List of floodplain tiles so crystallisation can fill the river valley directly
  // (a thin ribbon is almost never hit by the random tile sweep — the Nile would
  // stay empty otherwise). Built once; the mask is static after worldgen.
  // FERTILE tiles only: the tFlood mask spans the wetted corridor including barren
  // hot-desert margins (near-zero fert) — almost half the mask — which the spawn
  // sweep would then reject for f<MIN_FERT, wasting the oversampling. Restrict it to
  // the actual green cropland ribbon so every oversampled draw lands on settleable land.
  world._floodTiles = [];
  for (let i = 0; i < N; i++) if (world.tFlood[i] && (world.fert[i] || 0) >= 0.25) world._floodTiles.push(i);
  initAncestry(world, w, opts);
  initRiverMag(world, w);
  initWind(world, w);
  initDeposits(world, w, opts.deposits);
  resetInvariantState(world);   // fresh run starts with no warning-throttle memory
  seedCradleVillage(world);
  // T.INVENT_JUMP × DAWN_LIVE: solve first domestication from the crop/hearth
  // law + forager logistic, stamp basin farming, open there (no empty wait).
  jumpToFirstInvent(world);
  return world;
}

function initTerrain(world, w, tCrop, tFloodSrc) {
  const { tw, th, tileRes, elev, temp, moist, fert, coast } = world;
  // Carry the seasonal-climate fields onto the sim world whenever worldgen
  // provides them: the crop bell reads them under T.GROW_SEASON, and the
  // yield-variance map (the harvest-years wave, 2026-08-25) reads tAmp as its
  // continental winter-risk axis in BOTH regimes. Carrying is behaviour-free —
  // every consumer keeps its own lever gate; underscore fields never persist.
  // (Was gated on T.GROW_SEASON; the gate moved to the consumer when the
  // variance map became a second reader.) Point-sampled like temp/moist above,
  // from the same worldgen pixel.
  const gsOn = w.tAmp && w.warmRainFrac;
  const tAmpF = gsOn ? (world._tAmp = new Float32Array(world.N)) : null;
  const wRainF = gsOn ? (world._warmRainFrac = new Float32Array(world.N)) : null;
  // T.CANOPY_CLASS: carry the dry-season fields onto the sim world so the shared
  // biome field (biomeClass.js ensureBiome) classifies with the SAME inputs the
  // atlas and resourceGen use, instead of the documented dry=0 "unknown"
  // fallback. Same pattern and note as GROW_SEASON above: gated, so off-lever
  // the world has no new state; point-sampled from the same worldgen pixel.
  // On LOAD these are absent (underscore fields do not persist) and ensureBiome
  // falls back to 0 — the canopy classes are warmth-gated away from where dry
  // matters, so the mask is unaffected; only warm-band biome ids could differ.
  const ccOn = T.CANOPY_CLASS > 0 && w.dryFrac && w.summerDry;
  const dryF = ccOn ? (world._dryFrac = new Float32Array(world.N)) : null;
  const sumDryF = ccOn ? (world._summerDry = new Float32Array(world.N)) : null;
  // Pixel-grid relief, max-pooled to sim tiles below (like fert): a one-pixel
  // ridge LINE is exactly the feature mean-sampling erases — the reason the Alps
  // never walled anything (see transport.js ridge term). Recomputed here, never
  // persisted — a pure function of the elevation field.
  const pixRelief = computeRelief(w.elevation, w.width, w.height);
  // The fert max-pool and the floodplain block-OR index the source arrays at full
  // pixel resolution (stride w.width). They are only correct when territory was
  // built at RES=1 (tCrop/tFlood are pixel-res). Assert it rather than silently
  // mis-sample if a caller ever passes a coarser-res array.
  const NPIX = w.width * w.height;
  if (tCrop && tCrop.length !== NPIX) throw new Error(`initTerrain: tCrop must be pixel-res (${NPIX}), got ${tCrop.length} — build territory at RES=1`);
  if (tFloodSrc && tFloodSrc.length !== NPIX) throw new Error(`initTerrain: tFlood must be pixel-res (${NPIX}), got ${tFloodSrc.length}`);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const px = Math.min(w.width - 1, tx * tileRes);
      const py = Math.min(w.height - 1, ty * tileRes);
      const wi = py * w.width + px;
      const ti = ty * tw + tx;
      const e = w.elevation[wi], t = w.temperature[wi], m = w.moisture[wi];
      elev[ti] = e; temp[ti] = t; moist[ti] = m;
      coast[ti] = w.coastal ? (w.coastal[wi] ? 1 : 0) : 0;
      if (tAmpF) { tAmpF[ti] = w.tAmp[wi]; wRainF[ti] = w.warmRainFrac[wi]; }
      if (dryF) { dryF[ti] = w.dryFrac[wi]; sumDryF[ti] = w.summerDry[wi]; }
      // FERTILITY: max-pool over the TILE_RES×TILE_RES worldgen block, not a point
      // sample. Point-sampling every TILE_RES-th pixel DROPS thin fertile features —
      // a one-to-few-tile river floodplain (the Nile / Indus valley) falls between
      // samples and vanishes, leaving the cradle farming a single pixel. The block
      // MAX preserves the valley (any farmable sub-tile carries the cell) while barely
      // changing uniform land (where max ≈ the sample). Same crop-suitability array
      // the overlay renders, so where you SEE green is where settlements thrive.
      if (tCrop) {
        let f = 0;
        for (let oy = 0; oy < tileRes; oy++) {
          const sy = Math.min(w.height - 1, ty * tileRes + oy);
          for (let ox = 0; ox < tileRes; ox++) {
            const sx = Math.min(w.width - 1, tx * tileRes + ox);
            const v = tCrop[sy * w.width + sx];
            if (v > f) f = v;
          }
        }
        fert[ti] = f;
      } else fert[ti] = bellFert(t, m, e);
      // RELIEF: max-pool like fert — the ridge line must survive downsampling.
      {
        let r = 0;
        for (let oy = 0; oy < tileRes; oy++) {
          const sy = Math.min(w.height - 1, ty * tileRes + oy);
          for (let ox = 0; ox < tileRes; ox++) {
            const sx = Math.min(w.width - 1, tx * tileRes + ox);
            const v = pixRelief[sy * w.width + sx];
            if (v > r) r = v;
          }
        }
        world.relief[ti] = r;
      }
      // FLOODPLAIN: the arid-river alluvial valley (Nile / Indus / Euphrates) — its own
      // biome and prime cropland, watered by the river, not the rain. Use the mask the
      // PIPELINE already computed (block-OR over the worldgen cell, exactly like fert's
      // max-pool above), so the map the sim SETTLES is the map the renderer DRAWS — one
      // source of truth instead of a heuristic reconstruction. A floodplain tile must
      // read as WET: the transport-cost core charges a hot-dry penalty (transport.js) on
      // low-moisture land and the food model discounts a tile by transport cost, so
      // without this the cradle OWNS its fertile valley but every tile reads as costly
      // desert and the worked catchment collapses to ~1 tile however fertile the land.
      // (Legacy fallback when no mask is supplied: reconstruct from high-crop + dry land.)
      let isFlood;
      if (tFloodSrc) {
        isFlood = false;
        for (let oy = 0; oy < tileRes && !isFlood; oy++) {
          const sy = Math.min(w.height - 1, ty * tileRes + oy);
          for (let ox = 0; ox < tileRes; ox++) {
            const sx = Math.min(w.width - 1, tx * tileRes + ox);
            if (tFloodSrc[sy * w.width + sx]) { isFlood = true; break; }
          }
        }
      } else {
        isFlood = fert[ti] > 0.85 && moist[ti] < 0.30;
      }
      if (isFlood) { world.tFlood[ti] = 1; moist[ti] = Math.max(moist[ti], 0.45); }
    }
  }
}

// Deep genetic substrate (worldgen ancestry) downsampled to sim tiles. Each
// settlement seeds its ancestry from here; migration then admixes it. The sim
// never mutates this field — it's the bedrock the faster layers drift away from.
// −1 = no ancestry (sea / ice / polar). Robust to ter being a different grid.
function initAncestry(world, w, opts) {
  const { tw, th, N, tileRes } = world;
  const anc = world.ancestry = new Int16Array(N); anc.fill(-1);
  world.ancestryCount = opts.ancestryCount || 0;
  // Per-lineage HUE (peoples take their deep-ancestry colour so the Peoples map relates to the
  // Ancestry map) and per-tile RESIDENCE time (0 = long-settled cradle of humanity → 1 = freshly
  // reached frontier). The resident population a colony admixes with is dense where residence is
  // long, sparse on a just-peopled frontier — the demographic lever behind blend/replace/bootload.
  world.ancHue = opts.ancHue || null;
  const src = opts.tAncestry; if (!src) return;
  const stw = opts.terTw || w.width, sth = opts.terTh || w.height;
  const arr = opts.tArrival || null;
  const tArr = arr ? (world.tArrival = new Float32Array(N)) : null;
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const ax = Math.min(stw - 1, ((tx * tileRes / w.width) * stw) | 0);
      const ay = Math.min(sth - 1, ((ty * tileRes / w.height) * sth) | 0);
      const si = ay * stw + ax, di = ty * tw + tx;
      anc[di] = src[si];
      if (tArr) tArr[di] = arr[si];
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
// everything lines up. Tracks every resource the sim consumes — the
// knowledge gates (ores/horses), the wealth faucet (precious/gems)
// and the luxury trade goods (spices/furs/incense/dyes). Worldgen's
// 'oil' deposit is the one layer with no sim consumer yet.
const TRACKED_RES = ['timber','stone','copper','tin','iron','coal','horses','salt','precious','gems','spices','furs','incense','dyes'];
function initDeposits(world, w, deposits) {
  if (!deposits) return;
  const { tw, th, N, tileRes } = world;
  for (const id of TRACKED_RES) {
    const src = deposits[id];
    if (!src) continue;
    const dst = new Float32Array(N);
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const px = Math.min(w.width - 1, tx * tileRes);
        const py = Math.min(w.height - 1, ty * tileRes);
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

// Downsample the worldgen wind field into tile space, for wind-aware sea
// routing (sea.js). Vectors point in the direction the wind blows TOWARD,
// so a ship travelling with the wind (positive alignment) goes faster.
function initWind(world, w) {
  if (!w.windX || !w.windY) return;
  const { tw, th, tileRes, N } = world;
  const wx = new Float32Array(N), wy = new Float32Array(N);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const px = Math.min(w.width - 1, tx * tileRes);
      const py = Math.min(w.height - 1, ty * tileRes);
      const wi = py * w.width + px;
      wx[ty * tw + tx] = w.windX[wi] || 0;
      wy[ty * tw + tx] = w.windY[wi] || 0;
    }
  }
  world._windX = wx;
  world._windY = wy;
}

function initRiverMag(world, w) {
  if (!w.rivers || !w.rivers.riverMag) return;
  const { tw, th, tileRes, N } = world;
  const rm = new Uint8Array(N);
  const srcRm = w.rivers.riverMag;
  // MAX-POOL over the worldgen block, exactly like fert and the tFlood OR:
  // rivers are 1-pixel-wide D8 flow chains — the thinnest feature in the whole
  // pipeline — so the old top-left POINT sample dropped ~64% of major/great
  // river tiles at the app's TILE_RES 2, fragmenting the navigable spine that
  // territory reach, roads, confluence bonuses and transport all read. A river
  // crossing ANY sub-pixel of the block marks the tile. (At tileRes 1 — the
  // tools/harness path — this is byte-identical to the old sampling.)
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      let best = 0;
      const py0 = ty * tileRes, px0 = tx * tileRes;
      for (let dy = 0; dy < tileRes; dy++) {
        const py = py0 + dy; if (py >= w.height) break;
        for (let dx = 0; dx < tileRes; dx++) {
          const px = px0 + dx; if (px >= w.width) break;
          const v = srcRm[py * w.width + px] || 0;
          if (v > best) best = v;
        }
      }
      rm[ty * tw + tx] = best;
    }
  }
  world.riverMag = rm;
}

// Cradle village: a SINGLE village at the East African Rift-like site.
// Already has basic agriculture (settlements-only model — we skip the
// hunter-gatherer phase). Everything else descends from these cradles,
// founded by daughter colonies sent out as each cradle and its descendants
// reach carrying capacity.
//
// MULTIPLE CRADLES: historically agriculture arose independently in
// several places — Mesopotamia, Egypt, Indus, Yellow River, Mesoamerica.
// Seeding just one cradle gave the first civilisation a permanent compounding
// lead and led to a single dominant power swallowing the world. So we seed
// up to MAX_CRADLES top scoring sites separated by a minimum distance — each
// becomes the seed of an independent civilization, producing a multipolar
// world even at high resolution.
//
// ONE CONSTANT, TWO CONSEQUENCES (flagged per docs/design-c-hearth-field.md risk 1):
// MAX_CRADLES is how many times agriculture was independently invented on a
// planet. Real Earth: ~7-11 (Fertile Crescent, China x2, New Guinea, Mesoamerica,
// the Andes, Amazonia, eastern N. America, the Sahel, Ethiopia). Under
// T.MULTI_HEARTH it is ALSO load-bearing for planetary LABEL SUPPLY, because a
// hearth is the only thing that starts a devField wave and only farmed land
// carries town-scale density. It was never chosen against a settlement count and
// MUST NEVER BE MOVED TOWARD ONE: the only admissible argument for changing it is
// an argument about how many times humans invented farming.
const MAX_CRADLES = 10;
const CRADLE_MIN_SEP = 24;   // minimum separation between cradles, in REFERENCE tiles.
                              // EVIDENCE CORRECTION (2026-08-03, the only admissible kind for
                              // this constant): 24 ref tiles ≈ 4 000 km, the real minimum
                              // distance between INDEPENDENT agricultural origins — Fertile
                              // Crescent↔Sahel ~4 000 km, Crescent↔China ~6 500, Mesoamerica↔
                              // eastern N America ~2 500 (the closest defensible pair). The old
                              // value 60 (~10 000 km) enforced "a single continent gets at most
                              // 1-2 cradles" — but real Afro-Eurasia had four or five, and the
                              // measured failure mode was one high-circumscription winner (the
                              // Tarim) excluding Mesopotamia, the Indus AND the Nile in a single
                              // disc (docs/design-idea-field.md). MAX_CRADLES, not this radius,
                              // is the statement about how many origins a planet gets.
                              // UNIT: read x rNormPop (a REAL distance) under T.MULTI_HEARTH,
                              // raw tiles otherwise. Measured defect that correction repairs:
                              // with the scorer running, raw tiles give 2 hearths at 240 and 6
                              // at 480 — the number of agricultural origins on a planet would
                              // ride on the render grid.
// Circumscription (Carneiro): the first states arose in fertile pockets hemmed in
// by INHOSPITABLE LAND — the Nile walled by the Sahara, the Indus by the Thar,
// Mesopotamia by desert and mountains. The barrier that matters is dry/mountain
// LAND, not ocean: an island or coastal outcropping is hemmed by SEA, which is the
// opposite of a river-valley cradle, so we measure the two separately — reward
// land-circumscription, penalise being mostly surrounded by sea.

// Console-diagnostic geo tag (owner channel 2026-08-19): every genesis line
// carries lon/lat so a pasted browser-console log is self-locating on the
// Earth preset (equirectangular; notional on procedural maps — harmless).
const _geoStr = (world, x, y) => `(${(x / world.tw * 360 - 180).toFixed(1)}E ${(90 - y / world.th * 180).toFixed(1)}N)`;
function cradleSurround(world, ti) {
  const { tw, th, elev, fert } = world;
  const ty = (ti / tw) | 0, tx = ti - ty * tw;
  // UNIT (2026-08-19, the Po-valley finding): the circumscription window is a
  // REAL distance — a raw 7 tiles was ~1,170 km at the tw=240 reference but
  // ~290 km at the shipped tw=960, so a tight alpine pocket (the Po: Alps +
  // major river + rich silt) read as a perfectly hemmed cradle ONLY at fine
  // grids, while at the reference the same window reached France and the
  // Adriatic and diluted it away. ×rNormPop keeps the same real window at
  // every grid; rn=1 → 7 exactly, byte-identical at the reference.
  const R = Math.max(3, Math.round(7 * rNormPop(world))), r2 = R * R;
  let landBarrier = 0, sea = 0, total = 0;
  for (let dy = -R; dy <= R; dy++) {
    const ny = ty + dy; if (ny < 0 || ny >= th) continue;
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const t2 = ny * tw + (((tx + dx) % tw + tw) % tw);
      total++;
      const e = elev[t2];
      if (e <= 0) sea++;
      else if (e > 0.42 || (fert[t2] || 0) < 0.12) landBarrier++;   // arid desert or high mountain
    }
  }
  return total > 0 ? { landBarrier: landBarrier / total, seaFrac: sea / total }
                   : { landBarrier: 0, seaFrac: 0 };
}
// EARTH MAP: the historical Old-World hearths (Nile, Mesopotamia, Indus, Yellow River).
// On the real-Earth heightmap these fractional map positions are fixed (equirectangular:
// x = (lon+180)/360, y = (90−lat)/180), so we snap each to the best fertile river tile
// nearby. This is a deliberate, preset-gated diorama INPUT (T.EARTH_HEARTHS, earth presets
// only): the emergent cradle scorer below (seedCradleVillage — temp×moist×fert×river×
// circumscription) is the real mechanism and runs for every procedural map.
//
// WHAT THIS LIST IS AND IS NOT (docs/design-c-hearth-field.md). It is a scenario input
// saying where Earth's KNOWN hearths were. It is NOT a statement about where hearths
// CANNOT be — and until T.MULTI_HEARTH it was read as exactly that, because seeding
// short-circuited into this list and RETURNED, so the scorer never ran on an Earth
// preset. The consequence was structural: devField (agricultural technique) is stamped
// from settlements only and its wave is land-only, so with four pins ~60% of the
// planet's land stayed at devField ≡ 0 forever — the New World and Australia "stayed
// wild until colonisation" because no farming could reach them, which is an outcome
// this list was chosen to produce. Under T.MULTI_HEARTH these sites are a PRE-LOAD of
// the scorer's greedy instead of a cap: they hold their own separation discs and the
// unchanged scorer fills the rest of the planet.
//
// DO NOT ADD SITES HERE TO MOVE A LABEL COUNT, A REALM COUNT OR ANY OTHER MEASURED
// OUTCOME. A site may only be added on evidence about a REAL historical hearth. The
// mechanism that puts hearths on unpinned continents is the scorer; if it puts too few
// somewhere, that is a finding about the scorer, not a gap in this list.
const EARTH_HEARTH_SITES = [
  { name: "Nile",        fx: 0.580, fy: 0.329 },   // fertile ribbon through the Sahara to the Mediterranean delta
  { name: "Mesopotamia", fx: 0.622, fy: 0.330, r: 0.02 },   // Tigris-Euphrates / the Fertile Crescent. TIGHT search radius: the wide
                                                            // default let it drift ~14° NE to the nearest big river — which on the
                                                            // generated earth sits up by the CASPIAN — seeding "Mesopotamia" on an
                                                            // inland sea. The tight radius keeps it in the Crescent (a dry-fertile
                                                            // irrigation cradle, like the real one) instead of chasing the Caspian river.
  { name: "Indus",       fx: 0.694, fy: 0.344, r: 0.02 },  // Indus valley (~28°N, ~70°E — Mohenjo-daro/Harappa). The
                                                            // historical FOURTH river cradle, absent from this list until the
                                                            // 2026-07 history-shape audit measured the consequence: the
                                                            // subcontinent spends whole runs near-empty (4-5 settlements,
                                                            // 1-3 capitals, ~1/8 of Europe's population), and with it the
                                                            // Eurasian east-west corridor stays severed. TIGHT radius, same
                                                            // rationale as Mesopotamia: keep it on the Indus, not the nearest
                                                            // big river elsewhere. (If the generated map fails the site checks
                                                            // here — warmth/fertility/lowland — the seat silently doesn't
                                                            // seed, like every other pinned site.)
  { name: "Yellow River", fx: 0.811, fy: 0.305, r: 0.016 },   // the Huang He / Central Plain (~35°N, ~112°E) — the
                                                            // conventional cradle of Chinese civilisation (Erlitou/Shang
                                                            // Zhongyuan heartland), NOT the Yangtze. TIGHT search radius: the
                                                            // wide default drifted it ~7° NORTH onto the bigger (mag-4) rivers
                                                            // at ~42–43°N (the Ordos loop / Inner Mongolia), seeding "China" in
                                                            // the steppe; this radius keeps it on the Central-Plain river.
];
// Minimum separation between seeded hearths, as a fraction of map width —
// resolution-scaled so nearby historical sites (Nile / Mesopotamia) stay
// DISTINCT civilizations at any grid size. At coarse test resolutions their
// search windows overlap and, without this, both snapped to the SAME best
// river tile — two cradles superposed on one settlement site, no Fertile
// Crescent civilization at all. ~0.02 of Earth's width ≈ 800 km, well under
// the real Nile→Euphrates distance, so it never blocks legitimate seats.
const HEARTH_MIN_SEP_FRAC = 0.02;
// Returns the list of tiles actually seated, {tx,ty,ti} — empty if none took.
// (It used to return a boolean, because its only caller returned on truthy. The
// list is what T.MULTI_HEARTH pre-loads into the algorithmic greedy.)
function seedEarthHearths(world, seatNow = true) {
  const { tw, th, elev, temp, moist, fert, riverMag } = world;
  const picked = [];   // hearth tiles already seated this pass
  const minSep = Math.max(3, Math.round(tw * HEARTH_MIN_SEP_FRAC));
  const minSep2 = minSep * minSep;
  for (const site of EARTH_HEARTH_SITES) {
    const cx = Math.round(site.fx * tw), cy = Math.round(site.fy * th);
    const R = Math.max(6, Math.round(tw * (site.r ?? 0.04)));   // search radius (per-site override; default ~4% of map width)
    let bestTi = -1, bestScore = -1;
    for (let dy = -R; dy <= R; dy++) {
      const ny = cy + dy; if (ny < 0 || ny >= th) continue;
      for (let dx = -R; dx <= R; dx++) {
        const nx = ((cx + dx) % tw + tw) % tw;
        const ti = ny * tw + nx;
        if (!isContinentalLand(world, ti) || elev[ti] > 0.30) continue;
        const t = temp[ti]; if (t < 0.62 || t > 0.92) continue;     // warm (a frozen river is no cradle)
        const f = fert[ti] || 0; if (f < 0.25) continue;            // fertile (river alluvium counts via tCrop)
        let tooClose = false;
        for (const pk of picked) {
          const ddx = Math.min(Math.abs(nx - pk.tx), tw - Math.abs(nx - pk.tx));
          const ddy = ny - pk.ty;
          if (ddx * ddx + ddy * ddy < minSep2) { tooClose = true; break; }
        }
        if (tooClose) continue;
        const rm = riverMag ? riverMag[ti] : 0;
        const distPen = Math.sqrt(dx * dx + dy * dy) / R;
        // Prefer the major river, fertile, near the target site.
        let score = rm * 2 + f * 1.5 + (1 - distPen) * 2 + (1 - Math.abs(t - 0.76));
        // Package-aware (2026-08-19): the snap was package-BLIND — it took the
        // biggest-river tile in the window, and at tw=960 that tile carries
        // wheat suit 0.25, so "Mesopotamia" matured three millennia late (real
        // Sumer was FIRST). Scale by the same storable-staple quality the
        // cradle scorer already uses (CRADLE_PACKAGE: suit × storability) —
        // one definition, two uses: the pin seats where the Crescent could
        // actually farm, not merely where the biggest pixel of river is.
        if (T.CRADLE_PACKAGE) {
          const best = bestPackageAt(world, ti);
          const pkg = best && CROP_BY_ID[best.id];
          score *= best ? Math.max(0, Math.min(1, best.suit * (pkg ? pkg.storability : 1))) : 0;
        }
        if (score > bestScore) { bestScore = score; bestTi = ti; }
      }
    }
    if (bestTi < 0) {
      console.warn(`[peopleSim] hearth ${site.name}: no viable seat (window blocked or too near another hearth) — skipped`);
      continue;
    }
    const bx = bestTi % tw, by = (bestTi / tw) | 0;
    picked.push({ tx: bx, ty: by, ti: bestTi });
    // T.INVENT_STAGGER (seatNow=false): the pin is PICKED (it holds its
    // separation disc) but not yet seated — seatOrArmHearths decides WHEN it
    // matures on the same ruler as every scorer pick.
    if (!seatNow) {
      console.log(`[peopleSim] hearth pin ${site.name} picked at tile (${bx},${by}) ${_geoStr(world, bx, by)} — maturity deferred to the stagger law`);
      continue;
    }
    const born = makeSettlement(world, bx + 0.5, by + 0.5, { people: 110, cradle: true });   // natural proto-town (110 — the urban floor: an entity is a town, its valley countryside is the popField)
    const name = born.name;
    const rm = riverMag ? riverMag[bestTi] : 0;
    console.log(`[peopleSim] ${name} (${site.name}) at tile (${bx},${by}) frac(${(bx / tw).toFixed(2)},${(by / th).toFixed(2)}) ` +
      `temp:${temp[bestTi].toFixed(2)} moist:${moist[bestTi].toFixed(2)} fert:${fert[bestTi].toFixed(2)}${rm >= 2 ? ` river(mag${rm})` : ""}`);
  }
  return picked;
}

/** The cradle score at one tile — the wild-package richness the greedy ranks
 *  by (fertility × river × circumscription × climate). Extracted so scenario
 *  PINS can be scored on the same ruler as scorer picks (T.INVENT_STAGGER
 *  needs every hearth's score for its maturity time) and so probes can read
 *  the ranking the seeding actually used. Pure worldgen read; no filters —
 *  callers that need the viability windows apply them separately. */
export function cradleScoreAt(world, ti) {
  const { elev, temp, fert, riverMag } = world;
  const t = temp[ti], f = fert[ti] || 0;
  const rm = riverMag ? riverMag[ti] : 0;
  const riverBonus = rm >= 3 ? 2.6 : rm >= 2 ? 1.6 : rm >= 1 ? 0.6 : 0;
  const tempFit = 1 - Math.abs(t - 0.76) * 1.3;
  const elevFit = 1 - elev[ti] * 2;
  const { landBarrier, seaFrac } = cradleSurround(world, ti);
  const base = f * 2 + riverBonus + landBarrier * 2.5 + tempFit + elevFit
             - Math.max(0, seaFrac - 0.30) * 5;
  // ── T.CRADLE_PACKAGE: THE WILD PACKAGE — was there anything worth domesticating? ──
  // The score above ranks LAND (fertile, watered, warm, hemmed in) and is blind to
  // the variable that actually decided which hearths ladders: what grew there wild.
  // The Fertile Crescent won because it held wheat, barley, goats and sheep; the
  // Tarim basin is the *ultimate* circumscribed fertile pocket and held none of it —
  // which is precisely the site this scorer crowned above the Nile (the measured
  // failure, docs/design-idea-field.md). New Guinea farmed intensively for nine
  // thousand years and never built a city, because taro does not store.
  // The sim ALREADY MODELS THIS, shipped and on by default (T.CRADLE_PACKAGE's
  // sibling T.CROP_AXIS): five packages with climate envelopes and a STORABILITY
  // trait — wheat/rice 1.00, maize 0.95, sorghum 0.90, tubers 0.35. What was
  // missing is only that CRADLE PLACEMENT never read it. So the score is scaled by
  // the best STORABLE staple available at the tile:
  //
  //     pkgQ = suit(best package here) × its storability        ∈ 0..1
  //
  // A great wheat valley keeps ~its full score; a lush tuber jungle is cut to a
  // third and stops out-ranking cereal land; ground where nothing grows scores
  // zero and cannot be a hearth at all. This is the same quantity the farming
  // CEILING already uses (agriculture.js cropCeil = suit × storability), so
  // placement and ceiling finally agree about what makes land a cradle — one
  // definition, two uses, no new constant. The downstream effects (the package
  // then diffuses only where climate suits it, caps the wet tropics, and gates
  // each hearth's ladder) are all shipped machinery this simply feeds correctly.
  if (T.CRADLE_PACKAGE) {
    const best = bestPackageAt(world, ti);
    if (!best) return 0;
    const pkg = CROP_BY_ID[best.id];
    return base * Math.max(0, Math.min(1, best.suit * (pkg ? pkg.storability : 1)));
  }
  return base;
}

// ── T.INVENT_STAGGER: agriculture is invented WHEN a hearth matures, not at t=0 ──
// The owner's observation (2026-08-03): "it seems unlikely that 6 places
// independently invent farming at the same time." Correct — real origins span
// ~6 500 years (Fertile Crescent ~9500 BC … Sahel ~3000 BC), and seeding every
// hearth at step 0 makes them all equally old. Under the lever each picked
// hearth gets a MATURITY TIME from its own conditions:
//
//     T_i = INVENT_EPOCH_Y / score_i
//
// — the richer the wild package (the same fertility × river × circumscription
// score the greedy already ranks by), the sooner domestication completes. A
// hearth maturing INSIDE prehistory (T_i ≤ DEV_INIT_YEARS) opens the map as a
// farming core whose technique wave has spread for its own (DEV_INIT_YEARS −
// T_i) years — the Nile-class sites open ancient, marginal ones open young.
// A hearth maturing BEYOND prehistory opens ARMED: it accrues maturity only
// while its basin actually carries people (maybeCrystallize's arming pass —
// effYears += dt × basinMass/basinCapacity), and IGNITES mid-game when its
// remaining years are served. Emergent, not scheduled: an empty basin never
// matures, a colonised basin stands down (the package arrived by sea first),
// and the ORDER of invention is set by the land, not the calendar. The
// pre-run staggering is an INITIAL CONDITION (the same epistemic status as
// DEV_INIT_YEARS and CRADLE_EVE themselves — how old the world is when the
// map opens), never a live gate.
//
// INVENT_EPOCH_Y: the one constant, with an archaeological anchor — first
// domestication ran ~6 500 years ahead of the eve of states (9500 BC vs
// ~3000 BC). Divided by a score of ~7 (a great river cradle) it matures in
// under a millennium of prehistory; a score-2 site takes ~3 300 years; below
// ~1.1 it does not finish in prehistory at all and opens armed. The ORDER and
// the relative stagger are invariant to the value; only the absolute epoch
// scales. Rule-2 audit: the anchor is a real-history duration, not a count of
// hearths to hit — MAX_CRADLES stays the only supply constant, untouched.
const INVENT_EPOCH_Y = 6500;
// ── The lag is the PACKAGE's (2026-08 correction, measured) ────────────────
// T = EPOCH/score compressed the 6,500-year archaeological span to a measured
// 432-year spread: the picker takes the TOP of the score distribution, so
// picked scores cluster (4.6–6.6) and the quotient cannot spread — every
// hearth on every continent opened ancient (986–1,418y into a 6,000-year
// prehistory) and the dawn was synchronous, the exact continental lockstep
// the owner reported. The variable that actually carried history's stagger is
// the DOMESTICATION LAG of the local wild package (cropPackages.js domLagY —
// wheat ~900y, maize ~4,500y: archaeobotany, the same admissibility class as
// the photoperiod correction), stretched by how marginal the site is for it:
//
//     T_i = domLagY(best package here) / suit_i
//
// A perfect wheat valley realizes wheat's own lag; a marginal one takes
// proportionally longer; a maize land waits millennia BECAUSE MAIZE IS MAIZE
// (the offset emerges from botany, no continent named anywhere); ground with
// NO viable package (suit < the scorer's own floor) never matures a hearth at
// all — the Australia case, which previously farmed at t=0. The old score
// quotient stays ONLY as the fallback where no package can be read (a pin on
// packageless ground matures slowly rather than dividing by zero).
const HEARTH_SUIT_MIN = 0.15;   // below this the best "package" is noise — the scorer would never crown it
function seatOrArmHearths(world, picked) {
  const armed = [];
  for (const p of picked) {
    const sc = Math.max(0.5, p.score !== undefined ? p.score : cradleScoreAt(world, p.ti));
    // (floor 0.5: a scenario PIN on a tile failing the scorer's viability
    // windows can score ≤ 0; it matures very slowly rather than dividing by
    // zero — and being a pin, it stays a candidate instead of being dropped.)
    const pkg = bestPackageAt(world, p.ti);
    // suit UNCLAMPED: >1 (the package's yield headroom on extraordinary land)
    // legitimately accelerates domestication below the nominal lag — the lag is
    // defined at a reference site. (A min(1,·) clamp here made every rich rice
    // hearth mature at exactly domLagY — a new synchrony artifact, measured.)
    const Ty = pkg && pkg.suit >= HEARTH_SUIT_MIN
      ? (CROP_BY_ID[pkg.id].domLagY || INVENT_EPOCH_Y) / pkg.suit
      : INVENT_EPOCH_Y / sc;
    if (Ty <= devInitYears()) {
      const born = makeSettlement(world, p.tx + 0.5, p.ty + 0.5, { people: 110, cradle: true });
      born._hearthAgeY = devInitYears() - Ty;   // years the technique wave has spread by map open (read by ensureDevField); this branch is unreachable under DAWN_LIVE (no hearth matures inside a zero-length prehistory)
      console.log(`[peopleSim] hearth ${born.name} at (${p.tx},${p.ty}) ${_geoStr(world, p.tx, p.ty)} score ${sc.toFixed(2)}${pkg ? ` pkg=${pkg.id}(suit ${pkg.suit.toFixed(2)})` : ""} — matured ${Math.round(Ty)}y into prehistory (wave age ${Math.round(born._hearthAgeY)}y)`);
    } else {
      armed.push({ ti: p.ti, tx: p.tx, ty: p.ty, score: sc, needY: Ty - devInitYears(), effY: 0 });
      console.log(`[peopleSim] hearth candidate at (${p.tx},${p.ty}) ${_geoStr(world, p.tx, p.ty)} score ${sc.toFixed(2)}${pkg ? ` pkg=${pkg.id}(suit ${pkg.suit.toFixed(2)})` : ""} — ARMED: ~${Math.round(Ty - devInitYears())}y of peopled-basin time from maturity`);
    }
  }
  if (armed.length) world._armedHearths = armed;
}

function seedCradleVillage(world) {
  const { tw, elev, temp, moist, fert, coast, riverMag, N } = world;
  // The cradles seated before the scorer runs. Empty on a procedural map; on an
  // Earth preset under T.EARTH_HEARTHS it holds the pinned Old-World hearths.
  const picked = [];
  // EARTH MAP: seat the historical Old-World hearths (Nile, Mesopotamia, Indus,
  // Yellow River) from the scenario list.
  //   T.MULTI_HEARTH = 0 — the pins REPLACE the algorithmic top-N (early return),
  //     so the New World stays wild until colonisation. The shipped behaviour.
  //   T.MULTI_HEARTH = 1 — the pins PRE-LOAD the algorithmic greedy below. They
  //     hold their own separation discs and the scorer, otherwise untouched,
  //     fills the rest of the planet up to the same MAX_CRADLES. A scenario
  //     input stops being a cap on the mechanism.
  // (T.EARTH_HEARTHS off = purely algorithmic, either way.)
  if (T.EARTH_HEARTHS && (world.preset === "earth_sim" || world.preset === "earth")) {
    const pins = seedEarthHearths(world, !T.INVENT_STAGGER);
    if (pins.length) {
      if (!T.MULTI_HEARTH) {
        // Pins-only mode: under the stagger law the pins still seat or arm by
        // their own maturity; otherwise seedEarthHearths seated them already.
        if (T.INVENT_STAGGER) seatOrArmHearths(world, pins);
        return;
      }
      for (const p of pins) picked.push(p);
    } else {
      console.warn("[peopleSim] earth hearths found no site — falling back to algorithmic cradles");
    }
  }
  const nPinned = picked.length;   // pins are already seated; only the tail below is born here
  // Collect ALL viable candidates with their scores, then greedily pick the
  // top-scoring set with minimum separation.
  const candidates = [];
  for (let ti = 0; ti < N; ti++) {
    if (!isContinentalLand(world, ti)) continue;
    if (elev[ti] > 0.30) continue;
    const t = temp[ti], m = moist[ti], f = fert[ti];
    if (t < 0.68 || t > 0.88) continue;            // warm valleys only (+8..+28°C) — the Yellow River is the coldest real cradle (~+12°C); excludes cold high-latitude rivers
    const rm = riverMag ? riverMag[ti] : 0;
    const onRiver = rm >= 2;
    // A major river substitutes for rainfall — that's the whole point of the Nile
    // and the Indus: a fertile ribbon through a desert. Only DRY sites WITHOUT a
    // major river are rejected for low moisture.
    if (!onRiver && (m < 0.30 || m > 0.78)) continue;
    if (f < 0.40) continue;                        // fertile (river alluvium counts via tCrop)
    // Reward a fertile pocket walled by inhospitable LAND (the real river-valley
    // cradles — Nile/Sahara, Indus/Thar); PENALISE being mostly ringed by ocean
    // (islands / coastal outcroppings, where the first states did NOT arise).
    // (Formula lives in cradleScoreAt so pins and probes read the same ruler.)
    const score = cradleScoreAt(world, ti);
    candidates.push({ ti, score });
  }
  if (candidates.length === 0) {
    // Fallback: relax filters
    for (let ti = 0; ti < N; ti++) {
      if (!isContinentalLand(world, ti)) continue;
      if (fert[ti] < 0.25) continue;
      candidates.push({ ti, score: fert[ti] });
    }
  }
  if (candidates.length === 0) {
    console.warn("[peopleSim] no viable cradle site found — world all water?");
    return;
  }
  candidates.sort((a, b) => b.score - a.score);
  // Greedy: pick highest-scoring tile, then skip any tile within CRADLE_MIN_SEP.
  // Under MULTI_HEARTH `picked` arrives pre-loaded with the scenario pins, so
  // they simply occupy their own separation discs — the loop is otherwise the
  // same candidate order, the same rejection test and the same MAX_CRADLES cap.
  // The separation is a REAL distance under the lever (see CRADLE_MIN_SEP).
  const minSep = T.MULTI_HEARTH ? CRADLE_MIN_SEP * rNormPop(world) : CRADLE_MIN_SEP;
  const minSepSq = minSep * minSep;
  for (const c of candidates) {
    if (picked.length >= MAX_CRADLES) break;
    const ty = (c.ti / tw) | 0, tx = c.ti - ty * tw;
    let tooClose = false;
    for (const p of picked) {
      let ddx = Math.abs(p.tx - tx);
      if (ddx > tw / 2) ddx = tw - ddx;     // longitude wraps
      const ddy = p.ty - ty;
      if (ddx * ddx + ddy * ddy < minSepSq) { tooClose = true; break; }
    }
    if (!tooClose) picked.push({ tx, ty, ti: c.ti, score: c.score });
  }
  if (T.INVENT_STAGGER) {
    // Under the stagger law NOTHING was seated yet (pins deferred too): every
    // picked hearth seats or arms by its own maturity, on one ruler.
    seatOrArmHearths(world, picked);
    return;
  }
  for (let i = nPinned; i < picked.length; i++) {   // pins were seated by seedEarthHearths already
    const p = picked[i];
    const born = makeSettlement(world, p.tx + 0.5, p.ty + 0.5, { people: 110, cradle: true });   // natural proto-town (110 — the urban floor, see crystallize.js)
    const name = born.name;
    const e = elev[p.ti].toFixed(2), t = temp[p.ti].toFixed(2);
    const m = moist[p.ti].toFixed(2), f = fert[p.ti].toFixed(2);
    const rm = riverMag ? riverMag[p.ti] : 0;
    console.log(
      `[peopleSim] ${name} at tile (${p.tx},${p.ty}) — elev:${e} temp:${t} moist:${m} fert:${f}` +
      `${coast[p.ti]?" coast":""}${rm>=2?` river(mag${rm})`:""} score:${p.score.toFixed(2)}`
    );
  }
}

export function pruneDead(world) {
  world.settlements = world.settlements.filter(s => s.mode !== "dead");
}
