// ── Web Worker: runs the peopleSim off the main thread ──
// The sim has several heavy periodic passes (territory / sea-lane / transport
// floods) that, on a large map at high speed, spike to tens of ms. Running
// them on the main thread stutters rendering. Here the worker steps the sim
// continuously and posts a RENDER SNAPSHOT ~30×/sec; the main thread renders
// from the latest snapshot, so a sim spike never blocks a frame.
//
// Messages IN:
//   { type:'init', w, tCrop, tileRes, seed }   — build + start the sim
//   { type:'control', playing, speed }          — play/pause + speed
//   { type:'select', id }                       — selected settlement (gets full detail)
// Messages OUT:
//   { type:'snapshot', ... }                    — see buildSnapshot()
//   { type:'stats', stats }                     — occasional HUD stats

import { initPeopleSim, stepPeopleSim, peopleSimStats } from "./peopleSim/index.js";
import { getTradeProfile } from "./peopleSim/settlement.js";
import { displayPByCountry } from "./peopleSim/inflation.js";
import { getChronicle, realmName } from "./peopleSim/chronicle.js";
import { applyTuning, resetTuning } from "./peopleSim/tuning.js";

let world = null;
let playing = false;
let speed = 5;
let selId = -1;
let viewMode = "terrain";    // main thread tells us the view so we only ship
                             // the money-flow / road-component extras when shown
let lastSnap = 0;
let snapCount = 0;
let staticSent = false;      // owner/roadQuality sent at least once?
const SNAP_MS = 33;          // ~30 snapshots/sec, independent of sim speed
const STEP_BUDGET_MS = 12;   // step at most this long per scheduling slice, then yield

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    try {
      world = initPeopleSim(m.w, { seed: m.seed, tCrop: m.tCrop, tileRes: m.tileRes, deposits: m.w.deposits });
      world._wantMoneyFlows = (viewMode === "money");   // build the money-flow overlay only when its view is up
      lastSnap = 0;
      buildSnapshot();            // immediate first frame
    } catch (err) {
      self.postMessage({ type: "error", message: err && err.message, stack: err && err.stack });
    }
  } else if (m.type === "control") {
    const wasPlaying = playing;
    if (m.playing !== undefined) playing = m.playing;
    if (m.speed !== undefined) speed = m.speed;
    if (playing && !wasPlaying) scheduleTick();      // (re)start stepping
    else if (!playing && world) buildSnapshot();     // refresh the paused frame
  } else if (m.type === "select") {
    selId = m.id;
    if (!playing && world) buildSnapshot();          // show the selection's detail now
  } else if (m.type === "view") {
    viewMode = m.view;
    if (world) world._wantMoneyFlows = (viewMode === "money");   // gate the per-tick money-flow overlay build
    if (!playing && world) buildSnapshot();          // refresh extras for the new view
  } else if (m.type === "tune") {
    // Live gameplay tuning. m.reset wipes back to defaults; m.values is a
    // partial { KEY: number } override map. Applied to the shared tuning
    // registry the sim reads, so it takes effect on the next pass.
    if (m.reset) resetTuning();
    applyTuning(m.values);
    if (!playing && world) buildSnapshot();           // reflect on the paused frame
  }
};

// While PLAYING the worker self-schedules a step/snapshot loop. While paused
// it stops entirely (snapshots are posted on demand from onmessage), so it
// burns no CPU and copies no buffers when nothing is advancing.
let scheduled = false;
function scheduleTick() { if (!scheduled && playing) { scheduled = true; setTimeout(tick, 0); } }

function tick() {
  scheduled = false;
  if (!world || !playing) return;
  // Adaptive steps-per-slice from the speed setting (mirrors the old main-
  // thread loop), bounded by a wall-clock budget so the worker keeps posting
  // snapshots even when a single step spikes — that spike stays off the main
  // (render) thread, which is the whole point.
  const curStep = world.step;
  const eraFactor = curStep < 100 ? 3 : curStep < 200 ? 2 : curStep < 500 ? 1.5 : 1;
  const maxSub = Math.min(12, Math.max(1, Math.ceil(speed / 3 * eraFactor)));
  const start = performance.now();
  for (let i = 0; i < maxSub; i++) {
    try { stepPeopleSim(world, 1); }
    catch (err) { self.postMessage({ type: "error", message: err && err.message, stack: err && err.stack }); playing = false; break; }
    if (performance.now() - start > STEP_BUDGET_MS) break;
  }
  const now = performance.now();
  if (now - lastSnap >= SNAP_MS) { buildSnapshot(); lastSnap = now; }
  scheduleTick();
}

