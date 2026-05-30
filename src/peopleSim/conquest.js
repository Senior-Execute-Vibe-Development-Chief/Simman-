// ── Polities (countries) ──────────────────────────────────────────────
//
// Every settlement belongs to a COUNTRY (s.countryId), starting as its own
// city-state. CONQUEST is carried out by armies (armies.js) — when an army
// captures a settlement it flips its countryId. This module handles the
// bookkeeping: grouping settlements into countries (capital = strongest
// member), tribute up to the capital, and SECESSION — the counter-force
// that fragments over-extended empires so they rise and fall.
//
// Secession is STICKY: a member must stay beyond the capital's hold range
// for a sustained grace period before breaking away. Without this, a town
// captured right at the frontier would secede the very next pass and get
// re-taken, making the borders flicker.

import { CONQUEST_GRACE } from "./armies.js";
import { recordIn, recordOut, IN_AID, IN_STATE_PAY, OUT_TRIBUTE } from "./money.js";
import { shockUnrest } from "./shocks.js";
import { localPByCountry } from "./inflation.js";
import { localEdgeCost } from "./transport.js";

const POLITY_INTERVAL  = 150;   // ticks between polity passes
// Sub-city absorption requires the absorbing power to have at least this
// much ORGANISATION (state apparatus) before it can administratively
// swallow a touching village. Below this threshold the village stays
// independent — only direct conquest by armies can take it. Bronze-age
// society is the floor; chalcolithic and earlier are too primitive to
// integrate a foreign realm administratively.
const ABSORB_ORG_MIN   = 0.30;
// Maximum per-polity-pass defection probability. Caps the rate at which
// a sub-city settlement can flip to a touching foreign realm — even a
// tiny village vs a massive cradle defects over multiple passes, never
// in a single tick. With POLITY_INTERVAL=150 and ABSORB_PROB_MAX=0.10,
// a fully-pressured village takes ~10 passes (~1500 ticks) on average.
const ABSORB_PROB_MAX  = 0.10;

// ── Government treasury (fiscal redistribution) ───────────────────────
// The realm's coin is taxed into a GOVERNMENT treasury (not the capital
// city's own purse) and spent straight back out — army pay to the garrisons,
// public works to the provinces. Because the state taxes and spends at the
// same high bandwidth (it touches every member directly, unlike throughput-
// limited trade), a roughly balanced budget keeps coin circulating to the
// periphery instead of pooling at the throne. Treasury lives in
// world.governments keyed by countryId (stable across capital changes).
const ARMY_WAGE     = 60;   // coin per soldier per polity pass — peacetime garrison pay
const WAR_SURCHARGE = 1.2;  // each level of war (defensive front / besieged capital) multiplies the army bill
const RESERVE_PASSES = 3;   // war-chest the state keeps (passes of peacetime army pay) before funding works
const SOLVENCY_FLOOR = 0.5; // a fully bankrupt state still retains this fraction of its control budget

// ── Variable taxation ─────────────────────────────────────────────────
// The tax rate climbs under fiscal stress (war + insolvency) toward a cap — a
// desperate treasury squeezes harder. That funds the army, but the
// overtaxation feeds POPULAR UNREST: the classic trap where taxing to pay for
// a war drives the people to revolt (France 1789, late Ming, late Rome).
const TAX_BASE     = 0.06;   // baseline share of a member's wealth taxed per pass
const TAX_MAX      = 0.22;   // hard cap on the tax rate, however desperate the state
const TAX_WAR      = 0.025;  // extra rate per level of war
const TAX_BANKRUPT = 0.12;   // extra rate × how insolvent the state was last pass
const TAX_DRIFT    = 0.25;   // how fast the actual rate moves toward its target (no whipsaw)

// ── Popular unrest → rebellion ────────────────────────────────────────
// Unrest is a SECOND stock alongside loyalty (kept separate so neither masks
// the other): loyalty = administrative cohesion (overextension → orderly
// secession); unrest = popular grievance (hardship → destructive rebellion).
// It accumulates from hunger / conscription / war fatigue / overtaxation,
// cools in peace + plenty, bleeds loyalty, and at the top boils over.
const CONSCRIPT_REF = 0.15;  // garrison/pop fraction at which the conscription grievance saturates
const HUNGER_W   = 1.0;      // grievance weights (hunger dominates, as in history)
const CONSCRIPT_W = 0.4;
const WARFAT_W   = 0.5;
const OVERTAX_W  = 0.7;
const UNREST_GAIN   = 0.15;  // how fast grievance piles into the unrest stock
const UNREST_RELIEF = 0.06;  // how fast unrest cools when the people are content
const UNREST_LOYALTY_BLEED = 0.12;  // an angry populace also erodes administrative loyalty
const UNREST_RADIUS_MIN = 15;       // a rebellion rallies discontented neighbours within this (or range)
const UNREST_JOIN = 0.6;            // a co-member this discontented joins a nearby uprising
const REBEL_POP   = 0.82;    // a rebellion costs a town this fraction of its people...
const REBEL_WEALTH = 0.5;    // ...this fraction of its wealth...
const REBEL_ARMY  = 0.4;     // ...and its garrison mutinies down to this
const RIOT_POP    = 0.90;    // the capital RIOTS instead of seceding: lighter damage, no breakaway
const RIOT_WEALTH = 0.65;
const RIOT_ARMY   = 0.7;
// Failed revolts (the bid was geographically un-viable — landlocked enclave
// surrounded by parent loyalists). Damage is between a riot and a rebellion
// — the rising actually fought, but lost. No new state forms.
const FAILED_REVOLT_POP    = 0.88;
const FAILED_REVOLT_WEALTH = 0.55;
const FAILED_REVOLT_ARMY   = 0.35;
const SPOILS_DECAY = 0.85;   // war-weariness relief (banked on conquest in armies.js) fades per pass

export function govOf(world, countryId) {
  if (!world.governments) world.governments = new Map();
  let g = world.governments.get(countryId);
  if (!g) { g = { treasury: 0, _revenue: 0, _spend: 0 }; world.governments.set(countryId, g); }
  return g;
}

// ── Control budget (overextension) ───────────────────────────────────
// An empire holds its provinces out of a finite CONTROL BUDGET projected
// from its CENTRE. Each province draws some of that budget (its admin
// LOAD, ∝ distance-to-liege / size / how recently it was taken); the
// realm spends the budget on its cheapest provinces first. Provinces that
// don't fit lose LOYALTY each pass and eventually secede; provinces that
// fit recover loyalty. Because the budget is computed from the capital's
// LIVE strength, a weakening capital (war, plague, a sacked throne)
// shrinks the budget and the frontier sheds — overextension becomes a
// dynamic event, not a fixed radius. Magnitudes are in "reach-units":
// a province sitting exactly at the capital's reach costs a load of ~1.
const CAP_BASE      = 6;     // reach-units a lone capital can administer
const CAP_POP       = 3;     // extra capacity from a big capital (log of pop)
const CAP_POP_REF   = 1000;  // capital population that scores one CAP_POP unit
const CAP_SEAT      = 1.2;   // capacity each loyal regional seat adds (sub-administration)
const SEAT_BONUS_CAP = 6;    // total seat contribution is capped (admin has diminishing returns)
const COERCE_CAP    = 2.5;   // a far-stronger capital coerces a province (caps the load cut)
const SIZE_LOAD     = 0.4;   // bigger provinces are harder to administer
const SIZE_REF      = 1000;  // population scale for the size term
const RECENCY_LOAD  = 1.0;   // a freshly conquered province costs this much extra...
const RECENCY_TICKS = 4000;  // ...decaying to none over this many ticks (digestion)
const LOYAL_RECOVER = 0.06;  // per pass: covered provinces climb toward full loyalty
const LOYAL_DECAY   = 0.10;  // per pass: uncovered provinces bleed loyalty toward zero

