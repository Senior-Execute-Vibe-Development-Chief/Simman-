// ── Per-realm chronicle: a VIEW over the structured event log ──
//
// History is recorded once, structurally, in events.js. This module renders
// a polity's slice of that log as the familiar {step, type, text} lines the
// UI panel shows — narration happens at READ time, from the viewing realm's
// side (a capture narrates as a conquest in one ledger, a loss in the other).
// Nothing here is stored; fallen realms keep their full history because the
// event log never forgets.

import { techState, ERAS } from "./tech.js";
import { logEvent, eventsFor, narrate, categoryOf } from "./events.js";
import { getPolity, ensurePolity } from "./entities.js";
import { IN_MINING, IN_PILGRIM, IN_CARRY, IN_FINANCE, IN_SLAVE_TRADE } from "./money.js";

// Per-settlement "this city became X" milestone flags (s._chronFlags bitmask), so each
// distinctive economy a city grows into is announced once.
const CH_INDUSTRY = 1, CH_HOLY = 2, CH_ENTREPOT = 4, CH_FINANCIER = 8,
      CH_SLAVER = 16, CH_PLANTATION = 32, CH_MINE = 64;

/** A realm's chronicle as render-ready lines (oldest first). */
export function getChronicle(world, countryId, limit = 0) {
  if (countryId == null || countryId < 0) return [];
  const evs = eventsFor(world, "p:" + countryId, limit);
  const out = [];
  for (const ev of evs) {
    out.push({ step: ev.step, type: categoryOf(ev, countryId), text: narrate(world, ev, countryId) });
  }
  return out;
}

// A realm's display name: its persistent entity name (naming service), else
// its capital settlement's name; the stateless frontier reads as itself.
export function realmName(world, countryId) {
  if (countryId == null || countryId < 0) return "the free frontier";
  const p = getPolity(world, countryId);
  if (p && p.name) return p.name;
  const c = world.countries && world.countries.get(countryId);
  if (c && c.capital && c.capital.name) return c.capital.name;
  if (p && p.capitalId != null && world._byId) {
    const cap = world._byId.get(p.capitalId);
    if (cap && cap.name) return cap.name;
  }
  return "realm #" + countryId;
}

// Periodic per-realm milestone checks — the slow-drift events that aren't a
// single discrete moment: a tech era reached, a new peak city count, the
// treasury crossing a power-of-two band. Milestone memory lives on the
// persistent polity record (polity.chron).
export function chronicleTick(world) {
  if (!world.countries) return;
  for (const c of world.countries.values()) {
    if (!c || !c.capital) continue;
    const p = ensurePolity(world, c.id, { silent: true, seat: c.capital });
    if (!p) continue;
    const m = p.chron;

    const era = techState(c.capital.knowledge || {}).era;
    if (era > m.era) {
      if (m.era >= 0 && ERAS[era]) logEvent(world, "era.reached", { polity: c.id, name: realmName(world, c.id), era, eraName: ERAS[era] });
      m.era = era;
    }

    let cities = 0;
    if (c.members) for (const s of c.members) if (s.mode === "settled" && (s.tier | 0) >= 2) cities++;
    if (cities > m.cities) {
      logEvent(world, "growth.cities", { polity: c.id, n: cities });
      m.cities = cities;
    }

    const w = p.treasury || 0;
    if (w > 1000) {
      const band = Math.floor(Math.log2(w / 1000));
      if (band > m.wealthBand) {
        if (m.wealthBand >= 0) logEvent(world, "wealth.milestone", { polity: c.id, band, label: fmtCoin((1 << band) * 1000) });
        m.wealthBand = band;
      }
    }

    // ── Settlement archetypes: the distinctive economy a city grows into (the holy
    // city, the entrepôt, the bankers, the slaver, the plantation, the mining boom,
    // the industry it's renowned for). Fired ONCE per city, attributed to its realm.
    if (c.members) for (const s of c.members) {
      if (s.mode !== "settled" || (s.tier | 0) < 1) continue;
      const fl = s._chronFlags || 0, a = s._mInRate;
      const mark = (bit, type, extra) => {
        if (fl & bit) return;
        s._chronFlags = (s._chronFlags || 0) | bit;
        logEvent(world, type, { polity: s.countryId, s: s.id, sName: s.name, ...extra });
      };
      if ((s._specStr || 0) > 0.55 && s._specKey) mark(CH_INDUSTRY, "industry.specialty", { craft: s._specKey });
      if ((s._cashFrac || 0) > 0.25 && (s._unfree || 0) > 150) mark(CH_PLANTATION, "city.plantation", {});
      if (a) {
        if ((a[IN_PILGRIM]      || 0) > 60)  mark(CH_HOLY,      "city.holy", {});
        if ((a[IN_CARRY]        || 0) > 40)  mark(CH_ENTREPOT,  "city.entrepot", {});
        if ((a[IN_FINANCE]      || 0) > 50)  mark(CH_FINANCIER, "city.financier", {});
        if ((a[IN_SLAVE_TRADE]  || 0) > 25)  mark(CH_SLAVER,    "city.slaver", {});
        if ((a[IN_MINING]       || 0) > 150) mark(CH_MINE,      "mine.boom", {});
      }
    }

    // ── Realm social milestones: serfdom takes hold / is thrown off (the plague fork),
    // the crown's debt spiral, great monuments raised.
    let serfProv = 0, members = 0;
    if (c.members) for (const s of c.members) { if (s.mode !== "settled") continue; members++; if ((s._serf || 0) > 0.35) serfProv++; }
    if (!m.serf && serfProv >= 3 && serfProv >= members * 0.3) { logEvent(world, "society.serfdom", { polity: c.id }); m.serf = 1; }
    else if (m.serf && serfProv === 0 && members > 3) { logEvent(world, "society.emancipation", { polity: c.id }); m.serf = 0; }

    const debt = p._debt || 0;
    if (debt > 2000) { const b = Math.floor(Math.log2(debt / 2000)); if (b > (m.debtBand ?? -1)) { if ((m.debtBand ?? -1) >= 0) logEvent(world, "crown.debt", { polity: c.id, label: fmtCoin(debt) }); m.debtBand = b; } }
    const mon = p._monuments || 0;
    if (mon > 5000) { const b = Math.floor(Math.log2(mon / 5000)); if (b > (m.monBand ?? -1)) { logEvent(world, "realm.monument", { polity: c.id }); m.monBand = b; } }
  }
}

function fmtCoin(v) {
  return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : "" + (v | 0);
}

// Render a realm's chronicle as plain text lines (probes / exports).
export function chronicleText(world, countryId) {
  return getChronicle(world, countryId).map(e => `[${e.step}] ${e.text}`);
}
