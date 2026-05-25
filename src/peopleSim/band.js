// Band: a mobile group of hunter-gatherers.
//
// Lives in continuous world-space (x,y are floats, not tile indices).
// Each tick wanders toward higher-fertility, lower-crowding nearby
// tiles. Grows slowly. Splits when too large for the food a moving
// band can sustain. Settles when conditions favour staying put — see
// settlement.js for the transition.

const BAND_BASE_GROWTH = 0.0015;  // per tick, fraction of pop
const BAND_SPLIT_AT    = 22;      // people; above this, split
const BAND_MIN_AFTER_SPLIT = 6;
// Move speed in peopleSim tile-space (psw.tileRes = 2 world pixels per tile).
// At 0.15 tile/tick × 3 substeps × 60fps = ~27 tiles/sec ≈ 54 px/sec —
// slow drift, but clearly visible at this map scale. Smaller values
// made the user perceive them as standing still.
const BAND_MOVE_SPEED  = 0.15;
// Wider rings + bigger crowd-aware search. Bands now jump further each
// target-pick and consider tiles well outside the cluster.
const BAND_SCAN_RINGS  = [7, 14, 24];  // radii tried when picking next step
// Carrying capacity for a wandering band: a band moves across many
// tiles, so K is bigger than what a single tile supports. Tunable.
const BAND_K_BASE      = 10;
const BAND_K_FERT      = 50;

let _nextId = 1;

export function resetBandIds() { _nextId = 1; }

export function makeBand(world, x, y, people = 12, opts = {}) {
  return {
    id: _nextId++,
    kind: "band",
    pos: { x, y },
    target: null,                 // {x,y} current wander destination
    // Heading (radians) gives the wander a persistent direction so it
    // doesn't bounce randomly. Drifts slowly between target picks; new
    // splits inherit an OUTWARD heading so descendants colonise in
    // coherent directions instead of milling around the parent.
    heading: opts.heading != null ? opts.heading : world.rng() * Math.PI * 2,
    people,
    knowledge: opts.knowledge || {
      foraging:    0.4 + world.rng() * 0.1,
      toolmaking:  0.1,
      agriculture: 0,
      construction: 0,
      organization: 0,
    },
    traits: opts.traits || {
      wanderlust:  world.rng(),
      sociability: world.rng(),
      caution:     world.rng(),
    },
    mode: "wander",               // wander | settling | dead
    bornStep: world.step,
    parentBandId: opts.parentBandId || -1,
    history: [{ step: world.step, type: "born", pos: { x, y } }],
  };
}

// Per-tick update. Mutates `band` in place.
export function updateBand(world, band) {
  if (band.mode === "dead" || band.mode === "settling") return;

  wander(world, band);
  growBand(world, band);
  learn(world, band);
  checkSettle(world, band);

  // Split when oversized. No global band cap — bands spread until
  // they hit local density limits enforced inside splitBand. A safety
  // ceiling stops a runaway split loop from allocating forever.
  if (band.people >= BAND_SPLIT_AT &&
      aliveBandCount(world) < world.cap.bandSafety) {
    splitBand(world, band);
  }
}

function aliveBandCount(world) {
  let n = 0;
  for (const b of world.bands) if (b.mode !== "dead") n++;
  return n;
}
function aliveSettlementCount(world) {
  let n = 0;
  for (const s of world.settlements) if (s.mode !== "dead") n++;
  return n;
}

