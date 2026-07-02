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
// ...but the crawl must keep PACE with a realm's growing territory regardless of
// map size. At a fixed 1 ring/relax the border advances the same number of TILES
// per tick on any map, so on the full-res world (≈4× wider than the test grid)
// it covers ¼ the ground — and because a settlement is only claimed once the
// border grows over it, realms can't bootstrap and the map freezes into a
// confetti of stateless villages at ~0% claimed. So scale the rings with the map
// width (reference RELAX_REF_W) so the front covers a consistent FRACTION of the
// world per tick. (SIM_CLAIM_RINGS env overrides, for A/B.)
const RELAX_REF_W = 240;
const _ringsEnv = (typeof process !== "undefined" && process.env && +process.env.SIM_CLAIM_RINGS) || 0;
function ringsPerRelax(tw) {
  return _ringsEnv > 0 ? _ringsEnv : Math.max(RINGS_PER_RELAX, Math.round(RINGS_PER_RELAX * tw / RELAX_REF_W));
}
// Organic front: a tile on an advancing border accumulates breakthrough PRESSURE
// each relax and only flips once it overcomes the tile's RESISTANCE. Open ground
// resists ~1 (flips at once, as before); mountains resist far more (the front
// stalls and bulges around ranges); and a coherent NOISE term jitters the edge so
// even a front across flat ground creeps as a ragged, organic line rather than a
// dead-straight wall. Pressure resets the moment a tile leaves a front.
const ELEV_RESIST  = 11;   // extra passes a high-elevation tile makes the front wait
const NOISE_RESIST = 2.5;  // coherent jitter (×_claimNoise 0..1) → ragged/bulging edge

// "Main" settlement of a country: the strongest member (tier first, then
// people) — the same seat rebuildCountries would crown capital. Used to pick
// the single tile a brand-new realm's claim is born from. Robust to a dead
// founder (a country id can outlive the settlement it was named for).
function headScore(s) { return (s.tier | 0) * 1e7 + (s.people || 0); }

// The political territory a realm has actually GROWN over at tile `ti`: the
// rendered claim (the border it has crawled across — see relaxClaim), or −1 for
// wilderness/water. Settlements take their country from THIS, not from the
// instantly-projected target (world._countryOwner): a town is claimed once the
// border grows over it, never ahead of the visible front. That keeps growth
// reading as ONE organic front creeping outward — and stops the runaway where a
// frontier town, claimed off the target the moment a realm's reach merely
// projected to it, became a fresh seed and lurched the whole claim outward a
// reach-budget at a time (the "weird growth / claimed before the country gets
// there" pathology). Falls back to the target only before the very first crawl
// has run (step 1), when no claim array exists yet.
const _adoptTarget = (typeof process !== "undefined" && process.env && +process.env.SIM_ADOPT_TARGET) || 0;
// Adoption-safe variant: the crawled claim erodes over many relax passes, so
// it can keep flying a DEAD realm's colours long after its last settlement
// fell or seceded away. Villages adopting straight off the raw claim executed
// s.countryId = <dead id>, resurrecting fallen realms as zombie states (~1 per
// territory pass, measured). Resolve through the live-country set instead;
// a dead id reads as wilderness (-1). The set is a per-step cached scan.
export function grownLiveOwnerAt(world, ti) {
  const id = grownOwnerAt(world, ti);
  if (id < 0) return -1;
  let alive = world._aliveCC;
  if (!alive || world._aliveCCStep !== world.step) {
    alive = world._aliveCC = alive || new Set(); alive.clear();
    for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) alive.add(s.countryId);
    world._aliveCCStep = world.step;
  }
  return alive.has(id) ? id : -1;
}

export function grownOwnerAt(world, ti) {
  if (_adoptTarget) { const co = world._countryOwner; return co ? co[ti] : -1; }   // A/B: adopt off the projected target (old behaviour)
  const claim = world._countryClaim;
  if (claim && claim.length === world.N) return claim[ti];
  const co = world._countryOwner;
  return co ? co[ti] : -1;
}

