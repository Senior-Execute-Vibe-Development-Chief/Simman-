// ── Territory ────────────────────────────────────────────────────────
//
// Each settlement claims the land it can reach most cheaply, out to a
// reach budget. Territory is PERSISTENT: once a tile is claimed it stays
// with its owner — settlements only expand into UNCLAIMED wilderness, and
// a neighbour's land is a wall they grow around, never over. So borders
// form once and hold; they only move when a settlement dies (its land
// returns to wilderness for survivors to take) or when it grows into new
// wilderness. This kills the every-pass border shimmer the old "rebuild
// the whole Voronoi from scratch each pass" approach produced.
//
// A small CORE around every home is always owned (carved even from a
// neighbour), so a freshly-founded town boxed in by an older one still
// gets a minimum domain to live on.
//
// Food drawn from a tile falls off with transport distance: near land is
// worked intensively, far land only lightly provisions the centre — and
// roads / rivers, by cutting the cost, pull more food in from afar (the
// Roman grain-lane effect). Resource CONTROL extends to the full domain
// edge (you tax/own the whole territory even if you don't farm it).

import { baseEdgeCost } from "./transport.js";

// Reach budget, in transport-cost units (a plain tile = 1.0). Grows with
// the things that actually extend a polity's reach — administration
// (organization), sheer size (population), and the transport techs
// (mobility, navigation). Roads enter automatically through baseEdgeCost.
// Deliberately NOT a function of age/time.
const TERRITORY_BASE = 5;
export function reachBudget(s) {
  const k = s.knowledge || {};
  return TERRITORY_BASE
    + (k.organization || 0) * 14
    + Math.min(22, Math.sqrt(Math.max(1, s.people)) * 0.35)
    + (k.mobility || 0) * 8
    + (k.navigation || 0) * 6;
}

// Per-tile food weight by distance: 1 next to the centre, tailing off with
// transport cost so a sprawling claim doesn't linearly inflate food.
function foodFalloff(cost) { return 1 / (1 + cost * 0.5); }

// Plantability floor (same idea as before): below this fertility a tile
// yields too little to feed anyone. Eased by agriculture knowledge.
const MIN_PLANTABLE_FERT_BASE  = 0.30;
const MIN_PLANTABLE_FERT_SLOPE = 0.20;

const SQRT2 = Math.SQRT2;

// Guaranteed home block (radius in tiles). Always owned by the settlement,
// stolen from a neighbour if need be. Kept smaller than half the minimum
// settlement spacing (MIN_SETT_DIST=12) so two cores can never overlap.
// Guaranteed home block. Its radius scales with the settlement's TIER, so a
// hamlet holds only its home cluster while a city commands a broad heartland
// — that size gap is what reads as a hierarchy on the map, and small village
// cores let settlements pack in densely without fighting over the same land.
const CORE_BY_TIER = [1, 2, 3, 4];
export function coreRadiusFor(s) {
  const t = s.tier | 0;
  return CORE_BY_TIER[t < 0 ? 0 : t > 3 ? 3 : t];
}

class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const c = this.cap * 2; const t = new Int32Array(c); t.set(this.ti); const d = new Float64Array(c); d.set(this.d); this.ti = t; this.d = d; this.cap = c; }
  push(ti, d) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; const tt = this.ti[p], td = this.d[p]; this.ti[p] = this.ti[i]; this.d[p] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = p; } }
  popMin() { const ti = this.ti[0], d = this.d[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; const tt = this.ti[b], td = this.d[b]; this.ti[b] = this.ti[i]; this.d[b] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = b; } } return { ti, d }; }
}

// Resources whose richness we track per territory (gates knowledge + feeds
// export goods). Precious/gems also feed mining wealth.
const TERR_RES = ['timber','stone','copper','tin','iron','coal','horses','salt','precious','gems'];