// ── Contagious secession (amplifier) ──────────────────────────────────
// A revolt is regional, not solitary: when a province's loyalty collapses,
// it rallies the RESTLESS neighbours around it into one successor state
// (with their combined garrisons), instead of seceding alone only to be
// re-annexed next pass. This is what turns a frontier wobble into a real
// breakaway realm.
const REVOLT_JOIN_LOYALTY = 0.5;  // a co-member this disloyal joins a nearby uprising
const REVOLT_RADIUS_MIN   = 15;   // a revolt rallies members within at least this many tiles
const REVOLT_RADIUS_RANGE = 1.3;  // ...or the capital's reach × this, whichever is larger
// ── Capital-fall fragmentation (amplifier) ────────────────────────────
// When the capital itself is stormed, the leaderless empire SHATTERS: the
// conqueror keeps the captured throne-city, but the far provinces don't
// meekly transfer — they break into regional successor states around their
// strongest surviving cities (the Diadochi after Alexander).
const FRAG_MAX_STATES = 4;    // at most this many successor realms form
const FRAG_SEPARATION = 20;   // successor capitals must be at least this far apart

// ── War duress (capacity catalysts) ───────────────────────────────────
// War throttles the control budget: a realm at war on several fronts has its
// army and attention split, and a realm whose CAPITAL is under attack is
// pinned defending the throne instead of governing the frontier. Both shrink
// capacity, so a realm stable in peace sheds provinces (via the loyalty
// budget + contagion) the moment it's pressured — the dynamic trigger for
// overextension. The effect lingers a window past the last front, then the
// budget recovers as the realm consolidates in peace.
const MULTIFRONT_PENALTY  = 0.35;  // each enemy beyond the first divides capacity by (1 + this)
const SIEGE_CAPACITY_MULT = 0.5;   // capital's heartland under assault → budget halved
const WAR_CAPACITY_MULT   = 0.8;   // capital's countryside merely raided → mild throttle
const SIEGE_WINDOW        = 300;   // ticks the siege/war throttle lingers after the last front

// ── Overmighty governor (ambition-driven secession) ───────────────────
// A powerful regional governor doesn't wait for the budget to fail. If his
// own city grows strong RELATIVE TO THE THRONE and sits on an independent
// power base — far from the capital, commanding his own vassals — he schemes,
// and eventually declares independence, taking his WHOLE sub-realm (his branch
// of the liege hierarchy) with him, loyal or not. War at the centre emboldens
// him. This is the breakaway duke / over-mighty subject, distinct from a
// frontier crumbling under an over-stretched budget. (A strong city RIGHT BY
// the capital is the loyal court / heir apparent — it tends to inherit the
// throne via rebuildCountries rather than secede.)
const AMBITION_RATIO   = 0.40;  // a governor at least this strong (vs the throne) starts to scheme
const AMBITION_MIN_FAR = 0.5;   // ...and at least this far out (reach-units); a core city stays loyal
const AMBITION_FAR     = 1.8;   // distance amplifies ambition this much
const AMBITION_GAIN    = 0.10;  // ambition-stock growth per pass at full margin
const AMBITION_DURESS  = 1.6;   // a besieged throne emboldens governors (multiplier)
// Naval administration is no longer a special-case discount on _isPort
// pairs — water embarkation in localEdgeCost (transport.js) gives the
// capital's Dijkstra a sea-highway over coastal water when it has
// navigation, so capitalTransportCosts() naturally reaches overseas
// members at a steeply discounted cost (≈3 per tile at full nav, vs
// Infinity below the embarkation threshold). Same effect, applied
// uniformly to every reach calculation.
// Economic hold: a province worth keeping is held far beyond the normal
// administrative range — the empire pours resources into clinging to it.
// This is the Spanish-silver effect: Potosí was the far side of the world,
// but the bullion made it worth a fleet and an army to keep. A member's
// pull = its mining income (the "valuables") plus a slice of its treasury
// (the tribute it can be milked for); its effective distance to the
// capital is divided by (1 + that pull), so rich colonies don't secede.
const VALUE_HOLD_CAP   = 4;       // richest provinces held from up to 5× the range
const MINE_HOLD_SCALE  = 0.15;    // per unit of mining income / tick
const TREASURE_HOLD_DIV = 60000;  // wealth that contributes one unit of pull (cap 2)
// Colonial support: a young colony draws food + coin from the mother
// country's capital each polity pass (and pays no tribute) until it matures.
const COLONY_SUPPLY_TICKS = 4000;
const COLONY_SUPPLY_FOOD  = 40;
const COLONY_SUPPLY_COIN  = 300;

function holdPull(s) {
  const mine = (s._minedRate || 0) * MINE_HOLD_SCALE;
  const treasure = Math.min(2, (s.wealth || 0) / TREASURE_HOLD_DIV);
  return 1 + Math.min(VALUE_HOLD_CAP, mine + treasure);
}
// How "fresh" a conquest still is, 1 (just taken) → 0 (fully digested).
// A newly seized province is restless and costs extra to administer; rapid
// expansion piles up this load and triggers indigestion-overextension.
function recencyFactor(world, s) {
  const age = world.step - (s._conqueredAt ?? -Infinity);
  if (!(age < RECENCY_TICKS)) return 0;   // also handles age === Infinity
  return 1 - age / RECENCY_TICKS;
}
// Base hold range (tiles) from the capital's reach techs — how far it can
// administer. Grows with organization/mobility/navigation; then SHRINKS
// with empire size (overstretch), so big empires can't hold their
// periphery and fragment into successor states.
const RANGE_BASE = 8, RANGE_ORG = 16, RANGE_MOB = 10, RANGE_NAV = 6;

export { POLITY_INTERVAL };

// Military/administrative weight, used to pick the capital (strongest member).
export function settlementPower(s) {
  const k = s.knowledge || {};
  const mil = 1 + (k.metallurgy || 0) * 1.5 + (k.mobility || 0) * 0.8;
  const org = 1 + (k.organization || 0) * 0.6;
  return Math.max(1, s.people) * mil * org;
}

function dist(world, ax, ay, bx, by) {
  let dx = Math.abs(ax - bx); if (dx > world.tw / 2) dx = world.tw - dx;
  const dy = ay - by; return Math.sqrt(dx * dx + dy * dy);
}

// Group settlements into countries and choose each capital. Rebuilt every
// pass from the persistent s.countryId.
export function rebuildCountries(world) {
  const countries = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    let c = countries.get(s.countryId);
    if (!c) { c = { id: s.countryId, members: [], capital: null }; countries.set(s.countryId, c); }
    c.members.push(s);
  }
  for (const c of countries.values()) {
    let best = null, bp = -1;
    for (const s of c.members) { const p = settlementPower(s); if (p > bp) { bp = p; best = s; } }
    c.capital = best;
    c.capitalId = best.id;
    const k = best.knowledge || {};
    c.range = RANGE_BASE + (k.organization || 0) * RANGE_ORG + (k.mobility || 0) * RANGE_MOB + (k.navigation || 0) * RANGE_NAV;
    c.hue = ((c.id * 61) % 360 + 360) % 360;
    buildHierarchy(world, c);
  }
  world.countries = countries;
  return countries;
}

