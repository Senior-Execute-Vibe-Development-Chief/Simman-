// ── Phase 1 of the field-simulation rewrite (T.POP_FIELD) ──────────────────────
//
// Population lives on the LAND, not on settlement entities. Two per-tile fields:
//   world.capField[ti] — carrying capacity (people the tile can feed) = fertility ×
//     the agricultural DEVELOPMENT available there (emergent, never a clock) —
//     under T.DEV_FIELD (default) the LOCAL technique that has actually reached
//     the tile (the wave-of-advance block below) plus a pastoral rangeland term;
//     lever off, the phase-1 global scalar.
//   world.popField[ti] — people actually living on the tile. Grows LOGISTICALLY
//     toward the tile's capacity, and MIGRATES down the capacity gradient so a full
//     cradle spills its surplus into empty fertile land (the peopling of the world
//     as a diffusion, not a settlement scatter).
//
// Seeded from the deep-ancestry peopling (tArrival: long-settled cradles start
// populated, the frontier near-empty), so the field reproduces where civilisation
// actually massed — dense river valleys and fertile belts, sparse deserts/tundra.
//
// LEVER-GATED, default OFF: when off, none of this runs and the settlement sim is
// byte-identical. When on (phase 1) it runs ALONGSIDE the settlement model purely as
// the demographic substrate to validate; phases 2-3 move food, territory and the
// settlements themselves onto it. Pure function of the terrain + emergent tech, fully
// deterministic (double-buffered migration), never persisted-vs-recomputed ambiguous
// (both fields are re-derivable, but popField carries state so it IS saved — see persist).

import { T, rNormPop } from "./tuning.js";
import { tileOpenness } from "./transport.js";
// Stage B (docs/popfield-parallel.md): the four parallel-safe loop bodies and
// the physical constants they share live in popFieldKernel.js (single source —
// a worker thread imports the kernel standalone), the worker pool in
// popFieldPool.js. Lever 0 keeps the serial loops in THIS file untouched; the
// cross-lever identity probe (tools/probe_popfield_par.mjs) gates the pairing.
import * as PFK from "./popFieldKernel.js";
import { signalPhase, awaitPhase, ensurePool, makeBands, writeBands } from "./popFieldPool.js";
const { RM_FULL, ACCESS_RIVER, ACCESS_COAST, ACCESS_DEV0, ACCESS_DEVK, RELIEF_PEN,
        DEV_BASE, DEV_TECH, R_DEV0, R_DEVK, R_TROPIC,
        FADE_FERT, FADE_RELIEF, FADE_PUMP, FADE_MED, FADE_ACCESS,
        WORKS_PRESS, WORKS_STAFF, WORKS_RATE, WORKS_DECAY, DIRS4 } = PFK;

// Carrying capacity: people per unit (fertility × development) on one tile at
// saturation. A calibration constant — its absolute value sets total world
// population; the DISTRIBUTION (the point of phase 1) is set by fertility alone.
// PER REAL AREA, not per tile (res-invariance 2026-07): calibrated on the
// 240-tile reference, so each tile carries cap (and seed) ÷rNormPop² — a finer
// grid divides the same real land among more tiles instead of multiplying the
// world's people by the tile count (measured 3.15× total people at tw=480
// before this; the median-anchors absorbed the LEVEL for their consumers, but
// the field's own dynamics and any raw read did not). ×1 exactly at the
// reference. POP_GROWTH is genuinely per-capita (no Δx in it) and stays
// unscaled; POP_MIGRATE is a diffusion coefficient in disguise (D ∝ share·Δx²)
// and is res-scaled by SUB-STEPPING in the migration section below — total
// share ×rn² per firing, split into substeps of ≤ MIG_SHARE_MAX each (n = 1
// and the exact original expression chain at the reference). Shipped SECOND
// in the 2026-07 rs=4 arc, deliberately: A/B'd alone it was REFUTED as the
// dev-clock driver and even shrank the urban economy (census −34% at 1920/12k
// — fast diffusion drains cradle catchments faster than an UNWIRED world's
// cities can urbanise the flow); on top of the road-wiring fix (roads.js) the same patch measured
// census +22% (0.69×→0.84× of the reference), city mean 0.90×, politics
// neutral. Order matters: the wiring is the mechanism, this is the substrate —
// docs/empire-consolidation-2026-07.md "THE rs=4 ARC".
const CAP_PER_FERT = 1200;
// Development multiplier: local carrying capacity rises with AGRICULTURAL tech —
// a hunter-gatherer land feeds a thin scatter, an irrigated-plough society feeds a
// dense one. Emergent (read from the world's leading agriculture in phase 1);
// becomes a field in a later phase. base at neolithic → ~×3.3 at full farming tech.
// DEV_BASE / DEV_TECH — popFieldKernel.js (single source, shared with the band kernels).
const POP_GROWTH = 0.03;    // logistic intrinsic growth per step (r in pop += r·pop·(1−pop/K))
// Migration share per step (at the reference grid) — now a LEVER (T.POP_MIGRATE,
// same name): a diffusion coefficient in disguise (D ∝ share·Δx²). At the old
// 0.06 (~24%/year between ~reference-tile cells) the connected landmass behaved
// as ONE FLUID — every local deficit topped up, every local surplus drained, so
// population genuinely rose "universally on a connected land mass" and local
// regimes/scars/booms were laundered away by their neighbours. Human-scale
// mobility is far lower; the lever's default is set by measurement (see
// docs/land-works.md addendum 3).
const POP_MIGRATE = 0.06;   // legacy constant: the schema default mirrors it ÷6 (see tuning.js)
const SEED_POP = 0.4;       // people seeded per habitable tile (the spark logistic growth needs)
// Max share of a tile one migration SUBSTEP may move. An explicit-scheme
// stability/accuracy bound (a substep must not come close to emptying a tile —
// share ≥ 1 goes negative, share near 1 checkerboards), not a rate: it only
// sets how many substeps the ×rn² total is split into at fine grids, and never
// binds at the reference (share there is POP_MIGRATE·dt ≤ 0.48 at the dt cap).
const MIG_SHARE_MAX = 0.5;

// ── T.DEV_FIELD: the REGIONAL development field (the phase the header promised:
// "becomes a field in a later phase") ────────────────────────────────────────
// world.devField[ti] = the agricultural TECHNIQUE known to the people ON that
// ground (0..1). Settlements STAMP their own agriculture onto the land they
// work (their catchments); from there the technique DIFFUSES over land as a
// wave of advance — the Neolithic expansion's measured mechanism (Ammerman &
// Cavalli-Sforza: farming crossed Europe at ~1 km/year, carried farmer-to-
// forager and farmer-by-migration). Carrying capacity then reads the LOCAL
// technique instead of one global scalar, so the civilized cores grow dense
// while the deep frontier stays a thin subsistence scatter — and the contrast
// between them WIDENS as regional development diverges and COLLAPSES as it
// diffuses. Emergent everywhere: no clock, no named region, no cap on where
// the wave may reach.
//   • WAVE SPEED: one tile per firing, with the firing interval derived from
//     DEV_WAVE_KMPY (km/year) and the grid's real tile size — so the same
//     km/year at any resolution (÷rNormPop) and any SIM_GRANULARITY (×G, the
//     _ivl pattern: dyn-years per step shrink 1/G while intervals stretch G).
//   • THINNING: a package loses DEV_WAVE_LOSS_PLANET of its level across a
//     full planet circumference of distance from where it is practiced —
//     remote peoples work a degraded version until nearer sources arise
//     (their own settlements then stamp the real local level). One
//     planetary-scale constant, no per-place tuning.
//   • RATCHET: the field only rises (techniques spread; forgetting is the
//     settlement layer's KNOW_DECAY story, not the frontier's). Double-
//     buffered relaxation — an in-place max sweep would cascade a whole row
//     in one pass (infinite wave speed along the scan direction).
//   • GENESIS: the map starts at 3000 BC, AFTER the real Neolithic expansion
//     (~9000→3000 BC) — so a fresh (or newly-activated) field inherits that
//     skipped history as an INITIAL CONDITION: the same wave, run from the
//     cradle hearths for DEV_INIT_YEARS before the first step. An initial
//     condition, not a gate (the genesis-seed philosophy).
const DEV_WAVE_KMPY = 1.0;          // wave-of-advance speed (the measured Neolithic ~1 km/year)
const DEV_WAVE_LOSS_PLANET = 1.0;   // technique lost per planet-circumference of distance from a source
export const DEV_INIT_YEARS = 6000;        // pre-map Neolithic spread inherited at genesis (9000→3000 BC)
/** T.DAWN_LIVE (owner 2026-08-05: "can we not simply open with nothing and
 *  wait for nations to be born?"): the effective prehistory span. 0 under the
 *  lever — the map opens at the TRUE dawn, a forager world with no seeded
 *  hearth settlements and no pre-spread technique wave; every hearth ARMS
 *  (the stagger law's needY becomes its full domestication lag) and farming,
 *  nations and cities are all born live, on camera. DEV_INIT_YEARS is an
 *  initial condition ("how old the world is at map open") — this lever sets
 *  that age to zero, which is the one value that needs no defending. */
export function devInitYears() { return T.DAWN_LIVE ? 0 : DEV_INIT_YEARS; }
const EARTH_KM = 40075;             // planet circumference — the map's x-extent in km
// Climate-ZONE scale for the T.DIFF_CLIM toll (reference tiles; ×rNormPop at
// other grids — a real distance, ~2 × 167 km ≈ 330 km at the reference). A
// farming package (crops, calendar, livestock) adapts to the climate BAND it
// grows in, not to every valley-vs-ridge wiggle one tile over: re-domestication
// is forced by crossing the Sahara or the tropics boundary, never by a monsoon
// coast's local texture. So the toll reads climate box-smoothed at this radius
// (see _ensureDevClim), which keeps every zone-scale gradient at full price
// while erasing the sub-zone variation the raw fields double-charged.
const DEV_CLIM_ZONE_REF = 2;
// ── T.LAND_WORKS: Boserupian land improvement (capacity is BUILT, not given) ──
// Real carrying capacity was never a fixed property of terrain: under
// population pressure societies INVESTED labour in the land itself —
// irrigation canals, terraces, drainage, paddy levelling — and that capital
// accumulated in place over centuries, raising yield ~2-3× (basin irrigation)
// to 5-15× (wet rice vs dry farming). It is why equal-fertility valleys
// diverged: the worked Nile/Ganges/Yellow basins densified for millennia
// while unworked land plateaued — and why collapse SCARS (Mesopotamia's
// broken canals) emptied dense country for centuries. Without this, the
// population field is a pure fill-toward-terrain: after the technique wave
// passes, two equal valleys are equally dense forever, and "civilization"
// can only brighten the whole map, never densify a PLACE.
//   • BUILD: where people press their current ceiling (pop/cap past the
//     Boserup threshold — intensification starts when extensification is
//     exhausted), water can be led onto fields (river / floodplain / wet
//     climate), and the farming technique has actually reached the ground
//     (devField). Purely local state — no clock, no named region.
//   • EFFECT: crop capacity ×(1 + LAND_WORKS·works). The lever IS the
//     physical constant: yield multiple of fully-improved land (2 ≈ the
//     historical irrigation premium; rangeland herding is untouched).
//   • DECAY: unmaintained works silt and slump — staffing below a quarter
//     of the (improved) ceiling lets them rot on a ~two-century half-life,
//     so a die-off or exodus leaves a real scar that must be rebuilt.
//   • Self-limiting: building raises cap → lowers pressure → slows building
//     (negative feedback); the field's own migration then pulls people INTO
//     the improved basin (spare capacity) — the hotspot concentration.
// WORKS_PRESS / WORKS_STAFF / WORKS_RATE / WORKS_DECAY — popFieldKernel.js.

// ── T.GROWTH_LOCAL: per-tile demographic regimes (farmer vs forager) ─────────
// The intrinsic growth rate was a single global constant — every tile on the
// planet compounded at the same r, so a connected landmass rose through its
// saturation trajectory in LOCKSTEP (the Malthus term (1−p/K) is the food
// brake, but it synchronizes rather than differentiates: the dawn seeds one
// fraction everywhere). Historically the RATE was local — differential
// natural increase is the engine of the Neolithic expansion itself (farmers
// out-bred foragers ~3-5×; Ammerman & Cavalli-Sforza's wave is DRIVEN by
// that surplus), and the wet-tropic disease belt crushed natural increase
// regardless of food. Both drivers already live on the map as emergent
// state: devField (the farming technique that actually REACHED each tile)
// and climate. r_i = r × (R_DEV0 + R_DEVK·dev_i) ÷ (1 + R_TROPIC·burden_i),
// lever-blended so 0 = the flat rate exactly:
//   dev 0 (forager land)   → ×0.35 of base   (near-stationary bands)
//   dev 0.5 (mid farming)  → ×1.00           (SETT_GROWTH keeps its meaning)
//   dev 1 (advanced core)  → ×1.65           (the demographic engine)
// City cores are untouched (their own transition/graveyard-bent rEff). The
// visible result: growth is no longer universal — the civilized band climbs
// while the frontier crawls, tile by tile, by food (Malthus), technique
// (regime) and disease (climate).
// R_DEV0 / R_DEVK / R_TROPIC — popFieldKernel.js.

// ── T.TERRAIN_FADE: technology SUBSTITUTES for terrain (the late-era fades) ──
// Pre-industrial technique AMPLIFIES what terrain gives (multiplicative on
// fertility, water, relief — ratios never close). History's late chapters
// SUBSTITUTED for what terrain withholds: synthetic fertilizer raised poor
// soils proportionally more (yield ratios compressed), rail and engineering
// erased ruggedness's price, pumps and dams freed irrigation from surface
// water, medicine collapsed the tropical disease burden, and land transport
// tapered the waterside premium. One lever, five terms, ALL gated on the
// OWNING settlement's emergent industrial gate (s._indGate — org+metallurgy,
// the same gate the urban transition and industrial capacity use): nobody
// railroads the wilderness, and the whole set SLEEPS until a realm actually
// industrializes — no clock anywhere. Each constant is the fade's magnitude
// at full industrial development:
// FADE_FERT / FADE_RELIEF / FADE_PUMP / FADE_MED / FADE_ACCESS — popFieldKernel.js.

