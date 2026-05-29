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
    const capacity = CAP_BASE + CAP_POP * Math.log2(1 + (cap.people || 0) / CAP_POP_REF)
                   + Math.min(SEAT_BONUS_CAP, seatBonus);
    c._capacity = capacity;   // control budget (for the info panel + debugging)

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
        if (s.loyalty <= 0) {
          s.countryId = s.id;            // secede — a new successor state
          s.loyalty = 1;                 // loyal to itself now
          s._conqueredAt = world.step;   // resists immediate re-annex (anti-flicker)
          if (s.history) s.history.push({ step: world.step, type: "seceded" });
        }
      }
    }
    c._loadTotal = cum;   // total admin load drawn (vs c._capacity)

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
