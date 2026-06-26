// ── Dynasties: ruling houses as sampled notable-person graphs ──
//
// No agent simulation — a small genealogy is SAMPLED around each throne:
// rulers age (in calendar years; the step→year mapping compresses early
// eras), marry, have children, and die; succession follows the eldest
// living child, and when the line fails the realm takes a SUCCESSION
// CRISIS — a real legitimacy shock (loyalty/unrest hit) that gives wars
// and collapses human causes instead of purely geometric ones.
//
// Dynastic history BEGINS WITH LITERACY: a polity tracks rulers only once
// its capital's organization crosses the record-keeping threshold — before
// that is the time of legends, exactly like real king-lists. Persons and
// houses are persistent entities; the genealogy is part of the world's
// event log and rides saves.

import { passRng } from "./rng.js";
import { logEvent } from "./events.js";
import { getPolity } from "./entities.js";
import { getCulture, nameFor, dominantCulture } from "./cultures.js";
import { stepToYear, yearToStep } from "../calendar.js";

export const DYNASTY_INTERVAL = 25;     // small pass, runs often (reigns span a few passes)
const LITERACY_MIN = 0.22;              // organization needed for recorded dynastic history
const CROWN_AGE_MIN = 18, CROWN_AGE_SPAN = 22;   // a founder is crowned at 18–40
const FERTILE_MAX = 45;                 // no births past this age
const BIRTH_RATE_Y = 0.30;              // annual chance of a royal birth while married & fertile
const MAX_CHILDREN = 6;
const FOREIGN_MATCH = 0.25;             // chance a royal spouse comes from another court
const CRISIS_LOYALTY_HIT = 0.10;        // members' loyalty shock when the line fails
const CRISIS_UNREST_HIT = 0.18;         // capital unrest spike on a failed succession
const LONG_REIGN_YEARS = 40;            // a reign this long is remembered; ordinary ones aren't chronicled

export function personsOf(world) { return world.persons || (world.persons = new Map()); }
export function dynastiesOf(world) { return world.dynasties || (world.dynasties = new Map()); }
export function getPerson(world, id) { return id >= 0 && world.persons ? world.persons.get(id) || null : null; }
export function getDynasty(world, id) { return id >= 0 && world.dynasties ? world.dynasties.get(id) || null : null; }

export function ageOf(world, person) {
  if (!person) return 0;
  return Math.max(0, stepToYear(world.step) - stepToYear(person.born));
}

function newPerson(world, fields) {
  const id = world._nextPersonId || 1;
  world._nextPersonId = id + 1;
  const p = {
    id, name: null, female: false, born: world.step | 0, died: -1,
    dynastyId: -1, cultureId: -1, parentId: -1, spouseId: -1, children: [],
    ...fields,
  };
  personsOf(world).set(id, p);
  return p;
}

function newDynasty(world, founder, polityId) {
  const id = world._nextDynastyId || 1;
  world._nextDynastyId = id + 1;
  const cul = getCulture(world, founder.cultureId);
  const d = {
    id, cultureId: founder.cultureId,
    name: cul ? nameFor(world, cul, "dynasty", founder.name) : founder.name,
    founderId: founder.id, foundedStep: world.step | 0, endedStep: -1,
  };
  dynastiesOf(world).set(id, d);
  founder.dynastyId = id;
  logEvent(world, "dynasty.founded", {
    dynasty: id, dynastyName: d.name, person: founder.id, personName: founder.name, polity: polityId,
  });
  return d;
}

function bornYearsAgo(world, years) {
  return Math.round(yearToStep(stepToYear(world.step) - years));
}

function makeAdult(world, cultureId, female, rng, ageYears) {
  const cul = getCulture(world, cultureId);
  return newPerson(world, {
    cultureId, female,
    name: cul ? nameFor(world, cul, "person", female ? "f" : "m") : (female ? "Queen" : "King"),
    born: bornYearsAgo(world, ageYears ?? (CROWN_AGE_MIN + rng() * CROWN_AGE_SPAN)),
  });
}

