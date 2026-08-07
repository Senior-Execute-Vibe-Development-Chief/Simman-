// ── Political control as a FIELD (T.CONTROL_FIELD) ───────────────────────────
//
// A radically different political map. Instead of the periodic global recompute
// (countryTerritory.js: throw away _countryOwner every ~144 ticks, rebuild it with a
// cost-Voronoi flood, then correct it with shed / connectivity / gap-fill / smooth),
// political CONTROL is a per-tile field that RELAXES one hop every tick — the shape of
// popField.js, carrying "who holds this ground and how strongly" instead of "how many
// people":
//
//   world._ctrlOwner[t]  — the nation whose control dominates tile t (-1 = wilderness).
//   world._ctrlHold[t]   — the strength of that hold, 0..~1.
//
// Every tick:
//   1. each nation PINS its capital at a strength P set by its power;
//   2. control PROPAGATES one hop — a tile takes the strongest control reaching it from a
//      neighbour, times a transmission that DECAYS with distance (reach ∝ logistics) and is
//      RESISTED by the SAME geography the old cost-field used: relief walls it, barren
//      desert and wet jungle bleed it, great rivers check it, a coherent noise field wanders
//      it, and open sea passes it only for a nation with NAVIGATION (thalassocracies);
//   3. standing control DECAYS, so a nation whose capital dies/weakens loses its marches as
//      the field stops being reinforced — rise and fall, and a dead realm FADES over a few
//      ticks (its neighbours flood in) rather than vanishing in one.
//
// The border is argmax control. It MOVES CONTINUOUSLY as powers shift — no recompute tick,
// no bursts — and the whole correction stack disappears: disconnected land can't be reached
// by control (fades to wilderness); a stronger neighbour's control pushes the balance-line
// past the midpoint (power-weighted borders); ridges/rivers/deserts are where two fields
// meet because control barely crosses them (borders hug real geography for free). O(N)
// 4-neighbour stencil, double-buffered for determinism, stride-able like popField.
//
// Runs ALONGSIDE _countryOwner (into world._ctrlOwner) so it can be A/B'd on the same
// nations (tools/render_controlfield.mjs). Lever off ⇒ never runs (byte-identical).

import { T } from "./tuning.js";
import { settlementPower } from "./conquest.js";
import { claimHostility } from "./habitability.js";

const _envNum = (k, d) => (typeof process !== "undefined" && process.env && +process.env[k]) || d;

