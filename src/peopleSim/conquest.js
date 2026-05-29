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

const POLITY_INTERVAL  = 150;   // ticks between polity passes

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

// A regional revolt: each collapsed province becomes the seed of a successor
// state and rallies the disloyal members around it (within a reach radius)
// to join it. Loyal provinces stay with the empire; restless ones leave as a
// bloc with their garrisons — so the breakaway can actually defend itself.
function secedeContagious(world, c, seeds) {
  const radius = Math.max(REVOLT_RADIUS_MIN, c.range * REVOLT_RADIUS_RANGE);
  for (const seed of seeds) {
    if (seed.countryId !== c.id) continue;        // already swept into an earlier revolt this pass
    const bloc = [seed];
    for (const m of c.members) {
      if (m === seed || m.countryId !== c.id || m.id === c.capitalId) continue;
      if ((m.loyalty ?? 1) > REVOLT_JOIN_LOYALTY) continue;          // still loyal → doesn't join
      const pacified = world.step - (m._conqueredAt ?? -Infinity) < CONQUEST_GRACE;
      const infant   = m.parentSettlementId >= 0 && world.step - (m.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (pacified || infant) continue;                              // garrisoned / supported → held
      if (dist(world, seed.pos.x, seed.pos.y, m.pos.x, m.pos.y) > radius) continue;
      bloc.push(m);
    }
    const newId = freshCountryId(c, bloc);
    if (newId < 0) continue;                       // can't carve out a distinct realm this pass
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
  const bloc = subtreeOf(c, seed).filter(m => m.countryId === c.id);   // still in the realm
  const newId = freshCountryId(c, bloc);
  if (newId < 0) { seed._ambition = 0; return; }                       // can't split cleanly — vent it
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
    const bloc = [seed];
    for (const m of c.members) {
      if (m === seed || m.countryId !== c.id || m.id === c.capitalId) continue;
      if ((m.unrest ?? 0) < UNREST_JOIN) continue;                    // content → doesn't rise
      const pacified = world.step - (m._conqueredAt ?? -Infinity) < CONQUEST_GRACE;
      const infant   = m.parentSettlementId >= 0 && world.step - (m.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (pacified || infant) continue;                              // garrison holds it down for now
      if (dist(world, seed.pos.x, seed.pos.y, m.pos.x, m.pos.y) > radius) continue;
      bloc.push(m);
    }
    const newId = freshCountryId(c, bloc);
    if (newId < 0) { seed.unrest = 0; continue; }
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
  let spent = 0;

  // ── 1. ARMY PAY (first claim) ──
  // War multiplies the bill: campaigning/being besieged costs far more than a
  // peacetime garrison — this is what actually drains a treasury and bankrupts
  // a state under sustained or multi-front war.
  let totalArmy = 0;
  for (const s of members) if (s.countryId === c.id) totalArmy += s.army || 0;
  const armyBill = totalArmy * ARMY_WAGE * (1 + WAR_SURCHARGE * (warLevel || 0));
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
  const reserve = totalArmy * ARMY_WAGE * RESERVE_PASSES;
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
      s.unrest = Math.max(0, Math.min(1, (s.unrest || 0) + (gH + gC + gW + gT) * UNREST_GAIN - UNREST_RELIEF));
      s._unrestCause = gH >= gC && gH >= gW && gH >= gT ? "famine"
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
      const far   = dist(world, cap.pos.x, cap.pos.y, s.pos.x, s.pos.y) / range;
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
        const coin = Math.min(COLONY_SUPPLY_COIN, Math.max(0, gov.treasury));
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

  // Drop treasuries of realms that no longer exist (conquest seizure already
  // moved the coin of conquered capitals; this just stops the map growing).
  if (world.governments) {
    for (const id of world.governments.keys()) if (!countries.has(id)) world.governments.delete(id);
  }
}
