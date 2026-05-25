// Settlement: a permanent community at a fixed location. Single icon
// (tier-scaled) with a patch of farmland painted on the most fertile
// tiles within reach. No bands, no individual buildings — the
// settlement is the atomic visible unit.
//
// New settlements come from two sources:
//   1. The cradle village, seeded at world init at the cradle-of-
//      humankind site (handled in state.js).
//   2. Daughter colonies founded by an existing settlement when it
//      hits its carrying capacity. The parent surveys its discovery
//      range for a viable site, spawns a new village there, and
//      transfers ~30 % of its population to the new community.
//
// Knowledge spreads via inheritance (daughters get ~80 % of parent's
// knowledge) and slow neighbour diffusion. Over many generations the
// neolithic package spreads from the cradle outward.

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
const FARM_RANGE_BY_TIER   = [3, 5, 8, 12];
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
function updateFood(world, s) {
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const homeFert = world.fert[ti] || 0.05;
  const forage = FORAGE_RATE * homeFert * (1 + (s.knowledge.foraging || 0.3) * 0.5);

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
  s._k = K;     // stashed for daughter-colony pressure check

  if (s.food <= 0.01 && s.people > 1) {
    s.people *= 0.985;
  } else {
    s.people = s.people + SETT_GROWTH * s.people * (1 - s.people / K);
  }
  if (s.people < 1.5) {
    s.mode = "dead";
    releaseFarmland(world, s);
    s.history.push({ step: world.step, type: "abandoned" });
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
  // past its founding pop. Without this, new settlements with <3
  // tiles hit K=20-30, stall, and die out.
  const target = Math.max(4, Math.ceil(s.people / PEOPLE_PER_FARM_TILE));
  const range = FARM_RANGE_BY_TIER[s.tier] || FARM_RANGE_BY_TIER[0];
  const { tw, th, elev, fert, _farmedBy } = world;
  const cx = s.pos.x | 0, cy = s.pos.y | 0;

  if (s.farmland.size > target) {
    const sorted = [...s.farmland].sort((a, b) => (fert[a] || 0) - (fert[b] || 0));
    while (s.farmland.size > target && sorted.length > 0) {
      const ti = sorted.shift();
      s.farmland.delete(ti);
      if (_farmedBy[ti] === s.id) _farmedBy[ti] = -1;
    }
  }

  if (s.farmland.size < target) {
    const candidates = [];
    for (let dy = -range; dy <= range; dy++) {
      const ny = cy + dy;
      if (ny < 1 || ny >= th - 1) continue;
      for (let dx = -range; dx <= range; dx++) {
        const nx = ((cx + dx) % tw + tw) % tw;
        const ni = ny * tw + nx;
        if (elev[ni] <= 0) continue;
        if (s.farmland.has(ni)) continue;
        const owner = _farmedBy[ni];
        if (owner !== -1 && owner !== s.id) continue;
        const f = fert[ni];
        if (f < 0.1) continue;
        const distPenalty = (dx * dx + dy * dy) * 0.005;
        candidates.push({ ni, score: f - distPenalty });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const needed = target - s.farmland.size;
    for (let i = 0; i < Math.min(needed, candidates.length); i++) {
      const ni = candidates[i].ni;
      s.farmland.add(ni);
      _farmedBy[ni] = s.id;
    }
  }
}

function releaseFarmland(world, s) {
  for (const ti of s.farmland) {
    if (world._farmedBy[ti] === s.id) world._farmedBy[ti] = -1;
  }
  s.farmland.clear();
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
