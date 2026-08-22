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
import { applyTuning, resetTuning, T, rNormPop, TUNING_SCHEMA } from "./sim/peopleSim/tuning.js";
import { serializeWorld, loadWorld } from "./sim/persist.js";
import { setBandWorkerUrl } from "./sim/peopleSim/popFieldPool.js";
import { getPolity } from "./sim/peopleSim/entities.js";
import { telEnable, telReport, telReset } from "./sim/peopleSim/telemetry.js";
import { familyOf, familyName } from "./sim/peopleSim/cultures.js";
import { doctrineLabel } from "./sim/peopleSim/faiths.js";
import { getPerson, getDynasty, ageOf, getDynastyTree, traitLabel } from "./sim/peopleSim/dynasties.js";
import { techState, ERAS } from "./sim/peopleSim/tech.js";
import { POP_SCALE } from "./sim/units.js";
import { IDENTITY_K, diffuseIdentityField } from "./sim/peopleSim/identityField.js";
import { makeSettlement } from "./sim/peopleSim/settlement.js";
import { ensurePolity } from "./sim/peopleSim/entities.js";
import { TRAITS, labelFor } from "./sim/peopleSim/personality.js";
import { estimateCountryRange } from "./sim/peopleSim/conquest.js";
import { makeTimeline, captureFrame, frameAt, frameCount, CAPTURE_IVL } from "./sim/timelineStore.js";

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
// The quiet ages fly (owner 2026-08-19): before any NATION exists the map has
// nothing political to watch, so while autoEpoch is on the worker escalates
// the effective pace to the frame budget's maximum (same budgeted path as
// UNBOUNDED_TPS) and returns to the user's speed dial the moment the first
// realm rises. Reads world STATE (realm count) — never the calendar.
let autoEpoch = true;
let fastEpochNow = false;
let quietAgesNow = false;   // the pre-nation condition itself (chip shows whenever it holds; gold = accelerating, dim = user opted out)
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
// ── The atlas filter + the timeline (owner features 2026-08-14) ──────────────
let minShowKm2 = 0;          // hide nations whose claim is smaller than this (km²) UNLESS they hold a settlement; 0 = show all
// ── The run journal (owner 2026-08-22: "you run it, I observe") ─────────────
// Every JOURNAL_EVERY steps the worker records the same metric line the gate
// probes print (register, stateless share, states, nations-as-blocs, biggest
// bloc, population), and "exportRunLog" downloads it with a PROVENANCE header
// (seed, grid, every off-default lever) — the three facts the 22.6k-screenshot
// investigation had to reverse-engineer from pixels. The file drops into
// docs/runs/ or pastes into chat and reads 1:1 against the ladder tables.
// The BUILD the run actually ran on — the ambiguity that cost a whole
// investigation when a screenshot could not be dated against the code
// (2026-08-21). __BUILD_SHA__ is vite's existing stale-tab define.
const _buildSha = () => { try { return typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "dev"; } catch { return "dev"; } };
let worldSeed = null;
const runJournal = [];
let _journalNext = 0, _funnelNext = 0, _jDeaths = 0, _jEvSeen = -1;
const JOURNAL_EVERY = 250;         // one metric line
const JOURNAL_FUNNEL_EVERY = 1000; // one telemetry-funnel window (probes' own channels)
const JOURNAL_CHANNELS = /^(found|siteCity|peerSeat|landNation|birthPolity|submit|integrate|attack|storm|capture|fission)$/;
function journalTick() {
  if (!world || world.step < _journalNext) return;
  _journalNext = world.step + JOURNAL_EVERY;
  let cities = 0, stateless = 0, pop = 0, subCity = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    cities++; pop += s.people || 0;
    if (s.countryId < 0) stateless++;
    // TOWNS WATCH (owner directive: nothing below a city may persist as an
    // entity) — settled entities whose urban core is under the city bar.
    if (s._urbanPop != null && s._urbanPop * POP_SCALE < 10000) subCity++;
  }
  const cs = world.countries;
  const ov = world._overlordOf || new Map();
  const rootOf = (id) => { let cur = id, h = 0; while (h++ < 12) { const o = ov.get(cur); if (o == null || o < 0 || o === cur) break; cur = o; } return cur; };
  const blocTiles = new Map(), blocRealms = new Map();
  const co = world._countryOwner;
  if (co && cs && cs.size) for (let i = 0; i < co.length; i++) { const id = co[i]; if (id >= 0) { const r = rootOf(id); blocTiles.set(r, (blocTiles.get(r) || 0) + 1); } }
  let singles = 0;
  if (cs) for (const c of cs.values()) {
    const r = rootOf(c.id);
    blocRealms.set(r, (blocRealms.get(r) || 0) + 1);
    if (!c.members || c.members.filter(m => m.mode === "settled").length === 1) singles++;
  }
  let bigTiles = 0, bigRoot = -1; for (const [r, t] of blocTiles) if (t > bigTiles) { bigTiles = t; bigRoot = r; }
  if (!world._km2PerTileW) { let lt = 0; for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) lt++; world._km2PerTileW = (510e6 * 0.29) / Math.max(1, lt); }
  // deaths since the journal began (cumulative — a count of things that have happened)
  const evs = world.events || [];
  for (let i = evs.length - 1; i >= 0; i--) { const ev = evs[i]; if (ev.id <= _jEvSeen) break; if (ev.type === "polity.ended" || ev.type === "polity.shattered") _jDeaths++; }
  if (evs.length) _jEvSeen = evs[evs.length - 1].id;
  const st = peopleSimStats(world);
  const era = ERAS[st.leadingEra || 0] || ERAS[0];
  runJournal.push(`step ${String(world.step).padStart(6)}  era=${era}  cities=${cities} (stateless ${cities ? (100 * stateless / cities).toFixed(0) : 0}%)  states=${cs ? cs.size : 0} (singl ${cs && cs.size ? (100 * singles / cs.size).toFixed(0) : 0}%)  nations=${blocRealms.size}  biggestBloc=${blocRealms.get(bigRoot) || 0} realms/${((bigTiles * world._km2PerTileW) / 1e6).toFixed(2)}Mkm2  bonds=${ov.size}  deathsEver=${_jDeaths}  subCity=${subCity}  pop=${(pop / 1000).toFixed(0)}M`);
  if (world.step >= _funnelNext) {
    _funnelNext = world.step + JOURNAL_FUNNEL_EVERY;
    const tr = telReport(world);
    for (const ch of Object.keys(tr).sort()) {
      if (!JOURNAL_CHANNELS.test(ch)) continue;
      const line = Object.entries(tr[ch]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join("  ");
      if (line) runJournal.push(`    ${ch}: ${line}`);
    }
    telReset(world);
  }
  if (runJournal.length > 12000) runJournal.splice(0, 2000);
}
let timeline = makeTimeline();   // ~every-year political frames (sparse diffs; see sim/timelineStore.js — shared with the main-thread fallback)
let lastKeyStep = 0;         // last frame's step (capture cadence anchor)
const SNAP_MS = 33;          // ~30 snapshots/sec, independent of sim speed
const STEP_BUDGET_MS = 12;   // step at most this long per scheduling slice, then yield

