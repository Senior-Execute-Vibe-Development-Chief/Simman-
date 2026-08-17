// ── The agricultural transition (Diamond / Scott, in sim form) ───────────────
//
// Fertility is NECESSARY but not SUFFICIENT for dense, state-capable population.
// Most of the planet can grow *something* — but a hunter-gatherer band on fertile
// land lives at a tiny fraction of the density a farming society reaches on the
// SAME land, and produces no storable, taxable cereal surplus, so no state forms.
// Historically the move from foraging to farming (a) had to be INVENTED at a few
// hearths and DIFFUSE outward (slowly, and barely across climates/deserts/water —
// the sim's cradles + knowledge spread + AXIS_BIAS already model this), and (b) was
// capped by GEOGRAPHY: the domesticable-species package was rich on the giant,
// connected Old-World landmass and poor on isolated continents (Australia, the
// Americas) and in the disease-ridden wet tropics (Diamond's thesis for why fertile
// Australia / the pre-maize US / the Amazon stayed stateless until colonisation).
//
// Two factors, multiplied into a settlement's LAND food:
//   1. DEVELOPMENT — forager floor at zero agriculture knowledge, rising to full as
//      farming develops/arrives. This is what makes a fresh frontier sparse and lets
//      civilisation RADIATE from the cradles instead of the whole map farming at full
//      yield from tick 0.
//   2. CEILING — a static, per-tile cap on how far agriculture can develop AT ALL on
//      this land (Diamond's geography): high on the largest connected landmass, low on
//      isolated continents and in the wet tropics. Even given infinite time, a low-
//      ceiling region never reaches full farming density — it stays a sparse frontier.

import { T, rNormPop } from "./tuning.js";

// The LAND's aridity around a tile — the FLOOD_OPT discriminator. A flood
// ribbon's own moisture is wet BECAUSE of the river (measured: the
// Euphrates pin's raw m reads 0.45 — the ribbon, not the land), so the
// question "is the flood the only water here?" is answered by the driest
// nearby country: min raw moisture over the tile and an rn-scaled 8-point
// ring (resolution-honest — one reference tile's reach at every grid).
// Static per tile (moist is worldgen), lazily cached.
function aridMinAt(world, ti) {
  let f = world._aridMin;
  if (!f || f.length !== world.N) f = world._aridMin = new Float32Array(world.N).fill(-1);
  let v = f[ti];
  if (v >= 0) return v;
  const tw = world.tw, th = world.th, moist = world.moist;
  const y = (ti / tw) | 0, x = ti - y * tw;
  const r = Math.max(1, Math.round(rNormPop(world)));
  v = moist[ti];
  for (let dy = -r; dy <= r; dy += r) for (let dx = -r; dx <= r; dx += r) {
    if (!dx && !dy) continue;
    const yy = y + dy; if (yy < 0 || yy >= th) continue;
    const xx = ((x + dx) % tw + tw) % tw;
    const mm = moist[yy * tw + xx];
    if (mm < v) v = mm;
  }
  f[ti] = v;
  return v;
}
import { packagePresent, packageAdaptMul } from "./biogeography.js";
import { CROP_PACKAGES, CROP_BY_ID } from "../cropPackages.js";
import { cropSuitabilityPkg } from "../cropGen.js";

