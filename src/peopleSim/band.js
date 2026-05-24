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
const BAND_SCAN_RINGS  = [4, 8, 14];  // radii tried when picking next step
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

  // Split when oversized — too many mouths to feed while moving.
  // Gated by both bands-cap AND total-entity-cap so the world stays
  // intimate even when bands settle and free up the bands slot.
  if (band.people >= BAND_SPLIT_AT &&
      aliveBandCount(world) < world.cap.bands &&
      aliveEntityCount(world) < world.cap.total) {
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
function aliveEntityCount(world) {
  return aliveBandCount(world) + aliveSettlementCount(world);
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
  if (aliveSettlementCount(world) >= world.cap.settlements) return;
  if (aliveEntityCount(world) >= world.cap.total) return;
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
  band.pos.x += (dx / d) * step;
  band.pos.y += (dy / d) * step;
  // Wrap x for the toroidal map; clamp y at poles.
  if (band.pos.x < 0) band.pos.x += world.tw;
  if (band.pos.x >= world.tw) band.pos.x -= world.tw;
  if (band.pos.y < 1) band.pos.y = 1;
  if (band.pos.y > world.th - 2) band.pos.y = world.th - 2;
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
  let bestX = null, bestY = null, bestScore = -Infinity;
  for (const R of BAND_SCAN_RINGS) {
    for (let i = 0; i < 10; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = R * (0.4 + rng() * 0.6);
      let nx = band.pos.x + Math.cos(ang) * rad;
      let ny = band.pos.y + Math.sin(ang) * rad;
      if (nx < 0) nx += tw;
      if (nx >= tw) nx -= tw;
      if (ny < 1 || ny > th - 2) continue;
      const ti = (ny | 0) * tw + (nx | 0);
      if (elev[ti] <= 0) continue;
      const f = fert[ti];
      // Crowding penalty: bands clustered nearby reduce attractiveness.
      let crowd = 0;
      for (const other of world.bands) {
        if (other === band || other.mode === "dead") continue;
        let ddx = Math.abs(other.pos.x - nx);
        if (ddx > tw / 2) ddx = tw - ddx;
        const ddy = other.pos.y - ny;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 16) crowd += 1 / (1 + d2);
      }
      const score = f * 3 - crowd * 2 - rad * 0.03 + rng() * 0.4;
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
    if (bestX < 0) bestX += tw;
    if (bestX >= tw) bestX -= tw;
    bestY = Math.max(1, Math.min(th - 2, bestY));
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
function splitBand(world, parent) {
  const childPeople = Math.floor(parent.people * 0.45);
  parent.people -= childPeople;
  // Spawn child 1-2 tiles away in a random direction.
  const ang = world.rng() * Math.PI * 2;
  const dist = 1.5 + world.rng() * 1.5;
  let cx = parent.pos.x + Math.cos(ang) * dist;
  let cy = parent.pos.y + Math.sin(ang) * dist;
  if (cx < 0) cx += world.tw;
  if (cx >= world.tw) cx -= world.tw;
  cy = Math.max(1, Math.min(world.th - 2, cy));
  const child = makeBand(world, cx, cy, childPeople, {
    parentBandId: parent.id,
    knowledge: { ...parent.knowledge },
    traits: { ...parent.traits },
  });
  world.bands.push(child);
  parent.history.push({ step: world.step, type: "split", child: child.id });
}
