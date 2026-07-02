// ── Historiography: history as a REALM records it, not as it happened ──
//
// The event log (events.js) is the true record. This layer renders what a
// given polity's scribal tradition would actually contain — which is the
// foundation for false histories, because falsehood here is never invented
// facts: it is the truth filtered through three honest mechanisms:
//
//   1. INFORMATION HORIZON — scribes only know what reached them. Events
//      the realm took part in are known; distant events arrive with
//      probability decaying by distance (boosted by the capital's
//      literacy), and the marginal ones survive only as RUMOR.
//   2. ARCHIVE LOSS — when the capital is stormed, the records burn.
//      Events older than a sack survive it with fixed probability; a
//      lost founding is retold as MYTH (the gods, a legendary ancestor,
//      an exaggerated antiquity) — the one place the tradition invents.
//   3. BIAS — the scribes write for the court: the realm's conquests are
//      liberations, its defeats are betrayals (or quietly omitted), its
//      rebels are ingrates, its wars are always answers to provocation.
//
// Everything is deterministic per (world seed, viewer, event), so a
// realm's tradition is stable across reads and across save/load.

import { hash32 } from "./rng.js";
import { eventsOf, eventsFor, narrate, categoryOf, condenseChronicle } from "./events.js";
import { getPolity } from "./entities.js";
import { getFaith } from "./faiths.js";
import { getDynasty } from "./dynasties.js";
import { realmName } from "./chronicle.js";

const HORIZON_BASE = 70;        // tiles within which distant MAJOR events are reliably heard of
const HORIZON_LIT = 80;         // extra horizon at full literacy (organization 1.0)
const RUMOR_BAND = 0.35;        // knowledge prob band that renders as rumor instead of record
const SACK_SURVIVAL = 0.45;     // chance an older record survives each sack of the capital
const SHAME_OMIT = 0.4;         // chance a non-capital defeat simply isn't written down
const MYTH_ANTIQUITY = 0.45;    // founding myths claim the realm is up to ~45% older than it is

// Major events that travel beyond their participants.
const TRAVELS = new Set([
  "polity.shattered", "polity.ended", "faith.founded", "faith.schism",
  "culture.born", "plague.outbreak", "era.reached",
]);

function roll(world, viewerId, evId, salt) {
  return (hash32(world.seed || 1, "hist", viewerId, evId, salt) % 10000) / 10000;
}

function capitalOf(world, viewerId) {
  const c = world.countries && world.countries.get(viewerId);
  if (c && c.capital) return c.capital;
  const p = getPolity(world, viewerId);
  if (p && world._byId) return world._byId.get(p.capitalId) || null;
  return null;
}

