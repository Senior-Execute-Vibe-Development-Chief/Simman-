// Settlement: a permanent community at a fixed location. Single icon
// (pop-scaled) with a patch of farmland painted on the most fertile
// tiles within reach. No bands, no individual buildings — the
// settlement is the atomic visible unit.
//
// New settlements come from the crystallization sweep (crystallize.js),
// which scatters them across viable sites and lets them inherit
// knowledge from their nearest neighbour weighted by transport
// distance. There is no settlement cap — the world fills with
// settlements wherever there is room (MIN_SETT_DIST spacing) and
// enough fertile land to support them.

import { localEdgeCost } from "./transport.js";

let _nextId = 1;
export function resetSettlementIds() { _nextId = 1; }

const TIER_THRESHOLD = [0, 80, 400, 2000];
const TIER_NAME      = ["village", "town", "city", "metropolis"];

// Pop growth slowed from 0.0045 → 0.0018 so settlements visibly take
// many in-game years to grow from village to city. With 0.0018, a
// village at 20 ppl reaches K=470 (city tier) in ~2000 ticks rather
// than ~700.
const SETT_GROWTH = 0.0018;

// Farmland model:
//   1 painted tile feeds PEOPLE_PER_FARM_TILE people on average.
//   Yield is calibrated so supply / demand ≈ 1.31 at K (30 % margin).
const PEOPLE_PER_FARM_TILE = 14;
const FARM_YIELD_PER_FERT  = 0.055;
const FORAGE_RATE          = 0.012;
// Farm placement is bounded by transport COST, not Euclidean distance.
// Reach is computed by a small Dijkstra from the settlement using the
// same terrain weights as transport.js — plains 1, hills ×2, mountains
// ×5, cold ×3, desert ×2.5, rivers ×0.4, coasts ×0.7. Effect:
// settlements in a river valley reach far along the river (cheap),
// settlements walled in by mountains reach only adjacent tiles. The
// cap below is in accumulated tile-cost units, not tiles.
const MAX_TRANSPORT_BY_TIER = [7, 14, 26, 40];    // village → metropolis
// Reach cache refresh interval — picks up slow knowledge drift within
// a tier (mature metropolis still benefits from its tech maturing from
// ~0.7 to ~0.99 over thousands of ticks).
const REACH_REFRESH_TICKS = 2000;
// Minimum soil fertility for a tile to be plantable. Below this, the
// land yields too little to be worth cultivating — it's left wild,
// regardless of pop pressure. This is what stops every settlement
// from filling its full range cap: in mediocre terrain, only a few
// tiles clear the bar, the soil-yield → carrying-capacity → tile-
// target feedback loop settles at a small footprint, and the
// settlement stays a hamlet. In a lush basin most tiles clear the bar
// and the settlement grows huge. Result: terrain-driven size variation
// instead of every settlement converging on the same disc.
//
// Threshold scales with agriculture knowledge — heavy plough, drainage,
// fertiliser, etc. progressively open up marginal soils:
//   ag 0.00  → floor 0.60  (foraging only — must be very lush)
//   ag 0.50  → floor 0.45  (neolithic baseline)
//   ag 1.00  → floor 0.30  (industrial — most land plantable)
const MIN_PLANTABLE_FERT_BASE  = 0.60;
const MIN_PLANTABLE_FERT_SLOPE = 0.30;
const FARMLAND_REFRESH_INTERVAL = 32;

export function makeSettlement(world, x, y, opts = {}) {
  const s = {
    id: _nextId++,
    kind: "settlement",
    pos: { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 },
    foundedStep: world.step,
    parentSettlementId: opts.parentId ?? -1,
    name: opts.name || `settlement-${_nextId - 1}`,
    people: opts.people ?? 25,
    food: (opts.people ?? 25) * 30,
    knowledge: opts.knowledge || {
      foraging:    0.5,
      toolmaking:  0.2,
      agriculture: 0.50,        // cradle starts already farming
      construction: 0.1,
      organization: 0.1,
    },
    traits: opts.traits || {
      aggression:   world.rng(),
      mercantilism: world.rng(),
      curiosity:    world.rng(),
    },
    farmland: new Set(),
    tier: 0,
    mode: "settled",
    lastFarmRefresh: world.step,
    lastFoundAttempt: world.step,
    history: [{ step: world.step, type: "founded", parent: opts.parentId ?? -1, pos: { x, y } }],
  };
  world.settlements.push(s);
  refreshFarmland(world, s);
  return s;
}

