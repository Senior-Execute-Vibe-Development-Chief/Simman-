// ── Versioned save / load for a running world ──
//
// A save stores the world's IDENTITY (seed + generation params) and its
// DYNAMIC state — settlements, polities, the event log, money, roads,
// depletion, epidemics. Terrain is NOT stored: worldgen is deterministic,
// so the loader rebuilds it from the meta via the same pipeline the app
// uses, then lays the dynamic state back over it.
//
// What round-trips EXACTLY: everything in the save (verified by the smoke
// test's save→load→save hash identity). What re-warms instead: per-pass
// transients that the sim rebuilds on its own cadence anyway — war fronts
// (next muster/conquest tick), road trade-reach caches (next plan cycle),
// sea lanes (next sea pass), spatial grids (next tick). A loaded world is
// the same world mid-breath, not a frame-exact clone of an uninterrupted
// run across those warm-up intervals.

import { buildWorld as pipelineBuild } from "./pipeline.js";
import { initPeopleSim } from "./peopleSim/index.js";
import { reindexEvents } from "./peopleSim/events.js";
import { computeTerritory } from "./peopleSim/territory.js";
import { T, applyTuning, resetTuning, tuningDefaults } from "./peopleSim/tuning.js";

export const SAVE_VERSION = 1;

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
  "_coloniesSent", "_isColony", "_overlordCC",
  "_famineUntil", "_harvestMul", "_plagueUntil", "_plagueImmuneUntil", "_plagueActive",
  "cultureId", "culMix", "faithMix", "langMix", "ancMix", "_isColony", "_isolatedSince", "_ethnoSince", "_driftSince", "_diverged",
  "_specKey", "_specStr",   // agglomeration: the town's locked-in craft specialty + its strength
  "_unfree", "_cashFrac", "_captives",   // coerced labour: unfree workforce, cash-crop land, unsold captives
  "_serf",                               // serfdom: land-tenure coercion level (0..1)
  "_chronFlags",                         // chronicle: which "became X" archetype events have fired
  "_peakTier",                           // chronicle: highest tier ever reached (so growth is announced once)
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
    if (s._seaReach && s._seaReach.size) seaReach.push([s.id, [...s._seaReach.entries()]]);
  }

  const reserves = {};
  if (world.depositReserve) for (const id in world.depositReserve) reserves[id] = b64FromTyped(world.depositReserve[id]);

  return {
    v: SAVE_VERSION,
    meta: {
      W: world.width, H: world.height, seed: world.seed,
      preset: world.preset, oceanLevel: meta.oceanLevel ?? 0.78, tecParams: meta.tecParams || {},
    },
    step: world.step,
    eraAt: world._eraAt,              // display-calendar timeline (step each era was reached)
    eraProd: world._eraProd,          // demographic anchor: global productivity index
    climIndex: world._climIndex, climShock: world._climShock,   // dynamic-climate state (climate.js)
    popTotal: world._popTotal,        // last tick's world total (anchor input)
    counters: { settlement: world._nextSettlementId || 1, ship: world._nextShipId || 0, culture: world._nextCultureId || 1, faith: world._nextFaithId || 1, person: world._nextPersonId || 1, dynasty: world._nextDynastyId || 1, language: world._nextLanguageId || 1 },
    tuning,
    settlements,
    polities,
    cultures: world.cultures ? [...world.cultures.entries()] : [],
    languages: world.languages ? [...world.languages.entries()] : [],
    faiths: world.faiths ? [...world.faiths.entries()] : [],
    persons: world.persons ? [...world.persons.entries()] : [],
    dynasties: world.dynasties ? [...world.dynasties.entries()] : [],
    events: world.events || [],
    ships: world.ships || [],
    maps: {
      roadQuality: b64FromTyped(world.roadQuality),
      roadFlow: b64FromTyped(world.roadFlow),
      countryClaim: b64FromTyped(world._countryClaim),
      countryOwner: b64FromTyped(world._countryOwner),
      territoryOwner: b64FromTyped(world._territoryOwner),
      capturedAt: b64FromTyped(world._capturedAt),
    },
    reserves,
    tables: {
      warExhaust: mapToArr(world._warExhaust),
      linkMoney: mapToArr(world._linkMoney),
      inflRaw: mapToArr(world._inflRaw),
      manpower: mapToArr(world._manpower),
      plagueEvAt: mapToArr(world._plagueEvAt),
      plagued: world._plagued ? [...world._plagued] : [],
    },
    seaReach,
  };
}

export function serializeWorld(world, meta) {
  return JSON.stringify(saveWorld(world, meta));
}

// ── load ────────────────────────────────────────────────────────────────
export function loadWorld(data) {
  if (typeof data === "string") data = JSON.parse(data);
  if (!data || data.v !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${data && data.v} (expected ${SAVE_VERSION})`);
  }
  const m = data.meta;
  // Rebuild terrain + pipeline deterministically from the recorded identity.
  const { w, ter } = pipelineBuild({ W: m.W, H: m.H, seed: m.seed, preset: m.preset, oceanLevel: m.oceanLevel, tecParams: m.tecParams });
  // Tuning first: granularity / cadence levers shape createWorld behavior.
  resetTuning();
  applyTuning(data.tuning);
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
  world.faiths = new Map(data.faiths || []);
  world.persons = new Map(data.persons || []);
  world.dynasties = new Map(data.dynasties || []);

  for (const rec of data.settlements) {
    const s = { kind: "settlement", localRes: {}, _tradeReach: null, crops: [], ...rec };
    world.settlements.push(s);
  }
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
    world._capturedAt = loadTyped(data.maps.capturedAt, Int32Array, N) || world._capturedAt;
  }
  if (data.reserves && world.depositReserve) {
    for (const id in data.reserves) {
      const a = typedFromB64(data.reserves[id], Float32Array);
      if (a && world.depositReserve[id] && a.length === world.depositReserve[id].length) world.depositReserve[id] = a;
    }
  }
  const t = data.tables || {};
  world._warExhaust = arrToMap(t.warExhaust);
  world._linkMoney = arrToMap(t.linkMoney);
  world._inflRaw = arrToMap(t.inflRaw);
  world._manpower = arrToMap(t.manpower);
  world._plagueEvAt = arrToMap(t.plagueEvAt);
  world._plagued = new Set(t.plagued || []);
  if (data.seaReach) {
    for (const [sid, entries] of data.seaReach) {
      const s = world.settlements.find(x => x.id === sid);
      if (s) s._seaReach = new Map(entries);
    }
  }

  // Warm the economy immediately (territory tallies feed every settlement
  // update); political/military passes re-run on their own cadence.
  computeTerritory(world);
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
  }
  if (world.polities) {
    const ids = [...world.polities.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const p = world.polities.get(id);
      mixNum(id); mixNum(p.foundedStep); mixNum(p.endedStep); mixNum(p.treasury); mixStr(p.name);
    }
  }
  mixNum(world.events ? world.events.length : 0);
  if (world.roadQuality) { const rq = world.roadQuality; for (let i = 0; i < rq.length; i += 97) mixNum(rq[i]); }
  return (h >>> 0).toString(16);
}
