// ── The world's event log: structured, append-only, forever ──
//
// Every consequential moment is recorded as a STRUCTURED event — actors as
// entity ids, places as coordinates, payload as data — never as prose. Prose
// is a RENDERING (narrate, below); the chronicle panel, exports, and the
// historiography layer (false histories) are all views over this one log.
//
// Shape: { id, step, type, ...fields }. Field conventions:
//   polity / from / to  — polity ids        s / s2 — settlement ids
//   *Name               — display names CAPTURED AT EVENT TIME (so the log
//                         reads as contemporaries knew the actors, and dead
//                         entities still narrate; renames don't rewrite the past)
//   x, y                — place
//
// An index (world._evIndex) maps entity keys ("p:7", "s:12", "c:3", "f:2")
// to event ids so per-entity history is O(own events), not a scan.

import { POP_SCALE } from "../units.js";

export function eventsOf(world) {
  return world.events || (world.events = []);
}

function indexKeys(ev) {
  const keys = [];
  const push = (k) => { if (!keys.includes(k)) keys.push(k); };
  if (ev.polity != null && ev.polity >= 0) push("p:" + ev.polity);
  if (ev.from != null && ev.from >= 0) push("p:" + ev.from);
  if (ev.to != null && ev.to >= 0 && ev.to !== ev.from) push("p:" + ev.to);
  if (ev.s != null && ev.s >= 0) push("s:" + ev.s);
  if (ev.s2 != null && ev.s2 >= 0) push("s:" + ev.s2);
  if (ev.culture != null && ev.culture >= 0) push("c:" + ev.culture);
  if (ev.faith != null && ev.faith >= 0) push("f:" + ev.faith);
  if (ev.dynasty != null && ev.dynasty >= 0) push("d:" + ev.dynasty);
  return keys;
}

// Bound the live log on pathological (multi-100k-step) runs. Events are
// referenced BY POSITION (ev.id === array index; _evIndex stores positions), so
// compaction drops the oldest, reassigns ids = new positions, then reindexes.
// The cap sits far above any normal run (~0.4 events/step → a 15k-step validate
// makes ~6k), so it never fires in tests; it's a memory safety-valve, and
// historiography already models the loss of the deep past (archive loss).
const EVENT_CAP = 200000, EVENT_KEEP = 150000;
function compactEvents(world) {
  const events = world.events;
  events.splice(0, events.length - EVENT_KEEP);
  // Ids are PERMANENT (never reassigned): historiography keys every
  // deterministic know/rumor/burn roll on ev.id, so renumbering survivors
  // re-randomized every realm's tradition after one compaction (and froze
  // the worker's length-cursor ticker). Lookups map id → position via the
  // id of events[0] (ids are contiguous ascending by construction).
  reindexEvents(world);
}
const evBase = (events) => (events.length ? events[0].id : 0);

/** Append one event. Returns its id. `fields` is spread flat onto the record. */
export function logEvent(world, type, fields) {
  const events = eventsOf(world);
  if (events.length >= EVENT_CAP) compactEvents(world);   // keep the live log bounded
  if (world._nextEventId === undefined) world._nextEventId = events.length ? events[events.length - 1].id + 1 : 0;
  const ev = { id: world._nextEventId++, step: world.step | 0, type, ...fields };
  events.push(ev);
  if (!world._evIndex) world._evIndex = new Map();
  for (const k of indexKeys(ev)) {
    let arr = world._evIndex.get(k);
    if (!arr) world._evIndex.set(k, arr = []);
    arr.push(ev.id);
  }
  return ev.id;
}

/** All events touching an entity key ("p:7" / "s:12" / ...), oldest first. */
export function eventsFor(world, key, limit = 0) {
  const idx = world._evIndex && world._evIndex.get(key);
  if (!idx) return [];
  const events = eventsOf(world);
  const base = evBase(events);
  const ids = limit > 0 && idx.length > limit ? idx.slice(-limit) : idx;
  return ids.map(i => events[i - base]).filter(Boolean);   // compaction may have dropped the oldest
}

/** Rebuild the index from the log (used after loading a save). */
export function reindexEvents(world) {
  world._evIndex = new Map();
  for (const ev of eventsOf(world)) {
    for (const k of indexKeys(ev)) {
      let arr = world._evIndex.get(k);
      if (!arr) world._evIndex.set(k, arr = []);
      arr.push(ev.id);
    }
  }
}

