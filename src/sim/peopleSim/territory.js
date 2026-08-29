// ── Territory ────────────────────────────────────────────────────────
//
// Each settlement claims the land it can reach most cheaply, out to a
// reach budget. Territory is PERSISTENT: once a tile is claimed it stays
// with its owner — settlements only expand into UNCLAIMED wilderness, and
// a neighbour's land is a wall they grow around, never over. So borders
// form once and hold; they only move when a settlement dies (its land
// returns to wilderness for survivors to take) or when it grows into new
// wilderness. This kills the every-pass border shimmer the old "rebuild
// the whole Voronoi from scratch each pass" approach produced.
//
// A small CORE around every home is always owned (carved even from a
// neighbour), so a freshly-founded town boxed in by an older one still
// gets a minimum domain to live on.
//
// Food drawn from a tile falls off with transport distance: near land is
// worked intensively, far land only lightly provisions the centre — and
// roads / rivers, by cutting the cost, pull more food in from afar (the
// Roman grain-lane effect). Resource CONTROL extends to the full domain
// edge (you tax/own the whole territory even if you don't farm it).

import { localEdgeCost } from "./transport.js";
import { forEachNear } from "./spatialGrid.js";
import { landSurplusFrac } from "./landSurplus.js";
import { T, rNormPop } from "./tuning.js";

// Reach budget, in transport-cost units (a plain tile = 1.0). Pure
// function of ORGANIZATION — the centre's willingness/ability to
// project administrative authority across distance, full stop.
//
// Other tech (construction, mobility, navigation) is NOT in the budget
// — it enters through localEdgeCost, reducing per-tile cost. The two
// interact correctly: organization buys you REACH; other tech buys you
// EFFICIENCY per step. A high-construction realm pays less per
// mountain tile (so it can hold more mountains within its budget), but
// it doesn't get a bigger budget for free. The chronicle of empires
// rising and falling is then ORG growing and shrinking, not a stew of
// four tracks moving together.
//
// Calibration: a plain tile costs ~1.0, so the radius in plains
// roughly equals the budget. Era-typical:
//   stone (org 0.05):  ~7  → ~7-tile plain radius   (city-state)
//   bronze (org 0.30): ~17 → ~17-tile radius        (kingdom)
//   iron (org 0.50):   ~25 → ~25-tile radius        (regional empire)
//   industrial (0.90): ~41 → ~41-tile radius        (continental)
//
// Across mountains the SAME budget reaches fewer tiles; with navy it
// can hop across coastal water at ~3 cost per tile and reach further.
const TERRITORY_BASE = 5;
// ORG_REACH -> runtime lever (tuning.js T.ORG_REACH)

// ── Per-tile DESIRABILITY ("value") field ────────────────────────────────
// A tile has TWO independent spatial properties: how HARD it is to reach/hold (the transport
// COST — terrain, aridity, the river highway; localEdgeCost) and how much it is WORTH holding
// (its food potential — this field). They are kept SEPARATE and both mutable, so each can shift
// in-sim on its own: difficulty drops as a civ gets roads/ships; value climbs as it learns to
// irrigate a desert valley. The territory claim weighs value ÷ difficulty, which is the force
// that pulls a border DOWN a fertile valley instead of leaving it in the cheapest-nearest blob.
//
// Seeded from fertility, with the river FLOODPLAIN lifted to prime-cropland value even where its
// bare desert fertility is patchy — an irrigated alluvial valley (the Nile's black land) is worth
// far more than its raw soil reads, and that is exactly the land a cradle should reach to annex.
const FLOOD_VALUE = 0.90;   // a floodplain is prime cropland — worth holding regardless of patchy bare fert
const RIVER_VALUE = 0.55;   // the river corridor itself is a valued artery (banks, fishing, transport)
// VALUE_PULL -> runtime lever (tuning.js T.VALUE_PULL): how strongly value extends/redirects reach.
export function initTileValue(world) {
  const N = world.tw * world.th;
  const fert = world.fert, flood = world.tFlood, rm = world.riverMag, elev = world.elev;
  const val = world._tileValue = new Float32Array(N);
  for (let ti = 0; ti < N; ti++) {
    if (elev[ti] <= 0) continue;                 // water is worth nothing to hold
    let v = fert[ti] || 0;
    if (flood && flood[ti]) v = Math.max(v, FLOOD_VALUE);
    else if (rm && rm[ti] >= 2) v = Math.max(v, RIVER_VALUE);
    val[ti] = v > 1 ? 1 : v;
  }
  return val;
}
// T.MARKET_PULL's shared carriage knowledge — see the localEdgeCost call below.
// The route costs what the route costs, whoever is buying: carriage is a property
// of the ROUTE and THE AGE, not of the purchaser. Built each pass as the
// element-wise best knowledge in the world, because grain moved on the best
// shipping available, not on the buyer's own — Rome ate Egyptian wheat carried by
// professional grain fleets it did not itself own.
//   THIS MUST NOT BE EMPTY. An empty object means no navigation, and
// localEdgeCost returns Infinity for water without the nav floor — so every
// market became land-locked and no ring could ever cross water, which is exactly
// the sea-borne grain that let real cities feed past the 340 km land limit.
// Measured with it empty: the gate world fell to 10 settlements.
const _MARKET_KN = {};
function _rebuildMarketKn(byId) {
  for (const k in _MARKET_KN) delete _MARKET_KN[k];
  for (const s of byId.values()) {
    const kn = s.knowledge; if (!kn) continue;
    for (const k in kn) { const v = kn[k]; if (typeof v === "number" && !(_MARKET_KN[k] >= v)) _MARKET_KN[k] = v; }
  }
}

// Coarse fingerprint of the inputs that reshape the MARKET_PULL partition.
// Quantised so granary-EMA dust does not thrash a full continent flood; a real
// relative-standing shift, birth/death, haul-tech step, or road topology bump
// still dirties. Used only to choose flood vs tally-only — never to invent a buyer.
function _marketFloodSig(byId, seedOf, haulTiles, roadVersion) {
  let h = (Math.round(haulTiles * 4) | 0) ^ ((roadVersion | 0) * 10007);
  h = (h * 1000003) ^ (byId.size * 131);
  for (const s of byId.values()) {
    // Relative seed already carries A_i/Abar; ~0.25-tile bins.
    const q = Math.round((seedOf.get(s.id) || 0) * 4);
    h = (h * 1000003) ^ (s.id * 131 + (q | 0));
  }
  const kn = _MARKET_KN;
  h = (h * 1000003) ^ Math.round((kn.construction || 0) * 200);
  h = (h * 1000003) ^ Math.round((kn.mobility || 0) * 200);
  h = (h * 1000003) ^ Math.round((kn.navigation || 0) * 200);
  return h | 0;
}

function _ensureTerrScratch(world, N) {
  let cost2 = world._terrCost2;
  if (!cost2 || cost2.length !== N) cost2 = world._terrCost2 = new Float32Array(N);
  let tcost2 = world._terrTrueCost2;
  if (!tcost2 || tcost2.length !== N) tcost2 = world._terrTrueCost2 = new Float32Array(N);
  let clm2 = world._terrClaimant2;
  if (!clm2 || clm2.length !== N) clm2 = world._terrClaimant2 = new Int32Array(N);
  return { cost2, tcost2, clm2 };
}