// Administrative tree inside one country: every settlement answers to the
// NEAREST larger settlement (one of strictly higher tier), forming the
// chain village → town → regional city → capital. The capital is the root.
// Tribute then flows up this chain one level at a time, and the info panel
// can show the full lineage. Because each liege is strictly higher-tier than
// its vassal (capital excepted), the pointers can't cycle.
function buildHierarchy(world, c) {
  const members = c.members;
  for (const s of members) { s._vassalCount = 0; s._depth = 0; }
  for (const s of members) {
    if (s.id === c.capitalId) { s.liegeId = -1; continue; }
    const st = s.tier | 0;
    let best = c.capital, bestD = Infinity;
    for (const m of members) {
      if (m === s || (m.tier | 0) <= st) continue;        // liege must be larger
      const d = dist(world, s.pos.x, s.pos.y, m.pos.x, m.pos.y);
      if (d < bestD) { bestD = d; best = m; }
    }
    s.liegeId = best.id;
  }
  // Tally direct vassals (for the "provincial seat" role + display).
  const byId = new Map(); for (const m of members) byId.set(m.id, m);
  for (const s of members) {
    if (s.liegeId >= 0) { const L = byId.get(s.liegeId); if (L) L._vassalCount++; }
  }
}

// A breakaway needs a country id distinct from the parent realm. Country ids
// are settlement ids by convention, and the realm's id is its FOUNDER's id —
// which, once a stronger city has taken the capital role, may belong to an
// ordinary member that's now breaking away. So prefer the seed's id, but if
// that IS the parent realm's id, borrow another bloc member's id instead.
function freshCountryId(c, bloc) {
  if (bloc[0].id !== c.id) return bloc[0].id;        // seed's own id is free
  for (const m of bloc) if (m.id !== c.id) return m.id;
  return -1;                                          // degenerate: nothing distinct to use
}

// History rarely produced fully landlocked enclaves seceding from a still-
// functioning empire — the seceding state has no allies it can reach, no
// trade route the parent doesn't control, no escape route, so the parent
// simply sieges it forever. (Andorra-style microstates exist only because
// the surrounder LET them — by gift, not by force.) Capital-fall
// fragmentation is the historical exception and is handled separately.
//
// This predicate tests whether the bloc's combined territory touches
// ANYTHING that isn't the parent country — another country, unclaimed
// land, or sea. If yes, secession is geographically viable; if no, the
// bloc is fully enclosed and the attempt fails (the loyalty/ambition/
// unrest still discharges as DAMAGE — see ravage callers).
function hasOutsideBorder(world, parentCountryId, bloc) {
  const owner = world._territoryOwner;
  if (!owner || !world._byId) return true;            // no territory data yet → don't block
  const tw = world.tw, th = world.th, N = world.N;
  const blocIds = new Set();
  for (const m of bloc) blocIds.add(m.id);
  // Country of each tile-owner-id, cached so we don't look up countryId per tile.
  const ownerCountry = new Map();
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti]; if (oid < 0) continue;
    if (!blocIds.has(oid)) continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    // 4-neighbour border check (wrap in x).
    const xm = tx === 0 ? tw - 1 : tx - 1;
    const xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp,
                ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      const nOwner = owner[ni];
      if (nOwner < 0) return true;                    // unclaimed / sea = outside border
      if (blocIds.has(nOwner)) continue;              // tile owned by a bloc-mate, still "inside"
      let nc = ownerCountry.get(nOwner);
      if (nc === undefined) {
        const ns2 = world._byId.get(nOwner);
        nc = ns2 ? ns2.countryId : parentCountryId;
        ownerCountry.set(nOwner, nc);
      }
      if (nc !== parentCountryId) return true;        // touches a foreign country
    }
  }
  return false;                                       // fully enclosed by parent
}

// A sovereign state historically needed a CITY to function — somewhere to
// mint coin, hold court, raise an army, and be recognised by neighbours.
// Villages and towns could riot, break their tax obligation, or follow a
// city into a new realm — but they couldn't carry sovereignty alone. This
// predicate gates every successor-state path: any bloc whose highest tier
// is village (0) or town (1) fails to consolidate as a country.
function blocHasCity(bloc) {
  for (const m of bloc) if ((m.tier | 0) >= 2) return true;
  return false;
}

// Filter a candidate secession bloc to only the members whose TILE TERRITORY
// is contiguous with the seed's via other bloc members' tiles. A vassal can
// physically only follow its lord into a new realm if the new realm's
// territory actually reaches it — a village stranded deep inside parent
// territory, with no bloc-mate's land touching it, can't "go" anywhere when
// its lord declares independence; it stays with the parent state. This kills
// the pattern where seceded villages float as 1-tile islands inside their
// original country.
function filterToConnectedBloc(world, bloc, seed) {
  const owner = world._territoryOwner;
  if (!owner || !world._byId) return bloc;       // no territory data yet — fall back to as-given
  const tw = world.tw, th = world.th, N = world.N;
  const candidateIds = new Set();
  for (const m of bloc) candidateIds.add(m.id);
  // BFS over tiles, starting from any seed-owned tile, walking only tiles
  // owned by candidate-bloc members. Mark which member-ids we can reach.
  const reachable = new Set();
  reachable.add(seed.id);
  const q = [];
  // Seed all of seed's tiles into the queue.
  for (let ti = 0; ti < N; ti++) if (owner[ti] === seed.id) q.push(ti);
  if (q.length === 0) return [seed];             // seed has no claimed tiles (shouldn't happen)
  const visited = new Uint8Array(N);
  for (const ti of q) visited[ti] = 1;
  while (q.length) {
    const ti = q.pop();
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp,
                ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k]; if (ni < 0 || visited[ni]) continue;
      const oid = owner[ni]; if (oid < 0) continue;
      if (!candidateIds.has(oid)) continue;       // hit non-bloc territory — stop
      visited[ni] = 1;
      reachable.add(oid);
      q.push(ni);
    }
  }
  return bloc.filter(m => reachable.has(m.id));
}

