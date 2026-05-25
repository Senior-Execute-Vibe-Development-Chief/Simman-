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

// Daughter colony rules
const FOUND_DAUGHTER_CHECK_INTERVAL = 80;   // ticks between attempts
const FOUND_DAUGHTER_PRESSURE = 0.75;       // parent must be at ≥ this fraction of K
const FOUND_DISCOVERY_BY_TIER = [10, 18, 28, 42];   // search radius in tiles
const FOUND_MIN_SETTLEMENT_DIST = 12;       // belt-and-braces — same as state.js cap
const DAUGHTER_POP_FRAC = 0.30;             // parent gives this fraction to daughter
const DAUGHTER_KNOW_FRAC = 0.80;            // daughter inherits this fraction of parent's knowledge

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
  updateTier(world, s);
  maybeFoundDaughter(world, s);
}

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
  const target = Math.max(1, Math.ceil(s.people / PEOPLE_PER_FARM_TILE));
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

// ── Daughter colonies ─────────────────────────────────────────────
// Parent settlement at high pressure surveys its discovery range for
// a viable new settlement site. If one passes the standard checks
// (fertility, water, min-distance from all existing settlements), it
// spawns a daughter and hands over part of its population + most of
// its knowledge.
function maybeFoundDaughter(world, s) {
  if (world.step - s.lastFoundAttempt < FOUND_DAUGHTER_CHECK_INTERVAL) return;
  s.lastFoundAttempt = world.step;
  // Cap check.
  let alive = 0;
  for (const o of world.settlements) if (o.mode !== "dead") alive++;
  if (alive >= world.cap.settlements) return;
  // Pressure check — only mature settlements colonise.
  const K = s._k || 50;
  if (s.people < K * FOUND_DAUGHTER_PRESSURE) return;
  if (s.people < 30) return;        // too small to send anyone
  // Survey: pick the best qualifying site in discovery range.
  const range = FOUND_DISCOVERY_BY_TIER[s.tier] || FOUND_DISCOVERY_BY_TIER[0];
  const target = findColonyTarget(world, s, range);
  if (!target) return;
  // Spawn daughter and transfer pop + knowledge.
  const daughterPop = Math.max(15, Math.floor(s.people * DAUGHTER_POP_FRAC));
  s.people -= daughterPop;
  const inheritedKnow = {};
  for (const k of Object.keys(s.knowledge)) inheritedKnow[k] = s.knowledge[k] * DAUGHTER_KNOW_FRAC;
  const daughter = makeSettlement(world, target.x, target.y, {
    people: daughterPop,
    knowledge: inheritedKnow,
    traits: { ...s.traits },
    parentId: s.id,
  });
  s.history.push({ step: world.step, type: "founded-daughter", id: daughter.id, sent: daughterPop });
}

function findColonyTarget(world, parent, range) {
  const { tw, th, elev, fert, coast, riverMag } = world;
  const cx = parent.pos.x | 0, cy = parent.pos.y | 0;
  const minDistSq = FOUND_MIN_SETTLEMENT_DIST * FOUND_MIN_SETTLEMENT_DIST;
  let bestTi = -1, bestX = 0, bestY = 0, bestScore = -Infinity;
  for (let dy = -range; dy <= range; dy++) {
    const ny = cy + dy;
    if (ny < 2 || ny >= th - 2) continue;
    for (let dx = -range; dx <= range; dx++) {
      const distSq = dx * dx + dy * dy;
      if (distSq < FOUND_MIN_SETTLEMENT_DIST * FOUND_MIN_SETTLEMENT_DIST) continue;
      if (distSq > range * range) continue;
      const nx = ((cx + dx) % tw + tw) % tw;
      const ni = ny * tw + nx;
      if (elev[ni] <= 0.005) continue;
      const f = fert[ni];
      if (f < 0.40) continue;
      const hasRiver = riverMag && riverMag[ni] >= 2;
      const hasCoast = coast && coast[ni];
      if (!hasRiver && !hasCoast && f < 0.60) continue;
      // Min distance to ALL other settlements.
      let tooClose = false;
      for (const o of world.settlements) {
        if (o.mode === "dead") continue;
        let ddx = Math.abs(o.pos.x - nx);
        if (ddx > tw / 2) ddx = tw - ddx;
        const ddy = o.pos.y - ny;
        if (ddx * ddx + ddy * ddy < minDistSq) { tooClose = true; break; }
      }
      if (tooClose) continue;
      // Score: fertility + water bonus, with mild preference for
      // closer-to-parent (real expansion is incremental, not random).
      let score = f * 2;
      if (hasRiver) score += 1.5;
      if (hasCoast) score += 0.6;
      score -= distSq * 0.005;
      if (score > bestScore) { bestScore = score; bestTi = ni; bestX = nx; bestY = ny; }
    }
  }
  if (bestTi < 0) return null;
  return { x: bestX + 0.5, y: bestY + 0.5 };
}

export { TIER_THRESHOLD, TIER_NAME, releaseFarmland };
