// ── Dynasties: ruling HOUSES as living kin graphs, and how realms are ruled ──
//
// No agent simulation — a genealogy is SAMPLED around each throne and grows
// into a real house: the monarch and cadets marry, breed, and die; siblings,
// nieces, nephews, cousins and the occasional bastard all sit in the tree and
// all hold a claim. Succession follows the realm's LAW (agnatic, male-preference
// or absolute primogeniture) over the whole house with representation; only
// when the entire house is bare does the realm fall into a SUCCESSION CRISIS — a
// real legitimacy shock that gives wars and collapses human causes.
//
// How a realm is ruled EMERGES from what it has become, never from the calendar:
//   • THEOCRACY  when a strong, hierarchical state faith dominates the capital —
//                rule passes to the priesthood (selection, not blood).
//   • REPUBLIC   when a literate, commercial realm has no single dominant city —
//                the office is ELECTED, and great houses alternate in it.
//   • MONARCHY   otherwise — hereditary rule, the default across the world.
// Men rule by default everywhere; women reign when the law admits them (absolute
// primogeniture, or male-preference with no male heir left, or an egalitarian
// republic) — never under agnatic (Salic) law.
//
// Dynastic history BEGINS WITH LITERACY: a polity tracks rulers only once its
// capital's organization crosses the record-keeping threshold — before that is
// the time of legends. Persons and houses are persistent entities; the whole
// genealogy rides saves (serialized verbatim with the world).

import { passRng } from "./rng.js";
import { logEvent } from "./events.js";
import { getPolity } from "./entities.js";
import { getCulture, nameFor, dominantCulture } from "./cultures.js";
import { getFaith, dominantFaith } from "./faiths.js";
import { stepToYear, yearToStep } from "../calendar.js";

export const DYNASTY_INTERVAL = 25;     // small pass, runs often (reigns span a few passes)
const LITERACY_MIN = 0.22;              // organization needed for recorded dynastic history
const CROWN_AGE_MIN = 18, CROWN_AGE_SPAN = 22;   // a founder is crowned at 18–40
const FERTILE_MAX = 45;                 // no births past this age
const BIRTH_RATE_Y = 0.30;              // annual chance of a royal birth while married & fertile
const CADET_BIRTH_Y = 0.22;             // annual birth chance for a married cadet branch
const BASTARD_RATE_Y = 0.018;           // annual chance the monarch sires an acknowledged bastard
const MAX_CHILDREN = 8;
const MAX_HOUSE = 28;                    // living blood-members tracked per house (collateral cap)
const FOREIGN_MATCH = 0.25;             // chance a royal spouse comes from another court
const CRISIS_LOYALTY_HIT = 0.10;        // members' loyalty shock when the line fails
const CRISIS_UNREST_HIT = 0.18;         // capital unrest spike on a failed succession
const DISPUTE_UNREST_HIT = 0.06;        // smaller spike when a contested heir takes the throne
const LONG_REIGN_YEARS = 40;            // a reign this long is remembered; ordinary ones aren't chronicled

// ── mortality (sampled lifespans) ───────────────────────────────────────────
// Each person is dealt an age-at-death ONCE, at birth, from an era-appropriate
// distribution: heavy infant/child mortality, then an adult span in the 50s–60s
// with a long tail. A person dies the pass they reach it. (Sampling once avoids
// the trap of compounding an annual hazard over a 30-year early-era pass, which
// would kill almost every child before its line could branch.) Medicine and
// sanitation — read off the realm's DEVELOPMENT, not the year — lift childhood
// survival and lengthen adult life, so houses deepen as a civilization matures.
const MATERNAL_HAZARD = 0.06;           // mother's death per birth (acute, rolled at the birth)
const PLAGUE_HAZARD_Y = 0.05;           // annual extra death hazard for kin in a plague-struck capital
const HEALTH_DEV_W    = 0.55;           // how far development can cut mortality

// ── Character: the traits a ruler is born with, and what they earn ───────────
// Four axes in [-1, 1]: vigor (health → long life, many children), wit (shrewd
// rule → development & order), boldness (courage → wars of choice), ruthlessness
// (an iron grip → fewer revolts). A house's FOUNDER rises on merit and is dealt a
// capable hand; each generation REGRESSES toward the random mean, so the
// founder's edge washes out down the line (kept ~40% per generation).
const TRAIT_KEYS = ["vigor", "wit", "boldness", "ruthlessness"];
function clampT(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }
function sampleTraits(rng, kind, parent) {
  const t = {};
  for (const key of TRAIT_KEYS) {
    let v;
    if (kind === "founder") v = 0.2 + rng() * 0.7;                 // capable: ~0.2…0.9
    else if (kind === "child" && parent && parent.traits) v = (parent.traits[key] || 0) * 0.4 + (rng() * 2 - 1) * 0.55;
    else v = (rng() * 2 - 1) * 0.7;                                // an ordinary newcomer, mean 0
    t[key] = clampT(v);
  }
  return t;
}

// A short descriptor of a living ruler's most pronounced bent (for the card).
export function traitLabel(t) {
  if (!t) return null;
  const picks = [];
  if (t.vigor <= -0.45) picks.push("sickly"); else if (t.vigor >= 0.55) picks.push("hale");
  if (t.wit >= 0.5) picks.push("shrewd"); else if (t.wit <= -0.45) picks.push("dull");
  if (t.boldness >= 0.5) picks.push("bold"); else if (t.boldness <= -0.45) picks.push("timid");
  if (t.ruthlessness >= 0.55) picks.push("ruthless"); else if (t.ruthlessness <= -0.5) picks.push("gentle");
  return picks.slice(0, 2).join(", ") || "even-tempered";
}

