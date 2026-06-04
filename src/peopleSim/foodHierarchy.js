// ── Central-place food hierarchy ──────────────────────────────────────
//
// Food flows UP the settlement hierarchy (village → market town → city →
// capital). Each settlement ships a tier-weighted fraction of its grain up to its
// liege and keeps the rest; a market centre therefore aggregates the shipped grain
// of its WHOLE subtree, so a city is fed by its entire hinterland — not a fixed
// handful of trade partners. This is Central Place Theory, and it's what lets real
// metropolises form (the flat 12-nearest-partner food trade capped a city's
// grain at ~12 villages). Goods / luxuries / money still trade flat (roads.js).
//
// One post-order sweep of the liege tree each tick (cheap, O(settlements)):
//   pool[s] = own storable production + Σ children's shipped-up food
//   up[s]   = pool × SHIP_BY_TIER[tier] × KEEP^hop        (a village ships most of
//             its grain to market; a city keeps + aggregates its hinterland's)
//   net[s]  = pool − up                                   (what s keeps → its food)
// A rural settlement is a FARM: it ships most of its grain surplus up to its
// market centre regardless of its own housing (the old "ship only beyond housing"
// rule failed because food-limited villages have no housing slack, so they shipped
// nothing and starved the cities). A city keeps most of what flows to it and grows.
// BARTER only — no coin moves, so the closed money supply is untouched; a city
// keeps the coin it no longer spends on grain, funding its housing and reinforcing
// the city-grows / village-stays-small pyramid.
//
// Runs at the END of the settlement phase (after updateFood/updatePopulation set
// fresh _storableSupply / _houseK / _urbanFactor), producing _foodNet for the
// NEXT tick's updateFood — a 1-tick lag that's invisible (production drifts slowly).

const KEEP_PER_HOP = 0.9;   // fraction of shipped food surviving each hop up the hierarchy
// Fraction of its food POOL a settlement ships up to its market centre, by tier
// (village → town → city → metropolis). A village is a farm: it sends most of its
// grain to market and stays small; a metropolis keeps nearly all that flows to it
// and grows into a primate city. The wide spread between tiers is what builds the
// settlement-size pyramid. Pool is land-based (independent of population), so a
// fixed FRACTION can't cause the pinning feedback a "pool − current demand" rule
// would (population growing to eat its food → zero surplus → ships nothing).
const SHIP_FRAC_BY_TIER = [0.8, 0.5, 0.2, 0.05];

export function aggregateFoodHierarchy(world) {
  const byId = world._byId;
  if (!byId) return;
  // Children lists from the CURRENT liege tree — same-country, alive parent only,
  // so a stale liegeId (after an absorption / secession between polity passes)
  // can't ship food across a border; such a settlement becomes a local root.
  const children = new Map();
  const roots = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    s._foodUp = 0;
    const L = (s.liegeId >= 0 && s.countryId >= 0) ? byId.get(s.liegeId) : null;
    if (L && L.mode === "settled" && L.countryId === s.countryId && L.id !== s.id) {
      s._hasFoodParent = true;
      let a = children.get(L.id); if (!a) children.set(L.id, a = []); a.push(s);
    } else {
      s._hasFoodParent = false;
      roots.push(s);
    }
  }
  // Iterative post-order from each root (children processed before their parent),
  // with a seen-guard so a pathological liege cycle can't loop forever.
  const seen = new Set();
  for (const root of roots) {
    const stack = [[root, false]];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const node = frame[0];
      if (!frame[1]) {
        frame[1] = true;
        if (seen.has(node.id)) { stack.pop(); continue; }   // cycle guard
        seen.add(node.id);
        const kids = children.get(node.id);
        if (kids) for (const k of kids) if (!seen.has(k.id)) stack.push([k, false]);
      } else {
        stack.pop();
        let pool = node._storableSupply || 0;
        const kids = children.get(node.id);
        if (kids) for (const k of kids) pool += k._foodUp || 0;
        node._foodPool = pool;
        const sf = SHIP_FRAC_BY_TIER[Math.min(3, Math.max(0, node.tier | 0))];
        const up = node._hasFoodParent ? pool * sf * KEEP_PER_HOP : 0;
        node._foodUp = up;
        node._foodNet = pool - up;                          // what it keeps for its own population
      }
    }
  }
}
