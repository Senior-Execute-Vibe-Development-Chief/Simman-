// ── Persistent entity registry: polities ──
//
// A polity is a PERSISTENT record with a stable id and a lifecycle — unlike
// world.countries, which is a per-pass aggregation VIEW rebuilt from the
// settlements every polity interval (and stays that way; passes still read
// it for members/capital/budgets). The registry is where everything that
// must SURVIVE the rebuild lives: treasury and fiscal state (the old
// world.governments), temperament (the old world.personalities +
// _deadPersonalities archive), chronicle milestones (the old _chronMeta),
// names, and — later — dynasty / culture / faith attachments.
//
// Records are never deleted. A fallen realm keeps its record (endedStep set),
// its history stays queryable forever, and a restoration simply re-opens the
// same entity — restored Poland IS Poland, with its own character and story.
// A shattered realm's record also carries succId — the principal fragment
// that took up its mantle (conquest.js recordSuccessor) — so obligations
// bound to the crown (a colony's dependency link) can follow the succession.
// Lazily-attached fields (set only when the state exists): _overlord/_depKind
// (dependency bond), succId (mantle), _lastCharter (colonial-venture pacing,
// sea.js) — all ride the verbatim record through save/load.
//
// The polity id remains the founding-capital settlement id (unchanged scheme).

import { logEvent } from "./events.js";
import { getCulture, nameFor, dominantCulture } from "./cultures.js";
import { T } from "./tuning.js";

export function politiesOf(world) {
  return world.polities || (world.polities = new Map());
}

// Population scale for the admin-load size term — shared by the polity pass's
// per-member load (conquest.js) and the adoption fisc test below, so both
// price "how big is this community to govern" on the same ruler.
// ABSOLUTE by ruling (Tier-C C1 deflation audit): the fisc comparison's
// REVENUE side (people × capacity/Σpeople) is a ratio of census units and is
// label-supply invariant; this LOAD-side scale enters only log2-compressed
// (sizeMul = 1 + SIZE_LOAD·log2(1+people/SIZE_REF)), so C1's ~×0.6-0.75
// census deflation moves the load term marginally (direction: slightly more
// permissive adoption — measured in validation, not re-anchored per-site).
export const SIZE_REF = 1000;

/**
 * The FISC TEST (T.FISC_ADOPT): may this court AFFORD to adopt this community?
 *
 * Marginal revenue vs marginal load — a real mechanism, not a threshold on
 * strain (docs/budget-gated-expansion.md records why the bare strain gate
 * made the boom-bust WORSE: refusing subjects wholesale refuses their taxes).
 * Here the two sides of the ledger are compared for THIS community alone:
 *   • what its people FUND: the realm's own capacity-per-governed-person
 *     (c._capacity / Σ member people — both stamped by the polity pass) times
 *     the candidate's people. Fully emergent: a developed fisc affords more
 *     per head, an infant court almost nothing — no unit constant to tune.
 *   • what it COSTS: the same load ruler the coverage budget uses
 *     ((distance/holdRange) × size term), at steady state (recency and
 *     coercion → 1; consolidation transients are the momentum machinery's
 *     story, not the adoption decision's).
 * A community that pays for itself is adopted even by a strained realm (it
 * HELPS); one that cannot is refused even by a slack one (it would erode) —
 * so there is no global freeze and no fiscal death-spiral. Distance is the
 * wrap-aware euclidean (the terrain surcharge needs the polity pass's
 * Dijkstra, absent here) — a mild UNDER-estimate of true cost, i.e. the
 * permissive direction for a refusal gate.
 * Scope: PRIMARY adoption only (stateless community → realm): the crystallise
 * born-join and adoptAndFound. Conquest, realm↔realm border shifts, colonies
 * and a member region's own town spin-offs are untouched.
 * Courts with no stamped fisc yet (a realm before its first polity pass)
 * adopt freely — the first stamp gates everything after.
 */
