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
//   { type:'view', view }                       — current view (gates per-view extras)
//   { type:'tune', values, reset }              — live tuning levers
// Messages OUT:
//   { type:'snapshot', ... }                    — see buildSnapshot() (stats embedded)
//   { type:'error', message, stack }            — init/step failure

import { initPeopleSim, stepPeopleSim, peopleSimStats } from "./sim/peopleSim/index.js";
import { getTradeProfile, dominantAnc } from "./sim/peopleSim/settlement.js";
import { displayPByCountry } from "./sim/peopleSim/inflation.js";
import { getChronicle, realmName } from "./sim/peopleSim/chronicle.js";
import { narrate } from "./sim/peopleSim/events.js";
import { perspectiveChronicle, exportHistory } from "./sim/peopleSim/historiography.js";
import { applyTuning, resetTuning } from "./sim/peopleSim/tuning.js";
import { serializeWorld, loadWorld } from "./sim/persist.js";
import { getPolity } from "./sim/peopleSim/entities.js";
import { familyOf, familyName } from "./sim/peopleSim/cultures.js";
import { doctrineLabel } from "./sim/peopleSim/faiths.js";
import { getPerson, getDynasty, ageOf, getDynastyTree, traitLabel } from "./sim/peopleSim/dynasties.js";
import { IDENTITY_K, diffuseIdentityField } from "./sim/peopleSim/identityField.js";
import { makeSettlement } from "./sim/peopleSim/settlement.js";
import { ensurePolity } from "./sim/peopleSim/entities.js";
import { TRAITS, labelFor } from "./sim/peopleSim/personality.js";
import { estimateCountryRange } from "./sim/peopleSim/conquest.js";

// Country editor: drop a FULLY-FORMED realm — a capital plus the cities and towns
// filling the territory its tech allows it to hold (estimateCountryRange), then a
// short settling burst so the borders, catchments and populations resolve into the
// realm's real equilibrium shape. So you see at a glance how big a given tech /
// character grows, and where its cities and towns sit. The burst spans a sea pass
// (SEA_INTERVAL=600) so navigation-capable realms cross water — ports, sea lanes
// and overseas holdings form, exactly as in the live sim — instead of staying
// land-locked (a shorter burst never reaches the colony/sea machinery).
const EDITOR_SETTLE_STEPS = 640;
function editorPlaceCountry(world, m) {
  if (!world) return;
  const tw = world.tw, th = world.th, elev = world.elev;
  const cx = Math.max(0, Math.min(tw - 1, Math.floor(m.x))), cy = Math.max(0, Math.min(th - 1, Math.floor(m.y)));
  if ((elev[cy * tw + cx] || 0) <= 0.005) return;   // must be on land
  const k = m.knowledge || {};
  const knowledge = {
    agriculture:  clamp01(k.agriculture, 0.5),
    construction: clamp01(k.construction, 0.1),
    organization: clamp01(k.organization, 0.1),
    metallurgy:   clamp01(k.metallurgy, 0),
    navigation:   clamp01(k.navigation, 0),
    mobility:     clamp01(k.mobility, 0),
  };
  // 1. the capital — a fresh people + polity, its own realm
  const cap = makeSettlement(world, cx + 0.5, cy + 0.5, {
    tier: 3, people: Math.max(800, m.people || 3000), knowledge, cradle: true, name: m.name || undefined,
  });
  const cid = cap.id;
  const pol = ensurePolity(world, cid, { seat: cap });
  const pers = { _base: {} };
  for (const t of TRAITS) { const v = Math.max(-1, Math.min(1, (m.personality && m.personality[t]) || 0)); pers[t] = v; pers._base[t] = v; }
  pers._label = labelFor(pers); pers._size = 1;
  pol.personality = pers;
  if (m.faithId != null && m.faithId >= 0) pol.faithId = m.faithId;
  // 2. fill the tech-allowed reach with cities (inner) and towns (outer)
  const reach = Math.max(8, Math.min(0.32 * tw, estimateCountryRange(world, cap, pers)));
  const spacing = Math.max(8, Math.round(0.04 * tw));
  for (let dy = -reach; dy <= reach; dy += spacing) for (let dx = -reach; dx <= reach; dx += spacing) {
    if (dx === 0 && dy === 0) continue;
    const d = Math.hypot(dx, dy); if (d > reach) continue;
    const mx = (((cx + (dx | 0)) % tw) + tw) % tw, my = cy + (dy | 0);
    if (my < 0 || my >= th) continue;
    if ((elev[my * tw + mx] || 0) <= 0.005) continue;   // land only
    const tier = d < reach * 0.5 ? 2 : 1;
    makeSettlement(world, mx + 0.5, my + 0.5, {
      tier, people: tier === 2 ? 1500 : 450, knowledge: { ...knowledge },
      countryId: cid, cultureId: cap.cultureId, parentId: cap.id,
    });
  }
  // 3. settle: claim the territory, size the catchments, resolve the tiers
  stepPeopleSim(world, EDITOR_SETTLE_STEPS);
  // 4. snap the drawn border to the claimed territory so it shows fully formed at once
  const co = world._countryOwner, claim = world._countryClaim;
  if (co && claim) for (let i = 0; i < co.length; i++) if (co[i] === cid) claim[i] = cid;
  return cap;
}
function clamp01(v, dflt) { v = v == null ? dflt : +v; return v < 0 ? 0 : v > 1 ? 1 : v; }