// ── Crop-package layer (T.CROP_AXIS) ──────────────────────────────────
// Suitability of ONE package at a tile, read from the world's tile climate
// arrays (cropSuitabilityPkg applies the shared arid / tropical-soil / elevation
// / alluvial gates and the package's own climate bell).
// T.IRRIG_CROP: a FLOOD-FED field reads the river, not the sky. The crop model's
// moisture bell reads rainfall, but the arid-river cradles were never rain-fed —
// Mesopotamian and Egyptian wheat grew on basin irrigation from the flood
// (measured under OBSERVED climate: Mesopotamia rains m=0.02, and the wheat that
// historically fed it scores ~0 there, so the hearth falls to a sorghum-class
// site — the crop model contradicting the fertility model, whose alluvium terms
// already know these valleys are breadbaskets). On tFlood ground (the arid-river
// floodplain mask — the Nile/Indus/Tigris corridor class, a WORLDGEN property,
// no place named) the moisture a crop EXPERIENCES is floored at well-watered:
// MOIST_FLOOD_FED = 0.5, mid-scale — a statement about flood basins (annually
// re-watered, silt-wetted), not about any crop; rain-fed land is untouched, and
// a wet-climate floodplain is already above the floor so nothing changes there.
// Applied to the annual read AND the seasonal read (the shared envGate comment's
// own words: "a river irrigates year-round").
const MOIST_FLOOD_FED = 0.5;
export function pkgSuitAt(world, ti, pkg) {
  const e = world.elev[ti]; if (e <= 0) return 0;
  const coast = world.coast ? world.coast[ti] : 0;
  const rm = world.riverMag ? world.riverMag[ti] : 0;
  const t = world.temp[ti];
  const mRaw = world.moist[ti];   // RAW annual moisture — the FLOOD_OPT aridity discriminator reads this
  let m = mRaw;
  if (T.IRRIG_CROP && world.tFlood && world.tFlood[ti] && m < MOIST_FLOOD_FED) m = MOIST_FLOOD_FED;
  // T.GROW_SEASON: evaluate the package on the SEASON IT GROWS IN. The crop's
  // own tOpt picks the season — a cool-optimum crop (wheat) grows in the tile's
  // cool half, a warm-optimum crop (maize/rice) in the warm half — and it reads
  // THAT season's temperature and rainfall. No per-crop label: the season falls
  // out of tOpt vs the two half-year temperatures. (docs/design-growing-season.md)
  if (world._tAmp) {
    const amp = world._tAmp[ti], wf = world._warmRainFrac[ti];
    const tWarm = t + amp, tCool = t - amp;
    // CROP-SEASON CLASSIFICATION: a crop is warm-season or cool-season by its OWN
    // optimum (the botanical division ~18C: wheat/barley/oats cool, maize/rice/
    // sorghum/millet warm), and it grows in THAT half of the year regardless of
    // whether the half is above/below its optimum — a summer crop grows in summer
    // or not at all. A warm-season crop forced into a hot dry summer then FAILS on
    // that season's drought, which is the Mediterranean-summer mechanism.
    const warm = pkg.tOpt >= 0.80;
    const tGrow = warm ? tWarm : tCool;
    // Season moisture: gentle bias toward the annual level (even split ⇒ mGrow=m,
    // fully-wet season ⇒ 1.4×m, fully-dry ⇒ 0.6×m) — not the ×2 that overshot.
    const frac = warm ? wf : 1 - wf;
    let mGrow = Math.max(0, Math.min(1, m * (0.6 + 0.8 * frac)));
    // Flood-fed ground keeps its floor in EVERY season (basin irrigation stores
    // the flood for the growing season — Egypt's winter wheat on the summer
    // flood's water); rain-fed seasonality is untouched.
    if (T.IRRIG_CROP && world.tFlood && world.tFlood[ti] && mGrow < MOIST_FLOOD_FED) mGrow = MOIST_FLOOD_FED;
    // T.FLOOD_OPT — MANAGED WATER HITS THE OPTIMUM (task #15, the Mesopotamia
    // inversion root, MEASURED at the pin: winter temp 0.72 vs wheat tOpt 0.73
    // — PERFECT — but the flood floor + cool-season rain bias push mGrow to
    // ~0.59 against wheat's mOpt 0.36, and the symmetric bell punishes "too
    // wet" as hard as "too dry": history's richest grain economy priced at
    // 0.27-0.37 by its own irrigation water). Basin irrigation is CONTROLLED
    // application — canals deliver and DRAIN; a farmer gives the crop what it
    // wants, never drowns it — so on flood-fed ground the growing moisture
    // clamps DOWN to the crop's own optimum when supply exceeds it. Scarcity
    // below optimum still binds (the floor stays MOIST_FLOOD_FED, no top-up
    // beyond it), so rice (mOpt 0.72 > the flood floor) is untouched and the
    // desert off the floodplain stays desert. Zero constants: the clamp
    // target is the package's own optimum. A pre-v20 save keeps its
    // overwatered cradles (guard).
    // ...and the clamp's discriminator is ARIDITY, not flood geography and
    // not technique (BOTH alternatives measured dead, 2026-08-14, recorded
    // per custom: geography-blind put Europe 5th in the world's dawn —
    // Rhine bottomland priced like the Nile; capability-gated (devField ≥
    // the irrigation tech's bar) collapsed Mesopotamia back to 10th — the
    // boom waited on a maturity its own pre-boom poverty delays, the
    // chicken-and-egg). The physical truth: irrigation manages SCARCE
    // water. Where the land is arid — raw annual moisture BELOW the crop's
    // optimum — the flood is the water supply, and recession farming (sow
    // in the withdrawing flood's mud) works from the first season: the
    // 'Ubaid Euphrates, the pre-dynastic Nile. Where the land is already
    // rain-wet (the Rhine), the flood adds nothing the rain didn't, and the
    // bell's too-wet penalty is HONEST — heavy waterlogged soils really did
    // underperform until drainage, a much later technology. So: clamp to
    // the optimum only where mRaw < the crop's own optimum. Zero new
    // constants, zero capability gates — the desert cradles boom from the
    // dawn, and no rain-fed plain ever qualifies at any technique level.
    if (T.FLOOD_OPT && T.IRRIG_CROP && world.tFlood && world.tFlood[ti] && mGrow > pkg.mOpt
        && aridMinAt(world, ti) < pkg.mOpt) mGrow = pkg.mOpt;
    return cropSuitabilityPkg(pkg, t, m, e, coast, rm, null, tGrow, mGrow) * tillageMul(world, ti);
  }
  if (T.FLOOD_OPT && T.IRRIG_CROP && world.tFlood && world.tFlood[ti] && m > pkg.mOpt
      && aridMinAt(world, ti) < pkg.mOpt) m = pkg.mOpt;
  return cropSuitabilityPkg(pkg, t, m, e, coast, rm, null) * tillageMul(world, ti);
}