// ── The snapshot buffer pool (the 26.6k allocation wall, 2026-08-20) ─────────
// The owner's app died at ~26.6k steps on a 16KB heap grow — total exhaustion,
// not a big ask. The sim's own graph measured FLAT at both grids (probe_memgrowth
// live: heapUsed 63-73MB at 28-30k), the scrubber timeline negligible
// (probe_timelinemem: 0.3MB/30k) — what remained was THIS file's snapshot
// stream: fresh multi-MB transferables ~30×/sec (roadFlow every frame;
// owner/claim/roadQuality every 6th ≈ 60-90MB/s at tw=960) while the unbounded
// tick loop re-enters via MessageChannel and never idles, so allocation outruns
// collection until one allocation — any allocation — fails. Same disease the
// 2026-08-19 stall fix cured inside the sim, one layer up.
// The cure is the same reuse-slot idea stretched across the thread boundary:
// the main thread posts each DISPLACED mirror buffer back ({type:"bufret"}),
// and every per-snapshot array is built in a recycled buffer. Steady state
// after warmup: zero new ArrayBuffer allocation per snapshot, both threads.
// A pooled array is DIRTY — every maker below must overwrite every index
// (set()/full loop/fill) before it ships. Same full-overwrite rule as the
// sim's own reuse slots.
const _bufPool = new Map();   // byteLength → ArrayBuffer[] returned by the main thread
const POOL_KEEP = 6;          // per size class; ~2-3 are ever in flight per class
function pooledArr(Ctor, n) {
  const a = _bufPool.get(n * Ctor.BYTES_PER_ELEMENT);
  return a && a.length ? new Ctor(a.pop()) : new Ctor(n);
}
function pooledCopy(src) {
  const out = pooledArr(src.constructor, src.length);
  out.set(src);
  return out;
}

// ── The realm census in the browser console (owner 2026-08-20) ──────────────
// "log the size in km² of every nation, their centre point, neighbour count…
// their general identity." Auto-logs whenever the realm REGISTER changes (a
// nation rises or falls; debounced) and on a slow heartbeat; the page also
// exposes window.nations() for an on-demand table. One O(N) pass over the
// bordered field per print: per-realm claimed area, wrap-aware territorial
// centroid (circular mean over x — the map is a cylinder), and distinct
// neighbours along the border; the identity columns ride the realm register.
let lastNationN = -1, lastNationLogStep = -Infinity, lastNationWorld = null;
function logNationCensus(world, why) {
  if (!world) return;
  if (!world.countries || !world.countries.size) { console.log(`[nations] step ${world.step} · no realms yet`); return; }
  const { tw, th, N, elev } = world;
  const co = world._countryOwner;
  let landN = 0;
  const acc = new Map();   // id → area/centroid/neighbour accumulators
  const row = (id) => { let r = acc.get(id); if (!r) acc.set(id, r = { n: 0, sx: 0, cx: 0, ys: 0, nbrs: new Set() }); return r; };
  for (let i = 0; i < N; i++) {
    if (elev[i] > 0) landN++;
    if (!co) continue;
    const c = co[i];
    if (c < 0) continue;
    const y = (i / tw) | 0, x = i - y * tw;
    const r = row(c);
    const a = (x / tw) * 2 * Math.PI;
    r.n++; r.sx += Math.sin(a); r.cx += Math.cos(a); r.ys += y;
    const cr = co[y * tw + ((x + 1) % tw)];
    if (cr >= 0 && cr !== c) { r.nbrs.add(cr); row(cr).nbrs.add(c); }
    if (y < th - 1) { const cd = co[i + tw]; if (cd >= 0 && cd !== c) { r.nbrs.add(cd); row(cd).nbrs.add(c); } }
  }
  const km2 = (510e6 * 0.29) / Math.max(1, landN);
  const rows = [];
  for (const c of world.countries.values()) {
    const r = acc.get(c.id);
    const pol = getPolity(world, c.id);
    let pop = 0, urb = 0, wealth = 0, army = 0, cities = 0;
    if (c.members) for (const s of c.members) {
      if (!s || s.mode !== "settled") continue;
      cities++; pop += s.people || 0; urb += s._urbanPop || 0; wealth += s.wealth || 0; army += s.army || 0;
    }
    if (pol && pol.endedStep < 0) wealth += Math.max(0, pol.treasury || 0);
    const k = c.capital && c.capital.knowledge;
    let centre = "—";
    if (r && r.n > 0) {
      let xm = Math.atan2(r.sx / r.n, r.cx / r.n) / (2 * Math.PI);
      if (xm < 0) xm += 1;
      centre = `${(xm * 360 - 180).toFixed(1)}E ${(90 - (r.ys / r.n) / th * 180).toFixed(1)}N`;
    }
    rows.push({
      name: realmName(world, c.id), id: c.id,
      km2: r ? Math.round(r.n * km2) : 0,
      centre,
      nbrs: r ? r.nbrs.size : 0,
      cities,
      popM: +((pop * POP_SCALE) / 1e6).toFixed(2),        // province population, millions (catchment census — city + countryside)
      urbanK: Math.round((urb * POP_SCALE) / 1e3),        // people in the cities proper, thousands
      wealth: Math.round(wealth),                          // settlement coin + live treasury
      army: Math.round(army),
      org: k ? +(k.organization || 0).toFixed(2) : 0,      // the capital's statecraft (drives span/reach)
      era: k ? ERAS[techState(k).era] : "—",
      over: (() => {   // suzerain, if any — the atlas headline counts BLOCS (nations · states)
        const pol = getPolity(world, c.id);
        return pol && pol._overlord >= 0 && pol._overlord !== c.id ? realmName(world, pol._overlord) : "";
      })(),
    });
  }
  rows.sort((a, b) => b.km2 - a.km2);
  console.log(`[nations] step ${world.step} · ${rows.length} realm(s)${why ? ` · ${why}` : ""} · window.nations() re-prints`);
  try { console.table(rows); } catch { for (const r2 of rows) console.log(r2); }
}