function marry(world, ruler, polityId, rng) {
  if (ruler.spouseId >= 0) return;
  if (ageOf(world, ruler) < 16) return;   // a child sovereign reigns under regents — no match yet
  // A royal match: usually local nobility, sometimes another court — the
  // union is recorded between the REALMS (kin ties are history, and the
  // historiography layer can make much of them).
  let spouse = null, tiePolity = -1;
  if (rng() < FOREIGN_MATCH && world._royalCourt && world._royalCourt.length) {
    const courts = world._royalCourt.filter(([ch, pid]) =>
      pid !== polityId && ch.died < 0 && ch.spouseId < 0 && ch.female !== ruler.female);
    if (courts.length) [spouse, tiePolity] = courts[rng.int(courts.length)];
  }
  if (!spouse) spouse = makeAdult(world, ruler.cultureId, !ruler.female, rng, 16 + rng() * 14);
  ruler.spouseId = spouse.id; spouse.spouseId = ruler.id;
  if (tiePolity >= 0) {
    logEvent(world, "dynasty.union", {
      polity: polityId, to: tiePolity,
      person: ruler.id, personName: ruler.name,
      s2: undefined, person2: spouse.id, person2Name: spouse.name,
      dynasty: ruler.dynastyId,
    });
  }
}

function crown(world, polity, person, c, how) {
  polity.rulerId = person.id;
  polity._reignSince = world.step;
  if (person.dynastyId < 0) newDynasty(world, person, polity.id);
  polity.dynastyId = person.dynastyId;
  const d = getDynasty(world, person.dynastyId);
  // Only dynasty-founding moments are individually chronicled — a new house at
  // first literacy ("first") or a new house raised after the old line collapsed
  // ("crisis"). Ordinary successions within an established line are not notable
  // enough to record; the realm's memory keeps to founders and great reigns.
  if (how === "first" || how === "crisis") {
    logEvent(world, "ruler.crowned", {
      polity: polity.id, name: polity.name,
      person: person.id, personName: person.name, female: person.female ? 1 : 0,
      dynasty: person.dynastyId, dynastyName: d ? d.name : undefined,
      age: Math.round(ageOf(world, person)), how,
    });
  }
  void c;
}

// Succession chain: eldest living child of age (sons before daughters —
// male-preference primogeniture; doctrine variation is a future lever),
// else a child regency, else the late ruler's eldest living sibling.
// Only when the whole house is bare does the realm fall into crisis.
function heirOf(world, ruler) {
  const rank = (arr) => {
    const ps = arr.map(id => getPerson(world, id)).filter(p => p && p.died < 0);
    ps.sort((a, b) => (a.female === b.female) ? a.born - b.born : (a.female ? 1 : -1));
    return ps;
  };
  const kids = rank(ruler.children || []);
  const adult = kids.find(k => ageOf(world, k) >= 14);
  if (adult) return { heir: adult, how: "succession" };
  if (kids.length) return { heir: kids[0], how: "regency" };
  if (ruler.parentId >= 0) {
    const parent = getPerson(world, ruler.parentId);
    if (parent) {
      const sibs = rank((parent.children || []).filter(id => id !== ruler.id));
      const sib = sibs.find(k => ageOf(world, k) >= 14);
      if (sib) return { heir: sib, how: "sibling" };
    }
  }
  return null;
}

