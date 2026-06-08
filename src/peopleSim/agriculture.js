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

import { T } from "./tuning.js";

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
  if (!world._agriCeil) world._agriCeil = computeAgriCeiling(world);
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const ceil = world._agriCeil[ti] || 0;
  const ag = Math.min((s.knowledge && s.knowledge.agriculture) || 0, ceil);
  const dev = Math.min(1, ag / Math.max(1e-3, T.AGRI_FULL_AT));   // 0 = foraging, 1 = full agriculture
  s._agriGate = T.AGRI_FORAGE_YIELD + (1 - T.AGRI_FORAGE_YIELD) * dev;   // (info panel)
  s._agriCeil = ceil;
  return s._agriGate;
}