// The epithet a ruler is remembered by — earned from WHAT THEY DID (reign length,
// realms won or lost, wars, monuments) tempered by their nature. Assigned at death.
function epithetFor(ruler, polity, reignY, citiesDelta, gov) {
  const t = ruler.traits || {};
  const wars = polity._reignWars || 0;
  const monBuilt = (polity._monuments || 0) - (polity._reignMon0 || 0);
  if (t.vigor <= -0.45 && reignY < 18) return "the Sickly";
  if (reignY >= 35 && citiesDelta >= 2 && (t.wit || 0) > 0.15) return "the Great";
  if (citiesDelta >= 3 || (wars >= 4 && citiesDelta >= 1)) return "the Conqueror";
  if (citiesDelta <= -3) return "the Unready";
  if ((t.ruthlessness || 0) >= 0.5 && (wars >= 3 || citiesDelta < 0 || (t.wit || 0) < -0.1)) return "the Terrible";
  if ((t.wit || 0) >= 0.5) return "the Wise";
  if ((t.boldness || 0) <= -0.45 && citiesDelta < 0) return "the Coward";
  if ((t.boldness || 0) >= 0.55 && wars >= 2) return "the Bold";
  if (gov === GOV_THEOCRACY) return "the Pious";
  if (monBuilt > 2000) return "the Builder";
  if ((t.vigor || 0) >= 0.5) return "the Hale";
  if ((t.wit || 0) <= -0.45) return "the Foolish";
  if (reignY >= 55) return "the Old";                    // only exceptional longevity, else a bland nickname
  // an unremarkable reign — a bland or unkind nickname (varied, deterministic by id)
  const dull = ["the Bland", "the Fat", "the Quiet", "the Idle", "the Unremarkable", "the Plain", "the Lesser"];
  return dull[Math.abs((ruler.id * 2654435761) | 0) % dull.length];
}

function countCities(c) {
  let n = 0;
  if (c && c.members) for (const s of c.members) if (s.mode === "settled" && (s.tier | 0) >= 2) n++;
  return n;
}
// A ruler's character, projected onto the levers other passes read (refreshed each
// pass on the country record): boldness → wars of choice, wit → development & order,
// wit+ruthlessness → an extra grip on unrest. Neutral (1, 0) during an interregnum.
function applyRulerMods(c, ruler) {
  const t = (ruler && ruler.traits) || null;
  if (!t) { c._rulerWar = 1; c._rulerWit = 1; c._rulerRelief = 0; return; }
  c._rulerWar = 1 + (t.boldness || 0) * 0.30;                                  // 0.70 … 1.30
  c._rulerWit = 1 + (t.wit || 0) * 0.15;                                       // 0.85 … 1.15
  c._rulerRelief = ((t.wit || 0) * 0.5 + (t.ruthlessness || 0) * 0.5) * 0.013; // ±0.013 unrest relief
}
function vigorFertility(p) {
  const v = (p && p.traits && p.traits.vigor) || 0;
  return 0.7 + 0.6 * ((v + 1) / 2);            // sickly 0.7 … hale 1.3
}

// mortF: 1 at low development → ~0.45 when highly developed. Drives both
// childhood death share and the adult mean.
function sampleLifespan(rng, mortF, adultOnly) {
  if (!adultOnly) {
    const childDeath = 0.30 * mortF;                 // up to ~30% die before 15 at low dev
    if (rng() < childDeath) return Math.floor(rng() * rng() * 15);   // 0–14, infant-weighted
  }
  const adultMean = 56 + (1 - mortF) * 14;           // ~56 (harsh) … ~64 (developed)
  const spread = (rng() + rng() + rng() - 1.5) * 14; // ~normal, ±
  const v = Math.round(adultMean + spread);
  return v < 16 ? 16 : v > 96 ? 96 : v;
}

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
    bastard: false, foreign: false, reignFrom: -1, reignTo: -1, lifespan: -1,
    traits: null, epithet: null,
    ...fields,
  };
  personsOf(world).set(id, p);
  return p;
}

// Add a blood member to its house roster (living members only; the dead stay in
// the persons map for the tree but leave the active roster).
function enroll(world, person) {
  const d = getDynasty(world, person.dynastyId);
  if (!d) return;
  if (!d.members) d.members = [];
  if (!d.members.includes(person.id)) d.members.push(person.id);
}

function newDynasty(world, founder, polityId) {
  const id = world._nextDynastyId || 1;
  world._nextDynastyId = id + 1;
  const cul = getCulture(world, founder.cultureId);
  const d = {
    id, cultureId: founder.cultureId,
    name: cul ? nameFor(world, cul, "dynasty", founder.name) : founder.name,
    founderId: founder.id, foundedStep: world.step | 0, endedStep: -1,
    members: [],   // living blood members (the claim pool)
    inlaws: [],    // married-in partners (reaped here, never claimants)
  };
  dynastiesOf(world).set(id, d);
  founder.dynastyId = id;
  enroll(world, founder);
  logEvent(world, "dynasty.founded", {
    dynasty: id, dynastyName: d.name, person: founder.id, personName: founder.name, polity: polityId,
  });
  return d;
}

function bornYearsAgo(world, years) {
  return Math.round(yearToStep(stepToYear(world.step) - years));
}

