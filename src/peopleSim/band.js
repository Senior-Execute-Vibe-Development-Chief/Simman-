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
const BAND_MOVE_SPEED  = 0.04;    // tiles / tick
const BAND_SCAN_RADIUS = 5;       // tiles surveyed when picking next step
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
  if (band.mode === "dead") return;

  wander(world, band);
  growBand(world, band);

  // Split when oversized — too many mouths to feed while moving.
  if (band.people >= BAND_SPLIT_AT && world.bands.length < world.cap.bands) {
    splitBand(world, band);
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
  const R = BAND_SCAN_RADIUS;
  // Sample 6 candidates around current pos, pick best score.
  let bestX = band.pos.x, bestY = band.pos.y, bestScore = -Infinity;
  for (let i = 0; i < 6; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = 1 + rng() * R;
    let nx = band.pos.x + Math.cos(ang) * rad;
    let ny = band.pos.y + Math.sin(ang) * rad;
    // Wrap/clamp.
    if (nx < 0) nx += tw;
    if (nx >= tw) nx -= tw;
    if (ny < 1 || ny > th - 2) continue;
    const ti = (ny | 0) * tw + (nx | 0);
    if (elev[ti] <= 0) continue;   // skip water
    const f = fert[ti];
    // Crowding penalty: bands clustered nearby reduce attractiveness.
    let crowd = 0;
    for (const other of world.bands) {
      if (other === band || other.mode === "dead") continue;
      const ddx = Math.min(Math.abs(other.pos.x - nx), tw - Math.abs(other.pos.x - nx));
      const ddy = other.pos.y - ny;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < 16) crowd += 1 / (1 + d2);
    }
    const score = f * 3 - crowd * 2 - rad * 0.05 + rng() * 0.3;
    if (score > bestScore) {
      bestScore = score; bestX = nx; bestY = ny;
    }
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