export function updateDynasties(world) {
  if (!world.countries) return;
  const rng = passRng(world, "dynasty");
  // Years elapsed since the last pass — the step→year mapping compresses
  // early eras, so every per-pass rate below is computed from ANNUAL hazards
  // raised to this span. One pass can be 30 years in the bronze age and one
  // year in the industrial age; rulers live human lives either way.
  const ivl = Math.max(1, Math.round(DYNASTY_INTERVAL * Math.max(1, (world._dt ? 1 / world._dt : 1))));
  const years = Math.max(0.05, stepToYear(world.step) - stepToYear(world.step - ivl));
  const over = (annual) => 1 - Math.pow(1 - Math.min(0.95, annual), years);
  // royal marriage market, computed once per pass (not per bachelor ruler)
  const court = [];
  for (const c0 of world.countries.values()) {
    const op = getPolity(world, c0.id);
    if (!op || op.rulerId == null || op.rulerId < 0) continue;
    const or = getPerson(world, op.rulerId);
    if (!or) continue;
    for (const cid0 of or.children || []) {
      const ch = getPerson(world, cid0);
      if (ch && ch.died < 0 && ch.spouseId < 0 && ageOf(world, ch) >= 16) court.push([ch, c0.id]);
    }
  }
  world._royalCourt = court;
  // stable iteration: by polity id
  const ids = [...world.countries.keys()].sort((a, b) => a - b);
  for (const cid of ids) {
    const c = world.countries.get(cid);
    const polity = getPolity(world, cid);
    if (!polity || polity.endedStep >= 0 || !c || !c.capital) continue;
    const org = (c.capital.knowledge && c.capital.knowledge.organization) || 0;
    if (org < LITERACY_MIN) continue;          // the time of legends — no records yet

    let ruler = polity.rulerId >= 0 ? getPerson(world, polity.rulerId) : null;
    if (ruler && ruler.died >= 0) ruler = null;

    // an empty throne: found a house (first literacy, or after a crisis)
    if (!ruler) {
      const culId = dominantCulture(c.capital);
      const person = makeAdult(world, culId, rng() < 0.12, rng);
      crown(world, polity, person, c, polity.dynastyId >= 0 ? "crisis" : "first");
      continue;
    }

    // marriage + heirs
    marry(world, ruler, cid, rng);
    const spouse = getPerson(world, ruler.spouseId);
    const rAge = ageOf(world, ruler);
    if (spouse && spouse.died < 0 && (ruler.children || []).length < MAX_CHILDREN) {
      const mAge = ruler.female ? rAge : ageOf(world, spouse);
      if (mAge <= FERTILE_MAX && rng() < over(BIRTH_RATE_Y)) {
        const child = newPerson(world, {
          cultureId: ruler.cultureId, female: rng() < 0.5,
          parentId: ruler.id, dynastyId: ruler.dynastyId,
        });
        const cul = getCulture(world, child.cultureId);
        child.name = cul ? nameFor(world, cul, "person", child.female ? "f" : "m") : "Heir";
        ruler.children.push(child.id);
      }
    }

    // mortality: annual hazard by age (Gompertz-ish), compounded over the
    // pass's span in years; plague in the capital multiplies the hazard
    const hazard = rAge < 50 ? 0.008 : rAge < 65 ? 0.035 : rAge < 80 ? 0.10 : 0.25;
    let pDeath = over(c.capital._plagueActive ? Math.min(0.9, hazard * 3 + 0.05) : hazard);
    if (rng() < pDeath) {
      ruler.died = world.step | 0;
      // A death is chronicled only when the reign was long enough to be
      // remembered — the great monarchs. Ordinary deaths pass unrecorded;
      // a death that ends the dynasty is captured by the crisis events below.
      const reignY = Math.round(stepToYear(world.step) - stepToYear(polity._reignSince ?? ruler.born));
      if (reignY >= LONG_REIGN_YEARS) {
        logEvent(world, "ruler.died", {
          polity: cid, name: polity.name, person: ruler.id, personName: ruler.name,
          dynasty: ruler.dynastyId, age: Math.round(rAge), reign: reignY,
        });
      }
      const succ = heirOf(world, ruler);
      if (succ) {
        crown(world, polity, succ.heir, c, succ.how);
      } else {
        // the line fails — succession crisis: legitimacy shock, new house next pass
        const d = getDynasty(world, ruler.dynastyId);
        if (d && d.endedStep < 0) {
          d.endedStep = world.step | 0;
          logEvent(world, "dynasty.extinct", { dynasty: d.id, dynastyName: d.name, polity: cid, name: polity.name });
        }
        polity.rulerId = -1;
        polity._crisisAt = world.step;
        logEvent(world, "succession.crisis", { polity: cid, name: polity.name, dynasty: ruler.dynastyId });
        for (const m of c.members) {
          if (m.id === c.capitalId) continue;
          m.loyalty = Math.max(0, (m.loyalty ?? 1) - CRISIS_LOYALTY_HIT * (0.5 + rng()));
        }
        c.capital.unrest = Math.min(1, (c.capital.unrest || 0) + CRISIS_UNREST_HIT);
      }
    }
  }
}

// Deterministic helper for war-cause annotation (armies.js): was this realm
// in a succession crisis recently?
export function inCrisis(world, polityId, window = 600) {
  const p = getPolity(world, polityId);
  return !!(p && p._crisisAt != null && world.step - p._crisisAt < window / (world._dt || 1));
}