// ADDITIVE (max-plus) reach: control at a tile = P − cheapest terrain-cost path from the
// nation's capital; a tile is held while that stays positive, so P is the reach BUDGET in
// cost-units (≈ tiles on open plains) — directly controllable, the continuous form of the
// old org-scaled cost-Voronoi. Budget grows with LOGISTICS (roads→rail: a chiefdom holds
// its walls, an industrial state a continent) and with the realm's POWER (a hegemon reaches
// past the midpoint into a weak neighbour — power-weighted borders, no dominance exponent).
const REACH_BASE = _envNum("SIM_CTRL_BASE", 6.5);    // reach (cost-units) at logistics 0
const REACH_LOGI = _envNum("SIM_CTRL_LOGI", 36.0);   // + this × logistics
const POW_SPAN   = _envNum("SIM_CTRL_POW",  0.9);    // ± budget from relative power (×0.6..~1.8 at the poles)
const FADE       = _envNum("SIM_CTRL_FADE", 0.6);    // cost-units a march recedes per tick when unreinforced (rise/fall pace)
const DEAD_FADE  = _envNum("SIM_CTRL_DEAD", 2.5);    // faster recession for a dead realm's orphaned land
const CLAIM_MIN  = 0.0;                              // control ≤ this = wilderness (the reach edge)
// Per-tile terrain COST to ENTER (≥1; resistance raises cost) — ported from the old claim
// cost field so the field keeps its geography, minus the recompute.
const MTN_COST   = _envNum("SIM_CTRL_MTN", 5.0);   // + this × max(0,elev-0.45): ranges are walls, borders snap to ridges
const RIV_COST   = _envNum("SIM_CTRL_RIV", 0.8);   // + this crossing a navigable river channel
const FERT_REF   = 0.14;                            // fertility below which barren land is costly (desert ribbons)
const FERT_COST  = _envNum("SIM_CTRL_FERT", 3.0);  // + this × deficit² on land below FERT_REF
const WET_COST   = _envNum("SIM_CTRL_WET", 2.0);   // + this × claimHostility in the disease/tsetse wet tropics
const NOISE_AMP  = _envNum("SIM_CTRL_NOISE", 0.5); // coherent ± on cost so borders aren't dead-straight/round
// Sea crossing cost: only a realm with NAVIGATION pays a low enough per-water-tile cost to
// carry control across a strait; a landlocked realm's control dies at the shore, an ocean is
// too wide for anyone (cost accumulates) — thalassocracies emerge.
const WATER_COST = _envNum("SIM_CTRL_WATER", 6.0); // per-water-tile cost at zero navigation
const WATER_NAV  = _envNum("SIM_CTRL_WNAV", 5.0);  // − this × navigation (a great fleet crosses cheaply)
// War pressure: on a contested front (armies.js writes world._warFront = the winning
// attacker, world._warAdv = its force margin), the attacker gets an ADDITIVE reach bonus
// crossing into the defender there — extra cost-units of projection ∝ the winning margin —
// so its control extends a bounded bulge into enemy land. Additive (not a multiply), so it
// can't compound/inflate; re-stamped each war pass, the bulge advances toward the capital.
const WAR_BONUS  = _envNum("SIM_CTRL_WARPUSH", 5.0);
// PRETTY-MODE (stepTrackingBounded): the field is a faithful, smoothed, continuously-moving
// DRAWING of the authoritative _countryOwner — not an independent flood. A budget-flood (P=K√area)
// was tried and drew big/isolated realms far too large: how far a flood spreads depends on how
// much empty land is around it, not just its budget, so no single constant bounds it (a hegemon
// on a sparse continent flooded ~2× its real size). Instead, control is SEEDED at capitals and is
// CHEAP only on a realm's OWN real land, so it fills the real territory gradually (smooth) and
// cannot escape it: a thin uniform band into wilderness, and BLOCKED from a neighbour's real land
// (no overwrite). Reached own-land re-charges to SRC_HOLD (a uniform source, no distance decay),
// so the band is the SAME width for a hegemon and a city-state — size- and resolution-independent.
export const SRC_HOLD = _envNum("SIM_CTRL_SRC", 6.0);    // control level on reached own land (source ceiling; exported: materialisation stamps inherited tribal ground at this hold, crystallize.js)
const CHARGE     = _envNum("SIM_CTRL_CHARGE", 1.0); // control gained/pass on own land (tops up the source)
const WILD_COST  = _envNum("SIM_CTRL_WILD", 1.5);   // + this entering WILDERNESS → thin band ≈ SRC_HOLD/(cost+WILD) tiles
const TRK_WATER  = _envNum("SIM_CTRL_TWATER", 3.0); // cost to bleed onto a water tile (short coastal relay; masked in render)
// Recession is MUCH slower than advance (strong hysteresis). The authoritative recompute doesn't
// only grow — every ~144 ticks it SHEDS then RE-CLAIMS land as its correction stack (shed /
// connectivity / gap-fill) churns, so a tile can flip owned→wilderness→owned within a few hundred
// ticks for no in-world reason. If the field fades as fast as that, borders visibly recede and then
// re-advance — the "land abandoned for no reason" wobble. Fading slowly (over ~SRC_HOLD/TRK_FADE
// passes ≈ 300+ ticks) lets a transient shed HEAL before the field follows it down, so the border
// rides over the recompute's jitter. This does NOT slow genuine losses: land CONQUERED by a
// neighbour fills with the conqueror's control fast (charge-driven, one hop/pass); only reversion
// to WILDERNESS is held — exactly the transient the recompute keeps creating and undoing.
const TRK_FADE   = _envNum("SIM_CTRL_TFADE", 0.08); // control lost/pass on un-owned land (≪ CHARGE ⇒ slow, hysteretic recession)

