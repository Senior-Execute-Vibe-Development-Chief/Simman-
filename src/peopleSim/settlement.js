// Settlement: a band that stopped wandering. Now a single icon (sized
// by tier) with a patch of farmland painted on the most fertile tiles
// around it. No individual house / farm entities — those were
// SimCity-tier detail at this atlas zoom.
//
// Farmland: each settlement owns a Set of tile indices. The set
// expands and contracts with population so a town has more painted
// farm tiles than a village. Tiles are picked by fertility; world
// state tracks ownership so two neighbouring settlements don't both
// claim the same cell.
//
// Food: sum of (tile fertility) over the farmland set, multiplied by
// the agriculture-knowledge yield modifier. More fertile farmland =
// more food per worker. Forage from the immediate area adds a small
// baseline.
//
// Tier scales the settlement icon AND the farmland range: villages
// farm tiles within ~3, cities within ~10. Pop growth → more farmland
// → bigger icon.

let _nextId = 1;
export function resetSettlementIds() { _nextId = 1; }

const TIER_THRESHOLD = [0, 80, 400, 2000];        // village, town, city, metropolis
const TIER_NAME      = ["village", "town", "city", "metropolis"];

const SETT_GROWTH = 0.0045;          // logistic rate per tick

// Farmland model:
//   1 painted tile feeds PEOPLE_PER_FARM_TILE people on average. Yield
//   scales with the tile's fertility AND the settlement's agriculture
//   knowledge, so a tile in a lush river valley produces more than one
//   on a marginal plain.
//
// Yield is calibrated so that supply ≥ demand at K, with a ~30% margin
// so pop actually grows up to K instead of stalling at break-even:
//   demand(K) = K · 0.003 = farmFert · 14 · 1.6 · 0.003 = 0.067 · farmFert
//   supply(K) = farmFert · Y · 1.6
//   Y = 0.055 gives supply/demand ≈ 1.31 at K.
const PEOPLE_PER_FARM_TILE = 14;
const FARM_YIELD_PER_FERT  = 0.055;
const FORAGE_RATE          = 0.012;  // baseline forage food/tick at settlement tile

// Farmland search range by tier: village stays close to home, cities
// reach out for distant fertile valleys.
const FARM_RANGE_BY_TIER   = [3, 5, 8, 12];

// Farmland refresh cadence. Daily recalc would be wasteful — pop
// changes slowly, so re-evaluate every N ticks per settlement (offset
// by id so they don't all recompute on the same tick).
const FARMLAND_REFRESH_INTERVAL = 32;

export function settleBand(world, band, name) {
  const s = {
    id: _nextId++,
    kind: "settlement",
    pos: { x: Math.floor(band.pos.x) + 0.5, y: Math.floor(band.pos.y) + 0.5 },
    foundedStep: world.step,
    founderBandId: band.id,
    name: name || `settlement-${_nextId - 1}`,
    people: band.people,
    food: band.people * 30,            // generous founding stockpile
    knowledge: { ...band.knowledge },
    traits: { ...band.traits },
    farmland: new Set(),               // tile indices this settlement farms
    tier: 0,                           // 0=village
    mode: "settled",
    lastFarmRefresh: world.step,
    history: [{ step: world.step, type: "founded", from: band.id, pos: { x: band.pos.x, y: band.pos.y } }],
  };
  world.settlements.push(s);
  band.mode = "dead";
  band.history.push({ step: world.step, type: "settled", asSettlement: s.id });
  // Seed initial farmland so the village isn't starving on day one.
  refreshFarmland(world, s);
  return s;
}

export function updateSettlement(world, s) {
  if (s.mode !== "settled") return;
  updateFood(world, s);
  updatePopulation(world, s);
  maybeRefreshFarmland(world, s);
  updateTier(world, s);
}

// ── Food ───────────────────────────────────────────────────────────
// Sum fertility across farmed tiles × ag-knowledge multiplier. Plus a
// small forage rate from the settlement's home tile.
function updateFood(world, s) {
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const homeFert = world.fert[ti] || 0.05;
  const forage = FORAGE_RATE * homeFert * (1 + (s.knowledge.foraging || 0.3) * 0.5);

  let farmYield = 0;
  for (const fti of s.farmland) {
    farmYield += world.fert[fti] || 0;
  }
  farmYield *= FARM_YIELD_PER_FERT * (1 + (s.knowledge.agriculture || 0) * 1.2);

  const supply = forage + farmYield;
  const demand = s.people * 0.0030;
  s.food += supply - demand;

  // Storage cap — bigger settlements hold more.
  const storageCap = 80 + s.tier * 200;
  if (s.food > storageCap) s.food = storageCap;
  if (s.food < 0) s.food = 0;
}

// ── Population ─────────────────────────────────────────────────────
// K = food capacity of the farmland (no housing limit any more — at
// this scale we just assume people build dwellings as needed).
function updatePopulation(world, s) {
  let farmFert = 0;
  for (const fti of s.farmland) farmFert += world.fert[fti] || 0;
  // K = sustainable pop = total fertility / per-capita-need × yield.
  // Roughly: each tile of fert=1 supports PEOPLE_PER_FARM_TILE people.
  const K = Math.max(20, farmFert * PEOPLE_PER_FARM_TILE * (1 + (s.knowledge.agriculture || 0) * 1.2));
  if (s.food <= 0.01 && s.people > 1) {
    s.people *= 0.985;                              // famine
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
// Each refresh: target = ceil(pop / PEOPLE_PER_FARM_TILE). Add the
// most-fertile unclaimed tiles within range; shrink to the most-
// fertile of the current set when pop drops.
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

  // Shrink first: drop the LEAST fertile tiles from the current set
  // until at or below target. Frees up tiles for whoever needs them.
  if (s.farmland.size > target) {
    const sorted = [...s.farmland].sort((a, b) => (fert[a] || 0) - (fert[b] || 0));
    while (s.farmland.size > target && sorted.length > 0) {
      const ti = sorted.shift();
      s.farmland.delete(ti);
      if (_farmedBy[ti] === s.id) _farmedBy[ti] = -1;
    }
  }

  // Grow: walk the box around the settlement, score each unclaimed
  // fertile tile, claim the best ones up to `target` total. Tiles
  // farther from home pay a small distance cost so growth stays
  // contiguous.
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
        if (owner !== -1 && owner !== s.id) continue;   // claimed by another settlement
        const f = fert[ni];
        if (f < 0.1) continue;
        // Score: fertility minus small distance penalty so the patch
        // stays near home (looks like ONE settlement's land, not a
        // scatter).
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
      // Tier-up may unlock farther-reach farmland — refresh next tick.
      s.lastFarmRefresh = world.step - FARMLAND_REFRESH_INTERVAL;
      break;
    }
  }
}

export { TIER_THRESHOLD, TIER_NAME, releaseFarmland };