// A regional revolt: each collapsed province becomes the seed of a successor
// state and rallies the disloyal members around it (within a reach radius)
// to join it. Loyal provinces stay with the empire; restless ones leave as a
// bloc with their garrisons — so the breakaway can actually defend itself.
function secedeContagious(world, c, seeds) {
  const radius = Math.max(REVOLT_RADIUS_MIN, c.range * REVOLT_RADIUS_RANGE);
  for (const seed of seeds) {
    if (seed.countryId !== c.id) continue;        // already swept into an earlier revolt this pass
    let bloc = [seed];
    for (const m of c.members) {
      if (m === seed || m.countryId !== c.id || m.id === c.capitalId) continue;
      if ((m.loyalty ?? 1) > REVOLT_JOIN_LOYALTY) continue;          // still loyal → doesn't join
      const pacified = world.step - (m._conqueredAt ?? -Infinity) < CONQUEST_GRACE;
      const infant   = m.parentSettlementId >= 0 && world.step - (m.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (pacified || infant) continue;                              // garrisoned / supported → held
      if (dist(world, seed.pos.x, seed.pos.y, m.pos.x, m.pos.y) > radius) continue;
      bloc.push(m);
    }
    // Promote the strongest city in the bloc to be the "anchor" — only
    // vassals whose territory connects to the anchor through bloc-owned
    // tiles can physically follow it into the new realm (filterToConnectedBloc).
    // Disconnected members stay with the parent state — they can't teleport.
    let anchor = seed;
    let anchorPow = (seed.tier | 0) >= 2 ? settlementPower(seed) : -1;
    for (const m of bloc) {
      if ((m.tier | 0) < 2) continue;
      const p = settlementPower(m);
      if (p > anchorPow) { anchorPow = p; anchor = m; }
    }
    bloc = filterToConnectedBloc(world, bloc, anchor);
    const newId = freshCountryId(c, bloc);
    if (newId < 0) continue;                       // can't carve out a distinct realm this pass
    // Viability checks:
    //  - geographic: a fully-enclosed bloc has no allies it can reach
    //  - political:  a bloc with no city has no seat of government
    // Either failure: discharge as a FAILED REVOLT (damage + cooldown).
    if (!hasOutsideBorder(world, c.id, bloc) || !blocHasCity(bloc)) {
      for (const m of bloc) {
        ravage(m, FAILED_REVOLT_POP, FAILED_REVOLT_WEALTH, FAILED_REVOLT_ARMY);
        m.loyalty = 0.5;                            // crushed but not happy
        m._conqueredAt = world.step;                // pacified for a while (no immediate retry)
        if (m.history) m.history.push({ step: world.step, type: "failed-revolt" });
      }
      continue;
    }
    for (const m of bloc) {
      m.countryId = newId;
      m.loyalty = m === seed ? 1 : 0.85;           // seed leads; followers enthusiastic
      m._conqueredAt = world.step;                 // resists immediate re-annex (anti-flicker)
      if (m.history) m.history.push({ step: world.step, type: m === seed ? "seceded" : "joined-revolt", to: newId });
    }
  }
}

// The throne has fallen: scatter the dead empire's surviving provinces into
// regional successor states around their strongest cities. Called from
// armies.js the moment a capital is stormed. The conqueror (excludeId) keeps
// only the captured throne-city; everything else fragments.
export function fragmentRealm(world, oldId, excludeId) {
  // The conqueror sacks the treasury — the fallen state's war-chest is seized
  // into the victor's coffers (keeps the coin conserved + a great war prize).
  if (world.governments) {
    const dead = world.governments.get(oldId);
    if (dead && dead.treasury > 0) {
      const conqId = world._byId ? (world._byId.get(excludeId) || {}).countryId : null;
      if (conqId != null) govOf(world, conqId).treasury += dead.treasury;
      dead.treasury = 0;
    }
  }
  const survivors = [];
  for (const s of world.settlements) {
    if (s.mode === "settled" && s.countryId === oldId && s.id !== excludeId) survivors.push(s);
  }
  if (survivors.length === 0) return;
  if (survivors.length === 1) {
    const s = survivors[0];
    s.countryId = s.id; s.loyalty = 1; s._conqueredAt = world.step;
    if (s.history) s.history.push({ step: world.step, type: "successor", of: oldId });
    return;
  }
  // Successor capitals: the strongest surviving cities, spread apart so the
  // fragments are genuinely separate regions rather than rivals next door.
  const ranked = survivors.slice().sort((a, b) => settlementPower(b) - settlementPower(a));
  const capitals = [];
  for (const s of ranked) {
    if (capitals.length >= FRAG_MAX_STATES) break;
    let far = true;
    for (const cap of capitals) {
      if (dist(world, s.pos.x, s.pos.y, cap.pos.x, cap.pos.y) < FRAG_SEPARATION) { far = false; break; }
    }
    if (far) capitals.push(s);
  }
  // Each survivor joins its nearest successor capital.
  for (const s of survivors) {
    let best = capitals[0], bd = Infinity;
    for (const cap of capitals) {
      const d = dist(world, s.pos.x, s.pos.y, cap.pos.x, cap.pos.y);
      if (d < bd) { bd = d; best = cap; }
    }
    s.countryId = best.id;
    s.loyalty = s.id === best.id ? 1 : 0.9;
    s._conqueredAt = world.step;                  // successors get breathing room (grace)
    if (s.history) s.history.push({ step: world.step, type: "successor", of: oldId });
  }
}

// Every member whose chain of lieges passes through `seed` — the governor's
// whole branch of the administrative tree (his vassals, their vassals, …).
function subtreeOf(c, seed) {
  const children = new Map();
  for (const m of c.members) {
    if (m.liegeId >= 0) { let a = children.get(m.liegeId); if (!a) children.set(m.liegeId, a = []); a.push(m); }
  }
  const out = [seed], stack = [seed];
  while (stack.length) {
    const cur = stack.pop();
    const kids = children.get(cur.id);
    if (kids) for (const k of kids) { out.push(k); stack.push(k); }
  }
  return out;
}

// An overmighty governor declares independence and takes his sub-realm with
// him — the whole liege branch under `seed` follows their lord into the new
// state, regardless of their own loyalty.
function declareIndependence(world, c, seed) {
  let bloc = subtreeOf(c, seed).filter(m => m.countryId === c.id);     // still in the realm
  // Only vassals whose tiles connect to the governor's via bloc-owned
  // land can physically follow him — distant vassals stranded inside
  // loyal-parent territory stay with the parent.
  bloc = filterToConnectedBloc(world, bloc, seed);
  const newId = freshCountryId(c, bloc);
  if (newId < 0) { seed._ambition = 0; return; }                       // can't split cleanly — vent it
  // Even an ambitious governor can't carve out an enclave with no
  // outside border — his bid is crushed by the surrounding loyalists.
  // The plot still costs him (army loss, ambition reset, cooldown).
  if (!hasOutsideBorder(world, c.id, bloc) || !blocHasCity(bloc)) {
    for (const m of bloc) {
      ravage(m, FAILED_REVOLT_POP, FAILED_REVOLT_WEALTH, FAILED_REVOLT_ARMY);
      m._ambition = 0;
      m.loyalty = 0.5;
      m._conqueredAt = world.step;
      if (m.history) m.history.push({ step: world.step, type: "failed-revolt" });
    }
    return;
  }
  for (const m of bloc) {
    m.countryId = newId;
    m._conqueredAt = world.step;                 // the breakaway realm gets breathing room (grace)
    m._ambition = 0;
    m.loyalty = m === seed ? 1 : 0.9;            // vassals are committed to their lord's new realm
    if (m.history) m.history.push({ step: world.step, type: m === seed ? "declared-independence" : "followed-lord", to: newId });
  }
}

// Damage a town in a rising — people die or flee, wealth is looted, the
// garrison mutinies.
function ravage(s, popMul, wealthMul, armyMul) {
  s.people = Math.max(1, (s.people || 0) * popMul);
  s.wealth = Math.max(0, (s.wealth || 0) * wealthMul);
  s.army   = Math.max(0, (s.army || 0) * armyMul);
}

// A popular REBELLION (distinct from an orderly secession): each boiled-over
// town guts itself and rallies the discontented HEARTLAND around it into a
// rebel state — destructive, and able to fire in the core, not just the edge.
// The capital can't break from itself, so it RIOTS instead (damage, no
// breakaway) — a starving throne loses people, shrinking the control budget.
function rebel(world, c, seeds) {
  const radius = Math.max(UNREST_RADIUS_MIN, c.range);
  for (const seed of seeds) {
    if (seed.id === c.capitalId) {            // the throne riots, it doesn't secede
      ravage(seed, RIOT_POP, RIOT_WEALTH, RIOT_ARMY);
      seed.unrest = 0;
      if (seed.history) seed.history.push({ step: world.step, type: "riot" });
      continue;
    }
    if (seed.countryId !== c.id) continue;    // already swept into an earlier rising this pass
    let bloc = [seed];
    for (const m of c.members) {
      if (m === seed || m.countryId !== c.id || m.id === c.capitalId) continue;
      if ((m.unrest ?? 0) < UNREST_JOIN) continue;                    // content → doesn't rise
      const pacified = world.step - (m._conqueredAt ?? -Infinity) < CONQUEST_GRACE;
      const infant   = m.parentSettlementId >= 0 && world.step - (m.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (pacified || infant) continue;                              // garrison holds it down for now
      if (dist(world, seed.pos.x, seed.pos.y, m.pos.x, m.pos.y) > radius) continue;
      bloc.push(m);
    }
    // Anchor + connectivity filter — disconnected members can't physically
    // follow the rebellion into the new state (see filterToConnectedBloc).
    let anchor = seed;
    let anchorPow = (seed.tier | 0) >= 2 ? settlementPower(seed) : -1;
    for (const m of bloc) {
      if ((m.tier | 0) < 2) continue;
      const p = settlementPower(m);
      if (p > anchorPow) { anchorPow = p; anchor = m; }
    }
    bloc = filterToConnectedBloc(world, bloc, anchor);
    const newId = freshCountryId(c, bloc);
    if (newId < 0) { seed.unrest = 0; continue; }
    // A landlocked rebellion can RIOT (do damage) but can't carve out a
    // sovereign state — the parent's loyal provinces surround and crush it.
    // The pressure still vents (unrest reset, towns damaged, grace), it
    // just doesn't produce a successor realm.
    if (!hasOutsideBorder(world, c.id, bloc) || !blocHasCity(bloc)) {
      for (const m of bloc) {
        ravage(m, REBEL_POP, REBEL_WEALTH, REBEL_ARMY);
        m.unrest = 0;
        m.loyalty = 0.5;
        m._conqueredAt = world.step;
        if (m.history) m.history.push({ step: world.step, type: "failed-revolt" });
      }
      continue;
    }
    for (const m of bloc) {
      ravage(m, REBEL_POP, REBEL_WEALTH, REBEL_ARMY);
      m.countryId = newId;
      m.unrest = 0;                            // the rising vents the grievance
      m.loyalty = 1;                           // loyal to the new rebel realm
      m._conqueredAt = world.step;             // resists immediate re-annex (anti-flicker)
      if (m.history) m.history.push({ step: world.step, type: m === seed ? "rebellion" : "joined-rebellion", to: newId });
    }
  }
}

// Spend the treasury, army first. The army has the FIRST claim on the
// treasury; if it can't be paid in full the state is INSOLVENT (gov._solvency
// < 1), which both makes garrisons desert (armies.js) and throttles the
// control budget (capacity) — the fiscal-military collapse trigger. Only the
// surplus above a war-chest reserve is spent on public works / dole.
function disburseTreasury(world, c, gov, warLevel) {
  const members = c.members;
  // Wages and the reserve scale with the realm's local price level
  // (inflation.js). An inflated economy needs more coin to pay the same
  // soldiers — Spain-after-Potosí dynamics — and the war-chest grows with
  // the wage bill so a state still has a couple of passes' buffer at any P.
  const realmP = localPByCountry(world, c);
  // Wages also scale with the AVERAGE TIER of the realm. A village's
  // soldiers are cheap militia (food + a little equipment), while a city
  // fields professional infantry that demand real pay. Without this, tiny
  // village-tier countries paid the same wages as Roman legions, and the
  // fiscal-military spiral instantly crushed them — they bankrupted within
  // 1-2 passes of forming. This restores the realistic case of a small
  // viable state.
  let _tierTotal = 0, _tierN = 0;
  for (const s of members) { _tierTotal += s.tier | 0; _tierN++; }
  const avgTier = _tierN > 0 ? _tierTotal / _tierN : 0;
  const tierFactor = 0.3 + 0.7 * Math.min(1, avgTier / 2);  // 0.3 at village, 0.65 at town, 1.0 at city+
  const wage = ARMY_WAGE * realmP * tierFactor;
  // War surcharge only really applies to real states (with at least one
  // city). A village-level realm can't afford a war and shouldn't be modelled
  // as paying for one — its army either runs away or is dismantled (food
  // desertion handles that), not bankrupted.
  let hasCity = false;
  for (const s of members) if ((s.tier | 0) >= 2) { hasCity = true; break; }
  const effSurcharge = hasCity ? WAR_SURCHARGE : 0;
  let spent = 0;

  // ── 1. ARMY PAY (first claim) ──
  // War multiplies the bill: campaigning/being besieged costs far more than a
  // peacetime garrison — this is what actually drains a treasury and bankrupts
  // a state under sustained or multi-front war.
  let totalArmy = 0;
  for (const s of members) if (s.countryId === c.id) totalArmy += s.army || 0;
  const armyBill = totalArmy * wage * (1 + effSurcharge * (warLevel || 0));
  const armyPaid = Math.min(Math.max(0, gov.treasury), armyBill);
  gov._solvency = armyBill > 0.01 ? armyPaid / armyBill : 1;   // 1 = fully paid; < 1 = arrears
  if (armyPaid > 0 && totalArmy > 0) {
    for (const s of members) {
      if (s.countryId !== c.id || !(s.army > 0)) continue;
      const share = armyPaid * (s.army / totalArmy);
      s.wealth = (s.wealth || 0) + share; recordIn(s, IN_STATE_PAY, share);
    }
    gov.treasury -= armyPaid; spent += armyPaid;
  }

  // ── 2. PUBLIC WORKS / DOLE — only the surplus above the war-chest reserve ──
  // The reserve is sized on the PEACETIME bill (built up in peace, drawn down
  // by a war's surcharge) so a solvent state can ride out a war for a while
  // before going bankrupt. It's also the coin a conqueror seizes.
  const reserve = totalArmy * wage * RESERVE_PASSES;
  let budget = gov.treasury - reserve;
  if (budget > 0.01) {
    let totW = 0;
    for (const s of members) {
      if (s.countryId !== c.id || s.id === c.capitalId) continue;
      const boost = (s._housingPressed ? 0.5 : 0) + ((s._foodDemand || 0) > (s._foodSupply || 0) ? 0.5 : 0);
      s._govW = Math.max(0, s.people || 0) * (1 + boost);
      totW += s._govW;
    }
    if (totW > 0) {
      for (const s of members) {
        if (s.countryId !== c.id || s.id === c.capitalId) continue;
        const share = budget * (s._govW / totW);
        s.wealth = (s.wealth || 0) + share; recordIn(s, IN_STATE_PAY, share);
      }
      gov.treasury -= budget; spent += budget;
    }
  }
  gov._spend = gov._spend * 0.9 + spent * 0.1;
}

// ── Capital → member transport cost (terrain + naval) ────────────────
// The "real" distance an empire's centre must project authority across.
// We Dijkstra outward from the capital, charging the raw terrain cost per
// step — so a Himalayan-isolated province costs the centre far more than
// its straight-line distance suggests, while a province on the open plain
// is exactly as expensive as the euclidean reading.
//
// Tech does NOT discount land travel here — that belongs in c.range (the
// reach BUDGET), not in the distance. Otherwise a high-tech empire pays
// 4× less per plain tile and the budget never bites. The only tech that
// enters this Dijkstra is NAVIGATION, which gates water embarkation: a
// port capital with navigation projects authority across coastal water at
// the same cost as overland (the sea-highway effect that lets a colonial
// empire span the ocean). Without navigation, water is Infinity.
//
// The search is bounded by ~25 × range so we don't walk the whole map, and
// returns as soon as every member's home tile is hit. With ~20 countries
// and member-rich heartlands the per-pass cost is well under 1ms.
class _PolHeap {
  constructor() { this.ti = []; this.d = []; this.n = 0; }
  push(ti, d) {
    let i = this.n++; this.ti.push(ti); this.d.push(d);
    while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break;
      const tt = this.ti[p], td = this.d[p];
      this.ti[p] = this.ti[i]; this.d[p] = this.d[i];
      this.ti[i] = tt; this.d[i] = td; i = p;
    }
  }
  popMin() {
    const ti = this.ti[0], d = this.d[0]; this.n--;
    if (this.n > 0) {
      this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n];
      this.ti.pop(); this.d.pop();
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2; let b = i;
        if (l < this.n && this.d[l] < this.d[b]) b = l;
        if (r < this.n && this.d[r] < this.d[b]) b = r;
        if (b === i) break;
        const tt = this.ti[b], td = this.d[b];
        this.ti[b] = this.ti[i]; this.d[b] = this.d[i];
        this.ti[i] = tt; this.d[i] = td; i = b;
      }
    } else { this.ti.pop(); this.d.pop(); }
    return { ti, d };
  }
}
function capitalTransportCosts(world, c) {
  const { tw, th } = world;
  const cap = c.capital;
  // Pass navigation ONLY — strips the land tech-multipliers, keeps the
  // water-embarkation gate. Land = baseEdgeCost; water = navigable iff
  // nav ≥ 0.2 and at a cost that falls from ~12 to ~3 as nav rises.
  const kn  = { navigation: (cap.knowledge && cap.knowledge.navigation) || 0 };
  const out = new Map();
  const homes = new Map();
  let pending = 0;
  for (const m of c.members) {
    if (m.id === c.capitalId) { out.set(m.id, 0); continue; }
    const ti = (m.pos.y | 0) * tw + (m.pos.x | 0);
    homes.set(ti, m.id);
    pending++;
  }
  if (pending === 0) return out;
  const maxCost = Math.max(50, c.range * 25);
  const dist = new Map();
  const capTi = (cap.pos.y | 0) * tw + (cap.pos.x | 0);
  dist.set(capTi, 0);
  const heap = new _PolHeap();
  heap.push(capTi, 0);
  const SQRT2 = Math.SQRT2;
  while (heap.n > 0 && pending > 0) {
    const { ti, d } = heap.popMin();
    if (d > maxCost) break;
    const dHere = dist.get(ti);
    if (dHere === undefined || d > dHere) continue;
    const hit = homes.get(ti);
    if (hit !== undefined) { out.set(hit, d); homes.delete(ti); pending--; }
    const ty = (ti / tw) | 0;
    const tx = ti - ty * tw;
    const xm = tx === 0      ? tw - 1 : tx - 1;
    const xp = tx === tw - 1 ? 0      : tx + 1;
    const yu = ty - 1, yd = ty + 1;
    const ns = [
      ty * tw + xm, ty * tw + xp,
      yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
      yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
      yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1,
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      const ec = localEdgeCost(world, ti, ni, kn);
      if (ec === Infinity) continue;
      const nd = d + ec * mul[k];
      if (nd > maxCost) continue;
      const prev = dist.get(ni);
      if (prev === undefined || nd < prev) { dist.set(ni, nd); heap.push(ni, nd); }
    }
  }
  return out;
}