// ── Narration: the TRUE chronicle's renderer ─────────────────────────────
// One event can read differently to each side (`as` = viewing polity id):
// a capture is a loss in one ledger and a conquest in the other. This is the
// neutral/omniscient narrator; the historiography layer builds BIASED
// narrators on the same templates.

const cityOf = (ev) => ((ev.tier | 0) >= 2 ? "the city of " : "");

const NARRATE = {
  "polity.founded"(ev, as) {
    void as;
    if (ev.how === "cradle") return "Founded at the dawn of civilisation.";
    if (ev.how === "secession") return `Broke away from ${ev.fromName || "its parent realm"} in a war of secession.`;
    if (ev.how === "fragment") return `Rose from the ruins of ${ev.fromName || "a fallen empire"}.`;
    if (ev.how === "frontier") return `${ev.seatName || "A frontier town"} declared itself a sovereign realm.`;
    if (ev.how === "tribal") return `${ev.name || "A people"} took their valley as a nation of the land.`;
    return `${ev.seatName || "A settlement"} became a realm of its own.`;
  },
  "polity.ended"(ev, as) {
    void as;
    if (ev.how === "conquest") return `Fell to ${ev.byName || "its conquerors"} and was erased from the map.`;
    if (ev.how === "absorbed") return `Was absorbed into ${ev.byName || "a neighbouring realm"}.`;
    if (ev.how === "succession") return "Shattered over a contested succession — its hordes and provinces going their separate ways under rival heirs.";
    return "Dissolved — its last cities scattered or fell silent.";
  },
  "polity.tablet"(ev) {
    return `The court of ${ev.sName || "the first city"} took up the tablet — ${ev.name || "the nation of the land"} became a state of rolls, tax and law.`;
  },
  "polity.restored"(ev) {
    return `The old nation rose again${ev.fromName ? `, casting off ${ev.fromName}` : ""}.`;
  },
  "polity.seceded"(ev, as) {
    if (as === ev.from) return `Province ${ev.seatName || "a city"} rose in revolt and broke away.`;
    return `Broke away from ${ev.fromName || "its parent realm"} in a war of secession.`;
  },
  "polity.receded"(ev, as) {
    if (as === ev.polity) return `The realm's grip failed on its far marches — ${ev.n === 1 ? "the community" : `${ev.n} communities`} beyond ${ev.sName || "the frontier"} ${ev.n === 1 ? "was" : "were"} left to fend for themselves.`;
    return `The grip of ${ev.name || "the old realm"} failed, and the marches beyond ${ev.sName || "the frontier"} were left to their own devices.`;
  },
  "polity.shattered"(ev, as) {
    if (as === ev.to) return `Stormed the enemy capital ${ev.sName || ""} and shattered the realm.`;
    return `Its capital ${ev.sName || ""} fell to ${ev.toName || "the enemy"} — the realm collapsed.`;
  },
  "settlement.captured"(ev, as) {
    if (ev.from == null || ev.from < 0)
      return `Brought the free ${(ev.tier | 0) >= 2 ? "city" : "town"} of ${ev.sName} under its rule.`;
    if (as === ev.from) return `Lost ${cityOf(ev)}${ev.sName} to ${ev.toName || "the enemy"}.`;
    return `Captured ${cityOf(ev)}${ev.sName} from ${ev.fromName || "the enemy"}.`;
  },
  "settlement.annexed"(ev, as) {
    if (ev.from == null || ev.from < 0) return `The free settlement ${ev.sName} joined the realm.`;
    if (as === ev.from) return `Ceded ${ev.sName} to ${ev.toName || "a neighbour"}.`;
    return `Peacefully absorbed ${ev.sName} from ${ev.fromName || "a neighbour"}.`;
  },
  "settlement.founded"(ev) {
    if (ev.city) return `The city of ${ev.sName} arose.`;
    if (ev.kind === "cradle") return `${ev.sName} was founded at the dawn of civilisation.`;
    if (ev.kind === "colony") return `The colony of ${ev.sName} was planted on a far shore.`;
    return `${ev.sName} was founded.`;
  },
  "market.dearth"(ev) { return `Dearth in ${ev.sName} — bread at famine prices in the market.`; },
  "market.boom"(ev) { return `${ev.sName}'s ${ev.good || "wares"} fetch extraordinary prices — a boom year.`; },
  "settlement.withered"(ev) { return `${ev.sName} withered away and was abandoned.`; },
  "settlement.dissolved"(ev) { return `${ev.sName} faded back into the countryside.`; },
  "farming.invented"(ev) { return `Farming was invented — the land around (${ev.x}, ${ev.y}) turned to the plough.`; },
  "settlement.abandoned"(ev) { return `${ev.sName} was abandoned.`; },
  "settlement.tier"(ev) {
    // ev.people is in CENSUS units (×1,000 people — src/sim/units.js); the
    // chronicle speaks in souls, so convert. "(10 souls)" for a 10,000-person
    // city was the units mistake CLAUDE.md warns about, in the user's own feed.
    const souls = ev.people != null ? ` (${(ev.people * POP_SCALE).toLocaleString("en-US")} souls)` : "";
    return ev.up
      ? `${ev.sName} grew into a ${ev.tierName}${souls}.`
      : `${ev.sName} declined to a ${ev.tierName}.`;
  },
  "colony.departed"(ev) {
    return ev.charter
      ? `By royal charter, a colony fleet was outfitted from the treasury and set sail from ${ev.sName}.`
      : `A colony fleet set sail from ${ev.sName}.`;
  },
  "town.planted"(ev) {
    return ev.march
      ? `The crown planted ${ev.sName} to hold the march.`
      : `The crown chartered ${ev.sName} to govern the countryside.`;
  },
  "colony.founded"(ev) { return `${ev.sName || "A colony"} was planted overseas under the flag of ${ev.fromName || "its mother country"}.`; },
  "colony.independent"(ev) {
    return ev.how === "metropole-fell"
      ? `${ev.name || "The colony"} was cast adrift — ${ev.fromName || "its mother country"} had fallen, and no successor claimed its charter.`
      : `${ev.name || "The colony"} cast off ${ev.fromName || "its mother country"} and declared itself sovereign.`;
  },
  "colony.inherited"(ev, as) {
    return as === ev.to
      ? `With the mantle of ${ev.fromName || "the fallen metropole"} came its charters: ${ev.name || "a colony"} now answers to this crown.`
      : `${ev.fromName || "The mother country"} fell, and the charter over ${ev.name || "the colony"} passed to ${ev.toName || "its successor"}.`;
  },
  "colony.subjugated"(ev, as) {
    return as === ev.from
      ? `The fleet anchored off ${ev.name || "a far court"}, and its crown accepted the protectorate.`
      : `Gunboats of ${ev.fromName || "an ocean power"} anchored off the seat of ${ev.name || "the realm"}; the court bowed to a colonial charter.`;
  },
  "polity.united"(ev, as) {
    return as === ev.into
      ? `The crowns were joined: the court of ${ev.name || "a kindred realm"} entered the realm in union.`
      : `The court of ${ev.name || "the realm"} joined its crown to ${ev.intoName || "a kindred neighbour"} — one people, one throne.`;
  },
  "polity.submitted"(ev, as) {
    if (ev.how === "union") {
      return as === ev.to
        ? `The crowns were joined: the court of ${ev.name || "a kindred realm"} entered the union beneath this throne.`
        : `In the troubles of the succession, the court of ${ev.name || "the realm"} joined its crown to ${ev.toName || "a kindred neighbour"} — one senior throne, two realms.`;
    }
    return as === ev.to
      ? `${ev.name || "A neighbouring statelet"} bent the knee and became a tributary of the realm.`
      : ev.how === "capitulation"
      ? `Beaten in the field, the court of ${ev.name || "the realm"} bent the knee to ${ev.toName || "the victor"} — a client crown under the conqueror's peace.`
      : `Facing hopeless odds, the court of ${ev.name || "the realm"} bowed to ${ev.toName || "a greater power"} — keeping its throne at the price of tribute.`;
  },
  "horde.raid"(ev, as) {
    if (as === ev.from) return `A raid season against ${ev.name || "the settled lands"} paid richly — the wagons came home heavy.`;
    const loot = ev.loot >= 1 ? ` ${ev.loot} in coin was carried off` : "";
    const cap = ev.captives >= 1 ? `${loot ? ";" : ""} ${ev.captives} souls were driven into the captive trains` : "";
    return `Riders out of the steppe — ${ev.fromName || "a horde"} — swept the borderlands.${loot}${cap}${loot || cap ? "." : ""}`;
  },
  "plague.virginSoil"(ev) { return `A pestilence unknown to ${ev.sName || "the people"} came ashore with the strangers, and they had no defence against it.`; },
  "war.ended"(ev, as) {
    const other = as === ev.polity ? (ev.toName || "its enemy") : (ev.name || "its enemy");
    if (ev.dead >= 1) return `The war with ${other} ended; some ${ev.dead} soldiers never came home.`;
    return `The war with ${other} ended.`;
  },
  "war.indemnity"(ev, as) {
    if (as === ev.polity) return `Peace was bought dearly: a great indemnity was paid to ${ev.toName || "the victors"}.`;
    return `${ev.name || "The beaten realm"} paid a heavy indemnity to ${ev.toName || "the victors"} at the peace.`;
  },
  "famine.struck"(ev) { void ev; return "A famine gripped the land."; },
  "plague.outbreak"(ev) { return ev.sName ? `Plague broke out in ${ev.sName} and swept through the realm.` : "Plague swept through the realm."; },
  "era.reached"(ev) { return `Reached the ${ev.eraName} era.`; },
  "arc.complete"(ev) { return ev.name ? `The world entered the ${ev.eraName} age — under ${ev.name}, civilisation climbed the last rung of the knowledge tree.` : `The world entered the ${ev.eraName} age — civilisation climbed the last rung of the knowledge tree.`; },
  "war.began"(ev, as) {
    const why = ev.claim ? " to press a claim to its throne" : ev.crisis ? " as the succession failed" : ev.faithClash ? " under the banner of the faith" : "";
    if (ev.rematch) {
      if (as === ev.to) return `The old war with ${ev.name || "the enemy"} flared again${why}.`;
      return `Renewed the old war against ${ev.defName || "a neighbour"}${why}.`;
    }
    if (as === ev.to) return `${ev.name || "An enemy"} marched against the realm${why}.`;
    return `Marched to war against ${ev.defName || "a neighbour"}${why}.`;
  },
  "war.claimWon"(ev, as) {
    if (as === ev.to) return `The war was lost — ${ev.personName} of ${ev.name || "a foreign house"} pressed a claim and took the throne; the realm passed under a foreign crown.`;
    return `The war of succession was won: ${ev.personName} pressed the claim and was crowned in ${ev.toName || "the enemy realm"}, uniting the two crowns.`;
  },
  "ruler.crowned"(ev) {
    const t = ev.title || (ev.female ? "Queen" : "King");
    const h = ev.dynastyName || "?";
    if (ev.how === "first") return `${t} ${ev.personName} of house ${h} took the throne — the first recorded sovereign.`;
    if (ev.how === "crisis") return `Out of the interregnum, ${t} ${ev.personName} of the new house ${h} seized the throne.`;
    if (ev.how === "claim") return `With the old line spent, ${t} ${ev.personName} of the foreign house ${h} pressed a blood claim and took the throne — a crown now shared with another realm.`;
    if (ev.how === "regency") return `The child ${ev.personName} took the throne of house ${h} at ${ev.age}, under a regency council.`;
    if (ev.how === "bastard") return `For want of a true-born heir, the bastard ${ev.personName} was raised to the throne of house ${h}.`;
    if (ev.how === "sibling") return `${t} ${ev.personName}, ${ev.female ? "sister" : "brother"} of the late sovereign, took up the crown of house ${h}.`;
    if (ev.how === "collateral") return `With the senior line spent, ${t} ${ev.personName} of a cadet branch of house ${h} took the crown.`;
    return `${t} ${ev.personName} succeeded to the throne of house ${h} at ${ev.age}.`;
  },
  "ruler.elected"(ev) {
    const t = ev.title || "Consul";
    const where = t === "Consul" ? " of the republic" : "";
    return `${ev.personName} of house ${ev.dynastyName || "?"} was elected ${t}${where}.`;
  },
  "ruler.elevated"(ev) {
    return `${ev.personName} was raised as ${ev.title || "High Priest"}, to rule in the faith's name.`;
  },
  "gov.changed"(ev) {
    const to = ev.to === "theocracy" ? "a theocracy ruled by its priesthood"
             : ev.to === "republic" ? "a republic, its magistrate elected"
             : ev.to === "despotism" ? "a despotism, ruled by the sword"
             : ev.to === "elective" ? "an elective monarchy, its king chosen by the magnates"
             : "a monarchy under a single crown";
    return `The order of the realm changed — it became ${to}.`;
  },
  "ruler.died"(ev) {
    const who = `${ev.title || ""} ${ev.personName}${ev.epithet ? " " + ev.epithet : ""}`.trim();
    return `${who} died at ${ev.age}, after a reign of ${ev.reign} years.`;
  },
  "succession.crisis"(ev) {
    void ev; return "The royal line failed — an interregnum of rival claimants.";
  },
  "dynasty.founded"(ev) {
    return `${ev.personName} founded house ${ev.dynastyName}.`;
  },
  "dynasty.extinct"(ev) {
    return `House ${ev.dynastyName} died out.`;
  },
  "dynasty.union"(ev) {
    return `${ev.personName} wed ${ev.person2Name} of a foreign court — the houses are joined.`;
  },
  "faith.founded"(ev) {
    return `A new faith arose in ${ev.sName || "a great town"} — the ${ev.character ? ev.character + " " : ""}priesthood of ${ev.faithName}.`;
  },
  "language.shift"(ev) {
    return `The tongue of the ${ev.cultureName} shifted with the generations — what was "${ev.was}" is now "${ev.now}".`;
  },
  "faith.schism"(ev) {
    return `The ${ev.faithName} rite broke communion with the ${ev.parentName} church — a schism declared from ${ev.sName || "the capital"}.`;
  },
  "faith.syncretized"(ev) {
    return `In ${ev.sName || "a great city"}, where the ${ev.parentName} and ${ev.parent2Name} faiths had long mingled, a new ${ev.character ? ev.character + " " : ""}creed was born — ${ev.faithName}.`;
  },
  "faith.faded"(ev) {
    return `The ${ev.faithName} faith dwindled away, its last temples fallen silent.`;
  },
  "polity.adoptedFaith"(ev) {
    return `The court embraced the ${ev.faithName} faith.`;
  },
  "culture.born"(ev) {
    return ev.parent >= 0
      ? `A new people, the ${ev.cultureName}, emerged from the ${ev.parentName || "old stock"}.`
      : `The ${ev.cultureName} people emerged.`;
  },
  "culture.diverged"(ev) {
    return `Generations of isolation made ${ev.sName || "the colony"}'s folk a people of their own — the ${ev.cultureName}.`;
  },
  "settlement.lapsed"(ev, as) {
    if (as === ev.from) return `Lost its grip on ${ev.sName || "a frontier town"} — the province went its own way.`;
    return `${ev.sName || "A town"} slipped free of ${ev.fromName || "its realm"}.`;
  },
  "growth.cities"(ev) { return ev.n === 1 ? "Its first city rose." : `Grew to ${ev.n} cities.`; },
  "wealth.milestone"(ev) { return `Treasury swelled past ${ev.label}.`; },
  // ── Economy / industry / society ──
  "industry.specialty"(ev) { return `${ev.sName} grew renowned for its ${String(ev.craft || "crafts").toLowerCase()}.`; },
  "city.holy"(ev) { return `${ev.sName} rose as a great seat of pilgrimage, rich with the offerings of the faithful.`; },
  "city.entrepot"(ev) { return `${ev.sName} became a great entrepôt, fattening on the carrying trade.`; },
  "city.financier"(ev) { return `The money-lenders of ${ev.sName} rose to bankroll the crown.`; },
  "city.slaver"(ev) { return `${ev.sName} grew rich as a market of the slave trade.`; },
  "city.plantation"(ev) { return `The fields of ${ev.sName} were given over to plantation, worked by the unfree.`; },
  "city.latifundia"(ev) { return `The smallholds around ${ev.sName} were swallowed into great estates, worked by slave gangs.`; },
  "mine.boom"(ev) { return `Rich veins were struck at ${ev.sName} — a mining boom.`; },
  "society.serfdom"(ev) { void ev; return "The peasantry were bound to the land — serfdom took hold across the realm."; },
  "society.emancipation"(ev) { void ev; return "The old bonds were broken — the realm's serfs won their freedom."; },
  "slave.revolt"(ev) { return `The unfree of ${ev.sName || "an estate"} rose in revolt, and the labour was lost.`; },
  "crown.debt"(ev) { return `The crown sank deeper into debt to its financiers${ev.label ? ` (owing ${ev.label})` : ""}.`; },
  "realm.monument"(ev) { void ev; return "Great monuments rose to the glory of the realm."; },
};