/** Persistent Int32 scratch of length N — replaces per-flood `owner.slice()` (allocation-wall). */
function _ensureTerrOwnerCopy(world, key, N) {
  let a = world[key];
  if (!a || a.length !== N) a = world[key] = new Int32Array(N);
  return a;
}

// After the bid Dijkstra: keep the incumbent unless the challenger is HYST×
// better on the SAME pass's effort metric (second-best slot). Marketing habit —
// standing farm-gate relationships do not flip on float dust.
function _applyMarketHysteresis(owner, cost, tcost, clm, prevOwner, cost2, tcost2, clm2, byId, N, hyst) {
  if (!(hyst > 1)) return;
  for (let ti = 0; ti < N; ti++) {
    const po = prevOwner[ti];
    const no = owner[ti];
    if (po < 0 || no === po || !byId.has(po)) continue;
    if (clm2[ti] !== po) continue;   // incumbent was not even second — clear loss
    const pc = cost2[ti], nc = cost[ti];
    // Claimed MARKET_PULL costs are strictly negative (ring edge is nd >= 0).
    // Challenger must be HYST× better: nc < pc * hyst (e.g. −12 beats −10 at 1.15).
    if (nc < pc * hyst) continue;
    owner[ti] = po;
    cost[ti] = pc;
    tcost[ti] = tcost2[ti];
    clm[ti] = po;
  }
}

export function reachBudget(s) {
  // URBAN_NODES: towns/cities (tier 1+) are urban nodes, not farmland owners —
  // they keep only their guaranteed core block, so the whole rural catchment
  // falls to the tier-0 Farming Regions (which feed them via the hierarchy).
  // Zero economic reach → the cost-Dijkstra adds nothing beyond the core. This
  // touches ONLY the economic catchment; the political border layer
  // (countryTerritory.js) has its own capital-anchored reach and is unaffected.
  // (URBAN_NODES + LOCALITY_MODE removed 2026-07: both experiments were
  // superseded by the shipped DISSOLVE_FARMS region model.)
  // Admin reach now comes from the reach techs (tech.js) via the settlement's
  // cached effects (reachLevel tracks organization); falls back to continuous
  // organization if the cache isn't computed yet.
  const reach = s._techEff ? s._techEff.reachLevel : ((s.knowledge && s.knowledge.organization) || 0);
  return TERRITORY_BASE + reach * T.ORG_REACH;
}

// Per-tile food weight by distance: 1 next to the centre, tailing off with
// transport cost so a sprawling claim doesn't linearly inflate food.
// Distance discount on a tile's food. Steep by default (a village farms what it
// can walk to). In LOCALITY mode it's gentle: a locality's rural population is
// spread ACROSS its catchment and works the whole thing, so far tiles still
// count — otherwise widening the catchment just adds discounted-to-nothing land.
function foodFalloff(cost) { return 1 / (1 + cost * 0.5); }

// Plantability floor (same idea as before): below this fertility a tile
// yields too little to feed anyone. Eased by agriculture knowledge.
const MIN_PLANTABLE_FERT_BASE  = 0.30;
const MIN_PLANTABLE_FERT_SLOPE = 0.20;

const SQRT2 = Math.SQRT2;

// Guaranteed home block (radius in tiles). Always owned by the settlement,
// stolen from a neighbour if need be. Kept smaller than half the minimum
// settlement spacing (MIN_SETT_DIST=12) so two cores can never overlap.
// Guaranteed home block. Its radius scales with the settlement's TIER, so a
// hamlet holds only its home cluster while a city commands a broad heartland
// — that size gap is what reads as a hierarchy on the map, and small village
// cores let settlements pack in densely without fighting over the same land.
const CORE_BY_TIER = [1, 2, 3, 4];
// THE CORE BLOCK IS DELIBERATELY *NOT* SCALED, and the header three lines up says
// why: it is "kept smaller than half the minimum settlement spacing … so two cores
// can never overlap." That invariant COUPLES this constant to crystallize.js's
// MIN_SETT_DIST, so scaling one without the other breaks it. Caught by re-reading my
// own diff: with the core scaled, tw=480 gives radius 4→8 against an unscaled spacing
// floor of 8 — core radius equal to the whole spacing, cores overlapping wholesale.
// Only the HINTERLAND belt scales here. That belt is claimed nearest-wins and is
// MEANT to be contended, so widening it cannot violate anything; the guaranteed home
// block is an exclusivity promise and moves only when spacing moves with it.
// (Recorded while here, pre-existing and not mine: the header says MIN_SETT_DIST=12
// and the constant is 8, and CORE_BY_TIER's top rung is 4 — which is exactly half of
// 8, not "smaller than half". The invariant is already marginal at the metropolis
// rung in shipped code, at every grid. Named, not touched: it belongs to the spacing
// lap with the rest of the fifth site.)
export function coreRadiusFor(s, world) {
  // T.MARKET_PULL retires CORE_BY_TIER for catchment carving — the home block is
  // emergent from the bid. armies.js still reads this for assault reach; use a
  // minimal footprint so siege geometry does not inherit a discontinuous tier grant.
  if (T.MARKET_PULL > 0) return 1;
  const t = s.tier | 0;
  return CORE_BY_TIER[t < 0 ? 0 : t > 3 ? 3 : t];
}

// Beyond the guaranteed core, every settlement is also GUARANTEED a farmland
// HINTERLAND out to this radius (by tier), claimed nearest-settlement-wins so a
// dominant city can't hoard all the shared countryside and a densely-packed
// town is never squeezed down to its bare core block. This belt is the land a
// region genuinely owns — and therefore carries with it when it secedes.
// Scaled by T.HINTERLAND_MULT (tuning.js); never smaller than the core.
const HINTERLAND_BY_TIER = [3, 4, 6, 8];
export function hinterlandRadiusFor(s, world) {
  // T.MARKET_PULL retires HINTERLAND_BY_TIER — the farm belt is what the bid wins.
  if (T.MARKET_PULL > 0) return coreRadiusFor(s, world);
  const t = s.tier | 0;
  const base = HINTERLAND_BY_TIER[t < 0 ? 0 : t > 3 ? 3 : t];
  return Math.max(coreRadiusFor(s, world), Math.round(base * T.HINTERLAND_MULT));
}

class MinHeap {
  constructor(cap = 4096) {
    this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.n = 0; this.cap = cap;
    this._maxCap = Math.max(cap * 4, 1 << 20);
  }
  _grow() {
    const c = this.cap * 2;
    if (c > this._maxCap) throw new Error(`territory frontier heap exceeded cap ${this.cap}→${c}`);
    try {
      const t = new Int32Array(c); t.set(this.ti); const d = new Float64Array(c); d.set(this.d);
      this.ti = t; this.d = d; this.cap = c;
    } catch (err) {
      throw new Error(`territory frontier grow ${this.cap}→${c} failed: ${err && err.message}`);
    }
  }
  push(ti, d) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; const tt = this.ti[p], td = this.d[p]; this.ti[p] = this.ti[i]; this.d[p] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = p; } }
  popMin() { const ti = this.ti[0], d = this.d[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; const tt = this.ti[b], td = this.d[b]; this.ti[b] = this.ti[i]; this.d[b] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = b; } } return { ti, d }; }
}

// Resources whose richness we track per territory (gates knowledge + feeds
// export goods). Precious/gems also feed mining wealth.
const TERR_RES = ['timber','stone','copper','tin','iron','coal','horses','salt','precious','gems','spices','furs','incense','dyes'];

