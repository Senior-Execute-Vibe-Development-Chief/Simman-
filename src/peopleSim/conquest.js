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
import { recordIn, recordOut, IN_TRIBUTE, IN_AID, OUT_TRIBUTE, OUT_AID } from "./money.js";

const POLITY_INTERVAL  = 150;   // ticks between polity passes
const TRIBUTE_FRACTION = 0.06;  // share of a member's wealth sent to the capital each pass

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
// Naval administration: a maritime capital (a port with navigation) can
// govern distant overseas members (also ports) far beyond its land hold
// range — the sea is its highway, not a barrier. This is what lets a
// colonial empire span the ocean for a long age before overstretch finally
// fragments it. Effective distance to a fellow port is divided by
// (1 + navigation × NAVAL_REACH).
const NAVAL_REACH      = 2.2;
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

// A regional revolt: each collapsed province becomes the seed of a successor
// state and rallies the disloyal members around it (within a reach radius)
// to join it. Loyal provinces stay with the empire; restless ones leave as a
// bloc with their garrisons — so the breakaway can actually defend itself.
function secedeContagious(world, c, seeds) {
  const radius = Math.max(REVOLT_RADIUS_MIN, c.range * REVOLT_RADIUS_RANGE);
  for (const seed of seeds) {
    if (seed.countryId !== c.id) continue;        // already swept into an earlier revolt this pass
    const newId = seed.id;
    seed.countryId = newId;
    seed.loyalty = 1;
    seed._conqueredAt = world.step;               // resists immediate re-annex (anti-flicker)
    if (seed.history) seed.history.push({ step: world.step, type: "seceded" });
    for (const m of c.members) {
      if (m.countryId !== c.id || m.id === c.capitalId) continue;   // capital + already-moved stay put
      if ((m.loyalty ?? 1) > REVOLT_JOIN_LOYALTY) continue;          // still loyal → doesn't join
      const pacified = world.step - (m._conqueredAt ?? -Infinity) < CONQUEST_GRACE;
      const infant   = m.parentSettlementId >= 0 && world.step - (m.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (pacified || infant) continue;                              // garrisoned / supported → held
      if (dist(world, seed.pos.x, seed.pos.y, m.pos.x, m.pos.y) > radius) continue;
      m.countryId = newId;
      m.loyalty = 0.85;                            // enthusiastic for the new local realm
      m._conqueredAt = world.step;
      if (m.history) m.history.push({ step: world.step, type: "joined-revolt", to: newId });
    }
  }
}

// The throne has fallen: scatter the dead empire's surviving provinces into
// regional successor states around their strongest cities. Called from
// armies.js the moment a capital is stormed. The conqueror (excludeId) keeps
// only the captured throne-city; everything else fragments.
export function fragmentRealm(world, oldId, excludeId) {
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

export function updatePolities(world) {
  const countries = rebuildCountries(world);

  for (const c of countries.values()) {
    if (c.members.length === 1) { c.members[0].loyalty = 1; continue; }   // city-state: loyal to itself
    if (c.members.length <= 1) continue;

    const cap = c.capital;
    const capNav = cap._isPort ? (cap.knowledge.navigation || 0) : 0;
    const capPower = settlementPower(cap);
    const range = Math.max(1, c.range);

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
    const capacity = peaceCapacity * duress;
    c._capacity = capacity;        // (already duress-adjusted) for the info panel
    c._fronts = fronts;
    c._capitalBesieged = besiegedCap;

    // ── Per-member admin load (cost to hold) ──────────────────────────
    const loads = [];
    for (const s of c.members) {
      if (s.id === c.capitalId) { s.loyalty = 1; continue; }
      // Distance the CENTRE must project authority across — the real reach
      // cost. (A loyal regional seat doesn't make a far province cheap to
      // measure; it pays for it via the capacity budget above instead.)
      let d = dist(world, cap.pos.x, cap.pos.y, s.pos.x, s.pos.y);
      if (capNav > 0 && s._isPort) d /= (1 + capNav * NAVAL_REACH);   // sea highway
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

    // ── Tribute / colonial support ──
    // Established members send a slice of wealth up to the capital. A YOUNG
    // colony instead RECEIVES support — food and coin shipped from the
    // mother country — so it survives its first years instead of starving
    // on a raw frontier (exactly how real colonies were kept alive).
    for (const s of c.members) {
      if (s.id === c.capitalId || s.countryId !== c.id) continue;
      const youngColony = s.parentSettlementId >= 0 &&
                          world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (youngColony) {
        const food = Math.min(COLONY_SUPPLY_FOOD, Math.max(0, (c.capital.food || 0) - 20));
        if (food > 0) { c.capital.food -= food; s.food = (s.food || 0) + food; }
        const coin = Math.min(COLONY_SUPPLY_COIN, Math.max(0, c.capital.wealth || 0));
        if (coin > 0) { c.capital.wealth -= coin; s.wealth = (s.wealth || 0) + coin; recordOut(c.capital, OUT_AID, coin); recordIn(s, IN_AID, coin); }
        continue;                                   // subsidised, not taxed
      }
      // Tribute flows UP the administrative chain: a village pays its town,
      // the town its city, the city the capital — so wealth climbs the
      // hierarchy level by level rather than teleporting to the throne.
      const liege = (s.liegeId >= 0 && world._byId) ? world._byId.get(s.liegeId) : null;
      const to = liege && liege.mode === "settled" ? liege : c.capital;
      const give = Math.max(0, s.wealth || 0) * TRIBUTE_FRACTION;
      if (give > 0) { s.wealth -= give; to.wealth = (to.wealth || 0) + give; recordOut(s, OUT_TRIBUTE, give); recordIn(to, IN_TRIBUTE, give); }
    }
  }
}