// ── Pastoral capacity (the mechanism DEV_FIELD un-masked) ────────────────────
// The global scalar had been silently gifting the STEPPE farming-level capacity;
// with capacity honest about local technique, the range thinned to nothing and
// the nomad system starved (measured: hordes classified from t≈18k with 50 raids
// under the scalar; first classification t≈24k and ZERO raids under the bare
// wave). The missing CAUSE: herding converts grass — inedible to people — into
// food, independent of crop technique. Rangeland capacity is openness-weighted
// (transport.js tileOpenness: dry grass, low relief — the same saddle-country
// measure the nomad system reads) at the historical pastoral density: ~1/10 of
// what fert-1.0 cropland feeds at the pre-farming base. An economy uses the
// better strategy locally (max), so the herd beats the plough exactly where the
// ground is open and too poor to farm — the steppe carries real people again
// without giving back the farming contrast. Sheep/goat pastoralism predates the
// 3000 BC start wherever grass grows, so v1 is technique-free; scaling the range
// with the mounted complex (mobility diffusion) is a noted follow-up.
const PASTORAL_DENS = 0.10;         // people per openness-1 range tile, as a fraction of fert-1 cropland at CAP_PER_FERT

// Firing interval (steps) for the wave at this grid: a tile is EARTH_KM/tw km
// across and the wave crosses one tile per firing, so fire every
// tileKm/KMPY years = tileKm/KMPY/0.25 steps (dyn-years run 0.25/G per step,
// intervals stretch ×G — the _ivl pattern). Resolution-invariant by
// construction: a finer grid has smaller tiles and proportionally shorter
// intervals, the same km/year everywhere.
export function devWaveIvl(world) {
  const tileKm = EARTH_KM / world.tw;
  const G = T.SIM_GRANULARITY || 1;
  return Math.max(1, Math.round(tileKm / DEV_WAVE_KMPY / 0.25 * G));
}
const devWaveLoss = (world) => DEV_WAVE_LOSS_PLANET / world.tw;

/** Stamp every settlement's own agriculture onto the land it works. */
function stampDevSources(world, dev) {
  const owner = world._territoryOwner, byId = world._byId, tw = world.tw;
  // T.INVENT_STAGGER pre-run only: a hearth whose maturity falls PARTWAY through
  // prehistory starts radiating at its own pre-run iteration (_devHoldK, set by
  // ensureDevField from the hearth's wave age), so the Nile-class cores open
  // with old, wide halos and late hearths with young, small ones. Live play:
  // _devPreK is undefined and nothing is ever held.
  const preK = world._devPreK;
  const held = (s) => preK !== undefined && s._devHoldK !== undefined && preK < s._devHoldK;
  // Settlement-less farming sources (T.CITY_AT_BIRTH × T.DAWN_LIVE): a hearth
  // that matured WITHOUT minting a settlement still invented farming — its
  // basin practices it, so the wave must radiate from the ground itself.
  // world._hearthSeeds carries {ti, agri} for each such invention (written at
  // armed-hearth maturation, persisted); without this stamp the invention
  // would never spread and a seedless dawn could never leave the forager age.
  if (world._hearthSeeds) {
    for (const h of world._hearthSeeds) if (h.agri > dev[h.ti]) dev[h.ti] = h.agri;
  }
  if (owner && byId) {
    for (let i = 0; i < world.N; i++) {
      const sid = owner[i];
      if (sid < 0) continue;
      const s = byId.get(sid);
      if (!s || s.mode !== "settled" || held(s)) continue;
      const a = (s.knowledge && s.knowledge.agriculture) || 0;
      if (a > dev[i]) dev[i] = a;
    }
  }
  // Home tiles directly, so a settlement with no catchment yet still radiates.
  for (const s of world.settlements) {
    if (s.mode !== "settled" || held(s)) continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (ti < 0 || ti >= world.N) continue;
    const a = (s.knowledge && s.knowledge.agriculture) || 0;
    if (a > dev[ti]) dev[ti] = a;
  }
}

/** T.IDEA_FIELD: rebuild the SOURCE field from living practice, fresh each
 *  firing. Off-lever, stampDevSources writes straight into devField and both it
 *  and the wave are max-only, so the field is a monotone ratchet — it records
 *  each tile's best-ever technique and can never fall. On-lever the sources are
 *  their own array, zeroed first, so a settlement that forgets (T.KNOW_DECAY)
 *  or dies stops holding its land up. See the lever's note in tuning.js. */
function rebuildDevSources(world) {
  let src = world._devSrc;
  if (!src || src.length !== world.N) src = world._devSrc = new Float32Array(world.N);
  else src.fill(0);
  stampDevSources(world, src);
  return src;
}

/** One wave relaxation: each land tile rises toward its best neighbour − loss.
 *  T.DIFF_CLIM adds a CLIMATE-DISTANCE toll per edge: the package loses
 *  DIFF_CLIM × (|Δtemp| + |Δmoist|) crossing between climatically different
 *  tiles — crops and livestock had to be re-adapted for each new band, so
 *  real agriculture raced ALONG climate bands (the Eurasian east-west axis)
 *  and crawled ACROSS them (maize's millennia-long trek out of Mexico), and
 *  some boundaries it effectively never crossed (wheat vs the Sahara).
 *  The toll reads ZONE-SMOOTHED climate (_ensureDevClim: land-only box
 *  smoothing at the DEV_CLIM_ZONE_REF real radius), because what is actually
 *  summed along a path is the fields' TOTAL VARIATION, not their net
 *  displacement: on the raw fields every sub-zone wiggle (a monsoon coast, a
 *  cordillera flank, valley-vs-ridge) charged full price, so the most
 *  climatically TEXTURED land paid the most — SE Asia read as farther from
 *  China than the Sahara from the Mediterranean (measured devField 0.22 vs
 *  0.59 at 18k), the inverse of the intent, while the climatically SMOOTH
 *  Sahara core was crossed easily. Smoothing makes the invariance claim true
 *  at the zone scale: across any MONOTONE zone-scale gradient the toll still
 *  telescopes to DIFF_CLIM × the net climate distance, however many tiles
 *  span it (so the Sahara, the tropics edge and the steppe margin keep their
 *  full price at any resolution), while variation below the zone scale — the
 *  texture a farming package never had to re-adapt to — no longer
 *  accumulates. Without the toll the wave crosses the Sahara at the same
 *  speed as the Danube plain (both are "land"), and a connected landmass
 *  converges to near-uniform technique (planetary thinning is only
 *  ~0.025/1000 km) — the measured late-run uniformity. 0 = the flat wave,
 *  byte-identical. */
function relaxDevWave(world, dev, land) {
  const tw = world.tw, th = world.th;
  let nxt = world._devNext;
  if (!nxt || nxt.length !== world.N) nxt = world._devNext = new Float32Array(world.N);
  nxt.set(dev);
  const loss = devWaveLoss(world);
  // T.IDEA_FIELD: with a live source field the tile is SET to max(source, wave)
  // rather than ratcheted up toward it — the same relaxation, run as a genuine
  // fixed-point iteration so it converges DOWNWARD too when a source recedes.
  // Note `best` is a MAX over neighbours, so a 0-valued ocean neighbour never
  // drags a coastal tile down; an isolated tile with no land neighbour falls
  // back to its own source, which is the correct answer for it.
  const src = T.IDEA_FIELD ? (world._devSrc && world._devSrc.length === world.N ? world._devSrc : rebuildDevSources(world)) : null;
  const ck = T.DIFF_CLIM || 0;
  let te = null, mo = null;
  if (ck > 0 && world.temp && world.moist) { const dc = _ensureDevClim(world); te = dc.t; mo = dc.m; }
  const climOn = !!te;
  for (let li = 0; li < land.length; li++) {
    const i = land[li];
    const y = (i / tw) | 0, x = i - y * tw;
    const iR = y * tw + ((x + 1) % tw), iL = y * tw + ((x - 1 + tw) % tw);
    let best;
    if (climOn) {
      const ti = te[i], mi = mo[i];
      best = dev[iR] - ck * (Math.abs(te[iR] - ti) + Math.abs(mo[iR] - mi));
      const l = dev[iL] - ck * (Math.abs(te[iL] - ti) + Math.abs(mo[iL] - mi));
      if (l > best) best = l;
      if (y > 0) { const u = dev[i - tw] - ck * (Math.abs(te[i - tw] - ti) + Math.abs(mo[i - tw] - mi)); if (u > best) best = u; }
      if (y < th - 1) { const d2 = dev[i + tw] - ck * (Math.abs(te[i + tw] - ti) + Math.abs(mo[i + tw] - mi)); if (d2 > best) best = d2; }
    } else {
      best = dev[iR];
      const l = dev[iL];
      if (l > best) best = l;
      if (y > 0 && dev[i - tw] > best) best = dev[i - tw];
      if (y < th - 1 && dev[i + tw] > best) best = dev[i + tw];
    }
    const v = best - loss;
    if (src) { const s0 = src[i]; nxt[i] = v > s0 ? v : s0; }
    else if (v > nxt[i]) nxt[i] = v;
  }
  world._devNext = dev;
  world.devField = nxt;
  return nxt;
}

// Zone-smoothed climate for the wave toll — pure function of static terrain,
// built once and cached on the world (never persisted; recomputed on load, and
// the genesis pre-run in ensureDevField reads the SAME cache via relaxDevWave,
// so the inherited Neolithic spread pays the same toll as the live wave).
// Box smoothing at radius DEV_CLIM_ZONE_REF × rNormPop tiles (the repo's
// real-distance idiom: exactly 2 tiles at the 240-wide reference, a radius
// that rounds to 0 only where a single tile already spans the zone scale, and
// then smoothing rightly degrades to the raw fields). LAND-ONLY kernel: the
// package adapts to the climate of the farmland it is practiced on — sea-
// surface temp/moist is a different physical regime (uniformly wet), and
// blending it in would manufacture a phantom toll band along every coastline
// (the very texture artifact this smoothing removes) while diluting real
// land-side gradients near the shore. Separable masked box filter — x wraps
// (the map is a cylinder, same as the wave's own neighbours), y truncates at
// the poles; a window with no land (open ocean) falls back to the raw value
// (unread by the wave: dev is 0 on water and the toll only ever subtracts).
function _ensureDevClim(world) {
  const rn = rNormPop(world);
  const r = Math.max(0, Math.round(DEV_CLIM_ZONE_REF * rn));
  let dc = world._devClim;
  if (dc && dc.N === world.N && dc.r === r) return dc;
  const N = world.N, tw = world.tw, th = world.th;
  const te = world.temp, mo = world.moist, elev = world.elev;
  const sT = new Float32Array(N), sM = new Float32Array(N);
  if (r === 0) { sT.set(te); sM.set(mo); }
  else {
    // horizontal pass: land-only sums + land count per row window (x wraps)
    const hT = new Float64Array(N), hM = new Float64Array(N), hC = new Int32Array(N);
    for (let y = 0; y < th; y++) {
      const row = y * tw;
      for (let x = 0; x < tw; x++) {
        let st = 0, sm = 0, c = 0;
        for (let dx = -r; dx <= r; dx++) {
          const j = row + ((x + dx + tw) % tw);
          if (elev[j] > 0) { st += te[j]; sm += mo[j]; c++; }
        }
        const i = row + x;
        hT[i] = st; hM[i] = sm; hC[i] = c;
      }
    }
    // vertical pass (window truncates at the poles), then normalise by count
    for (let y = 0; y < th; y++) {
      const y0 = y - r < 0 ? 0 : y - r, y1 = y + r >= th ? th - 1 : y + r;
      const row = y * tw;
      for (let x = 0; x < tw; x++) {
        let st = 0, sm = 0, c = 0;
        for (let yy = y0; yy <= y1; yy++) {
          const j = yy * tw + x;
          st += hT[j]; sm += hM[j]; c += hC[j];
        }
        const i = row + x;
        if (c > 0) { sT[i] = st / c; sM[i] = sm / c; }
        else { sT[i] = te[i]; sM[i] = mo[i]; }
      }
    }
  }
  return (world._devClim = { N, r, t: sT, m: sM });
}

/**
 * Allocate + seed the development field: stamp today's sources, then run the
 * skipped pre-map Neolithic expansion (DEV_INIT_YEARS of the same wave) so a
 * 3000 BC world starts with farming already spread around its hearths — the
 * eve-of-states initial condition. Deterministic (a pure function of current
 * state); also serves an old save on load (absent field → same seeding).
 */
function ensureDevField(world, land) {
  if (world.devField && world.devField.length === world.N) return world.devField;
  let dev = world.devField = new Float32Array(world.N);
  world._devNext = new Float32Array(world.N);
  // T.IDEA_FIELD: the genesis pre-run relaxes against the SAME live-source law
  // as every later firing, so the eve-of-states initial condition is the one
  // the running world would have produced — not a ratcheted field the law can
  // then only erode. `dev` is SEEDED from the sources (not left at zero) so both
  // arms enter the loop from the same field and spend all `iters` passes
  // PROPAGATING: seeded at zero the first pass is consumed re-deriving the
  // sources, which would hand the lever a genesis field one wave-step less
  // spread than the control and confound the whole arm with an initial
  // condition.
  const tileKm = EARTH_KM / world.tw;
  const iters = Math.max(0, Math.round(devInitYears() * DEV_WAVE_KMPY / tileKm));
  // T.INVENT_STAGGER: hearths matured at different points in prehistory
  // (s._hearthAgeY = years of wave spread owed by map open, set at seeding).
  // Map each to the pre-run iteration its wave STARTS at, then run the same
  // loop with the stamp's hold filter active — a re-stamp fires at each
  // unlock so a newly-matured hearth starts radiating exactly then. Live play
  // never sees any of this (world._devPreK is deleted below).
  let unlocks = null;
  if (T.INVENT_STAGGER) {
    const yearsPerIter = tileKm / DEV_WAVE_KMPY;
    for (const s of world.settlements) {
      if (s.mode !== "settled" || s._hearthAgeY === undefined) continue;
      const k = Math.max(0, Math.min(iters, iters - Math.round(s._hearthAgeY / Math.max(1e-9, yearsPerIter))));
      if (k > 0) { s._devHoldK = k; (unlocks || (unlocks = new Set())).add(k); }
    }
    if (unlocks) world._devPreK = 0;
  }
  if (T.IDEA_FIELD) dev.set(rebuildDevSources(world)); else stampDevSources(world, dev);
  for (let k = 0; k < iters; k++) {
    if (unlocks) {
      world._devPreK = k;
      // A hearth unlocking at k starts contributing THIS pass: re-derive the
      // sources so its package enters the wave from its own maturity onward.
      // (IDEA_FIELD arm: refresh _devSrc ONLY — the relax reads it every pass;
      // dev.set(src) here would erase the spread already accumulated.)
      if (unlocks.has(k)) { if (T.IDEA_FIELD) rebuildDevSources(world); else stampDevSources(world, dev); }
    }
    dev = relaxDevWave(world, dev, land);
  }
  if (unlocks) {
    delete world._devPreK;
    for (const s of world.settlements) if (s._devHoldK !== undefined) delete s._devHoldK;
  }
  return dev;
}

