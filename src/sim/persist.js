// ── Versioned save / load for a running world ──
//
// A save stores the world's IDENTITY (seed + generation params) and its
// DYNAMIC state — settlements, polities, the event log, money, roads,
// depletion, epidemics. Terrain is NOT stored: worldgen is deterministic,
// so the loader rebuilds it from the meta via the same pipeline the app
// uses, then lays the dynamic state back over it.
//
// What round-trips EXACTLY: everything in the save (the smoke test checks
// save→load→save hash identity AND that a loaded world's continuation stays
// close to the uninterrupted run). What re-warms instead: per-pass
// transients that the sim rebuilds on its own cadence anyway — war fronts
// (next muster/conquest tick), road trade-reach caches (next plan cycle),
// sea lanes (next sea pass), spatial grids (next tick). A loaded world is
// the same world mid-breath, not a frame-exact clone of an uninterrupted
// run across those warm-up intervals.
//
// RULE: any field that carries real cross-tick state — anything a mechanism
// reads back on a later tick that is not deterministically rebuilt from other
// saved state — MUST be serialized here (settlement fields in SETT_FIELDS,
// world state in maps{}/tables{}) or re-derived in loadWorld. The smoke
// test's continuation gate exists to catch omissions.

import { buildWorld as pipelineBuild } from "./pipeline.js";
import { initPeopleSim } from "./peopleSim/index.js";
import { reindexEvents } from "./peopleSim/events.js";
import { computeTerritory } from "./peopleSim/territory.js";
import { rederiveSiteStatics } from "./peopleSim/settlement.js";
import { reindexRoads } from "./peopleSim/roads.js";
import { recomputeClimMod } from "./peopleSim/climate.js";
import { rebuildCountries, updateAlliances, rebuildOverlords } from "./peopleSim/conquest.js";
import { T, applyTuning, resetTuning, tuningDefaults } from "./peopleSim/tuning.js";
import { ensureIdentityField, IDENTITY_K } from "./peopleSim/identityField.js";

// Stage 2 (T.TILE_IDENTITY) save quantisation: the culture layer keeps K=4
// mixture slots in memory but persists the top-2 (dominant-first by
// construction — every writer sorts) — ids Int16 + shares Uint8, ≈6 B/tile
// before base64. The dropped residue is sub-20% by the writers' SEC_MIN rules
// and is re-earned by the assimilation dynamics after load.
function top2Ids(world) {
  const K = IDENTITY_K, src = world.tileCulId, N = world.N;
  const out = new Int16Array(N * 2);
  for (let ti = 0; ti < N; ti++) { out[ti * 2] = src[ti * K]; out[ti * 2 + 1] = src[ti * K + 1]; }
  return out;
}
function top2Shrs(world) {
  const K = IDENTITY_K, src = world.tileCulShr, N = world.N;
  const out = new Uint8Array(N * 2);
  for (let ti = 0; ti < N; ti++) { out[ti * 2] = src[ti * K]; out[ti * 2 + 1] = src[ti * K + 1]; }
  return out;
}

export const SAVE_VERSION = 28;  // v28: contested-crest holds (CREST_HOLD) ON (v<28 guard); v27: porter-bound reach (PORTER_BOUND) ON (v<27 guard); v26: the apparatus feeds on conquest (APPARATUS_LOOT) ON (v<26 guard); v25: the imperial apparatus (APPARATUS - works stock funds capacity) ON (v<25 guard); v24: the sea learns by demand + the admiralty (SEA_DEMAND, ADMIRALTY) ON (v<24 guard); v23: workable land (TILLAGE) ON (v<23 guard); v22: reach as a maintained works stock (STATE_WORKS) added — SHIPS AT 0, refuted as a size lever (docs/atlas-gap-2026-08-14.md); guard inert while def 0; v21: vassal integration (SATRAPIZE) ON (v<21 guard); v20: managed water hits the optimum (FLOOD_OPT) ON (v<20 guard); v19: fish OFF (FISH def 0, pre-v19 pins 1) + organic takes (ORGANIC_TAKE) ON (v<19 guard); v18: starving cores shed (STARVE_SHED) ON (v<18 guard); v17: sieges won by hunger (SIEGE_STARVE) ON (v<17 guard); v16: grounded zero-tech reach (REACH_GROUND) ON (v<16 guard); v15: segmentary fission (FISSION) ON (v<15 guard); v14: the conquest cascade (CONQUEST_CASCADE) ON (v<14 guard); v13: the peer lattice (PEER_LATTICE) ON (v<13 guard); v12: the caging law (STATE_CAGE) ON (v<12 guard); v11: the state frontier (ORG_CONTACT) ON (v<11 guard); v10: the union of crowns ON (v<10 guard); v9: basin-wide invention ignition ON (v<9 guard); v8: ledger-reach capacity + the seamless core-hold handoff ON (v<8 guard); v7: millet + water-access band ON (v<7 guard); v6: biogeography + irrigation ON (v<6 guard); v5: the divergence lane ON (v<5 guard)
// v1 → v2: added settlement fields (_riverAcc/_confine/_rugged/_orgApt/_credit/
// _lastBorrow/_rivalN), world tables (truces, warSeenAt, schismAt, cBudgetRamp,
// inheritReach, inflP, inflRef, lastSyncretismAt), sparse per-tile maps
// (tileCapturedAt, soilFatigue), claimPress, and the realWind identity flag.
// Loading is additive-tolerant: every new field has a load default (or is
// re-derived), so v1 saves migrate by simply loading.
// v2 → v3: the reactive-settlement model (TILE_POLITY + CATCHMENT_CLIP) became
// default-ON. No new PAYLOAD — the bump exists only so loadWorld can tell a
// pre-reactive world (made when both levers defaulted OFF and therefore stored NO
// delta for them) from a modern one, and keep it in its original regime on load
// instead of silently continuing it under the reactive default. See loadWorld.
// v3 → v4: identity Stage 2 (T.TILE_IDENTITY, identityField.js) — the per-tile
// CULTURE layer became persistable sim state (maps.tileCul2Id/tileCul2Shr,
// top-2 quantised). Additive-tolerant both ways: the payload exists only when
// the lever ran (a lever-off v4 save carries no new keys), and a v≤3 (or
// lever-off) save loaded under the lever simply re-seeds the field from the
// city mirror on the first stepIdentityField firing — the correct
// no-better-information prior, not a regime fork.