let world = null;
let genMeta = {};      // oceanLevel / tecParams — recorded into saves
let playing = false;
let speed = 30;        // TARGET ticks-per-second (see scheduleTick); 30 = ~1 step per snapshot
let selId = -1;
let chronPerspective = false; // chronicle rendered as the realm's scribes kept it
let dynastyOpen = false;      // the family-tree overlay is open — ship the ruling house graph
let viewMode = "terrain";    // main thread tells us the view so we only ship
                             // the money-flow / road-component extras when shown
let lastSnap = 0;
let snapCount = 0;
let lastEvSent = 0;          // event-feed cursor (incremental narration to the UI)
let selRealmId = -1;         // realm whose chronicle the panel is reading (-1 = follow selection)
let chronKey = "";     // signature of the last chronicle shipped (realm|len|perspective) — re-send only on change
let staticSent = false;      // owner/roadQuality sent at least once?
const SNAP_MS = 33;          // ~30 snapshots/sec, independent of sim speed
const STEP_BUDGET_MS = 12;   // step at most this long per scheduling slice, then yield

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    try {
      genMeta = m.genMeta || {};
      world = initPeopleSim(m.w, { seed: m.seed, tCrop: m.tCrop, tFlood: m.tFlood, tileRes: m.tileRes, deposits: m.w.deposits, tAncestry: m.tAncestry, terTw: m.terTw, terTh: m.terTh, ancestryCount: m.ancestryCount, ancHue: m.ancHue, tArrival: m.tArrival });
      world._wantMoneyFlows = (viewMode === "money");   // build the money-flow overlay only when its view is up
      // Re-init resets the per-run snapshot/selection state. playing/speed/view
      // are NOT reset (the main thread re-sends its current values right after
      // init) — but if a previous world was mid-play, keep stepping the new one
      // rather than silently freezing until the next control message.
      lastSnap = 0; snapCount = 0; staticSent = false; selId = -1; lastEvSent = 0; selRealmId = -1;
      buildSnapshot();            // immediate first frame
      if (playing) scheduleTick();
    } catch (err) {
      self.postMessage({ type: "error", message: err && err.message, stack: err && err.stack });
    }
  } else if (m.type === "control") {
    const wasPlaying = playing;
    if (m.playing !== undefined) playing = m.playing;
    if (m.speed !== undefined) speed = m.speed;
    tickAccum = 0; lastTickWall = performance.now();  // reset the pacer so a speed/play change doesn't dump a burst
    if (playing && !wasPlaying) scheduleTick();      // (re)start stepping
    else if (!playing && world) buildSnapshot();     // refresh the paused frame
  } else if (m.type === "select") {
    selId = m.id;
    if (!playing && world) buildSnapshot();          // show the selection's detail now
  } else if (m.type === "selectRealm") {
    selRealmId = m.id != null ? m.id : -1;           // panel reads this realm's chronicle
    if (!playing && world) buildSnapshot();
  } else if (m.type === "view") {
    viewMode = m.view;
    if (world) {
      world._wantMoneyFlows = (viewMode === "money");   // gate the per-tick money-flow overlay build
      // tell the sim which identity layer (if any) to diffuse for the lens in view
      world._identityLens = (viewMode === "culture" || viewMode === "faith" || viewMode === "language") ? viewMode : null;
      // refresh the field NOW so switching lens (or viewing while paused) shows
      // the county map immediately, not only after the next interval
      if (world._identityLens) diffuseIdentityField(world, world._identityLens);
    }
    staticSent = false;   // force the next snapshot to re-ship the static bundle (owner/claim/identity field) for the new lens
    if (!playing && world) buildSnapshot();          // refresh extras for the new view
  } else if (m.type === "chronicle-mode") {
    chronPerspective = !!m.perspective;
    if (!playing && world) buildSnapshot();          // refresh the open panel
  } else if (m.type === "dynasty-open") {
    dynastyOpen = !!m.open;                           // family-tree overlay shown/hidden
    if (!playing && world) buildSnapshot();           // ship/refresh the tree now
  } else if (m.type === "export-history") {
    if (world) {
      try { self.postMessage({ type: "historyData", json: JSON.stringify(exportHistory(world)), step: world.step }); }
      catch (err) { self.postMessage({ type: "error", message: "export failed: " + (err && err.message), stack: err && err.stack }); }
    }
  } else if (m.type === "save") {
    if (world) {
      try { self.postMessage({ type: "saveData", json: serializeWorld(world, genMeta), step: world.step }); }
      catch (err) { self.postMessage({ type: "error", message: "save failed: " + (err && err.message), stack: err && err.stack }); }
    }
  } else if (m.type === "load") {
    try {
      if (m.genMeta) genMeta = m.genMeta;
      world = loadWorld(m.json);
      world._wantMoneyFlows = (viewMode === "money");
      lastSnap = 0; snapCount = 0; staticSent = false; selId = -1; lastEvSent = 0; selRealmId = -1;
      buildSnapshot();
      if (playing) scheduleTick();
    } catch (err) {
      self.postMessage({ type: "error", message: "load failed: " + (err && err.message), stack: err && err.stack });
    }
  } else if (m.type === "tune") {
    // Live gameplay tuning. m.reset wipes back to defaults; m.values is a
    // partial { KEY: number } override map. Applied to the shared tuning
    // registry the sim reads, so it takes effect on the next pass.
    if (m.reset) resetTuning();
    applyTuning(m.values);
    if (!playing && world) buildSnapshot();           // reflect on the paused frame
  } else if (m.type === "editor.placeCountry") {
    if (world) { try { editorPlaceCountry(world, m); } catch (err) { self.postMessage({ type: "error", message: "place failed: " + (err && err.message), stack: err && err.stack }); } staticSent = false; buildSnapshot(); }
  }
};