// ── Carrying-capacity terms beyond raw fertility (phase 2) ──────────────────
// Real land does not feed people in proportion to its crop suitability alone: a
// river valley or a coast supports FAR denser settlement than the same soil
// inland, because water carries food IN (irrigation + grain barges + sea trade —
// the market/port premium), while rugged land supports LESS. Each term is a
// genuine mechanism with independent physical meaning (never a size fitted to a
// place): the great river valleys, deltas and coastal plains concentrate on their
// own, and so does any map you never looked at.
// RM_FULL / ACCESS_RIVER / ACCESS_COAST — popFieldKernel.js (values there).
// The premium GROWS with development: a neolithic landing imports little, an
// industrial port draws grain from a continent. Emergent (reads leading
// agriculture as the transport-tech proxy), never a clock. base (ancient
// irrigation already ~doubles a great valley) → +ACCESS_DEVK at full tech.
// ACCESS_DEV0 / ACCESS_DEVK / RELIEF_PEN — popFieldKernel.js.

// ── T.ACCESS_BAND: the water-access premium over a REAL width (2026-08-07, the
// coast/river dilution wave — docs/dawn-cradles-2026-08-07.md §5) ─────────────
// The capacity premium `ACCESS_RIVER×(riverMag/RM_FULL) + ACCESS_COAST×coast`
// was a PER-TILE read on 1-D features: a river influences rn× more tiles at a
// finer grid but each is 1/rn² the area, so the premium's real integral falls
// as 1/rn — the ~1.3-2.2× capacity dilution the resgate ratchet has carried as
// its documented open gap since docs/resolution-collapse-2026-07-29.md, and
// (measured, the birth-crater closing table) the binding constraint on
// newborn-city viability at the shipped grid: app-grid ledgers plateau at ~0.6
// of demand because the waterside capacity that should feed a river city
// thins with the grid. The fix is the flood-ribbon convention applied to
// ACCESS: the premium extends over ONE REFERENCE TILE of real cross-section at
// any grid — full intensity within the band, fractional coverage at the edge
// (the v3-erratum discipline), Euclidean distance, MAX over sources (two
// rivers don't stack). w(d) = min(1, max(0, rn/2 + 0.5 − d)): at the
// reference grid (rn=1) the band is exactly the source tile at weight 1 —
// BYTE-IDENTICAL by construction; at rn=2 the neighbours carry ½; at rn=4
// (±1 full, ±2 half); below the reference (a coarse probe grid) the source
// tile itself damps toward the band's sub-tile share — the same
// mass-conserving direction the flood ribbon takes for sub-pixel valleys.
// Static terrain, built once, rebuilt deterministically at load; the banded
// arrays SUBSTITUTE for riverMag/coast in the capacity pass only (kernel and
// bit-guarded worker path untouched — they read whatever arrays are packed).
export function ensureAccessBand(world) {
  if (world._rmBand && world._rmBand.length === world.N) return;
  const { N, tw, th } = world;
  const rn = rNormPop(world);
  const rm = world.riverMag, coast = world.coast;
  const rmB = world._rmBand = new Float32Array(N);
  const coB = world._coastBand = new Float32Array(N);
  const H = rn / 2 + 0.5;
  const R = Math.ceil(H);
  for (let ti = 0; ti < N; ti++) {
    const mag = rm ? rm[ti] : 0, isC = coast ? coast[ti] : 0;
    if (!(mag >= 1) && !isC) continue;
    const y0 = (ti / tw) | 0, x0 = ti - y0 * tw;
    for (let dy = -R; dy <= R; dy++) {
      const y = y0 + dy; if (y < 0 || y >= th) continue;
      for (let dx = -R; dx <= R; dx++) {
        const w = Math.min(1, Math.max(0, H - Math.hypot(dx, dy)));
        if (w <= 0) continue;
        const i2 = y * tw + (((x0 + dx) % tw) + tw) % tw;
        if (mag >= 1) { const v = mag * w; if (v > rmB[i2]) rmB[i2] = v; }
        if (isC && w > coB[i2]) coB[i2] = w;
      }
    }
  }
}

export function initPopField(world) {
  const N = world.N;
  const pop = world.popField = new Float32Array(N);
  world.capField = new Float32Array(N);
  world._popNext = new Float32Array(N);
  // ACCESS_BAND fields are built at init so every arena carries them from its
  // first spawn (stepPopField re-ensures before each prepare — belt and
  // braces; a loaded world rebuilds them here deterministically, they are
  // derived terrain and never persisted).
  if (T.ACCESS_BAND) ensureAccessBand(world);
  const { elev, fert, tArrival } = world;
  const rn = rNormPop(world);
  const seedPop = SEED_POP / (rn * rn);   // per REAL area (÷1 exactly at the reference)
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0) || !(fert[i] > 0.03)) continue;
    // Residence: 1 in the long-settled cradle of humanity (tArrival→0), →0 on the
    // late-reached frontier (tArrival→1). Long-peopled land starts with a real seed
    // population; the frontier starts near-empty and fills by migration.
    const residence = tArrival ? (1 - Math.min(1, Math.max(0, tArrival[i]))) : 0.5;
    pop[i] = seedPop * (0.15 + 0.85 * residence);
  }
}