function makeAdult(world, cultureId, female, rng, ageYears, extra, mortF = 0.78, traitKind = "random") {
  const cul = getCulture(world, cultureId);
  const age = ageYears ?? (CROWN_AGE_MIN + rng() * CROWN_AGE_SPAN);
  const traits = sampleTraits(rng, traitKind, null);
  // an adult already survived childhood — sample an adult-only span (vigour shifts
  // it), no shorter than their current age
  let life = sampleLifespan(rng, mortF, true) + Math.round((traits.vigor || 0) * 14);
  if (life < age + 1) life = Math.round(age + 1 + rng() * 20);
  return newPerson(world, {
    cultureId, female,
    name: cul ? nameFor(world, cul, "person", female ? "f" : "m") : (female ? "Queen" : "King"),
    born: bornYearsAgo(world, age), lifespan: life, traits,
    ...extra,
  });
}

// A spouse marries IN: not blood of the house, carries no claim (foreign flag),
// but their children with a house member are full members.
function wed(world, a, b, polityId, tiePolity, rng) {
  a.spouseId = b.id; b.spouseId = a.id;
  // a generated, ownerless partner is tracked as an in-law of the blood spouse's
  // house so it can be reaped (royal matches from a foreign court die on their own
  // house's roster instead).
  if (b.foreign && a.dynastyId >= 0) {
    const d = getDynasty(world, a.dynastyId);
    if (d) { if (!d.inlaws) d.inlaws = []; d.inlaws.push(b.id); }
  }
  if (tiePolity >= 0 && tiePolity !== polityId) {
    logEvent(world, "dynasty.union", {
      polity: polityId, to: tiePolity,
      person: a.id, personName: a.name,
      s2: undefined, person2: b.id, person2Name: b.name,
      dynasty: a.dynastyId,
    });
  }
}

function marry(world, person, polityId, rng, isRuler, mortF) {
  if (person.spouseId >= 0) return;
  if (ageOf(world, person) < 16) return;   // a child reigns under regents — no match yet
  let spouse = null, tiePolity = -1;
  // Only the reigning monarch reaches abroad for a foreign match (a state union);
  // cadets marry locally.
  if (isRuler && rng() < FOREIGN_MATCH && world._royalCourt && world._royalCourt.length) {
    const courts = world._royalCourt.filter(([ch, pid]) =>
      pid !== polityId && ch.died < 0 && ch.spouseId < 0 && ch.female !== person.female);
    if (courts.length) [spouse, tiePolity] = courts[rng.int(courts.length)];
  }
  if (!spouse) {
    spouse = makeAdult(world, person.cultureId, !person.female, rng, 16 + rng() * 14, { foreign: true }, mortF);
  }
  wed(world, person, spouse, polityId, tiePolity, rng);
}

function birth(world, parent, rng, bastard, mortF) {
  const traits = sampleTraits(rng, "child", parent);
  let life = sampleLifespan(rng, mortF ?? 0.78, false) + Math.round((traits.vigor || 0) * 14);
  if (life < 0) life = 0;
  const child = newPerson(world, {
    cultureId: parent.cultureId, female: rng() < 0.5,
    parentId: parent.id, dynastyId: parent.dynastyId, bastard: !!bastard,
    lifespan: life, traits,
  });
  const cul = getCulture(world, child.cultureId);
  child.name = cul ? nameFor(world, cul, "person", child.female ? "f" : "m") : "Heir";
  parent.children.push(child.id);
  enroll(world, child);
  return child;
}

// ── Governance: derive how a realm is ruled from its STATE ───────────────────
// All scores read current development, faith and economy. Hysteresis (a sticky
// counter on the polity) keeps a realm from flickering between forms.
const GOV_MONARCHY = "monarchy", GOV_THEOCRACY = "theocracy", GOV_REPUBLIC = "republic";
const LAW_AGNATIC = "agnatic", LAW_MALE_PREF = "male-pref", LAW_ABSOLUTE = "absolute";
const GOV_SWITCH_PASSES = 3;            // a new form must win this many passes running to take hold

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function deriveTarget(world, c, polity) {
  const cap = c.capital;
  const k = (cap && cap.knowledge) || {};
  const org = k.organization || 0;
  const pers = polity.personality || {};
  const aggr01 = clamp01(((pers.aggression || 0) + 1) / 2);
  const comm01 = clamp01(((pers.commerce || 0) + 1) / 2);

  // THEOCRACY — a dominant, hierarchical, zealous state faith at the capital.
  let theoScore = 0;
  const faith = polity.faithId >= 0 ? getFaith(world, polity.faithId) : null;
  if (faith && faith.doctrine && dominantFaith(cap) === polity.faithId) {
    const share = (cap.faithMix && cap.faithMix.length) ? cap.faithMix[0][1] : 0;
    const d = faith.doctrine;
    theoScore = share * (0.35 + 0.65 * (d.hierarchy || 0)) * (0.5 + 0.5 * (d.zeal || 0));
  }

  // REPUBLIC — literate, commercial, and POLYCENTRIC (no single dominant city).
  let cities = 0, totalPop = 0, capPop = cap ? (cap.people || 0) : 0;
  if (c.members) for (const s of c.members) {
    if (s.mode !== "settled") continue;
    totalPop += s.people || 0;
    if ((s.tier | 0) >= 2) cities++;
  }
  const primacy = totalPop > 0 ? capPop / totalPop : 1;     // 1 = one city holds everyone
  const orgF = clamp01((org - 0.45) / 0.35);                // needs codes-of-law / currency era
  let repScore = 0;
  if (cities >= 2 && orgF > 0) {
    repScore = comm01 * (1 - primacy) * orgF * (0.5 + 0.5 * (1 - aggr01));
  }

  let gov = GOV_MONARCHY;
  if (theoScore >= 0.42 && theoScore >= repScore) gov = GOV_THEOCRACY;
  else if (repScore >= 0.28) gov = GOV_REPUBLIC;

  // Succession law — who may inherit.
  const militancy = faith && faith.doctrine ? (faith.doctrine.militancy || 0) : 0;
  let law = LAW_MALE_PREF;
  if (aggr01 > 0.68 || militancy > 0.7) law = LAW_AGNATIC;        // martial realms: Salic, men only
  else if (gov === GOV_REPUBLIC || (comm01 > 0.6 && aggr01 < 0.42)) law = LAW_ABSOLUTE;  // egalitarian
  return { gov, law };
}

