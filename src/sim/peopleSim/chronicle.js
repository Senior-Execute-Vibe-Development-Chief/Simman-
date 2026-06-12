// ── Per-country chronicle ─────────────────────────────────────────────
// A plain-text blow-by-blow of each realm's history: founding, wars, conquests,
// secessions, plagues, famines, discoveries, and growth/wealth milestones.
//
// Stored PERSISTENTLY in world._chronicles keyed by countryId — the country
// OBJECTS in world.countries are rebuilt every polity pass (conquest.js), so the
// log cannot live on them. When a realm is conquered its chronicle is archived
// (world._deadChronicles) so fallen empires keep their story.

import { techState, ERAS } from "./tech.js";

const MAX_ENTRIES = 250;    // cap a living realm's log (a millennia-old empire would otherwise grow unbounded)
const DEDUP_WINDOW = 1200;  // steps within which an identical line is treated as the same event (border flicker re-captures the same town; a plague wave re-fires for a few hundred steps)
const MAX_DEAD = 240;       // cap the archive of fallen realms — over a long run thousands of micro-states rise and fall, so keep only the most recent

// Append one event to a realm's chronicle. `type` is a category (founding / war /
// conquest / secession / plague / famine / discovery / growth / wealth / end) for
// colour-coding; `text` is the human-readable line. De-dupes near-identical
// repeats so a per-pass event can't spam the log.
export function chronicle(world, countryId, type, text) {
  if (countryId == null || countryId < 0) return;
  if (!world._chronicles) world._chronicles = new Map();
  let log = world._chronicles.get(countryId);
  if (!log) { log = []; world._chronicles.set(countryId, log); }
  // De-dupe: skip if the same line was logged within DEDUP_WINDOW steps. Scan
  // back over recent entries (not just the last) so an identical line still
  // collapses when other events interleave — border flicker re-grabbing the
  // same town, or a plague wave re-firing, shouldn't spam the log.
  const now = world.step | 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (now - e.step > DEDUP_WINDOW) break;
    if (e.type === type && e.text === text) return;
  }
  log.push({ step: now, type, text });
  if (log.length > MAX_ENTRIES) log.shift();
}

export function getChronicle(world, countryId) {
  return (world._chronicles && world._chronicles.get(countryId)) || [];
}

// A realm's display name = its capital settlement's name; the stateless frontier
// (countryId < 0) reads as "the free frontier"; else "realm #id".
export function realmName(world, countryId) {
  if (countryId == null || countryId < 0) return "the free frontier";
  const c = world.countries && world.countries.get(countryId);
  if (c && c.capital && c.capital.name) return c.capital.name;
  return "realm #" + countryId;
}

// Archive a conquered realm's chronicle so its history survives its fall.
export function archiveChronicle(world, countryId, finalNote) {
  const log = world._chronicles && world._chronicles.get(countryId);
  if (!log || !log.length) return;
  if (finalNote) log.push({ step: world.step | 0, type: "end", text: finalNote });
  if (!world._deadChronicles) world._deadChronicles = [];
  world._deadChronicles.push({ countryId, name: realmName(world, countryId), log });
  if (world._deadChronicles.length > MAX_DEAD) world._deadChronicles.splice(0, world._deadChronicles.length - MAX_DEAD);
  world._chronicles.delete(countryId);
  if (world._chronMeta) world._chronMeta.delete(countryId);
}

// Periodic per-realm checks for the events that aren't a single discrete moment:
// a discovery (the capital's tech era advancing), a growth milestone (a new peak
// city count), and a wealth milestone (treasury crossing a new power-of-two
// band). Throttled by the caller (index.js); drifts slowly so coarse is fine.
export function chronicleTick(world) {
  if (!world.countries) return;
  if (!world._chronMeta) world._chronMeta = new Map();
  for (const c of world.countries.values()) {
    if (!c || !c.capital) continue;
    const cid = c.id;
    let m = world._chronMeta.get(cid);
    if (!m) { m = { era: -1, cities: 0, wealthBand: -1 }; world._chronMeta.set(cid, m); }

    // Discovery — the capital's highest tech era.
    const era = techState(c.capital.knowledge || {}).era;
    if (era > m.era) {
      if (m.era >= 0 && ERAS[era]) chronicle(world, cid, "discovery", `Reached the ${ERAS[era]} era.`);
      m.era = era;
    }

    // Growth — a new peak in CITY count (tier ≥ 2).
    let cities = 0;
    if (c.members) for (const s of c.members) if (s.mode === "settled" && (s.tier | 0) >= 2) cities++;
    if (cities > m.cities) {
      chronicle(world, cid, "growth", cities === 1 ? "Its first city rose." : `Grew to ${cities} cities.`);
      m.cities = cities;
    }

    // Wealth — treasury crossing a new power-of-two band (10k, 20k, 40k …).
    const w = c._treasury || 0;
    if (w > 1000) {
      const band = Math.floor(Math.log2(w / 1000));
      if (band > m.wealthBand) {
        if (m.wealthBand >= 0) chronicle(world, cid, "wealth", `Treasury swelled past ${fmtCoin((1 << band) * 1000)}.`);
        m.wealthBand = band;
      }
    }
  }
}

function fmtCoin(v) {
  return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : "" + (v | 0);
}

// Render a realm's chronicle as plain text lines (for a probe / export / tooltip).
export function chronicleText(world, countryId) {
  const log = getChronicle(world, countryId);
  return log.map(e => `[${e.step}] ${e.text}`);
}