// Advance the population field one step: capacity → logistic growth → migration.
// `sub` = how many ticks this firing represents (POP_FIELD_STRIDE); the step size
// scales by it so a strided field follows the same trajectory at ~1/sub the cost.
export function stepPopField(world, sub = 1) {
  const N = world.N, tw = world.tw, th = world.th;
  let { elev, fert, riverMag, relief, coast } = world;
  let pop = world.popField, cap = world.capField;
  if (!pop || pop.length !== N) { initPopField(world); pop = world.popField; cap = world.capField; }

  // Global agricultural development (emergent — phase 1 reads it from settlements'
  // leading agriculture; T.DEV_FIELD replaces this scalar with the REGIONAL
  // technique field — see the wave-of-advance block above).
  let leadAgri = 0;
  for (const s of world.settlements) if (s.mode === "settled") { const a = (s.knowledge && s.knowledge.agriculture) || 0; if (a > leadAgri) leadAgri = a; }
  const dev = DEV_BASE + DEV_TECH * leadAgri;
  // Time-granularity dt × stride: a firing advances `sub` ticks of history at
  // 1/G each (so it honours SIM_GRANULARITY), capped for integrator stability.
  // At the default stride 1 / G 1 → dt 1; an opt-in stride N advances N ticks
  // per firing (dt capped at 8).
  const dt = Math.min(8, (world._dt || 1) * sub);

  // Iterate LAND tiles only. ~45% of the grid is ocean, where cap/pop are always 0
  // (water cap stays at its init 0, never written; nothing migrates into it) — so
  // skipping it is byte-identical, it just drops the field pass's dead iterations
  // (the whole field-model overhead scales with this loop count). The land index is
  // static (terrain), built once.
  let land = world._popLand && world._popLand.length ? world._popLand : (world._popLand = buildLandList(world));
  const nLand = land.length;
  const _rnF = rNormPop(world);
  const capPerFert = CAP_PER_FERT / (_rnF * _rnF);   // per REAL area (÷1 exactly at the reference)

  // T.DEV_FIELD: keep the regional technique field current — stamp sources +
  // advance the wave one tile every devWaveIvl steps (~1 km/year at any grid).
  let devF = null, pasture = null;
  if (T.DEV_FIELD) {
    devF = ensureDevField(world, land);
    const ivl = devWaveIvl(world);
    if (world.step - (world._devWaveAt ?? -Infinity) >= ivl) {
      world._devWaveAt = world.step;
      if (T.IDEA_FIELD) rebuildDevSources(world); else stampDevSources(world, devF);
      devF = relaxDevWave(world, devF, land);
    }
    // Static rangeland capacity (openness is pure terrain — built once). Per REAL
    // area like the crop capacity below (capPerFert), so the herd/plough choice is
    // resolution-invariant too.
    pasture = world._pastureCap;
    if (!pasture || pasture.length !== N) {
      pasture = world._pastureCap = new Float32Array(N);
      for (let li = 0; li < nLand; li++) { const i = land[li]; pasture[i] = tileOpenness(world, i) * capPerFert * PASTORAL_DENS; }
    }
  }

  // 1. Carrying capacity per tile = farmable yield (fert × development) lifted by
  //    the water-transport PREMIUM (river/coast can import food → denser settlement)
  //    and cut by rugged RELIEF. The premium is multiplicative on fert, so it
  //    concentrates people onto FERTILE valleys and shores (a barren river bank
  //    stays empty — you can't irrigate rock) rather than blooming deserts.
  //    Under T.DEV_FIELD both development terms read the LOCAL technique — the
  //    people of a tile farm (and build ports) with what has REACHED them, so
  //    the civilized cores support dense settlement while the deep frontier
  //    stays a thin subsistence scatter. Lever off: the global scalar, exactly.
  const accessDev = ACCESS_DEV0 + ACCESS_DEVK * leadAgri;   // transport premium grows with tech (emergent)
  // Industrial carrying-capacity break (T.INDUSTRIAL_CAP): a worked tile's crop capacity is
  // lifted by its owning realm's industrial development (s._indCap, set in updateSettlement) —
  // the modern productivity boom the food model had but the field never received. Off ⇒ no
  // lookup, byte-identical; frontier / stateless tiles (owner < 0) keep indMul 1 (subsistence).
  const indOn = T.INDUSTRIAL_CAP > 0;
  // T.TERRAIN_FADE needs the owner lookup even when INDUSTRIAL_CAP is off.
  const tfL = T.TERRAIN_FADE || 0;
  const ownOn = indOn || tfL > 0;
  let indOwner = ownOn ? world._territoryOwner : null; const indById = ownOn ? world._byId : null;
  // Per-tile fade level (lever × owner's industrial gate), stashed for the
  // works/growth passes below (same firing, deterministic order).
  let tfArr = null;
  if (tfL > 0) { tfArr = world._tfFade; if (!tfArr || tfArr.length !== N) tfArr = world._tfFade = new Float32Array(N); else tfArr.fill(0); }
  // T.LAND_WORKS: accumulated land improvement multiplies CROP capacity (the
  // canals irrigate fields, not rangeland). Lever value = max yield multiple.
  const worksOn = T.LAND_WORKS > 0 && world.worksField;
  let worksF = worksOn ? world.worksField : null; const worksK = worksOn ? T.LAND_WORKS : 0;
  // ── Stage B parallel context (docs/popfield-parallel.md §4) ────────────────
  // Lever ≥1 routes the four parallel-safe phases through the shared band
  // kernels (≥2 additionally bands them across the worker pool when it is
  // ready). Null ⇒ every serial loop below runs exactly as always. The
  // prepare step may convert world arrays to SharedArrayBuffer-backed views,
  // so every local captured above is refreshed to address the SAME memory the
  // workers see.
  // T.ACCESS_BAND: build the REAL-width banded access fields BEFORE the pool
  // prepare, so the SAB conversion list picks them up and the arena message
  // redirects its riverMag/coast slots (workers read slots by name).
  if (T.ACCESS_BAND) ensureAccessBand(world);
  const _pctx = _pfLever() >= 1 ? _pfPrepare(world, land, nLand, devF) : null;
  if (_pctx) {
    ({ elev, fert, riverMag, relief, coast } = world);
    land = world._popLand;
    pop = world.popField; cap = world.capField;
    if (devF) devF = world.devField;
    if (pasture) pasture = world._pastureCap;
    if (tfArr) tfArr = world._tfFade;
    if (worksF) worksF = world.worksField;
    if (indOwner) indOwner = world._territoryOwner;
  }
  // The capacity pass reads the banded fields in place of the per-tile
  // riverMag/coast when the lever is on (byte-identical at the reference grid
  // — see ensureAccessBand). Substitute ARRAYS, not code: the serial loop, the
  // band kernel and the pooled workers all read whatever is handed to them.
  const rmEff = (T.ACCESS_BAND && world._rmBand) ? world._rmBand : riverMag;
  const coastEff = (T.ACCESS_BAND && world._coastBand) ? world._coastBand : coast;
  if (_pctx) {
    _pfCap(_pctx, world, { land, fert, riverMag: rmEff, coast: coastEff, relief, cap, pasture, worksF, tfArr,
      ownOn: !!(ownOn && indOwner), indOn, tfL, worksOn: !!worksF, worksK,
      capPerFert, accessDev, dev });
  } else
  for (let li = 0; li < nLand; li++) {
    const i = land[li];
    const water = rmEff ? Math.min(1, rmEff[i] / RM_FULL) : 0;
    let access = ACCESS_RIVER * water + ACCESS_COAST * (coastEff ? coastEff[i] : 0);
    let indMul = 1, fade = 0;
    if (ownOn && indOwner) {
      const sid = indOwner[i];
      if (sid >= 0) {
        const s2 = indById.get(sid);
        if (s2) {
          if (indOn && s2._indCap > 1) indMul = s2._indCap;
          if (tfL > 0) { fade = tfL * (s2._indGate || 0); if (fade > 0) tfArr[i] = fade; }
        }
      }
    }
    // TERRAIN_FADE: engineering eases ruggedness; land transport tapers the
    // waterside premium; fertilizer floors poor soil (substitution, not
    // amplification — see the constants block).
    const reliefMul = relief ? 1 / (1 + RELIEF_PEN * relief[i] * (1 - FADE_RELIEF * fade)) : 1;
    if (fade > 0) access /= 1 + FADE_ACCESS * fade;
    const f0 = fert[i], fEff = fade > 0 ? f0 + FADE_FERT * fade * (1 - f0) : f0;
    const wkMul = worksF ? 1 + worksK * worksF[i] : 1;
    if (devF) {
      const a = devF[i];
      const reach = 1 + access * (ACCESS_DEV0 + ACCESS_DEVK * a);
      const crop = fEff * capPerFert * (DEV_BASE + DEV_TECH * a) * reach * reliefMul * indMul * wkMul;   // ×indMul: industrial agronomy break; ×wkMul: built land improvement
      const range = pasture[i];   // the herd or the plough — whichever feeds this ground better (openness already prices relief)
      cap[i] = crop > range ? crop : range;
    } else {
      const reach = 1 + access * accessDev;
      cap[i] = fEff * capPerFert * dev * reach * reliefMul * indMul * wkMul;
    }
  }

  // ── T.FOREST_LOCK: the canopy prices the crop — the FIELD-side half of
  // LAND_CLEAR_METAL. The clearance model existed only as a STATE-FORMATION
  // bar (countryTerritory forestBar), so the capacity field read raw
  // fertility on closed-canopy land and stone-age Europe filled to
  // half-mature farm density, overwhelming the very bar that was supposed to
  // hold it (2026-07 diagnosis: huge stone-age nations over an anachronistic
  // population). Here the SAME forest signal (moisture band × not-floodplain,
  // the countryTerritory definition) locks that share of a tile's CROP
  // capacity until the land's own administering settlement carries the axes
  // (metallurgy vs LAND_CLEAR_METAL — local and emergent; wild land has no
  // toolkit and stays forager-sparse). The pasture term is the floor either
  // way: clearings, swidden and mast still feed people, and open land is
  // untouched. The arid river cradles carry no forest signal, so the Nile /
  // Indus / Mesopotamia lead exactly as before. Runs as a deterministic
  // main-thread post-pass (fixed land order, after the banded/inline capacity
  // compute, before FOOD_K and the genesis seed) so pool and non-pool stay
  // bit-identical and the DAWN seed itself is forest-priced — Europe is born
  // sparse and OPENS with the iron age. 0 = canopy-blind capacity (legacy).
  const flL = T.FOREST_LOCK || 0;
  if (flL > 0) {
    const moistF = world.moist;
    const clearRef = Math.max(0.1, T.LAND_CLEAR_METAL || 0.55);
    for (let li = 0; li < nLand; li++) {
      const i = land[li];
      const m = moistF[i];
      if (m <= 0.38) continue;                                       // no closed canopy on dry land
      const rOpen = riverMag ? Math.min(1, riverMag[i] / RM_FULL) : 0;
      const forest = Math.min(1, (m - 0.38) / 0.20) * (1 - rOpen);
      if (forest <= 0) continue;
      let iron = 0;
      if (ownOn && indOwner) {
        const sid = indOwner[i];
        if (sid >= 0) {
          const s2 = indById.get(sid);
          if (s2 && s2.knowledge) iron = Math.min(1, (s2.knowledge.metallurgy || 0) / clearRef);
        }
      }
      const locked = forest * (1 - iron);
      if (locked <= 0) continue;
      const crop = cap[i] * (1 - flL * locked);
      cap[i] = crop > pasture[i] ? crop : pasture[i];
    }
  }

  // ── T.FOOD_K: worked land's capacity IS the food ledger (the unification) ──
  // The formula above is an abstract PROXY (fertility × technique × access);
  // the settlement economy carries the REAL ledger — catchment harvests with
  // the dynamic climate applied, fish and herds, grain routed up the
  // hierarchy, era productivity, national policy. The city cores were unified
  // long ago (urban spikes = the economy beyond the land); this unifies the
  // COUNTRYSIDE: each settled settlement's LAND-FED capacity share
  // (s._k × landShare, in field units via the bridge) is distributed over its
  // worked catchment in proportion to the formula's own relative land quality,
  // and BLENDED over the proxy by the lever. The import share stays at the
  // core (the spike's definition), so catchment + spike sum to the economy's
  // own number — no double count. Wild land keeps the subsistence formula
  // (people outside the market economy live off the land directly). What this
  // newly delivers: famine years, blockades, trade wealth and policy reshape
  // the RURAL population map — K follows the harvest, not just the terrain.
  const fkL = T.FOOD_K || 0;
  if (fkL > 0 && world._territoryOwner && world._byId && world._onePopScale > 0) {
    const owner = world._territoryOwner, byId = world._byId, bridge = world._onePopScale;
    let sumW = world._fkSumW; if (!sumW) sumW = world._fkSumW = new Map(); else sumW.clear();
    for (let li = 0; li < nLand; li++) {
      const i = land[li]; const sid = owner[i];
      if (sid >= 0 && cap[i] > 0) sumW.set(sid, (sumW.get(sid) || 0) + cap[i]);
    }
    for (let li = 0; li < nLand; li++) {
      const i = land[li]; const sid = owner[i];
      if (sid < 0) continue;
      const s = byId.get(sid);
      if (!s || s.mode !== "settled" || !(s._k > 0)) continue;
      const W = sumW.get(sid);
      if (!(W > 0) || !(cap[i] > 0)) continue;
      const landShare = Math.max(0, Math.min(1, 1 -
        ((s._foodNet !== undefined ? s._foodNet : 0) - (s._landFood || 0)) / Math.max(1e-9, s._foodSupply || 0)));
      const ledgerK = (s._k * landShare / bridge) * (cap[i] / W);
      cap[i] = cap[i] * (1 - fkL) + ledgerK * fkL;
    }
  }

  // T.ONE_POP: the urban spikes land in the capacity field (each city core
  // carries what its economy supports beyond its land), and the field's
  // intrinsic rate becomes the census's HUMAN rate — the field owns demography
  // now, so it grows like people, not like the phase-1 peopling wave. City
  // cores use their own transition/graveyard-bent rate (saved before the bulk
  // loop, re-integrated after with their stamped r).
  const onePop = !!T.ONE_POP;
  if (onePop) applyUrbanSpikes(world, cap);
  const rBulk = onePop ? T.SETT_GROWTH : POP_GROWTH;
  // ONE_POP activation: the world of 3000 BC was already peopled to its
  // Malthusian equilibrium — the phase-1 peopling SPARKS (grow-from-cradles)
  // are the wrong initial condition once the field grows at human rates (it
  // would take tens of millennia to fill). Seed the field AT equilibrium —
  // a residence-weighted fraction of local capacity (the late-reached
  // frontier sits below it) — once, at activation (scale unset = first
  // derive hasn't run). Idempotent via max(); the same skipped-history
  // reasoning as the genesis seeds and the pre-map Neolithic wave.
  //
  // T.DAWN — the LONG DAWN (deep-prehistory genesis): >0 opens the map EARLIER
  // in its peopling trajectory, seeding the field at that FRACTION of the
  // equilibrium instead of at it. The field's own logistic growth then fills
  // each basin on its own clock — rich basins (a great river's Σcapacity)
  // cross the absolute state-viability bars (nucleation cluster mass, seat
  // size) generations before marginal ones, so the dawn of states ROLLS
  // across the map instead of firing everywhere at once (the measured
  // universal boom-bust of the cold start — docs/budget-gated-expansion.md).
  // An initial condition, not a gate: nothing during the run reads it; it
  // only chooses where in its own trajectory the world begins. The census↔
  // field bridge below is calibrated at the EQUILIBRIUM reference so mature
  // census levels are unchanged (without that, thinning the field would
  // silently inflate every mature census by 1/DAWN and de-stagger nothing).
  if (onePop && !(world._onePopScale > 0)) {
    const tArr = world.tArrival;
    const dawn = T.DAWN > 0 ? Math.min(1, T.DAWN) : 1;
    world._dawnSeed = dawn;   // read by the bridge calibration THIS tick (deriveOnePop); never persisted, never re-read
    for (let li = 0; li < nLand; li++) {
      const i = land[li];
      const residence = tArr ? (1 - Math.min(1, Math.max(0, tArr[i]))) : 0.5;
      const eq = cap[i] * (0.55 + 0.35 * residence) * dawn;   // long-peopled land presses its ceiling; the frontier sits under it
      if (eq > pop[i]) pop[i] = eq;
    }
  }
  // City cores grow at their OWN transition/graveyard-bent rate: save their
  // pre-growth values (a ~hundred entries), let the bulk loop run, then
  // re-integrate them exactly from the saved value with the stamped r.
  let corePre = null;
  if (onePop && world._urbanSpike && world._urbanSpike.size) {
    corePre = [];
    for (const [ti, e] of world._urbanSpike) if (e.r !== undefined && (e.r !== rBulk || e.sink > 0)) corePre.push(ti, pop[ti]);
  }

  // 2. Logistic growth toward capacity (in place). Under T.GROWTH_LOCAL the
  //    intrinsic rate is a LOCAL regime (see the header block): technique-
  //    graded and disease-burdened, lever-blended from the flat base.
  const gl = T.GROWTH_LOCAL || 0;
  const glOn = gl > 0 && devF;
  let tropicB = null;
  if (glOn) tropicB = _ensureTropicB(world, land, nLand);
  if (_pctx) {
    _pfGrowth(_pctx, { land, pop, cap, tropicB, tfArr, glOn, tfOn: !!tfArr, gl, rBulk, dt });
  } else
  for (let li = 0; li < nLand; li++) {
    const i = land[li];
    const k = cap[i];
    if (k <= 0) { pop[i] = 0; continue; }
    const p = pop[i];
    if (p > 0) {
      let rT = rBulk;
      if (glOn) {
        // TERRAIN_FADE: medicine collapses the tropical burden where the owner is industrial.
        const burden = R_TROPIC * tropicB[i] / (tfArr && tfArr[i] > 0 ? 1 + FADE_MED * tfArr[i] : 1);
        const reg = (R_DEV0 + R_DEVK * devF[i]) / (1 + burden);
        rT = rBulk * (1 + gl * (reg - 1));
      }
      pop[i] = p + rT * dt * p * (1 - p / k);
    }
  }
  if (corePre) {
    for (let j = 0; j < corePre.length; j += 2) {
      const ti = corePre[j], p = corePre[j + 1];
      const k = cap[ti];
      if (!(k > 0) || !(p > 0)) continue;
      const e = world._urbanSpike.get(ti);
      // the census's own form: bent logistic growth minus a FLAT graveyard
      // sink (excess mortality does not ease as the city fills)
      pop[ti] = Math.max(0, p + (e.r * (1 - p / k) - e.sink) * dt * p);
    }
  }

  // 3. Capacity-seeking migration (double-buffered → deterministic). Each tile sends
  //    a share of its people to neighbours weighted by their SPARE capacity (cap−pop):
  //    people flow from crowded land toward empty fertile land, which is what carries
  //    the cradle populations out across the map over deep time. No flow into water/
  //    zero-capacity tiles.
  //    RES-INVARIANT via SUB-STEPPING (2026-07): the per-firing share is a diffusion
  //    coefficient in disguise — D ∝ share·Δx²/dt — so a share CONSTANT at a finer
  //    grid moves people ×rn² slower across the same real land (16× at the shipped
  //    1920 default). The total share per firing therefore scales ×rn² (×1 exactly
  //    at the 240-tile reference), split into n substeps so each moves ≤
  //    MIG_SHARE_MAX of a tile — the naive single-step ×rn² is unstable (share ~1
  //    empties a tile per firing). At the reference n = 1 and migShare reduces to
  //    the original POP_MIGRATE·dt bit-for-bit (×1.0 and ÷1 are IEEE-exact), so the
  //    reference trajectory is byte-identical at every step.
  const migT = (T.POP_MIGRATE ?? POP_MIGRATE) * dt * (_rnF * _rnF);   // total share-time this firing (D ×rn² in real units); lever-owned rate
  const nSub = Math.max(1, Math.ceil(migT / MIG_SHARE_MAX));
  const migShare = migT / nSub;                             // per-substep share (= POP_MIGRATE·dt exactly at the reference)
  let nxt = world._popNext; if (!nxt || nxt.length !== N) nxt = world._popNext = new Float32Array(N);
  // Lever ≥1: the index-ordered GATHER form of this substep (bit-identical by
  // construction — docs/popfield-parallel.md §3; kernels in popFieldKernel.js,
  // banded across the pool at ≥2). 0 keeps the scatter below untouched.
  for (let it = 0; it < nSub; it++) {
    if (_pctx) {
      _pfMigrate(_pctx, pop, nxt, cap, land, nLand, tw, th, migShare);
    } else {
      nxt.set(pop);
      for (let li = 0; li < nLand; li++) {
        const i = land[li];
        const p = pop[i]; if (p <= 0) continue;
        const y = (i / tw) | 0, x = i - y * tw;
        let sumSpare = 0;
        const spare = _spare4; // reused scratch
        for (let d = 0; d < 4; d++) {
          const ny = y + DIRS4[d][1];
          if (ny < 0 || ny >= th) { spare[d] = 0; continue; }
          const nx = (x + DIRS4[d][0] + tw) % tw;
          const ni = ny * tw + nx;
          const s = cap[ni] - pop[ni];
          spare[d] = s > 0 ? s : 0;
          sumSpare += spare[d];
        }
        if (sumSpare <= 0) continue;               // hemmed in by full/empty land — nobody leaves
        const move = migShare * p;                 // leaving this tile this substep
        nxt[i] -= move;
        for (let d = 0; d < 4; d++) {
          if (spare[d] <= 0) continue;
          const ny = y + DIRS4[d][1], nx = (x + DIRS4[d][0] + tw) % tw;
          nxt[ny * tw + nx] += move * (spare[d] / sumSpare);
        }
      }
    }
    const t = pop; pop = nxt; nxt = t;           // swap buffers (per substep — next substep reads this one's result)
  }
  // ── T.LAND_WORKS: build/rot pass (see the header block above the constants).
  // Runs on this tick's final pop & cap; the multiplier is felt next firing —
  // a one-firing lag that keeps the pass order clean and deterministic.
  if (T.LAND_WORKS > 0) {
    const wk = _ensureWk(world);
    // Irrigability — static terrain: water that can be LED onto fields. A great
    // river offers its whole flow, a floodplain is the historical basin-irrigation
    // heartland, and a genuinely wet climate (paddy country) irrigates from rain.
    const irr = _ensureIrr(world, land, nLand);
    const rate = WORKS_RATE * dt, dk = WORKS_DECAY * dt;
    const tfW = (T.TERRAIN_FADE || 0) > 0 ? world._tfFade : null;   // pumps/dams irrigate beyond surface water where the owner is industrial (guarded: stale array must not leak when the lever is off)
    if (_pctx) {
      _pfWorks(_pctx, { land, pop, cap, wk, irr, tfW, tfWOn: !!tfW, leadAgri, rate, dk });
    } else
    for (let li = 0; li < nLand; li++) {
      const i = land[li];
      let a = irr[i];
      if (tfW && tfW[i] > 0) { a += FADE_PUMP * tfW[i]; if (a > 1) a = 1; }
      let w = wk[i];
      if (a <= 0 && w <= 0) continue;            // dry, unimproved ground: nothing to build or rot
      const k = cap[i];
      const press = k > 0 ? pop[i] / k : 0;
      if (a > 0 && press > WORKS_PRESS) {
        const skill = devF ? devF[i] : leadAgri;  // the technique that has actually reached this ground
        if (skill > 0.05) w += rate * (press - WORKS_PRESS) * skill * a;
      }
      const staffed = press > WORKS_STAFF ? 1 : press / WORKS_STAFF;
      if (staffed < 1) w -= dk * (1 - staffed) * w;
      wk[i] = w < 0 ? 0 : w > 1 ? 1 : w;
    }
  }
  world.popField = pop;
  world._popNext = nxt;
}