export function fiscAdoptable(world, c, x, y, people) {
  const F = T.FISC_ADOPT || 0;
  if (!(F > 0) || !c) return true;
  const cap = c.capital, C = c._capacity;
  if (!cap || !cap.pos || !(C > 0)) return true;
  let P = 0;
  const mem = c.members || [];
  for (let i = 0; i < mem.length; i++) { const m = mem[i]; if (m && m.mode === "settled") P += m.people || 0; }
  if (!(P > 0)) return true;
  let dx = Math.abs(cap.pos.x - x); if (dx > world.tw / 2) dx = world.tw - dx;
  const dy = cap.pos.y - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const holdRange = Math.max(1, c.holdReach || c.range || 0);
  const sizeMul = 1 + T.SIZE_LOAD * Math.min(3, Math.log2(1 + (people || 0) / SIZE_REF));
  const load = (d / holdRange) * sizeMul;
  return (people || 0) * (C / P) >= F * load;
}

export function getPolity(world, id) {
  return id != null && id >= 0 ? (world.polities ? world.polities.get(id) || null : null) : null;
}

/**
 * Get-or-create the persistent record for a polity id. On first creation
 * logs polity.founded (unless opts.silent — used by the reconciler for
 * bookkeeping registrations that aren't a story moment).
 * opts: { how, seat (settlement), from (parent polity id), silent }
 */
export function ensurePolity(world, id, opts = {}) {
  if (id == null || id < 0) return null;
  const reg = politiesOf(world);
  let p = reg.get(id);
  if (p) {
    if (p.endedStep >= 0) {   // re-opened: an old nation re-forming under its id
      p.endedStep = -1;
      // The restored realm's seat is wherever it re-formed NOW — the previous
      // life's capitalId may point at a foreign city (or a ruin) and chronicle/
      // historiography locate the realm through it until the next polity pass.
      if (opts.seat) p.capitalId = opts.seat.id;
      const capS = world._byId ? world._byId.get(p.capitalId) : null;
      if (!opts.silent) logEvent(world, "polity.restored", {
        polity: id, name: p.name, fromName: opts.fromName, from: opts.from ?? -1,
        x: capS ? capS.pos.x | 0 : (opts.seat ? opts.seat.pos.x | 0 : undefined),
        y: capS ? capS.pos.y | 0 : (opts.seat ? opts.seat.pos.y | 0 : undefined),
      });
    }
    return p;
  }
  // Name the realm in its founding people's tongue, derived from the seat
  // (Velara the city begets Velarath the realm). T.STATE_OF_LAND callers have
  // no seat settlement — a nation of the land passes its name and culture
  // directly (derived from the ancestry field at its seat tile).
  let name = opts.name || null, cultureId = opts.cultureId ?? -1;
  if (!name && opts.seat) {
    cultureId = dominantCulture(opts.seat);
    const cul = getCulture(world, cultureId);
    if (cul) name = nameFor(world, cul, "realm", opts.seat.name);
  }
  p = {
    id,
    name,
    foundedStep: world.step | 0,
    endedStep: -1,
    capitalId: opts.seat ? opts.seat.id : id,
    // fiscal state (the old world.governments record, verbatim fields)
    treasury: 0, _revenue: 0, _spend: 0, fineness: 1.0,
    // T.TRIBUTE_OF_LAND: the in-kind stock (food units) skimmed from the
    // polity's LAND — the storehouse economy that predates coin. Persists
    // with the record, so a land nation's accumulated store simply CONTINUES
    // when it materialises as a realm: the temple storehouse the first city
    // inherits is the same field on the same record.
    tribute: 0,
    // T.CRAFTS_OF_LAND: durable craft stocks — metal (copper/tin/iron worked
    // where deposits lie under the claim: Vinca, Varna, Otzi's axe) and
    // prestige goods (the lux set: the currency of legitimacy, redistributed
    // at feasts to bind vassals). Cloth/pottery — the universal household
    // crafts — ride the tribute stock itself (Ur III's wool WAS tribute).
    metal: 0, prestige: 0,
    // temperament (personality.js fills lazily)
    personality: null,
    // chronicle milestone memory (the old world._chronMeta)
    chron: { era: -1, cities: 0, wealthBand: -1 },
    // attachments
    cultureId, faithId: -1, dynastyId: -1,
  };
  reg.set(id, p);
  if (!opts.silent) {
    logEvent(world, "polity.founded", {
      polity: id, name: p.name, how: opts.how || "emerged",
      seat: opts.seat ? opts.seat.id : id, seatName: opts.seat ? opts.seat.name : undefined,
      from: opts.from ?? -1, fromName: opts.fromName,
      x: opts.seat ? opts.seat.pos.x | 0 : undefined, y: opts.seat ? opts.seat.pos.y | 0 : undefined,
    });
  }
  return p;
}