export function updatePolities(world) {
  const countries = rebuildCountries(world);

  for (const c of countries.values()) {
    if (c.members.length === 1) { c.members[0].loyalty = 1; continue; }   // city-state: loyal to itself
    if (c.members.length <= 1) continue;

    const cap = c.capital;
    const capPower = settlementPower(cap);
    const range = Math.max(1, c.range);
    // Real per-member projection cost from the capital, via tech × terrain.
    // The Himalayas / oceans / rivers all drain the centre's reach budget
    // exactly the way they drain a column's movement. (Naval shortcuts are
    // already baked into localEdgeCost via water embarkation, so we no
    // longer apply a separate _isPort discount here.)
    const tcosts = capitalTransportCosts(world, c);
    const reachCeil = range * 25;   // matches the Dijkstra's bound

    // ── Control budget: what the centre can administer (reach-units) ──
    // The capital projects a base budget that grows with its own size; loyal
    // regional seats run sub-administrations that extend it. A weak/declining
    // capital → small budget → the frontier can't be held.
    let seatBonus = 0;
    for (const s of c.members) {
      if (s.id === c.capitalId) continue;
      const isSeat = (s.tier | 0) >= 2 || (s._vassalCount || 0) > 0;
      if (!isSeat) continue;
      const seatSize = Math.min(2, Math.log2(1 + (s.people || 0) / SIZE_REF));
      seatBonus += CAP_SEAT * (s.loyalty ?? 1) * seatSize;   // disloyal/small seats help less
    }
    const peaceCapacity = CAP_BASE + CAP_POP * Math.log2(1 + (cap.people || 0) / CAP_POP_REF)
                        + Math.min(SEAT_BONUS_CAP, seatBonus);

    // ── War duress: throttle the budget while the realm is fighting ────
    // (fronts are tallied in armies.js advanceFronts → world._fronts.)
    const fb = world._fronts && world._fronts.byCountry;
    const fronts = fb ? (fb.get(c.id) ? fb.get(c.id).size : 0) : 0;
    const besiegedCap = world.step - (cap._siegeAt ?? -Infinity) < SIEGE_WINDOW;
    const raidedCap   = world.step - (cap._warAt   ?? -Infinity) < SIEGE_WINDOW;
    let duress = 1;
    if (fronts > 1) duress /= (1 + MULTIFRONT_PENALTY * Math.min(3, fronts - 1));   // split army/attention (capped)
    if (besiegedCap)     duress *= SIEGE_CAPACITY_MULT;                  // throne pinned
    else if (raidedCap)  duress *= WAR_CAPACITY_MULT;                    // core harried
    // War intensity drives the army's wartime cost surcharge (disburseTreasury).
    const warLevel = fronts + (besiegedCap ? 2 : raidedCap ? 1 : 0);
    // Fiscal duress (death-spiral): a state that can't pay its army (last
    // pass's solvency, from disburseTreasury) loses its grip on the frontier.
    // Lose provinces → lose tax revenue → can't pay → capacity falls → lose
    // more — the self-reinforcing collapse.
    const gov = govOf(world, c.id);
    const solvency = gov._solvency ?? 1;
    const fiscalDuress = SOLVENCY_FLOOR + solvency * (1 - SOLVENCY_FLOOR);
    const capacity = peaceCapacity * duress * fiscalDuress;
    c._capacity = capacity;        // (already duress-adjusted) for the info panel
    c._fronts = fronts;
    c._capitalBesieged = besiegedCap;
    c._solvency = solvency;

    // Variable taxation: war + insolvency push the rate up toward a cap. Recent
    // conquests bank war-weariness relief (_spoils, in armies.js) that fades.
    const targetTax = Math.min(TAX_MAX, TAX_BASE + TAX_WAR * warLevel + TAX_BANKRUPT * (1 - solvency));
    gov._taxRate = (gov._taxRate ?? TAX_BASE) + (targetTax - (gov._taxRate ?? TAX_BASE)) * TAX_DRIFT;
    gov._spoils = (gov._spoils || 0) * SPOILS_DECAY;
    c._taxRate = gov._taxRate;

    // ── Popular unrest: hardship piles up; peace + plenty + light taxes cool it.
    // At the top it boils over into a rebellion (rebel(), fired after secession).
    const taxOver = Math.max(0, (gov._taxRate - TAX_BASE) / (TAX_MAX - TAX_BASE));
    const warFat = Math.min(1, warLevel * 0.4) * (1 - Math.min(1, gov._spoils || 0));
    const rebelSeeds = [];
    for (const s of c.members) {
      if (s.countryId !== c.id) continue;
      const fed = (s._foodSupply || 0) + (s._foodImportRate || 0);
      const demand = s._foodDemand || 0.0001;
      const hunger = fed < demand ? Math.min(1, (demand - fed) / demand) : 0;
      const conscript = Math.min(1, ((s.army || 0) / Math.max(1, s.people)) / CONSCRIPT_REF);
      const gH = hunger * HUNGER_W, gC = conscript * CONSCRIPT_W, gW = warFat * WARFAT_W, gT = taxOver * OVERTAX_W;
      const gS = shockUnrest(world, s);   // direct famine/plague distress (shocks.js)
      s.unrest = Math.max(0, Math.min(1, (s.unrest || 0) + (gH + gC + gW + gT + gS) * UNREST_GAIN - UNREST_RELIEF));
      s._unrestCause = s._plagueActive ? "plague"
                     : gH >= gC && gH >= gW && gH >= gT ? "famine"
                     : gT >= gC && gT >= gW ? "taxes"
                     : gW >= gC ? "war fatigue" : "conscription";
      if (s.unrest > 0.5) s.loyalty = Math.max(0, (s.loyalty ?? 1) - UNREST_LOYALTY_BLEED * (s.unrest - 0.5));  // anger erodes loyalty
      const pacified = world.step - (s._conqueredAt ?? -Infinity) < CONQUEST_GRACE;
      if (s.unrest >= 1 && (s.id === c.capitalId || !pacified)) rebelSeeds.push(s);
    }

    // ── Per-member admin load (cost to hold) ──────────────────────────
    const loads = [];
    for (const s of c.members) {
      if (s.id === c.capitalId) { s.loyalty = 1; s._ambition = 0; continue; }
      // Distance the CENTRE must project authority across. Start from the
      // straight-line reading, then add HALF the terrain surcharge over
      // that baseline (mountains and water hurt; easy terrain doesn't help —
      // otherwise riverine/coastal capitals project authority too cheaply
      // and rival the historic mega-empires for the wrong reasons). The
      // result: a province behind the Himalayas reads as several times
      // farther; a province across plain reads at its true distance.
      const eucl = dist(world, cap.pos.x, cap.pos.y, s.pos.x, s.pos.y);
      const tc   = tcosts.get(s.id);
      const tcEff = (tc === undefined || !isFinite(tc)) ? reachCeil : tc;
      const surcharge = Math.max(0, tcEff - eucl);
      let d = eucl + 0.5 * surcharge;
      d /= holdPull(s);                                               // value cling
      const coerce  = Math.min(COERCE_CAP, Math.sqrt(capPower / Math.max(1, settlementPower(s))));
      const sizeMul = 1 + SIZE_LOAD * Math.min(3, Math.log2(1 + (s.people || 0) / SIZE_REF));
      const recMul  = 1 + RECENCY_LOAD * recencyFactor(world, s);
      const load = (d / range) * sizeMul * recMul / coerce;
      s._adminLoad = load;            // for the info panel
      loads.push({ s, load });
    }

    // ── Spend the budget on the cheapest provinces first ──────────────
    // Walk provinces from cheapest to dearest, spending the budget. Those
    // that fit are "covered" and recover loyalty; the rest are over-extended
    // and bleed loyalty (faster the deeper past the line they sit). When a
    // province's loyalty stock hits zero it breaks away. Recently-conquered
    // and infant colonies are GARRISONED — held firm while loyalty settles,
    // so the map doesn't flicker right after a capture or a founding.
    loads.sort((a, b) => a.load - b.load);
    let cum = 0;
    const seeds = [];   // provinces whose loyalty collapsed this pass → revolt seeds
    for (const { s, load } of loads) {
      cum += load;
      const covered  = cum <= capacity;
      const pacified = world.step - (s._conqueredAt ?? -Infinity) < CONQUEST_GRACE;
      const infant   = s.parentSettlementId >= 0 && world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (pacified || infant) {
        // Held by garrison / colonial project: nudge loyalty toward its base
        // but never secede yet.
        const base = pacified ? 0.5 : 0.7;
        s.loyalty = (s.loyalty ?? base) + (base - (s.loyalty ?? base)) * 0.15;
        continue;
      }
      if (covered) {
        s.loyalty = Math.min(1, (s.loyalty ?? 1) + LOYAL_RECOVER * (1 - (s.loyalty ?? 1)));
      } else {
        const over = (cum - capacity) / capacity;          // how deep past the budget
        s.loyalty = Math.max(0, (s.loyalty ?? 1) - LOYAL_DECAY * (1 + over));
        if (s.loyalty <= 0) seeds.push(s);                 // collapsed — defer (revolt is contagious)
      }
    }
    c._loadTotal = cum;   // total admin load drawn (vs c._capacity)
    // A collapse drags its restless region out with it (see secedeContagious).
    if (seeds.length) secedeContagious(world, c, seeds);
    // Boiled-over towns rise up (destructive, heartland-capable — see rebel()).
    if (rebelSeeds.length) rebel(world, c, rebelSeeds);

    // ── Overmighty governors: ambition-driven breakaway (with sub-realm) ──
    // Independent of the budget: a strong, distant governor schemes and, when
    // his ambition matures, declares independence and takes his vassal branch
    // with him. A besieged throne emboldens him.
    for (const s of c.members) {
      if (s.countryId !== c.id || s.id === c.capitalId) continue;     // gone / is the throne
      const seat = (s.tier | 0) >= 2 || (s._vassalCount || 0) > 0;    // must command a region
      const pacified = world.step - (s._conqueredAt ?? -Infinity) < CONQUEST_GRACE;
      const infant   = s.parentSettlementId >= 0 && world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      const ratio = settlementPower(s) / capPower;                    // strength vs the throne
      // Same blended distance as the hold load — a governor across a
      // mountain range is "farther" than its straight-line reading,
      // proportionally embolder.
      const eucl = dist(world, cap.pos.x, cap.pos.y, s.pos.x, s.pos.y);
      const tc   = tcosts.get(s.id);
      const tcEff = (tc === undefined || !isFinite(tc)) ? reachCeil : tc;
      const far  = (eucl + 0.5 * Math.max(0, tcEff - eucl)) / range;
      if (!seat || pacified || infant || ratio < AMBITION_RATIO || far < AMBITION_MIN_FAR) {
        if (s._ambition) s._ambition = Math.max(0, s._ambition - AMBITION_GAIN);   // fades when unqualified
        continue;
      }
      const margin = (ratio - AMBITION_RATIO) / (1 - AMBITION_RATIO);  // 0 at threshold → 1 near parity
      const duressMul = besiegedCap ? AMBITION_DURESS : (raidedCap ? 1.2 : 1);
      s._ambition = (s._ambition || 0) + AMBITION_GAIN * margin * (1 + AMBITION_FAR * far) * duressMul;
      if (s._ambition >= 1) declareIndependence(world, c, s);
    }

    // ── State finances: tax members into the treasury, then spend it back ──
    // REVENUE: each established member pays tribute (the state tax) into the
    // GOVERNMENT treasury — not the capital city's private purse. (Customs
    // duties were already paid into the treasury during the trade pass.) A
    // YOUNG colony instead RECEIVES support (food from the capital's granary +
    // coin from the treasury) until it matures, so a raw frontier survives.
    // (gov fetched above for the fiscal-duress capacity term.)
    for (const s of c.members) {
      if (s.id === c.capitalId || s.countryId !== c.id) continue;
      const youngColony = s.parentSettlementId >= 0 &&
                          world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (youngColony) {
        const food = Math.min(COLONY_SUPPLY_FOOD, Math.max(0, (c.capital.food || 0) - 20));
        if (food > 0) { c.capital.food -= food; s.food = (s.food || 0) + food; }
        // Colony subsidy scales with the realm's price level so a settlement
        // founded in an inflated economy gets a real (P-adjusted) endowment.
        const grant = COLONY_SUPPLY_COIN * localPByCountry(world, c);
        const coin = Math.min(grant, Math.max(0, gov.treasury));
        if (coin > 0) { gov.treasury -= coin; s.wealth = (s.wealth || 0) + coin; recordIn(s, IN_AID, coin); }
        continue;                                   // subsidised, not taxed
      }
      const give = Math.max(0, s.wealth || 0) * (gov._taxRate ?? TAX_BASE);
      if (give > 0) { s.wealth -= give; gov.treasury += give; gov._revenue += give; recordOut(s, OUT_TRIBUTE, give); }
    }
    // EXPENDITURE: spend the treasury back out (army pay → garrisons, then
    // works/dole → provinces). Balanced budget ⇒ the throne stops hoarding.
    disburseTreasury(world, c, gov, warLevel);
    c._treasury = gov.treasury;
    c._govRevenue = gov._revenue; gov._revenue = 0;   // per-pass revenue, for the panel
    c._govSpend = gov._spend;
  }

  // ── City-state minimum tier rule ─────────────────────────────────────
  // A sovereign realm needs a city. A "country" whose largest member is a
  // village or town has no seat to mint, govern, or defend — it's the new
  // village whose owner hasn't gotten around to claiming it. Absorb it
  // into the strongest neighbouring country (sharing any tile border).
  // No bordering country at all → genuinely undiscovered frontier, stays
  // an independent city-state. (Pacified-grace gate: don't immediately
  // re-flip a freshly seceded/conquered settlement.)
  absorbSubCityCountries(world, countries);

  // Drop treasuries of realms that no longer exist (conquest seizure already
  // moved the coin of conquered capitals; this just stops the map growing).
  if (world.governments) {
    for (const id of world.governments.keys()) if (!countries.has(id)) world.governments.delete(id);
  }
}