// Persistent per-settlement state. Everything else on a settlement object is
// a derived cache some pass rebuilds (territory tallies, trade reach, money
// smoothers) — new fields that carry real cross-tick state belong HERE.
const SETT_FIELDS = [
  "id", "name", "foundedStep", "parentSettlementId", "mode", "tier",
  "people", "food", "wealth", "army", "infrastructure", "waterAccess", "_buildableArea",
  "crops", "countryId", "loyalty", "unrest", "liegeId", "_foodNet",
  "_homeland", "_homelandFell", "_sovereignSeat", "_integratedAt", "_conqueredAt",
  "_sackedAt", "_siegeAt", "_warAt", "_ambition",
  "_popPeak", "_witherSince", "lastFoundAttempt", "_lastColony", "_lastColonySent",
  "_thinBasinSince",   // DISSOLVE_TOWNS sustain clock — dropping it silently reset every pending town dissolution on load (caught by the functional-resume gate the moment leaner hearth worlds put towns near the bar)
  "_coreHoldCapF",     // CORE_HOLD spike-handoff floor bound (field units, stashed at the mint) — dropping it would re-open the birth-crater capacity gap on every load
  "_coloniesSent", "_isColony", "_overlordCC", "_fisherFrac",   // fisher labor share (T.FISH_LABOR) — carries the boats-built ramp across ticks (_shoreTiles is static geography, recomputed lazily)
  "_famineUntil", "_harvestMul", "_plagueUntil", "_plagueImmuneUntil", "_plagueActive",
  "_diseaseLoad", "_contacted", "_virginUntil",   // endemic immunity load + virgin-soil (Columbian) contact state
  "cultureId", "culMix", "faithMix", "langMix", "ancMix", "_isColony", "_isolatedSince", "_ethnoSince", "_driftSince", "_diverged",
  "_specKey", "_specStr",   // agglomeration: the town's locked-in craft specialty + its strength
  "_unfree", "_cashFrac", "_captives",   // coerced labour: unfree workforce, cash-crop land, unsold captives
  "_captiveCul", "_captiveAnc",          // captives' origin pools (SLAVE_PEOPLE): count-weighted [[id, n], ...]
  "_serf",                               // serfdom: land-tenure coercion level (0..1)
  "_estates",                            // latifundia: elite estate consolidation of the land (0..1)
  "_chronFlags",                         // chronicle: which "became X" archetype events have fired
  "_peakTier",                           // chronicle: highest tier ever reached (so growth is announced once)
  "_riverAcc", "_confine", "_rugged",    // static site attributes (re-derived on load if absent — v1 saves)
  "_orgApt",                             // heritable organisation aptitude (seasonal-selection ratchet)
  "_credit",                             // banking: how much of wealth is conjured credit (Phase 5)
  "_lastBorrow",                         // crop-package borrow cooldown (T.CROP_AXIS)
  "_rivalN",                             // peer-weighted rival contact (competition signal)
  "_hegF", "_peerPeak",                  // hegemonic stagnation: decline-from-peak peer pressure + the peak ratchet
  "_gPrice", "_gShare",                  // goods vector (T.GOODS_PRICES): local per-good prices + craft labour shares — the market's memory (plain number arrays)
  "_gStock", "_gCapx",                   // merchant warehouse stock (T.GOODS_STOCKS) + invested craft capital (T.GOODS_INVEST) — both carry cross-tick state
];

// Load-bearing per-settlement DYNAMIC state that the hashWorld core loop omitted:
// money (credit), coerced labour, heritable aptitude, competition, endemic-immunity
// load, agglomeration strength, and the ethnogenesis mixes. ALL are in SETT_FIELDS
// (persisted), so hashing them closes the determinism + save/load blind spot for the
// economy/society state recent waves added — a round-trip bug in `_credit`, `_serf`,
// `_orgApt`, `culMix`, … used to slip straight past the hash (the core loop only mixed
// people/food/wealth/army/loyalty/unrest/knowledge). Declared here so the guard can't
// silently drift from what's persisted (the same omission class R1 fixed for world maps).
// _specKey is a string → mixed as such; the mixes are [[id,share],…] → element-wise.
const SETT_HASH_NUM = ["_credit", "_unfree", "_cashFrac", "_captives", "_serf", "_estates", "_orgApt", "_rivalN", "_hegF", "_peerPeak", "_ambition", "_diseaseLoad", "_specStr", "_overlordCC", "_fisherFrac"];
const SETT_HASH_MIX = ["culMix", "faithMix", "langMix", "ancMix", "_captiveCul", "_captiveAnc"];

// Kin-graph / society registry hashing. hashWorld covered these NOT AT ALL (only
// `polities`, minimally), so a determinism or save/load bug in the dynastic or
// cultural state was invisible — precisely the state W6-F builds on. persons +
// dynasties carry real MUTABLE state (marriages, deaths, reigns, house rosters)
// mirrored nowhere else, so they are hashed field-by-field; cultures/faiths/
// languages are largely static naming/lineage metadata whose emergent effect
// already flows through the settlement mixes (culMix/faithMix/langMix, hashed
// above), so a divergence SIGNATURE (count + id + name + founding) suffices —
// deeper coverage of them is a noted follow-up. All these registries ARE fully
// serialized (save/loadWorld round-trip whole Map entries), so hashing them is
// save/load-safe; the declared lists keep the guard from drifting from the shape.
const PERSON_HASH_NUM = ["id", "female", "born", "died", "dynastyId", "cultureId", "parentId", "spouseId", "reignFrom", "reignTo", "lifespan", "bastard", "foreign"];
const PERSON_HASH_STR = ["name", "epithet"];
const DYN_HASH_NUM = ["id", "cultureId", "founderId", "foundedStep", "endedStep"];

// Declarative registry of persistent WORLD-LEVEL maps — dyadic / per-id / per-tile state
// (id→value) that carries real cross-tick meaning. Registered ONCE here; saveWorld,
// loadWorld and hashWorld all iterate it, so adding a world map is a SINGLE line, not three
// separate edits that are easy to forget — the omission class that left _wasWed unmigrated
// and needed _succClaims wired into save+load+hash by hand (W6-G / R1, scoped to world maps).
// Uniform `Map` state only; Sets and scalars (_plagued, _inheritReach, _inflRef,
// _lastSyncretismAt) keep their bespoke handling below. The JSON key is the field name
// without its leading underscore (unchanged v2 schema).
const WORLD_MAPS = [
  "_warExhaust", "_linkMoney", "_inflRaw", "_inflP", "_manpower", "_plagueEvAt",
  "_truces", "_warSeenAt", "_warDead", "_ruinHoards", "_schismAt", "_cBudgetRamp",
  "_natGriev",   // nation-pair grievance ledger (loyaltyField.js, T.GRIEV_LEDGER)
];

// ── typed-array <-> base64 ──────────────────────────────────────────────
function b64FromTyped(arr) {
  if (!arr) return null;
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
  return btoa(bin);
}
function typedFromB64(b64, Ctor) {
  if (!b64) return null;
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Ctor(u8.buffer);
}
// Older node contexts lack atob/btoa; polyfill via Buffer when present.
const _Buf = globalThis.Buffer;
if (typeof globalThis.btoa === "undefined" && _Buf) {
  globalThis.btoa = (s) => _Buf.from(s, "binary").toString("base64");
  globalThis.atob = (s) => _Buf.from(s, "base64").toString("binary");
}

const mapToArr = (m) => (m ? [...m.entries()] : []);
const arrToMap = (a) => new Map(a || []);

// Sparse serialization for near-empty per-tile arrays: only entries differing
// from the default are stored as [tile, value] pairs. Also sidesteps JSON's
// inability to carry -Infinity (the capture clock's default) in a raw dump.
function sparseFromTyped(arr, dflt) {
  if (!arr) return null;
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v !== dflt && !(Number.isNaN(v) && Number.isNaN(dflt))) out.push(i, v);
  }
  return out;
}
function typedFromSparse(pairs, Ctor, len, dflt) {
  if (!pairs || !pairs.length) return null;
  const a = new Ctor(len);
  if (dflt !== 0) a.fill(dflt);
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const ti = pairs[i];
    if (ti >= 0 && ti < len) a[ti] = pairs[i + 1];
  }
  return a;
}

