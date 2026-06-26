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
  for (let i = 0; i < events.length; i++) events[i].id = i;
  reindexEvents(world);
}

/** Append one event. Returns its id. `fields` is spread flat onto the record. */
export function logEvent(world, type, fields) {
  const events = eventsOf(world);
  if (events.length >= EVENT_CAP) compactEvents(world);   // keep the live log bounded
  const ev = { id: events.length, step: world.step | 0, type, ...fields };
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
  const ids = limit > 0 && idx.length > limit ? idx.slice(-limit) : idx;
  return ids.map(i => events[i]);
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
    return `${ev.seatName || "A settlement"} became a realm of its own.`;
  },
  "polity.ended"(ev, as) {
    void as;
    if (ev.how === "conquest") return `Fell to ${ev.byName || "its conquerors"} and was erased from the map.`;
    if (ev.how === "absorbed") return `Was absorbed into ${ev.byName || "a neighbouring realm"}.`;
    return "Dissolved — its last cities scattered or fell silent.";
  },
  "polity.restored"(ev) {
    return `The old nation rose again${ev.fromName ? `, casting off ${ev.fromName}` : ""}.`;
  },
  "polity.seceded"(ev, as) {
    if (as === ev.from) return `Province ${ev.seatName || "a city"} rose in revolt and broke away.`;
    return `Broke away from ${ev.fromName || "its parent realm"} in a war of secession.`;
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
    if (ev.kind === "cradle") return `${ev.sName} was founded at the dawn of civilisation.`;
    if (ev.kind === "colony") return `The colony of ${ev.sName} was planted on a far shore.`;
    return `${ev.sName} was founded.`;
  },
  "settlement.withered"(ev) { return `${ev.sName} withered away and was abandoned.`; },
  "settlement.abandoned"(ev) { return `${ev.sName} was abandoned.`; },
  "settlement.tier"(ev) {
    return ev.up
      ? `${ev.sName} grew into a ${ev.tierName} (${ev.people} souls).`
      : `${ev.sName} declined to a ${ev.tierName}.`;
  },
  "colony.departed"(ev) { return `A colony fleet set sail from ${ev.sName}.`; },
  "famine.struck"(ev) { void ev; return "A famine gripped the land."; },
  "plague.outbreak"(ev) { return ev.sName ? `Plague broke out in ${ev.sName} and swept through the realm.` : "Plague swept through the realm."; },
  "era.reached"(ev) { return `Reached the ${ev.eraName} era.`; },
  "war.began"(ev, as) {
    const why = ev.crisis ? " as the succession failed" : ev.faithClash ? " under the banner of the faith" : "";
    if (as === ev.to) return `${ev.name || "An enemy"} marched against the realm${why}.`;
    return `Marched to war against ${ev.defName || "a neighbour"}${why}.`;
  },
  "ruler.crowned"(ev) {
    const t = ev.title || (ev.female ? "Queen" : "King");
    const h = ev.dynastyName || "?";
    if (ev.how === "first") return `${t} ${ev.personName} of house ${h} took the throne — the first recorded sovereign.`;
    if (ev.how === "crisis") return `Out of the interregnum, ${t} ${ev.personName} of the new house ${h} seized the throne.`;
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
    case "polity.restored": return "founding";
    case "polity.seceded": return as === ev.from ? "secession" : "founding";
    case "polity.shattered": return as === ev.to ? "conquest" : "war";
    case "polity.ended": return "end";
    case "settlement.captured": return as === ev.from ? "war" : "conquest";
    case "settlement.annexed": return as === ev.from ? "loss" : "annex";
    case "famine.struck": return "famine";
    case "plague.outbreak": return "plague";
    case "era.reached": return "discovery";
    case "growth.cities": return "growth";
    case "wealth.milestone": return "wealth";
    case "settlement.founded": case "colony.departed": return "founding";
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
    case "city.slaver": case "city.plantation": case "society.serfdom":
    case "society.emancipation": case "slave.revolt": return "society";
    case "crown.debt": return "loss";
    case "realm.monument": return "wealth";
    default: return "growth";
  }
}
