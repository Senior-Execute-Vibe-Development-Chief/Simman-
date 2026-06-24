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

import { localEdgeCost } from "./transport.js";
import { forEachNear } from "./spatialGrid.js";
import { T } from "./tuning.js";

// Reach budget, in transport-cost units (a plain tile = 1.0). Pure
// function of ORGANIZATION — the centre's willingness/ability to
// project administrative authority across distance, full stop.
//
// Other tech (construction, mobility, navigation) is NOT in the budget
// — it enters through localEdgeCost, reducing per-tile cost. The two
// interact correctly: organization buys you REACH; other tech buys you
// EFFICIENCY per step. A high-construction realm pays less per
// mountain tile (so it can hold more mountains within its budget), but
// it doesn't get a bigger budget for free. The chronicle of empires
// rising and falling is then ORG growing and shrinking, not a stew of
// four tracks moving together.
//
// Calibration: a plain tile costs ~1.0, so the radius in plains
// roughly equals the budget. Era-typical:
//   stone (org 0.05):  ~7  → ~7-tile plain radius   (city-state)
//   bronze (org 0.30): ~17 → ~17-tile radius        (kingdom)
//   iron (org 0.50):   ~25 → ~25-tile radius        (regional empire)
//   industrial (0.90): ~41 → ~41-tile radius        (continental)
//
// Across mountains the SAME budget reaches fewer tiles; with navy it
// can hop across coastal water at ~3 cost per tile and reach further.
const TERRITORY_BASE = 5;
// ORG_REACH -> runtime lever (tuning.js T.ORG_REACH)
export function reachBudget(s) {
  // URBAN_NODES: towns/cities (tier 1+) are urban nodes, not farmland owners —
  // they keep only their guaranteed core block, so the whole rural catchment
  // falls to the tier-0 Farming Regions (which feed them via the hierarchy).
  // Zero economic reach → the cost-Dijkstra adds nothing beyond the core. This
  // touches ONLY the economic catchment; the political border layer
  // (countryTerritory.js) has its own capital-anchored reach and is unaffected.
  if (T.URBAN_NODES && (s.tier | 0) >= 1) return 0;
  // Admin reach now comes from the reach techs (tech.js) via the settlement's
  // cached effects (reachLevel tracks organization); falls back to continuous
  // organization if the cache isn't computed yet.
  const reach = s._techEff ? s._techEff.reachLevel : ((s.knowledge && s.knowledge.organization) || 0);
  let b = TERRITORY_BASE + reach * T.ORG_REACH;
  // LOCALITY model: centres are spaced LOCALITY_SPACING× farther apart, so widen
  // each catchment to match — otherwise the freed land between them goes unfarmed
  // (food + population collapse) and centres stay village-sized. A locality farms
  // its whole hinterland.
  if (T.LOCALITY_MODE) b *= Math.max(1, T.LOCALITY_SPACING || 3);
  return b;
}

// Per-tile food weight by distance: 1 next to the centre, tailing off with
// transport cost so a sprawling claim doesn't linearly inflate food.
// Distance discount on a tile's food. Steep by default (a village farms what it
// can walk to). In LOCALITY mode it's gentle: a locality's rural population is
// spread ACROSS its catchment and works the whole thing, so far tiles still
// count — otherwise widening the catchment just adds discounted-to-nothing land.
function foodFalloff(cost) { return 1 / (1 + cost * (T.LOCALITY_MODE ? 0.04 : 0.5)); }

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
  // URBAN_NODES: a town/city is a NODE — its land is just a tight built-up
  // footprint (the city sits ON the land, it doesn't farm a heartland). Keeping
  // the big tier-scaled core would leave a city occupying a chunk of farmland;
  // a radius-1 block (the urban core) hands the rest to the Farming Regions.
  if (T.URBAN_NODES && t >= 1) return 1;
  return CORE_BY_TIER[t < 0 ? 0 : t > 3 ? 3 : t];
}

// Beyond the guaranteed core, every settlement is also GUARANTEED a farmland
// HINTERLAND out to this radius (by tier), claimed nearest-settlement-wins so a
// dominant city can't hoard all the shared countryside and a densely-packed
// town is never squeezed down to its bare core block. This belt is the land a
// region genuinely owns — and therefore carries with it when it secedes.
// Scaled by T.HINTERLAND_MULT (tuning.js); never smaller than the core.
const HINTERLAND_BY_TIER = [3, 4, 6, 8];
export function hinterlandRadiusFor(s) {
  const t = s.tier | 0;
  // URBAN_NODES: a town/city gets no guaranteed farmland belt beyond its core —
  // the countryside belongs to the Farming Regions (see reachBudget).
  if (T.URBAN_NODES && t >= 1) return coreRadiusFor(s);
  const base = HINTERLAND_BY_TIER[t < 0 ? 0 : t > 3 ? 3 : t];
  const mul = T.LOCALITY_MODE ? T.HINTERLAND_MULT * Math.max(1, T.LOCALITY_SPACING || 3) : T.HINTERLAND_MULT;
  return Math.max(coreRadiusFor(s), Math.round(base * mul));
}