// ── save ────────────────────────────────────────────────────────────────
export function saveWorld(world, meta = {}) {
  const defaults = tuningDefaults();
  const tuning = {};
  for (const k in defaults) if (T[k] !== defaults[k]) tuning[k] = T[k];

  const settlements = world.settlements.map(s => {
    const o = { pos: { x: s.pos.x, y: s.pos.y }, knowledge: { ...s.knowledge } };
    for (const f of SETT_FIELDS) if (s[f] !== undefined) o[f] = s[f];
    return o;
  });

  const polities = [];
  if (world.polities) for (const [id, p] of world.polities) polities.push([id, p]);

  const seaReach = [];
  for (const s of world.settlements) {
    // link.inter holds LIVE settlement references (the relay ports sellGoods tolls —
    // deliberate on the hot path). Serialize them as IDS: raw refs made the save
    // (a) CRASH once the object graph went cyclic (_questGoal/_foodParent chains in a
    // dense modern sea network — caught by the full-size recording run at step 30k),
    // (b) bloat the save with ~4 duplicated settlement objects per link, and (c)
    // worst, LOAD as detached ghost copies, so post-load relay tolls credited
    // unreachable objects — coin leaking from the closed supply until the next sea
    // pass rebuilt the lanes.
    if (s._seaReach && s._seaReach.size) seaReach.push([s.id, [...s._seaReach.entries()].map(([pid, l]) =>
      [pid, l && l.inter ? { ...l, inter: l.inter.map(h => h.id) } : l])]);
  }

  const reserves = {};
  if (world.depositReserve) for (const id in world.depositReserve) reserves[id] = b64FromTyped(world.depositReserve[id]);

  const tables = {};
  for (const k of WORLD_MAPS) tables[k.slice(1)] = mapToArr(world[k]);     // registered world maps (save side)
  tables.plagued = world._plagued ? [...world._plagued] : [];             // Set: infected settlement ids
  tables.inheritReach = world._inheritReach ? [...world._inheritReach] : []; // Set: secession heirs that skip the reach ramp
  tables.inflRef = world._inflRef ?? null;                                // scalar: permanent M/T price baseline
  tables.lastSyncretismAt = world._lastSyncretismAt ?? null;              // scalar: world syncretism cooldown

  return {
    v: SAVE_VERSION,
    meta: {
      W: world.width, H: world.height, seed: world.seed,
      preset: world.preset, oceanLevel: meta.oceanLevel ?? 0.78, tecParams: meta.tecParams || {},
      realWind: !!(world._realWindGen ?? meta.realWind),   // terrain identity: the WORLD knows what it grew on; caller meta is a fallback for pre-flag worlds

    },
    step: world.step,
    eraAt: world._eraAt,              // display-calendar timeline (step each era was reached)
    eraProd: world._eraProd,          // demographic anchor: global productivity index
    climIndex: world._climIndex, climShock: world._climShock,   // dynamic-climate state (climate.js)
    refWorks: world._refWorks,        // STATE_WORKS smoothed era-median fiscal scale (the works ruler); absent/0 reseeds at the next pass's median
    refRevenue: world._refRevenue,    // CAP_MODEL smoothed fiscal peer baseline — carried state since REF_REV_SMOOTH (conquest.js); absent/0 reseeds at the next pass's median
    refCapPowerS: world._refCapPowerS,   // CAP_RELATIVE smoothed median capital power (the capacity ruler's era base); absent/0 reseeds at the next polity pass
    refRealmPop: world._refRealmPop,  // GRIEV_LEDGER smoothed median realm population (what a "people" weighs); absent/0 reseeds at the next polity pass
    musterRatio: world._musterRatio,  // MUSTER_FIELD smoothed census↔governed-people anchor (armies.js); absent/0 reseeds at the next muster
    provRatio: world._provRatio,      // PROV_FIELD smoothed per-province census↔governed anchor (conquest.js); absent/0 reseeds at the next polity pass
    sizePopK: 0,                      // DEAD (Tier-B2 re-grounding): the SIZE_BY_POP global anchor is gone — the target is memoryless (per-realm govPop × RURAL_BIND_DENS, countryTerritory.js). Kept one format generation at 0 so old code loading a new save takes its reseed path; drop next format change
    loyalScanAt: world._loyalScanAt,  // LOYAL_FIELD last owner-diff scan step (classifies force vs politics in transfer semantics)
    devWaveAt: world._devWaveAt,      // DEV_FIELD last wave firing step (the ~1 km/year cadence clock)
    onePopScale: world._onePopScale,  // ONE_POP frozen bridge scalar (census units per field person; a unit conversion, never re-derived)
    popTotal: world._popTotal,        // last tick's world total (anchor input)
    counters: { settlement: world._nextSettlementId || 1, ship: world._nextShipId || 0, culture: world._nextCultureId || 1, faith: world._nextFaithId || 1, person: world._nextPersonId || 1, dynasty: world._nextDynastyId || 1, language: world._nextLanguageId || 1, event: world._nextEventId ?? (world.events ? world.events.length : 0) },
    tuning,
    settlements,
    polities,
    cultures: world.cultures ? [...world.cultures.entries()] : [],
    languages: world.languages ? [...world.languages.entries()] : [],
    faiths: world.faiths ? [...world.faiths.entries()] : [],
    persons: world.persons ? [...world.persons.entries()] : [],
    dynasties: world.dynasties ? [...world.dynasties.entries()] : [],
    succClaims: world._succClaims ? [...world._succClaims.entries()] : [],   // live succession casus-belli (armies.js reads it cross-pass — must survive a mid-run save/load, else the loaded run's claim wars diverge until the next dynasty pass rebuilds it)
    events: world.events || [],
    ships: world.ships || [],
    maps: {
      roadQuality: b64FromTyped(world.roadQuality),
      roadFlow: b64FromTyped(world.roadFlow),
      countryClaim: b64FromTyped(world._countryClaim),
      countryOwner: b64FromTyped(world._countryOwner),
      territoryOwner: b64FromTyped(world._territoryOwner),
      claimPress: b64FromTyped(world._claimPress),
      // Phase-1 population field (T.POP_FIELD). popField carries state (a
      // migration integral), so it IS saved; capField is re-derived each step so
      // it isn't. Absent unless the lever ran → undefined key, dropped by
      // JSON.stringify, so a default (lever-off) save stays byte-identical.
      popField: world.popField ? b64FromTyped(world.popField) : undefined,
      // Regional development field (T.DEV_FIELD): the wave-of-advance ratchet is
      // an integral of history, not re-derivable — absent unless the lever ran.
      devField: world.devField ? b64FromTyped(world.devField) : undefined,
      // Land improvement (T.LAND_WORKS): built capital in the land — an
      // integral of history like devField, not re-derivable. Absent unless
      // the lever ran, so default saves stay byte-identical.
      worksField: world.worksField ? b64FromTyped(world.worksField) : undefined,
      // Armed hearth candidates (T.INVENT_STAGGER): sites whose maturity ran
      // past prehistory, carrying accrued peopled-basin years (effY). Plain
      // numbers, tiny, and NOT re-derivable — losing them makes a loaded world
      // never ignite a hearth the original fires (measured: the smoke
      // continuation gate caught exactly this as an 11% pop divergence).
      // Absent unless the lever armed any → default saves byte-identical.
      armedHearths: world._armedHearths && world._armedHearths.length ? world._armedHearths : undefined,
      hearthArmAt: world._hearthArmAt !== undefined ? world._hearthArmAt : undefined,
      // Settlement-less farming sources (T.CITY_AT_BIRTH): each armed-hearth
      // maturation that did NOT mint a settlement wrote {ti, agri} here — the
      // technique wave's ground-truth sources. NOT re-derivable (the armed
      // record is consumed at maturation); losing them un-invents farming on
      // load. Absent unless the lever matured any → default saves byte-identical.
      hearthSeeds: world._hearthSeeds && world._hearthSeeds.length ? world._hearthSeeds : undefined,
      // Nations of the land (T.STATE_OF_LAND): the seat register and the static
      // basin territory. Not re-derivable (formation is a one-time event and the
      // painted cell is the nation's land). Absent unless the lever formed any.
      landSeats: world._landSeats && world._landSeats.size ? [...world._landSeats].map(([id, r]) => ({ id, ...r })) : undefined,
      landOwner: sparseFromTyped(world._landOwner, -1) ?? undefined,
      // The loyalty field (T.LOYAL_FIELD, loyaltyField.js): allegiance is a
      // dense continuum (every governed tile carries a value), the owner-diff
      // snapshot is dense ids; both absent unless the lever ran (undefined key
      // → dropped by JSON.stringify → a lever-off save stays byte-identical).
      // Homeland memory is near-empty → sparse pairs like tileCapturedAt.
      allegiance: world._allegiance ? b64FromTyped(world._allegiance) : undefined,
      // Stage 2 (T.TILE_IDENTITY, identityField.js): the CULTURE layer is sim
      // state — the land remembers who lives on it — so it persists, quantised
      // to the top-2 slots per tile (ids Int16 + shares Uint8 ≈ 6 B/tile; the
      // v4 payload). Slots 2-3 are re-earned by assimilation dynamics after a
      // load — they are sub-20% residue by construction. Absent unless the
      // lever ran AND the field initialised (a lever-off save stays
      // byte-identical); a pre-v4 or lever-off save simply re-seeds from the
      // city mirror on the first stepIdentityField firing.
      // (Stage-2 tileCul2Id/Shr save legs removed with T.TILE_IDENTITY 2026-07;
      // the v4 LOAD path below still expands old saves' payloads harmlessly.)
      tileOwnerPrev: world._tileOwnerPrev ? b64FromTyped(world._tileOwnerPrev) : undefined,
      tileHomeland: sparseFromTyped(world._tileHomeland, -1) ?? undefined,
      tileFellAt: sparseFromTyped(world._tileFellAt, -Infinity) ?? undefined,
      // sparse [tile, value] pairs — these arrays are near-empty and carry
      // non-JSON values (-Infinity) in their defaults
      tileCapturedAt: sparseFromTyped(world._tileCapturedAt, -Infinity),
      soilFatigue: sparseFromTyped(world._soilFatigue, 0),
      fishTaken: sparseFromTyped(world._fishTaken, 0),   // "the sea remembers" (T.FISH_LABOR, settlement.js) — taken fraction of each coastal stock
    },
    reserves,
    tables,
    seaReach,
  };
}