// ── Knowledge accumulation ──────────────────────────────────────────
// Agriculture knowledge grows slowly while wandering, faster in warm-
// moist tiles where wild grains were first domesticated IRL (Fertile
// Crescent, Yangtze, Mesoamerica). Foraging skill grows steadily as
// the band lives off the land. Construction + organization come
// later, after settling.
function learn(world, band) {
  const ti = ((band.pos.y | 0) * world.tw + (band.pos.x | 0));
  const t = world.temp[ti] || 0.5;
  const m = world.moist[ti] || 0.4;
  const f = world.fert[ti] || 0.05;
  // Agriculture: bell-curve modifier peaking at temp=0.7, moist=0.55,
  // boosted by fertility. Maxes ~3× the base rate in cradle conditions.
  const tFit = Math.exp(-((t - 0.7) ** 2) / 0.08);
  const mFit = Math.exp(-((m - 0.55) ** 2) / 0.10);
  const climateMul = 0.5 + tFit * mFit * 2.5 + f * 0.5;
  // Ag growth tuned for stretched prehistory: at peak climate (Fertile
  // Crescent), base rate × 2.5 → ~0.000125/tick → 3200 ticks 0→0.4.
  // Bands have plenty of time to split, spread, and meet before any
  // single one accumulates enough to settle.
  const agGrow = 0.00005 * climateMul * (1 - band.knowledge.agriculture);
  band.knowledge.agriculture = Math.min(1, band.knowledge.agriculture + agGrow);
  // Foraging: bounded by life experience.
  band.knowledge.foraging = Math.min(1, band.knowledge.foraging + 0.00005 * (1 - band.knowledge.foraging));
  // Toolmaking: slow universal trickle, accelerates with population
  // (more minds, more accidents-of-discovery).
  band.knowledge.toolmaking = Math.min(1, band.knowledge.toolmaking + 0.00003 * Math.sqrt(band.people));
}

// ── Settle trigger ─────────────────────────────────────────────────
// "Both, with knowledge gating": absolute pop size creates the desire
// (a band of 15+ is hard to keep moving), agriculture knowledge gates
// the transition (without it, the band just splits instead). Local
// site quality decides WHERE — a band only commits if it's standing
// on a fertile, watered tile.
//
// Note: the original "pressure" formulation was perverse — higher
// fertility → higher K → less pressure, so rich land became LESS
// likely to be settled. Now absolute pop drives the desire and site
// quality decides the location.
const SETTLE_AG_THRESHOLD = 0.45;   // horticultural maturity
const SETTLE_MIN_PEOPLE   = 18;     // basically at the split threshold
const SETTLE_FERT_FLOOR   = 0.35;   // poor land never settles
const SETTLE_LUSH_FERT    = 0.60;   // really rich land settles even without water access
function checkSettle(world, band) {
  if (band.mode !== "wander") return;
  if (band.knowledge.agriculture < SETTLE_AG_THRESHOLD) return;
  if (band.people < SETTLE_MIN_PEOPLE) return;
  const ti = ((band.pos.y | 0) * world.tw + (band.pos.x | 0));
  if (world.elev[ti] <= 0) return;
  const localFert = world.fert[ti] || 0.05;
  if (localFert < SETTLE_FERT_FLOOR) return;
  const hasRiver = world.riverMag && world.riverMag[ti] >= 2;
  const hasCoast = world.coast && world.coast[ti];
  // Need either water access OR exceptionally lush land. (Real Neolithic
  // sites were on rivers, lakes, or fertile river-deltas.)
  if (!hasRiver && !hasCoast && localFert < SETTLE_LUSH_FERT) return;
  // Cap enforcement: when the world is full of settlements, surplus
  // bands stay wandering. Produces the "perpetual nomads on the
  // periphery" effect once the intimate-scale ceiling is reached.
  // Settlements still have a hard cap so the player sees a small set of
  // distinct cities, not an undifferentiated sprawl. Bands have no
  // global cap — local density gates expansion instead.
  if (aliveSettlementCount(world) >= world.cap.settlements) return;
  // Settling is rare even when conditions are met: ~0.4% per tick at
  // the threshold, rising to ~5% at maxed knowledge. Spreads founding
  // events over time so not all descendant bands settle at once.
  const eagerness = (band.knowledge.agriculture - SETTLE_AG_THRESHOLD) / (1 - SETTLE_AG_THRESHOLD);
  if (world.rng() > 0.004 + eagerness * 0.05) return;
  band.mode = "settling";
  const tx = ti - ((ti / world.tw) | 0) * world.tw;
  const ty = (ti / world.tw) | 0;
  band.history.push({
    step: world.step, type: "settle-decided",
    at: { x: tx, y: ty }, ag: band.knowledge.agriculture, fert: localFert,
  });
}

