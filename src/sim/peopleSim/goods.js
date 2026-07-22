// ── The goods vector (T.GOODS_PRICES — goods-vector Stage 1) ─────────────────
//
// docs/economy-goods-vector-spec.md. The economy's state today is ONE scalar
// per settlement (exportValue) — specialisation, complementarity and supply
// chains are unrepresentable in it. This module adds the vector the spec
// pivots on: per settlement, per GOOD — production, demand, and a LOCAL
// SCARCITY PRICE that says what this place is short of and long on.
//
// Stage 1 scope (deliberately narrow): the vectors are computed, prices
// relax, and labour drifts toward the profitable crafts — but TRADE IS STILL
// THE SCALAR FLOW. Prices inform the specialty pick (a price-weighted
// Ricardian score) and are displayable/probeable; the goods do not move yet.
// Stage 2 replaces the symmetric money flow with price-equalising goods
// flow; Stage 3 makes metal CONSUME ore (the first real supply chain). The
// spatial price DISPERSION this stage exposes (an oreless town's ore price
// pinned at the cap, a breadbasket's staple near the floor) is precisely the
// gradient Stage 2 will trade against.
//
// Everything keys on state — endowment, knowledge, population, wealth, army,
// food balance — never on time (first cardinal rule). Parameters are
// physical quantities (per-capita consumption rates, adaptation speeds),
// never fitted outcomes (second rule): prices land wherever local scarcity
// puts them, and the map's pattern falls out.
//
// Units note: a price is DEMAND/SUPPLY within one good — only within-good
// unit consistency matters, so each good uses its own natural pair:
// staple reads the food system's (demand, supply), luxury the luxury
// budgets, and the five CRAFTS read export-$ (craftLegs scale) against
// per-capita consumption in the same scale. Cross-good comparison happens
// only through the dimensionless prices.

import { T } from "./tuning.js";
import { craftLegs, exportValueOf, monetization } from "./settlement.js";

// Good indices. staple/materials/luxury are PRIMARY (their production is
// governed by the food/territory/luxury systems — the goods layer prices
// them but does not reallocate their labour); the last five are the CRAFT
// sector, whose labour the layer allocates by profitability.
export const GOODS = ["staple", "materials", "ore", "metal", "cloth", "wares", "luxury", "services"];
export const G_STAPLE = 0, G_MATERIALS = 1, G_ORE = 2, G_METAL = 3, G_CLOTH = 4, G_WARES = 5, G_LUXURY = 6, G_SERVICES = 7;
// Craft-sector goods (labour-allocated), in _gShare order.
const CRAFTS = [G_ORE, G_METAL, G_CLOTH, G_WARES, G_SERVICES];
const N_CRAFT = 5;

// Price band. A price is a local scarcity signal, not a market clearing —
// bounded so a zero-capability good (an oreless town's ore) reads "dear,
// import me" rather than infinity, and a glut reads "cheap" without going
// to zero. [floor, cap] spans ×16 — comparable to real pre-modern regional
// commodity spreads (grain price ratios of ~10-20× between glut provinces
// and famine provinces are documented; metals spread less, cloth more).
const P_LO = 0.25, P_HI = 4.0;
const EPS = 0.01;   // ÷0 guard on both sides of the ratio

// Per-capita consumption rates, in the craft-sector's export-$ scale per
// tick. Anchored by scale coherence: a mid-sized town (~500 people) should
// DEMAND roughly what a mid-sized town's sector CAN produce (craftLegs
// ~0.3-2), so the ratio — the price — sits near 1 where supply matches its
// own population's needs and departs where geography or development skews
// it. Consumption structure, not targets:
const CLOTH_PC  = 0.0024;  // everyone wears cloth — the largest craft demand
const WARES_PC  = 0.0020;  // pots, leather, tools of daily life
const METAL_PC  = 0.0008;  // tools & fittings — scarce, durable, reused
const ARMS_PC   = 0.004;   // a soldier's kit is metal-hungry (× army, not pop)
const MAT_PC    = 0.0012;  // building timber/stone per head (scaled by construction activity below)
const SVC_PC    = 0.0015;  // clerks, contracts, finance (scaled by monetization below)
const COLD_CLOTH = 0.8;    // cloth demand rises toward cold climates (×(1+COLD_CLOTH·coldness))
const ORE_PER_METAL = 1.0; // ore units consumed per unit of metal produced (defines the ore unit; the Stage-3 chain will enforce it)

// Ore EXTRACTION capability: graded ore endowment (all four ores — what the
// ground offers) worked by organised labour. W_ORE puts a real mining
// district's extraction on the same scale as its Metalwork leg, so the
// ore→metal pair prices sanely before Stage 3 couples them physically.
const W_ORE = 1.5;

// A craft can pull at most this multiple of its "even-attention" output by
// full dedication (5 crafts → even share = 1/5 → multiplier 1). Diminishing
// returns on labour: a town can roughly 2.5× a sector by committing to it,
// not 5× — capacity is also capital, skills, and ground.
const DEDICATION_CAP = 2.5;