self.onmessage = (e) => {
  const m = e.data;
  try { handleMessage(m); }
  catch (err) {
    // A handler outside the per-branch try/catches threw (view switch, tune,
    // select refresh, …). Report it instead of letting it escape to the page's
    // worker.onerror — an escaped exception used to read as "the worker is
    // broken" and cost the whole running world (see WorldSim's onerror).
    self.postMessage({ type: "error", where: "message", step: world && world.step, message: err && err.message, stack: err && err.stack });
  }
};
function handleMessage(m) {
  if (m.type === 'bandWorkerUrl') { setBandWorkerUrl(m.url); return; }   // popField pool: built-app band-worker chunk URL (page-resolved)
  if (m.type === "bufret") {
    // Consumed snapshot buffers coming home for reuse (see the pool note above).
    if (m.bufs) for (const b of m.bufs) {
      if (!(b instanceof ArrayBuffer) || !b.byteLength) continue;
      let a = _bufPool.get(b.byteLength);
      if (!a) _bufPool.set(b.byteLength, a = []);
      if (a.length < POOL_KEEP) a.push(b);
    }
    return;
  }
  if (m.type === "init") {
    try {
      genMeta = m.genMeta || {};
      world = initPeopleSim(m.w, { seed: m.seed, tCrop: m.tCrop, tFlood: m.tFlood, tileRes: m.tileRes, simTileRes: m.simTileRes, deposits: m.w.deposits, tAncestry: m.tAncestry, terTw: m.terTw, terTh: m.terTh, ancestryCount: m.ancestryCount, ancHue: m.ancHue, tArrival: m.tArrival });
      worldSeed = m.seed; runJournal.length = 0; _journalNext = 0; _funnelNext = 0; _jDeaths = 0; _jEvSeen = -1;
      telEnable(world);   // the journal's funnel windows — the probes' own channels, live in the app
      world._wantMoneyFlows = (viewMode === "money");   // build the money-flow overlay only when its view is up
      world._realWindGen = !!(genMeta && genMeta.realWind);   // terrain identity rides the WORLD (saves read it; caller meta is only a fallback)
      // Re-init resets the per-run snapshot/selection state. playing/speed/view
      // are NOT reset (the main thread re-sends its current values right after
      // init) — but if a previous world was mid-play, keep stepping the new one
      // rather than silently freezing until the next control message.
      lastSnap = 0; snapCount = 0; staticSent = false; selId = -1; lastEvSent = 0; selRealmId = -1; timeline = makeTimeline(); lastKeyStep = 0;
      _bufPool.clear();           // a new world can change N — stale-size buffers would never be hit again
      buildSnapshot();            // immediate first frame
      if (playing) scheduleTick();
    } catch (err) {
      self.postMessage({ type: "error", message: err && err.message, stack: err && err.stack });
    }
  } else if (m.type === "control") {
    const wasPlaying = playing;
    if (m.playing !== undefined) playing = m.playing;
    if (m.speed !== undefined) speed = m.speed;
    if (m.autoEpoch !== undefined) autoEpoch = !!m.autoEpoch;
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
      worldSeed = world && world.seed != null ? world.seed : worldSeed; runJournal.length = 0; _journalNext = world ? world.step : 0; _funnelNext = _journalNext; _jDeaths = 0; _jEvSeen = -1;
      if (world) telEnable(world);
      world._wantMoneyFlows = (viewMode === "money");
      lastSnap = 0; snapCount = 0; staticSent = false; selId = -1; lastEvSent = 0; selRealmId = -1; timeline = makeTimeline(); lastKeyStep = 0;
      _bufPool.clear();   // the loaded world can change N — stale-size buffers would never be hit again
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
  } else if (m.type === "nations") {
    // window.nations() — the on-demand realm census (see logNationCensus).
    logNationCensus(world, "requested");
  } else if (m.type === "exportRunLog") {
    const diffs = [];
    for (const cat of TUNING_SCHEMA) for (const p of (cat.params || [])) if (T[p.key] !== undefined && T[p.key] !== p.def) diffs.push(`${p.key}=${T[p.key]} (def ${p.def})`);
    const head = [
      `Simman run journal`,
      `seed=${worldSeed}  sim=${world ? world.tw + "x" + world.th : "?"}  step=${world ? world.step : 0}  build=${_buildSha()}  exported=${new Date().toISOString()}`,
      `levers off-default: ${diffs.length ? diffs.join("  ") : "none"}`,
      ``,
    ];
    self.postMessage({ type: "runLog", text: head.concat(runJournal).join("\n"), step: world ? world.step : 0 });
  } else if (m.type === "exportRunReport") {
    // The full observation artifact: journal + provenance + a political-map
    // frame every ~REPORT_MAP_EVERY steps sampled from the scrubber's own
    // timeline (CAPTURE_IVL-dense, full history). The UI renders the frames
    // and composes one self-contained HTML file.
    const REPORT_MAP_EVERY = 1000, MAX_FRAMES = 48;
    const frames = [], transfer = [];
    if (world && frameCount(timeline)) {
      const n = frameCount(timeline);
      const stride = Math.max(1, Math.ceil((world.step / REPORT_MAP_EVERY) / MAX_FRAMES)) * REPORT_MAP_EVERY;
      let nextStep = stride;
      for (let idx = 0; idx < n && frames.length < MAX_FRAMES; idx++) {
        const fr = frameAt(timeline, idx, world.N);
        if (!fr || fr.step < nextStep) continue;
        nextStep = fr.step + stride;
        frames.push({ step: fr.step, claim: fr.claim });
        transfer.push(fr.claim.buffer);
      }
    }
    const land = world ? new Uint8Array(world.N) : new Uint8Array(0);
    if (world) for (let i = 0; i < world.N; i++) land[i] = world.elev[i] > 0 ? 1 : 0;
    transfer.push(land.buffer);
    const diffs = [];
    for (const cat of TUNING_SCHEMA) for (const p of (cat.params || [])) if (T[p.key] !== undefined && T[p.key] !== p.def) diffs.push(`${p.key}=${T[p.key]} (def ${p.def})`);
    self.postMessage({
      type: "runReportData",
      step: world ? world.step : 0,
      tw: world ? world.tw : 0, th: world ? world.th : 0,
      head: `Simman run report\nseed=${worldSeed}  sim=${world ? world.tw + "x" + world.th : "?"}  step=${world ? world.step : 0}  build=${_buildSha()}  exported=${new Date().toISOString()}\nlevers off-default: ${diffs.length ? diffs.join("  ") : "none"}`,
      journal: runJournal.join("\n"),
      land, frames,
    }, transfer);
  } else if (m.type === "mapFilter") {
    // The atlas bar: hide nations below m.minKm2 (settlement-holders always show).
    minShowKm2 = m.minKm2 || 0;
    staticSent = false;
    if (!playing && world) buildSnapshot();
  } else if (m.type === "scrub") {
    // Timeline scrub by FRAME INDEX (~one frame per display year): decode via
    // the shared store and ship the full layer. The UI swaps it in for the
    // live political map.
    if (world && frameCount(timeline)) {
      const fr = frameAt(timeline, m.idx, world.N);
      if (fr) self.postMessage({ type: "timelineFrame", step: fr.step, idx: Math.max(0, Math.min(frameCount(timeline) - 1, m.idx | 0)), frame: fr.claim, count: frameCount(timeline) }, [fr.claim.buffer]);
    }
  }
}

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
  if (speed >= UNBOUNDED_TPS || fastEpochNow) _tickChan.port2.postMessage(0);   // unbounded / quiet-ages auto: re-enter immediately
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
  // Quiet ages = nothing on the map yet: no realm AND no settled settlement.
  // Under T.LAND_KNOW prehistory is entity-free until the tallies bar, so the
  // fast-forward carries the whole empty span and stands down the moment the
  // FIRST CITY lands (the first visible beat), a little before the first state.
  quietAgesNow = !!world && (!world.countries || world.countries.size === 0)
    && !(world.settlements && world.settlements.some((s) => s.mode === "settled"));
  fastEpochNow = autoEpoch && quietAgesNow;
  let steps;
  if (speed >= UNBOUNDED_TPS || fastEpochNow) {
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
    try {
      stepPeopleSim(world, 1);
      journalTick();
      if (world.step - lastKeyStep >= CAPTURE_IVL) { lastKeyStep = world.step; captureFrame(timeline, world); }
    }
    catch (err) {
      // The SIM threw. Pause (the world may be mid-mutation; stepping on would
      // compound it) and tell the page WHERE and WHEN, so it can show the user
      // instead of silently freezing at the last frame — the "game shuts down
      // at step N" report. The world object still exists: save/export stay up,
      // so the run can be rescued.
      self.postMessage({ type: "error", where: "step", step: world.step, message: err && err.message, stack: err && err.stack });
      playing = false;
      break;
    }
    if (performance.now() - start > (fastEpochNow ? 26 : STEP_BUDGET_MS)) break;   // quiet ages: bigger slice (map barely changes; messages still get in every ~26ms)
  }
  // The realm census (see logNationCensus): re-arm on a world swap (init/load),
  // log on register change (debounced) and on a slow heartbeat.
  if (lastNationWorld !== world) { lastNationWorld = world; lastNationN = -1; lastNationLogStep = -Infinity; }
  const nN = world.countries ? world.countries.size : 0;
  if (nN !== lastNationN) {
    const first = lastNationN < 0;
    lastNationN = nN;
    if (nN > 0 && (first || world.step - lastNationLogStep > 200)) {
      logNationCensus(world, first ? "census" : "the register changed");
      lastNationLogStep = world.step;
    }
  } else if (nN > 0 && world.step - lastNationLogStep >= 4000) {
    logNationCensus(world, "heartbeat");
    lastNationLogStep = world.step;
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
    // War overlay: under siege now (armies.js stamps _besiegedAt while a front
    // stands at the walls — same freshness the granary clock uses), and steps
    // since the last sack (the conquest-flash ring; null = never/long ago).
    _besieged: s._besiegedAt !== undefined && world.step - s._besiegedAt < (T.POLITY_INTERVAL || 150) * 1.5,
    _sackedAge: s._sackedAt !== undefined && world.step - s._sackedAt < 500 ? world.step - s._sackedAt : null,
    _homeland: s._homeland ?? -1, _provinceCity: s._provinceCity ?? -1,   // Provinces overlay: captured-nation + admin seat
    // Coerced-labour intensity 0..1 for the Society lens: how bound the labour is
    // (slaves as a share of people, serfdom, cash-crop plantation land).
    _coerce: Math.min(1, (s._unfreeRatio || 0) + 0.6 * (s._serf || 0) + 0.4 * (s._cashFrac || 0)),
    // Goods-vector prices (T.GOODS_PRICES) for EVERY settlement — the data a
    // future price-map lens paints; null and free when the levers are off.
    _gPrice: s._gPrice || null,
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
    // CITY CORE vs whole PROVINCE: s.people bundles the rural hinterland (it's the
    // sum over the settlement's entire catchment). _urbanPop is the people in the
    // urban core itself — the number the card should headline as "the city".
    _urbanPop: s._urbanPop, _ruralPop: s._ruralPop,
    _techEnv: s._techEnv || null,   // T.TECH_USE — the tree shows known-vs-used per site
    food: s.food, _foodImportRate: s._foodImportRate, _civFoodDemand: s._civFoodDemand,
    _luxSupply: s._luxSupply, _luxDemand: s._luxDemand,
    army: s.army, loyalty: s.loyalty, _adminLoad: s._adminLoad, _ambition: s._ambition,
    unrest: s.unrest, _unrestCause: s._unrestCause,
    // Loyalty field (ontology V2): the PEOPLE's attachment (county mean of
    // _allegiance) and the nation their ground still remembers, if any.
    _attach: s._attach,
    _homelandName: (s._homeland ?? -1) >= 0 ? realmName(world, s._homeland) : null,
    _developRate: s._developRate, _devReason: s._devReason, _housingPressed: s._housingPressed,
    _houseK: s._houseK, _foodK: s._foodK,
    _mInRate: s._mInRate, _mOutRate: s._mOutRate,
    _specKey: s._specKey, _specStr: s._specStr,                          // agglomeration: locked-in craft specialty
    _gPrice: s._gPrice || null, _gShare: s._gShare || null, _gNet: s._gNet || null,   // goods vector (T.GOODS_PRICES+): local market prices, craft labour, net flows
    _unfree: s._unfree, _captives: s._captives, _unfreeRatio: s._unfreeRatio,   // coerced labour
    _cashFrac: s._cashFrac, _cashSuit: s._cashSuit, _cashOut: s._cashOut, _serf: s._serf, _estates: s._estates,
    foundedStep: s.foundedStep, parentSettlementId: s.parentSettlementId,
    _seaReachSize: s._seaReach ? s._seaReach.size : 0,
    _tradeProfile: getTradeProfile(s, world),
    _coloniesSent: s._coloniesSent || 0, _isColony: !!s._isColony,
    culMix: s.culMix || null, faithMix: s.faithMix || null, langMix: s.langMix || null,
  };
}