// ── Meetings between bands ─────────────────────────────────────────
// O(N²) at intimate scale (<80 bands) is fine. Two bands within range
// exchange knowledge — the lagging one's level edges up toward the
// leading one's. Models real prehistory: tech diffused along trade
// and migration routes between adjacent bands.
const MEET_RANGE = 3.0;
export function processMeetings(world) {
  const bs = world.bands;
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    if (a.mode === "dead" || a.mode === "settling") continue;
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j];
      if (b.mode === "dead" || b.mode === "settling") continue;
      let dx = Math.abs(a.pos.x - b.pos.x);
      if (dx > world.tw / 2) dx = world.tw - dx;
      const dy = a.pos.y - b.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > MEET_RANGE * MEET_RANGE) continue;
      // Knowledge diffusion: each domain edges 5% toward the other side
      // (so the lagging band gains, leading band loses nothing).
      for (const k of ["agriculture", "foraging", "toolmaking", "construction", "organization"]) {
        const av = a.knowledge[k] || 0;
        const bv = b.knowledge[k] || 0;
        if (av < bv) a.knowledge[k] = av + (bv - av) * 0.05;
        else if (bv < av) b.knowledge[k] = bv + (av - bv) * 0.05;
      }
    }
  }
}

// ── Movement ────────────────────────────────────────────────────────
// Pick a target tile within scan radius, biased by fertility and away
// from other bands. Move toward the target one step.
function wander(world, band) {
  if (!band.target || nearTarget(band)) pickNewTarget(world, band);
  if (!band.target) return;
  const dx = band.target.x - band.pos.x;
  const dy = band.target.y - band.pos.y;
  const d  = Math.hypot(dx, dy);
  if (d < 0.01) return;
  const step = Math.min(BAND_MOVE_SPEED, d);
  let nx = band.pos.x + (dx / d) * step;
  let ny = band.pos.y + (dy / d) * step;
  // Wrap x for the toroidal map; clamp y at poles.
  if (nx < 0) nx += world.tw;
  if (nx >= world.tw) nx -= world.tw;
  if (ny < 1) ny = 1;
  if (ny > world.th - 2) ny = world.th - 2;
  // Refuse to step into water. Bands target land but the straight-line
  // path between two land tiles can briefly cross ocean — without this
  // check, bands physically walk on the sea. When blocked, drop the
  // target so the next pickNewTarget picks a path-friendly one.
  const ti = (ny | 0) * world.tw + (nx | 0);
  if (world.elev[ti] <= 0) {
    band.target = null;
    // Nudge the heading by ~90° so the next pick tries a different
    // direction along the coast.
    band.heading += (world.rng() < 0.5 ? -1 : 1) * Math.PI * 0.5;
    return;
  }
  band.pos.x = nx;
  band.pos.y = ny;
}

function nearTarget(band) {
  const dx = band.target.x - band.pos.x;
  const dy = band.target.y - band.pos.y;
  return Math.hypot(dx, dy) < 0.5;
}