/**
 * Bookkeeping accessor: get the record, creating it silently if missing —
 * but NEVER touching the lifecycle. Hot fiscal/chronicle paths (govOf, tax,
 * tariffs, personality) use this so that merely reading a dead realm's
 * record cannot silently resurrect it (endedStep stays set until an
 * explicit lifecycle site — reconcilePolities or a story event — reopens
 * it and logs the restoration).
 */
export function getOrCreateRecord(world, id, opts = {}) {
  if (id == null || id < 0) return null;
  const reg = politiesOf(world);
  return reg.get(id) || ensurePolity(world, id, { ...opts, silent: true });
}

/** Close a polity's lifecycle (record persists; history stays queryable). */
export function endPolity(world, id, how = "dissolved", by = -1, byName = undefined) {
  const p = getPolity(world, id);
  if (!p || p.endedStep >= 0) return;
  p.endedStep = world.step | 0;
  // The treasury is deliberately NOT zeroed: conquest seizure (fragmentRealm)
  // transfers it before ending, and any coin left on an unresolved fall rides
  // along on the record — a later restoration digs up the old war chest.
  // Money accounting counts ALIVE polities only, so a dead chest reads as
  // out of circulation either way (same as the old prune-deletion).
  p._momentum = 0;
  // Log WHERE the realm fell (its capital) so historiography's information
  // horizon applies — a coordinate-less ending was heard everywhere on the
  // planet instantly (distance defaulted to zero).
  const capS = world._byId ? world._byId.get(p.capitalId) : null;
  logEvent(world, "polity.ended", { polity: id, name: p.name, how, by, byName,
    x: capS ? capS.pos.x | 0 : undefined, y: capS ? capS.pos.y | 0 : undefined });
}

/**
 * Reconcile the registry against the live per-pass country view: register
 * substantial newcomers, close records whose realm has vanished. Transient
 * one-village "countries" (fresh settlements default to their own id until
 * the territory pass assigns them) are not registered — a polity begins
 * when it has more than one member, a sovereign seat, or any treasury.
 */
export function reconcilePolities(world, countries) {
  const reg = politiesOf(world);
  // The countries VIEW passed in was built at the TOP of the polity pass;
  // states minted MID-pass (secession, rebellion, fragmentation) are not in
  // it. Lifecycle truth is the settlements themselves — recompute the live
  // id set here, so a realm born this pass is never closed as "dissolved"
  // at birth (which also silently corrupted every lifespan statistic).
  const live = new Set();
  for (const s of world.settlements) {
    if (s.mode === "settled" && s.countryId >= 0) live.add(s.countryId);
  }
  for (const [id, c] of countries) {
    if (!live.has(id)) continue;   // vanished mid-pass; the end-scan below closes it
    if (reg.has(id)) { const p = reg.get(id); if (p.endedStep >= 0) ensurePolity(world, id, { seat: c.capital }); p.capitalId = c.capitalId; continue; }
    const substantial = c.members.length > 1
      || (c.capital && (c.capital._sovereignSeat != null || (c.capital.tier | 0) >= 1));
    if (substantial) ensurePolity(world, id, { how: "emerged", seat: c.capital });
  }
  for (const p of reg.values()) {
    if (p.endedStep >= 0 && live.has(p.id)) ensurePolity(world, p.id);   // alive again under its old id — log the restoration
    // T.STATE_OF_LAND: a nation of the land has no settled member BY DESIGN —
    // it lives on its territory and people until a city rises inside it (then
    // it materialises as a realm and leaves the land-seat register) or its
    // basin empties (the register drops it). Never "dissolved" for lacking a
    // settlement it was never required to have.
    else if (p.endedStep < 0 && !live.has(p.id)
      && !(world._landSeats && world._landSeats.has(p.id))) endPolity(world, p.id, "dissolved");
  }
}

