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
import { craftLegs, exportValueOf, monetization, METAL_W, getWealthReserve, findSettlementById } from "./settlement.js";
import { personalityOf } from "./personality.js";
import { getPolity } from "./entities.js";
import { recordIn, recordOut, IN_MATERIALS, OUT_MATERIALS } from "./money.js";
import { logEvent } from "./events.js";

// Good indices. staple/materials/luxury are PRIMARY (their production is
// governed by the food/territory/luxury systems — the goods layer prices
// them but does not reallocate their labour); the last five are the CRAFT
// sector, whose labour the layer allocates by profitability.
export const GOODS = ["staple", "materials", "ore", "metal", "cloth", "wares", "luxury", "services"];
export const G_STAPLE = 0, G_MATERIALS = 1, G_ORE = 2, G_METAL = 3, G_CLOTH = 4, G_WARES = 5, G_LUXURY = 6, G_SERVICES = 7;
// Craft-sector goods (labour-allocated), in _gShare order.
const CRAFTS = [G_ORE, G_METAL, G_CLOTH, G_WARES, G_SERVICES];
const N_CRAFT = 5;
// SHIPPABLE goods (Stage 2, T.GOODS_TRADE). Staple is excluded — grain flows
// up the food hierarchy (owner ruling, spec Open Question 1) and must not be
// double-counted; services are earned in place (the carrying trade), never
// crated. Order is irrelevant here — the trade pass sorts by price gap.
export const TRADABLE = [G_MATERIALS, G_ORE, G_METAL, G_CLOTH, G_WARES, G_LUXURY];

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