export function updateSettlement(world, s) {
  if (s.mode !== "settled") return;
  updateFood(world, s);
  updatePopulation(world, s);
  maybeRefreshFarmland(world, s);
  updateKnowledge(world, s);
  updateTier(world, s);
}

// ── Knowledge growth ──────────────────────────────────────────────
// Each tech accumulates slowly while a settlement does the right
// things: more farmland → agriculture improves; more pop → organization
// improves; bigger pop + ag → construction improves. Diminishing
// returns near 1.0.
const LEARN_BASE = 0.000040;          // per tick scaling
function updateKnowledge(world, s) {
  const k = s.knowledge;
  const fc = s.farmland.size;
  const pop = s.people;
  // Agriculture: drives off farmland count + ag itself (compound). A
  // 50-tile village makes more ag progress than a 5-tile hamlet.
  k.agriculture = clamp01(k.agriculture + LEARN_BASE * 1.2 * (1 - k.agriculture) * (1 + fc * 0.03));
  // Foraging: tiny ongoing trickle.
  k.foraging    = clamp01(k.foraging    + LEARN_BASE * 0.3 * (1 - k.foraging));
  // Toolmaking: pop drives it.
  k.toolmaking  = clamp01(k.toolmaking  + LEARN_BASE * 0.8 * (1 - k.toolmaking)  * (1 + Math.sqrt(pop) * 0.08));
  // Construction: needs agricultural surplus to free up builders.
  k.construction= clamp01(k.construction+ LEARN_BASE * 0.9 * (1 - k.construction)* (1 + k.agriculture * 1.0) * (1 + Math.sqrt(pop) * 0.05));
  // Organization: scales with pop — bigger town needs more
  // administration to function.
  k.organization= clamp01(k.organization+ LEARN_BASE * 1.0 * (1 - k.organization)* (1 + Math.sqrt(pop) * 0.10));
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ── Food ───────────────────────────────────────────────────────────
//
// Two supply sources: foraging (passive, over a neighbourhood) and
// farming (active, over the farmland set).
//
// Foraging used to be home-tile-only, which gave near-zero supply in
// any settlement not sitting on a lush square — completely unrealistic
// for hunter-gatherer baseline survival, and meant marginal-land
// hamlets always starved. Now foraging samples a 5×5 box (the
// neighbourhood the village can realistically walk), so a small
// village in semi-arid land can sustain ~20 people on hunting and
// gathering even with zero farmland.
//
// Farming still drives carrying capacity (K is set from farmland in
// updatePopulation), so the gain from foraging is *additive supply*,
// not *higher K*. A village stuck on forage alone stays at K=20 and
// just doesn't starve.
function updateFood(world, s) {
  const tw = world.tw, th = world.th;
  const sx = s.pos.x | 0, sy = s.pos.y | 0;
  // 5×5 forage area, fertility-summed. Includes the home tile.
  let forageArea = 0;
  for (let dy = -2; dy <= 2; dy++) {
    const ny = sy + dy;
    if (ny < 0 || ny >= th) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const ni = ny * tw + nx;
      forageArea += world.fert[ni] || 0;
    }
  }
  const forage = FORAGE_RATE * forageArea * (1 + (s.knowledge.foraging || 0.3) * 0.5);

  let farmYield = 0;
  for (const fti of s.farmland) farmYield += world.fert[fti] || 0;
  farmYield *= FARM_YIELD_PER_FERT * (1 + (s.knowledge.agriculture || 0) * 1.2);

  const supply = forage + farmYield;
  const demand = s.people * 0.0030;
  s.food += supply - demand;

  const storageCap = 80 + s.tier * 200;
  if (s.food > storageCap) s.food = storageCap;
  if (s.food < 0) s.food = 0;
}

