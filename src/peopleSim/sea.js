// ── Sea travel: ports, sea lanes, and overseas colonies ──────────────
//
// Land transport (transport.js) and territory (territory.js) treat water
// as impassable, so without this everything is locked to one landmass.
// This module adds the MARITIME layer on top, without touching the land
// model — the ocean stays unowned, roads never spill into it:
//
//   • PORTS    — a settlement with an open-water tile within reach of its
//                home can embark ships from it.
//   • SEA LANES — a port-to-port graph: Dijkstra over water tiles from
//                each port, range gated by navigation (no ships → no
//                ocean crossings). Reached ports become sea trade peers,
//                folded into the existing trade pass (updateTrade reads
//                s._seaReach alongside the road network), so grain and
//                goods move by ship and the money-flow overlay animates
//                gold across the water.
//   • COLONIES — a large, navigation-capable port periodically dispatches
//                a COLONY SHIP (a visible moving entity) to a distant
//                unsettled shore reachable by sea. On arrival it founds a
//                daughter settlement that INHERITS the parent's country —
//                so overseas empires form, and the existing administrative
//                overstretch / secession system can later fragment them.

import { makeSettlement } from "./settlement.js";
import { isContinentalLand } from "./state.js";

let _shipId = 1;
export function resetShipIds() { _shipId = 1; }

export const SEA_INTERVAL = 200;   // ticks between sea-lane / colony passes

// Sea routing. Cost is in the same path-cost units the trade pass already
// uses (TRANSPORT_PER_PATHCOST), so a sea leg's freight is comparable to a
// road leg's. Water is a cheap highway per tile; what limits it is RANGE,
// which scales with navigation — a pre-ship culture can only hop a narrow
// strait, a maritime power crosses oceans.
const SEA_STEP        = 0.35;   // cost per water tile (×√2 on diagonals)
const SEA_RANGE_BASE  = 8;      // sea reach (cost units) at navigation 0
const SEA_RANGE_NAV   = 90;     // extra sea reach per point of navigation
const MIN_NAV_FOR_SEA = 0.04;   // below this a settlement has no seacraft at all
const EMBARK_RADIUS   = 4;      // tiles to search around home for a water tile
const MAX_SEA_VISITS  = 8000;   // Dijkstra pop cap per port (bounds cost)
const SEA_MIN_POP     = 40;     // a port below this doesn't actively run lanes

// Colonisation.
const COLONY_MIN_POP    = 600;   // only sizable port cities send colonists
const COLONY_MIN_NAV    = 0.30;  // need real ocean-going ships
const COLONY_PEOPLE     = 30;    // colonists carried (migrated out of the parent)
const COLONY_COOLDOWN   = 800;   // ticks between expeditions from one port
const COLONY_ENDOW_FRAC = 0.12;  // share of the parent's coin the colonists carry
const COLONY_ENDOW_CAP  = 5000;
const COLONY_MIN_DIST   = 14;    // landing must be at least this far from any settlement
const COLONY_MIN_DIST_SQ = COLONY_MIN_DIST * COLONY_MIN_DIST;
const COLONY_CAND_CAP   = 60;    // top fertile candidates to spacing-check per attempt
const SHIP_SPEED        = 0.7;   // path tiles per tick, ×(1+navigation)

const SQRT2 = Math.SQRT2;

class MinHeap {
  constructor() { this.ti = new Int32Array(512); this.d = new Float64Array(512); this.n = 0; this.cap = 512; }
  _grow() { const c = this.cap * 2; const t = new Int32Array(c); t.set(this.ti); const d = new Float64Array(c); d.set(this.d); this.ti = t; this.d = d; this.cap = c; }
  push(ti, d) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; const tt = this.ti[p], td = this.d[p]; this.ti[p] = this.ti[i]; this.d[p] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = p; } }
  popMin() { const ti = this.ti[0], d = this.d[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; const tt = this.ti[b], td = this.d[b]; this.ti[b] = this.ti[i]; this.d[b] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = b; } } return { ti, d }; }
}

// Nearest open-water tile to a settlement's home, within EMBARK_RADIUS.
// -1 if landlocked. Terrain and position are fixed, so this is cached.
function findEmbarkTile(world, s) {
  const { tw, th, elev } = world;
  const sx = s.pos.x | 0, sy = s.pos.y | 0;
  let best = -1, bestD2 = Infinity;
  for (let dy = -EMBARK_RADIUS; dy <= EMBARK_RADIUS; dy++) {
    const ny = sy + dy; if (ny < 0 || ny >= th) continue;
    for (let dx = -EMBARK_RADIUS; dx <= EMBARK_RADIUS; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const ti = ny * tw + nx;
      if (elev[ti] > 0) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = ti; }
    }
  }
  return best;
}