// A snapshot failure must NEVER escape this function: it is called from the
// tick loop and every onmessage refresh, and an escaped exception reaches the
// page's worker.onerror — which used to tear down the worker and re-init a
// FRESH world, destroying the run (the sim itself was healthy; only the
// RENDERING of it failed). Report the error (throttled — the same broken read
// would otherwise spam every frame) and keep the sim alive: the map holds the
// last good frame, stepping continues, and save/export can rescue the world.
let _snapErrAt = -Infinity;
function buildSnapshot() {
  try { buildSnapshotUnsafe(); }
  catch (err) {
    const now = performance.now();
    if (now - _snapErrAt > 5000) {
      _snapErrAt = now;
      self.postMessage({ type: "error", where: "snapshot", step: world && world.step, message: err && err.message, stack: err && err.stack });
    }
  }
}
function buildSnapshotUnsafe() {
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
        _overlord: pol && pol._overlord != null ? pol._overlord : -1,   // dependency → its overlord's countryId (-1 = sovereign)
        _depKind: pol && pol._overlord != null ? (pol._depKind || "colony") : null,   // "colony" (planted, drawn in the metropole's colour) vs "vassal" (submitted court, keeps its own)
        _nomadic: !!c._nomadic,   // steppe confederation (derived each polity pass — conquest.js classifyNomads)
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
    // Cursor on permanent event IDS, not array length — compaction shortens
    // the array without renumbering, which froze a length cursor forever.
    const lastId = evs.length ? evs[evs.length - 1].id : -1;
    if (lastId >= lastEvSent) {
      feed = [];
      const base = evs.length ? evs[0].id : 0;
      for (let i = Math.max(lastEvSent - base, evs.length - 40); i < evs.length; i++) {
        if (i < 0) continue;
        const ev = evs[i];
        feed.push({ step: ev.step, type: ev.type, text: narrate(world, ev, -1), x: ev.x, y: ev.y });
      }
      lastEvSent = lastId + 1;
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
  let owner = sendStatic && world._territoryOwner ? pooledCopy(world._territoryOwner) : null;
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
  const roadQuality = sendStatic && world.roadQuality ? pooledCopy(world.roadQuality) : null;
  const roadFlow = world.roadFlow ? pooledCopy(world.roadFlow) : null;

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
      fieldDom = pooledArr(Int16Array, N); fieldSec = pooledArr(Int16Array, N);   // every index written below
      for (let ti = 0; ti < N; ti++) {
        const b = ti * FK;
        fieldDom[ti] = idArr[b];
        fieldSec[ti] = (idArr[b + 1] >= 0 && shrArr[b + 1] >= SEC_MIN) ? idArr[b + 1] : -1;
      }
      fieldLayer = viewMode;
    }
  }

  // Loyalty view (ontology V2, loyaltyField.js): the attachment continuum and
  // the ground's homeland memory, per tile. Packed for transfer: loyal is a
  // Uint8 heat (0..250 = attachment ×250; 255 = ungoverned, no reading);
  // loyalHome carries the remembered nation's id (-1 = none). Slow-changing
  // (updates once per polity pass) → static cadence.
  let loyal = null, loyalHome = null;
  if (viewMode === "loyalty" && sendStatic && world._allegiance && world._countryOwner) {
    const alg = world._allegiance, co = world._countryOwner, N = world.N;
    loyal = pooledArr(Uint8Array, N);   // every index written below
    for (let ti = 0; ti < N; ti++) loyal[ti] = co[ti] >= 0 ? Math.min(250, Math.round(Math.max(0, alg[ti]) * 250)) : 255;
    loyalHome = world._tileHomeland ? pooledCopy(world._tileHomeland) : null;
  }
  // Population view: the people-on-land field (popField — the canonical
  // demographic substrate) packed on an ABSOLUTE log ruler, NOT against the
  // frame's own maximum. The relative packing (log1p(pf)/log1p(popMax)) was
  // measured to destroy the lens both ways: at genesis the densest tile IS
  // ordinary farmland, so the whole habitable band sat at the top of the ramp
  // (a world-wide glow shaped like fertility); and as the world grows
  // multiplicatively, log-vs-max ratios compress toward 1 on every tile — the
  // pattern froze while the whole map drifted brighter. The fixed ruler:
  // census-units per REFERENCE tile (pf × bridge × rNormPop², grid-invariant),
  // log10 over 0.1..1000 — ≈100 → ≈1,000,000 real people at the UI's ×1000
  // display scale, 4 decades calibrated to the measured range (dawn median
  // ~230, cradle valleys ~6-10k, mature belts ~5-13k, urban cores beyond).
  // Same colour = same density in every era; a thin dawn world LOOKS thin.
  // popMax rides along for the legend, in the same per-reference-tile units.
  // (ONE_POP off: no bridge — the raw-unit fallback only shifts the ruler.)
  let popDens = null, popMax = 0;
  if (viewMode === "population" && sendStatic && world.popField) {
    const pf = world.popField, N = world.N;
    for (let ti = 0; ti < N; ti++) if (pf[ti] > popMax) popMax = pf[ti];
    const rn = rNormPop(world);
    const k = (world._onePopScale || 1) * rn * rn;   // field → census units per reference tile
    const LO = -1, SPAN = 4;                          // log10(0.1) .. log10(1000)
    popDens = pooledArr(Uint8Array, N);
    popDens.fill(0);   // pooled buffer is dirty and the loop SKIPS below-ruler tiles
    for (let ti = 0; ti < N; ti++) {
      const p = pf[ti] * k;
      if (p <= 0.1) continue;                         // below the ruler: effectively empty, leave the base map
      popDens[ti] = Math.min(250, Math.round((Math.log10(p) - LO) / SPAN * 250));
    }
    popMax *= k;
  }

  // Technique view: the idea field (world.devField) on an ABSOLUTE 0..1 ruler —
  // knowledge tracks are clamped 0..1, so ×250 is exact and the same colour
  // means the same technique in every era. Land at EXACTLY 0 is skipped: the
  // base map showing through IS the reading ("no idea has ever reached this
  // ground" — 60% of all land, the design doc's headline), so it must look like
  // wilderness, not like a low value. The lens exists because this field —
  // which sets capField and therefore how densely land peoples — had NO view in
  // the app, and every defect in it so far was found by writing a throwaway
  // probe (docs/design-idea-field.md).
  let devDens = null;
  if (viewMode === "technique" && sendStatic && world.devField) {
    const df = world.devField, N = world.N;
    devDens = pooledArr(Uint8Array, N);
    devDens.fill(0);   // pooled buffer is dirty and the loop SKIPS idea-free land
    for (let ti = 0; ti < N; ti++) {
      const d = df[ti];
      if (d <= 0) continue;
      devDens[ti] = Math.max(1, Math.min(250, Math.round(d * 250)));
    }
  }

  // Money view: the animated coin flows (change every tick → send each frame
  // while the view is open). Roads view: a clean per-tile component-root array
  // (changes slowly → gate with the static group).
  const moneyFlows = (viewMode === "money" && world._moneyFlows) ? world._moneyFlows : null;
  let tileComp = null;
  if (viewMode === "roads" && sendStatic && world._tileComp && world._tileCompSeen) {
    const tc = world._tileComp, seen = world._tileCompSeen, stamp = world._tileCompStampVal, N = world.N;
    tileComp = pooledArr(Int32Array, N);   // every index written below
    for (let i = 0; i < N; i++) tileComp[i] = seen[i] === stamp ? tc[i] : -1;
  }
  // National border claim — computed in the sim each territory pass (world._countryClaim);
  // shipped with the static group like owner[]. THE CATCHMENT IS TERRITORY: start from the
  // crawled political border (which projects into the wilderness between settlements), then
  // overlay every tile a settlement actually WORKS (world._territoryOwner) with that
  // settlement's country. So a realm always colours the land its settlements farm — a
  // settlement is never a bare dot on the map while its nascent capital's projected claim
  // is still ~0. Render-only (a per-tick slice; nothing in the sim reads this).
  let countryClaim = null;
  // Land-nation names for labels/hover (the polity registry does not ship;
  // this compact list does): [{id, ti, name}] for LIVE nations of the land.
  let landNations = null;
  if (sendStatic && T.STATE_OF_LAND && world._landSeats && world.polities) {
    landNations = [];
    for (const [id, r] of world._landSeats) {
      const pol = world.polities.get(id);
      if (pol && pol.endedStep < 0) landNations.push({ id, ti: r.ti, name: pol.name || null });
    }
  }
  if (sendStatic && T.CONTROL_FIELD && world._ctrlOwner) {
    // PRETTY MODE (control field as the drawn border): the political map is rendered from
    // the control field (world._ctrlOwner) — coherent, terrain-following, continuously-moving
    // borders — instead of the recompute crawl. The field is seeded by the SAME nations
    // (capitals) the sim's politics produce, so it draws the same realms with far nicer
    // borders, while the sim's AUTHORITATIVE _countryOwner is untouched (this is render-only).
    // The field carries control ACROSS WATER as a naval relay (a thalassocracy projects across
    // straits), so _ctrlOwner has owners on sea tiles — but water is never TERRITORY. Mask it
    // to -1 (exactly as CTRL_LIVE does when it publishes _countryOwner) so the drawn border
    // stops at the coast instead of bleeding into the ocean.
    // NEVER ABANDON SIM-OWNED LAND: the field fills a realm from its capital through its own
    // land, so a lobe cut off from the capital (only reachable across a neighbour or water) is
    // never reached and would be drawn empty — a "hole"/partial vanishing the sim never intended.
    // So fall back to the authoritative _countryOwner wherever the field is wilderness on land the
    // sim actually owns: the field prettifies the border where it reached, but a sim-owned tile is
    // ALWAYS drawn as its realm (the field can never overwrite a tile onto the wrong realm — it is
    // blocked from a neighbour's real land — so this only ever fills the field's own gaps).
    const src = world._ctrlOwner, elev = world.elev, co = world._countryOwner;
    countryClaim = pooledArr(Int32Array, src.length);   // every index written below
    for (let i = 0; i < src.length; i++) {
      if (!(elev && elev[i] > 0)) { countryClaim[i] = -1; continue; }         // water: never territory
      countryClaim[i] = src[i] >= 0 ? src[i] : (co && co[i] >= 0 ? co[i] : -1);
    }
  } else if (sendStatic && world._countryClaim) {
    countryClaim = pooledCopy(world._countryClaim);
    // Catchment overlay: paint every WORKED tile (world._territoryOwner) with its
    // settlement's country, so a realm colours the land its settlements farm even
    // while its capital's projected claim is still ~0. But this paints the RAW
    // catchment — recomputed in a batch every territory pass, and reaching AHEAD of
    // the smooth border CRAWL (_countryClaim) — so it makes the political map JUMP
    // each pass. Under the reactive model (CATCHMENT_CLIP) the catchment is already
    // clipped to _countryOwner, so the crawled border ALREADY covers it: skip the
    // overlay and let the border be the political map, which creeps tile-by-tile
    // instead of flickering (and a new realm no longer flashes a seed-catchment box
    // that then clips away). Kept for the legacy free-catchment model (lever off).
    const towner = world._territoryOwner, byId = world._byId;
    if (towner && byId && !T.CATCHMENT_CLIP) {
      for (let i = 0; i < countryClaim.length; i++) {
        const sid = towner[i];
        if (sid < 0) continue;
        const s = byId.get(sid);
        if (s && s.mode === "settled" && s.countryId >= 0) countryClaim[i] = s.countryId;
      }
    }
  }

  // ── Active wars + front arrows (Layers → War fronts) ───────────────────────
  // Directional pairs read from the war pass's own strategic-state stamps
  // (c._offEnemies = whom this court committed offense against, c._warStamp =
  // engaged-this-pass freshness), then a sampled set of aggressor→defender
  // arrows along each warring pair's DRAWN border (the countryClaim being
  // shipped, so arrows sit exactly on the border the player sees). Static
  // cadence; an empty array on a static send CLEARS the mirror (peace).
  let wars = null, warArrows = null;
  if (sendStatic && world.countries) {
    const freshW = (T.CONQUEST_INTERVAL || 100) * 2.5;
    wars = [];
    for (const c of world.countries.values()) {
      if (!c._offEnemies || !c._offEnemies.size) continue;
      if (world.step - (c._warStamp ?? -1e9) > freshW) continue;
      for (const e of c._offEnemies) { wars.push(c.id, e); }
    }
    if (wars.length && countryClaim) {
      const atk = new Map();   // attacker → Set(defender)
      for (let i = 0; i < wars.length; i += 2) { let s2 = atk.get(wars[i]); if (!s2) atk.set(wars[i], s2 = new Set()); s2.add(wars[i + 1]); }
      const tw2 = world.tw, th2 = world.th, cnt = new Map(), out = [];
      const STRIDE = Math.max(3, Math.round(tw2 / 90));   // ~constant arrows-per-border-length at every grid
      const push = (ax, ay, bx, by, a, d) => {
        const k = a + ":" + d, n = cnt.get(k) || 0; cnt.set(k, n + 1);
        if (n % STRIDE) return;
        if (out.length < 4 * 800) out.push(ax, ay, bx, by);
      };
      for (let ti = 0; ti < countryClaim.length; ti++) {
        const a = countryClaim[ti]; if (a < 0) continue;
        const py = (ti / tw2) | 0, px = ti - py * tw2;
        const b = countryClaim[px === tw2 - 1 ? ti - (tw2 - 1) : ti + 1];
        if (b >= 0 && b !== a) {
          const sA = atk.get(a), sB = atk.get(b);
          if (sA && sA.has(b)) push(px + 0.5, py + 0.5, px + 1.5, py + 0.5, a, b);
          if (sB && sB.has(a)) push(px + 1.5, py + 0.5, px + 0.5, py + 0.5, b, a);
        }
        if (py < th2 - 1) {
          const c2 = countryClaim[ti + tw2];
          if (c2 >= 0 && c2 !== a) {
            const sA = atk.get(a), sC = atk.get(c2);
            if (sA && sA.has(c2)) push(px + 0.5, py + 0.5, px + 0.5, py + 1.5, a, c2);
            if (sC && sC.has(a)) push(px + 0.5, py + 1.5, px + 0.5, py + 0.5, c2, a);
          }
        }
      }
      warArrows = Float32Array.from(out);
    } else warArrows = new Float32Array(0);
  }

  const transfer = [];
  if (owner) transfer.push(owner.buffer);
  if (roadQuality) transfer.push(roadQuality.buffer);
  if (roadFlow) transfer.push(roadFlow.buffer);
  if (tileComp) transfer.push(tileComp.buffer);
  // T.STATE_OF_LAND — nations of the land DRAW: their static basin claim
  // fills wherever neither the control field nor the realm crawl speaks (both
  // are seeded from capitals/settlements, which a tribal nation does not have
  // — at the app defaults tribal territory rendered NOTHING, so the first
  // visible nation was always a city-state). Applied to EITHER branch's map.
  if (T.STATE_OF_LAND && world._landOwner && countryClaim) {
    const lo = world._landOwner;
    for (let i = 0; i < countryClaim.length; i++) if (countryClaim[i] < 0 && lo[i] >= 0) countryClaim[i] = lo[i];
  }
  // THE ATLAS BAR (owner feature): nations below minShowKm2 vanish from the
  // political map — historical atlases at world zoom show polities from
  // roughly principality scale up — UNLESS they hold a settled community
  // (the owner's rule: a nation with a real settlement always shows).
  // Render-only: the sim's authoritative maps are untouched.
  if (countryClaim && minShowKm2 > 0) {
    if (!world._km2PerTileW) { let lt = 0; for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) lt++; world._km2PerTileW = (510e6 * 0.29) / Math.max(1, lt); }
    const counts = new Map();
    for (let i = 0; i < countryClaim.length; i++) { const id = countryClaim[i]; if (id >= 0) counts.set(id, (counts.get(id) || 0) + 1); }
    const hasSett = new Set();
    for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) hasSett.add(s.countryId);
    const barTiles = minShowKm2 / world._km2PerTileW;
    const hide = new Set();
    for (const [id, n] of counts) if (n < barTiles && !hasSett.has(id)) hide.add(id);
    if (hide.size) for (let i = 0; i < countryClaim.length; i++) if (hide.has(countryClaim[i])) countryClaim[i] = -1;
  }
  if (countryClaim) transfer.push(countryClaim.buffer);
  if (fieldDom) { transfer.push(fieldDom.buffer); transfer.push(fieldSec.buffer); }
  if (loyal) { transfer.push(loyal.buffer); if (loyalHome) transfer.push(loyalHome.buffer); }
  if (popDens) transfer.push(popDens.buffer);
  if (devDens) transfer.push(devDens.buffer);

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
    timelineN: frameCount(timeline),   // frames available to the history scrubber
    eraAt: world._eraAt,             // display-calendar timeline (era → step it was reached)
    tw: world.tw, th: world.th, tileRes: world.tileRes, N: world.N,
    stats: peopleSimStats(world),
    fastEpoch: fastEpochNow,   // the auto-throttle is APPLIED
    quietAges: quietAgesNow,   // the pre-nation condition holds (chip visible; gold when applied, dim when opted out)
    globalP,
    owner, roadQuality, roadFlow, tileComp, moneyFlows, countryClaim, landNations,
    wars, warArrows,   // active war pairs + sampled aggressor→defender border arrows (static cadence; [] clears)
    fieldDom, fieldSec, fieldLayer,   // per-tile identity field for the active culture/faith/language lens
    loyal, loyalHome,                 // loyalty lens: attachment heat + the ground's remembered nation
    // popMax → CENSUS people per REFERENCE tile on the densest ground (already
    // × bridge × rNormPop² at pack time); the legend then ×POP_SCALE via fmtPeople.
    popDens, popMax: popDens ? popMax : undefined,   // population lens: absolute-ruler people-on-land
    devDens,                          // technique lens: the idea field, absolute 0..1 ruler ×250
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