function powerOfCapital(c) {
  const cap = c.capital;
  return Math.max(1e-6, (c._capacity || 0) > 0 ? c._capacity : settlementPower(cap));
}

// Per-tile LAND entry COST (relief · fertility · wet-tropic · river · noise), independent of
// the projecting nation. Cheap to recompute; cached.
function landCost(world) {
  const N = world.N, { elev, fert, riverMag, temp, moist } = world;
  let ec = world._ctrlEnter; if (!ec || ec.length !== N) ec = world._ctrlEnter = new Float32Array(N);
  const noise = world._claimNoise;   // coherent value-noise (countryTerritory.js builds it under the field model)
  for (let t = 0; t < N; t++) {
    if (elev[t] <= 0) { ec[t] = 0; continue; }
    let c = 1;
    if (elev[t] > 0.45) c += MTN_COST * (elev[t] - 0.45);
    const f = fert ? fert[t] : 0.5;
    if (f < FERT_REF) { const d = (FERT_REF - f) / FERT_REF; c += FERT_COST * d * d; }
    if (temp && moist) { const w = claimHostility(temp[t], moist[t]); if (w > 0) c += WET_COST * w; }
    if (riverMag && riverMag[t] >= 3) c += RIV_COST;
    if (noise) c *= 1 + (noise[t] - 0.5) * (2 * NOISE_AMP);
    ec[t] = c > 0.05 ? c : 0.05;
  }
  return ec;
}