const _spare4 = new Float64Array(4);

// ── Stage B plumbing (docs/popfield-parallel.md §4) ─────────────────────────
// The gather/cap/growth/works loop bodies live in popFieldKernel.js; here is
// everything that ROUTES them: shared lazy-init ensures (one formula, used by
// the serial path and the parallel prepare alike), the SharedArrayBuffer
// arena, the per-firing owner tables, and the phase dispatchers that either
// run a kernel full-range on the sim thread (lever 1, or pool not ready) or
// signal the pool and take band 0 (lever ≥2). Pool state can never change a
// bit — only which thread executes which band — so a pool that is still
// spawning, or absent (browser), silently degrades to the same trajectory.

// Static climate burden: hot AND wet (the endemic-disease belt) — the same
// shape the state-formation gate reads off settlements (_wetTropic).
function _ensureTropicB(world, land, nLand) {
  let tropicB = world._tropicBurden;
  if (!tropicB || tropicB.length !== world.N) {
    tropicB = world._tropicBurden = new Float32Array(world.N);
    const te = world.temp, mo = world.moist;
    for (let li = 0; li < nLand; li++) {
      const i = land[li];
      const t2 = Math.max(0, Math.min(1, ((te ? te[i] : 0) - 0.62) / 0.2));
      const m2 = Math.max(0, Math.min(1, ((mo ? mo[i] : 0) - 0.55) / 0.25));
      tropicB[i] = t2 * m2;
    }
  }
  return tropicB;
}

// Irrigability — static terrain: water that can be LED onto fields (see the
// LAND_WORKS block in stepPopField for the physical story).
function _ensureIrr(world, land, nLand) {
  let irr = world._irrigable;
  if (!irr || irr.length !== world.N) {
    irr = world._irrigable = new Float32Array(world.N);
    const tFl = world.tFlood, mo = world.moist, riverMag = world.riverMag;
    for (let li = 0; li < nLand; li++) {
      const i = land[li];
      const water = riverMag ? Math.min(1, riverMag[i] / RM_FULL) : 0;
      const fl = tFl && tFl[i] ? 0.85 : 0;
      const wet = Math.max(0, ((mo ? mo[i] : 0) - 0.55) / 0.45) * 0.6;
      const v = water + fl + wet;
      irr[i] = v > 1 ? 1 : v;
    }
  }
  return irr;
}

function _ensureWk(world) {
  let wk = world.worksField;
  if (!wk || wk.length !== world.N) wk = world.worksField = new Float32Array(world.N);
  return wk;
}

// Convert a world array to a SharedArrayBuffer-backed view IN PLACE (copy,
// replace the reference — every consumer reads/writes the same memory as the
// workers from then on). Constructor-preserving (riverMag/coast are Uint8).
function _pfConv(world, ar, key) {
  const cur = world[key];
  if (!cur) { if (ar.sabs[key] !== null) { ar.sabs[key] = null; ar.gen++; } return; }
  if (cur.buffer instanceof SharedArrayBuffer) { if (ar.sabs[key] !== cur.buffer) { ar.sabs[key] = cur.buffer; ar.gen++; } return; }
  const sab = new SharedArrayBuffer(cur.byteLength);
  const view = new cur.constructor(sab);
  view.set(cur);
  world[key] = view;
  ar.sabs[key] = sab;
  ar.gen++;
}

const _PF_CONV_KEYS = ["capField", "fert", "riverMag", "coast", "relief",
  "_pastureCap", "worksField", "_tfFade", "_tropicBurden", "_irrigable",
  "_migMove", "_migSum", "_territoryOwner", "_popLand",
  "_rmBand", "_coastBand"];   // ACCESS_BAND fields (absent lever-off — _pfConv null-slots them)

// popField/_popNext are a swap PAIR over two fixed SABs: every firing's
// publish re-points the KEYS at the other buffer, so identity must be checked
// against the unordered pair {popA, popB} (parity tells workers which is
// which) — keying them like the arrays above respawned the pool every tick.
function _pfConvPair(world, ar) {
  const inPair = (b) => b === ar.sabs.popA || b === ar.sabs.popB;
  const conv1 = (key, slot, otherSlot) => {
    const cur = world[key];
    if (cur.buffer instanceof SharedArrayBuffer && inPair(cur.buffer)) return;
    const sab = new SharedArrayBuffer(cur.byteLength);
    const view = new cur.constructor(sab);
    view.set(cur);
    world[key] = view;
    // claim whichever pair slot the OTHER key does not currently hold
    const otherBuf = world[key === "popField" ? "_popNext" : "popField"];
    if (otherBuf && otherBuf.buffer === ar.sabs[slot]) ar.sabs[otherSlot] = sab;
    else ar.sabs[slot] = sab;
    ar.gen++;
  };
  conv1("popField", "popA", "popB");
  conv1("_popNext", "popB", "popA");
}

// The SAB arena (lever ≥2, node, SAB available). devField is NOT converted —
// the wave pass may swap its buffer — it gets a per-firing MIRROR instead
// (one ~N·4-byte memcpy, visible to workers via the phase handshake).
function _pfEnsureArena(world) {
  const N = world.N;
  let ar = world._pfArena;
  if (!ar || ar.N !== N) {
    ar = world._pfArena = { gen: 0, N, tw: world.tw, th: world.th, nLand: world._popLand.length,
                            tableCap: 16384, sabs: {} };
    const ds = new SharedArrayBuffer(N * 4);
    ar.sabs.devF = ds; ar.devView = new Float32Array(ds);
  }
  _pfConvPair(world, ar);
  for (const k of _PF_CONV_KEYS) _pfConv(world, ar, k);
  // ACCESS_BAND redirect: workers read riverMag/coast slots BY NAME from the
  // arena message, so the lever's array substitution must happen there too —
  // and a mid-run lever toggle must respawn the views (gen bump).
  const _ab = !!(T.ACCESS_BAND && world._rmBand);
  if (ar.accessBand !== _ab) { ar.accessBand = _ab; ar.gen++; }
  if (!ar.sabs.capT || !ar.capTView || ar.capTView.length < ar.tableCap) {
    const c = new SharedArrayBuffer(ar.tableCap * 8), g = new SharedArrayBuffer(ar.tableCap * 8);
    ar.sabs.capT = c; ar.sabs.gateT = g;
    ar.capTView = new Float64Array(c); ar.gateTView = new Float64Array(g);
    ar.gen++;
  }
  ar.nLand = world._popLand.length;
  return ar;
}

function _pfArenaMsg(ar) {
  const s = ar.sabs;
  // accessBand MUST ride the message alongside the redirected slots: the
  // worker core picks its view constructor from geom.accessBand (the band
  // fields are Float32 where the raw riverMag/coast are Uint8 — a mismatched
  // view is garbage, measured as access≡1 capacity inflation: 0.8333f's bytes
  // read as 85 through a Uint8 view). ensurePool only ever sees THIS message,
  // never the arena — the flag's one path to the workers is right here.
  return { gen: ar.gen, N: ar.N, tw: ar.tw, th: ar.th, nLand: ar.nLand,
    accessBand: !!ar.accessBand,
    sabs: { land: s._popLand, owner: s._territoryOwner, popA: s.popA, popB: s.popB,
      cap: s.capField, fert: s.fert,
      // ACCESS_BAND: the banded real-width fields substitute for the per-tile
      // reads in the capacity kernel (see ensureAccessBand) — same slots, so
      // the kernel and worker core stay untouched.
      riverMag: ar.accessBand ? s._rmBand : s.riverMag,
      coast: ar.accessBand ? s._coastBand : s.coast,
      relief: s.relief,
      devF: s.devF, pasture: s._pastureCap, worksF: s.worksField, tfArr: s._tfFade,
      tropicB: s._tropicBurden, irr: s._irrigable, mv: s._migMove, ssum: s._migSum,
      capT: s.capT, gateT: s.gateT } };
}

// Pack the per-settlement industrial scalars into dense per-sid tables — the
// kernels' stand-in for indById.get(sid): an absent sid reads 0, reproducing
// the serial "settlement missing → skip" branch exactly (0 > 1 is false and
// tfL·0 never writes the fade). Grows by rebuilding the pool (rare).
function _pfPackTables(world, ctx) {
  const byId = world._byId;
  let maxId = 0;
  if (byId) for (const id of byId.keys()) if (id > maxId) maxId = id;
  if (ctx.usePool && maxId >= ctx.arena.tableCap) {
    // Table overflow: fall back this firing, respawn the pool with room.
    while (ctx.arena.tableCap <= maxId) ctx.arena.tableCap *= 2;
    if (world._pfPool) { world._pfPool.dispose(); world._pfPool = null; }
    ctx.usePool = false; ctx.pool = null;
  }
  let capT, gateT;
  if (ctx.usePool) { capT = ctx.arena.capTView; gateT = ctx.arena.gateTView; }
  else {
    capT = world._pfCapT; gateT = world._pfGateT;
    if (!capT || capT.length <= maxId) {
      let n = 16384; while (n <= maxId) n *= 2;
      capT = world._pfCapT = new Float64Array(n);
      gateT = world._pfGateT = new Float64Array(n);
    }
  }
  capT.fill(0); gateT.fill(0);
  if (byId) for (const [id, s] of byId) { capT[id] = s._indCap || 0; gateT[id] = s._indGate || 0; }
  ctx.capT = capT; ctx.gateT = gateT;
}

// Adaptive band balance (docs/popfield-parallel.md §8.4): equalize measured
// per-band phase time by resizing the LAND ranges between firings. Band 0's
// time is accumulated JS-side around the coordinator's own kernel calls
// (ar._t0Acc); workers add theirs to hdr[H_TIME0+k]. Identity is
// banding-independent BY CONSTRUCTION, so this feedback loop — timing-driven,
// non-deterministic, different every run — can never change a bit of the
// trajectory; it only moves the finish line of the slowest band. Raw memcpy
// slices stay fixed-equal (uniform cost). EMA + 25% blend per firing keeps
// boundaries from oscillating.
// Resolve the lever: -1 = AUTO — bands from the machine's real core count
// (navigator.hardwareConcurrency exists in browsers, workers AND node 21+),
// capped at the lever's max. Any resolved count is bit-identical (the probe's
// guarantee), so AUTO is pure wall-clock adaptation: 4-core container → 4
// bands; a 2-core laptop → 2 (no oversubscription); 1 core → the lever-1
// single-thread kernel path.
let _pfAutoN = 0;
function _pfLever() {
  const raw = T.POP_FIELD_WORKERS | 0;
  if (raw !== -1) return raw;
  if (!_pfAutoN) {
    const hc = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
    _pfAutoN = Math.max(1, Math.min(8, hc | 0));
  }
  return _pfAutoN;
}

function _pfRebalance(ar, pool, nLand, N) {
  const bands = pool.bands;
  let W = ar._bandW;
  if (!W || W.length !== bands) {
    W = ar._bandW = new Float64Array(bands);
    const b = makeBands(nLand, N, bands);
    for (let k = 0; k < bands; k++) W[k] = b[k].hi - b[k].lo;
    ar._bandEma = new Float64Array(bands);
    ar._bandT = new Float64Array(bands);
    ar._t0Acc = 0;
  }
  const ema = ar._bandEma, t = ar._bandT, hdr = pool.hdr;
  let all = ar._t0Acc > 0;
  t[0] = ar._t0Acc;
  for (let k = 1; k < bands; k++) { t[k] = hdr[PFK.H_TIME0 + k]; if (!(t[k] > 0)) all = false; }
  ar._t0Acc = 0;
  for (let k = 1; k < bands; k++) hdr[PFK.H_TIME0 + k] = 0;
  // Settle-in guard: discard the pool's first few samples (spawn/convert
  // transients) and any absurd one (a GC pause inside a phase) — feeding
  // those to the EMA made the balancer chase ghosts for ~20 firings.
  ar._balN = (ar._balN || 0) + 1;
  if (ar._balN <= 4) all = false;
  else if (all) { for (let k = 0; k < bands; k++) if (t[k] > 200) { all = false; break; } }
  if (all) {
    for (let k = 0; k < bands; k++) ema[k] = ema[k] > 0 ? 0.7 * ema[k] + 0.3 * t[k] : t[k];
    let sum = 0;
    for (let k = 0; k < bands; k++) sum += W[k] / ema[k];
    const minW = Math.max(64, nLand >> 6);
    let acc = 0;
    for (let k = 0; k < bands; k++) {
      const target = (nLand * (W[k] / ema[k])) / sum;
      let w = W[k] + 0.25 * (target - W[k]);
      if (w < minW) w = minW;
      W[k] = w; acc += w;
    }
    const scale = nLand / acc;
    for (let k = 0; k < bands; k++) W[k] *= scale;
  }
  const ranges = [];
  let lo = 0;
  for (let k = 0; k < bands; k++) {
    const hi = k === bands - 1 ? nLand : Math.min(nLand, lo + Math.round(W[k]));
    ranges.push({ lo, hi: hi < lo ? lo : hi, rawLo: Math.floor((N * k) / bands), rawHi: Math.floor((N * (k + 1)) / bands) });
    lo = ranges[k].hi;
  }
  writeBands(pool.ctrl, bands, ranges);
  return ranges[0];
}