function updateGovernance(world, c, polity) {
  const t = deriveTarget(world, c, polity);
  polity.succLaw = t.law;                       // law tracks state immediately (cheap, no flicker risk)
  if (polity.gov == null) { polity.gov = t.gov; polity._govPush = 0; return; }
  if (t.gov === polity.gov) { polity._govPush = 0; return; }
  // a different form is pulling — it must persist before it takes hold
  if (polity._govTarget === t.gov) polity._govPush = (polity._govPush || 0) + 1;
  else { polity._govTarget = t.gov; polity._govPush = 1; }
  if (polity._govPush >= GOV_SWITCH_PASSES) {
    const from = polity.gov;
    polity.gov = t.gov; polity._govPush = 0; polity._govTarget = null;
    logEvent(world, "gov.changed", { polity: c.id, name: polity.name, from, to: t.gov });
    // retitle the sitting ruler under the new order
    const r = polity.rulerId >= 0 ? getPerson(world, polity.rulerId) : null;
    if (r) r._title = titleFor(polity.gov, r.female);
  }
}

function titleFor(gov, female) {
  if (gov === GOV_THEOCRACY) return female ? "High Priestess" : "High Priest";
  if (gov === GOV_REPUBLIC) return female ? "Consul" : "Consul";
  return female ? "Queen" : "King";
}

// ── Succession by law: claim ranking over the whole house ────────────────────
function eligible(world, p, law, allowBastard) {
  if (!p || p.died >= 0) return false;
  if (p.bastard && !allowBastard) return false;
  if (law === LAW_AGNATIC && p.female) return false;
  return true;
}

// Order a set of siblings by the realm's law, then by seniority (oldest first).
function orderSibs(kids, law) {
  return kids.slice().sort((a, b) => {
    if (law !== LAW_ABSOLUTE && a.female !== b.female) return a.female ? 1 : -1;  // males first
    return a.born - b.born;                                                       // older first
  });
}

// Depth-first heir search within the subtree rooted at `node`, in primogeniture
// order WITH REPRESENTATION (a deceased member's issue take the member's place
// before passing to the next sibling). Returns the first eligible person found,
// or, failing an eligible adult, the first eligible minor for a regency.
function searchLine(world, node, skipChildId, law, allowBastard, out) {
  const kids = (node.children || [])
    .map(id => getPerson(world, id))
    .filter(p => p && p.id !== skipChildId);
  for (const child of orderSibs(kids, law)) {
    if (eligible(world, child, law, allowBastard)) {
      if (ageOf(world, child) >= 14) { out.adult = child; return true; }
      if (!out.minor) out.minor = child;        // remember the senior minor for regency
    }
    // representation: descend the (possibly deceased) child's own line next
    if (searchLine(world, child, -1, law, allowBastard, out)) return true;
  }
  return false;
}

// The heir under the realm's law: the late ruler's own line first, then siblings
// and their issue (nieces/nephews), then the grandparent's line (uncles/cousins),
// then anyone left in the house. Bastards are considered only if no legitimate
// claimant remains anywhere.
function heirByLaw(world, ruler, dyn, law) {
  for (const allowBastard of [false, true]) {
    const out = { adult: null, minor: null };
    // climb up to two ancestors, searching ever-wider collateral lines
    let node = ruler, skip = -1, depth = 0;
    while (node && depth < 3) {
      searchLine(world, node, skip, law, allowBastard, out);
      if (out.adult) {
        const how = depth === 0 ? "succession" : depth === 1 ? "sibling" : "collateral";
        // an orderly accession even through a cadet line is not a crisis; only a
        // resort to a legitimised bastard is genuinely disputed
        return { heir: out.adult, how, contested: allowBastard };
      }
      skip = node.id;
      node = node.parentId >= 0 ? getPerson(world, node.parentId) : null;
      depth++;
    }
    // last resort within this legitimacy pass: any living house member
    if (dyn && dyn.members) {
      const pool = dyn.members.map(id => getPerson(world, id))
        .filter(p => eligible(world, p, law, allowBastard));
      if (pool.length) {
        const sorted = orderSibs(pool, law);
        const adult = sorted.find(p => ageOf(world, p) >= 14);
        if (adult) return { heir: adult, how: "collateral", contested: true };
        if (!out.minor) out.minor = sorted[0];
      }
    }
    if (out.minor) {
      const how = allowBastard ? "bastard" : "regency";
      return { heir: out.minor, how, contested: true, minor: true };
    }
  }
  return null;
}