/** T.TRIBUTE_OF_LAND — the storehouse economy (Wave 6; layers 2-3 of the
 *  economic ladder: subsistence lives on the FIELD already — this is the
 *  polity SKIMMING it, in kind, before markets or money exist).
 *
 *  Every polity — realm or nation of the land — draws tribute from the FIELD
 *  PEOPLE UNDER ITS BORDERS, not from its settlement roster: grain into the
 *  storehouse, labour, kind. take = landPeople × the sim's own subsistence
 *  flow (TRIB_FOOD_PER_POP, the civilian demand constant in updateFood) ×
 *  TRIBUTE_RATE (0.10 — the tithe, the historical floor of harvest taxation;
 *  Egypt ran ~0.20) × extraction (0.3 flat for a chiefdom; 0.3 + 0.7×org for
 *  a realm — bureaucratisation triples the take, so state capacity is an
 *  emergent economic quantity, never a label). Storage caps at ~two years of
 *  the polity's own take (granaries rot; 1-2 year reserves were the norm),
 *  and a REALM's overflow SELLS into its capital's market at the LIVE
 *  scarcity-scaled grain price (_grainPrice, foodHierarchy) — the
 *  Egypt-sells-grain channel and the monetisation of taxation in one
 *  mechanism, at real prices, no price constant. A land nation sells nothing
 *  (pre-monetary by definition); its store waits for the city that will
 *  inherit it — record continuity IS the dowry. Capitals draw the store down
 *  against famine per-tick in updateFood (Joseph's granary). */