// Dijkstra over WATER tiles only, from a port's embark tile, bounded by a
// cost budget and a pop cap. Returns the cost map and predecessor map.
function seaDijkstra(world, startTi, budget) {
  const { tw, th, elev } = world;
  const dist = new Map();
  const prev = new Map();
  const heap = new MinHeap();
  dist.set(startTi, 0);
  heap.push(startTi, 0);
  let visited = 0;
  while (heap.n > 0 && visited < MAX_SEA_VISITS) {
    const { ti, d } = heap.popMin();
    if (d > (dist.get(ti) ?? Infinity)) continue;
    visited++;
    if (d >= budget) continue;            // at the reach limit — don't expand further
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const yu = ty - 1, yd = ty + 1;
    const ns = [
      ty * tw + xm, ty * tw + xp,
      yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
      yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
      yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1,
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k];
      if (ni < 0 || elev[ni] > 0) continue;   // water only
      const nd = d + SEA_STEP * mul[k];
      if (nd > budget) continue;
      if (nd < (dist.get(ni) ?? Infinity)) { dist.set(ni, nd); prev.set(ni, ti); heap.push(ni, nd); }
    }
  }
  return { dist, prev };
}

function reconstructPath(prev, startTi, endTi) {
  const tiles = [];
  let cur = endTi, guard = 0;
  while (cur !== undefined && guard++ < 200000) {
    tiles.push(cur);
    if (cur === startTi) break;
    cur = prev.get(cur);
  }
  tiles.reverse();
  return tiles;
}

// Add a bidirectional sea trade link. tiles run A → B (with both home
// tiles as endpoints, for the overlay polyline); B stores the reverse so
// that whichever endpoint has the lower id — the one the trade pass
// iterates — always has the link oriented from itself toward the peer.
function addSeaLink(A, B, cost, tiles) {
  if (!A._seaReach) A._seaReach = new Map();
  if (!B._seaReach) B._seaReach = new Map();
  const exA = A._seaReach.get(B.id);
  if (!exA || cost < exA.cost) A._seaReach.set(B.id, { cost, tiles, sea: true });
  const rev = tiles.slice().reverse();
  const exB = B._seaReach.get(A.id);
  if (!exB || cost < exB.cost) B._seaReach.set(A.id, { cost, tiles: rev, sea: true });
}

// ── Periodic: rebuild the port→port sea-lane graph + attempt colonies ──
export function updateSea(world) {
  const { tw } = world;
  const homeTi = s => (s.pos.y | 0) * tw + (s.pos.x | 0);

  // Identify ports, clear last pass's sea reach, index embark tiles.
  const ports = [];
  const portByEmbark = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    if (s._embarkTile === undefined) s._embarkTile = findEmbarkTile(world, s);
    s._seaReach = null;
    s._isPort = s._embarkTile >= 0;
    if (s._isPort) { ports.push(s); portByEmbark.set(s._embarkTile, s); }
  }

  const lanes = [];
  const laneSeen = new Set();
  for (const A of ports) {
    const nav = A.knowledge.navigation || 0;
    if (nav < MIN_NAV_FOR_SEA || (A.people || 0) < SEA_MIN_POP) continue;
    const budget = SEA_RANGE_BASE + nav * SEA_RANGE_NAV;
    const { dist, prev } = seaDijkstra(world, A._embarkTile, budget);
    const aHome = homeTi(A);
    // Sea links to every other port reachable within budget.
    for (const [ti, d] of dist) {
      const B = portByEmbark.get(ti);
      if (!B || B === A) continue;
      const tiles = [aHome, ...reconstructPath(prev, A._embarkTile, ti), homeTi(B)];
      addSeaLink(A, B, d, tiles);
      const key = A.id < B.id ? A.id + ":" + B.id : B.id + ":" + A.id;
      if (!laneSeen.has(key)) { laneSeen.add(key); lanes.push({ tiles, cost: d }); }
    }
    // Colonisation from this port (own cooldown / size / nav gates inside).
    maybeColonize(world, A, dist, prev);
  }
  world._seaLanes = lanes;
}