// Theocracy: the office passes to the priesthood, not the blood. A senior elder
// of the ruling house usually takes the mitre (continuity), but now and then a
// "new man" rises and founds a new sacerdotal line. Women only where the law and
// a non-militant faith allow.
function selectTheocrat(world, c, polity, dyn, law, rng) {
  const faith = polity.faithId >= 0 ? getFaith(world, polity.faithId) : null;
  const womenOk = law === LAW_ABSOLUTE && (!faith || !faith.doctrine || (faith.doctrine.militancy || 0) < 0.4);
  const elders = dyn && dyn.members
    ? dyn.members.map(id => getPerson(world, id)).filter(p =>
        p && p.died < 0 && ageOf(world, p) >= 35 && (womenOk || !p.female))
    : [];
  if (elders.length && rng() < 0.7) {
    elders.sort((a, b) => a.born - b.born);     // the eldest — priesthoods favour age
    return { person: elders[0], fresh: false };
  }
  // a new man from the priesthood, crowned late in life — adopted INTO the
  // continuing sacred house (the temple endures even when the office isn't blood)
  const culId = dominantCulture(c.capital);
  const person = makeAdult(world, culId, womenOk && rng() < 0.12, rng, 38 + rng() * 18, undefined, 0.78, "founder");
  return { person, fresh: true };
}

// Republic: the magistracy is ELECTED for life; great houses put forward elders
// and alternate in the office. Modelled as a weighted draw over candidate houses
// (the sitting house is disfavoured — incumbents rarely keep it in the family),
// with fresh notables entering the lists too.
function selectElected(world, c, polity, rng) {
  const law = polity.succLaw || LAW_MALE_PREF;
  const womenOk = law === LAW_ABSOLUTE;
  const cands = [];
  // elders of every house currently seated in the realm (members carry dynastyId)
  const seen = new Set();
  if (world.dynasties) {
    for (const d of world.dynasties.values()) {
      if (d.endedStep >= 0 || d.cultureId !== polity.cultureId || !d.members) continue;
      for (const id of d.members) {
        const p = getPerson(world, id);
        if (!p || p.died >= 0 || ageOf(world, p) < 35) continue;
        if (!womenOk && p.female) continue;
        let w = 6 + (ageOf(world, p) - 35) * 0.2;
        if (p.dynastyId === polity.dynastyId) w *= 0.4;   // the incumbent house is resented
        cands.push([p, w]); seen.add(p.id);
      }
    }
  }
  // a self-made notable can stand, but established houses usually prevail
  cands.push([null, cands.length ? 3 : 8]);
  let tot = 0; for (const [, w] of cands) tot += w;
  let pick = rng() * tot;
  for (const [p, w] of cands) { pick -= w; if (pick <= 0) {
    if (p) return { person: p, fresh: false };
    break;
  } }
  const culId = dominantCulture(c.capital);
  const person = makeAdult(world, culId, womenOk && rng() < 0.18, rng, 40 + rng() * 15, undefined, 0.78, "founder");
  return { person, fresh: true };
}

function crown(world, polity, person, how, gov) {
  // close out the previous ruler's reign record (for the tree's reign spans)
  const prev = polity.rulerId >= 0 ? getPerson(world, polity.rulerId) : null;
  if (prev && prev.id !== person.id && prev.reignTo < 0) prev.reignTo = stepToYear(world.step) | 0;

  polity.rulerId = person.id;
  polity._reignSince = world.step;
  person.reignFrom = stepToYear(world.step) | 0;
  person.reignTo = -1;
  // open the reign's deed ledger (read back at death to earn an epithet)
  const cc = world.countries ? world.countries.get(polity.id) : null;
  polity._reignCities = countCities(cc);
  polity._reignWars = 0;
  polity._reignMon0 = polity._monuments || 0;
  if (person.dynastyId < 0) newDynasty(world, person, polity.id);
  polity.dynastyId = person.dynastyId;
  person._title = titleFor(gov, person.female);
  const d = getDynasty(world, person.dynastyId);

  // What's worth chronicling: the founding of a house ("first"/"crisis"), a
  // newly-elected magistracy from a fresh house (republics alternate — the
  // turnover IS the story), and a new theocratic line. Ordinary hereditary
  // successions within an established line are not individually notable.
  const notable = how === "first" || how === "crisis" || how === "elected" || how === "elevated";
  if (notable) {
    const evtype = gov === GOV_REPUBLIC ? "ruler.elected"
                 : gov === GOV_THEOCRACY ? "ruler.elevated"
                 : "ruler.crowned";
    logEvent(world, evtype, {
      polity: polity.id, name: polity.name,
      person: person.id, personName: person.name, female: person.female ? 1 : 0,
      dynasty: person.dynastyId, dynastyName: d ? d.name : undefined,
      age: Math.round(ageOf(world, person)), how, title: person._title,
    });
  }
}

// Fill a vacant throne by the realm's form of government. Returns true on success.
function fillThrone(world, c, polity, dyn, law, rng) {
  const gov = polity.gov || GOV_MONARCHY;
  if (gov === GOV_THEOCRACY) {
    const { person, fresh } = selectTheocrat(world, c, polity, dyn, law, rng);
    if (fresh && dyn) { person.dynastyId = dyn.id; enroll(world, person); }   // adopted into the sacred house
    else if (fresh) person.dynastyId = -1;                                    // first theocrat founds it
    crown(world, polity, person, dyn ? "elevated" : "first", gov);
    return true;
  }
  if (gov === GOV_REPUBLIC) {
    const { person, fresh } = selectElected(world, c, polity, rng);
    if (fresh) person.dynastyId = -1;          // a self-made magistrate founds a new house
    crown(world, polity, person, dyn ? "elected" : "first", gov);
    return true;
  }
  // monarchy
  if (!dyn) return false;            // no house yet — handled by the founding path
  return false;                      // hereditary fill is driven from the death handler
}