function pickNewTarget(world, band) {
  const { rng, tw, th, fert, elev } = world;
  // Try expanding rings — a band at the coast can't find a land tile
  // within R=4, but should find one at R=8 or R=14 (push along the
  // coast or inland). Without this, coastal bands set target=self and
  // appear to oscillate in place (issue #2 in user feedback).
  // Bias candidate angles toward the band's heading so wander has a
  // persistent direction. Spread ~±60° around heading. Bands no longer
  // bounce back and forth — they drift coherently across the map.
  const HEADING_SPREAD = Math.PI * 0.66;
  let bestX = null, bestY = null, bestScore = -Infinity;
  for (const R of BAND_SCAN_RINGS) {
    for (let i = 0; i < 10; i++) {
      const ang = band.heading + (rng() - 0.5) * HEADING_SPREAD;
      const rad = R * (0.4 + rng() * 0.6);
      let nx = band.pos.x + Math.cos(ang) * rad;
      let ny = band.pos.y + Math.sin(ang) * rad;
      if (nx < 0) nx += tw;
      if (nx >= tw) nx -= tw;
      if (ny < 1 || ny > th - 2) continue;
      const ti = (ny | 0) * tw + (nx | 0);
      if (elev[ti] <= 0) continue;
      const f = fert[ti];
      // Crowding penalty — much stronger and wider than before. Bands
      // within ~9 tiles contribute, weighted by inverse-square. Same-
      // tile clustering carries a heavy cost so cradle-region pile-ups
      // get pushed apart even when fertility is uniform.
      let crowd = 0;
      for (const other of world.bands) {
        if (other === band || other.mode === "dead") continue;
        let ddx = Math.abs(other.pos.x - nx);
        if (ddx > tw / 2) ddx = tw - ddx;
        const ddy = other.pos.y - ny;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 80) crowd += 1 / (0.5 + d2 * 0.1);
      }
      // Settlements also push bands away — already-built villages own
      // the local fertility, leaving little forage for wanderers.
      let sCrowd = 0;
      for (const s of world.settlements) {
        if (s.mode === "dead") continue;
        let ddx = Math.abs(s.pos.x - nx);
        if (ddx > tw / 2) ddx = tw - ddx;
        const ddy = s.pos.y - ny;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 100) sCrowd += 1 / (0.5 + d2 * 0.08);
      }
      // Strong frontier bias: crowd weight dominates fertility so bands
      // ALWAYS prefer empty land, even mediocre empty land, over rich
      // crowded land. This is the "out of Africa" pressure.
      const score = f * 2 - crowd * 8 - sCrowd * 6 - rad * 0.02 + rng() * 0.3;
      if (score > bestScore) { bestScore = score; bestX = nx; bestY = ny; }
    }
    if (bestX !== null) break;   // found something at this ring, don't expand further
  }
  if (bestX === null) {
    // Cornered (tiny island?). Don't set target=self (causes the freeze
    // bug). Instead nudge in a random direction; movement clamp keeps
    // us on the map and the next pickNewTarget cycle will retry.
    const ang = rng() * Math.PI * 2;
    bestX = band.pos.x + Math.cos(ang) * 2;
    bestY = band.pos.y + Math.sin(ang) * 2;
    band.heading = ang;
    if (bestX < 0) bestX += tw;
    if (bestX >= tw) bestX -= tw;
    bestY = Math.max(1, Math.min(th - 2, bestY));
  }
  // Update persistent heading toward the chosen target (with wrap-aware
  // dx). Heading-drift gives bands a coherent direction over many
  // wander cycles instead of bouncing.
  {
    let dx = bestX - band.pos.x;
    if (dx > tw / 2)  dx -= tw;
    if (dx < -tw / 2) dx += tw;
    const dy = bestY - band.pos.y;
    if (dx * dx + dy * dy > 0.01) band.heading = Math.atan2(dy, dx);
  }
  band.target = { x: bestX, y: bestY };
}

// ── Population ──────────────────────────────────────────────────────
function growBand(world, band) {
  const tiPos = ((band.pos.y | 0) * world.tw + (band.pos.x | 0));
  const localFert = world.fert[tiPos] || 0.05;
  const K = BAND_K_BASE + localFert * BAND_K_FERT;
  const r = BAND_BASE_GROWTH * (1 + band.knowledge.foraging * 0.5);
  band.people = band.people + r * band.people * (1 - band.people / K);
  if (band.people < 2) {
    band.mode = "dead";
    band.history.push({ step: world.step, type: "died-out" });
  }
}