export function serializeWorld(world, meta) {
  return JSON.stringify(saveWorld(world, meta));
}

// ── load ────────────────────────────────────────────────────────────────
export function loadWorld(data, opts = {}) {
  if (typeof data === "string") data = JSON.parse(data);
  // Accept any older version: the schema is additive and every newer field has
  // a load default (or is re-derived below), so old saves migrate by loading.
  // Only saves NEWER than this code are rejected.
  if (!data || !(data.v >= 1) || data.v > SAVE_VERSION) {
    throw new Error(`Unsupported save version ${data && data.v} (this build reads up to ${SAVE_VERSION})`);
  }
  const m = data.meta;
  // Terrain identity guards: a save is only loadable where its terrain can be
  // rebuilt EXACTLY. Silently regenerating different terrain under a saved
  // civilization is worse than a clear error.
  if (m.preset === "import") {
    throw new Error("This save was made on an imported map, whose terrain is not stored in the save. Re-import the source heightmap/Azgaar file, then load.");
  }
  if (m.realWind && !opts.realWindFns) {
    throw new Error("This save uses real NCEP winds, which are unavailable in this context (worker). Load it from the main thread with realWindFns.");
  }
  // Tuning BEFORE terrain: the pipeline itself reads levers now (the floodplain
  // ribbon is gated on T.RES_INVARIANT_POP), so the save's tuning is part of the
  // TERRAIN IDENTITY. Applying it after pipelineBuild silently rebuilt different
  // terrain under the saved civilization whenever the saving and loading sessions
  // disagreed on a worldgen-facing lever (e.g. a lever-off save loaded in a fresh
  // worker at default lever-on: different tFlood/fert, moved wasteland walls) —
  // exactly the mismatch the preset/realWind guards above exist to prevent.
  resetTuning();
  applyTuning(data.tuning);
  // Default-flip compat (v2 → v3): TILE_POLITY + CATCHMENT_CLIP (the reactive-
  // settlement model) became default-ON in v3. A pre-v3 world was made when both
  // defaulted OFF, so — since a save only stores levers that DIFFER from the
  // then-default — it carries NO delta for them, and a naive load would resetTuning
  // them to the NEW default (ON) and silently continue the old world in the reactive
  // regime (catchment suddenly clips, borders re-key to capitals). Restore the value
  // those saves were made under, UNLESS the save explicitly set the lever (an
  // experimental pre-v3 reactive save keeps its own choice).
  if (data.v < 3) {
    const tn = data.tuning || {};
    if (!("TILE_POLITY" in tn)) T.TILE_POLITY = 0;
    if (!("CATCHMENT_CLIP" in tn)) T.CATCHMENT_CLIP = 0;
  }
  // Regime guard (Tier-C C1, the v3 pattern): a v≤4 save was made when
  // T.LABEL_BIRTH defaulted OFF, so it stores no delta for it — if the lever's
  // default ever flips ON (with the SAVE_VERSION bump to 5 that flip requires),
  // a naive load would silently continue the old world under basin-exclusive
  // label supply AND under a frozen _onePopScale calibrated at the old label
  // density (survey open question 4 — the bridge cannot re-calibrate). Keep
  // such saves in their own regime unless they set the lever explicitly.
  // The same guard covers MULTI_HEARTH (C1 v4, the hearth field): it changes an
  // INITIAL CONDITION — how many cradles the world was seeded with — which a
  // loaded save cannot re-derive (its settlements are already in the file), and
  // it re-keys the tier bars from floored to pure percentiles. A pre-flip save
  // continuing under the new default would carry an Old-World-only devField
  // through a percentile hierarchy calibrated for a denser label set.
  if (data.v < 5) {
    const tn = data.tuning || {};
    if (!("LABEL_BIRTH" in tn)) T.LABEL_BIRTH = 0;
    if (!("MULTI_HEARTH" in tn)) T.MULTI_HEARTH = 0;
    // The divergence lane (GROW_SEASON / CROP_PHOTOPERIOD / CRADLE_PACKAGE /
    // INVENT_STAGGER) became default-ON in v5 (2026-08, the shape wave). A
    // pre-v5 world was made under annual-mean agronomy and t=0 hearths, so it
    // stores no delta for them; the two LIVE levers (season/photoperiod) would
    // silently re-key its whole food system on load, and the two GENESIS
    // levers describe an initial condition its settlements already embody.
    // Keep such saves in their own regime unless they set a lever explicitly.
    if (!("GROW_SEASON" in tn)) T.GROW_SEASON = 0;
    if (!("CROP_PHOTOPERIOD" in tn)) T.CROP_PHOTOPERIOD = 0;
    if (!("CRADLE_PACKAGE" in tn)) T.CRADLE_PACKAGE = 0;
    if (!("INVENT_STAGGER" in tn)) T.INVENT_STAGGER = 0;
  }
  // v5 → v6: package biogeography + crop irrigation (CROP_BIOGEO + IRRIG_CROP,
  // one flip — docs/dawn-cradles-2026-08-07.md) became default-ON. Both are LIVE
  // agronomy: they re-key which crops exist where and what flood-fed land
  // yields, so a pre-flip world silently continued under them would have its
  // whole food system re-based mid-history. Same guard pattern as v5: a pre-v6
  // save stores no delta for a lever that defaulted OFF when it was made, so
  // pin both to their old default unless the save set one explicitly.
  if (data.v < 6) {
    const tn = data.tuning || {};
    if (!("CROP_BIOGEO" in tn)) T.CROP_BIOGEO = 0;
    if (!("IRRIG_CROP" in tn)) T.IRRIG_CROP = 0;
  }
  // v6 → v7: the millet package split (CROP_MILLET — re-keys which crop the
  // whole East-Asian dawn domesticates) and real-width water access
  // (ACCESS_BAND — re-keys the capacity field on every waterside tile at
  // non-reference grids) became default-ON. Same guard pattern: a pre-v7 save
  // stores no delta for either, so pin both to their old default unless the
  // save set one explicitly — an old world keeps the agronomy and the
  // capacity field it grew on.
  if (data.v < 7) {
    const tn = data.tuning || {};
    if (!("CROP_MILLET" in tn)) T.CROP_MILLET = 0;
    if (!("ACCESS_BAND" in tn)) T.ACCESS_BAND = 0;
  }
  // v7 → v8: the residual birth-crater wave — FOOD_REACH (re-keys owned-land
  // carrying capacity everywhere a low-org state holds territory) and
  // HOLD_SEAM (re-keys every city mint's capacity handoff) became default-ON.
  // Same pattern: a pre-v8 save keeps the capacity semantics it grew on.
  if (data.v < 8) {
    const tn = data.tuning || {};
    if (!("FOOD_REACH" in tn)) T.FOOD_REACH = 0;
    if (!("HOLD_SEAM" in tn)) T.HOLD_SEAM = 0;
  }
  // v8 → v9: basin-wide invention ignition (BASIN_IGNITE — re-keys every
  // dawn's post-invention timeline: the technique no longer diffuses across
  // its own inventors). A pre-v9 save keeps the dawn it grew on.
  if (data.v < 9) {
    const tn = data.tuning || {};
    if (!("BASIN_IGNITE" in tn)) T.BASIN_IGNITE = 0;
  }
  // v9 → v10: the union of crowns (VALLEY_UNION — re-keys early political
  // consolidation everywhere). A pre-v10 save keeps its political physics.
  if (data.v < 10) {
    const tn = data.tuning || {};
    if (!("VALLEY_UNION" in tn)) T.VALLEY_UNION = 0;
  }
  // v10 → v11: the state frontier (ORG_CONTACT — re-keys every pre-state
  // settlement's statecraft clock). A pre-v11 save keeps its dawn's politics.
  if (data.v < 11) {
    const tn = data.tuning || {};
    if (!("ORG_CONTACT" in tn)) T.ORG_CONTACT = 0;
  }
  // v11 → v12: the caging law (STATE_CAGE — re-keys WHERE states form, both
  // channels). A pre-v12 save keeps its mass-era formation physics.
  if (data.v < 12) {
    const tn = data.tuning || {};
    if (!("STATE_CAGE" in tn)) T.STATE_CAGE = 0;
  }
  // v12 → v13: the peer lattice (PEER_LATTICE — re-keys the urban/political
  // density of every dense basin). A pre-v13 save keeps its one-per-cell map.
  if (data.v < 13) {
    const tn = data.tuning || {};
    if (!("PEER_LATTICE" in tn)) T.PEER_LATTICE = 0;
  }
  // v13 → v14: the fast lane (CONQUEST_CASCADE — re-keys how consolidation
  // scales). A pre-v14 save keeps its single-speed politics.
  if (data.v < 14) {
    const tn = data.tuning || {};
    if (!("CONQUEST_CASCADE" in tn)) T.CONQUEST_CASCADE = 0;
  }
  // v14 → v15: segmentary fission (FISSION — land nations split; re-keys the
  // tribal fabric's density). A pre-v15 save keeps its fission-less politics.
  if (data.v < 15) {
    const tn = data.tuning || {};
    if (!("FISSION" in tn)) T.FISSION = 0;
  }
  // v15 → v16: grounded zero-tech reach (REACH_GROUND — re-keys every realm's
  // default footprint). A pre-v16 save keeps its imperial floor.
  if (data.v < 16) {
    const tn = data.tuning || {};
    if (!("REACH_GROUND" in tn)) T.REACH_GROUND = 0;
  }
  // v16 → v17: sieges won by hunger (SIEGE_STARVE — re-keys how wars end).
  // A pre-v17 save keeps its unstormable capitals.
  if (data.v < 17) {
    const tn = data.tuning || {};
    if (!("SIEGE_STARVE" in tn)) T.SIEGE_STARVE = 0;
  }
  // v17 → v18: starving cores shed (STARVE_SHED — the hold floor yields to
  // sustained hunger). A pre-v18 save keeps its food-blind floor.
  if (data.v < 18) {
    const tn = data.tuning || {};
    if (!("STARVE_SHED" in tn)) T.STARVE_SHED = 0;
  }
  // v18 → v19: fish removed as food (FISH def 0) + organic takes
  // (ORGANIC_TAKE). A pre-v19 save keeps its fed coasts and its walk shapes.
  if (data.v < 19) {
    const tn = data.tuning || {};
    if (!("FISH" in tn)) T.FISH = 1;
    if (!("ORGANIC_TAKE" in tn)) T.ORGANIC_TAKE = 0;
  }
  // v27 → v28: contested defensible ground resists the claim (CREST_HOLD).
  // A pre-v28 save keeps its first-arrival crossings.
  if (data.v < 28) {
    const tn = data.tuning || {};
    if (!("CREST_HOLD" in tn)) T.CREST_HOLD = 0;
  }
  // v26 → v27: reach realized through transport (PORTER_BOUND). A pre-v27
  // save keeps its transport-blind radius.
  if (data.v < 27) {
    const tn = data.tuning || {};
    if (!("PORTER_BOUND" in tn)) T.PORTER_BOUND = 0;
  }
  // v25 → v26: the apparatus feeds on conquest income (APPARATUS_LOOT).
  // A pre-v26 save keeps its tax-fed apparatus.
  if (data.v < 26) {
    const tn = data.tuning || {};
    if (!("APPARATUS_LOOT" in tn)) T.APPARATUS_LOOT = 0;
  }
  // v24 → v25: the imperial apparatus (APPARATUS — the works stock funds
  // CAPACITY). A pre-v25 save keeps its per-member-only capacity regime.
  if (data.v < 25) {
    const tn = data.tuning || {};
    if (!("APPARATUS" in tn)) T.APPARATUS = 0;
  }
  // v23 → v24: the sea learns by demand and the admiralty sails (SEA_DEMAND,
  // ADMIRALTY). A pre-v24 save keeps its court-read, demand-blind navigation.
  if (data.v < 24) {
    const tn = data.tuning || {};
    if (!("SEA_DEMAND" in tn)) T.SEA_DEMAND = 0;
    if (!("ADMIRALTY" in tn)) T.ADMIRALTY = 0;
  }
  // v22 → v23: the land must be workable (TILLAGE — heavy/tropical soils wait
  // for technique). A pre-v23 save keeps its easy soils.
  if (data.v < 23) {
    const tn = data.tuning || {};
    if (!("TILLAGE" in tn)) T.TILLAGE = 0;
  }
  // v21 → v22: reach as a maintained stock (STATE_WORKS — roads/relays bought
  // by out-collecting the era, lost when the fisc fails). A pre-v22 save keeps
  // its tech-only administrative radius.
  if (data.v < 22) {
    const tn = data.tuning || {};
    if (!("STATE_WORKS" in tn)) T.STATE_WORKS = 0;
  }
  // v20 → v21: satrapization (SATRAPIZE — a mature suzerain integrates aged
  // vassals as provinces). A pre-v21 save keeps its tribute-network politics.
  if (data.v < 21) {
    const tn = data.tuning || {};
    if (!("SATRAPIZE" in tn)) T.SATRAPIZE = 0;
  }
  // v19 → v20: managed water hits the optimum (FLOOD_OPT — re-prices the
  // arid flood cradles). A pre-v20 save keeps its overwatered cradles.
  if (data.v < 20) {
    const tn = data.tuning || {};
    if (!("FLOOD_OPT" in tn)) T.FLOOD_OPT = 0;
  }
  // Rebuild terrain + pipeline deterministically from the recorded identity.
  const { w, ter } = pipelineBuild({ W: m.W, H: m.H, seed: m.seed, preset: m.preset, oceanLevel: m.oceanLevel, tecParams: m.tecParams, realWind: !!m.realWind, realWindFns: opts.realWindFns || null });
  const world = initPeopleSim(w, { seed: w.seed, tCrop: ter.tCrop, tFlood: ter.tFlood, tileRes: 1, deposits: ter.deposits, tAncestry: ter.tAncestry, terTw: ter.tw, terTh: ter.th, ancestryCount: ter.ancestryCount, ancHue: ter.ancHue, tArrival: ter.tArrival });

  // Drop the freshly-seeded state (cradles + their events); the save replaces it.
  world.settlements.length = 0;
  world.events = [];
  world._evIndex = new Map();
  world.polities = new Map();
  world.countries = new Map();
  world.ships = [];

  world.step = data.step | 0;
  world._eraProd = data.eraProd ?? 1;        // demographic anchor (index.js): restore so post-load ticks match
  world._climIndex = data.climIndex ?? 0; world._climShock = data.climShock ?? 0;   // dynamic-climate state
  world._refRevenue = data.refRevenue ?? 0;   // smoothed fiscal peer baseline (0 / pre-field saves: reseeds at the next polity pass's median)
  world._refWorks = data.refWorks ?? 0;       // STATE_WORKS smoothed era-median fiscal scale (0 / pre-v22 saves: reseeds at the next polity pass's median)
  world._refCapPowerS = data.refCapPowerS ?? 0;   // smoothed median capital power (CAP_RELATIVE ruler base; 0 reseeds next pass)
  world._refRealmPop = data.refRealmPop ?? 0;     // smoothed median realm population (GRIEV_LEDGER read normalizer; 0 reseeds next pass)
  world._musterRatio = data.musterRatio ?? 0;     // MUSTER_FIELD census↔governed anchor (0 reseeds at the next muster)
  world._provRatio = data.provRatio ?? 0;         // PROV_FIELD per-province census↔governed anchor (0 reseeds next polity pass)
  world._sizePopK = data.sizePopK ?? 0;           // DEAD (Tier-B2 re-grounding): tolerated for old saves, never read by the sim — the SIZE_BY_POP target is memoryless now (countryTerritory.js)
  if (data.loyalScanAt != null) world._loyalScanAt = data.loyalScanAt;   // owner-diff scan clock (unset ≡ never scanned)
  if (data.devWaveAt != null) world._devWaveAt = data.devWaveAt;         // wave cadence clock (unset ≡ never fired)
  if (data.onePopScale != null) world._onePopScale = data.onePopScale;   // ONE_POP bridge scalar (unset ≡ compute at first derive)
  world._popTotal = data.popTotal ?? 0;
  world._eraAt = data.eraAt || [0];
  world._nextSettlementId = data.counters.settlement;
  world._nextShipId = data.counters.ship;
  world._nextCultureId = data.counters.culture || 1;
  world._nextFaithId = data.counters.faith || 1;
  world._nextPersonId = data.counters.person || 1;
  world._nextDynastyId = data.counters.dynasty || 1;
  world.cultures = new Map(data.cultures || []);
  world.languages = new Map(data.languages || []);
  world._nextLanguageId = (data.counters && data.counters.language) || 1;
  world._nextEventId = (data.counters && data.counters.event) ?? (data.events ? data.events.length : 0);
  world.faiths = new Map(data.faiths || []);
  world.persons = new Map(data.persons || []);
  world.dynasties = new Map(data.dynasties || []);
  world._succClaims = new Map(data.succClaims || []);

  for (const rec of data.settlements) {
    const s = { kind: "settlement", localRes: {}, _tradeReach: null, crops: [], ...rec };
    world.settlements.push(s);
    // v1 saves predate the static site attributes — re-derive them from the
    // rebuilt terrain (pure deterministic functions of position).
    if (s._riverAcc === undefined || s._confine === undefined) rederiveSiteStatics(world, s);
  }
  world._realWindGen = !!m.realWind;
  for (const [id, p] of data.polities) world.polities.set(id, p);
  world.events = data.events || [];
  reindexEvents(world);
  world.ships = data.ships || [];

  const N = world.N;
  const loadTyped = (b64, Ctor, len) => { const a = typedFromB64(b64, Ctor); return a && a.length === len ? a : null; };
  if (data.maps) {
    world.roadQuality = loadTyped(data.maps.roadQuality, Float32Array, N) || world.roadQuality;
    world.roadFlow = loadTyped(data.maps.roadFlow, Float32Array, N) || world.roadFlow;
    world._countryClaim = loadTyped(data.maps.countryClaim, Int32Array, N) || world._countryClaim;
    world._countryOwner = loadTyped(data.maps.countryOwner, Int32Array, N) || world._countryOwner;
    world._territoryOwner = loadTyped(data.maps.territoryOwner, Int32Array, N) || world._territoryOwner;
    world._claimPress = loadTyped(data.maps.claimPress, Float32Array, N) || world._claimPress;
    const pf = loadTyped(data.maps.popField, Float32Array, N);
    if (pf) { world.popField = pf; world.capField = new Float32Array(N); world._popNext = new Float32Array(N); }   // phase-1 pop field (capField re-derived next step)
    const df = loadTyped(data.maps.devField, Float32Array, N);
    if (df) { world.devField = df; world._devNext = new Float32Array(N); }   // regional development ratchet (T.DEV_FIELD); absent old saves reseed via ensureDevField
    const wkf = loadTyped(data.maps.worksField, Float32Array, N);
    if (wkf) world.worksField = wkf;   // land improvement (T.LAND_WORKS); _irrigable is static terrain, rebuilt on demand
    // Armed hearth candidates (T.INVENT_STAGGER) — see the save side.
    if (data.maps.armedHearths && data.maps.armedHearths.length) world._armedHearths = data.maps.armedHearths.map(h => ({ ...h }));
    if (data.maps.hearthArmAt !== undefined) world._hearthArmAt = data.maps.hearthArmAt;
    if (data.maps.hearthSeeds && data.maps.hearthSeeds.length) world._hearthSeeds = data.maps.hearthSeeds.map(h => ({ ...h }));
    if (data.maps.landSeats && data.maps.landSeats.length) world._landSeats = new Map(data.maps.landSeats.map(r => [r.id, { ti: r.ti }]));
    const lown = typedFromSparse(data.maps.landOwner, Int32Array, N, -1);
    if (lown) world._landOwner = lown;   // nations of the land: static basin territory (T.STATE_OF_LAND)
    const capAt = typedFromSparse(data.maps.tileCapturedAt, Float64Array, N, -Infinity);
    if (capAt) world._tileCapturedAt = capAt;           // conquest hold clock (armies.js)
    const soil = typedFromSparse(data.maps.soilFatigue, Float32Array, N, 0);
    if (soil) world._soilFatigue = soil;                // "the land remembers" (settlement.js)
    const fishT = typedFromSparse(data.maps.fishTaken, Float32Array, N, 0);
    if (fishT) world._fishTaken = fishT;                // "the sea remembers" (T.FISH_LABOR, settlement.js)
    // The loyalty field (loyaltyField.js). Allegiance is the presence marker
    // (dense, always saved once the lever ran); the sparse memory arrays may
    // legitimately be all-default in a young world, so materialize them at
    // their defaults alongside it — a partial field would make ensure() skip
    // the missing arrays and stamp memory against a null snapshot.
    const alg = loadTyped(data.maps.allegiance, Float32Array, N);
    if (alg) {
      world._allegiance = alg;
      world._tileOwnerPrev = loadTyped(data.maps.tileOwnerPrev, Int32Array, N)
        || (world._countryOwner ? Int32Array.from(world._countryOwner) : new Int32Array(N).fill(-1));
      world._tileHomeland = typedFromSparse(data.maps.tileHomeland, Int32Array, N, -1) || new Int32Array(N).fill(-1);
      world._tileFellAt = typedFromSparse(data.maps.tileFellAt, Float64Array, N, -Infinity) || new Float64Array(N).fill(-Infinity);
    }
    // Stage 2 (T.TILE_IDENTITY): the persisted top-2 culture layer expands
    // back into the K-slot field; its presence marks the field initialised
    // (so stepIdentityField continues the loaded history instead of
    // re-seeding from the mirror). Absent payload (pre-v4 / lever-off save)
    // → nothing loads; the first firing seeds from the city mirror.
    const c2i = loadTyped(data.maps.tileCul2Id, Int16Array, N * 2);
    const c2s = loadTyped(data.maps.tileCul2Shr, Uint8Array, N * 2);
    if (c2i && c2s) {
      ensureIdentityField(world);
      const K = IDENTITY_K, idA = world.tileCulId, shA = world.tileCulShr;
      for (let ti = 0; ti < N; ti++) {
        const b = ti * K;
        idA[b] = c2i[ti * 2]; shA[b] = c2s[ti * 2];
        idA[b + 1] = c2i[ti * 2 + 1]; shA[b + 1] = c2s[ti * 2 + 1];
        for (let k = 2; k < K; k++) { idA[b + k] = -1; shA[b + k] = 0; }
      }
      world._tileIdentInit = true;
    }
  }
  // The road/flow sparse indices were created empty at init and no longer
  // match the loaded arrays — rebuild them or decay/paving skip every tile.
  reindexRoads(world);
  if (data.reserves && world.depositReserve) {
    for (const id in data.reserves) {
      const a = typedFromB64(data.reserves[id], Float32Array);
      if (a && world.depositReserve[id] && a.length === world.depositReserve[id].length) world.depositReserve[id] = a;
    }
  }
  const t = data.tables || {};
  for (const k of WORLD_MAPS) world[k] = arrToMap(t[k.slice(1)]);   // registered world maps (load side); arrToMap handles absent (old-save) keys → empty Map
  world._plagued = new Set(t.plagued || []);
  world._inheritReach = new Set(t.inheritReach || []);
  // undefined (not null) means "baseline not yet calibrated" — preserve that.
  if (t.inflRef != null) world._inflRef = t.inflRef;
  if (t.lastSyncretismAt != null) world._lastSyncretismAt = t.lastSyncretismAt;
  if (data.seaReach) {
    const _sById = new Map(world.settlements.map(x => [x.id, x]));
    for (const [sid, entries] of data.seaReach) {
      const s = _sById.get(sid);
      if (!s) continue;
      // Re-link relay-port IDs to LIVE settlement objects (sellGoods tolls mutate
      // them). A missing id — or an OBJECT from a pre-fix save (the ghost-copy bug)
      // — drops out; the sea pass re-derives the chain on its next rebuild.
      s._seaReach = new Map(entries.map(([pid, l]) => [pid,
        l && l.inter ? { ...l, inter: l.inter.map(h => _sById.get(h)).filter(Boolean) } : l]));
    }
  }

  // Warm the world in dependency order so the first post-load ticks read the
  // same state the saved world had:
  //   climate overlay (fertility multiplier) → territory tallies (food) →
  //   countries view (leadOrg/_civYear, dynasties, muster) → alliance map
  //   (coalition bars, casus belli).
  recomputeClimMod(world);
  computeTerritory(world);
  world._byId = new Map();
  for (const s of world.settlements) world._byId.set(s.id, s);
  // The warm-up must not MUTATE persistent state: rebuildCountries lazily
  // mints polity records (personality attach) for statelets born since the
  // last polity pass — records the saved world does not have yet, breaking
  // save→load→save identity. Snapshot the registry and drop any records the
  // warm-up minted; the next polity pass re-mints them deterministically at
  // exactly the tick the uninterrupted run would have.
  const _polIds = new Set(world.polities.keys());
  // Minting a polity record coins its realm NAME (entities.js ensurePolity →
  // nameFor), which increments the coining culture's nameCounter — a persistent
  // registry mutation the polity-record rollback below does not undo. Snapshot
  // the counters and restore them too, or a load consumes a name the saved
  // world never spent: the next real polity pass then names the statelet with
  // counter n+1 instead of n, and the loaded trajectory (and the registry
  // hash) silently diverges from the uninterrupted run.
  const _nameCtrs = [];
  for (const reg of [world.cultures, world.faiths, world.languages]) {
    if (!reg) continue;
    for (const e of reg.values()) if (e && e.nameCounter !== undefined) _nameCtrs.push([e, e.nameCounter]);
  }
  // rebuildOverlords prunes dangling pol._overlord/_depKind links (an overlord that
  // died between the save's last polity pass and the save) — a persistent-record
  // mutation the uninterrupted run wouldn't perform until its NEXT pass. Snapshot
  // and restore those too, same contract as the polity/nameCounter rollback above.
  const _overlords = [];
  for (const p of world.polities.values()) _overlords.push([p, p._overlord, p._depKind]);
  rebuildCountries(world);
  rebuildOverlords(world, world.countries);   // colony↔metropole links must exist before the alliance map (else colonies balance against their own metropole until the next ALLIANCE_EVERY boundary)
  updateAlliances(world);
  for (const id of [...world.polities.keys()]) if (!_polIds.has(id)) world.polities.delete(id);
  for (const [e, n] of _nameCtrs) e.nameCounter = n;
  for (const [p, ov, dk] of _overlords) { p._overlord = ov; p._depKind = dk; }
  return world;
}

