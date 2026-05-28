// ── Territory ────────────────────────────────────────────────────────
//
// Each settlement claims the land it can reach most cheaply, out to a
// reach budget. ONE budget-bounded multi-source Dijkstra over the whole
// map assigns every land tile to a settlement (or to wilderness), then a
// single pass tallies each settlement's food, resources, and mineable
// tiles from the land it controls. This replaces the old per-settlement
// farmland flood-fill (_farmedBy) and the separate resource-scan box.
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
  if (!owner || owner.length !== N) owner = world._territoryOwner = new Int32Array(N);
  owner.fill(-1);
  let cost = world._territoryCost;
  if (!cost || cost.length !== N) cost = world._territoryCost = new Float32Array(N);
  cost.fill(Infinity);

  const byId = new Map();
  const budget = new Map();
  const heap = new MinHeap();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    byId.set(s.id, s);
    budget.set(s.id, reachBudget(s));
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (cost[ti] > 0) { cost[ti] = 0; owner[ti] = s.id; heap.push(ti, 0); }
  }

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
      const c = baseEdgeCost(world, ti, ni);
      if (c === Infinity) continue;
      const nd = d + c * mul[k];
      if (nd > bud) continue;            // owner can't reach further
      if (nd < cost[ni]) { cost[ni] = nd; owner[ni] = oid; heap.push(ni, nd); }
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