// Is this tile on the SAME LANDMASS as land country `cid` already claims? Land
// becomes a realm's only as its border crawls into it from ground it holds, so a
// settlement standing on unclaimed land must WAIT for the crawl rather than light
// up its own tile — otherwise a realm's scattered or not-yet-reached towns appear
// as disconnected dots ahead of the border. The one case that legitimately needs
// its own seed is a settlement the border can NEVER crawl to: one cut off by
// WATER (an overseas colony / island), since the crawl never crosses sea.
//
// Answered EXACTLY via a static landmass-component map (terrain never changes,
// so it's computed once per world) plus a per-relax index of which components
// each realm's claim touches. The old implementation flooded outward with a
// 4000-tile budget and treated a budget-exhausted search as "different
// landmass" — on a big continent whose claim sat far away that planted exactly
// the disconnected dots this function exists to prevent.
function landComp(world) {
  let comp = world._landComp;
  if (comp && comp.length === world.N) return comp;
  const { N, tw, th, elev } = world;
  comp = world._landComp = new Int32Array(N).fill(-1);
  const stack = [];
  for (let seed = 0; seed < N; seed++) {
    if (comp[seed] >= 0 || elev[seed] <= 0) continue;
    stack.length = 0; stack.push(seed); comp[seed] = seed;   // 4-neighbour, x wraps — matches the crawl's connectivity
    while (stack.length) {
      const ti = stack.pop();
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const ns = [ty * tw + (tx === 0 ? tw - 1 : tx - 1), ty * tw + (tx === tw - 1 ? 0 : tx + 1),
                  ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      for (let k = 0; k < 4; k++) {
        const ni = ns[k]; if (ni < 0 || comp[ni] >= 0 || elev[ni] <= 0) continue;
        comp[ni] = seed; stack.push(ni);
      }
    }
  }
  return comp;
}


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
  // Which landmass COMPONENTS each present realm's claim touches — built in the
  // same O(N) scan, so the foothold test below ("does my realm hold ground on
  // MY landmass?") is an exact O(1) lookup instead of a bounded flood.
  const comp = landComp(world);
  const claimComps = new Map();
  for (let ti = 0; ti < N; ti++) {
    const v = claim[ti]; if (v < 0) continue;
    present.add(v);
    let s2 = claimComps.get(v); if (!s2) claimComps.set(v, s2 = new Set());
    s2.add(comp[ti]);
  }
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
    if (cur >= 0) continue;                                  // belongs to another country — only the crawl may transfer it
    // The home tile is unclaimed land. Land becomes a realm's only as its border
    // CRAWLS into it from ground it already holds — a settlement does NOT light up
    // its own tile just for standing on wilderness, or a realm's frontier towns
    // would appear as disconnected dots ahead of the advancing border. The only
    // tiles that legitimately seed themselves:
    if (present.has(s.countryId)) {
      // realm already holds ground: plant ONLY if this is a different LANDMASS
      // (an overseas colony the crawl can never cross water to reach). A town on
      // the same landmass — even one not yet reached — waits for the border, so
      // it never shows as a disconnected dot ahead of the advance.
      const held = claimComps.get(s.countryId);
      if (!held || !held.has(comp[ti])) claim[ti] = s.countryId;
    } else if (headOf.get(s.countryId) === s) {
      claim[ti] = s.countryId;                               // the realm's single BIRTH foothold
      present.add(s.countryId);                              // it now exists; everyone else waits for the crawl
    }
  }

  let press = world._claimPress;
  if (!press || press.length !== N) press = world._claimPress = new Float32Array(N);
  const noiseF = world._claimNoise;   // coherent value-noise field (countryTerritory.js); may be unset on the first pass
  const rings = ringsPerRelax(tw);    // map-size-scaled so the front keeps pace at any resolution (see ringsPerRelax)
  for (let r = 0; r < rings; r++) {
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
  // ── Across-water territory: SNAP (the land front can't cross the sea) ──
  // A realm whose cost-Voronoi reaches the far shore of an enclosed sea or a
  // strait (a mare nostrum) holds that land in _countryOwner, but the crawl above
  // is land-only, so it would never SHOW — only settled colony footholds appeared.
  // Paint owned WILDERNESS that sits on a landmass the realm's land-claim doesn't
  // touch: its far-shore / overseas holdings appear at once (no land path to
  // animate). Never transfers another realm's already-drawn land (that's conquest).
  {
    const touch = new Map();
    for (let ti = 0; ti < N; ti++) { const v = claim[ti]; if (v < 0 || elev[ti] <= 0) continue; let s2 = touch.get(v); if (!s2) touch.set(v, s2 = new Set()); s2.add(comp[ti]); }
    for (let ti = 0; ti < N; ti++) {
      if (elev[ti] <= 0) continue;
      const tg = target[ti];
      if (tg < 0 || claim[ti] >= 0) continue;      // unowned, or already drawn (don't snatch across water)
      const held = touch.get(tg);
      if (!held || !held.has(comp[ti])) claim[ti] = tg;   // far-shore land the crawl can't reach
    }
  }
  return claim;
}
