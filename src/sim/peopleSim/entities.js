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
// A shattered realm's record also carries succId — the principal fragment
// that took up its mantle (conquest.js recordSuccessor) — so obligations
// bound to the crown (a colony's dependency link) can follow the succession.
// Lazily-attached fields (set only when the state exists): _overlord/_depKind
// (dependency bond), succId (mantle), _lastCharter (colonial-venture pacing,
// sea.js) — all ride the verbatim record through save/load.
//
// The polity id remains the founding-capital settlement id (unchanged scheme).

import { logEvent } from "./events.js";
import { getCulture, nameFor, dominantCulture } from "./cultures.js";
import { T } from "./tuning.js";

export function politiesOf(world) {
  return world.polities || (world.polities = new Map());
}

// Population scale for the admin-load size term — shared by the polity pass's
// per-member load (conquest.js) and the adoption fisc test below, so both
// price "how big is this community to govern" on the same ruler.
// ABSOLUTE by ruling (Tier-C C1 deflation audit): the fisc comparison's
// REVENUE side (people × capacity/Σpeople) is a ratio of census units and is
// label-supply invariant; this LOAD-side scale enters only log2-compressed
// (sizeMul = 1 + SIZE_LOAD·log2(1+people/SIZE_REF)), so C1's ~×0.6-0.75
// census deflation moves the load term marginally (direction: slightly more
// permissive adoption — measured in validation, not re-anchored per-site).
export const SIZE_REF = 1000;

/**
 * The FISC TEST (T.FISC_ADOPT): may this court AFFORD to adopt this community?
 *
 * Marginal revenue vs marginal load — a real mechanism, not a threshold on
 * strain (docs/budget-gated-expansion.md records why the bare strain gate
 * made the boom-bust WORSE: refusing subjects wholesale refuses their taxes).
 * Here the two sides of the ledger are compared for THIS community alone:
 *   • what its people FUND: the realm's own capacity-per-governed-person
 *     (c._capacity / Σ member people — both stamped by the polity pass) times
 *     the candidate's people. Fully emergent: a developed fisc affords more
 *     per head, an infant court almost nothing — no unit constant to tune.
 *   • what it COSTS: the same load ruler the coverage budget uses
 *     ((distance/holdRange) × size term), at steady state (recency and
 *     coercion → 1; consolidation transients are the momentum machinery's
 *     story, not the adoption decision's).
 * A community that pays for itself is adopted even by a strained realm (it
 * HELPS); one that cannot is refused even by a slack one (it would erode) —
 * so there is no global freeze and no fiscal death-spiral. Distance is the
 * wrap-aware euclidean (the terrain surcharge needs the polity pass's
 * Dijkstra, absent here) — a mild UNDER-estimate of true cost, i.e. the
 * permissive direction for a refusal gate.
 * Scope: PRIMARY adoption only (stateless community → realm): the crystallise
 * born-join and adoptAndFound. Conquest, realm↔realm border shifts, colonies
 * and a member region's own town spin-offs are untouched.
 * Courts with no stamped fisc yet (a realm before its first polity pass)
 * adopt freely — the first stamp gates everything after.
 */