export function computeTerritory(world) {
  const { N, tw, th, elev } = world;
  let owner = world._territoryOwner;
  if (!owner || owner.length !== N) { owner = world._territoryOwner = new Int32Array(N); owner.fill(-1); }
  let cost = world._territoryCost;
  if (!cost || cost.length !== N) cost = world._territoryCost = new Float32Array(N);
  // Reset COST every pass (roads / budgets shift the food falloff) but keep
  // OWNER — ownership is persistent, that's what stabilises the borders.
  cost.fill(Infinity);

  const byId = new Map();
  const budget = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    byId.set(s.id, s);
    budget.set(s.id, reachBudget(s));
  }

  // Release any tile whose owner is gone (died / unsettled) back to
  // wilderness, so neighbours can grow into the vacated land.
  for (let ti = 0; ti < N; ti++) {
    const o = owner[ti];
    if (o >= 0 && !byId.has(o)) owner[ti] = -1;
  }

  // Guarantee each settlement its (tier-sized) core block, carving it from a
  // neighbour if necessary. Where two cores overlap (close settlements) the
  // FIRST to claim a tile this pass keeps it — and since we iterate in the
  // stable settlement order, the same one always wins, so no flicker.
  const heap = new MinHeap();
  const coreClaimed = world._coreClaimed && world._coreClaimed.length === N
    ? world._coreClaimed : (world._coreClaimed = new Int32Array(N));
  const stamp = (world._coreStamp = (world._coreStamp || 0) + 1);
  for (const s of byId.values()) {
    const sx = s.pos.x | 0, sy = s.pos.y | 0;
    const r = coreRadiusFor(s);
    for (let dy = -r; dy <= r; dy++) {
      const ny = sy + dy; if (ny < 0 || ny >= th) continue;
      for (let dx = -r; dx <= r; dx++) {
        const nx = ((sx + dx) % tw + tw) % tw;
        const ti = ny * tw + nx;
        if (elev[ti] <= 0) continue;
        if (coreClaimed[ti] === stamp) continue;   // already core of an earlier settlement this pass
        coreClaimed[ti] = stamp;
        owner[ti] = s.id;
      }
    }
    const home = sy * tw + sx;
    if (elev[home] > 0) { cost[home] = 0; heap.push(home, 0); }
  }

  // Snapshot LOCKED ownership (persistent land + cores). During the pass,
  // a locked tile owned by someone else is a wall; only tiles that are
  // wilderness in the snapshot are contestable — and they go to whoever
  // reaches them cheapest (true multi-source Voronoi over the free land).
  const base = owner.slice();

  // Multi-source Dijkstra. Cost propagates through a settlement's OWN tiles
  // (so food falloff is correct across its whole domain); free wilderness
  // is claimed by whoever reaches it cheapest within budget; another
  // settlement's locked land is a wall — grown around, never seized.
  while (heap.n > 0) {
    const { ti, d } = heap.popMin();
    if (d > cost[ti]) continue;
    const oid = owner[ti];
    const bud = budget.get(oid) || 0;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1;
    const xp = tx === tw - 1 ? 0 : tx + 1;
    const yu = ty - 1, yd = ty + 1;
    const ns = [
      ty * tw + xm, ty * tw + xp,
      yu >= 0 ? yu * tw + tx : -1,
      yd < th ? yd * tw + tx : -1,
      yu >= 0 ? yu * tw + xm : -1,
      yu >= 0 ? yu * tw + xp : -1,
      yd < th ? yd * tw + xm : -1,
      yd < th ? yd * tw + xp : -1,
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k];
      if (ni < 0 || elev[ni] <= 0) continue;
      const lk = base[ni];
      if (lk >= 0 && lk !== oid) continue;   // someone's locked land: a wall
      const c = baseEdgeCost(world, ti, ni);
      if (c === Infinity) continue;
      const nd = d + c * mul[k];
      if (nd > bud) continue;                // owner can't reach further
      if (nd < cost[ni]) {
        cost[ni] = nd;
        if (lk < 0) owner[ni] = oid;         // claim free wilderness
        heap.push(ni, nd);
      }
    }
  }

  tallyTerritory(world, owner, cost, byId);
}