// ── T.TILLAGE: the land must be WORKABLE, not merely fertile (2026-08-14,
// docs/atlas-gap-2026-08-14.md cause II) ────────────────────────────────────
// The climate bells price what a crop WANTS; they do not price what a farmer
// can DO. Measured (probe_floodstates, tw=480/15k): the sim seats −1500
// states on Scotland (tCrop 0.98), the Baltic (0.86), Gabon (0.98) — land
// whose climate scores high but whose GROUND resisted agriculture for
// millennia: heavy waterlogged temperate clay under forest broke the scratch
// ard until the heavy mouldboard plough, and wet-tropical forest on leached
// laterite resisted until iron clearing. That workability gap is THE textbook
// reason civilization rose on arid-alluvial soil — flood-renewed silt works
// from the first season with a stick — and its absence is why statehood
// diffuses here like heat instead of hugging the cradle belt for millennia.
// The gate is the TECHNIQUE THE PEOPLE ON THE TILE ACTUALLY KNOW
// (world.devField — the emergent agricultural-technique wave): light/dry
// ground and flood ribbons are workable at any technique (the cradle belt is
// untouched — no Mesopotamia chicken-and-egg: the gate never binds the land
// whose boom must fund the technique); wet heavy ground ramps from its floor
// to 1 as local technique matures, which arrives by DIFFUSION from the
// booming cradles — the very gradient this exists to produce. Never a clock.
// The static workability FLOOR per tile (w0: 1 on light/dry ground and flood
// silt; TILL_HEAVY..TILL_TROPIC on wet heavy ground) — shared by the suit door
// (tillageMul below) and the CAPACITY KERNEL (popField ships it to the pooled
// workers as a SAB, presence-keyed like the ACCESS_BAND arrays). Lazily built,
// static per world (moist/temp/tFlood are worldgen; a TILL_* lever change
// mid-run rebuilds on the next world init, same staleness class as _aridMin).
export function ensureTill0(world) {
  let f = world._till0;
  if (f && f.length === world.N) return f;
  f = world._till0 = new Float32Array(world.N);
  for (let ti = 0; ti < world.N; ti++) {
    const m = world.moist[ti];
    if (m < 0.45 || (world.tFlood && world.tFlood[ti])) { f[ti] = 1; continue; }   // ard-workable / flood silt
    const t = world.temp[ti];
    const tropic = Math.min(1, Math.max(0, (t - 0.72) / 0.10));   // the same tropical line habitability.js draws
    f[ti] = T.TILL_HEAVY + (T.TILL_TROPIC - T.TILL_HEAVY) * tropic;   // cool wet clay → hot wet forest
  }
  return f;
}
function tillageMul(world, ti) {
  if (!T.TILLAGE) return 1;
  const w0 = ensureTill0(world)[ti];
  if (w0 >= 1) return 1;
  const dev = world.devField ? Math.min(1, Math.max(0, world.devField[ti])) : 0;
  return w0 + (1 - w0) * dev;
}

