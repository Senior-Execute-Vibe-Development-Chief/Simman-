// ── Polities (countries) + conquest ──────────────────────────────────
//
// Every settlement belongs to a COUNTRY (s.countryId). It starts as its
// own one-settlement country (a city-state). Strong countries CONQUER the
// frontier settlements of weaker neighbours — the loser isn't destroyed,
// it's annexed into the winner's country — so city-states consolidate into
// proper multi-settlement countries.
//
// The keystone that stops one country eating the whole map is POWER
// PROJECTION DECAY: a capital's strength falls off with distance, so it
// can only conquer and HOLD what's near enough. Members that end up beyond
// the capital's hold range SECEDE. Together these give rise-and-fall:
// empires bloom, over-extend, and fragment into successor states.

const CONQUEST_INTERVAL  = 200;   // ticks between conquest/secession passes
const CONQUEST_THRESHOLD = 1.5;   // attacker must out-project the defender by this
const HOME_DEFENSE       = 1.4;   // defender fights better on home ground
const SECEDE_FACTOR      = 1.3;   // a member beyond capital range × this breaks away
const TRIBUTE_FRACTION   = 0.10;  // share of a member's spare wealth sent to the capital each pass
// Power-projection range (in tiles) per settlement, from its reach techs.
// Modest on purpose: force projected onto a frontier comes from the
// settlements NEAR it, decaying with distance — so empire SIZE alone can't
// crush a distant frontier (no snowball), and distant land can't be held.
const PROJ_BASE = 8, PROJ_ORG = 12, PROJ_MOB = 8, PROJ_NAV = 5;

export { CONQUEST_INTERVAL };

// Military weight of a settlement: numbers × weapons/cavalry × command.
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
function projRange(s) {
  const k = s.knowledge || {};
  return PROJ_BASE + (k.organization || 0) * PROJ_ORG + (k.mobility || 0) * PROJ_MOB + (k.navigation || 0) * PROJ_NAV;
}

// Force a country can bring to bear on point (tx,ty): the sum over its
// settlements of their power, each decayed by distance — so only the
// settlements NEAR the point contribute meaningfully. This is what makes
// conquest a LOCAL contest and stops a big empire from projecting its full
// weight onto a far frontier.
function countryProjection(world, country, tx, ty) {
  let sum = 0;
  for (const m of country.members) {
    if (m.mode !== "settled") continue;
    const r = m._projRange || 20;
    const d = dist(world, m.pos.x, m.pos.y, tx, ty);
    if (d > r * 3) continue;        // negligible contribution
    sum += settlementPower(m) * Math.exp(-d / r);
  }
  return sum;
}

// Group settlements into countries, choose each capital (strongest member)
// and tally power. Rebuilt every pass from the persistent s.countryId.
export function rebuildCountries(world) {
  const countries = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    let c = countries.get(s.countryId);
    if (!c) { c = { id: s.countryId, members: [], power: 0, capital: null }; countries.set(s.countryId, c); }
    c.members.push(s);
    c.power += settlementPower(s);
  }
  for (const c of countries.values()) {
    let best = null, bp = -1;
    for (const s of c.members) { s._projRange = projRange(s); const p = settlementPower(s); if (p > bp) { bp = p; best = s; } }
    c.capital = best;
    c.capitalId = best.id;
    c.range = best._projRange;
    c.hue = ((c.id * 61) % 360 + 360) % 360;
  }
  world.countries = countries;
  return countries;
}

export function updatePolities(world) {
  const countries = rebuildCountries(world);
  const borders = world._borders;

  // ── Conquest: each cross-country frontier pair is contested ──
  if (borders) {
    const acted = new Set();
    for (const [aid, neigh] of borders) {
      if (acted.has(aid)) continue;
      const A = world._byId.get(aid);
      if (!A || A.mode !== "settled") continue;
      for (const bid of neigh) {
        if (bid <= aid || acted.has(bid) || acted.has(aid)) continue;
        const B = world._byId.get(bid);
        if (!B || B.mode !== "settled" || A.countryId === B.countryId) continue;
        const CA = countries.get(A.countryId), CB = countries.get(B.countryId);
        if (!CA || !CB) continue;
        // Local force balance at each frontier settlement; defender fights
        // on home ground.
        const aOnB = countryProjection(world, CA, B.pos.x, B.pos.y);
        const bHome = countryProjection(world, CB, B.pos.x, B.pos.y) * HOME_DEFENSE;
        const bOnA = countryProjection(world, CB, A.pos.x, A.pos.y);
        const aHome = countryProjection(world, CA, A.pos.x, A.pos.y) * HOME_DEFENSE;
        const aMargin = aOnB - bHome, bMargin = bOnA - aHome;
        if (aOnB > bHome * CONQUEST_THRESHOLD && aMargin >= bMargin) {
          annex(world, B, CA); acted.add(bid); acted.add(aid); break;
        } else if (bOnA > aHome * CONQUEST_THRESHOLD) {
          annex(world, A, CB); acted.add(aid); acted.add(bid); break;
        }
      }
    }
  }

  // ── Secession: members beyond the capital's hold range break away ──
  for (const c of countries.values()) {
    if (c.members.length <= 1) continue;
    for (const s of c.members) {
      if (s.id === c.capitalId) continue;
      const d = dist(world, c.capital.pos.x, c.capital.pos.y, s.pos.x, s.pos.y);
      if (d > c.range * SECEDE_FACTOR) {
        s.countryId = s.id;
        s.history.push({ step: world.step, type: "seceded" });
      }
    }
  }

  // ── Tribute: members send a slice of spare wealth up to the capital ──
  for (const c of countries.values()) {
    if (c.members.length <= 1) continue;
    for (const s of c.members) {
      if (s.id === c.capitalId || s.countryId !== c.id) continue;
      const give = Math.max(0, (s.wealth || 0)) * TRIBUTE_FRACTION;
      if (give > 0) { s.wealth -= give; c.capital.wealth = (c.capital.wealth || 0) + give; }
    }
  }
}

function annex(world, s, country) {
  s.countryId = country.id;
  s.history.push({ step: world.step, type: "conquered", by: country.id });
}