// ── Capital investment (T.GOODS_INVEST) ──────────────────────────────────
// Spare wealth buys PRODUCTIVE CAPACITY — mills, docks, workshop stock —
// in the craft that is locally most profitable (price × capability). The
// coin is CONSERVED: it buys capital goods from live trade partners (the
// same closed-supply pattern as construction, settlement.js), so a town
// with no living suppliers cannot conjure capital. Capacity depreciates,
// so capital must be renewed — rich towns compound their edge physically,
// poor ones fall behind: the growth engine between endowment and output.
// Chronicle thresholds: the crisis end of the price band, held long enough
// to be an episode (the cooldown), in a town with a real market.
const PRICE_EV_HI = 3.5, PRICE_EV_COOLDOWN = 2500, PRICE_EV_MIN_POP = 300;
const INVEST_FRAC   = 0.01;    // share of spare wealth a town commits per tick at lever 1 (patient capital)
const CAPX_PER_COIN = 0.002;   // capacity bought per coin at zero saturation (≈500 coin → +1.0)
const CAPX_MAX      = 1.0;     // capital can at most DOUBLE a craft's capability (land/skills still bind)
const CAPX_DEPREC   = 0.0005;  // per-tick depreciation (mills silt, docks rot — renewal or decline)

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
  // Stage 3 (T.GOODS_CHAIN): metal capability is SKILL-limited — metallurgy
  // as practised (capped by REACHABLE ore via _metalCap: an isolated culture
  // with no ore anywhere in reach still can't know iron) — and the ORE IN
  // HAND constraint moves to the INPUT side below (production gates on ore
  // availability = own extraction + imports). Sheffield: skill + shipped-in
  // ore. Without the chain, craftLegs' in-hand oreTier gate stands.
  cap[G_METAL]     = T.GOODS_CHAIN
    ? Math.min(k.metallurgy || 0, s._metalCap !== undefined ? s._metalCap : (k.metallurgy || 0)) * METAL_W
    : (legs["Metalwork"] || 0);
  // Stage 4 (T.GOODS_CLOTHQ): the MARKET cloth good is fine cloth, not
  // homespun. Every settlement clothes itself with homespun (never traded,
  // never marketed) — what made Flanders/Florence was that most regions
  // could NOT weave market-grade cloth. Quality gates on craft skill: below
  // journeyman construction (~0.5 craft) the output isn't market-grade at
  // all; above it, it grades up to the full leg. This is the mechanism the
  // Stage-2 finding called for — the universal climate floor stays (it IS
  // homespun), but it stops counting as tradable supply.
  const clothQ = T.GOODS_CLOTHQ
    ? Math.min(1, Math.max(0, (0.4 + (k.construction || 0) * 0.5 - 0.5) / 0.4))
    : 1;
  cap[G_CLOTH]     = (legs["Textiles"] || 0) * clothQ;
  cap[G_WARES]     = (legs["Pottery & leather"] || 0) + (legs["Crafted wares"] || 0);
  cap[G_LUXURY]    = s._luxSupply || 0;                         // coin units (its own pair below)
  cap[G_SERVICES]  = legs["Services & records"] || 0;
  // Invested capital multiplies its craft's capability (T.GOODS_INVEST —
  // built below from spare wealth, applied here so labour, production and
  // the ore chain all see the invested capacity coherently).
  if (T.GOODS_INVEST > 0 && s._gCapx) {
    const cx = s._gCapx;
    for (let c = 0; c < N_CRAFT; c++) cap[CRAFTS[c]] *= 1 + cx[c];
  }

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
  // Stage 3 (T.GOODS_CHAIN): the forge CONSUMES ore — metal output gates on
  // ore availability (own extraction + net imports, last sweep's _gNet).
  // CRUCIALLY the ore DEMAND below reads the UNGATED desired metal, or the
  // chain deadlocks: no ore → no metal → no ore demand → no price signal →
  // no imports. The starved smith keeps BIDDING for ore; the bid is the
  // signal that ships it. desiredMetal is what the smiths WANT to run.
  const desiredMetal = prod[G_METAL];
  if (T.GOODS_CHAIN) {
    const netNow = s._gNet;
    const oreAvail = Math.max(0, prod[G_ORE] + (netNow ? netNow[G_ORE] : 0));
    const oreNeed = desiredMetal * ORE_PER_METAL;
    if (oreNeed > EPS) prod[G_METAL] = desiredMetal * Math.min(1, oreAvail / oreNeed);
  }

  // ── Demand ────────────────────────────────────────────────────────────
  const pop = Math.max(1, s.people || 0);
  const dem = s._gDem || (s._gDem = new Array(8).fill(0));
  const cold = Math.max(0, 0.5 - (s._climTemp ?? 0.5));         // 0 warm → 0.5 polar
  const monet = monetization(s);
  dem[G_STAPLE]    = s._foodDemand || 0;
  dem[G_MATERIALS] = pop * MAT_PC * (0.5 + (k.construction || 0));
  dem[G_ORE]       = desiredMetal * ORE_PER_METAL;              // smiths bid for the ore they WANT (ungated — see the chain note above)
  // Wartime procurement (T.ARMY_PROCURE): a realm AT WAR burns kit —
  // weapons wear, arrows are spent, mounts are lost — so the ARMY's metal
  // demand (not the civilian term) scales with the realm's live war
  // intensity (conquest.js warLevel: fronts + siege/raid state, cached on
  // the polity each pass). Forges lean to metal and ore imports swell in
  // wartime, realm-wide, through nothing but the price system.
  let armsMul = 1;
  if (T.ARMY_PROCURE > 0 && s.countryId >= 0) {
    const gov = getPolity(world, s.countryId);
    const wl = (gov && gov._warLevel) || 0;
    if (wl > 0) armsMul = 1 + T.ARMY_PROCURE * Math.min(3, wl);
  }
  dem[G_METAL]     = pop * METAL_PC + (s.army || 0) * ARMS_PC * armsMul;
  // Under CLOTHQ, market-cloth demand is the MONETIZED share of clothing
  // consumption — the subsistence remainder is met by homespun (the same
  // split the supply side makes; a coinless hamlet neither sells nor buys
  // fine cloth). Historically clothing was the classic wealth-elastic
  // purchase: market cloth consumption rose steeply as economies monetized.
  dem[G_CLOTH]     = pop * CLOTH_PC * (1 + COLD_CLOTH * cold * 2)
                   * (T.GOODS_CLOTHQ ? 0.15 + 0.85 * monet : 1);
  dem[G_WARES]     = pop * WARES_PC;
  dem[G_LUXURY]    = s._luxDemand || 0;
  dem[G_SERVICES]  = pop * SVC_PC * (0.25 + 0.75 * monet);      // cash economies demand clerks & credit
  // Stage 4 (T.GOODS_TEMPER): the realm's TEMPERAMENT colours its demand —
  // a martial court arms (metal), a mercantile one contracts and banks
  // (services). Weighted by the lever and only on the positive pole, so
  // temperament finally shapes WHAT a society wants, not just how many
  // roads it builds (analysis F6). Read from the polity's personality —
  // deterministic, seeded, drifting with lived history (personality.js).
  if (T.GOODS_TEMPER > 0 && s.countryId >= 0 && world.countries) {
    const c = world.countries.get(s.countryId);
    const p = c ? personalityOf(world, c) : null;
    if (p) {
      if (p.aggression > 0) dem[G_METAL]    *= 1 + T.GOODS_TEMPER * p.aggression;
      if (p.commerce   > 0) dem[G_SERVICES] *= 1 + T.GOODS_TEMPER * p.commerce;
    }
  }

  // ── Price relaxation ──────────────────────────────────────────────────
  // Local scarcity price per good: relax toward clamp((D/AVAIL)^ELAST),
  // where availability = own production + net trade (Stage 2: imports ADD
  // to the local market, exports REMOVE from it — the classic coupling:
  // grain exports raised bread prices at home, imports glutted them). With
  // no goods trade (_gNet absent / Stage 1) avail = prod exactly. Damped
  // (GOODS_PRICE_ADAPT) so shocks ripple over ticks instead of snapping —
  // no solver, no oscillation, deterministic.
  const net = s._gNet;   // per-tick net goods received, built by the trade pass
  const elast = T.GOODS_ELAST, adapt = Math.min(1, T.GOODS_PRICE_ADAPT * dt);
  for (let g = 0; g < 8; g++) {
    const avail = Math.max(0, prod[g] + (net ? net[g] : 0));
    let target = Math.pow((dem[g] + EPS) / (avail + EPS), elast);
    if (target < P_LO) target = P_LO; else if (target > P_HI) target = P_HI;
    P[g] += adapt * (target - P[g]);
  }

  // ── Craft labour reallocation (the profit motive) ─────────────────────
  // Target share ∝ price × capability — labour drifts toward what is both
  // locally DEAR and locally DOABLE. Slow (guilds retrain over years, not
  // ticks); renormalised so Σ = 1. A town with no craft capability at all
  // keeps its shares (nothing to allocate).
  let wSum = 0, cBest = 0, wBest = -1;
  for (let c = 0; c < N_CRAFT; c++) {
    const w = P[CRAFTS[c]] * cap[CRAFTS[c]];
    wSum += w;
    if (w > wBest) { wBest = w; cBest = c; }
  }
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

  // ── Price extremes enter the CHRONICLE ────────────────────────────────
  // Dearth years and boom years were what pre-modern chronicles actually
  // recorded about the economy. A sustained price at the crisis end of the
  // band logs once per episode (cooldown), for a town big enough to have a
  // market worth chronicling. Log-only — no sim behaviour changes here.
  if (s.people > PRICE_EV_MIN_POP && world.step - (s._lastPriceEv || -Infinity) > PRICE_EV_COOLDOWN / dt) {
    if (P[G_STAPLE] >= PRICE_EV_HI) {
      s._lastPriceEv = world.step;
      logEvent(world, "market.dearth", { s: s.id, sName: s.name || "a town" });
    } else {
      for (let c = 0; c < N_CRAFT; c++) {
        const g = CRAFTS[c];
        if (P[g] >= PRICE_EV_HI && prod[g] > dem[g]) {   // dear AND it's the local trade — a boom, not a shortage
          s._lastPriceEv = world.step;
          logEvent(world, "market.boom", { s: s.id, sName: s.name || "a town", good: GOODS[g] });
          break;
        }
      }
    }
  }

  // ── Capital investment (see constants above) ──────────────────────────
  // Depreciate always (capital rots whether or not new coin comes), invest
  // spare wealth into the most profitable craft, paying LIVE suppliers —
  // conserved coin, same pattern as construction. No suppliers → no
  // capital goods to buy (an isolated town cannot invest its way up).
  if (T.GOODS_INVEST > 0) {
    let cx = s._gCapx;
    if (!cx) cx = s._gCapx = [0, 0, 0, 0, 0];
    const dep = 1 - CAPX_DEPREC * dt;
    for (let c = 0; c < N_CRAFT; c++) cx[c] *= dep;
    const spare = (s.wealth || 0) - getWealthReserve(s);
    if (spare > 1 && wBest > EPS && cx[cBest] < CAPX_MAX && s._tradeReach && s._tradeReach.size > 0) {
      let invest = spare * INVEST_FRAC * T.GOODS_INVEST * dt;
      if (invest > 0.01) {
        // Pay the live partners (equal split by headcount — hire builders,
        // buy fittings from the neighbourhood). Recompute liveness inline so
        // a dead partner can't receive coin (the construction-pass rule).
        const recips = [];
        for (const pid of s._tradeReach.keys()) {
          const p = findSettlementById(world, pid);
          if (p && p.mode === "settled") recips.push(p);
        }
        if (recips.length > 0) {
          s.wealth -= invest;
          recordOut(s, OUT_MATERIALS, invest);
          const share = invest / recips.length;
          for (const p of recips) { p.wealth = (p.wealth || 0) + share; recordIn(p, IN_MATERIALS, share); }
          cx[cBest] = Math.min(CAPX_MAX, cx[cBest] + invest * CAPX_PER_COIN * (1 - cx[cBest] / CAPX_MAX));
        }
      }
    }
  }
}

// The craft-label → good mapping the price-weighted specialty pick reads
// (settlement.js). Both everyday-craft legs map to WARES (same market).
export const LEG_GOOD = {
  "Textiles": G_CLOTH, "Metalwork": G_METAL,
  "Pottery & leather": G_WARES, "Crafted wares": G_WARES,
  "Services & records": G_SERVICES,
};