// ── state hash (save completeness / determinism checks) ────────────────
const _f64 = new Float64Array(1);
const _u8 = new Uint8Array(_f64.buffer);
export function hashWorld(world) {
  let h = 0x811c9dc5;
  const mixNum = (v) => {
    _f64[0] = +v || 0;
    for (let i = 0; i < 8; i++) h = Math.imul(h ^ _u8[i], 0x01000193);
  };
  const mixStr = (str) => { const s = String(str || ""); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); };
  mixNum(world.step);
  const setts = [...world.settlements].sort((a, b) => a.id - b.id);
  for (const s of setts) {
    mixNum(s.id); mixStr(s.mode); mixStr(s.name); mixNum(s.tier); mixNum(s.countryId);
    mixNum(s.people); mixNum(s.food); mixNum(s.wealth); mixNum(s.army);
    mixNum(s.loyalty); mixNum(s.unrest); mixNum(s.infrastructure); mixNum(s._foodNet);
    if (s.knowledge) for (const k of Object.keys(s.knowledge).sort()) mixNum(s.knowledge[k]);
    for (const f of SETT_HASH_NUM) mixNum(s[f]);   // economy / labour / heritable state (was unhashed)
    mixStr(s._specKey);                            // agglomeration specialty (string half of the pair)
    for (const f of SETT_HASH_MIX) { const a = s[f]; if (a) for (const m of a) { if (Array.isArray(m)) { mixNum(m[0]); mixNum(m[1]); } else mixNum(m); } }   // ethnogenesis mixes [[id,share],…]
  }
  if (world.polities) {
    const ids = [...world.polities.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const p = world.polities.get(id);
      mixNum(id); mixNum(p.foundedStep); mixNum(p.endedStep); mixNum(p.treasury); mixStr(p.name);
    }
  }
  // Kin graph — persons (marriage / death / reign / lineage) + dynasties (house
  // rosters). Field-by-field: this is the W6-F dynastic state, mirrored nowhere else.
  if (world.persons) {
    for (const id of [...world.persons.keys()].sort((a, b) => a - b)) {
      const p = world.persons.get(id); if (!p) continue;
      for (const f of PERSON_HASH_NUM) mixNum(p[f]);
      for (const f of PERSON_HASH_STR) mixStr(p[f]);
      if (p.children) for (const c of p.children) mixNum(c);
      if (p.traits) for (const k of Object.keys(p.traits).sort()) mixNum(p.traits[k]);
    }
  }
  if (world.dynasties) {
    for (const id of [...world.dynasties.keys()].sort((a, b) => a - b)) {
      const d = world.dynasties.get(id); if (!d) continue;
      for (const f of DYN_HASH_NUM) mixNum(d[f]);
      mixStr(d.name);
      if (d.members) for (const m of d.members) mixNum(m);
      if (d.inlaws)  for (const m of d.inlaws)  mixNum(m);
    }
  }
  // Society registries — divergence signature (deep naming/lineage state is static
  // and its emergent effect flows through the settlement mixes hashed above).
  for (const reg of [world.cultures, world.faiths, world.languages]) {
    if (!reg) continue;
    mixNum(reg.size);
    for (const id of [...reg.keys()].sort((a, b) => a - b)) {
      const e = reg.get(id); if (!e) continue;
      mixNum(id); mixStr(e.name); mixNum(e.foundedStep); mixNum(e.nameCounter);
    }
  }
  mixNum(world.events ? world.events.length : 0);
  if (world.roadQuality) { const rq = world.roadQuality; for (let i = 0; i < rq.length; i += 97) mixNum(rq[i]); }
  if (world.roadFlow) { const rf = world.roadFlow; for (let i = 0; i < rf.length; i += 97) mixNum(rf[i]); }
  // Presence-normalized: an unallocated lazy array hashes identically to an
  // allocated all-default one (sparse serialization drops empty arrays).
  { const sf = world._soilFatigue; for (let i = 0; i < world.N; i += 97) mixNum(sf ? sf[i] : 0); }
  // fishTaken (T.FISH_LABOR) — coastal stock state; presence-normalized like soilFatigue.
  { const ftk = world._fishTaken; for (let i = 0; i < world.N; i += 97) mixNum(ftk ? ftk[i] : 0); }
  { const ca = world._tileCapturedAt; let n = 0, sum = 0; if (ca) for (let i = 0; i < ca.length; i++) if (Number.isFinite(ca[i])) { n++; sum += ca[i]; } mixNum(n); mixNum(sum); }
  // The loyalty field (loyaltyField.js) — presence-normalized like the above:
  // an unallocated (lever-off) field hashes as all-defaults. Allegiance and the
  // owner snapshot sample on the road stride; the sparse memory pair mixes
  // count+sum (the tileCapturedAt pattern); the grievance ledger mixes its full
  // contents (sorted — the cBudgetRamp pattern), since a single divergent
  // entry redirects habituation and unrest downstream.
  { const al = world._allegiance; for (let i = 0; i < world.N; i += 97) mixNum(al ? al[i] : 0); }
  { const op = world._tileOwnerPrev; for (let i = 0; i < world.N; i += 97) mixNum(op ? op[i] : -1); }
  { const th = world._tileHomeland; let n = 0, sum = 0; if (th) for (let i = 0; i < th.length; i++) if (th[i] >= 0) { n++; sum += th[i]; } mixNum(n); mixNum(sum); }
  { const tf = world._tileFellAt; let n = 0, sum = 0; if (tf) for (let i = 0; i < tf.length; i++) if (Number.isFinite(tf[i])) { n++; sum += tf[i]; } mixNum(n); mixNum(sum); }
  if (world._natGriev && world._natGriev.size) { for (const k of [...world._natGriev.keys()].sort()) { mixStr(k); mixNum(world._natGriev.get(k)); } }
  mixNum(world._refRealmPop || -1);   // 0 ≡ unset ("reseed at the next pass") — a load default must hash like the pre-save undefined
  mixNum(world._loyalScanAt ?? -1);
  // DEV_FIELD: the regional development ratchet + its cadence clock (presence-normalized).
  { const df = world.devField; for (let i = 0; i < world.N; i += 97) mixNum(df ? df[i] : 0); }
  mixNum(world._devWaveAt ?? -1);
  mixNum(world._onePopScale ?? -1);
  // popField — persisted state that predates the R1 hash-hygiene rule but was
  // never hashed; FIELD_DEMOG writes it from event sites, so a divergence or
  // round-trip bug must show. Presence-normalized, sampled on the road stride.
  { const pf = world.popField; for (let i = 0; i < world.N; i += 97) mixNum(pf ? pf[i] : 0); }
  // worksField (T.LAND_WORKS) — built land capital; presence-normalized like devField.
  { const wf = world.worksField; for (let i = 0; i < world.N; i += 97) mixNum(wf ? wf[i] : 0); }
  mixNum(world._inflRef ?? -1);
  for (const k of WORLD_MAPS) mixNum(world[k] ? world[k].size : 0);   // registered world maps: presence + size (every one now covered, not just a hand-picked few)
  if (world._cBudgetRamp) { const ks = [...world._cBudgetRamp.keys()].sort((a, b) => a - b); for (const k of ks) { mixNum(k); mixNum(world._cBudgetRamp.get(k)); } }   // + cBudgetRamp full key/values
  return (h >>> 0).toString(16);
}