// Best package at a tile by RAW suitability — what a cradle / mature culture
// would domesticate here. Returns { id, suit } or null if nothing grows.
// T.CROP_BIOGEO: only packages that have SPREAD to this tile (wild ancestor's
// homeland + the wave of advance, biogeography.js) compete — so maize is not a
// candidate in Egypt however irrigable, and the New World keeps its own crops.
// Off / before the fields exist, every package is present (byte-identical).
export function bestPackageAt(world, ti) {
  let best = null, bestS = 0;
  for (const pkg of CROP_PACKAGES) {
    // T.CROP_MILLET (v7 regime guard): the millet split changes which crop the
    // whole East-Asian dawn domesticates. A never-owned package's ONLY entry
    // point into a world is this competition (cropCeil/adoption read OWNED
    // crops), so one gate here keeps a pre-split save's agronomy whole.
    if (pkg.id === "millet" && !T.CROP_MILLET) continue;
    // PRESENCE (T.CROP_HOMELAND, or the full T.CROP_BIOGEO): a wild ancestor
    // can only be domesticated where its range has actually arrived — what
    // keeps maize out of China, rice out of Australia, wheat out of the
    // southern hemisphere at the dawn (the from-0 report, 2026-08-07).
    if ((T.CROP_BIOGEO || T.CROP_HOMELAND) && !packagePresent(world, ti, pkg)) continue;
    // ADAPTATION (full T.CROP_BIOGEO only): a package arrives as a lesser
    // version of itself the farther it has come (packageAdaptMul) — so the
    // LOCAL package wins its own band. Measured to thin domesticated-crop
    // coverage past the founding bars (see biogeography.js), so it stays with
    // the blocked full lever; the presence half ships without it. ×1 off.
    const s = pkgSuitAt(world, ti, pkg) * (T.CROP_BIOGEO ? packageAdaptMul(world, ti, pkg) : 1);
    if (s > bestS) { bestS = s; best = pkg; }
  }
  return best ? { id: best.id, suit: bestS } : null;
}

// Crop-package agricultural CEILING for a settlement: the best STORABLE yield
// (suit × storability) among the crops it OWNS, evaluated at its home tile. 0 =
// it owns no crop that grows here — a forager (it may know farming TECHNIQUE,
// but has nothing domesticated for this climate). The ×storability is what caps
// the wet-tropic tuber zone low even where the land is lush. Carrying an
// off-climate crop (e.g. inherited wheat in the tropics) costs nothing: its
// local suitability is ~0, so it never sets the ceiling.
export function cropCeil(world, s) {
  const crops = s.crops; if (!crops || crops.length === 0) return 0;
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  let best = 0;
  for (const id of crops) {
    const pkg = CROP_BY_ID[id]; if (!pkg) continue;
    const v = pkgSuitAt(world, ti, pkg) * pkg.storability;
    if (v > best) best = v;
  }
  return best;
}