const TRIB_FOOD_PER_POP = 0.0030;   // the civilian food-demand constant (settlement.js updateFood): one person's subsistence flow per tick
const TRIBUTE_RATE = 0.10;
const EXTRACT_CHIEF = 0.3;
const TRIBUTE_STORE_TICKS = 1000;   // ÷_dt at use — ~two years of take, the wither-window's own time convention
// ── T.CRAFTS_OF_LAND: what the land makes besides food ──────────────────
// Household industry (cloth, pots) is universal and rides tribute; the
// DEPOSIT-SITED crafts are location-determined — obsidian villages, the
// Vinca copper district, Solnitsata's salt — and yield durable stocks the
// court can trade. CRAFT_FLOW is the deposit-industry share of a person's
// labor at full deposit richness (~a sixth of the subsistence flow: village
// specialisation is part-time, seasonal); stocks are durable (no rot) but
// wear (METAL_WEAR — tools break, prestige goods are consumed at feasts).
const CRAFT_FLOW = 0.0005;
const CRAFT_STORE_TICKS = 10000;     // ÷_dt — durables accumulate ~a generation of flow before saturating
const METAL_WEAR = 0.995;            // per fisc firing: weapons wear, hoards leak
// Court exchange (administered trade — Polanyi): grain for metal and
// prestige at CUSTOMARY ratios, court to court, within expedition reach.
// The ratios are the Mesopotamian barley-metal equivalency band
// (order-of-magnitude: a unit of worked copper for tens of units of grain;
// lapis/gold dearer again); the reach is the Byblos run (~2,000 km).
const COURT_RATIO_METAL = 80;        // grain-equivalents per metal unit
const COURT_RATIO_PRESTIGE = 240;    // prestige goods ~3x metal
const COURT_REACH_REF = 12;          // ref-tiles (~2,000 km at the reference grid)
const PRESTIGE_FEAST = 0.02;         // prestige spent per member per firing at the feast...
const PRESTIGE_LOYAL_W = 0.002;      // ...buying this much loyalty (the redistribution economy)
function craftDeps(world) {
  let d = world._craftDeps;
  if (d && d.N === world.N) return d;
  const metal = new Float32Array(world.N), lux = new Float32Array(world.N);
  const dep = world.deposits || {};
  for (const id of ["copper", "tin", "iron"]) {
    const a = dep[id]; if (!a) continue;
    for (let i = 0; i < world.N; i++) metal[i] += a[i];
  }
  for (const id of ["precious", "gems", "spices", "furs", "incense", "dyes"]) {
    const a = dep[id]; if (!a) continue;
    for (let i = 0; i < world.N; i++) lux[i] += a[i];
  }
  return world._craftDeps = { N: world.N, metal, lux };
}
export function updateTribute(world, interval) {
  if (!T.TRIBUTE_OF_LAND) return;
  const pf = world.popField;
  if (!pf || !(world._onePopScale > 0)) return;
  const co = world._countryOwner, lo = world._landOwner;
  if (!co && !lo) return;
  const bridge = world._onePopScale;
  // One sweep: field people by effective political owner (realms trump tribes)
  // — and, under CRAFTS_OF_LAND, the deposit-weighted people working the
  // land's metal and prestige-goods sources.
  const crafts = T.CRAFTS_OF_LAND ? craftDeps(world) : null;
  const take = new Map();
  const takeM = crafts ? new Map() : null, takeL = crafts ? new Map() : null;
  for (let i = 0; i < world.N; i++) {
    const p0 = pf[i];
    if (p0 <= 0) continue;
    let id = co ? co[i] : -1;
    if (id < 0 && lo) id = lo[i];
    if (id < 0) continue;
    take.set(id, (take.get(id) || 0) + p0);
    if (crafts) {
      const m = crafts.metal[i], l = crafts.lux[i];
      if (m > 0) takeM.set(id, (takeM.get(id) || 0) + m * p0);
      if (l > 0) takeL.set(id, (takeL.get(id) || 0) + l * p0);
    }
  }
  const dt = world._dt || 1;
  const storeTicks = TRIBUTE_STORE_TICKS / dt;
  for (const [id, fieldPeople] of take) {
    const p = getPolity(world, id);
    if (!p || p.endedStep >= 0) continue;
    const landCensus = fieldPeople * bridge;
    const c = world.countries ? world.countries.get(id) : null;
    const org = c && c.capital && c.capital.knowledge ? (c.capital.knowledge.organization || 0) : -1;
    const extract = org >= 0 ? EXTRACT_CHIEF + (1 - EXTRACT_CHIEF) * org : EXTRACT_CHIEF;
    const perTick = landCensus * TRIB_FOOD_PER_POP * TRIBUTE_RATE * extract;
    const cap = perTick * storeTicks;
    p._tribCap = cap;   // the exchange pass reads surplus/deficit against this
    p.tribute = (p.tribute || 0) + perTick * dt * interval;
    if (crafts) {
      const mFlow = (takeM.get(id) || 0) * bridge * CRAFT_FLOW * extract;
      const lFlow = (takeL.get(id) || 0) * bridge * CRAFT_FLOW * extract;
      const craftCap = CRAFT_STORE_TICKS / dt;
      p.metal = Math.min((p.metal || 0) * METAL_WEAR + mFlow * dt * interval, mFlow * craftCap + 1);
      p.prestige = Math.min((p.prestige || 0) * METAL_WEAR + lFlow * dt * interval, lFlow * craftCap + 1);
      // The feast: a realm redistributes prestige goods to bind its members
      // — imported lapis IS loyalty. (Land nations have no member roster yet;
      // their hoard rides to the dowry.)
      if (c && c.members && c.members.length && p.prestige > PRESTIGE_FEAST * c.members.length) {
        p.prestige -= PRESTIGE_FEAST * c.members.length;
        for (const m of c.members) if (m.mode === "settled") m.loyalty = Math.min(1, (m.loyalty || 0) + PRESTIGE_LOYAL_W);
      }
    }
    if (p.tribute > cap) {
      const overflow = p.tribute - cap;
      p.tribute = cap;
      // The court sells the overflow — realms only, at the capital's live
      // scarcity-scaled grain price. A polity without a market keeps kind.
      // A SALE, not a mint: the money supply is closed (coin enters only via
      // mining — the quantity-theory price system reads M/T), so the crown's
      // grain is PAID FOR with coin the capital's market actually holds, and
      // the market takes delivery of what it bought. The first build credited
      // treasury from nothing and the stylized market-integration check
      // caught the distortion (drop-windows widening spread) — measured, and
      // exactly what unbacked injection does to a closed price system.
      const capS = c ? c.capital : null;
      const price = capS ? (capS._grainPrice || 0) : 0;
      if (price > 0 && capS && (capS.wealth || 0) > 0) {
        const coin = Math.min(overflow * price, capS.wealth);
        capS.wealth -= coin;
        p.treasury = (p.treasury || 0) + coin;
        p._revenue = (p._revenue || 0) + coin;
        capS.food = (capS.food || 0) + coin / price;
      }
    }
  }
  if (T.CRAFTS_OF_LAND) courtExchange(world, take);
}