function distTo(world, cap, ev) {
  // No vantage point (a fallen realm whose capital record was pruned) or no
  // event location = the scribes never hear of it. The old 0 default made
  // exactly these cases OMNISCIENT: every coordinate-less event was recorded
  // planet-wide (132/132 measured), and a long-dead realm's tradition kept
  // perfect knowledge of the world forever.
  if (!cap || ev.x === undefined || ev.y === undefined) return Infinity;
  let dx = Math.abs(cap.pos.x - ev.x);
  if (dx > world.tw / 2) dx = world.tw - dx;
  const dy = cap.pos.y - ev.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── biased narration: the court's version of an event ───────────────────
function biasedNarrate(world, ev, me) {
  switch (ev.type) {
    case "settlement.captured":
      if (ev.to === me) {
        if (ev.from == null || ev.from < 0)
          return `${ev.sName} welcomed the realm's protection and joined it in gladness.`;
        return `${ev.sName} was delivered from the misrule of ${ev.fromName || "its oppressors"} and brought under the realm's peace.`;
      }
      if (ev.from === me)
        return `${ev.sName} was treacherously seized by ${ev.toName || "the enemy"}, against every oath and custom.`;
      break;
    case "war.began":
      if (ev.from === me)
        return `The realm took up arms against ${ev.defName || "its neighbour"} to answer years of provocation${ev.faithClash ? " and defend the true faith" : ""}.`;
      if (ev.to === me)
        return `${ev.name || "The enemy"} fell upon the realm without cause or warning${ev.crisis ? ", striking while the throne stood empty" : ""}.`;
      break;
    case "polity.seceded":
      if (ev.from === me)
        return `The ingrates of ${ev.seatName || "the province"}, fattened on the realm's peace, rose in faithless rebellion.`;
      if (ev.polity === me)
        return `The free people of ${ev.seatName || "the province"} cast off the yoke of ${ev.fromName || "the old realm"}.`;
      break;
    case "polity.shattered":
      if (ev.to === me)
        return `The tyrant's seat at ${ev.sName} was broken, and that proud empire humbled in a single season.`;
      if (ev.polity === me)
        return `Calamity: the capital fell to ${ev.toName || "the invader"}, and the realm was sundered.`;
      break;
    case "settlement.annexed":
      if (ev.to === me) return `${ev.sName} chose the realm's law of its own free will.`;
      if (ev.from === me) return `${ev.sName} was lured away by the schemes of ${ev.toName || "a rival"}.`;
      break;
    case "polity.restored":
      if (ev.polity === me) return `The nation rose again, as the old songs had promised it would.`;
      break;
    case "succession.crisis":
      if (ev.polity === me) return "The throne stood empty, and lesser men contended for it — a time of sorrow.";
      break;
  }
  return narrate(world, ev, me);
}

function foundingMyth(world, viewerId, p) {
  const cap = capitalOf(world, viewerId);
  const name = realmName(world, viewerId);
  const faith = p && p.faithId >= 0 ? getFaith(world, p.faithId) : null;
  const dyn = p && p.dynastyId >= 0 ? getDynasty(world, p.dynastyId) : null;
  const stretch = 1 + MYTH_ANTIQUITY * roll(world, viewerId, 0, "myth");
  const claimedAge = Math.round((world.step - (p ? p.foundedStep : 0)) * stretch);
  const since = Math.max(1, world.step - claimedAge);
  if (faith)
    return { step: since, type: "founding", text: `In the age before records, the gods of the ${faith.name} faith raised ${cap ? cap.name : name} from the ${cap && cap.waterAccess > 0.3 ? "waters" : "earth"} and set its people above all others.`, rumor: false };
  if (dyn)
    return { step: since, type: "founding", text: `It is told that ${dyn.name.replace(/(id|ene|ar|ian|ite|ald)$/, "")}, first of the blood, founded ${name} in the age of legends.`, rumor: false };
  return { step: since, type: "founding", text: `${name} is older than any record — its founding is remembered only in song.`, rumor: false };
}

/**
 * The chronicle as VIEWER's scribes keep it. Returns lines shaped like
 * getChronicle's ({step, type, text}) plus {rumor, lost} flags, so the UI
 * can render the tradition with its seams showing.
 */
export function perspectiveChronicle(world, viewerId, limit = 0) {
  if (viewerId == null || viewerId < 0) return [];
  const p = getPolity(world, viewerId);
  const cap = capitalOf(world, viewerId);
  const lit = cap && cap.knowledge ? (cap.knowledge.organization || 0) : 0;
  const horizon = HORIZON_BASE + HORIZON_LIT * lit;

  // own events + major world events, merged by step
  const own = eventsFor(world, "p:" + viewerId);
  const ownIds = new Set(own.map(e => e.id));
  const world_ = [];
  for (const ev of eventsOf(world)) {
    if (ownIds.has(ev.id) || !TRAVELS.has(ev.type)) continue;
    world_.push(ev);
  }
  // a tradition has no scribes before the realm existed — foreign events
  // older than the founding never entered any archive of OURS — and a FALLEN
  // realm's archive stops when its scribes do: nothing after endedStep enters
  // the tradition (a restoration reopens the record and the archive with it).
  const born = p ? p.foundedStep : 0;
  const died = p && p.endedStep >= 0 ? p.endedStep : Infinity;
  const all = own.concat(world_.filter(e => e.step >= born && e.step <= died)).sort((a, b) => a.step - b.step || a.id - b.id);

  // the realm's catastrophes: each sack of its story burns older records
  const sackSteps = own.filter(e => e.type === "polity.shattered" && e.polity === viewerId).map(e => e.step);

  const out = [];
  let foundingLost = false;
  for (const ev of all) {
    const mine = ownIds.has(ev.id);
    // information horizon for events the realm wasn't part of
    let rumor = false;
    if (!mine) {
      const d = distTo(world, cap, ev);
      if (d === Infinity) continue;                 // no location / no vantage point: truly deaf (the 0.04 floor leaked ~4% of these planet-wide)
      const know = Math.max(0.04, Math.min(1, 1.35 - d / horizon));
      const r = roll(world, viewerId, ev.id, "know");
      if (r > know) continue;                       // never heard of it
      if (r > know - RUMOR_BAND) rumor = true;      // heard of it, barely
    }
    // archive loss: each later sack burns older records
    let lost = false;
    for (const ss of sackSteps) {
      if (ev.step < ss && roll(world, viewerId, ev.id, "burn" + ss) > SACK_SURVIVAL) { lost = true; break; }
    }
    if (lost) {
      if (ev.type === "polity.founded" && ev.polity === viewerId) foundingLost = true;
      continue;
    }
    // shame: defeats that simply aren't written down
    if (mine && ev.type === "settlement.captured" && ev.from === viewerId && !ev.capital
        && roll(world, viewerId, ev.id, "shame") < SHAME_OMIT * Math.max(0, 0.5 + (p && p.personality ? p.personality.aggression || 0 : 0) * 0.5)) {
      continue;
    }
    let text;
    if (rumor) {
      const subj = ev.name || ev.sName || ev.faithName || ev.cultureName
        || (ev.polity != null && ev.polity >= 0 ? realmName(world, ev.polity) : "");
      text = `Travellers brought word${subj ? ` of ${subj}` : " from afar"}: ${narrate(world, ev, -1)}`;
    } else if (!mine) {
      const subj = ev.name || ev.sName || ev.faithName || ev.cultureName
        || (ev.polity != null && ev.polity >= 0 ? realmName(world, ev.polity) : "");
      text = `${subj ? subj + " — " : ""}${narrate(world, ev, -1)}`;
    } else {
      text = biasedNarrate(world, ev, viewerId);
    }
    out.push({ step: ev.step, type: categoryOf(ev, viewerId), text, rumor, evType: ev.type });
  }

  // a burned founding is retold as myth; an intact early record stands
  if (foundingLost || (sackSteps.length && !own.some(e => e.type === "polity.founded"))) {
    out.unshift(foundingMyth(world, viewerId, p));
  }
  if (sackSteps.length) {
    for (const ss of sackSteps) {
      out.push({ step: ss, type: "end", text: "(the annals of the years before this are ash — the archive burned with the capital)", rumor: false });
    }
    out.sort((a, b) => a.step - b.step);
  }
  const cond = condenseChronicle(out);
  return limit > 0 && cond.length > limit ? cond.slice(-limit) : cond;
}

/** Plain-text render (probes / exports). */
export function perspectiveText(world, viewerId, limit = 0) {
  return perspectiveChronicle(world, viewerId, limit).map(e => `[${e.step}] ${e.text}`);
}

/**
 * The "world bible" export: the true structured record plus each living
 * realm's own (biased) tradition — everything a reader needs to catch the
 * scribes lying.
 */
export function exportHistory(world, { traditions = 12 } = {}) {
  const polities = [];
  if (world.polities) for (const [id, p] of world.polities) polities.push({ id, ...p });
  const realms = (world.countries ? [...world.countries.values()] : [])
    .sort((a, b) => b.members.length - a.members.length).slice(0, traditions);
  return {
    step: world.step,
    seed: world.seed,
    preset: world.preset,
    events: eventsOf(world),
    polities,
    cultures: world.cultures ? [...world.cultures.values()] : [],
    faiths: world.faiths ? [...world.faiths.values()] : [],
    dynasties: world.dynasties ? [...world.dynasties.values()] : [],
    persons: world.persons ? [...world.persons.values()] : [],
    traditions: realms.map(c => ({
      polity: c.id,
      name: realmName(world, c.id),
      trueChronicle: eventsFor(world, "p:" + c.id).map(ev => `[${ev.step}] ${narrate(world, ev, c.id)}`),
      asRecorded: perspectiveText(world, c.id),
    })),
  };
}