// Build the per-firing parallel context. Never affects the trajectory — only
// which code path computes the identical numbers.
function _pfPrepare(world, land, nLand, devF) {
  const N = world.N;
  // Shared lazy inits, hoisted so kernels (and workers) always find them.
  _ensureTropicB(world, land, nLand);
  _ensureIrr(world, land, nLand);
  _ensureWk(world);
  let mv = world._migMove; if (!mv || mv.length !== N) mv = world._migMove = new Float64Array(N);
  let ssum = world._migSum; if (!ssum || ssum.length !== N) ssum = world._migSum = new Float64Array(N);
  const lever = _pfLever();
  // Node always qualifies (worker_threads); a browser qualifies only when the
  // page is cross-origin isolated (COOP/COEP — the SharedArrayBuffer gate).
  // The browser additionally requires running INSIDE a worker (the app's sim
  // thread): awaitPhase blocks in Atomics.wait, which browsers forbid on the
  // main thread — a main-thread sim keeps the identical lever-1 path.
  const wantPool = lever >= 2 && typeof SharedArrayBuffer !== "undefined" &&
    ((typeof process !== "undefined" && !!(process.versions && process.versions.node)) ||
     (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated === true &&
      typeof window === "undefined"));
  const ctx = { usePool: false, pool: null, arena: null, nLand, band0: null, mv, ssum, capT: null, gateT: null, devF: devF || null };
  if (wantPool) {
    const ar = _pfEnsureArena(world);
    ctx.arena = ar;
    ctx.mv = world._migMove; ctx.ssum = world._migSum;   // conversion may have replaced them
    let pool = world._pfPool;
    if (pool && (pool.bands !== lever || pool.gen !== ar.gen || pool.dead)) { pool.dispose(); pool = world._pfPool = null; }
    if (!pool) pool = world._pfPool = ensurePool(world, _pfArenaMsg(ar), lever);
    if (pool.readyNow()) {
      if (!pool._announced) { pool._announced = true; console.log(`[popField] worker pool engaged: ${pool.bands} bands`); }   // one line per pool — the in-app/in-tool proof the parallel path is live (gates grep for it)
      ctx.usePool = true; ctx.pool = pool;
      ctx.band0 = _pfRebalance(ar, pool, ar.nLand, N);
      if (devF) { ar.devView.set(world.devField); ctx.devF = ar.devView; }   // per-firing mirror (wave pass may swap devField's buffer)
    }
  }
  _pfPackTables(world, ctx);
  return ctx;
}

function _pfCheck(ctx) {
  if (ctx.pool && ctx.pool.dead) {
    throw new Error("popField worker pool died mid-phase — in-place phases may be partially applied; rerun (the trajectory of THIS run cannot be trusted)");
  }
}
const _pfParity = (ctx, popBuf) => (popBuf.buffer === ctx.arena.sabs.popA ? 0 : 1);

function _pfCap(ctx, world, o) {
  const ko = { land: o.land, fert: o.fert, riverMag: o.riverMag, coast: o.coast, relief: o.relief,
    cap: o.cap, devF: ctx.devF, pasture: o.pasture, worksF: o.worksF, tfArr: o.tfArr,
    owner: o.ownOn ? world._territoryOwner : null, capT: ctx.capT, gateT: ctx.gateT,
    hasRiver: !!o.riverMag, hasCoast: !!o.coast, hasRelief: !!o.relief,
    ownerOn: o.ownOn, indOn: o.indOn, tfL: o.tfL, worksOn: o.worksOn, worksK: o.worksK,
    devOn: !!ctx.devF, capPerFert: o.capPerFert, accessDev: o.accessDev, dev: o.dev };
  if (ctx.usePool) {
    const h = ctx.pool.hdr;
    h[PFK.H_CAPPERFERT] = ko.capPerFert; h[PFK.H_ACCESSDEV] = ko.accessDev; h[PFK.H_DEV] = ko.dev;
    h[PFK.H_TFL] = ko.tfL; h[PFK.H_INDON] = ko.indOn ? 1 : 0; h[PFK.H_WORKSON] = ko.worksOn ? 1 : 0;
    h[PFK.H_WORKSK] = ko.worksK; h[PFK.H_DEVON] = ko.devOn ? 1 : 0; h[PFK.H_OWNERON] = ko.ownerOn ? 1 : 0;
    h[PFK.H_HASRIVER] = ko.hasRiver ? 1 : 0; h[PFK.H_HASCOAST] = ko.hasCoast ? 1 : 0; h[PFK.H_HASRELIEF] = ko.hasRelief ? 1 : 0;
    signalPhase(ctx.pool, PFK.OP_CAP, _pfParity(ctx, world.popField));
    const t0 = performance.now();
    PFK.capBand(ko, ctx.band0.lo, ctx.band0.hi);
    ctx.arena._t0Acc += performance.now() - t0;
    awaitPhase(ctx.pool); _pfCheck(ctx);
  } else PFK.capBand(ko, 0, ctx.nLand);
}

function _pfGrowth(ctx, o) {
  const ko = { land: o.land, pop: o.pop, cap: o.cap, devF: ctx.devF, tropicB: o.tropicB, tfArr: o.tfArr,
    glOn: o.glOn, tfOn: o.tfOn, gl: o.gl, rBulk: o.rBulk, dt: o.dt };
  if (ctx.usePool) {
    const h = ctx.pool.hdr;
    h[PFK.H_RBULK] = ko.rBulk; h[PFK.H_GL] = ko.gl; h[PFK.H_GLON] = ko.glOn ? 1 : 0;
    h[PFK.H_DT] = ko.dt; h[PFK.H_TFON] = ko.tfOn ? 1 : 0; h[PFK.H_DEVON] = ctx.devF ? 1 : 0;
    signalPhase(ctx.pool, PFK.OP_GROWTH, _pfParity(ctx, o.pop));
    const t0 = performance.now();
    PFK.growthBand(ko, ctx.band0.lo, ctx.band0.hi);
    ctx.arena._t0Acc += performance.now() - t0;
    awaitPhase(ctx.pool); _pfCheck(ctx);
  } else PFK.growthBand(ko, 0, ctx.nLand);
}

function _pfMigrate(ctx, pop, nxt, cap, land, nLand, tw, th, migShare) {
  const oa = { land, pop, cap, mv: ctx.mv, ssum: ctx.ssum, tw, th, migShare };
  const ob = { land, pop, nxt, cap, mv: ctx.mv, ssum: ctx.ssum, tw, th };
  if (ctx.usePool) {
    const par = _pfParity(ctx, pop);
    ctx.pool.hdr[PFK.H_MIGSHARE] = migShare;
    signalPhase(ctx.pool, PFK.OP_MIG_A, par);
    let t0 = performance.now();
    PFK.migCopyBand(nxt, pop, ctx.band0.rawLo, ctx.band0.rawHi);
    PFK.mig6aBand(oa, ctx.band0.lo, ctx.band0.hi);
    ctx.arena._t0Acc += performance.now() - t0;
    awaitPhase(ctx.pool); _pfCheck(ctx);
    signalPhase(ctx.pool, PFK.OP_MIG_B, par);
    t0 = performance.now();
    PFK.mig6bBand(ob, ctx.band0.lo, ctx.band0.hi);
    ctx.arena._t0Acc += performance.now() - t0;
    awaitPhase(ctx.pool); _pfCheck(ctx);
  } else {
    PFK.migCopyBand(nxt, pop, 0, pop.length);
    PFK.mig6aBand(oa, 0, nLand);
    PFK.mig6bBand(ob, 0, nLand);
  }
}

function _pfWorks(ctx, o) {
  const ko = { land: o.land, pop: o.pop, cap: o.cap, wk: o.wk, irr: o.irr, tfW: o.tfW,
    tfWOn: o.tfWOn, devF: ctx.devF, devOn: !!ctx.devF, leadAgri: o.leadAgri, rate: o.rate, dk: o.dk };
  if (ctx.usePool) {
    const h = ctx.pool.hdr;
    h[PFK.H_RATE] = ko.rate; h[PFK.H_DK] = ko.dk; h[PFK.H_LEADAGRI] = ko.leadAgri;
    h[PFK.H_TFWON] = ko.tfWOn ? 1 : 0; h[PFK.H_DEVON] = ctx.devF ? 1 : 0;
    signalPhase(ctx.pool, PFK.OP_WORKS, _pfParity(ctx, o.pop));
    const t0 = performance.now();
    PFK.worksBand(ko, ctx.band0.lo, ctx.band0.hi);
    ctx.arena._t0Acc += performance.now() - t0;
    awaitPhase(ctx.pool); _pfCheck(ctx);
  } else PFK.worksBand(ko, 0, ctx.nLand);
}

// Static list of LAND tile indices (ascending, so the field loops keep their exact
// iteration order). Terrain is fixed, so this is built once and reused.
function buildLandList(world) {
  const { N, elev } = world;
  let n = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) n++;
  const a = new Int32Array(n); let k = 0;
  for (let i = 0; i < N; i++) if (elev[i] > 0) a[k++] = i;
  return a;
}

// Total field population — for the demographic anchor / validation.
export function popFieldTotal(world) {
  const p = world.popField; if (!p) return 0;
  let s = 0; for (let i = 0; i < p.length; i++) s += p[i];
  return s;
}

// ── T.ONE_POP: the city is a concentration of the field (one population, B) ──
// docs/one-population.md slice B. The field takes OWNERSHIP of demography:
//   • its intrinsic rate becomes the census's human rate (T.SETT_GROWTH, with
//     the demographic-transition/urban-graveyard bend stamped at each city's
//     core tile) instead of the phase-1 peopling rate;
//   • each settlement's home tile carries an URBAN SPIKE of carrying capacity
//     = what its ECONOMY supports beyond what its land feeds (imports, the
//     granary, housing: s._k minus the catchment's terrain capacity) — the
//     concentration cities ARE, and the field's own capacity-seeking
//     migration into that spike IS urbanization (the census-side drift and
//     the census logistic both retire);
//   • s.people becomes a DERIVED READ: the field over the settlement's
//     catchment, in census units via a FIXED bridge scalar computed once at
//     activation (median census / median field-region — the POW_FIELD
//     anchoring pattern, frozen and persisted so it is a unit conversion,
//     never a second dynamic).
// A settlement dying no longer erases people — the region's people outlive
// the town, on the land, where they always were.

// ── T.URBAN_FOOTPRINT: resolution-invariant urban core (ONE_POP) ──────────────
// popField stores people PER REAL AREA (capPerFert/seedPop ÷rn²), so the SINGLE
// core tile holds ~1/rn² the people at a finer grid and the urban SHARE collapses
// ∝1/rn² with resolution (measured ~33% at tw=240 → ~10% at tw=480). When on, the
// core becomes a fixed REAL DISK, so the concentration, the capacity spike and the
// measurement all span the same real footprint at any grid.
//
// Urban core radius in tiles: a fixed REAL footprint. 0 at the tw=240 reference
// (rn=1 → single tile, byte-identical) AND whenever the lever/RES_INVARIANT_POP is
// off; grows with rNormPop so the city spans the same real area at finer grids.
// (Reuses the computeBuildableArea/computeWaterAccess round(rn) real-neighbourhood
// normalisation, −1 so the reference stays a single tile.)
export function urbanCoreR(world) {   // exported for the CITY_AT_BIRTH site pass (crystallize) — the mint threshold must read the SAME disk the census measures
  return (T.URBAN_FOOTPRINT && T.RES_INVARIANT_POP) ? Math.max(0, Math.round(rNormPop(world)) - 1) : 0;
}

// Sum popField over the urban-core DISK: the (2R+1)² tiles Chebyshev-radius-R
// around (cx,cy), x-wrapped and y-clamped, skipping empties (pf<=0). R<=0 returns
// the EXACT single-tile read the pre-footprint code used, so the measurement and
// target are byte-identical at the reference. Owner-agnostic (the footprint
// REFERENCE reads all people on the real disk; the people MOVED by urbanConcentrate
// stay owner-restricted and strictly conserved — see change note there).
export function diskSum(pf, tw, th, cx, cy, R) {
  if (R <= 0) return pf[cy * tw + ((cx % tw) + tw) % tw];
  let sum = 0;
  const y0 = Math.max(0, cy - R), y1 = Math.min(th - 1, cy + R);
  for (let y = y0; y <= y1; y++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = ((cx + dx) % tw + tw) % tw;
      const v = pf[y * tw + x];
      if (v > 0) sum += v;
    }
  }
  return sum;
}

/** Apply the urban spikes (built by deriveOnePop) into this pass's capField.
 *  Under T.URBAN_FOOTPRINT (R>0) each spike's capacity is spread EVENLY over the
 *  (2R+1)² HABITABLE (elev>0) disk tiles around its core, so capacity co-locates
 *  with the population urbanConcentrate spreads over the same disk (pop≈cap on each
 *  footprint tile, so the field pass neither crashes nor expels the crowd). R<=0
 *  keeps the single-tile add EXACTLY (byte-identical). */
function applyUrbanSpikes(world, cap) {
  const sp = world._urbanSpike;
  if (!sp) return;
  const R = urbanCoreR(world);
  if (R <= 0) { for (const [ti, e] of sp) cap[ti] += e.k; return; }
  const tw = world.tw, th = world.th, elev = world.elev;
  for (const [ti, e] of sp) {
    if (!(e.k > 0)) { cap[ti] += e.k; continue; }   // 0/neg spike: single-tile no-op, no disk needed
    const cy = (ti / tw) | 0, cx = ti - cy * tw;
    const y0 = Math.max(0, cy - R), y1 = Math.min(th - 1, cy + R);
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let dx = -R; dx <= R; dx++) {
      if (elev[y * tw + ((cx + dx) % tw + tw) % tw] > 0) n++;
    }
    if (n <= 0) { cap[ti] += e.k; continue; }        // no habitable disk tile → fall back to the core
    const share = e.k / n;
    for (let y = y0; y <= y1; y++) for (let dx = -R; dx <= R; dx++) {
      const t2 = y * tw + ((cx + dx) % tw + tw) % tw;
      if (elev[t2] > 0) cap[t2] += share;
    }
  }
}