function absorbSubCityCountries(world, countries) {
  const owner = world._territoryOwner, byId = world._byId;
  if (!owner || !byId) return;
  // Identify countries that lack any city-tier member.
  const subCity = [];
  for (const c of countries.values()) {
    let hasCity = false;
    for (const m of c.members) if ((m.tier | 0) >= 2) { hasCity = true; break; }
    if (!hasCity) subCity.push(c);
  }
  if (subCity.length === 0) return;
  const tw = world.tw, th = world.th, N = world.N;
  // Map every sub-city settlement-id → its country, and remember which ids
  // belong to a sub-city realm at all (for fast tile-walk filtering).
  const settToCountry = new Map();
  for (const c of subCity) for (const m of c.members) settToCountry.set(m.id, c);
  // Per-settlement touch scores (foreign-country-id → cumulative power).
  // We walk EVERY tile once and credit each foreign neighbour to the
  // settlement that owns the home tile, NOT to the whole country. That
  // makes each sub-city member's exposure independent: a village on the
  // edge feels the cradle's pull; a village deep inside its own
  // hinterland doesn't.
  const perSett = new Map();
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti]; if (oid < 0) continue;
    const ownerSett = byId.get(oid);
    if (!ownerSett || !settToCountry.has(ownerSett.id)) continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp,
                ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    const myCountry = ownerSett.countryId;
    for (let k = 0; k < 4; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      const no = owner[ni]; if (no < 0) continue;
      const ns2 = byId.get(no); if (!ns2 || ns2.countryId === myCountry) continue;
      const foreign = countries.get(ns2.countryId); if (!foreign) continue;
      let foreignHasCity = false;
      for (const fm of foreign.members) if ((fm.tier | 0) >= 2) { foreignHasCity = true; break; }
      if (!foreignHasCity) continue;
      const orgK = (foreign.capital.knowledge && foreign.capital.knowledge.organization) || 0;
      if (orgK < ABSORB_ORG_MIN) continue;
      const orgFactor = Math.min(1, (orgK - ABSORB_ORG_MIN) / (1 - ABSORB_ORG_MIN));
      let perCc = perSett.get(ownerSett.id);
      if (!perCc) { perCc = new Map(); perSett.set(ownerSett.id, perCc); }
      perCc.set(ns2.countryId,
        (perCc.get(ns2.countryId) || 0) + settlementPower(foreign.capital) * orgFactor);
    }
  }
  // Per-settlement probabilistic defection. A village that's heavily
  // exposed to a strong foreign neighbour rolls a per-pass chance to
  // defect; one that's barely touching rolls a lower chance. This
  // produces the visible "village-by-village, year by year" pattern of
  // a small statelet being eroded into a great power's orbit, instead
  // of the entire statelet flipping atomically in one tick.
  for (const [settId, scoreMap] of perSett) {
    const m = byId.get(settId);
    if (!m || m.mode !== "settled") continue;
    if (world.step - (m._conqueredAt ?? -Infinity) < CONQUEST_GRACE) continue;
    let bestId = -1, bestScore = -1;
    for (const [cid, score] of scoreMap) if (score > bestScore) { bestScore = score; bestId = cid; }
    if (bestId < 0) continue;
    const myPower = Math.max(1, settlementPower(m));
    // Defection chance per polity pass — caps at ABSORB_PROB_MAX so even
    // a tiny village vs a huge cradle defects gradually (~10 passes to
    // flip on average), not instantly.
    const ratio = bestScore / myPower;
    const prob = Math.min(ABSORB_PROB_MAX, ratio * 0.04);
    // Deterministic hash on (id, step) — same input always rolls the same
    // outcome, so debugging is reproducible and there's no jitter.
    const r = ((m.id * 9301 + world.step * 49297 + 7) % 233280) / 233280;
    if (r > prob) continue;
    m.countryId = bestId;
    m.loyalty = 0.6;                          // absorbed, not yet truly part of the realm
    m._conqueredAt = world.step;              // brief grace to settle in
    if (m.history) m.history.push({ step: world.step, type: "absorbed", into: bestId });
  }

  // ── Enclave fragment absorption ─────────────────────────────────────
  // A sub-city settlement inside a LARGER country whose home tile is
  // fully surrounded by foreign territory (and which has no port → no sea
  // resupply) is a stranded fragment — a village whose parent capital is
  // unreachable. Real example: a one-village exclave of country A
  // marooned inside country B. The settlement flips to the surrounding
  // power. (City-bearing enclaves stay — they have the apparatus to hold
  // out: West Berlin, Vatican, Llívia.)
  for (const c of countries.values()) {
    for (const m of c.members) {
      if (m.mode !== "settled") continue;
      if ((m.tier | 0) >= 2) continue;            // cities can hold out as enclaves
      if (m._isPort) continue;                    // sea resupply → real enclave
      if (m.id === c.capitalId) continue;
      if (world.step - (m._conqueredAt ?? -Infinity) < CONQUEST_GRACE) continue;
      // Check the 8 neighbours of the settlement's home tile.
      const ti = (m.pos.y | 0) * tw + (m.pos.x | 0);
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const yu = ty - 1, yd = ty + 1;
      const cells = [
        ty * tw + xm, ty * tw + xp,
        yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
        yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
        yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1,
      ];
      let ownCC = 0, foreignTouch = new Map();
      for (let k = 0; k < 8; k++) {
        const ni = cells[k]; if (ni < 0) continue;
        const oid = owner[ni]; if (oid < 0) continue;
        const ns2 = byId.get(oid); if (!ns2) continue;
        if (ns2.countryId === c.id) { ownCC++; continue; }
        const foreign = countries.get(ns2.countryId); if (!foreign) continue;
        let foreignHasCity = false;
        for (const fm of foreign.members) if ((fm.tier | 0) >= 2) { foreignHasCity = true; break; }
        if (!foreignHasCity) continue;
        // Same tech gate as the sub-city absorption: a low-organisation
        // power can't administratively swallow even a stranded enclave.
        const orgK = (foreign.capital.knowledge && foreign.capital.knowledge.organization) || 0;
        if (orgK < ABSORB_ORG_MIN) continue;
        const orgFactor = Math.min(1, (orgK - ABSORB_ORG_MIN) / (1 - ABSORB_ORG_MIN));
        foreignTouch.set(ns2.countryId, (foreignTouch.get(ns2.countryId) || 0) + settlementPower(foreign.capital) * orgFactor);
      }
      if (ownCC > 0) continue;                    // not actually marooned
      if (foreignTouch.size === 0) continue;      // unclaimed land — let crystallisation/territory pass handle
      let bestId = -1, bestScore = -1;
      for (const [cid, score] of foreignTouch) if (score > bestScore) { bestScore = score; bestId = cid; }
      if (bestId < 0) continue;
      // Same per-pass probabilistic flip as the sub-city absorption —
      // a stranded fragment takes time to give up.
      const myPower = Math.max(1, settlementPower(m));
      const prob = Math.min(ABSORB_PROB_MAX, (bestScore / myPower) * 0.04);
      const r = ((m.id * 9301 + world.step * 49297 + 13) % 233280) / 233280;
      if (r > prob) continue;
      m.countryId = bestId;
      m.loyalty = 0.6;
      m._conqueredAt = world.step;
      if (m.history) m.history.push({ step: world.step, type: "absorbed", into: bestId });
    }
  }
}