// Recover ruin hoards: coin stranded where settlements died re-enters
// circulation when a LIVE settlement's territory covers the ruin, at a rate
// scaled by its organization (excavation, squatters, stone-robbing — a
// bureaucratic state strips a ruin fast, a hamlet stumbles on pots slowly).
// Fires purely from territorial coverage — never from time.
const RUIN_RECLAIM = 0.15;   // share of a covered hoard recovered per territory pass at full organization
function reclaimRuins(world) {
  const m = world._ruinHoards;
  if (!m || !m.size) return;
  const owner = world._territoryOwner, byId = world._byId;
  if (!owner || !byId) return;
  for (const [ti, coin] of m) {
    const oid = owner[ti];
    if (oid < 0) continue;
    const s = byId.get(oid);
    if (!s || s.mode !== "settled") continue;
    const take = coin * RUIN_RECLAIM * Math.max(0.1, (s.knowledge && s.knowledge.organization) || 0);
    if (take > 0.01) {
      s.wealth = (s.wealth || 0) + take;
      const left = coin - take;
      if (left < 0.5) m.delete(ti); else m.set(ti, left);
    } else if (coin < 0.5) m.delete(ti);
  }
}

export function computeTerritory(world) {
  const { N, tw, th, elev } = world;
  let owner = world._territoryOwner;
  if (!owner || owner.length !== N) { owner = world._territoryOwner = new Int32Array(N); owner.fill(-1); }
  let cost = world._territoryCost;
  if (!cost || cost.length !== N) cost = world._territoryCost = new Float32Array(N);
  // EFFORT (value-discounted cost) drives the claim frontier + reach gate; TRUE haul cost is
  // tracked alongside for the food-distance falloff (value buys REACH, not free transport).
  let tcost = world._territoryTrueCost;
  if (!tcost || tcost.length !== N) tcost = world._territoryTrueCost = new Float32Array(N);
  // Per-tile DESIRABILITY field — built once (lazily, so a loaded save is covered without a
  // persist field, since it's derived from fert/flood/river which are reconstructed on load).
  const val = world._tileValue && world._tileValue.length === N ? world._tileValue : initTileValue(world);
  const riverMag = world.riverMag;   // the navigable spine — reach rides it cheaply (RIVER_REACH)
  // COST reset is deferred until we know a flood will run. Under MARKET_PULL_CACHE a
  // clean bid fingerprint reuses the previous partition's cost fields for tally —
  // wiping them here would mark every tile unreachable and starve the ledger.

  const byId = new Map();
  const budget = new Map();
  const knOf = new Map();   // owner id → snapshot of its knowledge for localEdgeCost
  const countryOf = new Map();   // owner id → its countryId (CATCHMENT_CLIP: the catchment may only cover its OWN country's ground)
  // The reach budget is in transport-cost units where a plain TILE costs ~1, so a
  // fixed budget is a fixed TILE radius — a smaller REAL catchment on a finer grid
  // (the second half of the Phase-2 resolution bug: the same settlement farmed ¼
  // the real land at 2× resolution, quartering its food after area normalisation).
  // Scale it by rNormPop so the economic catchment covers the same REAL area at any
  // resolution — exactly what countryTerritory.js already does for the POLITICAL
  // reach via resScaleFor. (foodFalloff reads cost/rNorm, keeping the harvest
  // kernel's real shape consistent with the widened budget.) Off ⇒ ×1.
  const _rnB = rNormPop(world);
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    byId.set(s.id, s);
    budget.set(s.id, reachBudget(s) * _rnB);
    knOf.set(s.id, s.knowledge || {});
    countryOf.set(s.id, s.countryId);
  }

  // ── T.MARKET_PULL — the field sells to whoever nets its producer most ──
  // docs/tier-ratchet-2026-08-27.md sections 38-43. The catchment stops being an
  // AREA ALLOWANCE spent outward (reachBudget, a function of organisation tech
  // and nothing else — so a metropolis farmed 1.02-1.05x a hamlet) and becomes
  // the OUTCOME of a bid: delivered value falls with carriage, so in logs the
  // race is additive and this is the SAME Dijkstra with a different starting
  // potential. A market that bids more starts lower and reaches further.
  //   BID = hunger x ability to pay. Hunger is _scarcity (demand/supply, the
  // emergent signal) and NOT _grainPrice, which carries GRAIN_PRICE_BY_TIER and
  // would let a metropolis outbid a town 11x on its label — promoting the
  // ratchet from a side-grant to the thing that assigns land. Ability to pay is
  // wealth, which is EARNED. The owner's crowding-out argument survives intact;
  // only its source changes from granted to earned.
  //   NORMALISED BY THE WORLD MEAN, which is what keeps this constant-free: the
  // seed is -haulTiles*ln(A_i / Abar), so an average market seeds at exactly 0
  // and only RELATIVE standing moves anyone. haulTiles is HAUL_LAND_KM/(km per
  // tile) — the same edict-derived figure foodHierarchy already hauls grain on.
  const mktPull = T.MARKET_PULL > 0;
  const seedOf = new Map();
  let haulTiles = 0;
  if (mktPull) {
    _rebuildMarketKn(byId);
    let sum = 0, n = 0;
    for (const s of byId.values()) {
      const a = Math.max(1e-6, (s._scarcity || 1));
      seedOf.set(s.id, a); sum += a; n++;
    }
    const abar = n > 0 ? sum / n : 1;
    // HAUL_LAND_KM = 340 km is an E-FOLDING distance, not a zero point: under the
    // exponential the grain is still worth 37% of its price there. Converting it
    // to a LINEAR law by using 340 as the zero point silently HALVES the haul —
    // measured, the gate world fell to 10 settlements. Match the two laws on the
    // value they actually deliver instead: the exponential's total is
    // integral(exp(-d/340)) = 340, the linear's over [0,D] is D/2, so D = 2*340 =
    // 680 km. That is a derivation from the edict figure already in the tree, not
    // a constant tuned until the world survived.
    // ...AND THE RANGE GROWS WITH THE AGE'S CARRIAGE, exactly as foodHierarchy's
    // haul curve already does. A flat range would be a fixed constant that never
    // moves with development — a neolithic world and an industrial one hauling
    // grain equally far — which is the first cardinal rule broken in space. The
    // multiplier here is the SAME expression foodHaulArrive uses, term for term:
    // roads (construction) + wagons (mobility), plus the industrial leap at
    // cons > 0.85 that the original comment names as "rail / refrigeration /
    // canning". Faster carriage and better preservation both mean more of the
    // cargo is still worth something further out, which is what a longer ring IS.
    // Read from the age's best carriage (_MARKET_KN), same argument as the edge
    // cost: grain moves on the best shipping available, not the buyer's own.
    const _mk = _MARKET_KN;
    const _cons = _mk.construction || 0, _mob = _mk.mobility || 0;
    const _techRange = 1 + (_cons * 0.6 + _mob * 0.4 + Math.max(0, _cons - 0.85) * 5) * T.FOOD_HAUL_TECH;
    haulTiles = (2 * 340 / (40075 / tw)) * _techRange;   // HAUL_LAND_KM, e-folding -> finite range, x the age's carriage
    // THE DECAY LAW (work-plan item 4). Freight rises STEADILY with distance, so
    // the farm-gate net is A_i - freight*d and hits EXACTLY ZERO at a finite
    // range — von Thuenen's rings END. The first build used an exponential haul
    // (seed = -haulTiles*ln A), which fades forever and gave the frontier no
    // stopping rule at all: measured on the live arm, a handful of markets took
    // the continent (max core 2717 against the controls' 357-452, register 5
    // realms against 15) and the sweep ran 2x slow because nothing bounded it.
    //   Linear freight makes the race ADDITIVE rather than logarithmic, so the
    // seed is -haulTiles*(A_i/Abar) and reach is proportional to what a market
    // pays — and the stopping rule falls out for free (see the ring's edge in
    // the relaxation below). No cap, no cutoff to tune: the boundary IS where
    // freight eats the price. Abar normalisation keeps it constant-free — an
    // average market reaches exactly HAUL_LAND_KM, the edict's own 340 km.
    for (const [id, a] of seedOf) seedOf.set(id, -haulTiles * (a / abar));
  }

  // Partition vs tally (MARKET_PULL_CACHE): when bids/carriage/roads/roster are
  // unchanged, skip the Dijkstra and only retally under the stored partition.
  // Force a flood every 8 cached territory cadences so slow road-quality drift
  // (which may not bump _roadVersion) cannot leave haul costs stale forever.
  const mktSig = mktPull
    ? _marketFloodSig(byId, seedOf, haulTiles, world._roadVersion || 0)
    : 0;
  const mktCache = mktPull && T.MARKET_PULL_CACHE > 0;
  const mktAge = world._mktFloodAge || 0;
  const mktFlood = !mktPull || !mktCache || world._mktFloodSig !== mktSig || !world._mktFloodReady || mktAge >= 8;

  // ── CATCHMENT_CLIP (T.CATCHMENT_CLIP): the economic catchment is REACTIVE to the
  // political map — a settlement may only work tiles its OWN country already holds
  // (world._countryOwner === its countryId), so the catchment CHOOSES within the
  // borders but never creates or moves one. A stateless settlement (countryId that
  // owns no ground) still works nearby WILDERNESS (co<0 === its own -1 flag), a local
  // food floor so state-formation bootstraps. Clips to the LAST pass's _countryOwner
  // (this pass's is computed just after, in computeCountryTerritory — a 1-pass lag is
  // immaterial as borders drift slowly). Off, or before the first political pass, the
  // guards below are inert (byte-identical).
  //   T.CATCH_WILD — the wilderness allowance is not a privilege of statelessness.
  // The floor above works only by an accident of encoding: a stateless settlement's
  // countryId IS -1, the same flag unclaimed land carries, so `clip[ti] === -1`
  // happens to admit wilderness for it and only for it. The moment that village
  // joins a state its countryId becomes >= 0 and every wild tile it was farming
  // fails the test — statehood CONFISCATES the fields at the village door, which no
  // state has ever done and which the lever's own rationale never asks for (the
  // rationale is that a catchment must not CREATE a border, and working wild soil
  // creates none: under TILE_POLITY the political field is stamped from the capital
  // core alone — countryTerritory.js step 1b — and _territoryOwner is never copied
  // into _countryOwner). The accident closes a loop with real teeth: border shrinks
  // -> catchment shrinks -> harvest, s._k and the FOOD_K capacity share shrink ->
  // popField over the realm's ground shrinks -> the size target (govPop / bind
  // density) shrinks -> border shrinks. On the lever, the test states the physical
  // rule instead: a settlement works its OWN country's ground or nobody's, never a
  // foreign realm's — so where the border falls no longer decides what the peasants
  // can farm, and the food side of that loop is cut.
  const clip = T.CATCHMENT_CLIP > 0 && world._countryOwner && world._countryOwner.length === N ? world._countryOwner : null;
  const wildOK = (T.CATCH_WILD || 0) > 0;
  const clipped = (sid, ti) => clip[ti] !== (countryOf.get(sid) ?? -1) && !(wildOK && clip[ti] < 0);
  const inCountry = (sid, ti) => !clip || !clipped(sid, ti);

  // Release any tile whose owner is gone (died / unsettled) back to
  // wilderness, so neighbours can grow into the vacated land. Also
  // release any WATER tiles that lingered from an older code path —
  // borders shouldn't bleed into the ocean.
  // Farming Regions to reclaim.
  // T.CATCH_GRACE — disputed fields keep their farmers (the Egypt-autopsy
  // safety rail, docs/egypt-autopsy-2026-08-24.md). The instant release below
  // was the execution half of the measured seat-death chain: one border sweep
  // over a city's district zeroed its whole catchment in a single pass, supply
  // → 0.0, census → the abandonment bar. Under the lever a tile the settlement
  // ALREADY WORKS survives a political mismatch for a grace window (history-
  // time steps) before releasing — peasants do not stop farming the day a
  // distant border shifts; the fields are lost only if the new order STANDS
  // (capture, annexation, relief all resolve within the window). Asymmetric on
  // purpose: grace never lets a catchment GROW into foreign ground (the claim
  // guards below still test the raw clip) — it only lets held fields wait out
  // the dispute. 0 ⇒ byte-identical instant release.
  const graceT = (T.CATCH_GRACE || 0) / (world._dt || 1);
  let clipAt = world._catchClipAt;
  if (graceT > 0 && (!clipAt || clipAt.length !== N)) clipAt = world._catchClipAt = new Int32Array(N);
  for (let ti = 0; ti < N; ti++) {
    const o = owner[ti];
    if (o < 0) continue;
    if (!byId.has(o) || world.elev[ti] <= 0) { owner[ti] = -1; continue; }
    // T.MARKET_PULL: cross-border assignment is TRADE, not annexation — a market
    // buying a foreign field's harvest does not move _countryOwner (TILE_POLITY
    // stamps political land from the capital alone). Skip the clip release so a
    // bid-won foreign tile is not confiscated before the pass re-contests it.
    if (clip && clipped(o, ti) && !mktPull) {   // catchment tile no longer within its owner's country (borders shifted)
      if (graceT > 0) {
        if (clipAt[ti] === 0) clipAt[ti] = world.step + 1;              // dispute begins — keep working
        else if (world.step + 1 - clipAt[ti] > graceT) { owner[ti] = -1; clipAt[ti] = 0; }   // the new order stood — release
      } else owner[ti] = -1;
    } else if (graceT > 0 && clipAt[ti] !== 0) clipAt[ti] = 0;          // back inside the border — dispute over
  }

  // Guarantee each settlement its (tier-sized) core block, carving it from a
  // neighbour if necessary. Where two cores overlap (close settlements) the
  // FIRST to claim a tile this pass keeps it — and since we iterate in the
  // stable settlement order, the same one always wins, so no flicker.
  // Under MARKET_PULL_CACHE a clean fingerprint skips this whole flood and
  // keeps the stored partition for the tally below.
  if (mktFlood) {
  // Reset COST every flood (roads / budgets / bids shift the falloff) but keep
  // OWNER — ownership is persistent, that's what stabilises the borders.
  cost.fill(Infinity);
  tcost.fill(Infinity);
  // Pre-size like transport.js — avoid grow cascades under invent-jump memory pressure.
  const wantTerr = (() => {
    const need = Math.max(4096, N);
    return need <= 1 ? 1 : 1 << (32 - Math.clz32(need - 1));
  })();
  let heap = world._terrHeap;
  if (!heap || heap.cap < wantTerr) {
    heap = world._terrHeap = new MinHeap(wantTerr);
    heap._maxCap = Math.max(wantTerr * 4, 1 << 20);
  }
  heap.n = 0;
  const coreClaimed = world._coreClaimed && world._coreClaimed.length === N
    ? world._coreClaimed : (world._coreClaimed = new Int32Array(N));
  const stamp = (world._coreStamp = (world._coreStamp || 0) + 1);
  // MARKET_PULL_HYST needs the pre-flood owner map — copy into a reused lane
  // (owner.slice() allocated ~N×4 bytes every territory flood; under Max +
  // first-city mint that was a steady ArrayBuffer stream into the allocation
  // wall — docs/allocation-wall-2026-08-20.md).
  let prevOwner = null;
  if (mktPull && T.MARKET_PULL_HYST > 1) {
    prevOwner = _ensureTerrOwnerCopy(world, "_terrPrevOwner", N);
    prevOwner.set(owner);
  }
  const { cost2, tcost2, clm2 } = mktPull && T.MARKET_PULL_HYST > 1
    ? _ensureTerrScratch(world, N)
    : { cost2: null, tcost2: null, clm2: null };
  if (cost2) { cost2.fill(Infinity); tcost2.fill(Infinity); clm2.fill(-1); }
  for (const s of byId.values()) {
    const sx = s.pos.x | 0, sy = s.pos.y | 0;
    // T.MARKET_PULL: no guaranteed block. Carriage to the tile you stand on is
    // zero, so no rival takes your doorstep without bidding enormously more —
    // the home block is EMERGENT, and CORE_BY_TIER was the ratchet leg granting
    // it by label. This loop is also pure Euclidean geometry (a square walk),
    // one of the two straight-line phases that outranked the terrain-aware one.
    const r = mktPull ? -1 : coreRadiusFor(s, world);
    for (let dy = -r; dy <= r; dy++) {
      const ny = sy + dy; if (ny < 0 || ny >= th) continue;
      for (let dx = -r; dx <= r; dx++) {
        const nx = ((sx + dx) % tw + tw) % tw;
        const ti = ny * tw + nx;
        if (elev[ti] <= 0) continue;
        if (coreClaimed[ti] === stamp) continue;   // already core of an earlier settlement this pass
        if (clip && clipped(s.id, ti)) continue;   // CATCHMENT_CLIP: the guaranteed core can't reach outside the country's own ground (CATCH_WILD: wilderness counts as its own)
        coreClaimed[ti] = stamp;
        owner[ti] = s.id;
      }
    }
    const home = sy * tw + sx;
    const seed = mktPull ? (seedOf.get(s.id) || 0) : 0;
    if (elev[home] > 0) {
      // T.MARKET_PULL: the guaranteed-core loop above is skipped, and that loop
      // was the ONLY thing that set owner[] for a settlement's own tile. Without
      // it the frontier pops home, reads owner/claimant -1, and bails — so NO
      // settlement expands at all and the world dies (measured: 2 settlements,
      // pop 38). The market rule removes the guaranteed BLOCK, not a market's
      // claim to the ground it stands on: carriage there is zero, so it wins the
      // tile on the bid anyway; this states it instead of leaving it to an
      // ordering accident.
      if (mktPull) { owner[home] = s.id; coreClaimed[home] = stamp; }
      cost[home] = seed; tcost[home] = 0; heap.push(home, seed);
    }
  }

  // ── Guaranteed farmland hinterland (nearest-wins distance Voronoi) ──
  // Each settlement claims the land within its hinterland radius that it is the
  // NEAREST settlement to, carving fairly from wilderness AND from a neighbour
  // that had over-claimed the shared countryside — so every town keeps a real
  // farmland belt instead of being squeezed to its core. Cores are sacred
  // (skipped), and CONQUERED tiles are left to whoever took them (a tile with a
  // capture timestamp is battlefield land, not free countryside) so this never
  // undoes a conquest. Deterministic per pass ⇒ stable borders, no flicker.
  const hintDist = (world._hintDist && world._hintDist.length === N)
    ? world._hintDist : (world._hintDist = new Float32Array(N));
  hintDist.fill(Infinity);
  const capAt = world._tileCapturedAt;
  for (const s of byId.values()) {
    const sx = s.pos.x | 0, sy = s.pos.y | 0;
    // T.MARKET_PULL: the second straight-line phase goes too. `d2 = dx*dx+dy*dy`
    // is a raw Euclidean Voronoi that claimed land BEFORE the terrain-aware
    // frontier and then walled it off — so geometry won first and could not be
    // overridden by terrain. Under the bid the belt is what a market wins.
    const hr = mktPull ? -1 : hinterlandRadiusFor(s, world), hr2 = hr * hr;
    for (let dy = -hr; dy <= hr; dy++) {
      const ny = sy + dy; if (ny < 0 || ny >= th) continue;
      for (let dx = -hr; dx <= hr; dx++) {
        const d2 = dx * dx + dy * dy; if (d2 > hr2) continue;
        const nx = ((sx + dx) % tw + tw) % tw;
        const ti = ny * tw + nx;
        if (elev[ti] <= 0) continue;
        if (coreClaimed[ti] === stamp) continue;       // a settlement's core — sacred
        if (capAt && capAt[ti] > -Infinity) continue;  // conquered land — leave to the conqueror
        if (clip && clipped(s.id, ti)) continue;   // CATCHMENT_CLIP: hinterland stays within the country's ground (CATCH_WILD: wilderness counts as its own)
        if (d2 < hintDist[ti]) { hintDist[ti] = d2; owner[ti] = s.id; }
      }
    }
  }

  // Snapshot LOCKED ownership (persistent land + cores). During the pass,
  // a locked tile owned by someone else is a wall; only tiles that are
  // wilderness in the snapshot are contestable — and they go to whoever
  // reaches them cheapest (true multi-source Voronoi over the free land).
  // Reuse lane — same allocation-wall reason as _terrPrevOwner above.
  const base = _ensureTerrOwnerCopy(world, "_terrBaseOwner", N);
  base.set(owner);
  // Claimant carrier: water tiles propagate the cost frontier but are never
  // OWNED, so re-deriving the claimant from owner[ti] at pop time lost it the
  // moment the frontier stepped offshore (budget/knowledge read as nobody's →
  // the documented "navy reaches the far shore" path silently never worked).
  let clm = world._terrClaimant;
  if (!clm || clm.length !== N) clm = world._terrClaimant = new Int32Array(N);
  clm.set(owner);   // owner is -1 on unowned tiles already — one memcpy

  // Multi-source Dijkstra. Cost propagates through a settlement's OWN tiles
  // (so food falloff is correct across its whole domain); free wilderness
  // is claimed by whoever reaches it cheapest within budget; another
  // settlement's locked land is a wall — grown around, never seized.
  while (heap.n > 0) {
    const { ti, d } = heap.popMin();
    if (d > cost[ti]) continue;
    const oid = owner[ti] >= 0 ? owner[ti] : clm[ti];
    if (oid < 0) continue;
    const bud = budget.get(oid) || 0;
    const kn  = knOf.get(oid);
    const tcHere = tcost[ti];
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1;
    const xp = tx === tw - 1 ? 0 : tx + 1;
    const yu = ty - 1, yd = ty + 1;
    const ns = [
      ty * tw + xm, ty * tw + xp,
      yu >= 0 ? yu * tw + tx : -1,
      yd < th ? yd * tw + tx : -1,
      yu >= 0 ? yu * tw + xm : -1,
      yu >= 0 ? yu * tw + xp : -1,
      yd < th ? yd * tw + xm : -1,
      yd < th ? yd * tw + xp : -1,
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k];
      if (ni < 0) continue;
      const lk = base[ni];
      // T.MARKET_PULL: OWNED LAND IS CONTESTABLE. Off the lever a tile with any
      // owner is a wall and only wilderness can be claimed — which means a field
      // can never change buyer, so "sells to whoever pays most" would be inert
      // on every tile already spoken for. Removing the wall is what makes the
      // reallocation ADAPTIVE, and it is also where flicker would come from:
      // measured, not damped pre-emptively (docs section 44).
      if (!mktPull && lk >= 0 && lk !== oid) continue;   // someone's locked land: a wall
      // Tech×terrain edge cost from the OWNER's perspective. A neolithic
      // civ pays the full mountain/cold/river-crossing tariff; a civ with
      // construction/navigation/mobility pays less. Water tiles return
      // Infinity unless this civ has the nav floor (≥0.10), in which case
      // they cost ~3-12 (sail) and the claim can hop offshore.
      // T.MARKET_PULL: grain travels by CART AND BOAT, so roads and the port tax
      // count. Off the lever both are ignored, on the stated ground that "a
      // settlement farms its hinterland on foot" — true of walking to a field,
      // false of selling to a market, which is what this now models. Roads
      // currently reshape the food partition by exactly nothing.
      // T.MARKET_PULL: the carriage cost is a property of the ROUTE, not of the
      // buyer. Off the lever the cost is computed from the CLAIMANT's knowledge
      // (kn) — an administrative-reach idea: a realm with engineering projects
      // authority more cheaply over its own mountains. For a market that is
      // wrong twice. Physically, moving grain over a pass costs what it costs
      // whoever buys it. Algorithmically it is fatal: with the ownership wall
      // removed a tile's claimant changes DURING the pass, so a source-dependent
      // weight makes the graph non-stationary, Dijkstra's single-settle property
      // fails, tiles re-relax from every rival in turn and the sweep blows up
      // (measured: the gate run went from ~70s to past 400s and was killed).
      // A shared neutral knowledge makes it a fixed-weight graph again — one
      // clean additively-weighted Voronoi, each tile settled once — and roads
      // and the port tax now count, which is the whole point.
      const c = mktPull
        ? localEdgeCost(world, ti, ni, _MARKET_KN, false, false)
        : localEdgeCost(world, ti, ni, kn, true, true);  // reach ignores roads + the boat/land port tax (a settlement farms its hinterland on foot)
      if (c === Infinity) continue;
      const step = c * mul[k];               // TRUE haul cost (the river is already cheap via localEdgeCost)
      // Two forces shrink the EFFORT of advancing the border (the reach gate), leaving the true haul
      // cost untouched for the food-distance falloff:
      //   RIVER HIGHWAY — a navigable river is an administrative SPINE; advancing reach ALONG it is far
      //   cheaper than overland, so a polity's catchment runs UP and DOWN the valley. This is what let a
      //   single state govern the 1000 km Nile — the river carried officials, grain and troops the length
      //   of it. The fertile BANKS the reach rides past are then annexed by the value pull.
      //   VALUE PULL — a tile worth holding is worth reaching for, so the border is spent toward the
      //   floodplain rather than the cheapest-nearest waste (value ÷ difficulty).
      let eff = step;
      // (RIVER_REACH removed 2026-07: measured to over-concentrate — the doc'd
      // verdict in persistent-territory-spec. VALUE_PULL alone rides the banks.)
      eff /= (1 + T.VALUE_PULL * (val[ni] || 0));                        // pull onto the valued banks
      const nd = d + eff;
      // THE RING'S EDGE: nd = seed + carriage, and seed is minus the distance
      // the bid buys, so nd >= 0 is exactly where freight has eaten the grain's
      // whole value. Beyond it the harvest is not worth carrying and no market
      // wants the field. This is the bound the first build lacked.
      if (mktPull && nd >= 0) continue;
      if (!mktPull && nd > bud) continue;    // owner can't reach further (in value-weighted effort)
      if (nd < cost[ni]) {
        if (cost2 && clm[ni] >= 0 && clm[ni] !== oid) {
          cost2[ni] = cost[ni]; tcost2[ni] = tcost[ni]; clm2[ni] = clm[ni];
        }
        cost[ni] = nd;
        tcost[ni] = tcHere + step;
        clm[ni] = oid;   // the claimant rides the frontier, on land AND water
        // Walk THROUGH water (so a navy reaches the far shore) but don't
        // CLAIM water tiles — borders shouldn't bleed into the ocean.
        // Land tiles are claimed normally; water tiles just propagate
        // the cost frontier. Off MARKET_PULL, CATCHMENT_CLIP: claim only
        // tiles inside the claimant's own country (the cost frontier still
        // walks THROUGH out-of-country land, so a member can reach its
        // country's ground beyond a wild gap, but it never works foreign
        // soil). Under MARKET_PULL the bid may cross borders — Rome bought
        // Egyptian grain before it owned Egypt — and _territoryOwner records
        // who is farming for whom, not who rules the tile politically.
        if ((mktPull || lk < 0) && elev[ni] > 0 && (mktPull || inCountry(oid, ni))) owner[ni] = oid;
        heap.push(ni, nd);
      } else if (cost2 && clm[ni] !== oid && nd < cost2[ni]) {
        cost2[ni] = nd; tcost2[ni] = tcHere + step; clm2[ni] = oid;
      }
    }
  }

  if (prevOwner) _applyMarketHysteresis(owner, cost, tcost, clm, prevOwner, cost2, tcost2, clm2, byId, N, T.MARKET_PULL_HYST);
  if (mktPull) { world._mktFloodSig = mktSig; world._mktFloodReady = true; world._mktFloodAge = 0; }
  } else if (mktPull) {
    // Tally-only: partition reused. Debug counter for probes / HUD.
    world._mktFloodSkipped = (world._mktFloodSkipped || 0) + 1;
    world._mktFloodAge = mktAge + 1;
  }

  tallyTerritory(world, owner, tcost, byId);   // food falloff uses TRUE haul cost, not value-discounted effort

  reclaimRuins(world);   // stranded coin re-enters circulation where the land is worked again
}
// (URBAN_NODES and its assignMinesByProximity helper were removed in the
// 2026-07 default-flip campaign — the node-city experiment was superseded by
// the shipped DISSOLVE_FARMS region model; mines are worked by owned tiles.)