// ── T.URBAN_AGGLOM: agglomeration↔congestion urban concentration (ONE_POP) ──
// The Zipf blocker is that generic 4-neighbour diffusion is throughput-limited
// AND flows the WRONG way (toward EMPTY land — the peopling of a frontier),
// whereas urbanization is anti-diffusive: people concentrate UP the density
// gradient into the productive city, braked by congestion. This moves a
// region's people between its CORE tile and its own countryside toward an
// agglomeration target (a bigger economy pulls harder), the target sublinear
// in economic capacity because congestion cost rises super-linearly with
// density — so equilibrium size ∝ capacity^β, β<1, which compresses the
// heavy-tailed (−1.5) import economy toward the −0.8..−1.2 city envelope.
// CONSERVATIVE: people are only ever moved town↔country within the SAME
// region's owned tiles, never created or destroyed — the region's census total
// is unchanged, only its rural/urban split. Deterministic box walk, no RNG.
const URBAN_MAXSHARE = 0.9;  // a city holds at most this share of its region's people (the hinterland bound)
const URBAN_GMAXSHARE = 0.97; // under γ the hinterland bound is a pure CONSERVATION guard (the graveyard, not the cap, limits)
const GRAVEYARD_PMAX = 12;   // cap on the density-graded graveyard multiplier (a transient spike can't kill a core in one pass)
const URBAN_CONC_R = 6;      // the urban hinterland radius (tiles) people draw in from
const URBAN_CONC_LAMBDA = 0.2;  // relaxation toward the target per tick (convergence rate, not the equilibrium)
const URBAN_CONC_MAXFRAC = 0.5; // cap per-tick flux at half the available side (no single-tick emptying)
const URBAN_CONC_MAXFRAC_G = 0.12; // under γ the target is the RAW economy (large) → a gentler per-tick flux so the flow can't strip the countryside in a rush toward it (the graveyard equilibrium is reached over many ticks)

// Deposit EXACTLY `amount` people across tiles[0..n) weighted by w[0..n)
// (sum sumW>0): all but the last take their proportional share, the last takes the
// running remainder — so Σ deposits === amount to the ULP and every disk branch of
// urbanConcentrate conserves. (The single-core code conserved by moving the exact
// accumulated total to ONE counter-tile; the disk has many tiles on both sides, so
// it needs this remainder trick to stay exact.) Deterministic; n>=1 required.
const _spreadTiles = new Int32Array(4096);   // scratch (max needed: hinterland box 169, or a disk (2R+1)² — R<=31 fits)
const _spreadW = new Float64Array(4096);
function spreadExact(pf, tiles, w, n, sumW, amount) {
  let dep = 0;
  for (let j = 0; j < n - 1; j++) { const m = amount * (w[j] / sumW); pf[tiles[j]] += m; dep += m; }
  pf[tiles[n - 1]] += amount - dep;
}

// Deposit `amount` across the OWNED disk tiles (Chebyshev R of (cx,cy)), weighted
// by spare capacity (cap−pf), even-split if none has spare, onto the core tile if
// the disk owns nothing — always conserving (Σ === amount). Deterministic walk.
function depositAcrossDisk(world, owner, sid, coreTi, cx, cy, R, amount) {
  if (!(amount > 0)) return;
  const pf = world.popField, cap = world.capField, tw = world.tw, th = world.th;
  const y0 = Math.max(0, cy - R), y1 = Math.min(th - 1, cy + R);
  let sumSpare = 0, owned = 0;
  for (let y = y0; y <= y1; y++) for (let dx = -R; dx <= R; dx++) {
    const ti = y * tw + ((cx + dx) % tw + tw) % tw;
    if (owner[ti] !== sid) continue;
    owned++; const s = cap[ti] - pf[ti]; if (s > 0) sumSpare += s;
  }
  if (owned <= 0) { pf[coreTi] += amount; return; }   // disk owns nothing → the core absorbs it
  const bySpare = sumSpare > 0;
  let n = 0, sumW = 0;
  for (let y = y0; y <= y1; y++) for (let dx = -R; dx <= R; dx++) {
    const ti = y * tw + ((cx + dx) % tw + tw) % tw;
    if (owner[ti] !== sid) continue;
    const s = cap[ti] - pf[ti];
    if (bySpare) { if (s <= 0) continue; _spreadTiles[n] = ti; _spreadW[n] = s; sumW += s; n++; }
    else { _spreadTiles[n] = ti; _spreadW[n] = 1; sumW += 1; n++; }   // no spare anywhere → even split
  }
  spreadExact(pf, _spreadTiles, _spreadW, n, sumW, amount);
}

/** Move `delta` field-people between the urban CORE and its OWN countryside
 *  (owner==sid, within the hinterland box), conservatively. +pull in, −push out.
 *  R<=0: the core is the single tile coreTi (byte-identical to the pre-footprint
 *  code). R>0 (T.URBAN_FOOTPRINT): the core is the OWNED DISK of Chebyshev radius R
 *  around (cx,cy) — the hinterland excludes the whole disk, and the moved people are
 *  spread across / drawn from the disk's tiles by spare capacity / density. People
 *  OUT === people IN in every branch (a strict conservation invariant). */
function urbanConcentrate(world, owner, sid, cx, cy, coreTi, delta, maxFrac, R) {
  if (maxFrac === undefined) maxFrac = URBAN_CONC_MAXFRAC;
  const pf = world.popField, tw = world.tw, th = world.th;
  const x0 = cx - URBAN_CONC_R, x1 = cx + URBAN_CONC_R;
  const y0 = Math.max(0, cy - URBAN_CONC_R), y1 = Math.min(th - 1, cy + URBAN_CONC_R);
  if (!(R > 0)) {
    // ── single-tile core: EXACTLY the pre-footprint code (byte-identical) ──
    if (delta > 0) {
      // AGGLOMERATION: pull the hinterland in. Sum owned countryside people, then
      // drain the same fraction from each (proportional) up to the flux cap.
      let avail = 0;
      for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
        const x = ((xx % tw) + tw) % tw, ti = y * tw + x;
        if (ti === coreTi || owner[ti] !== sid) continue;
        if (pf[ti] > 0) avail += pf[ti];
      }
      if (avail <= 0) return;
      const take = Math.min(delta, avail * maxFrac);
      const frac = take / avail;
      let moved = 0;
      for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
        const x = ((xx % tw) + tw) % tw, ti = y * tw + x;
        if (ti === coreTi || owner[ti] !== sid || pf[ti] <= 0) continue;
        const m = pf[ti] * frac; pf[ti] -= m; moved += m;
      }
      pf[coreTi] += moved;
    } else if (delta < 0) {
      // CONGESTION: push the crowd back out, spread over owned countryside
      // proportional to each tile's SPARE capacity (people go where there is room).
      const push = Math.min(-delta, pf[coreTi] * maxFrac);
      if (push <= 0) return;
      const cap = world.capField;
      let room = 0;
      for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
        const x = ((xx % tw) + tw) % tw, ti = y * tw + x;
        if (ti === coreTi || owner[ti] !== sid) continue;
        const s = cap[ti] - pf[ti]; if (s > 0) room += s;
      }
      if (room <= 0) return;
      let moved = 0;
      for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
        const x = ((xx % tw) + tw) % tw, ti = y * tw + x;
        if (ti === coreTi || owner[ti] !== sid) continue;
        const s = cap[ti] - pf[ti]; if (s <= 0) continue;
        const m = push * (s / room); pf[ti] += m; moved += m;
      }
      pf[coreTi] -= moved;
    }
    return;
  }
  // ── R>0: the core is the OWNED DISK (Chebyshev radius R of (cx,cy)) ──
  const cap = world.capField;
  const inDisk = (dx, dy) => (dx < 0 ? -dx : dx) <= R && (dy < 0 ? -dy : dy) <= R;
  const dy0 = Math.max(0, cy - R), dy1 = Math.min(th - 1, cy + R);
  if (delta > 0) {
    // AGGLOMERATION: drain owned hinterland OUTSIDE the disk (proportional, flux-
    // capped), deposit the drained total across the owned disk tiles by spare cap.
    let avail = 0;
    for (let y = y0; y <= y1; y++) { const dy = y - cy;
      for (let xx = x0; xx <= x1; xx++) { if (inDisk(xx - cx, dy)) continue;
        const ti = y * tw + ((xx % tw) + tw) % tw;
        if (owner[ti] !== sid) continue;
        if (pf[ti] > 0) avail += pf[ti];
      }
    }
    if (avail <= 0) return;
    const take = Math.min(delta, avail * maxFrac);
    const frac = take / avail;
    let moved = 0;
    for (let y = y0; y <= y1; y++) { const dy = y - cy;
      for (let xx = x0; xx <= x1; xx++) { if (inDisk(xx - cx, dy)) continue;
        const ti = y * tw + ((xx % tw) + tw) % tw;
        if (owner[ti] !== sid || pf[ti] <= 0) continue;
        const m = pf[ti] * frac; pf[ti] -= m; moved += m;
      }
    }
    depositAcrossDisk(world, owner, sid, coreTi, cx, cy, R, moved);   // Σ deposit === moved (conserved)
  } else if (delta < 0) {
    // CONGESTION: remove the crowd from the owned disk (proportional to pf),
    // deposit into owned hinterland OUTSIDE the disk by spare capacity.
    let diskPop = 0;
    for (let y = dy0; y <= dy1; y++) for (let dx = -R; dx <= R; dx++) {
      const ti = y * tw + ((cx + dx) % tw + tw) % tw;
      if (owner[ti] !== sid || pf[ti] <= 0) continue;
      diskPop += pf[ti];
    }
    const push = Math.min(-delta, diskPop * maxFrac);
    if (push <= 0) return;
    // collect the hinterland sinks FIRST (room>0); if none, move nothing (conserve)
    let n = 0, room = 0;
    for (let y = y0; y <= y1; y++) { const dy = y - cy;
      for (let xx = x0; xx <= x1; xx++) { if (inDisk(xx - cx, dy)) continue;
        const ti = y * tw + ((xx % tw) + tw) % tw;
        if (owner[ti] !== sid) continue;
        const s = cap[ti] - pf[ti]; if (s <= 0) continue;
        _spreadTiles[n] = ti; _spreadW[n] = s; room += s; n++;
      }
    }
    if (n <= 0 || room <= 0) return;
    // remove `push` from the disk proportional to pf, accumulate the REAL removed
    const frac = push / diskPop;
    let removed = 0;
    for (let y = dy0; y <= dy1; y++) for (let dx = -R; dx <= R; dx++) {
      const ti = y * tw + ((cx + dx) % tw + tw) % tw;
      if (owner[ti] !== sid || pf[ti] <= 0) continue;
      const m = pf[ti] * frac; pf[ti] -= m; removed += m;
    }
    spreadExact(pf, _spreadTiles, _spreadW, n, room, removed);   // Σ deposit === removed (conserved)
  }
}

/**
 * The ONE_POP derive, called once per tick after the field pass (index.js):
 * accumulate each settlement's catchment field people + terrain capacity,
 * refresh the bridge scalar (once), set s.people from the field, and stamp
 * next pass's urban spikes (economy-beyond-land capacity + the city core's
 * transition-bent growth rate).
 */