// Walk every claimed tile once and accumulate each owner's food / resource
// / mineable stats, and record which settlements BORDER each other (their
// territories are adjacent) — used by the conquest layer. Cheap O(N) pass.
function tallyTerritory(world, owner, cost, byId) {
  const { N, tw, th, fert, deposits } = world;
  const borders = new Map();   // settlementId -> Set(bordering settlementIds)
  const addBorder = (a, b) => {
    if (a === b) return;
    let sa = borders.get(a); if (!sa) { sa = new Set(); borders.set(a, sa); } sa.add(b);
    let sb = borders.get(b); if (!sb) { sb = new Set(); borders.set(b, sb); } sb.add(a);
  };
  for (const s of byId.values()) {
    s._terrFertSum = 0;
    s._terrTiles = 0;
    s._terrMinFert = MIN_PLANTABLE_FERT_BASE - MIN_PLANTABLE_FERT_SLOPE * (s.knowledge.agriculture || 0);
    s._terrResAcc = {};
    s._minableTiles = [];
  }
  const haveDep = deposits && Object.keys(deposits).length > 0;
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti];
    if (oid < 0) continue;
    const s = byId.get(oid);
    if (!s) continue;
    s._terrTiles++;
    const f = fert[ti] || 0;
    if (f >= s._terrMinFert) s._terrFertSum += f * foodFalloff(cost[ti]);
    if (haveDep) {
      const acc = s._terrResAcc;
      for (const id of TERR_RES) {
        const arr = deposits[id];
        if (!arr) continue;
        const v = arr[ti] || 0;
        if (v > (acc[id] || 0)) acc[id] = v;
      }
      if (deposits.precious && deposits.precious[ti] > 0.05) s._minableTiles.push([ti, "precious"]);
      if (deposits.gems && deposits.gems[ti] > 0.05) s._minableTiles.push([ti, "gems"]);
    }
    // Borders: compare right + down neighbours (x wraps).
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const rt = ty * tw + (tx === tw - 1 ? 0 : tx + 1);
    const ro = owner[rt]; if (ro >= 0 && ro !== oid) addBorder(oid, ro);
    if (ty < th - 1) { const dn = ti + tw; const dno = owner[dn]; if (dno >= 0 && dno !== oid) addBorder(oid, dno); }
  }
  for (const s of byId.values()) s.localRes = s._terrResAcc;
  world._borders = borders;
}

// Cheap local fallback so a freshly-founded settlement has food + resource
// stats before the first full territory pass reaches it. Scans a small box
// around home.
export function seedLocalTerritory(world, s) {
  const { tw, th, fert, deposits } = world;
  const sx = s.pos.x | 0, sy = s.pos.y | 0;
  const minFert = MIN_PLANTABLE_FERT_BASE - MIN_PLANTABLE_FERT_SLOPE * (s.knowledge.agriculture || 0);
  let fertSum = 0, tiles = 0;
  const res = {};
  const minable = [];
  const haveDep = deposits && Object.keys(deposits).length > 0;
  for (let dy = -3; dy <= 3; dy++) {
    const ny = sy + dy; if (ny < 0 || ny >= th) continue;
    for (let dx = -3; dx <= 3; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const ti = ny * tw + nx;
      if ((world.elev[ti] || 0) <= 0) continue;
      tiles++;
      const f = fert[ti] || 0;
      const cost = Math.sqrt(dx * dx + dy * dy);
      if (f >= minFert) fertSum += f * foodFalloff(cost);
      if (haveDep) {
        for (const id of TERR_RES) { const arr = deposits[id]; if (!arr) continue; const v = arr[ti] || 0; if (v > (res[id] || 0)) res[id] = v; }
        if (deposits.precious && deposits.precious[ti] > 0.05) minable.push([ti, "precious"]);
        if (deposits.gems && deposits.gems[ti] > 0.05) minable.push([ti, "gems"]);
      }
    }
  }
  s._terrFertSum = fertSum;
  s._terrTiles = tiles;
  s.localRes = res;
  s._minableTiles = minable;
}