// Pick the best unsettled coastal landing site reachable by sea from port
// A and launch a colony ship toward it. The site must be a continental
// land tile beside reachable water, fertile-ish, and clear of existing
// settlements. Colonists (people) and a coin endowment migrate out of A.
function maybeColonize(world, A, dist, prev) {
  if ((A.people || 0) < COLONY_MIN_POP) return;
  if ((A.knowledge.navigation || 0) < COLONY_MIN_NAV) return;
  if (world.step - (A._lastColony ?? -Infinity) < COLONY_COOLDOWN) return;

  const { tw, th, elev, fert } = world;
  // Collect candidate landing tiles: land neighbours of reachable water.
  // Keyed by land tile, keeping the cheapest sea cost + the water tile we
  // land from (for the ship's path).
  const cand = new Map();   // landTi -> { d, waterTi, f }
  for (const [wti, d] of dist) {
    const ty = (wti / tw) | 0, tx = wti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? wti - tw : -1, ty < th - 1 ? wti + tw : -1];
    for (let k = 0; k < 4; k++) {
      const lti = ns[k];
      if (lti < 0 || elev[lti] <= 0) continue;
      if (!isContinentalLand(world, lti)) continue;
      const ex = cand.get(lti);
      if (!ex || d < ex.d) cand.set(lti, { d, waterTi: wti, f: fert[lti] || 0 });
    }
  }
  if (cand.size === 0) return;

  // Rank by fertility (best new land first), spacing-check only the top few.
  const ranked = [];
  for (const [lti, info] of cand) ranked.push({ lti, ...info });
  ranked.sort((p, q) => q.f - p.f);
  const cap = Math.min(COLONY_CAND_CAP, ranked.length);
  let chosen = null;
  for (let i = 0; i < cap; i++) {
    const c = ranked[i];
    if (c.f < 0.05) break;                       // nothing worth a colony left
    if (siteIsClear(world, c.lti)) { chosen = c; break; }
  }
  if (!chosen) return;

  // Outfit the expedition: migrate colonists + seed coin out of the parent.
  const ly = (chosen.lti / tw) | 0, lx = chosen.lti - ly * tw;
  const waterPath = reconstructPath(prev, A._embarkTile, chosen.waterTi);
  const homeA = (A.pos.y | 0) * tw + (A.pos.x | 0);
  const fullPath = [homeA, ...waterPath, chosen.lti];
  const endow = Math.min((A.wealth || 0) * COLONY_ENDOW_FRAC, COLONY_ENDOW_CAP);
  A.people -= COLONY_PEOPLE;
  A.wealth = (A.wealth || 0) - endow;
  A._lastColony = world.step;

  if (!world.ships) world.ships = [];
  world.ships.push({
    id: _shipId++, kind: "colony",
    owner: A.id, countryId: A.countryId,
    knowledge: { ...A.knowledge },
    people: COLONY_PEOPLE, wealth: endow,
    landTi: chosen.lti,
    path: fullPath.map(ti => ({ x: (ti % tw) + 0.5, y: ((ti / tw) | 0) + 0.5 })),
    idx: 0, speed: SHIP_SPEED * (1 + (A.knowledge.navigation || 0)),
    x: A.pos.x, y: A.pos.y,
  });
  if (A.history) A.history.push({ step: world.step, type: "colony-launched", landTi: chosen.lti });
}

// A landing tile is clear if no settlement sits within COLONY_MIN_DIST.
function siteIsClear(world, lti) {
  const { tw } = world;
  const ty = (lti / tw) | 0, tx = lti - ty * tw;
  for (const o of world.settlements) {
    if (o.mode !== "settled") continue;
    let dx = Math.abs(o.pos.x - tx);
    if (dx > tw / 2) dx = tw - dx;
    const dy = o.pos.y - ty;
    if (dx * dx + dy * dy < COLONY_MIN_DIST_SQ) return false;
  }
  return true;
}

// ── Per tick: advance every colony ship; found its colony on arrival ──
export function moveShips(world) {
  const ships = world.ships;
  if (!ships || ships.length === 0) return;
  const { tw, th } = world;
  const live = [];
  for (const sh of ships) {
    sh.idx += sh.speed;
    const path = sh.path;
    if (!path || path.length < 2 || sh.idx >= path.length - 1) {
      foundColony(world, sh);
      continue;
    }
    const i0 = sh.idx | 0, i1 = Math.min(path.length - 1, i0 + 1), fr = sh.idx - i0;
    const p0 = path[i0], p1 = path[i1];
    let dxp = p1.x - p0.x;
    if (dxp > tw / 2) dxp -= tw; else if (dxp < -tw / 2) dxp += tw;
    sh.x = ((p0.x + dxp * fr) % tw + tw) % tw;
    sh.y = Math.max(0, Math.min(th - 1, p0.y + (p1.y - p0.y) * fr));
    live.push(sh);
  }
  world.ships = live;
}

function foundColony(world, sh) {
  const { tw } = world;
  const ly = (sh.landTi / tw) | 0, lx = sh.landTi - ly * tw;
  // A settlement may have crystallised on the target during the voyage;
  // if the shore is no longer clear the expedition is simply lost.
  if (!siteIsClear(world, sh.landTi)) return;
  const colony = makeSettlement(world, lx + 0.5, ly + 0.5, {
    people: sh.people,
    knowledge: { ...sh.knowledge },
    parentId: sh.owner,
    name: "colony",
  });
  colony.countryId = sh.countryId;        // colonial allegiance to the founder's realm
  colony.wealth = sh.wealth || 0;
  if (colony.history) colony.history.push({ step: world.step, type: "colony-founded", parent: sh.owner });
}