export function stepControlField(world) {
  const N = world.N, tw = world.tw, th = world.th, elev = world.elev;
  let owner = world._ctrlOwner, hold = world._ctrlHold;
  if (!owner || owner.length !== N) {
    owner = world._ctrlOwner = new Int32Array(N).fill(-1);
    hold = world._ctrlHold = new Float32Array(N);
    world._ctrlOwnerNext = new Int32Array(N);
    world._ctrlHoldNext = new Float32Array(N);
  }
  const cost = landCost(world);
  const coMap = world._countryOwner;
  // PRETTY MODE (default): faithfully DRAW the authoritative map, bounded + smoothed. CTRL_LIVE has
  // no external truth to track (the field IS the map), so it keeps the emergent capital-flood below.
  if (coMap && coMap.length === N) { stepTrackingBounded(world, cost); return; }   // (the T.CTRL_LIVE authoring path was removed 2026-07)

  // ── CTRL_LIVE: emergent capital-flood (the field authors _countryOwner) ──────────────────────
  // Sources + per-nation reach BUDGET (P, cost-units) and water navigation.
  const sources = new Map();     // cid → capital tile
  const alive = new Set();
  let srcP = world._ctrlSrcP, navById = world._ctrlNav;
  const maxId = (world._nextSettlementId || 1) + 1;
  if (!srcP || srcP.length < maxId) {
    srcP = world._ctrlSrcP = new Float32Array(maxId);
    navById = world._ctrlNav = new Float32Array(maxId);
  }
  if (world.countries) {
    const raw = [], pows = [];
    for (const [cid, c] of world.countries) {
      const cap = c.capital; if (!cap || cap.mode !== "settled") continue;
      const ti = (cap.pos.y | 0) * tw + (((cap.pos.x | 0) % tw) + tw) % tw;
      if (elev[ti] <= 0) continue;
      const pow = powerOfCapital(c);
      const logi = (cap._techEff ? cap._techEff.logisticsLevel : 0) || (((cap.knowledge && cap.knowledge.construction) || 0) ** 2);
      const nav = (cap.knowledge && cap.knowledge.navigation) || 0;
      raw.push({ cid, ti, logi, nav }); pows.push(pow); raw[raw.length - 1].pow = pow;
    }
    if (raw.length) {
      pows.sort((a, b) => a - b); const med = Math.max(1e-6, pows[pows.length >> 1]);
      for (const r of raw) {
        // emergent budget = (base + logistics reach) × a power multiplier around the median (a
        // hegemon reaches past the midpoint; a weakling holds a core). √ so it compresses.
        const powMul = Math.max(0.5, Math.min(2.0, 1 + POW_SPAN * (Math.sqrt(r.pow / med) - 1)));
        srcP[r.cid] = (REACH_BASE + REACH_LOGI * Math.max(0, Math.min(1, r.logi))) * powMul;
        navById[r.cid] = Math.max(0, Math.min(1, r.nav));
        sources.set(r.cid, r.ti); alive.add(r.cid);
      }
    }
  }

  const no = world._ctrlOwnerNext, nh = world._ctrlHoldNext;
  // Decay pre-pass: standing control recedes by FADE each tick (DEAD_FADE for a dead realm's
  // orphaned land), so a march not reinforced by its source drops to wilderness over ~reach/
  // FADE ticks — rise and fall, continuous. Land AND coastal water carry the field (water is a
  // naval RELAY medium, never territory — consumers mask elev<=0 as sea).
  for (let t = 0; t < N; t++) {
    const o = owner[t];
    if (o >= 0) { no[t] = o; nh[t] = hold[t] - (alive.has(o) ? FADE : DEAD_FADE); if (nh[t] < 0) { nh[t] = 0; no[t] = -1; } }
    else { no[t] = -1; nh[t] = 0; }
  }
  // Propagate one hop (max-plus): t takes the highest (neighbour control − edge cost) — the
  // SOURCE nation's water-nav cost across a coast, else this tile's land cost. So control at t
  // = P − cheapest terrain path from the capital, and the border is where two realms' budgets
  // net out. Reads OLD hold/owner → synchronous/deterministic.
  // WAR: a winning attacker (world._warFront[t] = attacker id, world._warAdv[t] = margin)
  // gets an ADDITIVE reach bonus crossing INTO front tile t — its control there extends by
  // WAR_BONUS×margin cost-units past its normal reach, so the border bulges into the enemy;
  // additive + capped, so it can't inflate, and re-stamped each pass it advances the front
  // toward the capital.
  const wf = world._warFront, wa = world._warAdv, hasWar = !!(wf && wf.length === N);
  for (let t = 0; t < N; t++) {
    const ty = (t / tw) | 0, tx = t - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? t - tw : -1, ty < th - 1 ? t + tw : -1];
    const toWater = elev[t] <= 0;
    const landC = toWater ? 0 : cost[t];
    const wAtt = hasWar ? wf[t] : -1;                     // attacker assaulting t (else -1)
    const wBonus = wAtt >= 0 ? WAR_BONUS * Math.max(0, Math.min(2, wa[t])) : 0;
    let bh = nh[t], bo = no[t];
    for (let k = 0; k < 4; k++) {
      const nn = ns[k]; if (nn < 0) continue;
      const o = owner[nn]; if (o < 0 || !alive.has(o)) continue;
      const edge = toWater ? Math.max(0.4, WATER_COST - WATER_NAV * navById[o]) : landC;   // crossing a coast costs the source's naval reach
      let cand = hold[nn] - edge;
      if (o === wAtt) cand += wBonus;                    // this neighbour IS the attacker pushing into t → forward reach bonus
      if (cand > bh) { bh = cand; bo = o; }
    }
    nh[t] = bh; no[t] = bo;
  }
  // Pin sources (capitals) at full budget, then threshold: control ≤ CLAIM_MIN is wilderness.
  for (const [cid, ti] of sources) { const P = srcP[cid]; if (P > nh[ti]) nh[ti] = P; no[ti] = cid; }
  for (let t = 0; t < N; t++) { if (nh[t] <= CLAIM_MIN) { no[t] = -1; nh[t] = 0; } }

  world._ctrlOwner = no; world._ctrlHold = nh;
  world._ctrlOwnerNext = owner; world._ctrlHoldNext = hold;

  // CTRL_LIVE: the field IS the political map — publish it as _countryOwner (land only;
  // water carried the field only as a naval relay). The recompute (fieldPolityTerritory)
  // is skipped, so this per-tick copy is the sole author of the political map.
  // (T.CTRL_LIVE removed 2026-07: the block that copied the field into
  // _countryOwner — the "field IS the political map" prototype — failed its
  // gate on runaway consolidation; field-polity-spec keeps the design.)
}