// Compute this settlement's goods vectors for the tick: production, demand,
// the relaxed local price, and the (slowly reallocating) craft labour
// shares. Called from updateSettlement after the wealth/luxury/coerced
// passes so _luxSupply (incl. cash crops), _foodSupply/_foodDemand and
// wealth are fresh. Reads only the settlement's own state → deterministic
// and order-independent.
export function updateGoods(world, s) {
  if (!T.GOODS_PRICES || s.mode !== "settled") return;
  const dt = world._dt || 1;
  // Persistent state (SETT_FIELDS): prices + labour shares carry memory.
  let P = s._gPrice, L = s._gShare;
  if (!P || P.length !== 8) P = s._gPrice = [1, 1, 1, 1, 1, 1, 1, 1];
  if (!L || L.length !== N_CRAFT) L = s._gShare = [0.2, 0.2, 0.2, 0.2, 0.2];

  const k = s.knowledge || {}, r = s.localRes || {};
  const legs = craftLegs(s, k, r);
  const ev = exportValueOf(s, world);   // memoised; also refreshes _exportFoodFrac/_exportMatFrac

  // ── Capability (output at even attention) per good ────────────────────
  // Primary sector from the scalar economy's own decomposition (zero drift):
  // agFood/agMat are exportValue × the fractions computeExportValue set.
  const cap = s._gCap || (s._gCap = new Array(8).fill(0));
  cap[G_STAPLE]    = s._foodSupply || 0;                        // food units (its own pair below)
  cap[G_MATERIALS] = ev * (s._exportMatFrac || 0);
  cap[G_ORE]       = ((r.copper || 0) + (r.tin || 0) + (r.iron || 0) + (r.coal || 0)) * (0.3 + 0.7 * (k.organization || 0)) * W_ORE;
  cap[G_METAL]     = legs["Metalwork"] || 0;
  cap[G_CLOTH]     = legs["Textiles"] || 0;
  cap[G_WARES]     = (legs["Pottery & leather"] || 0) + (legs["Crafted wares"] || 0);
  cap[G_LUXURY]    = s._luxSupply || 0;                         // coin units (its own pair below)
  cap[G_SERVICES]  = legs["Services & records"] || 0;

  // ── Production ────────────────────────────────────────────────────────
  // Primary goods produce at their governing system's level; crafts produce
  // capability × dedication (share × N_CRAFT, capped — see DEDICATION_CAP).
  const prod = s._gProd || (s._gProd = new Array(8).fill(0));
  prod[G_STAPLE] = cap[G_STAPLE];
  prod[G_MATERIALS] = cap[G_MATERIALS];
  prod[G_LUXURY] = cap[G_LUXURY];
  for (let c = 0; c < N_CRAFT; c++) {
    const g = CRAFTS[c];
    prod[g] = cap[g] * Math.min(DEDICATION_CAP, N_CRAFT * L[c]);
  }

  // ── Demand ────────────────────────────────────────────────────────────
  const pop = Math.max(1, s.people || 0);
  const dem = s._gDem || (s._gDem = new Array(8).fill(0));
  const cold = Math.max(0, 0.5 - (s._climTemp ?? 0.5));         // 0 warm → 0.5 polar
  dem[G_STAPLE]    = s._foodDemand || 0;
  dem[G_MATERIALS] = pop * MAT_PC * (0.5 + (k.construction || 0));
  dem[G_ORE]       = prod[G_METAL] * ORE_PER_METAL;             // smiths eat ore (physical coupling lands in Stage 3)
  dem[G_METAL]     = pop * METAL_PC + (s.army || 0) * ARMS_PC;
  dem[G_CLOTH]     = pop * CLOTH_PC * (1 + COLD_CLOTH * cold * 2);
  dem[G_WARES]     = pop * WARES_PC;
  dem[G_LUXURY]    = s._luxDemand || 0;
  dem[G_SERVICES]  = pop * SVC_PC * (0.25 + 0.75 * monetization(s));   // cash economies demand clerks & credit

  // ── Price relaxation ──────────────────────────────────────────────────
  // Local scarcity price per good: relax toward clamp((D/S)^ELAST). Damped
  // (GOODS_PRICE_ADAPT) so shocks ripple over ticks instead of snapping —
  // no solver, no oscillation, deterministic.
  const elast = T.GOODS_ELAST, adapt = Math.min(1, T.GOODS_PRICE_ADAPT * dt);
  for (let g = 0; g < 8; g++) {
    let target = Math.pow((dem[g] + EPS) / (prod[g] + EPS), elast);
    if (target < P_LO) target = P_LO; else if (target > P_HI) target = P_HI;
    P[g] += adapt * (target - P[g]);
  }

  // ── Craft labour reallocation (the profit motive) ─────────────────────
  // Target share ∝ price × capability — labour drifts toward what is both
  // locally DEAR and locally DOABLE. Slow (guilds retrain over years, not
  // ticks); renormalised so Σ = 1. A town with no craft capability at all
  // keeps its shares (nothing to allocate).
  let wSum = 0;
  for (let c = 0; c < N_CRAFT; c++) wSum += P[CRAFTS[c]] * cap[CRAFTS[c]];
  if (wSum > EPS) {
    const lAdapt = Math.min(1, T.GOODS_LABOUR_ADAPT * dt);
    let sum = 0;
    for (let c = 0; c < N_CRAFT; c++) {
      const target = P[CRAFTS[c]] * cap[CRAFTS[c]] / wSum;
      L[c] += lAdapt * (target - L[c]);
      if (L[c] < 0) L[c] = 0;
      sum += L[c];
    }
    if (sum > 0) for (let c = 0; c < N_CRAFT; c++) L[c] /= sum;
  }
}

// The craft-label → good mapping the price-weighted specialty pick reads
// (settlement.js). Both everyday-craft legs map to WARES (same market).
export const LEG_GOOD = {
  "Textiles": G_CLOTH, "Metalwork": G_METAL,
  "Pottery & leather": G_WARES, "Crafted wares": G_WARES,
  "Services & records": G_SERVICES,
};