class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const c = this.cap * 2; const t = new Int32Array(c); t.set(this.ti); const d = new Float64Array(c); d.set(this.d); this.ti = t; this.d = d; this.cap = c; }
  push(ti, d) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; const tt = this.ti[p], td = this.d[p]; this.ti[p] = this.ti[i]; this.d[p] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = p; } }
  popMin() { const ti = this.ti[0], d = this.d[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; const tt = this.ti[b], td = this.d[b]; this.ti[b] = this.ti[i]; this.d[b] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = b; } } return { ti, d }; }
}

// Resources whose richness we track per territory (gates knowledge + feeds
// export goods). Precious/gems also feed mining wealth.
const TERR_RES = ['timber','stone','copper','tin','iron','coal','horses','salt','precious','gems','spices','furs','incense','dyes'];

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
  const knOf = new Map();   // owner id → snapshot of its knowledge for localEdgeCost
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    byId.set(s.id, s);
    budget.set(s.id, reachBudget(s));
    knOf.set(s.id, s.knowledge || {});
  }

  // Release any tile whose owner is gone (died / unsettled) back to
  // wilderness, so neighbours can grow into the vacated land. Also
  // release any WATER tiles that lingered from an older code path —
  // borders shouldn't bleed into the ocean.
  // URBAN_NODES: also release land held by tier-1+ NODES (a settlement keeps the
  // catchment it claimed while still a tier-0 village even after it grows into a
  // city — ownership is persistent — so without this the change is inert). Their
  // CORE is re-stamped immediately below; the rest returns to wilderness for the
  // Farming Regions to reclaim.
  const releaseNodes = !!T.URBAN_NODES;
  for (let ti = 0; ti < N; ti++) {
    const o = owner[ti];
    if (o < 0) continue;
    if (!byId.has(o) || world.elev[ti] <= 0) { owner[ti] = -1; continue; }
    if (releaseNodes) { const os = byId.get(o); if (os && (os.tier | 0) >= 1) owner[ti] = -1; }
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

  // ── Guaranteed farmland hinterland (nearest-wins distance Voronoi) ──
  // Each settlement claims the land within its hinterland radius that it is the
  // NEAREST settlement to, carving fairly from wilderness AND from a neighbour
  // that had over-claimed the shared countryside — so every town keeps a real
  // farmland belt instead of being squeezed to its core. Cores are sacred
  // (skipped), and CONQUERED tiles are left to whoever took them (a tile with a
  // capture timestamp is battlefield land, not free countryside) so this never
  // undoes a conquest. Deterministic per pass ⇒ stable borders, no flicker.
  const hintDist = (world._hintDist && world._hintDist.length === N)
    ? world._hintDist : (world._hintDist = new Float32Array(N));
  hintDist.fill(Infinity);
  const capAt = world._tileCapturedAt;
  for (const s of byId.values()) {
    const sx = s.pos.x | 0, sy = s.pos.y | 0;
    const hr = hinterlandRadiusFor(s), hr2 = hr * hr;
    for (let dy = -hr; dy <= hr; dy++) {
      const ny = sy + dy; if (ny < 0 || ny >= th) continue;
      for (let dx = -hr; dx <= hr; dx++) {
        const d2 = dx * dx + dy * dy; if (d2 > hr2) continue;
        const nx = ((sx + dx) % tw + tw) % tw;
        const ti = ny * tw + nx;
        if (elev[ti] <= 0) continue;
        if (coreClaimed[ti] === stamp) continue;       // a settlement's core — sacred
        if (capAt && capAt[ti] > -Infinity) continue;  // conquered land — leave to the conqueror
        if (d2 < hintDist[ti]) { hintDist[ti] = d2; owner[ti] = s.id; }
      }
    }
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
    const kn  = knOf.get(oid);
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
      if (ni < 0) continue;
      const lk = base[ni];
      if (lk >= 0 && lk !== oid) continue;   // someone's locked land: a wall
      // Tech×terrain edge cost from the OWNER's perspective. A neolithic
      // civ pays the full mountain/cold/river-crossing tariff; a civ with
      // construction/navigation/mobility pays less. Water tiles return
      // Infinity unless this civ has the nav floor (≥0.10), in which case
      // they cost ~3-12 (sail) and the claim can hop offshore.
      const c = localEdgeCost(world, ti, ni, kn, true, true);  // reach ignores roads + the boat/land port tax (a settlement farms its hinterland on foot)
      if (c === Infinity) continue;
      const nd = d + c * mul[k];
      if (nd > bud) continue;                // owner can't reach further
      if (nd < cost[ni]) {
        cost[ni] = nd;
        // Walk THROUGH water (so a navy reaches the far shore) but don't
        // CLAIM water tiles — borders shouldn't bleed into the ocean.
        // Land tiles are claimed normally; water tiles just propagate
        // the cost frontier.
        if (lk < 0 && elev[ni] > 0) owner[ni] = oid;
        heap.push(ni, nd);
      }
    }
  }

  tallyTerritory(world, owner, cost, byId);
  if (T.URBAN_NODES) assignMinesByProximity(world, byId);
}