// Per-tile domestication ceiling (computed once, cached on world._agriCeil).
function computeAgriCeiling(world) {
  const { N, tw, th, elev, temp, moist } = world;
  // ── connected-landmass flood fill (4-neighbour, x-wraps) ──
  const comp = new Int32Array(N).fill(-1);
  const size = [];
  const stack = [];
  let nComp = 0;
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0 || comp[i] >= 0) continue;
    const id = nComp++; let sz = 0;
    stack.length = 0; stack.push(i); comp[i] = id;
    while (stack.length) {
      const ti = stack.pop(); sz++;
      const y = (ti / tw) | 0, x = ti - y * tw;
      const left  = y * tw + ((x - 1 + tw) % tw);
      const right = y * tw + ((x + 1) % tw);
      const up    = y > 0 ? ti - tw : -1;
      const down  = y < th - 1 ? ti + tw : -1;
      if (comp[left]  < 0 && elev[left]  > 0) { comp[left]  = id; stack.push(left); }
      if (comp[right] < 0 && elev[right] > 0) { comp[right] = id; stack.push(right); }
      if (up   >= 0 && comp[up]   < 0 && elev[up]   > 0) { comp[up]   = id; stack.push(up); }
      if (down >= 0 && comp[down] < 0 && elev[down] > 0) { comp[down] = id; stack.push(down); }
    }
    size[id] = sz;
  }
  let largest = 1; for (const s of size) if (s > largest) largest = s;
  // ── ceiling per tile: landmass connectivity × wet-tropic penalty ──
  const ceil = new Float32Array(N);
  const floor = T.AGRI_CEIL_FLOOR;
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) { ceil[i] = 0; continue; }
    // Relative landmass size → ceiling. sqrt so medium continents (the Americas) sit
    // well above the isolated floor while the giant Old-World mass alone reaches 1.0.
    const rel = size[comp[i]] / largest;
    let c = floor + (1 - floor) * Math.sqrt(rel);
    // Wet-tropic penalty: hot & wet land (disease, leached soils, root crops not
    // storable cereals) caps lower — the Congo/Amazon/New-Guinea statelessness.
    const t = temp[i], m = moist[i];
    if (t > 0.78 && m > 0.6) {
      const trop = Math.min(1, (t - 0.78) / 0.12) * Math.min(1, (m - 0.6) / 0.25);
      c *= 1 - T.AGRI_TROPIC_PENALTY * trop;
    }
    ceil[i] = c;
  }
  return ceil;
}

// Agricultural development factor on a settlement's LAND food (the home tile's land).
// Forager floor at zero agriculture, rising to full at T.AGRI_FULL_AT — but the land's
// domestication ceiling caps the effective agriculture, so isolated/tropical regions
// can never reach full farming density no matter how long they develop.
export function agriGate(world, s) {
  let ceil;
  if (T.CROP_AXIS > 0) {
    // Owned-crop ceiling. Cached (home tile + crops are static between changes);
    // crop acquisition / domestication in settlement.js invalidates it by
    // setting s._cropCeil = undefined. STILL capped by the landmass-isolation
    // ceiling, so an isolated continent can't farm at full density just because
    // its settlements happen to own good crops — the Diamond isolation thesis
    // holds on BOTH branches, not only the default one.
    if (s._cropCeil === undefined) s._cropCeil = cropCeil(world, s);
    if (!world._agriCeil || world._agriCeilKey !== T.AGRI_CEIL_FLOOR * 1000 + T.AGRI_TROPIC_PENALTY) { world._agriCeil = computeAgriCeiling(world); world._agriCeilKey = T.AGRI_CEIL_FLOOR * 1000 + T.AGRI_TROPIC_PENALTY; }   // recompute when either baked-in lever moves (B10 — honour the live-lever contract)
    const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
    ceil = Math.min(s._cropCeil, world._agriCeil[ti] || 0);
  } else {
    if (!world._agriCeil || world._agriCeilKey !== T.AGRI_CEIL_FLOOR * 1000 + T.AGRI_TROPIC_PENALTY) { world._agriCeil = computeAgriCeiling(world); world._agriCeilKey = T.AGRI_CEIL_FLOOR * 1000 + T.AGRI_TROPIC_PENALTY; }   // recompute when either baked-in lever moves (B10 — honour the live-lever contract)
    const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
    ceil = world._agriCeil[ti] || 0;
  }
  const ag = Math.min((s.knowledge && s.knowledge.agriculture) || 0, ceil);
  const dev = Math.min(1, ag / Math.max(1e-3, T.AGRI_FULL_AT));   // 0 = foraging, 1 = full agriculture
  s._agriGate = T.AGRI_FORAGE_YIELD + (1 - T.AGRI_FORAGE_YIELD) * dev;   // (info panel)
  s._agriCeil = ceil;
  return s._agriGate;
}