// PRETTY MODE: draw the authoritative _countryOwner, BOUNDED + SMOOTHED (see the header note by the
// SRC_HOLD constants). Control seeds at capitals and spreads one hop/pass; it is cheap on a realm's
// OWN real land (fills gradually → smooth), a bit dearer into WILDERNESS (a thin uniform band), and
// BLOCKED from a neighbour's real land (never overwrites a weak realm). Reached own-land re-charges
// to SRC_HOLD, so control doesn't deplete with distance — the whole realm fills at a uniform level
// and the band width is identical for a hegemon and a city-state (size/resolution-independent). The
// drawn extent is therefore the REAL extent plus a fixed thin band — no vast flood, no √area budget.
function stepTrackingBounded(world, cost) {
  const N = world.N, tw = world.tw, th = world.th, elev = world.elev, co = world._countryOwner;
  const owner = world._ctrlOwner, hold = world._ctrlHold;
  const no = world._ctrlOwnerNext, nh = world._ctrlHoldNext;
  // 1) charge / decay: reached own-land (field owner == real owner) charges toward SRC_HOLD (a
  //    uniform source); anything else recedes by FADE (lost land and the outer band fade smoothly,
  //    turning the recompute's bursts into continuous motion).
  for (let t = 0; t < N; t++) {
    const o = owner[t];
    if (o >= 0 && o === co[t]) { let v = hold[t] + CHARGE; if (v > SRC_HOLD) v = SRC_HOLD; no[t] = o; nh[t] = v; }
    else if (o >= 0) { const v = hold[t] - TRK_FADE; if (v <= 0) { no[t] = -1; nh[t] = 0; } else { no[t] = o; nh[t] = v; } }
    else { no[t] = -1; nh[t] = 0; }
  }
  // 2) propagate one hop (max-plus). Edge cost for neighbour-owner o entering tile t: cheap on o's
  //    OWN real land (fills freely), +WILD_COST into wilderness (thin band), BLOCKED into another
  //    realm's real land. Water is a short relay (masked in the render) so coasts/near-islands link.
  //    Reads OLD owner/hold for neighbours → synchronous/deterministic.
  for (let t = 0; t < N; t++) {
    const ty = (t / tw) | 0, tx = t - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? t - tw : -1, ty < th - 1 ? t + tw : -1];
    const baseC = elev[t] <= 0 ? TRK_WATER : cost[t];
    const realT = co[t];
    let bh = nh[t], bo = no[t];
    for (let k = 0; k < 4; k++) {
      const nn = ns[k]; if (nn < 0) continue;
      const o = owner[nn]; if (o < 0) continue;
      let edge;
      if (o === realT) edge = baseC;                 // o's own real land: fill freely
      else if (realT < 0) edge = baseC + WILD_COST;  // wilderness: thin band
      else continue;                                  // another realm's real land: blocked (no overwrite)
      const cand = hold[nn] - edge;
      if (cand > bh) { bh = cand; bo = o; }
    }
    nh[t] = bh; no[t] = bo;
  }
  // 3) seed / pin capitals at SRC_HOLD (bootstrap, and keep every realm at least its seat), threshold.
  if (world.countries) {
    for (const [cid, c] of world.countries) {
      const cap = c.capital; if (!cap || cap.mode !== "settled") continue;
      const ti = (cap.pos.y | 0) * tw + (((cap.pos.x | 0) % tw) + tw) % tw;
      if (elev[ti] <= 0) continue;
      if (SRC_HOLD > nh[ti]) nh[ti] = SRC_HOLD;
      no[ti] = cid;
    }
  }
  for (let t = 0; t < N; t++) { if (nh[t] <= 0) { no[t] = -1; nh[t] = 0; } }
  world._ctrlOwner = no; world._ctrlHold = nh;
  world._ctrlOwnerNext = owner; world._ctrlHoldNext = hold;
}