export function deriveOnePop(world) {
  if (!T.ONE_POP || !T.POP_FIELD || !world.popField) return;
  const pf = world.popField, cap = world.capField, owner = world._territoryOwner, tw = world.tw;
  if (!owner) return;
  const spikes = world._urbanSpike || (world._urbanSpike = new Map());
  const accP = new Map();
  for (let i = 0; i < world.N; i++) {
    const sid = owner[i];
    if (sid < 0) continue;
    if (pf[i] > 0) accP.set(sid, (accP.get(sid) || 0) + pf[i]);
  }
  // The bridge scalar: median census per median field-region, frozen at
  // activation (persisted). A pure unit conversion between the economy's
  // calibrated census magnitudes and the field's people — the distribution
  // and all dynamics are the field's.
  // T.BRIDGE_GLOBAL: measure the bridge GLOBALLY (Σ census ÷ Σ field people over all
  // land) instead of as a median over per-settlement CATCHMENTS. Both sides are then
  // pure people-totals and the geometry drops out. The catchment-median form is
  // resolution-CONTAMINATED: a catchment's extent is grown in TILES, so at 2× grid it
  // covers only ~0.64× the real area it covers at the reference (measured 25.6% of land
  // → 16.5%, mean 37.8t → 100.1t where 4× is parity). The divisor therefore shrinks with
  // grid fineness and the bridge inflates (measured 0.0013 → 0.0041, 3.15×), which
  // shrinks every FOOD_K ledger share (ledgerK = s._k·landShare / bridge), which lowers
  // capacity, which lowers the field population the bridge is measured against — a
  // FEEDBACK that amplifies an underlying 1.33× capacity gap into the measured 2.22×
  // (A/B: Σcap 7.51M/3.38M with FOOD_K on, 5.89M/4.44M off — the ledger RAISES capacity
  // at the reference and LOWERS it at the app grid, the signature of a per-entity
  // quantity spread over a resolution-dependent tile count).
  // Default OFF: this changes the calibrated bridge magnitude at every grid, so it needs
  // the full multi-seed gate before it can be the default.
  if (!(world._onePopScale > 0) && T.BRIDGE_GLOBAL) {
    let csTot = 0, fsTot = 0;
    for (const s of world.settlements) if (s.mode === "settled" && s.people > 0) csTot += s.people;
    for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) fsTot += pf[i];
    if (csTot > 0 && fsTot > 0) world._onePopScale = Math.max(1e-6, csTot / fsTot);
  }
  if (!(world._onePopScale > 0)) {
    const cs = [], fs = [];
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const f = accP.get(s.id) || 0;
      if (f > 0 && s.people > 0) { cs.push(s.people); fs.push(f); }
    }
    cs.sort((a, b) => a - b); fs.sort((a, b) => a - b);
    // An EMPTY world calibrates on nothing and must leave the bridge UNSET
    // ("unset ≡ compute at first derive" — the persist contract), retrying
    // each derive until settlements exist. The old `: 1` fallback froze a
    // garbage unit at the first derive of a settlement-less dawn (measured
    // under DAWN_LIVE: 1 × dawnSeed 0.35 = a bridge 175× the reference, an
    // 11,000-census first city and a 600-step famine crash). At the old
    // defaults cradles exist by the first derive, so the fallback never
    // fired and this is byte-identical there.
    if (cs.length) {
      world._onePopScale = Math.max(1e-6, cs[cs.length >> 1] / Math.max(1e-6, fs[fs.length >> 1]));
      // T.DAWN: the bridge is a unit conversion calibrated at the MALTHUSIAN
      // REFERENCE (the field the world matures toward). Under a dawn seed the
      // field at activation is dawn× that reference, so the raw median ratio
      // above is 1/dawn too high — correct it, or every mature census would be
      // inflated by 1/dawn and the dawn's staggering would cancel out of the
      // state-viability mass (basin × census/field). At dawn 1: ×1, unchanged.
      if (world._dawnSeed > 0 && world._dawnSeed < 1) world._onePopScale *= world._dawnSeed;
    }
  }
  // (With nothing settled — the DAWN_LIVE window — the bridge stays unset and
  // every consumer below sits inside settlement loops that simply don't run;
  // the spike clear still fires, so no stale site capacity survives.)
  const scale = world._onePopScale;
  // T.URBAN_FOOTPRINT: the urban core's real radius (tiles). 0 (default / reference
  // grid) ⇒ the disk reads/moves collapse to the single core tile, byte-identical.
  const coreR = urbanCoreR(world);
  const agglom = T.URBAN_AGGLOM > 0;
  // GROUNDED SLOPE (T.URBAN_GAMMA): the size↔economy elasticity is set by the
  // urban graveyard, not a free lever. Excess mortality rises super-linearly
  // with the core's own density (sink ×= (density/medianDensity)^γ below), so a
  // city's equilibrium — where in-migration balances excess deaths — is
  // intrinsically SUBLINEAR in economic capacity: size ∝ capacity^(1/(1+γ)),
  // the same −1.5→envelope compression β used to IMPOSE, now falling out of a
  // real death rate. So the flow chases the RAW economy (βeff=1, the target
  // undivided) and the density mortality does the compressing — a density-
  // graded SOFT limiter in place of the hard 90%-hinterland cap that pinned
  // over-concentrated seeds to one uniform ceiling.
  const gamma = agglom ? Math.max(0, T.URBAN_GAMMA) : 0;
  const useGamma = gamma > 0;
  // The target's economy exponent. Off γ it is the β-SHARE compression (β<1,
  // the pre-graveyard mechanism). Under γ the flow chases the RAW economy
  // (β=1, the target undivided) and the density graveyard — not this exponent —
  // does the compressing, so the slope has ONE home (the mortality elasticity),
  // not a β dialed to the gate. (Measured: amplifying the target β>1 to steepen
  // the well-behaved seeds shatters the over-concentrated one — see docs.)
  const betaEff = useGamma ? 1 : T.URBAN_BETA;
  // AGGLOMERATION↔CONGESTION distribution (T.URBAN_AGGLOM). The TOTAL urban
  // population is set by the ECONOMY — Σ import-fed capacity, i.e. how many
  // non-farmers the food surplus can support — so urbanization is an OUTPUT,
  // not a knob. That total is DISTRIBUTED across cities by a β-COMPRESSED share
  // of each one's import capacity: share_i = pull_i^β / Σ pull^β. β<1
  // (congestion: crowding cost rising super-linearly with density) compresses
  // the heavy-tailed (−1.5) import economy toward the −0.8..−1.2 city envelope
  // WITHOUT changing the total (Σ share = 1 for any β) — so the slope (β) and
  // the urbanization level (economy) cannot fight. Pre-pass sums the pulls, and
  // (under γ) collects the importing cores' densities for the median reference.
  let sumK = 0, sumKb = 0;
  const coreDens = useGamma ? [] : null;
  if (agglom) {
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const isr = Math.max(0, Math.min(1,
        ((s._foodNet !== undefined ? s._foodNet : 0) - (s._landFood || 0)) / Math.max(1e-9, s._foodSupply || 0)));
      const kb = ((s._k || 0) * isr) / scale;
      if (kb > 0) {
        sumK += kb; sumKb += Math.pow(kb, betaEff);
        if (coreDens) {
          const cti = (s.pos.y | 0) * tw + (s.pos.x | 0);
          if (cti >= 0 && cti < world.N && pf[cti] > 0) coreDens.push(pf[cti]);
        }
      }
    }
  }
  // Median importing-core density — the scale-free reference the graveyard
  // penalty is measured against (a mean-field congestion term, recomputed each
  // tick, no persisted state and no fitted constant). A denser-than-typical core
  // pays >1× the excess mortality, so its equilibrium size is sublinear in its
  // economy — which is what pulls the over-concentrated seed's cores off the
  // hinterland cap and lets their economies differentiate again.
  let medDens = 0;
  if (coreDens && coreDens.length) { coreDens.sort((a, b) => a - b); medDens = coreDens[coreDens.length >> 1]; }
  spikes.clear();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (ti < 0 || ti >= world.N) continue;
    const f = accP.get(s.id) || 0;
    // The IMPORT-FED share of the settlement's carrying capacity, in field
    // units — what its market feeds from BEYOND its own land (hierarchy grain:
    // _foodNet − _landFood, one food model). A self-fed farm town concentrates
    // nothing; a grain-importing hub concentrates what it ships in — the
    // heavy-tailed (−1.5) import economy gives the cores their size ORDER.
    const importShare = Math.max(0, Math.min(1,
      ((s._foodNet !== undefined ? s._foodNet : 0) - (s._landFood || 0)) / Math.max(1e-9, s._foodSupply || 0)));
    const kBeyond = ((s._k || 0) * importShare) / scale;
    // AGGLOMERATION↔CONGESTION (T.URBAN_AGGLOM): relax the core tile toward an
    // agglomeration target that is SUBLINEAR in the economic pull (β<1, the
    // congestion compression), conservatively concentrating the region's own
    // countryside into (or back out of) its city. Runs BEFORE the core read so
    // s._urbanPop sees the concentrated field. Non-importers (kBeyond=0) have
    // no target — they stay rural, as the ontology says.
    let uTarget = 0;
    if (agglom && kBeyond > 0 && sumKb > 0) {
      // This city's β-compressed share of the economy's total urban capacity
      // (βeff=1 under γ: the target is the RAW economy — the density graveyard,
      // not this exponent, does the compressing).
      const share = Math.pow(kBeyond, betaEff) / sumKb;
      uTarget = T.URBAN_AGGLOM * (1 + T.URBAN_IND * (s._indGate || 0)) * sumK * share;   // AGGLOM = the fraction of import-fed capacity that concentrates in the core; ×(1+URBAN_IND·indGate) = the emergent industrial urban transition
      // A city lives WITHIN its hinterland: cap the target at a share of the
      // region's own people. Under β-share this is the binding limiter (and, for
      // over-concentrated seeds, a UNIFORMISING one — the whole top set pins to
      // 0.9·f). Under γ it is only the conservation ceiling: the density
      // graveyard holds most cores well below it, so economies differentiate
      // (each core settles at its own capacity^(1/(1+γ))) instead of flattening.
      if (f > 0) uTarget = Math.min(uTarget, (useGamma ? URBAN_GMAXSHARE : URBAN_MAXSHARE) * f);
      if (f > 0) {
        const cx = s.pos.x | 0, cy = s.pos.y | 0;
        // Relax the whole urban FOOTPRINT (disk of radius coreR) toward the target,
        // not just the centre tile — so the concentration target is a real area, not
        // one tile whose people shrink ∝1/rn². coreR=0 ⇒ diskSum === pf[ti] exactly.
        const delta = URBAN_CONC_LAMBDA * (uTarget - diskSum(pf, tw, world.th, cx, cy, coreR));
        if (delta > 1e-6 || delta < -1e-6) urbanConcentrate(world, owner, s.id, cx, cy, ti, delta, useGamma ? URBAN_CONC_MAXFRAC_G : URBAN_CONC_MAXFRAC, coreR);
      }
    }
    if (f > 0) s.people = Math.max(1, f * scale);
    // The URBAN CORE is the concentration itself: the people on the city's
    // own tile, in census units — the ruling made literal. This is what the
    // urbanization share, the demographic transition, the graveyard and the
    // Zipf statistics read; the region's rural remainder is everyone else on
    // its land. (Overrides the census-side ruralShare heuristic each tick.)
    let _coreF = 0;   // live core-disk field people (reused by the CORE_HOLD floor below)
    if (f > 0) {
      // The urban core is the people on the real FOOTPRINT (disk of radius coreR),
      // in census units — resolution-invariant. coreR=0 ⇒ diskSum === pf[ti] exactly.
      _coreF = Math.max(0, diskSum(pf, tw, world.th, s.pos.x | 0, s.pos.y | 0, coreR));
      s._urbanPop = Math.min(s.people, _coreF * scale);
      s._ruralPop = Math.max(0, s.people - s._urbanPop);
      // The MEASURED core, kept apart from _urbanPop: the census-side
      // ruralShare heuristic overwrites _urbanPop every tick between derives
      // (updateSettlement runs before this pass), so a reader inside the
      // settlement pass sees the RATIO MODEL there, not this measurement. The
      // tier ladder under T.CITY_CORE prices its rungs on the measured core
      // only (the heuristic read minted a "city" at step 1 and metropolises at
      // 3× their field core). Null until the field first derives a catchment.
      s._coreMeasured = s._urbanPop;
    }
    // else: no catchment tiles this pass (fresh founding / recompute lag) — keep the census value
    // The spike (next pass's capacity + the core's transition/graveyard-bent
    // growth rate stamped by updatePop). Under URBAN_AGGLOM the capacity spike
    // is the agglomeration TARGET itself — just enough to HOLD what the
    // concentration flow delivers (so the field pass's logistic and migration
    // see pop≈cap and neither crash nor expel the crowd); the flow, not the
    // throughput-limited diffusion, is what actually fills it. Otherwise it is
    // the raw import ceiling (the pre-agglomeration behaviour).
    let kCap = agglom ? uTarget : kBeyond;
    // T.CORE_HOLD — the spike HANDOFF floor (the birth-crater killer,
    // 2026-08-07). kCap is IMPORT-SHARE-driven, so a newborn city that grows
    // its own food stamps ~ZERO capacity over the very core the site law just
    // finished gathering (maybeSiteCities held it at min(coreNow,
    // coreBarF×1.2) until the mint deleted that spike) — measured as a 45%
    // basin-capacity crash in the mint window and a 457→20 census death
    // spiral (probe_capdrain; famine and shock channels proven inert by
    // three attribution arms). The entity spike therefore never falls below
    // the site law's own bound, stashed at the mint (_coreHoldCapF): capacity
    // keeps HOLDING WHAT ARRIVED — both sides of the handoff now obey the
    // one law — and the import economy takes over the moment it grows past
    // it. Existing constants only; cities minted by other paths (colonies,
    // plantations) carry no stash and are untouched.
    if (T.CORE_HOLD && s._coreHoldCapF > 0 && _coreF > 0) {
      const hold = Math.min(_coreF, s._coreHoldCapF);
      if (hold > kCap) kCap = hold;
    }
    // THE URBAN GRAVEYARD, density-graded (T.URBAN_GAMMA): the base excess
    // mortality (settlement.js: disease load × urbanity × unhealed) is scaled by
    // how dense this core is versus the typical importing core, raised to γ —
    // super-linear, so a great city is disproportionately deadlier (its crowd
    // disease outruns its births; it grows only by pulling people in). This is
    // what makes the equilibrium size sublinear in economy and re-differentiates
    // cores the hard cap would have flattened. γ=0 ⇒ ×1 (the flat sink, byte-
    // identical). Clamped so a transient spike can't kill a core in one pass.
    // FOLLOW-UP (T.URBAN_FOOTPRINT): this density ratio still reads the core-CENTRE
    // tile pf[ti] (and medDens is a centre-tile median at line ~615), so numerator
    // and denominator share the same single-tile basis — the ratio is dimensionless
    // and largely resolution-robust. Migrating it to a disk-mean density is a
    // secondary refinement, deliberately out of scope for this first footprint cut.
    let sink = s._rSink || 0;
    if (useGamma && sink > 0 && medDens > 0 && pf[ti] > 0) {
      sink *= Math.min(GRAVEYARD_PMAX, Math.pow(pf[ti] / medDens, gamma));
    }
    if (kCap > 0 || s._rEff !== undefined) spikes.set(ti, { k: kCap, r: s._rEff, sink });
  }
}

// ── T.FIELD_DEMOG: demographic events live on the field (one population) ────
// docs/one-population.md slice A. Every event that adds or removes PEOPLE in
// the town census — plague, famine, the sack's captive trains, razzias,
// revolt ravages, forced arrivals — is mirrored onto the people-on-land field
// around the settlement it struck, so the land is the honest record of
// demographic history (a devastating war EMPTIES countryside on the
// Population lens) and the field consumers (national power, hold capacity,
// nomads, the grievance reference) feel it. Losses drain the settlement's
// home tile first, then cascade outward ring by ring — the countryside its
// people lived in — clamped at zero and bounded (if the field carries fewer
// people than the census lost, the remainder is dropped: the two numbers are
// not yet reconciled to the person; slice B derives the census FROM the
// field). Gains land on the home tile — arrivals concentrate where the
// market that bought them is. Deterministic ring walk, no RNG; the field's
// own logistic growth recovers a dent over generations, exactly as the
// census does. No-op when the lever (or the field itself) is off.
const FIELD_SHIFT_R = 6;   // max cascade radius (tiles): a town's demographic hinterland

export function fieldShift(world, s, delta) {
  if ((!T.FIELD_DEMOG && !T.ONE_POP) || !T.POP_FIELD || !world.popField || !s || !s.pos) return;
  if (!(delta < 0 || delta > 0)) return;
  const pf = world.popField, tw = world.tw, th = world.th;
  const cx = s.pos.x | 0, cy = s.pos.y | 0;
  const ti0 = cy * tw + cx;
  if (ti0 < 0 || ti0 >= world.N) return;
  if (delta > 0) { pf[ti0] += delta; return; }
  let need = -delta;
  for (let r = 0; r <= FIELD_SHIFT_R && need > 0; r++) {
    // ring r around (cx,cy): fixed order (top row, bottom row, left col, right col)
    for (let k = -r; k <= r && need > 0; k++) {
      for (let e = 0; e < (r === 0 ? 1 : 4) && need > 0; e++) {
        let x, y;
        if (r === 0) { x = cx; y = cy; }
        else if (e === 0) { x = cx + k; y = cy - r; }
        else if (e === 1) { x = cx + k; y = cy + r; }
        else if (e === 2) { x = cx - r; y = cy + k; if (k === -r || k === r) continue; }   // corners already visited
        else { x = cx + r; y = cy + k; if (k === -r || k === r) continue; }
        if (y < 0 || y >= th) continue;
        const ti = ((x % tw) + tw) % tw + y * tw;
        const have = pf[ti];
        if (!(have > 0)) continue;
        const take = have < need ? have : need;
        pf[ti] = have - take;
        need -= take;
      }
    }
  }
}