// While PLAYING the worker self-schedules a step/snapshot loop. While paused
// it stops entirely (snapshots are posted on demand from onmessage), so it
// burns no CPU and copies no buffers when nothing is advancing.
// Yield via a MessageChannel, not setTimeout(0): nested timers are clamped to
// ~4ms, which silently capped the sim at ~250 slices/sec however high the
// speed slider went. A channel post re-enters immediately while still
// yielding to incoming messages.
// `speed` is the TARGET ticks-per-second the UI requests, so the displayed step
// advances at a predictable, watchable rate instead of "as fast as the CPU runs":
// at 30 tps it ticks up ~one step per snapshot (snapshots are ~30/s — see SNAP_MS),
// so you can actually read it counting up; lower values tick slower, higher ones
// pack several steps per snapshot. A sentinel >= UNBOUNDED_TPS means "as fast as
// possible" (the old behaviour). Paced modes wake ~once per snapshot and step
// however many ticks the elapsed wall-time has earned (a fractional accumulator,
// so e.g. 8 tps cleanly yields a step roughly every fourth snapshot); unbounded
// mode busy-loops via the MessageChannel (timers clamp to ~4ms, which would cap it).
const UNBOUNDED_TPS = 100000;
let scheduled = false, tickAccum = 0, lastTickWall = performance.now();
const _tickChan = new MessageChannel();
_tickChan.port1.onmessage = () => tick();
function scheduleTick() {
  if (scheduled || !playing) return;
  scheduled = true;
  if (speed >= UNBOUNDED_TPS) _tickChan.port2.postMessage(0);   // unbounded: re-enter immediately
  else setTimeout(tick, SNAP_MS);                               // paced: wake roughly once per snapshot
}