export function fiscAdoptable(world, c, x, y, people) {
  const F = T.FISC_ADOPT || 0;
  if (!(F > 0) || !c) return true;
  const cap = c.capital, C = c._capacity;
  if (!cap || !cap.pos || !(C > 0)) return true;
  let P = 0;
  const mem = c.members || [];
  for (let i = 0; i < mem.length; i++) { const m = mem[i]; if (m && m.mode === "settled") P += m.people || 0; }
  if (!(P > 0)) return true;
  let dx = Math.abs(cap.pos.x - x); if (dx > world.tw / 2) dx = world.tw - dx;
  const dy = cap.pos.y - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const holdRange = Math.max(1, c.holdReach || c.range || 0);
  const sizeMul = 1 + T.SIZE_LOAD * Math.min(3, Math.log2(1 + (people || 0) / SIZE_REF));
  const load = (d / holdRange) * sizeMul;
  return (people || 0) * (C / P) >= F * load;
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
      // The restored realm's seat is wherever it re-formed NOW — the previous
      // life's capitalId may point at a foreign city (or a ruin) and chronicle/
      // historiography locate the realm through it until the next polity pass.
      if (opts.seat) p.capitalId = opts.seat.id;
      const capS = world._byId ? world._byId.get(p.capitalId) : null;
      if (!opts.silent) logEvent(world, "polity.restored", {
        polity: id, name: p.name, fromName: opts.fromName, from: opts.from ?? -1,
        x: capS ? capS.pos.x | 0 : (opts.seat ? opts.seat.pos.x | 0 : undefined),
        y: capS ? capS.pos.y | 0 : (opts.seat ? opts.seat.pos.y | 0 : undefined),
      });
    }
    return p;
  }
  // Name the realm in its founding people's tongue, derived from the seat
  // (Velara the city begets Velarath the realm). T.STATE_OF_LAND callers have
  // no seat settlement — a nation of the land passes its name and culture
  // directly (derived from the ancestry field at its seat tile).
  let name = opts.name || null, cultureId = opts.cultureId ?? -1;
  if (!name && opts.seat) {
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

/**
 * Bookkeeping accessor: get the record, creating it silently if missing —
 * but NEVER touching the lifecycle. Hot fiscal/chronicle paths (govOf, tax,
 * tariffs, personality) use this so that merely reading a dead realm's
 * record cannot silently resurrect it (endedStep stays set until an
 * explicit lifecycle site — reconcilePolities or a story event — reopens
 * it and logs the restoration).
 */
export function getOrCreateRecord(world, id, opts = {}) {
  if (id == null || id < 0) return null;
  const reg = politiesOf(world);
  return reg.get(id) || ensurePolity(world, id, { ...opts, silent: true });
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
  // Log WHERE the realm fell (its capital) so historiography's information
  // horizon applies — a coordinate-less ending was heard everywhere on the
  // planet instantly (distance defaulted to zero).
  const capS = world._byId ? world._byId.get(p.capitalId) : null;
  logEvent(world, "polity.ended", { polity: id, name: p.name, how, by, byName,
    x: capS ? capS.pos.x | 0 : undefined, y: capS ? capS.pos.y | 0 : undefined });
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
  // The countries VIEW passed in was built at the TOP of the polity pass;
  // states minted MID-pass (secession, rebellion, fragmentation) are not in
  // it. Lifecycle truth is the settlements themselves — recompute the live
  // id set here, so a realm born this pass is never closed as "dissolved"
  // at birth (which also silently corrupted every lifespan statistic).
  const live = new Set();
  for (const s of world.settlements) {
    if (s.mode === "settled" && s.countryId >= 0) live.add(s.countryId);
  }
  for (const [id, c] of countries) {
    if (!live.has(id)) continue;   // vanished mid-pass; the end-scan below closes it
    if (reg.has(id)) { const p = reg.get(id); if (p.endedStep >= 0) ensurePolity(world, id, { seat: c.capital }); p.capitalId = c.capitalId; continue; }
    const substantial = c.members.length > 1
      || (c.capital && (c.capital._sovereignSeat != null || (c.capital.tier | 0) >= 1));
    if (substantial) ensurePolity(world, id, { how: "emerged", seat: c.capital });
  }
  for (const p of reg.values()) {
    if (p.endedStep >= 0 && live.has(p.id)) ensurePolity(world, p.id);   // alive again under its old id — log the restoration
    // T.STATE_OF_LAND: a nation of the land has no settled member BY DESIGN —
    // it lives on its territory and people until a city rises inside it (then
    // it materialises as a realm and leaves the land-seat register) or its
    // basin empties (the register drops it). Never "dissolved" for lacking a
    // settlement it was never required to have.
    else if (p.endedStep < 0 && !live.has(p.id)
      && !(world._landSeats && world._landSeats.has(p.id))) endPolity(world, p.id, "dissolved");
  }
}