export function narrate(world, ev, as = -1) {
  const fn = NARRATE[ev.type];
  return fn ? fn(ev, as) : ev.type;
}

// Legacy chronicle colour categories, per viewing side (the panel colours by
// these). war/conquest and secession/founding are the same event seen from
// opposite ledgers.
export function categoryOf(ev, as = -1) {
  switch (ev.type) {
    case "polity.founded": return "founding";
    case "polity.tablet": return "founding";
    case "polity.restored": return "founding";
    case "polity.seceded": return as === ev.from ? "secession" : "founding";
    case "polity.receded": return "loss";
    case "polity.shattered": return as === ev.to ? "conquest" : "war";
    case "polity.ended": return "end";
    case "settlement.captured": return as === ev.from ? "war" : "conquest";
    case "settlement.annexed": return as === ev.from ? "loss" : "annex";
    case "famine.struck": return "famine";
    case "market.dearth": return "famine";
    case "market.boom": return "wealth";
    case "plague.outbreak": return "plague";
    case "era.reached": return "discovery";
    case "growth.cities": return "growth";
    case "wealth.milestone": return "wealth";
    case "settlement.founded": case "colony.departed": case "town.planted": return "founding";
    case "colony.founded": return "founding";
    case "colony.independent": return as === ev.from ? "loss" : "secession";
    case "colony.inherited": return as === ev.to ? "annex" : "society";
    case "colony.subjugated": return as === ev.from ? "annex" : "loss";
    case "polity.submitted": return as === ev.to ? "annex" : "loss";
    case "polity.united": return as === ev.into ? "annex" : "loss";
    case "horde.raid": return as === ev.from ? "wealth" : "loss";
    case "plague.virginSoil": return "plague";
    case "war.indemnity": return as === ev.polity ? "loss" : "wealth";
    case "war.ended": return "war";
    case "culture.born": case "culture.diverged": return "founding";
    case "language.shift": return "growth";
    case "faith.founded": case "polity.adoptedFaith": case "faith.syncretized": return "discovery";
    case "faith.schism": return "secession";
    case "faith.faded": return "loss";
    case "war.began": return as === ev.to ? "war" : "conquest";
    case "ruler.crowned": case "dynasty.founded": case "dynasty.union":
    case "ruler.elected": case "ruler.elevated": return "growth";
    case "gov.changed": return "society";
    case "ruler.died": case "dynasty.extinct": return "loss";
    case "succession.crisis": return "secession";
    case "settlement.lapsed": return as === ev.from ? "loss" : "growth";
    case "industry.specialty": return "industry";
    case "mine.boom": return "industry";
    case "city.entrepot": case "city.financier": return "trade";
    case "city.holy": return "faith";
    case "city.slaver": case "city.plantation": case "city.latifundia": case "society.serfdom":
    case "society.emancipation": case "slave.revolt": return "society";
    case "crown.debt": return "loss";
    case "realm.monument": return "wealth";
    default: return "growth";
  }
}

// Collapse chronicle noise before it reaches the reader. A militarist hegemon
// opens many fronts in a single season — the chronicle shouldn't list each as
// its own line. A run of same-step, same-direction war declarations becomes one
// entry with a "(— and N other fronts)" tail. Entries must carry `evType` (set
// by the chronicle builders, stripped here).
export function condenseChronicle(entries) {
  const out = [];
  const strip = (e) => { const { evType: _evType, ...rest } = e; return rest; };
  for (let i = 0; i < entries.length; ) {
    const e = entries[i];
    if (e.evType === "war.began") {
      let j = i + 1, n = 1;
      while (j < entries.length && entries[j].evType === "war.began"
             && entries[j].step === e.step && entries[j].type === e.type) { j++; n++; }
      if (n > 1) {
        const more = n - 1;
        out.push({ step: e.step, type: e.type, rumor: e.rumor,
          text: e.text.replace(/\s*\.?\s*$/, "") + ` — and ${more} other front${more > 1 ? "s" : ""}.` });
      } else out.push(strip(e));
      i = j;
    } else { out.push(strip(e)); i++; }
  }
  return out;
}
