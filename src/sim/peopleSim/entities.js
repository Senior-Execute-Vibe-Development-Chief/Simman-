// ── Persistent entity registry: polities ──
//
// A polity is a PERSISTENT record with a stable id and a lifecycle — unlike
// world.countries, which is a per-pass aggregation VIEW rebuilt from the
// settlements every polity interval (and stays that way; passes still read
// it for members/capital/budgets). The registry is where everything that
// must SURVIVE the rebuild lives: treasury and fiscal state (the old
// world.governments), temperament (the old world.personalities +
// _deadPersonalities archive), chronicle milestones (the old _chronMeta),
// names, and — later — dynasty / culture / faith attachments.
//
// Records are never deleted. A fallen realm keeps its record (endedStep set),
// its history stays queryable forever, and a restoration simply re-opens the
// same entity — restored Poland IS Poland, with its own character and story.
//
// The polity id remains the founding-capital settlement id (unchanged scheme).

import { logEvent } from "./events.js";
import { getCulture, nameFor, dominantCulture } from "./cultures.js";

export function politiesOf(world) {
  return world.polities || (world.polities = new Map());
}

export function getPolity(world, id) {
  return id != null && id >= 0 ? (world.polities ? world.polities.get(id) || null : null) : null;
}

/**
 * Get-or-create the persistent record for a polity id. On first creation
 * logs polity.founded (unless opts.silent — used by the reconciler for
 * bookkeeping registrations that aren't a story moment).
 * opts: { how, seat (settlement), from (parent polity id), silent }
 */
export function ensurePolity(world, id, opts = {}) {
  if (id == null || id < 0) return null;
  const reg = politiesOf(world);
  let p = reg.get(id);
  if (p) {
    if (p.endedStep >= 0) {   // re-opened: an old nation re-forming under its id
      p.endedStep = -1;
      if (!opts.silent) logEvent(world, "polity.restored", {
        polity: id, name: p.name, fromName: opts.fromName, from: opts.from ?? -1,
      });
    }
    return p;
  }
  // Name the realm in its founding people's tongue, derived from the seat
  // (Velara the city begets Velarath the realm).
  let name = null, cultureId = -1;
  if (opts.seat) {
    cultureId = dominantCulture(opts.seat);
    const cul = getCulture(world, cultureId);
    if (cul) name = nameFor(world, cul, "realm", opts.seat.name);
  }
  p = {
    id,
    name,
    foundedStep: world.step | 0,
    endedStep: -1,
    capitalId: opts.seat ? opts.seat.id : id,
    // fiscal state (the old world.governments record, verbatim fields)
    treasury: 0, _revenue: 0, _spend: 0, fineness: 1.0,
    // temperament (personality.js fills lazily)
    personality: null,
    // chronicle milestone memory (the old world._chronMeta)
    chron: { era: -1, cities: 0, wealthBand: -1 },
    // attachments
    cultureId, faithId: -1, dynastyId: -1,
  };
  reg.set(id, p);
  if (!opts.silent) {
    logEvent(world, "polity.founded", {
      polity: id, name: p.name, how: opts.how || "emerged",
      seat: opts.seat ? opts.seat.id : id, seatName: opts.seat ? opts.seat.name : undefined,
      from: opts.from ?? -1, fromName: opts.fromName,
      x: opts.seat ? opts.seat.pos.x | 0 : undefined, y: opts.seat ? opts.seat.pos.y | 0 : undefined,
    });
  }
  return p;
}

/** Close a polity's lifecycle (record persists; history stays queryable). */
export function endPolity(world, id, how = "dissolved", by = -1, byName = undefined) {
  const p = getPolity(world, id);
  if (!p || p.endedStep >= 0) return;
  p.endedStep = world.step | 0;
  // The treasury is deliberately NOT zeroed: conquest seizure (fragmentRealm)
  // transfers it before ending, and any coin left on an unresolved fall rides
  // along on the record — a later restoration digs up the old war chest.
  // Money accounting counts ALIVE polities only, so a dead chest reads as
  // out of circulation either way (same as the old prune-deletion).
  p._momentum = 0;
  logEvent(world, "polity.ended", { polity: id, name: p.name, how, by, byName });
}

/**
 * Reconcile the registry against the live per-pass country view: register
 * substantial newcomers, close records whose realm has vanished. Transient
 * one-village "countries" (fresh settlements default to their own id until
 * the territory pass assigns them) are not registered — a polity begins
 * when it has more than one member, a sovereign seat, or any treasury.
 */
export function reconcilePolities(world, countries) {
  const reg = politiesOf(world);
  for (const [id, c] of countries) {
    if (reg.has(id)) { const p = reg.get(id); if (p.endedStep >= 0) ensurePolity(world, id); p.capitalId = c.capitalId; continue; }
    const substantial = c.members.length > 1
      || (c.capital && (c.capital._sovereignSeat != null || (c.capital.tier | 0) >= 1));
    if (substantial) ensurePolity(world, id, { how: "emerged", seat: c.capital });
  }
  for (const p of reg.values()) {
    if (p.endedStep < 0 && !countries.has(p.id)) endPolity(world, p.id, "dissolved");
  }
}
