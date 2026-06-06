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
// Organic front: a tile on an advancing border accumulates breakthrough PRESSURE
// each relax and only flips once it overcomes the tile's RESISTANCE. Open ground
// resists ~1 (flips at once, as before); mountains resist far more (the front
// stalls and bulges around ranges); and a coherent NOISE term jitters the edge so
// even a front across flat ground creeps as a ragged, organic line rather than a
// dead-straight wall. Pressure resets the moment a tile leaves a front.
const ELEV_RESIST  = 11;   // extra passes a high-elevation tile makes the front wait
const NOISE_RESIST = 2.5;  // coherent jitter (×_claimNoise 0..1) → ragged/bulging edge

// Ticks after a settlement is INTEGRATED out of the wild (adoptAndFound stamps
// _integratedAt) during which it does NOT plant a wild-land foothold — so its
// realm's colour crawls out to it FROM the existing border instead of blooming
// around the freshly-absorbed settlement. A genuinely new settlement on fresh
// land (a colony / crystallised town, no recent integration) plants normally.
const FOOTHOLD_GRACE = 600;

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

  // ── Instantaneous secession ────────────────────────────────────────
  // A country flagged by conquest.js (snapClaim — a secession / rebellion /
  // capital-fall successor) has its WHOLE Voronoi region painted at once this
  // pass, rather than crawled out as a slow wave: a province that declares
  // independence is its own that day. Cleared once its region has been painted
  // (it may take a pass for the territory Voronoi to draw the new region).
  const snap = world._claimSnap;
  if (snap && snap.size) {
    const seen = new Set();
    for (let ti = 0; ti < N; ti++) { const t = target[ti]; if (t >= 0 && snap.has(t)) { claim[ti] = t; seen.add(t); } }
    for (const id of seen) snap.delete(id);
  }

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
    if (s.mode !== "settled" || s.countryId < 0 || present.has(s.countryId)) continue;
    const cur = headOf.get(s.countryId);
    if (!cur || headScore(s) > headScore(cur)) headOf.set(s.countryId, s);
  }
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;   // stateless frontier settlements fly no flag
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (elev[ti] <= 0) continue;
    const cur = claim[ti];
    if (cur === s.countryId) continue;                       // already ours
    // A settlement that just GREW INTO the wild as its realm expanded (recent
    // _integratedAt) must NOT plant a foothold — its colour should crawl out from
    // the realm's existing border rather than bloom around the settlement. A
    // genuinely new settlement on fresh land (colony / crystallised town) plants.
    const recentlyIntegrated = world.step - (s._integratedAt ?? -Infinity) < FOOTHOLD_GRACE;
    if (cur === -1 && !recentlyIntegrated) { claim[ti] = s.countryId; continue; }   // fresh land — legit foothold
    // Either the home tile belongs to ANOTHER country, or it's wild but the
    // settlement is freshly integrated (above): flipping it is a transfer / would
    // bloom. Only the head of a country with no ground yet may plant its one
    // birth-foothold (so a brand-new realm can still be born); everyone else
    // waits for the crawl to reach them.
    if (!present.has(s.countryId) && headOf.get(s.countryId) === s) {
      claim[ti] = s.countryId;
      present.add(s.countryId);                              // it now exists; co-seceders wait for the crawl
    }
  }

  let press = world._claimPress;
  if (!press || press.length !== N) press = world._claimPress = new Float32Array(N);
  const noiseF = world._claimNoise;   // coherent value-noise field (countryTerritory.js); may be unset on the first pass
  for (let r = 0; r < RINGS_PER_RELAX; r++) {
    const flips = [];
    for (let ti = 0; ti < N; ti++) {
      if (elev[ti] <= 0) { if (claim[ti] >= 0) claim[ti] = -1; press[ti] = 0; continue; }  // water is never claimed
      const tg = target[ti];
      if (claim[ti] === tg) { press[ti] = 0; continue; }
      // The front has only reached here if the target country (or wilderness, -1)
      // already holds an orthogonal neighbour.
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      let adjacent = false;
      for (let k = 0; k < 4; k++) { const ni = ns[k]; if (ni < 0) continue; if (claim[ni] === tg) { adjacent = true; break; } }
      if (!adjacent) { press[ti] = 0; continue; }   // not on a front yet
      // Push against this tile; break through once pressure beats its resistance —
      // quick on open ground, slow on high terrain, ragged via the coherent noise.
      const nv = noiseF ? noiseF[ti] : 0.5;
      const resist = 1 + ELEV_RESIST * Math.max(0, elev[ti] - 0.3) + NOISE_RESIST * nv;
      if ((press[ti] += 1) >= resist) flips.push(ti);
    }
    if (flips.length === 0) break;
    for (const ti of flips) { claim[ti] = target[ti]; press[ti] = 0; }
  }
  return claim;
}
