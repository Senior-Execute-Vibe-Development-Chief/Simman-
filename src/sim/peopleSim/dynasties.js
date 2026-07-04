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
import { T, passWindow } from "./tuning.js";
import { logEvent } from "./events.js";
import { getPolity } from "./entities.js";
import { getCulture, nameFor, dominantCulture } from "./cultures.js";
import { getFaith, dominantFaith } from "./faiths.js";
// The dynasty layer runs on the DYNASTY clock — a separate, slower UNIFORM clock
// (see calendar.js). Uniform so a king reigns ~50 years regardless of how fast the
// world develops; slower (half the mechanic rate) so the count of sovereigns fits
// the displayed ~5000-year span (~100 across a realm's life, not ~200 crammed in)
// and the tree's years sit in the same 3000 BC → ~2000 AD range as the display
// calendar. The DISPLAY calendar itself is era-anchored and non-uniform, so it
// can't time durations — this clock tracks it only approximately, by design.
import { dynYear as _rawDynYear, dynStep as _rawDynStep } from "../calendar.js";

// Dynastic time in HISTORY units: SIM_GRANULARITY stretches the same history
// over G× more ticks (index.js), so the dyn clock weights ticks by world._dt
// like every other duration in the sim. Without this, rulers aged per raw
// TICK — at G=4 a realm burned through 4× the sovereigns over the same
// history, desyncing dynastic pacing (and its crisis-wars) from everything
// else. DYN_RATE now means "human years per history-tick" at any granularity.
const stepToYear = (world, step) => _rawDynYear(step * (world._dt || 1));
const yearToStep = (world, year) => _rawDynStep(year) / (world._dt || 1);

export const DYNASTY_INTERVAL = 25;     // small pass, runs often (reigns span a few passes)
const LITERACY_MIN = 0.22;              // organization needed for recorded dynastic history
const CROWN_AGE_MIN = 18, CROWN_AGE_SPAN = 22;   // a founder is crowned at 18–40
const FERTILE_MAX = 45;                 // no births past this age
const REGENCY_AGE = 14;                 // below this the sovereign is a CHILD ruling under regents (D30). Matches heirByLaw's adult threshold (searchLine treats <14 as a minor → a minor accession is already flagged a crisis, so regency and the crisis record AGREE rather than contradict). A child projects no personal agency, and the crown reads as weak to neighbours.
const BIRTH_RATE_Y = 0.30;              // annual chance of a royal birth while married & fertile
const CADET_BIRTH_Y = 0.22;             // annual birth chance for a married cadet branch
const BASTARD_RATE_Y = 0.018;           // annual chance the monarch sires an acknowledged bastard
const REMARRY_Y      = 0.4;             // annual remarriage hazard for a WIDOWED monarch at MAXIMAL heir scarcity; scaled down by the spare heirs already standing (D31 — crises stay common, rarer than mortality alone implies)
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
// The FORM of government and the PERSON on the throne, projected together onto the
// levers other passes read (refreshed each pass on the country record). The form
// sets the realm's baseline (a republic develops fast and fights little; a despotism
// the reverse); the ruler's character then swings it — but only as far as the form
// lets one person matter (`ruler`: a crown/strongman ride on the individual, an
// institution dampens them). During an interregnum only the form's baseline applies.
function applyRulerMods(c, ruler, gov, minor) {
  const fx = GOV_FX[gov] || GOV_FX.monarchy;
  // A child on the throne (regency, D30) projects no personal boldness/wit/ruthlessness —
  // the regents hold a passive, baseline line, exactly as in an interregnum.
  const t = (ruler && !minor && ruler.traits) || null;
  const rw = fx.ruler;
  const bold = t ? (t.boldness || 0) : 0, wit = t ? (t.wit || 0) : 0, ruth = t ? (t.ruthlessness || 0) : 0;
  c._rulerWar    = fx.war * (1 + bold * 0.30 * rw);
  c._rulerWit    = fx.dev * (1 + wit * 0.15 * rw);
  c._rulerRelief = fx.order + (wit * 0.5 + ruth * 0.5) * 0.013 * rw;
  c._govStab     = fx.stab;                       // succession turbulence (read in the death handler)
}
function vigorFertility(p) {
  const v = (p && p.traits && p.traits.vigor) || 0;
  return 0.7 + 0.6 * ((v + 1) / 2);            // sickly 0.7 … hale 1.3
}