// Reap the house by sampled lifespan (plus an acute plague hazard for kin in a
// plague-struck capital). Non-ruler deaths are silent; the tree simply loses the
// member from the LIVING roster (the person record stays for the tree's history).
function reapHouse(world, dyn, over, mortF, rng, rulerId, plague) {
  if (!dyn || !dyn.members) return;
  const keep = [];
  for (const id of dyn.members) {
    const p = getPerson(world, id);
    if (!p) continue;
    if (p.died >= 0) continue;                 // already gone
    if (p.id === rulerId) { keep.push(id); continue; }  // the monarch is reaped in the main loop
    if (p.lifespan < 0) p.lifespan = sampleLifespan(rng, mortF, true);   // migrate older saves
    const dead = ageOf(world, p) >= p.lifespan || (plague && rng() < over(PLAGUE_HAZARD_Y));
    if (dead) { p.died = world.step | 0; if (p.reignTo < 0 && p.reignFrom >= 0) p.reignTo = stepToYear(world.step) | 0; }
    else keep.push(id);
  }
  dyn.members = keep.length <= MAX_HOUSE ? keep : keep.slice(0, MAX_HOUSE);
  // sweep married-in partners — they age and die on their own span (and outlive
  // their blood spouse as widows/widowers until then)
  if (dyn.inlaws && dyn.inlaws.length) {
    const live = [];
    for (const id of dyn.inlaws) {
      const sp = getPerson(world, id);
      if (!sp || sp.died >= 0) continue;
      if (sp.lifespan < 0) sp.lifespan = sampleLifespan(rng, mortF, true);
      if (ageOf(world, sp) >= sp.lifespan) sp.died = world.step | 0;
      else live.push(id);
    }
    dyn.inlaws = live;
  }
}

// Grow the cadet branches: marry and breed the house's collateral adults so the
// tree fills with siblings, cousins, nieces and nephews (bounded by the roster
// cap so a house can't explode).
function growCadets(world, c, polity, dyn, over, mortF, rng) {
  if (!dyn || !dyn.members) return;
  if (dyn.members.length >= MAX_HOUSE) return;
  let births = 0;
  for (const id of dyn.members.slice()) {        // slice: births mutate members
    if (births >= 3 || dyn.members.length >= MAX_HOUSE) break;
    const p = getPerson(world, id);
    if (!p || p.died >= 0 || p.id === polity.rulerId) continue;
    const age = ageOf(world, p);
    if (age < 16) continue;
    if (p.spouseId < 0) { if (age <= 40 && rng() < 0.5) marry(world, p, c.id, rng, false, mortF); continue; }
    const spouse = getPerson(world, p.spouseId);
    if (!spouse || spouse.died >= 0) continue;
    if ((p.children || []).length >= MAX_CHILDREN) continue;
    const mAge = p.female ? age : ageOf(world, spouse);
    if (mAge > FERTILE_MAX) continue;
    if (rng() < over(CADET_BIRTH_Y * 0.5 * (vigorFertility(p) + vigorFertility(spouse)))) {
      birth(world, p, rng, false, mortF);
      births++;
      // childbirth could take the mother (dev-scaled)
      const mother = p.female ? p : spouse;
      if (mother && mother.died < 0 && rng() < MATERNAL_HAZARD * mortF) {
        mother.died = world.step | 0;
        if (mother.reignTo < 0 && mother.reignFrom >= 0) mother.reignTo = stepToYear(world.step) | 0;
      }
    }
  }
}

// Bound memory over very long games: drop dead persons who belong to no living
// line. Every living member's ancestry (the spine the tree climbs), every house
// founder, the in-laws and the sitting rulers are preserved; only extinct
// side-branches are forgotten. Uses no randomness — determinism is untouched.
function prunePersons(world) {
  if (!world.persons || world.persons.size < 4000) return;
  const keep = new Set();
  const keepLine = (id) => {
    let p = getPerson(world, id), guard = 0;
    while (p && !keep.has(p.id) && guard++ < 80) { keep.add(p.id); p = p.parentId >= 0 ? getPerson(world, p.parentId) : null; }
  };
  if (world.dynasties) for (const d of world.dynasties.values()) {
    if (d.founderId >= 0) keepLine(d.founderId);
    if (d.members) for (const id of d.members) keepLine(id);
    if (d.inlaws) for (const id of d.inlaws) keep.add(id);
  }
  for (const c of world.countries.values()) {
    const pol = getPolity(world, c.id);
    if (pol && pol.rulerId >= 0) keepLine(pol.rulerId);
  }
  for (const id of [...keep]) { const p = getPerson(world, id); if (p && p.spouseId >= 0) keep.add(p.spouseId); }
  for (const [id, p] of world.persons) if (p.died >= 0 && !keep.has(id)) world.persons.delete(id);
}

