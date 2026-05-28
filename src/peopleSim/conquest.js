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

const POLITY_INTERVAL  = 150;   // ticks between polity passes
const SECEDE_FACTOR    = 1.4;   // a member beyond capital range × this is "over-extended"
const SECEDE_GRACE     = 600;   // ticks of sustained over-extension before it actually secedes
const TRIBUTE_FRACTION = 0.06;  // share of a member's wealth sent to the capital each pass
// Hold range (tiles) from the capital's reach techs — how far an empire
// can administer. Grows with organization/mobility/navigation.
const RANGE_BASE = 12, RANGE_ORG = 26, RANGE_MOB = 16, RANGE_NAV = 10;

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
  }
  world.countries = countries;
  return countries;
}

export function updatePolities(world) {
  const countries = rebuildCountries(world);

  for (const c of countries.values()) {
    if (c.members.length <= 1) continue;

    // ── Secession (sticky): break away after sustained over-extension ──
    for (const s of c.members) {
      if (s.id === c.capitalId) { s._disloyalSince = undefined; continue; }
      const d = dist(world, c.capital.pos.x, c.capital.pos.y, s.pos.x, s.pos.y);
      if (d > c.range * SECEDE_FACTOR) {
        if (s._disloyalSince === undefined) s._disloyalSince = world.step;
        if (world.step - s._disloyalSince >= SECEDE_GRACE) {
          s.countryId = s.id;
          s._disloyalSince = undefined;
          if (s.history) s.history.push({ step: world.step, type: "seceded" });
        }
      } else {
        s._disloyalSince = undefined;
      }
    }

    // ── Tribute: members send a slice of wealth up to the capital ──
    for (const s of c.members) {
      if (s.id === c.capitalId || s.countryId !== c.id) continue;
      const give = Math.max(0, s.wealth || 0) * TRIBUTE_FRACTION;
      if (give > 0) { s.wealth -= give; c.capital.wealth = (c.capital.wealth || 0) + give; }
    }
  }
}
