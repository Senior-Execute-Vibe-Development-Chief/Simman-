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

const POLITY_INTERVAL  = 150;   // ticks between polity passes
const SECEDE_GRACE     = 500;   // ticks of sustained over-extension before a member secedes
const OVERSTRETCH      = 0.07;  // each extra member shrinks the empire's hold radius (admin limits)
const TRIBUTE_FRACTION = 0.06;  // share of a member's wealth sent to the capital each pass
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
    if (c.members.length <= 1) continue;
    // Effective hold radius shrinks as the empire grows: a sprawling realm
    // can't administer its edges, so distant provinces fall away.
    const hold = c.range / (1 + OVERSTRETCH * (c.members.length - 1));

    // Naval administration: if the capital is a port with navigation, its
    // effective reach to fellow ports (overseas colonies) is hugely
    // extended — the sea is the empire's highway.
    const capNav = c.capital._isPort ? (c.capital.knowledge.navigation || 0) : 0;

    // ── Secession (sticky): break away after sustained over-extension ──
    for (const s of c.members) {
      if (s.id === c.capitalId) { s._disloyalSince = undefined; continue; }
      // A freshly conquered province is pacified (garrisoned): it's held
      // firmly for a while before the over-extension clock can run.
      if (world.step - (s._conqueredAt ?? -Infinity) < CONQUEST_GRACE) { s._disloyalSince = undefined; continue; }
      let d = dist(world, c.capital.pos.x, c.capital.pos.y, s.pos.x, s.pos.y);
      if (capNav > 0 && s._isPort) d /= (1 + capNav * NAVAL_REACH);
      d /= holdPull(s);                         // valuable provinces are clung to
      if (d > hold) {
        if (s._disloyalSince === undefined) s._disloyalSince = world.step;
        if (world.step - s._disloyalSince >= SECEDE_GRACE) {
          s.countryId = s.id;
          s._disloyalSince = undefined;
          // A state that has just won its independence resists re-conquest
          // for a while (reuses the pacification grace), so it doesn't get
          // re-annexed next pass — the other half of killing the flicker.
          s._conqueredAt = world.step;
          if (s.history) s.history.push({ step: world.step, type: "seceded" });
        }
      } else {
        s._disloyalSince = undefined;
      }
    }

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
        if (coin > 0) { c.capital.wealth -= coin; s.wealth = (s.wealth || 0) + coin; }
        continue;                                   // subsidised, not taxed
      }
      // Tribute flows UP the administrative chain: a village pays its town,
      // the town its city, the city the capital — so wealth climbs the
      // hierarchy level by level rather than teleporting to the throne.
      const liege = (s.liegeId >= 0 && world._byId) ? world._byId.get(s.liegeId) : null;
      const to = liege && liege.mode === "settled" ? liege : c.capital;
      const give = Math.max(0, s.wealth || 0) * TRIBUTE_FRACTION;
      if (give > 0) { s.wealth -= give; to.wealth = (to.wealth || 0) + give; }
    }
  }
}