function tick() {
  scheduled = false;
  if (!world || !playing) return;
  // How many steps to run this slice. Unbounded → as many as the wall-clock budget
  // allows; paced → earned from elapsed real time × the target rate (so timer
  // jitter never changes the pace). Either way the budget below keeps a single
  // spiking step from blocking the snapshot cadence — and that spike stays off the
  // main (render) thread, which is the whole point of the worker.
  const now = performance.now();
  let steps;
  if (speed >= UNBOUNDED_TPS) {
    steps = Infinity;
  } else {
    const dt = Math.min(250, now - lastTickWall);   // clamp long gaps (tab unfocused) so we don't dump a flood
    tickAccum += dt / 1000 * speed;
    steps = Math.floor(tickAccum);
    tickAccum -= steps;
  }
  lastTickWall = now;
  const start = performance.now();
  for (let i = 0; i < steps; i++) {
    try { stepPeopleSim(world, 1); }
    catch (err) { self.postMessage({ type: "error", message: err && err.message, stack: err && err.stack }); playing = false; break; }
    if (performance.now() - start > STEP_BUDGET_MS) break;
  }
  const t = performance.now();
  if (t - lastSnap >= SNAP_MS) { buildSnapshot(); lastSnap = t; }
  scheduleTick();
}

// Lightweight per-settlement record — just what draw() needs for every
// settlement (sprites, country tint, capital/seat markers, hit-testing). The
// rich fields the info card shows are sent only for the SELECTED settlement.
function packSettlement(s) {
  return {
    id: s.id, name: s.name, mode: s.mode,
    pos: { x: s.pos.x, y: s.pos.y },
    people: s.people, tier: s.tier, countryId: s.countryId, cultureId: s.cultureId ?? -1,
    faithId: s.faithMix && s.faithMix.length ? s.faithMix[0][0] : -1,
    langId: s.langMix && s.langMix.length ? s.langMix[0][0] : -1,   // SPOKEN tongue (separate layer from the people)
    ancId: dominantAnc(s),   // dominant deep-ancestry stock (the slow genetic bedrock)
    // significant SECONDARY group (≥20%) per layer — the overlay checkerboards a
    // mixed unit between its top two colours so a split town reads at a glance.
    faithId2: s.faithMix && s.faithMix.length > 1 && s.faithMix[1][1] >= 0.2 ? s.faithMix[1][0] : -1,
    langId2: s.langMix && s.langMix.length > 1 && s.langMix[1][1] >= 0.2 ? s.langMix[1][0] : -1,
    cultureId2: s.culMix && s.culMix.length > 1 && s.culMix[1][1] >= 0.2 ? s.culMix[1][0] : -1,
    wealth: s.wealth, _wealthDelta: s._wealthDelta, _minedRate: s._minedRate,
    _isPort: s._isPort, _vassalCount: s._vassalCount, liegeId: s.liegeId,
    army: s.army,         // for the leaderboard's "biggest armies" sort
    _shock: s._plagueActive ? 2 : (world.step < (s._famineUntil || 0) ? 1 : 0),
    _homeland: s._homeland ?? -1, _provinceCity: s._provinceCity ?? -1,   // Provinces overlay: captured-nation + admin seat
    // Coerced-labour intensity 0..1 for the Society lens: how bound the labour is
    // (slaves as a share of people, serfdom, cash-crop plantation land).
    _coerce: Math.min(1, (s._unfreeRatio || 0) + 0.6 * (s._serf || 0) + 0.4 * (s._cashFrac || 0)),
  };
}