/** Layer 3 — administered trade between courts (Byblos, Uluburun): a court
 *  with a full storehouse and no metal seeks a court in expedition reach
 *  holding the opposite, and they swap at the customary ratio. Deterministic:
 *  courts in id order, nearest eligible partner, id tiebreak. */
function courtExchange(world, take) {
  const reg = world.polities;
  if (!reg) return;
  const rn = Math.max(1, world.tw / 240);
  const reach = COURT_REACH_REF * rn, reach2 = reach * reach;
  const courts = [];
  if (world.countries) for (const [id, c] of world.countries) {
    const p = reg.get(id);
    if (p && p.endedStep < 0 && c.capital && take.has(id)) courts.push({ id, p, x: c.capital.pos.x, y: c.capital.pos.y });
  }
  if (world._landSeats) for (const [id, r] of world._landSeats) {
    const p = reg.get(id);
    if (p && p.endedStep < 0 && take.has(id)) courts.push({ id, p, x: r.ti % world.tw, y: (r.ti / world.tw) | 0 });
  }
  courts.sort((a, b) => a.id - b.id);
  for (const A of courts) {
    const pa = A.p, capA = pa._tribCap || 0;
    if (!(capA > 0) || pa.tribute < capA * 0.5) continue;          // no surplus to send
    if ((pa.metal || 0) > 1 && (pa.prestige || 0) > 1) continue;   // wants nothing
    let best = null, bestD2 = Infinity;
    for (const B of courts) {
      if (B.id === A.id) continue;
      const pb = B.p, capB = pb._tribCap || 0;
      if (!((pb.metal || 0) > 1 || (pb.prestige || 0) > 1)) continue;   // nothing to give
      if (capB > 0 && pb.tribute > capB * 0.8) continue;               // their stores are full — grain is worthless to them
      let dx = Math.abs(A.x - B.x); if (dx > world.tw / 2) dx = world.tw - dx;
      const dy = A.y - B.y, d2 = dx * dx + dy * dy;
      if (d2 <= reach2 && d2 < bestD2) { bestD2 = d2; best = B; }
    }
    if (!best) continue;
    const pb = best.p;
    const grain = Math.min(pa.tribute - capA * 0.5, capA * 0.25, Math.max(0, (pb._tribCap || capA) - pb.tribute));
    if (!(grain > 0)) continue;
    // Prefer metal (the thing bronze-age courts crossed seas for), else prestige.
    if ((pb.metal || 0) > 1) {
      const m = Math.min(pb.metal, grain / COURT_RATIO_METAL);
      if (m > 0) { pb.metal -= m; pa.metal = (pa.metal || 0) + m; pa.tribute -= m * COURT_RATIO_METAL; pb.tribute += m * COURT_RATIO_METAL; }
    } else {
      const l = Math.min(pb.prestige, grain / COURT_RATIO_PRESTIGE);
      if (l > 0) { pb.prestige -= l; pa.prestige = (pa.prestige || 0) + l; pa.tribute -= l * COURT_RATIO_PRESTIGE; pb.tribute += l * COURT_RATIO_PRESTIGE; }
    }
  }
}
