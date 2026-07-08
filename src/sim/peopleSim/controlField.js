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
  // Sources + per-nation reach BUDGET (P, cost-units) and water navigation, anchored to the
  // median power (relative size, not a fitted absolute).
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
        // budget = (base + logistics reach) × a power multiplier around the median (a hegemon
        // reaches past the midpoint; a weakling holds a core). √ so it compresses.
        const powMul = Math.max(0.5, Math.min(2.0, 1 + POW_SPAN * (Math.sqrt(r.pow / med) - 1)));
        srcP[r.cid] = (REACH_BASE + REACH_LOGI * Math.max(0, Math.min(1, r.logi))) * powMul;
        navById[r.cid] = Math.max(0, Math.min(1, r.nav));
        sources.set(r.cid, r.ti); alive.add(r.cid);
      }
    }
  }

  const cost = landCost(world);
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
  if (T.CTRL_LIVE) {
    let co = world._countryOwner;
    if (!co || co.length !== N) co = world._countryOwner = new Int32Array(N).fill(-1);
    for (let t = 0; t < N; t++) co[t] = elev[t] > 0 ? no[t] : -1;
  }
}
