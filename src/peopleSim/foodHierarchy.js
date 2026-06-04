// ── Central-place food hierarchy ──────────────────────────────────────
//
// Food flows UP the settlement hierarchy (village → market town → city →
// capital). Each settlement keeps what its HOUSING can use and ships the surplus
// up to its liege; a market centre therefore aggregates the surplus of its WHOLE
// subtree, so a city is fed by its entire hinterland — not a fixed handful of
// trade partners. This is Central Place Theory, and it's what lets real
// metropolises form (the flat 12-nearest-partner food trade capped a city's
// grain at ~12 villages). Goods / luxuries / money still trade flat (roads.js).
//
// One post-order sweep of the liege tree each tick (cheap, O(settlements)):
//   pool[s] = own storable production + Σ children's shipped-up food
//   up[s]   = max(0, pool − houseCap) × KEEP^hop   (food beyond what s's housing
//             can hold, shipped up; the per-hop KEEP is freight + spoilage)
//   net[s]  = pool − up                            (what s keeps → its food supply)
// A housing-limited rural settlement ships its farm surplus up; a housing-rich
// city keeps and aggregates it. BARTER only — no coin moves, so the closed money
// supply is untouched; a city simply keeps the coin it no longer spends on grain,
// which funds its housing and reinforces the city-grows / village-stays-small
// pyramid.
//
// Runs at the END of the settlement phase (after updateFood/updatePopulation set
// fresh _storableSupply / _houseK / _urbanFactor), producing _foodNet for the
// NEXT tick's updateFood — a 1-tick lag that's invisible (production drifts slowly).

const KEEP_PER_HOP = 0.9;   // fraction of shipped food surviving each hop up the hierarchy
const PERCAP = 0.003;

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
        const perCap = PERCAP * (node._urbanFactor || 1);
        const houseCap = (node._houseK || 0) * perCap;     // food the settlement's housing can actually use
        const up = node._hasFoodParent ? Math.max(0, pool - houseCap) * KEEP_PER_HOP : 0;
        node._foodUp = up;
        node._foodNet = pool - up;                          // what it keeps for its own population
      }
    }
  }
}
