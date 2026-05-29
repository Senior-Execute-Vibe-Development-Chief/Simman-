// ── Exogenous shocks: famine + plague ────────────────────────────────
//
// Both crash a settlement's fundamentals — harvest (famine) or population
// (plague) — and so feed the unrest + control-budget systems: a prosperous,
// stable realm can be tipped into collapse by a bad harvest or an epidemic.
// These are the demographic triggers history keeps pointing at: the Antonine /
// Justinian / Black-Death plagues that gutted Rome and the khanates, and the
// famine→rebellion cycle (Little Ice Age, late Ming, the Chinese dynastic
// turnovers). They don't cause collapse on their own — they push the existing
// machinery (hunger→unrest→rebellion; population crash→capacity→fragmentation)
// past its tipping point.

import { mkRng } from "./rng.js";

// ── FAMINE — a regional bad-harvest event ──
// Hits a geographic cluster of settlements for a window, slashing their land-
// food yield. Reduced supply → starvation (settlement.js) + hunger-driven
// unrest (conquest.js). Read in updateFood via s._famineUntil / s._harvestMul.
const FAMINE_CHECK    = 700;    // ticks between famine-spawn rolls
const FAMINE_CHANCE   = 0.35;   // probability a roll actually spawns one
const FAMINE_RADIUS   = 12;     // tiles — settlements within this of the seed are struck (regional, not continental)
const FAMINE_MIN_DUR  = 400;
const FAMINE_MAX_DUR  = 1200;
const FAMINE_SEVERITY = 0.35;   // harvest multiplier during famine (0.35 = ~65% crop loss)
const FAMINE_MIN_POP  = 30;     // only seed on a real settlement

// ── PLAGUE — an epidemic that SPREADS along the trade graph ──
// Crashes population (worse in dense cities), then burns out leaving survivors
// temporarily immune. The trade network that enriches a realm also carries the
// disease — and a plague that reaches the capital craters its population, which
// shrinks the control budget (conquest.js) and can collapse the realm.
const PLAGUE_CHECK    = 2600;   // ticks between plague-spawn rolls (generational)
const PLAGUE_CHANCE   = 0.4;
const PLAGUE_DUR      = 400;    // how long a settlement stays infected
const PLAGUE_IMMUNE   = 3000;   // post-plague immunity window (resistant survivors)
const PLAGUE_MORT     = 0.0010; // base per-tick mortality while infected
const PLAGUE_URBAN    = 0.6;    // extra mortality ∝ log10(pop/100) (crowding/sanitation)
const PLAGUE_SPREAD   = 0.0007; // per-tick chance an infected node infects a trade partner
                                // (low enough that most outbreaks stay regional; only a
                                // well-connected, sustained one becomes a continental pandemic)
const PLAGUE_SEA_MULT = 2.0;    // sea routes carried plague fast + far (Black Death by ship)
const PLAGUE_MIN_POP  = 50;     // needs a real population to take hold / seed

function torusDist(world, ax, ay, bx, by) {
  let dx = Math.abs(ax - bx); if (dx > world.tw / 2) dx = world.tw - dx;
  const dy = ay - by; return Math.sqrt(dx * dx + dy * dy);
}

export function updateShocks(world) {
  const rng = mkRng((world.seed ^ (world.step * 40503)) >>> 0);

  // ── Famine spawn ──
  if (world.step % FAMINE_CHECK === 0 && rng() < FAMINE_CHANCE) {
    const pool = world.settlements.filter(s => s.mode === "settled" && s.people >= FAMINE_MIN_POP);
    if (pool.length) {
      const seed = pool[(rng() * pool.length) | 0];
      const dur = (FAMINE_MIN_DUR + rng() * (FAMINE_MAX_DUR - FAMINE_MIN_DUR)) | 0;
      const until = world.step + dur;
      for (const s of world.settlements) {
        if (s.mode !== "settled") continue;
        if (torusDist(world, seed.pos.x, seed.pos.y, s.pos.x, s.pos.y) > FAMINE_RADIUS) continue;
        s._famineUntil = until;
        s._harvestMul = FAMINE_SEVERITY;
        if (s.history) s.history.push({ step: world.step, type: "famine" });
      }
    }
  }

  // ── Plague spawn ──
  if (!world._plagued) world._plagued = new Set();
  if (world.step % PLAGUE_CHECK === 0 && rng() < PLAGUE_CHANCE) {
    const pool = world.settlements.filter(s =>
      s.mode === "settled" && s.people >= PLAGUE_MIN_POP &&
      world.step >= (s._plagueUntil || 0) && world.step >= (s._plagueImmuneUntil || 0));
    if (pool.length) {
      // Bias toward ports / big hubs — epidemics started where people and ships
      // concentrated. Weighted pick by population (× extra for ports).
      let total = 0;
      for (const s of pool) total += s.people * (s._isPort ? 2 : 1);
      let pick = rng() * total, seed = pool[0];
      for (const s of pool) { pick -= s.people * (s._isPort ? 2 : 1); if (pick <= 0) { seed = s; break; } }
      infect(world, seed);
    }
  }

  // ── Plague lifecycle + spread ──
  if (world._plagued.size) {
    const recovered = [];
    for (const id of world._plagued) {
      const s = world._byId ? world._byId.get(id) : null;
      if (!s || s.mode !== "settled") { recovered.push(id); continue; }
      if (world.step >= (s._plagueUntil || 0)) {            // burns out → immune
        s._plagueActive = false;
        s._plagueImmuneUntil = world.step + PLAGUE_IMMUNE;
        recovered.push(id);
        if (s.history) s.history.push({ step: world.step, type: "plague-passed", people: Math.round(s.people) });
        continue;
      }
      // Mortality (worse in crowded cities).
      const urban = Math.max(0, Math.log10(Math.max(1, s.people) / 100));
      const mort = PLAGUE_MORT * (1 + PLAGUE_URBAN * urban);
      s.people = Math.max(1, s.people * (1 - mort));
      // Spread along the trade graph (road reach + sea lanes). The very links
      // that carry grain and coin carry the contagion.
      spreadFrom(world, s, s._tradeReach, 1, rng);
      spreadFrom(world, s, s._seaReach, PLAGUE_SEA_MULT, rng);
    }
    for (const id of recovered) world._plagued.delete(id);
  }
}

function infect(world, s) {
  if (!s || s.mode !== "settled") return;
  if (world.step < (s._plagueImmuneUntil || 0)) return;     // resistant survivors
  if (world.step < (s._plagueUntil || 0)) return;           // already infected
  s._plagueUntil = world.step + PLAGUE_DUR;
  s._plagueActive = true;
  world._plagued.add(s.id);
  if (s.history) s.history.push({ step: world.step, type: "plague-struck", people: Math.round(s.people) });
}

function spreadFrom(world, s, reach, mult, rng) {
  if (!reach || reach.size === 0 || !world._byId) return;
  const p = PLAGUE_SPREAD * mult;
  for (const peerId of reach.keys()) {
    if (rng() >= p) continue;
    const peer = world._byId.get(peerId);
    if (peer && peer.mode === "settled" && peer.people >= PLAGUE_MIN_POP) infect(world, peer);
  }
}

// Famine grievance read by the unrest pass — beyond the food-deficit hunger it
// already causes, an active famine adds direct distress. (Plague distress is
// read via s._plagueActive in the same pass.)
export function shockUnrest(world, s) {
  let u = 0;
  if (world.step < (s._famineUntil || 0)) u += 0.5;
  if (s._plagueActive) u += 0.6;
  return u;
}