// ── Population ─────────────────────────────────────────────────────
function updatePopulation(world, s) {
  let farmFert = 0;
  for (const fti of s.farmland) farmFert += world.fert[fti] || 0;
  const K = Math.max(20, farmFert * PEOPLE_PER_FARM_TILE * (1 + (s.knowledge.agriculture || 0) * 1.2));
  s._k = K;

  if (s.food <= 0.01 && s.people > 1) {
    s.people *= 0.985;
  } else {
    s.people = s.people + SETT_GROWTH * s.people * (1 - s.people / K);
  }
  if (s.people < 1.5) {
    s.mode = "dead";
    releaseFarmland(world, s);
    s.history.push({ step: world.step, type: "abandoned" });
    return;
  }
  // Withering: settlement has been below 8 people for too long.
  // Catches both stillborn farmland-less villages (food too scarce
  // even with 5×5 forage to grow) and post-famine zombies. Doesn't
  // touch small-but-stable forage hamlets in semi-arid land — those
  // hold ~10–15 people and never trip the timer.
  if (s.people < 8) {
    if (s._witherSince === undefined) s._witherSince = world.step;
    if (world.step - s._witherSince > 2000) {
      s.mode = "dead";
      releaseFarmland(world, s);
      s.history.push({ step: world.step, type: "withered" });
    }
  } else {
    s._witherSince = undefined;
  }
}

// ── Farmland selection ────────────────────────────────────────────
function maybeRefreshFarmland(world, s) {
  if (world.step - s.lastFarmRefresh < FARMLAND_REFRESH_INTERVAL) return;
  s.lastFarmRefresh = world.step;
  refreshFarmland(world, s);
}

