// ── National border: a PROGRESSIVE, tile-by-tile crawl ───────────────
//
//   relaxClaim(world) → world._countryClaim
//     The drawn political border. Each call it crawls ONE ring toward the
//     country-primary territory target (world._countryOwner — see
//     countryTerritory.js): every settlement's home tile flies its current flag
//     (a foothold), and a tile only flips to its target country once that
//     country already holds an orthogonal neighbour. So land NEVER teleports —
//     when a city is taken or a town secedes the target flips at once, but the
//     LAND is re-coloured tile by tile, emanating outward, over many ticks. A
//     brand-new realm is born from the single foothold of its main settlement.
//
// Render-only: nothing in the sim depends on _countryClaim.

// Rings the drawn border advances toward the target per relax call. 1 = slowest,
// smoothest crawl. index.js calls relaxClaim every CLAIM_RELAX_INTERVAL ticks.
const RINGS_PER_RELAX = 1;

// "Main" settlement of a country: the strongest member (tier first, then
// people) — the same seat rebuildCountries would crown capital. Used to pick
// the single tile a brand-new realm's claim is born from. Robust to a dead
// founder (a country id can outlive the settlement it was named for).
function headScore(s) { return (s.tier | 0) * 1e7 + (s.people || 0); }


// Crawl the drawn claim one (or RINGS_PER_RELAX) ring toward the target. A tile
// only changes hands once the gaining country (or wilderness) already holds a
// neighbour — so borders advance/retreat tile by tile, never jumping.
export function relaxClaim(world) {
  const { N, tw, th, elev } = world;
  let claim = world._countryClaim;
  if (!claim || claim.length !== N) { claim = world._countryClaim = new Int32Array(N); claim.fill(-1); }
  const target = world._countryOwner;   // country-primary territory (countryTerritory.js)
  if (!target) return claim;

  // ── Footholds ──────────────────────────────────────────────────────
  // A settlement plants its flag on its OWN home tile only when doing so is
  // NOT a transfer of land away from another country — otherwise the claim must
  // CRAWL to it (below) so land never teleports. A home tile is planted when:
  //   • it is already ours        → no-op;
  //   • it is wilderness (-1)     → a settlement legitimately sits on fresh land
  //                                  (a new colony / crystallised town / the
  //                                  very first village) — not a land transfer;
  //   • it belongs to ANOTHER country, BUT this settlement is the HEAD of a
  //     country that holds no tiles yet → the single birth-foothold a brand-new
  //     realm needs. Only the head plants it, so a secession (even a multi-city
  //     revolt) EMANATES from its one main settlement and then crawls outward to
  //     absorb its co-seceders' land, instead of every breakaway city lighting
  //     up at once.
  // First: which countries already hold ground, and (for those that don't yet)
  // their head settlement.
  const present = new Set();
  for (let ti = 0; ti < N; ti++) { const v = claim[ti]; if (v >= 0) present.add(v); }
  const headOf = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled" || present.has(s.countryId)) continue;
    const cur = headOf.get(s.countryId);
    if (!cur || headScore(s) > headScore(cur)) headOf.set(s.countryId, s);
  }
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (elev[ti] <= 0) continue;
    const cur = claim[ti];
    if (cur === s.countryId) continue;                       // already ours
    if (cur === -1) { claim[ti] = s.countryId; continue; }   // fresh land — legit foothold
    // Home tile currently belongs to another country: flipping it is a land
    // transfer. Only the head of a country with no ground yet may plant its one
    // birth-foothold; everyone else waits for the crawl to reach them.
    if (!present.has(s.countryId) && headOf.get(s.countryId) === s) {
      claim[ti] = s.countryId;
      present.add(s.countryId);                              // it now exists; co-seceders wait for the crawl
    }
  }

  for (let r = 0; r < RINGS_PER_RELAX; r++) {
    const flips = [];
    for (let ti = 0; ti < N; ti++) {
      if (elev[ti] <= 0) { if (claim[ti] >= 0) claim[ti] = -1; continue; }  // water is never claimed
      const tg = target[ti];
      if (claim[ti] === tg) continue;
      // Flip toward the target only if the target country (or wilderness, -1)
      // already holds an orthogonal neighbour — i.e. its front has reached here.
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      let adjacent = false;
      for (let k = 0; k < 4; k++) { const ni = ns[k]; if (ni < 0) continue; if (claim[ni] === tg) { adjacent = true; break; } }
      if (adjacent) flips.push(ti);
    }
    if (flips.length === 0) break;
    for (const ti of flips) claim[ti] = target[ti];
  }
  return claim;
}