// URBAN_NODES: a mine is worked by whoever is NEAREST, not by who owns the
// (usually infertile, now-unclaimed) mountain it sits on — so the specie supply
// no longer collapses when cities stop owning broad reach-domains. This decouples
// minting from the farming catchment: the countryside (or a nearby city) works
// each deposit, and the silver spreads through trade, as it did historically.
const MINE_RANGE = 8;    // tiles within which a settlement works a mine (≈ a settlement's natural
                         // territory radius, so the worked-mine count — and thus the money supply —
                         // tracks the owned-territory baseline instead of minting every mountain)
function assignMinesByProximity(world, byId) {
  // Mine-tile list (precious/gems deposits), built once and cached.
  if (!world._mineTiles) {
    const list = [];
    const dep = world.deposits || {};
    for (const id of ["precious", "gems"]) {
      const arr = dep[id]; if (!arr) continue;
      for (let ti = 0; ti < world.N; ti++) if (arr[ti] > 0.05) list.push([ti, id]);
    }
    world._mineTiles = list;
  }
  if (!world._settGrid) return;   // need the spatial index (built each tick before territory)
  const tw = world.tw, reserve = world.depositReserve;
  for (const m of world._mineTiles) {
    const ti = m[0], id = m[1];
    if (reserve && reserve[id] && reserve[id][ti] <= 0) continue;   // dried-up mine — nobody works it
    const mx = ti % tw, my = (ti / tw) | 0;
    let best = null, bestD = Infinity;
    forEachNear(world, mx + 0.5, my + 0.5, MINE_RANGE, (s, d2) => { if (d2 < bestD) { bestD = d2; best = s; } });
    if (best) best._minableTiles.push(m);
  }
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
    s._terrWorkTiles = 0;
    s._terrMinFert = MIN_PLANTABLE_FERT_BASE - MIN_PLANTABLE_FERT_SLOPE * (s.knowledge.agriculture || 0);
    s._terrResAcc = {};
    s._minableTiles = [];
  }
  const haveDep = deposits && Object.keys(deposits).length > 0;
  const reserve = world.depositReserve;
  // A mine only counts while its finite reserve still holds metal — a dried-up
  // deposit stays on the map but no longer grants luxury budgets / value-cling.
  const mineLive = (id, ti) => !reserve || !reserve[id] || reserve[id][ti] > 0;
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti];
    if (oid < 0) continue;
    const s = byId.get(oid);
    if (!s) continue;
    s._terrTiles++;
    // WORKED tiles are those the settlement can actually reach this pass
    // (finite transport cost). Disconnected fragments — land kept by the
    // persistent-ownership rule after a front cut them off — contribute no
    // food, so they must not be charged the FARM_FERT_FLOOR labour cost
    // either (they used to actively REDUCE net food, a phantom workforce
    // farming land nobody could get to). updateFood reads _terrWorkTiles.
    const reachable = cost[ti] < Infinity;
    if (reachable) s._terrWorkTiles++;
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
      // URBAN_NODES assigns mines by PROXIMITY (assignMinesByProximity) instead of
      // ownership — a node city owns no mountains, so owned-tile mining would zero
      // the money supply. Skip the owned-tile mineral grab in that mode.
      if (!T.URBAN_NODES) {
        if (deposits.precious && deposits.precious[ti] > 0.05 && mineLive("precious", ti)) s._minableTiles.push([ti, "precious"]);
        if (deposits.gems && deposits.gems[ti] > 0.05 && mineLive("gems", ti)) s._minableTiles.push([ti, "gems"]);
      }
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
  const reserve = world.depositReserve;
  const mineLive = (id, ti) => !reserve || !reserve[id] || reserve[id][ti] > 0;
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
        if (deposits.precious && deposits.precious[ti] > 0.05 && mineLive("precious", ti)) minable.push([ti, "precious"]);
        if (deposits.gems && deposits.gems[ti] > 0.05 && mineLive("gems", ti)) minable.push([ti, "gems"]);
      }
    }
  }
  s._terrFertSum = fertSum;
  s._terrTiles = tiles;
  s._terrWorkTiles = tiles;   // local seed box is all walkable — everything counts as worked
  s.localRes = res;
  s._minableTiles = minable;
}