function refreshFarmland(world, s) {
  // Minimum 4 farm tiles so a freshly-founded settlement (~20 ppl,
  // would naively want only 2 tiles) has enough food capacity to grow
  // past its founding pop.
  const target = Math.max(4, Math.ceil(s.people / PEOPLE_PER_FARM_TILE));
  const { tw, th, elev, fert, coast, riverMag, _farmedBy } = world;
  // Plantability floor for this settlement, given its current ag tech.
  const minFert = MIN_PLANTABLE_FERT_BASE - MIN_PLANTABLE_FERT_SLOPE * (s.knowledge.agriculture || 0);

  // ── Shrink: drop least-fertile tiles ──
  if (s.farmland.size > target) {
    const sorted = [...s.farmland].sort((a, b) => (fert[a] || 0) - (fert[b] || 0));
    while (s.farmland.size > target && sorted.length > 0) {
      const ti = sorted.shift();
      s.farmland.delete(ti);
      if (_farmedBy[ti] === s.id) _farmedBy[ti] = -1;
    }
  }

  // ── Grow: flood-fill from settlement, best score first ──
  // Candidates are bounded by TRANSPORT REACH (cheap Dijkstra cached on
  // the settlement), not Euclidean distance. Effect: a city on a river
  // stretches its fields along the cheap valley; a city walled in by
  // mountains gets a tight, irregular pocket of farmland. The flood-
  // fill itself still picks best-fert-first inside that reach, so the
  // shape follows soil quality within the corridor.
  //
  // Reach also widens as the settlement's transport knowledge matures
  // (wagons, roads, logistics — see localTransport). Cache is keyed by
  // tier; we also force a refresh every REACH_REFRESH_TICKS so a metro
  // sitting at the top tier for thousands of ticks still benefits from
  // its slowly-maturing tech.
  if (s.farmland.size < target) {
    const maxCost = MAX_TRANSPORT_BY_TIER[s.tier] || MAX_TRANSPORT_BY_TIER[0];
    const reachStale = !s._reach ||
                       s._reachTier !== s.tier ||
                       (world.step - (s._reachStep || -Infinity)) > REACH_REFRESH_TICKS;
    if (reachStale) {
      s._reach = localTransport(world, s.pos.x | 0, s.pos.y | 0, maxCost, s.knowledge);
      s._reachTier = s.tier;
      s._reachStep = world.step;
    }
    const reach = s._reach;
    const heap = new _MaxHeap();
    const visited = new Set(s.farmland);

    // Score: fertility primary, plus generous river/coast bonus so
    // settlements naturally extend along water rather than blob outward.
    const scoreTile = (ti) => {
      let sc = fert[ti] || 0;
      if (riverMag && riverMag[ti] >= 3)      sc += 0.6;
      else if (riverMag && riverMag[ti] >= 2) sc += 0.35;
      if (coast[ti])                          sc += 0.20;
      return sc;
    };

    const tryAddCandidate = (ti) => {
      if (visited.has(ti)) return;
      visited.add(ti);
      if (elev[ti] <= 0) return;
      if (!reach.has(ti)) return;            // out of transport range
      const owner = _farmedBy[ti];
      if (owner !== -1 && owner !== s.id) return;
      if ((fert[ti] || 0) < minFert) return;
      heap.push(ti, scoreTile(ti));
    };

    const pushNeighbours = (ti) => {
      const ty = (ti / tw) | 0;
      const tx = ti - ty * tw;
      const left  = ty * tw + (tx === 0 ? tw - 1 : tx - 1);
      const right = ty * tw + (tx === tw - 1 ? 0 : tx + 1);
      const up    = ty > 0      ? (ty - 1) * tw + tx : -1;
      const down  = ty < th - 1 ? (ty + 1) * tw + tx : -1;
      tryAddCandidate(left);
      tryAddCandidate(right);
      if (up   >= 0) tryAddCandidate(up);
      if (down >= 0) tryAddCandidate(down);
    };

    // Seed from existing farmland or the home tile.
    if (s.farmland.size === 0) {
      const home = (s.pos.y | 0) * tw + (s.pos.x | 0);
      visited.add(home);
      if (elev[home] > 0 && (fert[home] || 0) >= minFert &&
          (_farmedBy[home] === -1 || _farmedBy[home] === s.id)) {
        s.farmland.add(home);
        _farmedBy[home] = s.id;
      }
      pushNeighbours(home);
    } else {
      for (const ti of s.farmland) pushNeighbours(ti);
    }

    while (s.farmland.size < target && heap.size() > 0) {
      const top = heap.popMax();
      const ti = top.ti;
      const cur = _farmedBy[ti];
      if (cur !== -1 && cur !== s.id) continue;
      s.farmland.add(ti);
      _farmedBy[ti] = s.id;
      pushNeighbours(ti);
    }
  }
}

// Tiny binary max-heap, parallel typed arrays. Used by refreshFarmland's
// flood-fill expansion.
class _MaxHeap {
  constructor() { this.ti = []; this.sc = []; }
  size() { return this.ti.length; }
  push(ti, sc) {
    this.ti.push(ti); this.sc.push(sc);
    let i = this.ti.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.sc[p] >= this.sc[i]) break;
      const tt = this.ti[p], ts = this.sc[p];
      this.ti[p] = this.ti[i]; this.sc[p] = this.sc[i];
      this.ti[i] = tt; this.sc[i] = ts;
      i = p;
    }
  }
  popMax() {
    const ti = this.ti[0], sc = this.sc[0];
    const lastTi = this.ti.pop(), lastSc = this.sc.pop();
    if (this.ti.length > 0) {
      this.ti[0] = lastTi; this.sc[0] = lastSc;
      let i = 0;
      const n = this.ti.length;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let best = i;
        if (l < n && this.sc[l] > this.sc[best]) best = l;
        if (r < n && this.sc[r] > this.sc[best]) best = r;
        if (best === i) break;
        const tt = this.ti[best], ts = this.sc[best];
        this.ti[best] = this.ti[i]; this.sc[best] = this.sc[i];
        this.ti[i] = tt; this.sc[i] = ts;
        i = best;
      }
    }
    return { ti, sc };
  }
}