// Lightweight per-settlement record — just what draw() needs for every
// settlement (sprites, country tint, capital/seat markers, hit-testing). The
// rich fields the info card shows are sent only for the SELECTED settlement.
function packSettlement(s) {
  return {
    id: s.id, name: s.name, mode: s.mode,
    pos: { x: s.pos.x, y: s.pos.y },
    people: s.people, tier: s.tier, countryId: s.countryId,
    wealth: s.wealth, _wealthDelta: s._wealthDelta, _minedRate: s._minedRate,
    _isPort: s._isPort, _vassalCount: s._vassalCount, liegeId: s.liegeId,
    army: s.army,         // for the leaderboard's "biggest armies" sort
    _shock: s._plagueActive ? 2 : (world.step < (s._famineUntil || 0) ? 1 : 0),
    _homeland: s._homeland ?? -1, _provinceCity: s._provinceCity ?? -1,   // Provinces overlay: captured-nation + admin seat
  };
}

// Full detail for the SELECTED settlement (merged onto its mirror record),
// including data the card derives via functions that need the live world.
function packSelected(s) {
  return {
    id: s.id,
    knowledge: s.knowledge, localRes: s.localRes,
    _minedRate: s._minedRate, _terrTiles: s._terrTiles, _terrFertSum: s._terrFertSum,
    waterAccess: s.waterAccess, _fishYield: s._fishYield,
    _foodSupply: s._foodSupply, _foodDemand: s._foodDemand, _urbanFactor: s._urbanFactor,
    food: s.food, _foodImportRate: s._foodImportRate, _civFoodDemand: s._civFoodDemand,
    _luxSupply: s._luxSupply, _luxDemand: s._luxDemand,
    army: s.army, loyalty: s.loyalty, _adminLoad: s._adminLoad, _ambition: s._ambition,
    unrest: s.unrest, _unrestCause: s._unrestCause,
    _developRate: s._developRate, _devReason: s._devReason, _housingPressed: s._housingPressed,
    _houseK: s._houseK, _foodK: s._foodK,
    _mInRate: s._mInRate, _mOutRate: s._mOutRate,
    foundedStep: s.foundedStep, parentSettlementId: s.parentSettlementId,
    _seaReachSize: s._seaReach ? s._seaReach.size : 0,
    _tradeProfile: getTradeProfile(s, world),
    history: s.history ? s.history.slice(-200) : [],
  };
}