// ── Split ───────────────────────────────────────────────────────────
// Pick a split direction that points AWAY from the local crowd of
// bands, so new offspring colonise empty land instead of re-piling
// onto the cradle cluster.
function pickSplitDirection(world, parent) {
  let cx = 0, cy = 0;
  const { tw } = world;
  for (const b of world.bands) {
    if (b === parent || b.mode === "dead") continue;
    let dx = b.pos.x - parent.pos.x;
    if (dx > tw / 2)  dx -= tw;
    if (dx < -tw / 2) dx += tw;
    const dy = b.pos.y - parent.pos.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 100) continue;     // ignore distant bands
    const w = 1 / (1 + d2);
    cx += dx * w; cy += dy * w;
  }
  if (cx === 0 && cy === 0) return world.rng() * Math.PI * 2;
  return Math.atan2(-cy, -cx);   // opposite of crowd centroid
}

// Density check: count bands within DENSITY_RADIUS of (x, y). Returns
// the count; splitBand uses this to reject crowded landing sites.
const DENSITY_RADIUS    = 10;        // tiles
const DENSITY_THRESHOLD = 3;         // refuse landing if more than this many neighbours nearby
function localBandDensity(world, x, y) {
  let n = 0;
  const R2 = DENSITY_RADIUS * DENSITY_RADIUS;
  for (const b of world.bands) {
    if (b.mode === "dead") continue;
    let dx = Math.abs(b.pos.x - x);
    if (dx > world.tw / 2) dx = world.tw - dx;
    const dy = b.pos.y - y;
    if (dx * dx + dy * dy <= R2) n++;
  }
  return n;
}

function splitBand(world, parent) {
  const childPeople = Math.floor(parent.people * 0.45);
  // ── Try to find a landing site ──
  // Long-range first (20-40 tiles), then short-range fallback. Each
  // candidate must be on land AND in a sparse area (≤ DENSITY_THRESHOLD
  // bands within DENSITY_RADIUS). Density gate replaces the legacy
  // global cap — bands now spread until the whole map is saturated,
  // not until a counter hits 40.
  const baseAng = pickSplitDirection(world, parent);
  let cx = parent.pos.x, cy = parent.pos.y;
  let placed = false;
  let chosenAng = baseAng;
  const tryLand = (dist, attempts, spread) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const ang = baseAng + (world.rng() - 0.5) * spread;
      const d = dist[0] + world.rng() * (dist[1] - dist[0]);
      let nx = parent.pos.x + Math.cos(ang) * d;
      let ny = parent.pos.y + Math.sin(ang) * d;
      if (nx < 0) nx += world.tw;
      if (nx >= world.tw) nx -= world.tw;
      if (ny < 1 || ny > world.th - 2) continue;
      const ti = (ny | 0) * world.tw + (nx | 0);
      if (world.elev[ti] <= 0) continue;
      if (localBandDensity(world, nx, ny) > DENSITY_THRESHOLD) continue;
      cx = nx; cy = ny; chosenAng = ang; return true;
    }
    return false;
  };
  placed = tryLand([20, 40], 10, 1.0);
  if (!placed) placed = tryLand([6, 16], 8, 2.0);
  if (!placed) {
    // World is saturated locally AND globally — refuse the split this
    // tick. Parent keeps its people; pop pressure relaxes naturally
    // through K (carrying capacity).
    return;
  }
  parent.people -= childPeople;
  if (cx < 0) cx += world.tw;
  if (cx >= world.tw) cx -= world.tw;
  cy = Math.max(1, Math.min(world.th - 2, cy));
  const child = makeBand(world, cx, cy, childPeople, {
    parentBandId: parent.id,
    knowledge: { ...parent.knowledge },
    traits: { ...parent.traits },
    heading: chosenAng,           // continue outward, don't drift back
  });
  world.bands.push(child);
  parent.history.push({ step: world.step, type: "split", child: child.id });
}