export function updateDynasties(world) {
  if (!world.countries) return;
  const rng = passRng(world, "dynasty");
  if (world.step % (DYNASTY_INTERVAL * 24) === 0) prunePersons(world);
  // Years elapsed since the last pass — the step→year mapping compresses early
  // eras, so every per-pass rate below is computed from ANNUAL hazards raised to
  // this span. One pass can be 30 years in the bronze age and one year later;
  // rulers live human lives either way.
  const ivl = Math.max(1, Math.round(DYNASTY_INTERVAL * Math.max(1, (world._dt ? 1 / world._dt : 1))));
  const years = Math.max(0.05, stepToYear(world.step) - stepToYear(world.step - ivl));
  const over = (annual) => 1 - Math.pow(1 - Math.min(0.95, annual), years);

  // royal marriage market, computed once per pass (the heirs of every throne)
  const court = [];
  for (const c0 of world.countries.values()) {
    const op = getPolity(world, c0.id);
    if (!op || op.rulerId == null || op.rulerId < 0) continue;
    const or = getPerson(world, op.rulerId);
    if (!or) continue;
    for (const cid0 of or.children || []) {
      const ch = getPerson(world, cid0);
      if (ch && ch.died < 0 && ch.spouseId < 0 && !ch.bastard && ageOf(world, ch) >= 16) court.push([ch, c0.id]);
    }
  }
  world._royalCourt = court;

  const ids = [...world.countries.keys()].sort((a, b) => a - b);
  for (const cid of ids) {
    const c = world.countries.get(cid);
    const polity = getPolity(world, cid);
    if (!polity || polity.endedStep >= 0 || !c || !c.capital) continue;
    const k = c.capital.knowledge || {};
    const org = k.organization || 0;
    if (org < LITERACY_MIN) continue;          // the time of legends — no records yet

    // development → mortality softener (medicine/sanitation, read off the world)
    const dev = clamp01((org - 0.2) / 0.6);
    const mortF = 1 - HEALTH_DEV_W * dev;

    updateGovernance(world, c, polity);
    const law = polity.succLaw || LAW_MALE_PREF;

    let ruler = polity.rulerId >= 0 ? getPerson(world, polity.rulerId) : null;
    if (ruler && ruler.died >= 0) ruler = null;
    let dyn = polity.dynastyId >= 0 ? getDynasty(world, polity.dynastyId) : null;
    if (dyn && dyn.endedStep >= 0) dyn = null;

    // an empty throne with no house at all: found one (first literacy, or after a
    // crisis), by the realm's form of government
    if (!ruler) {
      applyRulerMods(c, null);                    // interregnum — neutral leadership
      if (polity.gov === GOV_THEOCRACY || polity.gov === GOV_REPUBLIC) {
        fillThrone(world, c, polity, dyn, law, rng);
      } else {
        const culId = dominantCulture(c.capital);
        // founders are male by default; women found houses only where the law admits
        const femChance = law === LAW_ABSOLUTE ? 0.4 : law === LAW_AGNATIC ? 0 : 0.1;
        // a founder rises on merit — dealt a capable hand of traits
        const person = makeAdult(world, culId, rng() < femChance, rng, undefined, undefined, mortF, "founder");
        crown(world, polity, person, polity.dynastyId >= 0 ? "crisis" : "first", polity.gov || GOV_MONARCHY);
      }
      continue;
    }

    // the ruler's character drives the realm this pass (war, rule, order)
    applyRulerMods(c, ruler);

    // the living house: marry & breed the monarch, grow cadet branches, reap all
    const plague = !!c.capital._plagueActive;
    marry(world, ruler, cid, rng, true, mortF);
    const spouse = getPerson(world, ruler.spouseId);
    const rAge = ageOf(world, ruler);
    if (spouse && spouse.died < 0 && (ruler.children || []).length < MAX_CHILDREN) {
      const mAge = ruler.female ? rAge : ageOf(world, spouse);
      const fert = BIRTH_RATE_Y * 0.5 * (vigorFertility(ruler) + vigorFertility(spouse));   // sickly lines breed less
      if (mAge <= FERTILE_MAX && rng() < over(fert)) {
        birth(world, ruler, rng, false, mortF);
        const mother = ruler.female ? ruler : spouse;
        if (mother && mother.died < 0 && mother.id !== ruler.id && rng() < MATERNAL_HAZARD * mortF) mother.died = world.step | 0;
      }
    }
    // an acknowledged royal bastard (no tracked mother) — a claimant of last resort
    if (rAge <= FERTILE_MAX + 12 && rng() < over(BASTARD_RATE_Y) && (ruler.children || []).length < MAX_CHILDREN) {
      birth(world, ruler, rng, true, mortF);
    }
    growCadets(world, c, polity, dyn, over, mortF, rng);
    reapHouse(world, dyn, over, mortF, rng, ruler.id, plague);

    // the monarch dies at their sampled span (plague in the capital can take them early)
    if (ruler.lifespan < 0) ruler.lifespan = sampleLifespan(rng, mortF, true);
    const died = rAge >= ruler.lifespan || (plague && rng() < over(PLAGUE_HAZARD_Y * 2));
    if (died) {
      ruler.died = world.step | 0;
      ruler.reignTo = stepToYear(world.step) | 0;
      const reignY = Math.round(ruler.reignTo - stepToYear(polity._reignSince ?? ruler.born));
      const gov0 = polity.gov || GOV_MONARCHY;
      // the name history keeps them by — earned from the deeds of their reign
      ruler.epithet = epithetFor(ruler, polity, reignY, countCities(c) - (polity._reignCities || 0), gov0);
      if (reignY >= LONG_REIGN_YEARS) {
        logEvent(world, "ruler.died", {
          polity: cid, name: polity.name, person: ruler.id, personName: ruler.name,
          dynasty: ruler.dynastyId, age: Math.round(rAge), reign: reignY, title: ruler._title, epithet: ruler.epithet,
        });
      }

      const gov = polity.gov || GOV_MONARCHY;
      if (gov === GOV_THEOCRACY || gov === GOV_REPUBLIC) {
        // selection / election rather than blood
        fillThrone(world, c, polity, dyn, law, rng);
        continue;
      }
      // monarchy: claim-based heir over the whole house
      const succ = dyn ? heirByLaw(world, ruler, dyn, law) : null;
      if (succ) {
        crown(world, polity, succ.heir, succ.minor ? (succ.how === "bastard" ? "bastard" : "regency") : succ.how, gov);
        if (succ.contested) {
          // a disputed accession (collateral, minor or bastard) is a softer shock
          polity._crisisAt = world.step;
          c.capital.unrest = Math.min(1, (c.capital.unrest || 0) + DISPUTE_UNREST_HIT);
        }
      } else {
        // the whole house has failed — succession crisis: a new line next pass
        if (dyn && dyn.endedStep < 0) {
          dyn.endedStep = world.step | 0;
          logEvent(world, "dynasty.extinct", { dynasty: dyn.id, dynastyName: dyn.name, polity: cid, name: polity.name });
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

// Deterministic helper for war-cause annotation (armies.js): was this realm in a
// succession crisis (or a disputed accession) recently?
export function inCrisis(world, polityId, window = 600) {
  const p = getPolity(world, polityId);
  return !!(p && p._crisisAt != null && world.step - p._crisisAt < window / (world._dt || 1));
}

// ── The ruling family tree, for the UI ───────────────────────────────────────
// A compact, render-ready graph of the reigning house: living members, their
// ancestry back to the founder, recently-dead members that knit the tree, and
// the spouses that married in. Bounded so a long-lived house stays legible.
export function governanceLabel(gov) {
  return gov === GOV_THEOCRACY ? "Theocracy" : gov === GOV_REPUBLIC ? "Republic" : "Monarchy";
}
export function lawLabel(law) {
  return law === LAW_AGNATIC ? "agnatic (men only)"
       : law === LAW_ABSOLUTE ? "absolute (eldest of either sex)"
       : "male-preference";
}

export function getDynastyTree(world, countryId, cap = 80) {
  const polity = getPolity(world, countryId);
  if (!polity) return null;
  const dyn = polity.dynastyId >= 0 ? getDynasty(world, polity.dynastyId) : null;
  const rulerId = polity.rulerId;
  const want = new Set();
  const add = (id) => { if (id != null && id >= 0) want.add(id); };

  // seed: every living blood member, plus the founder and the sitting ruler
  if (dyn && dyn.members) for (const id of dyn.members) add(id);
  if (dyn) add(dyn.founderId);
  add(rulerId);
  // climb each seed to the founder so the generations connect
  for (const id of [...want]) {
    let p = getPerson(world, id), guard = 0;
    while (p && p.parentId >= 0 && guard++ < 40) { add(p.parentId); p = getPerson(world, p.parentId); }
  }
  // pull in spouses (married-in partners) so couples render together
  for (const id of [...want]) {
    const p = getPerson(world, id);
    if (p && p.spouseId >= 0) add(p.spouseId);
  }
  // bound the node count: keep the ruler's recent ancestry + living members first
  let idsArr = [...want];
  if (idsArr.length > cap) {
    const score = (id) => {
      const p = getPerson(world, id); if (!p) return -1;
      let s = 0;
      if (id === rulerId) s += 1000;
      if (p.died < 0) s += 100;                 // living first
      if (dyn && id === dyn.founderId) s += 50;
      s += Math.max(0, 40 - (stepToYear(world.step) - stepToYear(p.born)) / 5);
      return s;
    };
    idsArr.sort((a, b) => score(b) - score(a));
    idsArr = idsArr.slice(0, cap);
  }
  const keep = new Set(idsArr);
  const nowY = stepToYear(world.step) | 0;
  const nodes = idsArr.map(id => {
    const p = getPerson(world, id);
    const bornY = stepToYear(p.born) | 0;
    return {
      id: p.id, name: p.name || "?", female: !!p.female,
      bastard: !!p.bastard, foreign: !!p.foreign,
      parentId: keep.has(p.parentId) ? p.parentId : -1,
      spouseId: keep.has(p.spouseId) ? p.spouseId : -1,
      bornY, age: p.died >= 0 ? (stepToYear(p.died) | 0) - bornY : nowY - bornY,
      diedY: p.died >= 0 ? stepToYear(p.died) | 0 : -1,
      reignFrom: p.reignFrom >= 0 ? p.reignFrom : -1,
      reignTo: p.reignFrom >= 0 ? (p.reignTo >= 0 ? p.reignTo : nowY) : -1,
      isRuler: p.id === rulerId,
      title: p.id === rulerId ? p._title : undefined,
      epithet: p.epithet || null,
      traits: p.traits ? { vigor: +(p.traits.vigor || 0).toFixed(2), wit: +(p.traits.wit || 0).toFixed(2), boldness: +(p.traits.boldness || 0).toFixed(2), ruthlessness: +(p.traits.ruthlessness || 0).toFixed(2) } : null,
      trait: traitLabel(p.traits),
    };
  });
  const r = rulerId >= 0 ? getPerson(world, rulerId) : null;
  return {
    countryId, houseName: dyn ? dyn.name : null,
    gov: polity.gov || GOV_MONARCHY, govLabel: governanceLabel(polity.gov),
    law: polity.succLaw || LAW_MALE_PREF, lawLabel: lawLabel(polity.succLaw),
    rulerTitle: r ? (r._title || titleFor(polity.gov, r.female)) : null,
    nodes,
  };
}