// Walk every claimed tile once and accumulate each owner's food / resource
// / mineable stats, and record which settlements BORDER each other (their
// territories are adjacent) — used by the conquest layer. Cheap O(N) pass.
function tallyTerritory(world, owner, cost, byId) {
  const { N, tw, th, fert, deposits } = world;
  const borders = new Map();   // settlementId -> Set(bordering settlementIds)
  const addBorder = (a, b) => {
    if (a === b) return;
    let sa = borders.get(a); if (!sa) { sa = new Set(); borders.set(a, sa); } sa.add(b);
    let sb = borders.get(b); if (!sb) { sb = new Set(); borders.set(b, sb); } sb.add(a);
  };
  for (const s of byId.values()) {
    s._terrFertSum = 0;
    s._terrTiles = 0;
    s._terrWorkTiles = 0;
    s._terrFarmedWt = 0;   // falloff-weighted count of tiles actually ENTERING the harvest sum
    s._terrWorksWt = 0;    // falloff-weighted LAND_WORKS over those same farmed tiles → _terrWorksMean (the ledger's built-land-capital read)
    s._terrSurplusAcc = 0; // Σ surplusFrac × plantable weight
    s._terrPlantWt = 0;    // Σ plantable weight (pre-surplus) → _terrMeanSurplus = acc/plant
    s._terrMinFert = MIN_PLANTABLE_FERT_BASE - MIN_PLANTABLE_FERT_SLOPE * (s.knowledge.agriculture || 0);
    s._terrResAcc = {};
    if (T.RES_SCARCITY) s._terrResMax = {};   // best grade held per resource (see finalize)
    s._minableTiles = [];
  }
  const haveDep = deposits && Object.keys(deposits).length > 0;
  const reserve = world.depositReserve;
  // A mine only counts while its finite reserve still holds metal — a dried-up
  // deposit stays on the map but no longer grants luxury budgets / value-cling.
  const mineLive = (id, ti) => !reserve || !reserve[id] || reserve[id][ti] > 0;
  const cm = world.climMod;   // dynamic-climate fertility overlay (undefined = none → ×1)
  // Built land capital (T.LAND_WORKS → popField worksField): read back per
  // settlement as the harvest-weighted mean over its FARMED tiles, so the canal
  // is priced exactly where the grain is grown (updateFood worksMul — ONE
  // constant prices works on ledger and field alike).
  const wkF = T.LAND_WORKS > 0 ? world.worksField : null;
  // Resolution-invariant AREA accounting (T.RES_INVARIANT_POP, Phase 2 of
  // docs/resolution-invariance-plan.md): a finer grid cuts the same real land into
  // rn²× more tiles, so raw tile SUMS (_terrTiles/_terrFertSum/…) inflate with the
  // pixel count and every consumer calibrated at the 240-tile reference (the /120
  // caps, per-tile fish gate, graze counts, the farm-labour floor) mis-scales.
  // Each tile therefore accumulates as invA = 1/rn² REFERENCE-tiles (its real
  // area), and the harvest falloff reads its transport cost in REAL units
  // (cost/rn). One normalisation point — every downstream consumer then sees
  // reference-scale numbers automatically. Off ⇒ rn=1, invA=1: byte-identical.
  const _rn = rNormPop(world), _invA = 1 / (_rn * _rn);
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti];
    if (oid < 0) continue;
    const s = byId.get(oid);
    if (!s) continue;
    s._terrTiles += _invA;
    // WORKED tiles are those the settlement can actually reach this pass
    // (finite transport cost). Disconnected fragments — land kept by the
    // persistent-ownership rule after a front cut them off — contribute no
    // food, so they must not be charged the FARM_FERT_FLOOR labour cost
    // either (they used to actively REDUCE net food, a phantom workforce
    // farming land nobody could get to). updateFood reads _terrWorkTiles.
    const reachable = cost[ti] < Infinity;
    if (reachable) s._terrWorkTiles += _invA;
    const f = (fert[ti] || 0) * (cm ? cm[ti] : 1);   // climate scales the harvestable fertility
    if (f >= s._terrMinFert) {
      const w = foodFalloff(cost[ti] / _rn);
      const gross = f * w * _invA;
      const surplus = landSurplusFrac(world, ti, gross, s);
      s._terrFertSum += gross * surplus;
      // The farm-labour floor (updateFood) is charged on FARMED tiles at the
      // same distance discount as their harvest — never on barren/mountain
      // tiles that contribute nothing (claiming worthless land used to
      // actively DESTROY food via a phantom workforce), and a distant field
      // costs proportionally less labour just as it yields less. Break-even
      // stays exactly f = FARM_FERT_FLOOR, per the food model's contract.
      const pw = w * _invA;
      s._terrPlantWt += pw;
      s._terrFarmedWt += pw * surplus;
      s._terrSurplusAcc += surplus * pw;
      if (wkF) s._terrWorksWt += wkF[ti] * w * _invA * surplus;
    }
    if (haveDep) {
      const acc = s._terrResAcc;
      // RES_SCARCITY (goods-vector Stage 0): track BOTH the best GRADE held
      // (max richness — a mine's ore quality doesn't dilute because the realm
      // is large) and the COMMANDED QUANTITY (Σ richness × real area,
      // reference-tile units via _invA — the same normalisation as the
      // fertility sum). Finalize below reads grade × substantiality, so one
      // stray copper tile no longer makes a whole catchment "rich in copper"
      // (the F3 homogenisation) while a real district keeps its full grade.
      // (First cut summed alone and saturated — measured at 480/8817 it
      // ERASED the grading instead: everything a big city touched read ~0.9+,
      // breadth ROSE. Quantity without quality is the wrong physics.)
      if (T.RES_SCARCITY) {
        const mx = s._terrResMax;
        for (const id of TERR_RES) {
          const arr = deposits[id];
          if (!arr) continue;
          const v = arr[ti] || 0;
          if (v > 0) {
            acc[id] = (acc[id] || 0) + v * _invA;
            if (v > (mx[id] || 0)) mx[id] = v;
          }
        }
      } else {
        for (const id of TERR_RES) {
          const arr = deposits[id];
          if (!arr) continue;
          const v = arr[ti] || 0;
          if (v > (acc[id] || 0)) acc[id] = v;
        }
      }
      if (deposits.precious && deposits.precious[ti] > 0.05 && mineLive("precious", ti)) s._minableTiles.push([ti, "precious"]);
      if (deposits.gems && deposits.gems[ti] > 0.05 && mineLive("gems", ti)) s._minableTiles.push([ti, "gems"]);
    }
    // Borders: compare right + down neighbours (x wraps).
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const rt = ty * tw + (tx === tw - 1 ? 0 : tx + 1);
    const ro = owner[rt]; if (ro >= 0 && ro !== oid) addBorder(oid, ro);
    if (ty < th - 1) { const dn = ti + tw; const dno = owner[dn]; if (dno >= 0 && dno !== oid) addBorder(oid, dno); }
  }
  // RES_SCARCITY finalize: localRes[id] = GRADE × SUBSTANTIALITY —
  //   grade          = best richness held (what the MAX measured, and what
  //                    every consumer's 0..1 scale already means), times
  //   substantiality = 1 − exp(−S/K), S the commanded quantity in
  //                    reference-tile·richness units, K the quantity at which
  //                    a holding counts as a real working district (~63%
  //                    there at S=K, ~95% at 3K).
  // A stray tile reads ~nothing, a single mine a solid fraction of its grade,
  // a district/belt its full grade — graded scarcity that survives city
  // growth, on the exact scale consumers read today. _terrResAcc keeps the
  // raw sums for probes; flag off: localRes aliases the MAX accumulator
  // exactly as before (byte-identical).
  if (T.RES_SCARCITY) {
    const satK = T.RES_SCARCITY_K;
    for (const s of byId.values()) {
      const acc = s._terrResAcc, mx = s._terrResMax, out = {};
      for (const id in acc) out[id] = (mx[id] || 0) * (1 - Math.exp(-acc[id] / satK));
      s.localRes = out;
    }
  } else {
    for (const s of byId.values()) s.localRes = s._terrResAcc;
  }
  // Finalize the built-land-capital read: worksField ∈ [0,1] per tile, so the
  // harvest-weighted mean is ∈ [0,1] — the farmed catchment's improvement level.
  for (const s of byId.values()) {
    s._terrWorksMean = s._terrFarmedWt > 1e-9 ? s._terrWorksWt / s._terrFarmedWt : 0;
    // Mean tradeable fraction over plantable weight. Pastoral multiplies by
    // this so herds face the same countryside-eats-first gate as grain.
    s._terrMeanSurplus = s._terrPlantWt > 1e-9 ? s._terrSurplusAcc / s._terrPlantWt : 1;
  }
  world._borders = borders;
}

