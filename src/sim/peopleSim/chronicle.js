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
      if (m.era >= 0 && ERAS[era]) logEvent(world, "era.reached", { polity: c.id, era, eraName: ERAS[era] });
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
  }
}

function fmtCoin(v) {
  return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : "" + (v | 0);
}

// Render a realm's chronicle as plain text lines (probes / exports).
export function chronicleText(world, countryId) {
  return getChronicle(world, countryId).map(e => `[${e.step}] ${e.text}`);
}
