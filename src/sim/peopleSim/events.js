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
  if (ev.polity != null && ev.polity >= 0) keys.push("p:" + ev.polity);
  if (ev.from != null && ev.from >= 0) keys.push("p:" + ev.from);
  if (ev.to != null && ev.to >= 0 && ev.to !== ev.from) keys.push("p:" + ev.to);
  if (ev.s != null && ev.s >= 0) keys.push("s:" + ev.s);
  if (ev.s2 != null && ev.s2 >= 0) keys.push("s:" + ev.s2);
  if (ev.culture != null && ev.culture >= 0) keys.push("c:" + ev.culture);
  if (ev.faith != null && ev.faith >= 0) keys.push("f:" + ev.faith);
  if (ev.dynasty != null && ev.dynasty >= 0) keys.push("d:" + ev.dynasty);
  return keys;
}

/** Append one event. Returns its id. `fields` is spread flat onto the record. */
export function logEvent(world, type, fields) {
  const events = eventsOf(world);
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
  "growth.cities"(ev) { return ev.n === 1 ? "Its first city rose." : `Grew to ${ev.n} cities.`; },
  "wealth.milestone"(ev) { return `Treasury swelled past ${ev.label}.`; },
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
    default: return "growth";
  }
}