function releaseFarmland(world, s) {
  for (const ti of s.farmland) {
    if (world._farmedBy[ti] === s.id) world._farmedBy[ti] = -1;
  }
  s.farmland.clear();
  // Reach cache is positional + tier; both invariant when farmland is
  // released for a dying settlement, but null it out for cleanliness.
  s._reach = null;
}

// Bounded Dijkstra from (sx, sy). Returns Map<ti, accumulated cost> for
// every land tile reachable within maxCost. Uses the same continuous
// edge-cost function as the global transport map (transport.js) so
// units of "cost" are identical everywhere; just adds per-settlement
// tech multipliers (localEdgeCost).
function localTransport(world, sx, sy, maxCost, kn) {
  const { tw, th, elev } = world;
  const out = new Map();
  const seed = sy * tw + sx;
  if (elev[seed] <= 0) return out;
  const heap = new _MinHeap();
  out.set(seed, 0);
  heap.push(seed, 0);
  while (heap.n > 0) {
    const { ti, d } = heap.popMin();
    if (d > (out.get(ti) ?? Infinity)) continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const left  = ty * tw + (tx === 0 ? tw - 1 : tx - 1);
    const right = ty * tw + (tx === tw - 1 ? 0 : tx + 1);
    const up    = ty > 0      ? (ty - 1) * tw + tx : -1;
    const down  = ty < th - 1 ? (ty + 1) * tw + tx : -1;
    const ns = [left, right, up, down];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k];
      if (ni < 0) continue;
      const c = localEdgeCost(world, ti, ni, kn);
      if (c === Infinity) continue;
      const nd = d + c;
      if (nd > maxCost) continue;
      const cur = out.get(ni);
      if (cur === undefined || nd < cur) {
        out.set(ni, nd);
        heap.push(ni, nd);
      }
    }
  }
  return out;
}

// Tiny min-heap with parallel typed arrays — same shape as transport.js's
// _MinHeap. Duplicated to keep the modules independent at this scale; if
// a third caller shows up, lift it to a shared util.
class _MinHeap {
  constructor(cap = 256) {
    this.ti = new Int32Array(cap);
    this.d  = new Float32Array(cap);
    this.n  = 0;
    this.cap = cap;
  }
  _grow() {
    const ncap = this.cap * 2;
    const nti = new Int32Array(ncap); nti.set(this.ti);
    const nd  = new Float32Array(ncap); nd.set(this.d);
    this.ti = nti; this.d = nd; this.cap = ncap;
  }
  push(ti, d) {
    if (this.n >= this.cap) this._grow();
    let i = this.n++;
    this.ti[i] = ti; this.d[i] = d;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      const tt = this.ti[p], td = this.d[p];
      this.ti[p] = this.ti[i]; this.d[p] = this.d[i];
      this.ti[i] = tt; this.d[i] = td;
      i = p;
    }
  }
  popMin() {
    const ti = this.ti[0], d = this.d[0];
    this.n--;
    if (this.n === 0) return { ti, d };
    this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = i * 2 + 2;
      let best = i;
      if (l < this.n && this.d[l] < this.d[best]) best = l;
      if (r < this.n && this.d[r] < this.d[best]) best = r;
      if (best === i) break;
      const tt = this.ti[best], td = this.d[best];
      this.ti[best] = this.ti[i]; this.d[best] = this.d[i];
      this.ti[i] = tt; this.d[i] = td;
      i = best;
    }
    return { ti, d };
  }
}

// ── Tier ───────────────────────────────────────────────────────────
function updateTier(world, s) {
  for (let t = TIER_THRESHOLD.length - 1; t > s.tier; t--) {
    if (s.people >= TIER_THRESHOLD[t]) {
      s.tier = t;
      s.history.push({ step: world.step, type: "tier-up", tier: TIER_NAME[t], people: Math.round(s.people) });
      s.lastFarmRefresh = world.step - FARMLAND_REFRESH_INTERVAL;
      break;
    }
  }
}

export { TIER_THRESHOLD, TIER_NAME, releaseFarmland };