// ── Dynastic legitimacy: the stability dividend of an unbroken hereditary line ──
// THIS is the calm that settled succession buys. It accrues — slowly — with the
// HOUSE's tenure (how long it has held the throne), the current reign's length,
// and the presence of a clear adult heir; hereditary forms earn far more of it
// than elected ones (a chosen king never banks the blood-legitimacy of a long
// dynasty — the elective-monarchy problem). High legitimacy keeps the realm calm
// and smooths the next handover; a broken succession shatters it. Gated on
// emergent DURATIONS (tenure, reign), never on the calendar.
function houseHasAdultHeir(world, dyn, rulerId, law) {
  if (!dyn || !dyn.members) return false;
  for (const id of dyn.members) {
    if (id === rulerId) continue;
    const p = getPerson(world, id);
    if (p && p.died < 0 && !p.bastard && ageOf(world, p) >= 16 && (law !== LAW_AGNATIC || !p.female)) return true;
  }
  return false;
}
function legitFormBase(gov) {
  return gov === GOV_MONARCHY ? 0.55 : gov === GOV_THEOCRACY ? 0.50
       : gov === GOV_DESPOTISM ? 0.40 : gov === GOV_ELECTIVE ? 0.38 : 0.42;   // republic 0.42
}
function applyLegitimacy(world, c, polity, dyn, ruler, gov, law, minor) {
  const hereditary = gov === GOV_MONARCHY || gov === GOV_THEOCRACY;
  const dynAgeY = dyn ? Math.max(0, stepToYear(world, world.step) - stepToYear(world, dyn.foundedStep)) : 0;
  const tenure = hereditary ? Math.min(0.25, dynAgeY / 600) : Math.min(0.08, dynAgeY / 900);
  const reignY = ruler ? Math.max(0, stepToYear(world, world.step) - stepToYear(world, polity._reignSince ?? world.step)) : 0;
  const reignStab = Math.min(0.10, reignY / 400);
  const heir = houseHasAdultHeir(world, dyn, ruler ? ruler.id : -1, law)
    ? 0.10 : (hereditary ? -0.15 : 0);          // a clear heir reassures; an empty cradle unsettles a crown
  const regencyHit = minor ? -0.18 : 0;         // a child on the throne is a standing weakness — royal authority is in abeyance under the regents (D30)
  const target = clamp01(legitFormBase(gov) + tenure + reignStab + heir + regencyHit);
  const cur = polity._dynLegit == null ? target : polity._dynLegit;
  polity._dynLegit = cur + (target - cur) * 0.15;        // drifts slowly
  // a legitimate, settled house keeps the realm calm; a shaky one frays it
  c._rulerRelief += (polity._dynLegit - 0.45) * 0.028;   // ~ -0.013 … +0.015
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
  return Math.max(0, stepToYear(world, world.step) - stepToYear(world, person.born));
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
  return Math.round(yearToStep(world, stepToYear(world, world.step) - years));
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

// Every death flows through here (R4): mark the person dead and close any open reign — one
// site so no death path forgets the reign-close. The guard tests `reignFrom !== -1` (the
// never-reigned sentinel from newPerson), NOT `>= 0`: dyn-years run NEGATIVE in antiquity
// (calendar DYN_START), so a BC-era ruler's reignFrom is a real-but-negative year and a
// `>= 0` guard would wrongly skip it — leaving reignTo at -1 and computing a garbage
// multi-millennium reign span (wrong epithet + spurious long-reign event). Idempotent.
// Widowhood is deliberately NOT recorded by clearing spouseId here: the surviving monarch's
// remarriage (D31) reads the consort's `died` flag instead, so a late consort stays linked
// in the family tree until — and unless — a new match is actually made.
function killPerson(world, p) {
  if (!p || p.died >= 0) return;
  p.died = world.step | 0;
  if (p.reignTo < 0 && p.reignFrom !== -1) p.reignTo = stepToYear(world, world.step) | 0;
}

// ── Governance: derive how a realm is ruled from its STATE ───────────────────
// All scores read current development, faith and economy. Hysteresis (a sticky
// counter on the polity) keeps a realm from flickering between forms.
const GOV_MONARCHY = "monarchy", GOV_THEOCRACY = "theocracy",
      GOV_REPUBLIC = "republic", GOV_DESPOTISM = "despotism", GOV_ELECTIVE = "elective";
const LAW_AGNATIC = "agnatic", LAW_MALE_PREF = "male-pref", LAW_ABSOLUTE = "absolute";
const GOV_SWITCH_PASSES = 3;            // a new form must win this many passes running to take hold

// What each form DOES, not just how it picks a ruler. These feed the same realm
// levers ruler character already moves, so a form's bonuses/penalties stack with
// (and scale) the person on the throne:
//   war    — appetite for wars of choice (× the realm's base)
//   dev    — pace of institutional development at the capital (×)
//   order  — standing relief on popular unrest (+, can be negative = unrest)
//   ruler  — how much the INDIVIDUAL ruler's character swings the realm (a crown
//            or a strongman ride on one person; an institution dampens them)
//   stab   — succession stability (×, <1 = turbulent, brittle accessions)
const GOV_FX = {
  monarchy:  { war: 1.00, dev: 1.00, order:  0.000, ruler: 1.00, stab: 1.00 },
  theocracy: { war: 0.82, dev: 0.86, order: +0.018, ruler: 0.45, stab: 1.20 },  // pious, calm, stagnant; the office rules
  republic:  { war: 0.78, dev: 1.16, order: -0.008, ruler: 0.50, stab: 0.90 },  // mercantile, advancing, faction-prone
  despotism: { war: 1.30, dev: 0.85, order: +0.014, ruler: 1.25, stab: 0.82 },  // martial, cowed, stagnant; brittle at the top
  elective:  { war: 1.02, dev: 1.00, order: -0.004, ruler: 0.85, stab: 0.78 },  // aristocratic crown, but each election is a contest
};

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function deriveTarget(world, c, polity) {
  const cap = c.capital;
  const pers = polity.personality || {};
  const aggr01 = clamp01(((pers.aggression || 0) + 1) / 2);
  const comm01 = clamp01(((pers.commerce || 0) + 1) / 2);

  // THEOCRACY — the rare realm where the PRIESTHOOD itself rules, not merely a
  // pious crown. Almost every organized church has clergy (high hierarchy by
  // design), so hierarchy alone can't distinguish one — it takes a COMMANDING
  // priestly hierarchy AND fervent zeal over a faith that dominates the capital.
  // Most religious states stayed monarchies; this is the exception.
  let theo = false;
  const faith = polity.faithId >= 0 ? getFaith(world, polity.faithId) : null;
  if (faith && faith.doctrine && dominantFaith(cap) === polity.faithId) {
    const share = (cap.faithMix && cap.faithMix.length) ? cap.faithMix[0][1] : 0;
    const d = faith.doctrine;
    theo = share >= 0.68 && (d.hierarchy || 0) >= 0.8 && (d.zeal || 0) >= 0.72;
  }

  // REPUBLIC — the merchant city-state: a COMMERCIAL, un-warlike burgher polity
  // where a civic class governs through an elected council. It need not be big or
  // polycentric (Venice was a single dominant city) — a strong trading town will
  // do; what it must NOT be is a martial conquest-state. (Literacy is already
  // required for any recorded government, in the caller.) Primacy only lightly
  // tempers a sprawling realm toward a crown.
  let totalPop = 0, capPop = cap ? (cap.people || 0) : 0;
  if (c.members) for (const s of c.members) { if (s.mode === "settled") totalPop += s.people || 0; }
  const primacy = totalPop > 0 ? capPop / totalPop : 1;
  let repScore = (0.6 * comm01 + 0.4 * (1 - aggr01)) * (0.85 + 0.15 * (1 - primacy));

  let gov = GOV_MONARCHY;
  if (theo) gov = GOV_THEOCRACY;
  else if (comm01 >= 0.55 && aggr01 < 0.55 && repScore >= 0.55) gov = GOV_REPUBLIC;
  // DESPOTISM — a martial, un-mercantile realm where power rests on the sword:
  // a strongman and his soldiery, not law or commerce. Forged by aggression.
  else if (aggr01 >= 0.6 && comm01 < 0.5) gov = GOV_DESPOTISM;
  // ELECTIVE MONARCHY — a crowned but POLYCENTRIC realm where power is spread
  // among comparable noble seats (low primacy): the magnates ELECT the king
  // rather than inheriting him. Keeps the trappings of monarchy, forgoes its
  // hereditary stability — every reign ends in a contested election.
  else if (primacy < 0.6 && comm01 < 0.58 && aggr01 < 0.62) gov = GOV_ELECTIVE;

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
  if (gov === GOV_REPUBLIC) return "Consul";
  if (gov === GOV_DESPOTISM) return female ? "Autarch" : "Despot";
  return female ? "Queen" : "King";   // monarchy & elective monarchy both crown a king
}
// Forms where the throne is FILLED by selection/election rather than inherited.
function isSelected(gov) { return gov === GOV_THEOCRACY || gov === GOV_REPUBLIC || gov === GOV_ELECTIVE; }

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

// How badly the line needs a fresh heir: 1.0 = no eligible adult heir BEYOND the sovereign
// (the line about to die out — most urgent), falling to a small floor when several spares
// already stand. Counts the living house EXCLUDING the ruler themself — a sovereign is not
// their own heir, and counting them made the heirless-crown (1.0) case unreachable and
// halved the pressure. Read off house STATE, never a clock — it gates a widowed monarch's
// remarriage (D31), so a heirless crown urgently remarries while a secure one rarely does.
function heirScarcity(world, ruler, dyn, law) {
  if (!dyn || !dyn.members) return 1;
  let spares = 0;
  for (const id of dyn.members) {
    if (id === ruler.id) continue;                         // the sovereign is not their own heir
    const p = getPerson(world, id);
    if (p && p.died < 0 && ageOf(world, p) >= 14 && eligible(world, p, law, false) && ++spares >= 3) break;
  }
  return spares === 0 ? 1 : spares >= 3 ? 0.12 : spares === 2 ? 0.3 : 0.6;   // 0 spare adult heirs → most urgent
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
  // the office is NOT hereditary: only sometimes does it stay in the sitting house;
  // more often a new man rises, and about half the time he founds a fresh sacerdotal
  // line — so the mitre visibly passes between houses over the generations.
  if (elders.length && rng() < 0.4) {
    elders.sort((a, b) => a.born - b.born);     // the eldest — priesthoods favour age
    return { person: elders[0], fresh: false };
  }
  const culId = dominantCulture(c.capital);
  const person = makeAdult(world, culId, womenOk && rng() < 0.12, rng, 38 + rng() * 18, undefined, 0.78, "founder");
  return { person, fresh: true, foundNew: rng() < 0.55 };
}

// Republic: the magistracy is ELECTED for life; great houses put forward elders
// and alternate in the office. Modelled as a weighted draw over candidate houses
// (the sitting house is disfavoured — incumbents rarely keep it in the family),
// with fresh notables entering the lists too.
function selectElected(world, c, polity, rng) {
  const law = polity.succLaw || LAW_MALE_PREF;
  const womenOk = law === LAW_ABSOLUTE;
  const cands = [];
  // Elders of the houses actually seated in THIS realm — its current ruling
  // house plus the noble houses that have held its offices (polity.houses,
  // maintained at every crowning). The old pool was every same-CULTURE house
  // world-wide, so a republic could elect the sitting king of a different
  // realm of the same culture — two thrones, one person, and the foreign
  // realm's succession machinery breaking around the shared record.
  const seen = new Set();
  const realmHouses = new Set(polity.houses || []);
  if (polity.dynastyId != null && polity.dynastyId >= 0) realmHouses.add(polity.dynastyId);
  const thrones = sittingRulers(world);
  if (world.dynasties) {
    for (const did of realmHouses) {
      const d = world.dynasties.get(did);
      if (!d || d.endedStep >= 0 || !d.members) continue;
      for (const id of d.members) {
        const p = getPerson(world, id);
        if (!p || p.died >= 0 || ageOf(world, p) < 30) continue;
        if (thrones.has(p.id)) continue;              // already reigns somewhere
        if (!womenOk && p.female) continue;
        // favour candidates in their PRIME (≈42) — electing the eldest greybeard
        // gives 5-year reigns and a carousel of magistrates; a vigorous man in his
        // forties serves a real term
        let w = Math.max(1, 11 - Math.abs(ageOf(world, p) - 42) * 0.4);
        if (p.dynastyId === polity.dynastyId) w *= 0.3;    // the incumbent house is resented (rotation)
        cands.push([p, w]); seen.add(p.id);
      }
    }
  }
  // a self-made notable can stand, and the lists turn over — but a council is not a
  // dynasty; established houses usually prevail
  cands.push([null, cands.length ? 4 : 8]);
  let tot = 0; for (const [, w] of cands) tot += w;
  let pick = rng() * tot;
  for (const [p, w] of cands) { pick -= w; if (pick <= 0) {
    if (p) return { person: p, fresh: false };
    break;
  } }
  const culId = dominantCulture(c.capital);
  const person = makeAdult(world, culId, womenOk && rng() < 0.18, rng, 36 + rng() * 10, undefined, 0.78, "founder");
  return { person, fresh: true };
}

function crown(world, polity, person, how, gov) {
  // close out the previous ruler's reign record (for the tree's reign spans)
  const prev = polity.rulerId >= 0 ? getPerson(world, polity.rulerId) : null;
  if (prev && prev.id !== person.id && prev.reignTo < 0) prev.reignTo = stepToYear(world, world.step) | 0;

  polity.rulerId = person.id;
  polity._reignSince = world.step;
  // Keep the per-step sitting-ruler cache current: realms later in this same
  // pass consult it (election pools, off-handler death exemptions) — a
  // mid-pass crownee must be protected immediately, not next step.
  if (world._sittingRulers && world._sittingRulersStep === world.step) world._sittingRulers.add(person.id);
  person.reignFrom = stepToYear(world, world.step) | 0;
  person.reignTo = -1;
  // open the reign's deed ledger (read back at death to earn an epithet)
  const cc = world.countries ? world.countries.get(polity.id) : null;
  polity._reignCities = countCities(cc);
  polity._reignWars = 0;
  polity._reignMon0 = polity._monuments || 0;
  const newHouse = person.dynastyId < 0;            // a brand-new family takes power
  if (newHouse) newDynasty(world, person, polity.id);
  polity.dynastyId = person.dynastyId;
  person._title = titleFor(gov, person.female);
  const d = getDynasty(world, person.dynastyId);

  // Track the ordered roll of HOUSES that have ruled this realm (most recent last),
  // so the family-tree view can show the previous royal families too — not just
  // the sitting one. Consecutive same-house reigns don't repeat.
  if (!polity.houses) polity.houses = [];
  if (polity.houses[polity.houses.length - 1] !== person.dynastyId) polity.houses.push(person.dynastyId);
  if (polity.houses.length > 10) polity.houses.splice(0, polity.houses.length - 10);

  // The realm's ROLL of sovereigns — the king-list that spans every house and
  // form of rule (dynasties, elected councils, theocratic lines). Denormalised so
  // it survives the person-prune; the open entry closes when the next is crowned.
  const curY = stepToYear(world, world.step) | 0;
  if (!polity.rulers) polity.rulers = [];
  const roll = polity.rulers;
  for (let i = roll.length - 1; i >= 0; i--) { if (roll[i].toY < 0) { roll[i].toY = curY; break; } }
  roll.push({ id: person.id, name: person.name, female: person.female ? 1 : 0,
    house: d ? d.name : null, title: person._title, gov, how, fromY: curY, toY: -1, epithet: null });
  if (roll.length > 400) roll.splice(0, roll.length - 400);

  // What's worth chronicling: the founding of a realm ("first"), a new line after
  // a crisis, and — for elected/clerical offices — only when a NEW family rises to
  // power. A republic re-electing among its established houses, or rotating its
  // magistracy every reign, is not each individually notable (the succession roll
  // keeps the full list); the chronicle marks when power changes HANDS, not seats.
  const notable = how === "first" || how === "crisis"
    || ((how === "elected" || how === "elevated") && newHouse);
  if (notable) {
    const evtype = (gov === GOV_REPUBLIC || gov === GOV_ELECTIVE) ? "ruler.elected"
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
    const { person, fresh, foundNew } = selectTheocrat(world, c, polity, dyn, law, rng);
    if (fresh && (foundNew || !dyn)) person.dynastyId = -1;                    // a new sacerdotal line rises
    else if (fresh) { person.dynastyId = dyn.id; enroll(world, person); }      // adopted into the sitting house
    crown(world, polity, person, (fresh && (foundNew || !dyn)) ? (dyn ? "crisis" : "first") : "elevated", gov);
    return true;
  }
  if (gov === GOV_REPUBLIC || gov === GOV_ELECTIVE) {
    const { person, fresh } = selectElected(world, c, polity, rng);
    if (fresh) person.dynastyId = -1;          // a self-made magistrate / a new royal house
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
// Every living polity's sitting ruler, cached per step: a person on ANOTHER
// realm's throne (a married-in queen who inherited, a shared elected magistrate)
// must only die through that realm's own succession handler — off-handler
// deaths left thrones pointing at corpses and re-founded houses instead of
// running succession.
function sittingRulers(world) {
  let set = world._sittingRulers;
  if (!set || world._sittingRulersStep !== world.step) {
    set = world._sittingRulers = set || new Set(); set.clear();
    if (world.polities) for (const p of world.polities.values()) {
      if (p.endedStep < 0 && p.rulerId != null && p.rulerId >= 0) set.add(p.rulerId);
    }
    world._sittingRulersStep = world.step;
  }
  return set;
}

function reapHouse(world, dyn, over, mortF, rng, rulerId, plague) {
  if (!dyn || !dyn.members) return;
  const keep = [];
  for (const id of dyn.members) {
    const p = getPerson(world, id);
    if (!p) continue;
    if (p.died >= 0) continue;                 // already gone
    if (p.id === rulerId || sittingRulers(world).has(p.id)) { keep.push(id); continue; }  // monarchs die only through their own realm's succession handler
    if (p.lifespan < 0) p.lifespan = sampleLifespan(rng, mortF, true);   // migrate older saves
    const dead = ageOf(world, p) >= p.lifespan || (plague && rng() < over(PLAGUE_HAZARD_Y));
    if (dead) killPerson(world, p);
    else keep.push(id);
  }
  // The roster cap is enforced as a BREEDING gate (growCadets / the birth
  // paths), never by dropping living members: a person sliced off the roster
  // was outside every mortality sweep and lived FOREVER (immortal claimants
  // aged 1800+ dyn-years were observed).
  dyn.members = keep;
  // sweep married-in partners — they age and die on their own span (and outlive
  // their blood spouse as widows/widowers until then)
  if (dyn.inlaws && dyn.inlaws.length) {
    const live = [];
    for (const id of dyn.inlaws) {
      const sp = getPerson(world, id);
      if (!sp || sp.died >= 0) continue;
      if (sp.lifespan < 0) sp.lifespan = sampleLifespan(rng, mortF, true);
      if (ageOf(world, sp) >= sp.lifespan) killPerson(world, sp);
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
    if (p.spouseId < 0) { if (age <= 40 && rng() < 0.5) marry(world, p, c.id, rng, false, mortF); continue; }   // a single cadet marries; a widowed one keeps its (dead) spouse link and so stays single — only the crown remarries (D31)
    const spouse = getPerson(world, p.spouseId);
    if (!spouse || spouse.died >= 0) continue;
    if (sittingRulers(world).has(p.spouseId)) continue;   // spouse reigns elsewhere — THAT realm's monarch path breeds the couple; breeding here too double-breeds the pair across two houses (B41)
    if ((p.children || []).length >= MAX_CHILDREN) continue;
    const mAge = p.female ? age : ageOf(world, spouse);
    if (mAge > FERTILE_MAX) continue;
    if (rng() < over(CADET_BIRTH_Y * 0.5 * (vigorFertility(p) + vigorFertility(spouse)))) {
      birth(world, p, rng, false, mortF);
      births++;
      // childbirth could take the mother (dev-scaled)
      const mother = p.female ? p : spouse;
      if (mother && mother.died < 0 && !sittingRulers(world).has(mother.id) && rng() < MATERNAL_HAZARD * mortF) {
        killPerson(world, mother);
      }
    }
  }
}

// Keep an ARISTOCRACY alive under the elected forms. A family that has held the
// office (it sits in polity.houses) endures as a noble house — small, slowly
// breeding — so the magistracy ROTATES among a stable set of great families
// (Venice's patrician dynasties) instead of minting a brand-new house every reign.
// Without this the noble pool collapses and every election raises a self-made man.
const NOBLE_CAP = 8;
function nobleUpkeep(world, c, polity, over, mortF, rng) {
  if (!polity.houses) return;
  const ruling = polity.dynastyId, seen = new Set();
  for (const did of polity.houses) {
    if (did === ruling || seen.has(did)) continue;
    seen.add(did);
    const d = getDynasty(world, did);
    if (!d || d.endedStep >= 0 || !d.members || !d.members.length || d.members.length >= NOBLE_CAP) continue;
    for (const id of d.members.slice()) {
      if (d.members.length >= NOBLE_CAP) break;
      const p = getPerson(world, id);
      if (!p || p.died >= 0) continue;
      const age = ageOf(world, p);
      if (age < 18 || age > FERTILE_MAX) continue;
      if (p.spouseId < 0) { if (age <= 40 && rng() < 0.4) marry(world, p, c.id, rng, false, mortF); continue; }   // a single noble marries; a widowed one keeps its (dead) spouse link and stays single (parity with growCadets / D31)
      const sp = getPerson(world, p.spouseId);
      if (!sp || sp.died >= 0 || (p.children || []).length >= 4) continue;
      if (sittingRulers(world).has(p.spouseId)) continue;   // spouse reigns elsewhere — that realm breeds the couple (B41)
      if (rng() < over(CADET_BIRTH_Y * 0.25 * (vigorFertility(p) + vigorFertility(sp)))) { birth(world, p, rng, false, mortF); break; }
    }
  }
}

// Bound memory over very long games: drop dead persons who belong to no remembered
// royal line. We preserve — for every LIVING realm — the recent roll of sovereigns
// WITH each one's children (so the tree shows every monarch's offspring, not just
// the heir who continued the line) and the spine back to each house's founder, plus
// living members and married-in partners. Only deep, extinct, no-longer-royal
// branches are forgotten. Uses no randomness — determinism is untouched.
const ROLL_GENEALOGY_KEEP = 140;   // recent reigns per realm whose families ride in the tree
function prunePersons(world) {
  if (!world.persons || world.persons.size < 4000) return;
  const keep = new Set();
  const keepLine = (id) => {
    let p = getPerson(world, id), guard = 0;
    while (p && !keep.has(p.id) && guard++ < 80) { keep.add(p.id); p = p.parentId >= 0 ? getPerson(world, p.parentId) : null; }
  };
  // a remembered sovereign: their ancestry spine, their children (the heir AND the
  // siblings), and their spouse
  const keepRoyalFamily = (id) => {
    const p = getPerson(world, id);
    if (!p) return;
    keepLine(id);
    if (p.spouseId >= 0) keep.add(p.spouseId);
    for (const k of p.children || []) keep.add(k);
  };
  if (world.dynasties) for (const d of world.dynasties.values()) {
    if (d.founderId >= 0) keepLine(d.founderId);
    if (d.members) for (const id of d.members) keepLine(id);
    if (d.inlaws) for (const id of d.inlaws) keep.add(id);
  }
  for (const c of world.countries.values()) {
    const pol = getPolity(world, c.id);
    if (!pol || pol.endedStep >= 0) continue;
    if (pol.rulerId >= 0) keepLine(pol.rulerId);
    const roll = pol.rulers;
    if (roll) for (let i = Math.max(0, roll.length - ROLL_GENEALOGY_KEEP); i < roll.length; i++) {
      if (roll[i] && roll[i].id != null) keepRoyalFamily(roll[i].id);
    }
  }
  for (const id of [...keep]) { const p = getPerson(world, id); if (p && p.spouseId >= 0) keep.add(p.spouseId); }
  for (const [id, p] of world.persons) if (p.died >= 0 && !keep.has(id)) world.persons.delete(id);
}

// Reap the members of NON-ruling houses by their sampled lifespan. The ruling
// house is reaped in the main loop; without this, a house that loses the throne
// (an elective rotation, a fallen realm) would never die — its members aging into
// immortal greybeards that clog the election lists. Deterministic (pure lifespan).
function reapIdleHouses(world) {
  if (!world.dynasties) return;
  const ruling = new Set();
  for (const c of world.countries.values()) { const pol = getPolity(world, c.id); if (pol && pol.dynastyId >= 0) ruling.add(pol.dynastyId); }
  for (const d of world.dynasties.values()) {
    if (!d.members || ruling.has(d.id)) continue;
    const overdue = (p) => p && p.died < 0 && p.lifespan >= 0 && ageOf(world, p) >= p.lifespan;
    const reap = (p) => killPerson(world, p);
    d.members = d.members.filter(id => { const p = getPerson(world, id); if (!p || p.died >= 0) return false; if (overdue(p)) { reap(p); return false; } return true; });
    if (d.inlaws) d.inlaws = d.inlaws.filter(id => { const p = getPerson(world, id); if (!p || p.died >= 0) return false; if (overdue(p)) { reap(p); return false; } return true; });
  }
}

export function updateDynasties(world) {
  if (!world.countries) return;
  const rng = passRng(world, "dynasty");
  reapIdleHouses(world);
  // Phase-aware window (tuning.js passWindow): this pass fires at step ≡ 59 mod
  // its interval (index.js _at phase offsets), so the old naive
  // `step % (DYNASTY_INTERVAL*24) === 0` was NEVER true — prunePersons was dead
  // code and the person registry grew without bound for the whole run.
  if (passWindow(world, DYNASTY_INTERVAL, DYNASTY_INTERVAL * 24)) prunePersons(world);
  // Years elapsed since the last pass — the step→year mapping compresses early
  // eras, so every per-pass rate below is computed from ANNUAL hazards raised to
  // this span. One pass can be 30 years in the bronze age and one year later;
  // rulers live human lives either way.
  const ivl = Math.max(1, Math.round(DYNASTY_INTERVAL * Math.max(1, (world._dt ? 1 / world._dt : 1))));
  const years = Math.max(0.05, stepToYear(world, world.step) - stepToYear(world, world.step - ivl));
  const over = (annual) => 1 - Math.pow(1 - Math.min(0.95, annual), years);

  // royal marriage market, computed once per pass — the pool a reigning monarch's
  // FOREIGN_MATCH reaches into. Two shapes, gated on T.CROSS_REALM_HEIRS (W6-F
  // prerequisite, docs/marriage-market-cross-realm.md):
  //   OFF (default): only the reigning monarch's own unwed adult children. This is
  //     too thin, so the foreign path overwhelmingly falls through to a generated
  //     houseLESS in-law (dynastyId = -1) that carries no realm's blood and seeds no
  //     cross-realm claim — dynasties stay realm-siloed. (Byte-identical to before
  //     the lever existed.)
  //   ON (direction 1): every eligible (living, trueborn, unwed, adult) member of
  //     every house that currently SITS a throne — cadets, siblings and heirs, not
  //     just the monarch's children. A foreign match then weds a REAL heir of
  //     another realm's house who keeps their birth dynastyId (and thus that realm's
  //     blood) — the married-in kin a dynastic claim stands on. Houses that sit no
  //     throne are excluded: a marriage plants a pressable claim only into a house
  //     reigning somewhere, and it keeps every union tie pointed at a real realm.
  //     Order is dynasty-id then roster order — fully deterministic (the array
  //     indexes an rng draw in marry()). Emergent: gated on kin + who holds which
  //     throne, never a date.
  const court = [];
  if (T.CROSS_REALM_HEIRS) {
    const seatOfHouse = new Map();        // dynastyId → realm it reigns (lowest id if it holds several)
    for (const c0 of world.countries.values()) {
      const op = getPolity(world, c0.id);
      if (!op || op.endedStep >= 0 || !(op.dynastyId >= 0)) continue;
      const prev = seatOfHouse.get(op.dynastyId);
      if (prev === undefined || c0.id < prev) seatOfHouse.set(op.dynastyId, c0.id);
    }
    for (const dynId of [...seatOfHouse.keys()].sort((a, b) => a - b)) {
      const d = getDynasty(world, dynId);
      if (!d || d.endedStep >= 0 || !d.members) continue;
      const realmId = seatOfHouse.get(dynId);
      const seatPol = getPolity(world, realmId);
      const seatRuler = seatPol ? seatPol.rulerId : -1;
      for (const mid of d.members) {
        if (mid === seatRuler) continue;  // the sitting monarch weds through their own realm, not the market
        const m = getPerson(world, mid);
        if (m && m.died < 0 && m.spouseId < 0 && !m.bastard && ageOf(world, m) >= 16) court.push([m, realmId]);
      }
    }
  } else {
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
  }
  world._royalCourt = court;

  const ids = [...world.countries.keys()].sort((a, b) => a - b);
  for (const cid of ids) {
    const c = world.countries.get(cid);
    const polity = getPolity(world, cid);
    if (!polity || polity.endedStep >= 0 || !c || !c.capital) continue;
    const k = c.capital.knowledge || {};
    const org = k.organization || 0;
    // Literacy gates the FOUNDING of recorded dynastic history (a realm that
    // never crossed it has no court to run). But a realm whose capital
    // REGRESSED below literacy (sacked, relocated to a backwater) keeps its
    // existing court: people still age, die and succeed even when the
    // records lapse — skipping them entirely made the sitting ruler
    // immortal (exempt from every other death sweep, and this, the only
    // handler that can kill them, never ran).
    if (org < LITERACY_MIN && !(polity.rulerId >= 0)) continue;   // the time of legends — no records yet

    // development → mortality softener (medicine/sanitation, read off the world)
    const dev = clamp01((org - 0.2) / 0.6);
    const mortF = 1 - HEALTH_DEV_W * dev;

    updateGovernance(world, c, polity);
    const law = polity.succLaw || LAW_MALE_PREF;
    if (isSelected(polity.gov)) nobleUpkeep(world, c, polity, over, mortF, rng);   // keep the aristocracy alive to elect from

    let ruler = polity.rulerId >= 0 ? getPerson(world, polity.rulerId) : null;
    if (ruler && ruler.died >= 0) ruler = null;
    let dyn = polity.dynastyId >= 0 ? getDynasty(world, polity.dynastyId) : null;
    if (dyn && dyn.endedStep >= 0) dyn = null;

    // an empty throne with no house at all: found one (first literacy, or after a
    // crisis), by the realm's form of government
    if (!ruler) {
      applyRulerMods(c, null, polity.gov);        // interregnum — only the form's baseline
      applyLegitimacy(world, c, polity, dyn, null, polity.gov, law);
      if (isSelected(polity.gov)) {
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

    // the form + the ruler's character drive the realm this pass (war, dev, order).
    // A minor on the throne rules under regents (D30): no personal agency (traits zeroed
    // below), a dented crown, and — via the raised unrest that follows — a soft target.
    const regency = ageOf(world, ruler) < REGENCY_AGE;
    applyRulerMods(c, ruler, polity.gov, regency);
    applyLegitimacy(world, c, polity, dyn, ruler, polity.gov, law, regency);

    // the living house: marry & breed the monarch, grow cadet branches, reap all
    const plague = !!c.capital._plagueActive;
    // A never-wed monarch weds; a WIDOWED one remarries only under heir pressure — D31,
    // gated on the line's survival need, not the calendar. Widowhood is read from the
    // consort's `died` flag (killPerson leaves the spouse link intact, so the late consort
    // stays in the family tree); the link is released only if a new match is actually made.
    // A secure house rarely bothers; a crown with no spare heir urgently seeks a fertile
    // new match, so crises stay common without lines dying for want of a second chance.
    const curSpouse = ruler.spouseId >= 0 ? getPerson(world, ruler.spouseId) : null;
    if (!curSpouse || curSpouse.died >= 0) {                     // single: never wed, or widowed
      if (ruler.spouseId < 0) {
        marry(world, ruler, cid, rng, true, mortF);             // never married — the first match
      } else if (ageOf(world, ruler) <= FERTILE_MAX && rng() < over(REMARRY_Y * heirScarcity(world, ruler, dyn, law))) {
        ruler.spouseId = -1;                                     // let go of the late consort so marry() proceeds
        marry(world, ruler, cid, rng, true, mortF);
      }
    }
    const spouse = getPerson(world, ruler.spouseId);
    const rAge = ageOf(world, ruler);
    if (spouse && spouse.died < 0 && (ruler.children || []).length < MAX_CHILDREN) {
      const mAge = ruler.female ? rAge : ageOf(world, spouse);
      const fert = BIRTH_RATE_Y * 0.5 * (vigorFertility(ruler) + vigorFertility(spouse));   // sickly lines breed less
      if (mAge <= FERTILE_MAX && rng() < over(fert)) {
        birth(world, ruler, rng, false, mortF);
        const mother = ruler.female ? ruler : spouse;
        if (mother && mother.died < 0 && mother.id !== ruler.id && !sittingRulers(world).has(mother.id) && rng() < MATERNAL_HAZARD * mortF) {
          killPerson(world, mother);
        }
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
      killPerson(world, ruler);   // marks dead, closes reignTo, widows the consort (D31 remarriage of the NEXT ruler's line; here the consort is freed)
      const reignY = Math.round(ruler.reignTo - stepToYear(world, polity._reignSince ?? ruler.born));
      const gov0 = polity.gov || GOV_MONARCHY;
      // the name history keeps them by — earned from the deeds of their reign
      ruler.epithet = epithetFor(ruler, polity, reignY, countCities(c) - (polity._reignCities || 0), gov0);
      // stamp it onto the realm's roll (the reign closes when the heir is crowned)
      if (polity.rulers) for (let i = polity.rulers.length - 1; i >= 0; i--) {
        if (polity.rulers[i].id === ruler.id) { polity.rulers[i].epithet = ruler.epithet; if (polity.rulers[i].toY < 0) polity.rulers[i].toY = ruler.reignTo; break; }
      }
      if (reignY >= LONG_REIGN_YEARS) {
        logEvent(world, "ruler.died", {
          polity: cid, name: polity.name, person: ruler.id, personName: ruler.name,
          dynasty: ruler.dynastyId, age: Math.round(rAge), reign: reignY, title: ruler._title, epithet: ruler.epithet,
        });
      }

      const gov = polity.gov || GOV_MONARCHY;
      if (isSelected(gov)) {
        // selection / election rather than blood
        fillThrone(world, c, polity, dyn, law, rng);
        continue;
      }
      // monarchy & despotism: claim-based heir over the whole house. The form's
      // stability decides how violently the throne changes hands — a despot's death
      // always unsettles the soldiery (brittle), a settled crown barely ripples.
      // a legitimate, long-settled house smooths the handover; a shaky one doesn't
      const legitSmooth = 1 - 0.45 * (polity._dynLegit || 0.5);
      const instab = (2 - (c._govStab || 1)) * legitSmooth;     // monarchy 1.0, despotism ~1.28, ÷ legitimacy
      const succ = dyn ? heirByLaw(world, ruler, dyn, law) : null;
      if (succ) {
        crown(world, polity, succ.heir, succ.minor ? (succ.how === "bastard" ? "bastard" : "regency") : succ.how, gov);
        // A DISPUTED accession (a minor under regency, a raised bastard) is a real
        // crisis — it sets the crisis clock the war-historians read. An orderly
        // handover, even a despot's, only ripples (unrest), so "the throne stood
        // empty" stays a meaningful, rare phrase rather than tagging every reign.
        let shock = succ.contested ? DISPUTE_UNREST_HIT : 0;
        if (gov === GOV_DESPOTISM) shock = Math.max(shock, DISPUTE_UNREST_HIT * 0.5);   // strongman handover unsettles
        if (succ.contested) {
          polity._dynLegit = (polity._dynLegit || 0.5) * 0.8;
          polity._crisisAt = world.step;
        }
        if (shock > 0) c.capital.unrest = Math.min(1, (c.capital.unrest || 0) + shock * instab);
      } else {
        // the whole house has failed — succession crisis: a new line next pass
        if (dyn && dyn.endedStep < 0) {
          dyn.endedStep = world.step | 0;
          logEvent(world, "dynasty.extinct", { dynasty: dyn.id, dynastyName: dyn.name, polity: cid, name: polity.name });
        }
        polity.rulerId = -1;
        polity._crisisAt = world.step;
        polity._dynLegit = (polity._dynLegit || 0.5) * 0.5;   // the broken line shatters legitimacy
        logEvent(world, "succession.crisis", { polity: cid, name: polity.name, dynasty: ruler.dynastyId });
        for (const m of c.members) {
          if (m.id === c.capitalId) continue;
          m.loyalty = Math.max(0, (m.loyalty ?? 1) - CRISIS_LOYALTY_HIT * (0.5 + rng()) * instab);
        }
        c.capital.unrest = Math.min(1, (c.capital.unrest || 0) + CRISIS_UNREST_HIT * instab);
      }
    }
  }
}

// Deterministic helper for war-cause annotation (armies.js): was this realm in a
// genuine succession crisis (a failed line or a disputed accession) recently? A
// tight window so "the throne stood empty" marks the actual interregnum, not the
// decades after every handover.
export function inCrisis(world, polityId, window = 320) {
  const p = getPolity(world, polityId);
  return !!(p && p._crisisAt != null && world.step - p._crisisAt < window / (world._dt || 1));
}

// ── The ruling family tree, for the UI ───────────────────────────────────────
// A compact, render-ready graph of the reigning house: living members, their
// ancestry back to the founder, recently-dead members that knit the tree, and
// the spouses that married in. Bounded so a long-lived house stays legible.
export function governanceLabel(gov) {
  return gov === GOV_THEOCRACY ? "Theocracy" : gov === GOV_REPUBLIC ? "Republic"
       : gov === GOV_DESPOTISM ? "Despotism" : gov === GOV_ELECTIVE ? "Elective Monarchy" : "Monarchy";
}
export function lawLabel(law) {
  return law === LAW_AGNATIC ? "agnatic (men only)"
       : law === LAW_ABSOLUTE ? "absolute (eldest of either sex)"
       : "male-preference";
}
export function legitLabel(v) {
  if (v == null) return null;
  return v >= 0.75 ? "unquestioned" : v >= 0.6 ? "secure" : v >= 0.45 ? "settled"
       : v >= 0.3 ? "shaky" : "contested";
}

export function getDynastyTree(world, countryId, capPerHouse = 90) {
  const polity = getPolity(world, countryId);
  if (!polity) return null;
  const rulerId = polity.rulerId;
  // The tree shows DURATIONS (lifespans, reign lengths) side by side with the
  // years, so it must stay on the mechanic clock — the era-anchored display
  // calendar compresses later eras and would crush a 50-year reign into "5 years".
  // (The chronicle ribbon, which shows absolute position only, uses displayYear.)
  const nowMech = stepToYear(world, world.step) | 0;

  // index every surviving person by their house (one scan)
  const byDyn = new Map();
  if (world.persons) for (const p of world.persons.values()) {
    if (p.dynastyId >= 0) { let a = byDyn.get(p.dynastyId); if (!a) byDyn.set(p.dynastyId, a = []); a.push(p); }
  }

  // the houses that have ruled this realm — the sitting one first, then the
  // previous families (most recent first), each rendered as its OWN tree
  const order = [], seenH = new Set();
  const pushH = (id) => { if (id != null && id >= 0 && !seenH.has(id)) { seenH.add(id); order.push(id); } };
  pushH(polity.dynastyId);
  if (polity.houses) for (let i = polity.houses.length - 1; i >= 0; i--) pushH(polity.houses[i]);

  const nodeOf = (p, keepSet) => {
    const bornMech = stepToYear(world, p.born) | 0;
    return {
      id: p.id, name: p.name || "?", female: !!p.female,
      bastard: !!p.bastard, foreign: !!p.foreign,
      parentId: keepSet.has(p.parentId) ? p.parentId : -1,
      spouseId: keepSet.has(p.spouseId) ? p.spouseId : -1,
      bornY: bornMech, age: p.died >= 0 ? (stepToYear(world, p.died) | 0) - bornMech : nowMech - bornMech,
      diedY: p.died >= 0 ? stepToYear(world, p.died) | 0 : -1,
      reignFrom: p.reignFrom >= 0 ? p.reignFrom : -1,
      reignTo: p.reignFrom >= 0 ? (p.reignTo >= 0 ? p.reignTo : nowMech) : -1,
      isRuler: p.id === rulerId,
      title: p.id === rulerId ? p._title : undefined,
      epithet: p.epithet || null,
      traits: p.traits ? { vigor: +(p.traits.vigor || 0).toFixed(2), wit: +(p.traits.wit || 0).toFixed(2), boldness: +(p.traits.boldness || 0).toFixed(2), ruthlessness: +(p.traits.ruthlessness || 0).toFixed(2) } : null,
      trait: traitLabel(p.traits),
    };
  };

  const houses = [];
  for (const dynId of order.slice(0, 6)) {
    const d = getDynasty(world, dynId);
    const members = byDyn.get(dynId) || [];
    if (!members.length) continue;
    const want = new Set(members.map(p => p.id));
    for (const p of members) if (p.spouseId >= 0) want.add(p.spouseId);   // married-in partners
    let ids = [...want];
    if (ids.length > capPerHouse) {
      // keep the sovereigns, the founder, the living, and the most recent first
      const score = (id) => {
        const p = getPerson(world, id); if (!p) return -1;
        let s = 0;
        if (id === rulerId) s += 1000;
        if (p.reignFrom >= 0) s += 200;
        if (p.died < 0) s += 80;
        if (d && id === d.founderId) s += 60;
        s += Math.max(0, 50 - (nowMech - (stepToYear(world, p.born) | 0)) / 8);
        return s;
      };
      ids.sort((a, b) => score(b) - score(a));
      ids = ids.slice(0, capPerHouse);
    }
    const keepSet = new Set(ids);
    const nodes = ids.map(id => nodeOf(getPerson(world, id), keepSet));
    houses.push({
      dynastyId: dynId, name: d ? d.name : (members[0] && members[0].name) || "?",
      isCurrent: dynId === polity.dynastyId,
      founded: d ? stepToYear(world, d.foundedStep) | 0 : (nodes.length ? Math.min(...nodes.map(n => n.bornY)) : 0),
      ended: d && d.endedStep >= 0 ? stepToYear(world, d.endedStep) | 0 : -1,
      nodes,
    });
  }
  const dyn = polity.dynastyId >= 0 ? getDynasty(world, polity.dynastyId) : null;
  const r = rulerId >= 0 ? getPerson(world, rulerId) : null;
  // The roll of sovereigns: everyone who ever ruled this realm, across every house
  // and form of government. Denormalised on the polity; we ensure the sitting ruler
  // is present (older saves predate the roll).
  const roll = (polity.rulers || []).map(e => ({
    name: e.name || "?", female: !!e.female, house: e.house || null, title: e.title || null,
    gov: e.gov || GOV_MONARCHY, fromY: e.fromY | 0, toY: e.toY < 0 ? -1 : e.toY | 0,
    epithet: e.epithet || null, current: e.toY < 0 && e.id === rulerId,
  }));
  const lastOpen = roll.length ? roll[roll.length - 1] : null;
  if (r && !(lastOpen && lastOpen.current)) {
    roll.push({
      name: r.name || "?", female: !!r.female, house: dyn ? dyn.name : null,
      title: r._title || titleFor(polity.gov, r.female), gov: polity.gov || GOV_MONARCHY,
      fromY: r.reignFrom >= 0 ? r.reignFrom : nowMech, toY: -1, epithet: null, current: true,
    });
  }
  return {
    countryId, houseName: dyn ? dyn.name : (houses[0] ? houses[0].name : null),
    gov: polity.gov || GOV_MONARCHY, govLabel: governanceLabel(polity.gov),
    law: polity.succLaw || LAW_MALE_PREF, lawLabel: lawLabel(polity.succLaw),
    rulerTitle: r ? (r._title || titleFor(polity.gov, r.female)) : null,
    legit: polity._dynLegit != null ? +polity._dynLegit.toFixed(2) : null,
    legitLabel: legitLabel(polity._dynLegit),
    houses, roll,
  };
}