// Cheap local fallback so a freshly-founded settlement has food + resource
// stats before the first full territory pass reaches it. Scans a small box
// around home.
export function seedLocalTerritory(world, s) {
  const { tw, th, fert, deposits } = world;
  const cm = world.climMod;
  const sx = s.pos.x | 0, sy = s.pos.y | 0;
  const minFert = MIN_PLANTABLE_FERT_BASE - MIN_PLANTABLE_FERT_SLOPE * (s.knowledge.agriculture || 0);
  let fertSum = 0, tiles = 0, farmedWt = 0, worksWt = 0;
  const wkF = T.LAND_WORKS > 0 ? world.worksField : null;   // built land capital (same read as tallyTerritory)
  const res = {};
  const resMax = {};   // best grade per resource (RES_SCARCITY composite)
  const minable = [];
  const haveDep = deposits && Object.keys(deposits).length > 0;
  const reserve = world.depositReserve;
  const mineLive = (id, ti) => !reserve || !reserve[id] || reserve[id][ti] > 0;
  // Real-distance seed box + reference-area accumulation (RES_INVARIANT_POP,
  // same normalisation as tallyTerritory above; off ⇒ rb=3, invA=1, identical).
  const _rn = rNormPop(world), _invA = 1 / (_rn * _rn);
  const rb = Math.max(1, Math.round(3 * _rn));
  // T.SEED_EXCLUSIVE — A NEWBORN MAY NOT HARVEST ITS NEIGHBOUR'S FIELDS.
  // The steady-state catchment is strictly exclusive: world._territoryOwner is
  // one Int32 per tile, every claim path writes that single slot, and the
  // census and the harvest both reduce over it — so no villager and no field
  // is ever counted twice (measured: 0 of 3,473 tiles multiply-owned, 0.000%
  // double-counted people). This seed box is the ONE hole in that rule. It
  // runs at mintCityAt (settlement.js:492) to give a newborn food/resource
  // stats before the first full territory pass, and it walks a raw box with no
  // ownership test at all — so a city founded beside an established one books
  // that neighbour's fields as its own until the AMORTIZED pass reassigns
  // them. Measured (probe_overlap, 24k/8817): 44 episodes, median 103 ticks
  // each, a median 49% (max 100%) of the box simultaneously owned and
  // harvested by another settlement, inflating world harvested area 9.8% —
  // and it gets WORSE on finer grids because the territory pass amortizes over
  // more tiles (median 287 ticks at tw=480, ~576 at the shipped tw=960).
  // Under the lever the seed box obeys the same exclusivity the partition
  // enforces everywhere else: tiles another settlement already owns are
  // skipped. Its own tiles still count, and before the first territory pass
  // (no owner array yet — the dawn) nothing is owned, so the bootstrap is
  // byte-identical. Zero new constants; this is the existing rule applied at
  // birth instead of a tick later.
  // v2, after the tw=960 arm refuted v1. The first cut VETOED every owned tile
  // and measured catastrophic at the shipped grid: the small-state tier went
  // 5 of 14 realms (36%) to ZERO of 12, and size dispersion lnσ fell from 2.68
  // — inside history's 2.0-2.6 band — to 0.92, a uniform-blob political map.
  // Every tw=240 gate passed it; the failure was a change in KIND at the grid
  // that ships (the deffdce pattern the THIRD CARDINAL RULE exists for).
  // The cause: small states are seeded by MARGINAL foundings, and a blunt veto
  // gives a newborn NOTHING where the bug gave it EVERYTHING. Neither is the
  // rule. The partition itself settles contested ground by NEAREST-WINS
  // (the hinterland pass, :326 `if (d2 < hintDist[ti])`), and within one
  // amortized pass the newborn will simply be handed every tile it is nearer
  // to. So the honest seed box PREDICTS that outcome instead of ignoring it or
  // being vetoed by it: an owned tile counts only if the newborn is strictly
  // nearer than its current owner — the neighbour's core stays the
  // neighbour's, the ground that is genuinely about to change hands does not
  // wait a pass to be booked, and a town founded into real countryside keeps
  // the opening ledger that lets a small state exist at all.
  const ownSeed = T.SEED_EXCLUSIVE > 0 ? world._territoryOwner : null;
  const ownSeedOk = ownSeed && ownSeed.length === world.N;
  const seedById = ownSeedOk ? (world._byId || null) : null;
  const _wrapDx = (a, b) => { let d = Math.abs(a - b); if (d > tw / 2) d = tw - d; return d; };
  for (let dy = -rb; dy <= rb; dy++) {
    const ny = sy + dy; if (ny < 0 || ny >= th) continue;
    for (let dx = -rb; dx <= rb; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const ti = ny * tw + nx;
      if ((world.elev[ti] || 0) <= 0) continue;
      if (ownSeedOk) {
        const o = ownSeed[ti];
        if (o >= 0 && o !== s.id) {
          // Nearest-wins, the partition's own tiebreak: count it only if this
          // newborn is strictly closer than the settlement holding it today.
          const os = seedById ? seedById.get(o) : null;
          if (!os) continue;                                  // owner gone this tick — leave it to the pass
          const odx = _wrapDx(os.pos.x | 0, nx), ody = (os.pos.y | 0) - ny;
          if (odx * odx + ody * ody <= dx * dx + dy * dy) continue;   // the holder is nearer (or tied) — its field, not ours
        }
      }
      tiles += _invA;
      const f = (fert[ti] || 0) * (cm ? cm[ti] : 1);
      const cost = Math.sqrt(dx * dx + dy * dy) / _rn;
      if (f >= minFert) { const w = foodFalloff(cost); fertSum += f * w * _invA; farmedWt += w * _invA; if (wkF) worksWt += wkF[ti] * w * _invA; }
      if (haveDep) {
        // Same grade × substantiality accumulation as tallyTerritory under
        // RES_SCARCITY (composed below), MAX otherwise — the seed box must
        // read on the same scale as the first full territory pass.
        for (const id of TERR_RES) { const arr = deposits[id]; if (!arr) continue; const v = arr[ti] || 0; if (T.RES_SCARCITY) { if (v > 0) { res[id] = (res[id] || 0) + v * _invA; if (v > (resMax[id] || 0)) resMax[id] = v; } } else if (v > (res[id] || 0)) res[id] = v; }
        if (deposits.precious && deposits.precious[ti] > 0.05 && mineLive("precious", ti)) minable.push([ti, "precious"]);
        if (deposits.gems && deposits.gems[ti] > 0.05 && mineLive("gems", ti)) minable.push([ti, "gems"]);
      }
    }
  }
  s._terrFertSum = fertSum;
  s._terrTiles = tiles;
  s._terrWorkTiles = tiles;   // local seed box is all walkable — everything counts as worked
  s._terrFarmedWt = farmedWt;
  s._terrWorksWt = worksWt;
  s._terrWorksMean = farmedWt > 1e-9 ? worksWt / farmedWt : 0;
  if (T.RES_SCARCITY) { const satK = T.RES_SCARCITY_K; for (const id in res) res[id] = (resMax[id] || 0) * (1 - Math.exp(-res[id] / satK)); }
  s.localRes = res;
  s._minableTiles = minable;
}