// Full detail for the SELECTED settlement (merged onto its mirror record),
// including data the card derives via functions that need the live world.
function packSelected(s) {
  return {
    id: s.id,
    knowledge: s.knowledge, localRes: s.localRes,
    _minedRate: s._minedRate, _terrTiles: s._terrTiles, _terrFertSum: s._terrFertSum,
    waterAccess: s.waterAccess, _fishYield: s._fishYield, _pastoral: s._pastoral,
    _foodSupply: s._foodSupply, _foodDemand: s._foodDemand, _urbanFactor: s._urbanFactor,
    food: s.food, _foodImportRate: s._foodImportRate, _civFoodDemand: s._civFoodDemand,
    _luxSupply: s._luxSupply, _luxDemand: s._luxDemand,
    army: s.army, loyalty: s.loyalty, _adminLoad: s._adminLoad, _ambition: s._ambition,
    unrest: s.unrest, _unrestCause: s._unrestCause,
    _developRate: s._developRate, _devReason: s._devReason, _housingPressed: s._housingPressed,
    _houseK: s._houseK, _foodK: s._foodK,
    _mInRate: s._mInRate, _mOutRate: s._mOutRate,
    _specKey: s._specKey, _specStr: s._specStr,                          // agglomeration: locked-in craft specialty
    _unfree: s._unfree, _captives: s._captives, _unfreeRatio: s._unfreeRatio,   // coerced labour
    _cashFrac: s._cashFrac, _cashSuit: s._cashSuit, _cashOut: s._cashOut, _serf: s._serf,
    foundedStep: s.foundedStep, parentSettlementId: s.parentSettlementId,
    _seaReachSize: s._seaReach ? s._seaReach.size : 0,
    _tradeProfile: getTradeProfile(s, world),
    _coloniesSent: s._coloniesSent || 0, _isColony: !!s._isColony,
    culMix: s.culMix || null, faithMix: s.faithMix || null, langMix: s.langMix || null,
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
      const pol = getPolity(world, c.id);
      const ruler = pol && pol.rulerId >= 0 ? getPerson(world, pol.rulerId) : null;
      const dyn = ruler ? getDynasty(world, ruler.dynastyId) : null;
      countries.push({
        id: c.id, capitalId: c.capitalId, name: realmName(world, c.id),
        _overlord: pol && pol._overlord != null ? pol._overlord : -1,   // colonial dependency → its metropole's countryId (-1 = sovereign)
        ruler: ruler && ruler.died < 0 ? { name: ruler.name, female: !!ruler.female, age: Math.round(ageOf(world, ruler)), house: dyn ? dyn.name : null, title: ruler._title || null, gov: pol ? pol.gov || "monarchy" : "monarchy", trait: traitLabel(ruler.traits) } : null,
        faithId: pol ? pol.faithId : -1,
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

  // Selected settlement: full detail for the info card. The chronicle follows
  // the explicitly inspected realm (selectRealm) when set, else the selected
  // settlement's realm.
  let selected = null, chronicle;   // chronicle: undefined = unchanged (UI keeps last); null = clear; object = full update
  if (selId >= 0 && world._byId) {
    const s = world._byId.get(selId);
    if (s && s.mode === "settled") selected = packSelected(s);
  }
  let chronCid = selRealmId;
  if (chronCid < 0 && selId >= 0 && world._byId) {
    const s = world._byId.get(selId);
    if (s && s.countryId >= 0) chronCid = s.countryId;
  }
  // The ENTIRE history of the selected realm — but re-narrated and shipped only
  // when it actually CHANGES (selection / a new event for it / perspective flip),
  // so a stable selection costs nothing per frame even for a thousand-event realm.
  {
    const idx = chronCid >= 0 && world._evIndex ? world._evIndex.get("p:" + chronCid) : null;
    const key = chronCid < 0 ? "" : chronCid + "|" + (idx ? idx.length : 0) + "|" + (chronPerspective ? 1 : 0);
    if (key !== chronKey) {
      chronKey = key;
      if (chronCid < 0) chronicle = null;
      else {
        const log = chronPerspective ? perspectiveChronicle(world, chronCid, 0) : getChronicle(world, chronCid);
        chronicle = log && log.length ? { countryId: chronCid, name: realmName(world, chronCid), entries: log, perspective: chronPerspective } : null;
      }
    }
  }
  // Ruling family tree — only when the overlay is open (cheap: it walks the house
  // roster + ancestry, not the whole person map). undefined = unchanged/closed.
  let dynasty;
  if (dynastyOpen) dynasty = chronCid >= 0 ? getDynastyTree(world, chronCid) : null;

  // Incremental event feed: only NEW events since the last snapshot are
  // narrated and shipped; the UI accumulates them into the live ticker.
  let feed = null;
  {
    const evs = world.events || [];
    if (evs.length > lastEvSent) {
      feed = [];
      for (let i = Math.max(lastEvSent, evs.length - 40); i < evs.length; i++) {
        const ev = evs[i];
        feed.push({ step: ev.step, type: ev.type, text: narrate(world, ev, -1), x: ev.x, y: ev.y });
      }
      lastEvSent = evs.length;
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

  // Per-tile identity field (identityField.js): for the active Peoples / Faiths /
  // Languages lens, ship the dominant id (+ a significant secondary, ≥20%, for
  // the mixed-unit checkerboard) PER TILE, so the overlay colours from the GRID
  // rather than flooding from settlement points. Slow-changing → static cadence.
  let fieldDom = null, fieldSec = null, fieldLayer = null;
  if (sendStatic) {
    const FK = IDENTITY_K, SEC_MIN = 51;   // 0.2 × 255
    const layerArrs =
      viewMode === "culture"  ? [world.tileCulId,   world.tileCulShr]   :
      viewMode === "faith"    ? [world.tileFaithId, world.tileFaithShr] :
      viewMode === "language" ? [world.tileLangId,  world.tileLangShr]  : null;
    if (layerArrs && layerArrs[0]) {
      const [idArr, shrArr] = layerArrs, N = world.N;
      fieldDom = new Int16Array(N); fieldSec = new Int16Array(N);
      for (let ti = 0; ti < N; ti++) {
        const b = ti * FK;
        fieldDom[ti] = idArr[b];
        fieldSec[ti] = (idArr[b + 1] >= 0 && shrArr[b + 1] >= SEC_MIN) ? idArr[b + 1] : -1;
      }
      fieldLayer = viewMode;
    }
  }

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
  if (fieldDom) { transfer.push(fieldDom.buffer); transfer.push(fieldSec.buffer); }

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
    eraAt: world._eraAt,             // display-calendar timeline (era → step it was reached)
    tw: world.tw, th: world.th, tileRes: world.tileRes, N: world.N,
    stats: peopleSimStats(world),
    globalP,
    owner, roadQuality, roadFlow, tileComp, moneyFlows, countryClaim,
    fieldDom, fieldSec, fieldLayer,   // per-tile identity field for the active culture/faith/language lens
    settlements: setts,
    countries,
    seaLanes: sendStatic ? (world._seaLanes || []) : null,   // changes slowly; mirror keeps last
    cultures: sendStatic && world.cultures ? [...world.cultures.values()].map(c => ({ id: c.id, name: c.name, hue: c.hue, parent: c.parentCultureId, root: familyOf(world, c.id), family: familyName(world, c.id) })) : null,
    faiths: sendStatic && world.faiths ? [...world.faiths.values()].filter(f => !(f.endedStep >= 0)).map(f => ({ id: f.id, name: f.name, hue: f.hue, kind: f.kind, parent: f.parentFaithId, root: f.rootFaithId, character: f.kind === "organized" ? doctrineLabel(f) : null })) : null,
    // Languages: id → FAMILY (rootId, for the map's family colour) + a name (the
    // namesake people, since each tongue is 1:1 with the culture that coined it).
    // The Languages map keys off each settlement's langId, NOT its cultureId, so it
    // diverges from the Peoples map wherever a people has shifted its speech.
    languages: sendStatic && world.languages ? (() => {
      const ownerByLang = new Map();
      if (world.cultures) for (const c of world.cultures.values()) if (c.languageId >= 0 && !ownerByLang.has(c.languageId)) ownerByLang.set(c.languageId, c.name);
      return [...world.languages.values()].map(l => ({ id: l.id, root: l.rootId ?? l.id, hue: l.hue, name: ownerByLang.get(l.id) || null }));
    })() : null,
    ships: world.ships ? world.ships.map(sh => ({ x: sh.x, y: sh.y, landTi: sh.landTi, countryId: sh.countryId })) : null,
    selected,
    chronicle,
    dynasty,
    feed,
  }, transfer);
}