function buildSnapshot() {
  const setts = [];
  for (const s of world.settlements) if (s.mode === "settled") setts.push(packSettlement(s));

  // Countries: send ids only; the main thread rebuilds the Map with mirror refs.
  const countries = [];
  if (world.countries) {
    for (const c of world.countries.values()) {
      // Personality: send the label + the trait vector (for a small bar
      // readout in the info panel). Cheap — a handful of floats per realm.
      const pers = c.personality
        ? { label: c.personality._label,
            aggression: c.personality.aggression, commerce: c.personality.commerce,
            expansionism: c.personality.expansionism }
        : null;
      countries.push({
        id: c.id, capitalId: c.capitalId,
        memberIds: c.members.map(m => m.id),
        hue: c.hue, range: c.range,
        _capacity: c._capacity, _loadTotal: c._loadTotal, _momentum: c._momentum,
        _fronts: c._fronts, _capitalBesieged: c._capitalBesieged,
        _treasury: c._treasury, _govRevenue: c._govRevenue, _govSpend: c._govSpend, _solvency: c._solvency,
        _taxRate: c._taxRate,
        _priceLevel: displayPByCountry(world, c),
        personality: pers,
      });
    }
  }

  // Selected settlement: full detail for the info card, plus its realm's
  // chronicle (per-country history) so the card can show the realm's story.
  // Both are sent only while a settlement is inspected.
  let selected = null, chronicle = null;
  if (selId >= 0 && world._byId) {
    const s = world._byId.get(selId);
    if (s && s.mode === "settled") {
      selected = packSelected(s);
      if (s.countryId >= 0) {
        const log = getChronicle(world, s.countryId);
        if (log && log.length) chronicle = { countryId: s.countryId, name: realmName(world, s.countryId), entries: log.slice(-60) };
      }
    }
  }

  // Transferable copies of the big per-tile arrays (zero-copy move to main).
  // owner (territory) + roadQuality change slowly, so only resend them every
  // few snapshots (the mirror keeps the last copy); roadFlow animates road
  // thickness so it streams every snapshot. This keeps the worker from
  // spending all its time slicing multi-MB arrays at high sim speed.
  snapCount++;
  const sendStatic = !staticSent || (snapCount % 6 === 0);
  staticSent = true;
  let owner = sendStatic && world._territoryOwner ? world._territoryOwner.slice() : null;
  if (owner) {
    // Drop tiles still owned by a settlement that has DIED but whose territory
    // the sim hasn't recomputed yet (computeTerritory releases them, but only
    // every TERRITORY_INTERVAL ticks, and we resend owner only every 6 snaps).
    // Without this the map renders "ghost" borders/colour fragments left behind
    // by dead settlements — the stray bits/outlines floating on the map.
    const settled = new Set();
    for (const s of world.settlements) if (s.mode === "settled") settled.add(s.id);
    for (let i = 0; i < owner.length; i++) { const o = owner[i]; if (o >= 0 && !settled.has(o)) owner[i] = -1; }
  }
  const roadQuality = sendStatic && world.roadQuality ? world.roadQuality.slice() : null;
  const roadFlow = world.roadFlow ? world.roadFlow.slice() : null;

  // Money view: the animated coin flows (change every tick → send each frame
  // while the view is open). Roads view: a clean per-tile component-root array
  // (changes slowly → gate with the static group).
  const moneyFlows = (viewMode === "money" && world._moneyFlows) ? world._moneyFlows : null;
  let tileComp = null;
  if (viewMode === "roads" && sendStatic && world._tileComp && world._tileCompSeen) {
    const tc = world._tileComp, seen = world._tileCompSeen, stamp = world._tileCompStampVal, N = world.N;
    tileComp = new Int32Array(N);
    for (let i = 0; i < N; i++) tileComp[i] = seen[i] === stamp ? tc[i] : -1;
  }
  // National border claim — computed in the sim each territory pass
  // (world._countryClaim); ship it with the static group like owner[]. The
  // renderer draws country borders/tints from this (smoother than owner[]).
  const countryClaim = sendStatic && world._countryClaim ? world._countryClaim.slice() : null;

  const transfer = [];
  if (owner) transfer.push(owner.buffer);
  if (roadQuality) transfer.push(roadQuality.buffer);
  if (roadFlow) transfer.push(roadFlow.buffer);
  if (tileComp) transfer.push(tileComp.buffer);
  if (countryClaim) transfer.push(countryClaim.buffer);

  // Global price-level summary for the HUD ticker — population-weighted
  // mean across all settlements, so it tracks "the average wheat price the
  // average citizen pays" rather than a count of isolated hamlets.
  let _Pnum = 0, _Pden = 0;
  if (world._inflRaw && world._networkComponents) {
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const root = world._networkComponents.has(s.id) ? world._networkComponents.get(s.id) : s.id;
      const p = world._inflRaw.get(root);
      if (p === undefined) continue;
      const w = Math.max(1, s.people);
      _Pnum += p * w; _Pden += w;
    }
  }
  const globalP = _Pden > 0 ? _Pnum / _Pden : 1;
  self.postMessage({
    type: "snapshot",
    step: world.step,
    tw: world.tw, th: world.th, tileRes: world.tileRes, N: world.N,
    stats: peopleSimStats(world),
    globalP,
    owner, roadQuality, roadFlow, tileComp, moneyFlows, countryClaim,
    settlements: setts,
    countries,
    seaLanes: sendStatic ? (world._seaLanes || []) : null,   // changes slowly; mirror keeps last
    ships: world.ships ? world.ships.map(sh => ({ x: sh.x, y: sh.y, landTi: sh.landTi, countryId: sh.countryId })) : null,
    armies: world.armies ? world.armies.map(m => ({ x: m.x, y: m.y, countryId: m.countryId, troops: m.troops })) : null,
    selected,
    chronicle,
  }, transfer);
}
