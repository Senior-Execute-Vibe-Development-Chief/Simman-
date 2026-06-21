// ── Sea travel: ports, sea lanes, and overseas colonies ──────────────
//
// Land transport (transport.js) and territory (territory.js) treat water
// as impassable, so without this everything is locked to one landmass.
// This adds the MARITIME layer on top, without touching the land model —
// the ocean stays unowned, roads never spill into it:
//
//   • PORTS    — a settlement with an open-water tile near its home can
//                embark ships from it.
//   • SEA LANES — built by ONE multi-source flood over the ocean: every
//                port is a seed, each water tile falls to the nearest port
//                it can reach within that port's navigation budget. Where
//                two ports' waters meet we get a direct sea link; a
//                TRANSITIVE closure over that port graph then connects
//                distant ports through the chain of lanes they share — so
//                port 1 reaches port 2 via port 3 exactly like roads chain
//                through shared settlements. Reached ports become sea
//                trade peers (s._seaReach), folded into the existing trade
//                pass, so grain and goods move by ship and the money
//                overlay animates gold across the water.
//   • COLONIES — a large, navigation-capable port dispatches a visible
//                COLONY SHIP to an unsettled shore anywhere in its
//                reachable waters (a wide ocean is crossable in one voyage
//                if navigation is high enough). The colony inherits the
//                founder's country, so overseas empires form, and the
//                administrative overstretch / secession system can later
//                fragment them.
//
// One global flood per pass (bounded by a visit cap) keeps this cheap
// regardless of how many ports exist — far cheaper than a per-port flood.

import { makeSettlement, techEff } from "./settlement.js";
import { logEvent } from "./events.js";
import { dominantCulture } from "./cultures.js";
import { T } from "./tuning.js";
import { isContinentalLand } from "./state.js";
import { recordOut, OUT_COLONY } from "./money.js";
import { expansionColonyMul } from "./personality.js";
import { forEachNear } from "./spatialGrid.js";

// Ship ids count up per world (world._nextShipId) — see the settlement-id
// note in settlement.js for why module-scope counters are off limits.

export const SEA_INTERVAL = 600;   // ticks between sea-lane / colony passes. This is
                                   // a global ocean flood (O(map)) — a frame spike at
                                   // high sim speed — and sea lanes/colonies change
                                   // slowly, so it runs infrequently.

// Sea routing. Cost is in the same path-cost units the trade pass uses
// (TRANSPORT_PER_PATHCOST). Water is a cheap highway per tile; what limits
// a port is RANGE, which scales with navigation — a pre-ship culture hops
// a strait, a maritime power crosses an ocean.
const SEA_STEP        = 0.24;    // cost per water tile (×√2 on diagonals) — below road quality, so sea lanes win more long routes (ships beat carts on bulk)
const SEA_RANGE_BASE  = 10;      // sea reach (cost units) at navigation 0
// SEA_RANGE_NAV -> runtime lever (tuning.js T.SEA_RANGE_NAV)
// Wind. A leg sailed with the wind is cheaper, against it dearer (tacking).
// align = unit-heading · wind direction ∈ [-1,1]; effect scales with wind
// strength so doldrums barely matter and trade-wind belts shape the routes.
const WIND_AID  = 0.5;    // max ± cost swing from a full-strength head/tail wind
const WIND_STR  = 1.6;    // how quickly wind magnitude saturates to full effect
const WIND_MULT_MIN = 0.45, WIND_MULT_MAX = 1.7;
const MIN_NAV_FOR_SEA = 0.04;    // below this a settlement has no seacraft
const EMBARK_RADIUS   = 4;       // tiles to search around home for water
// SEA_MIN_POP -> runtime lever (tuning.js T.SEA_MIN_POP)
const MAX_SEA_VISITS  = 300000;  // global flood pop cap (one flood per pass)
const MAX_ROUTE_TILES = 1200;    // cap on a sea path's stored tile count
// A port keeps a bounded set of sea partners (the per-tick trade pass is
// O(ports × peers); a fully navigable ocean would otherwise connect every port
// to every other). It keeps the ones it derives the MOST VALUE from — gravity
// (the partner's economic size) + the LUXURY it can source there — discounted by
// freight, NOT merely the nearest. That is what lets a wealthy port reach a
// DISTANT scarce-luxury source (the spice run / VOC route). T.SEA_MAX_PEERS sets
// the count (a bigger fleet/economy sustains more far-flung links).
const SEA_FREIGHT_K = 0.02;   // how much a partner's route cost discounts its trade value in peer selection

// Colonisation. Tuned to be reasonably common: a navigation-capable city
// mounts expeditions fairly often, and a young colony is supplied from
// home (see supplyColonies in conquest.js) so it survives its first years.
// COLONY_MIN_POP -> runtime lever (tuning.js T.COLONY_MIN_POP)
const COLONY_MIN_NAV    = 0.25;  // need ocean-going ships
const COLONY_PEOPLE     = 30;    // colonists carried (migrated out of parent)
const COLONY_COOLDOWN   = 500 / 1.1; // ticks between expeditions from one port
                                 // (÷1.1 re-anchors the 0.5-pivot expansionColonyMul,
                                 // which divides this; behaviour identical)
const COLONY_ENDOW_FRAC = 0.12;  // share of the parent's coin colonists carry
const COLONY_ENDOW_CAP  = 5000;
const COLONY_MIN_DIST   = 14;    // landing must be this far from any settlement (grid near-query radius)
const COLONY_PER_PORT_CAND = 400; // cap shore candidates collected per port

// 8-neighbour offsets (match the flood's neighbour order) for wind heading.
const DX = [-1, 1, 0, 0, -1, 1, -1, 1];
const DY = [0, 0, -1, 1, -1, -1, 1, 1];
// Wind cost multiplier for sailing from any tile toward (dx,dy), using the
// wind at the destination tile. With the wind → cheaper; into it → dearer.
function windMul(world, ni, dx, dy) {
  const wx = world._windX;
  if (!wx) return 1;
  const wvx = wx[ni], wvy = world._windY[ni];
  const wmag = Math.sqrt(wvx * wvx + wvy * wvy);
  if (wmag < 1e-4) return 1;
  const dmag = Math.sqrt(dx * dx + dy * dy);
  const align = (dx * wvx + dy * wvy) / (dmag * wmag);   // [-1,1]
  const strength = Math.min(1, wmag * WIND_STR);
  let m = 1 - WIND_AID * align * strength;
  return m < WIND_MULT_MIN ? WIND_MULT_MIN : m > WIND_MULT_MAX ? WIND_MULT_MAX : m;
}
// SHIP_SPEED -> runtime lever (tuning.js T.SHIP_SPEED)

const SQRT2 = Math.SQRT2;

class MinHeap {
  constructor() { this.ti = new Int32Array(1024); this.d = new Float64Array(1024); this.n = 0; this.cap = 1024; }
  _grow() { const c = this.cap * 2; const t = new Int32Array(c); t.set(this.ti); const d = new Float64Array(c); d.set(this.d); this.ti = t; this.d = d; this.cap = c; }
  push(ti, d) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; const tt = this.ti[p], td = this.d[p]; this.ti[p] = this.ti[i]; this.d[p] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = p; } }
  popMin() { const ti = this.ti[0], d = this.d[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; const tt = this.ti[b], td = this.d[b]; this.ti[b] = this.ti[i]; this.d[b] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = b; } } return { ti, d }; }
}

// Nearest open-water tile to a settlement's home, within EMBARK_RADIUS.
// -1 if landlocked. Position and terrain are fixed, so this is cached.
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

// Walk prev[] from endTi back to its owner's embark seed, returning the
// tiles in start→end order.
function reconstruct(prev, endTi) {
  const tiles = [];
  let cur = endTi, guard = 0;
  while (cur >= 0 && guard++ < 300000) { tiles.push(cur); cur = prev[cur]; }
  tiles.reverse();
  return tiles;
}

// ── Periodic: rebuild the port sea-lane network + attempt colonies ─────
export function updateSea(world) {
  const { N, tw, th, elev } = world;
  const homeTi = s => (s.pos.y | 0) * tw + (s.pos.x | 0);

  // Identify ports, clear last pass's sea reach, index embark tiles.
  const ports = [];
  const portByEmbark = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    if (s._embarkTile === undefined) s._embarkTile = findEmbarkTile(world, s);
    s._seaReach = null;
    s._isPort = s._embarkTile >= 0;
    if (s._isPort && !portByEmbark.has(s._embarkTile)) { ports.push(s); portByEmbark.set(s._embarkTile, s); }
  }
  world._seaLanes = [];
  if (ports.length < 1) return;

  // Per-port sea budget (range). A port that can't sail (no navigation, or
  // too small) still seeds the flood as a DESTINATION (budget 0: it owns
  // only its embark tile and projects nothing), so advanced fleets can
  // still reach and trade with it.
  const budget = new Map();
  for (const p of ports) {
    const nav = p.knowledge.navigation || 0;
    const canSail = nav >= MIN_NAV_FOR_SEA && (p.people || 0) >= T.SEA_MIN_POP;
    // Sea-lane reach now scales with the naval techs (Galleys → Caravels → Ocean
    // Sailing → Steamship), not raw navigation (tech.js seaRange channel).
    budget.set(p.id, canSail ? SEA_RANGE_BASE + techEff(p).seaRange * T.SEA_RANGE_NAV : 0);
  }

  // Colony-eligible ports (we only collect shore candidates for these, to
  // keep the flood cheap).
  const eligible = new Set();
  const shoreCand = new Map();   // portId -> [{landTi, waterTi, d, f}]
  for (const p of ports) {
    // An expansionist realm mounts colonial expeditions more often (shorter
    // effective cooldown); an insular one rarely bothers (personality.js
    // expansionColonyMul). Pop / navigation still gate eligibility — this
    // only paces how often an already-capable port reaches out.
    const pc = world.countries && world.countries.get(p.countryId);
    const colonyMul = (pc && pc.personality) ? expansionColonyMul(pc.personality) : 1;
    const cooldown = COLONY_COOLDOWN / colonyMul;
    p._questGoal = null;
    if ((p.knowledge.navigation || 0) < COLONY_MIN_NAV ||
        world.step - (p._lastColony ?? -Infinity) < cooldown) continue;
    const pop = p.people || 0;
    // A spice quest lets a mid-size port (≥ COLONY_QUEST_MIN_POP, below the full
    // colony bar) found a trading OUTPOST to extend a luxury-route chain — so the
    // chain marches outward without each link first growing into a city.
    const qgoal = (T.SEA_LUX_QUEST > 0 && pop >= T.COLONY_QUEST_MIN_POP) ? luxuryGoal(world, p) : null;
    p._questGoal = qgoal;
    if (pop >= T.COLONY_MIN_POP || qgoal) {
      eligible.add(p.id);
      shoreCand.set(p.id, []);
    }
  }

  // Cached flood scratch arrays (reset each pass; owner persists nothing).
  let owner = world._seaOwner, dist = world._seaDist, prev = world._seaPrev;
  if (!owner || owner.length !== N) {
    owner = world._seaOwner = new Int32Array(N);
    dist  = world._seaDist  = new Float64Array(N);
    prev  = world._seaPrev  = new Int32Array(N);
  }
  owner.fill(-1); dist.fill(Infinity); prev.fill(-1);

  // ── Single multi-source flood over the ocean ──
  const heap = new MinHeap();
  for (const p of ports) {
    const e = p._embarkTile;
    if (e < 0 || elev[e] > 0) continue;
    if (dist[e] > 0) { dist[e] = 0; owner[e] = p.id; prev[e] = -1; heap.push(e, 0); }
  }
  let visited = 0;
  while (heap.n > 0 && visited < MAX_SEA_VISITS) {
    const { ti, d } = heap.popMin();
    if (d > dist[ti]) continue;
    visited++;
    const oid = owner[ti];
    const bud = budget.get(oid) || 0;
    const collectShore = eligible.has(oid);
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
      if (ni < 0) continue;
      if (elev[ni] > 0) {
        // Land neighbour — a potential colony shore for this port (cardinal
        // only, to keep landings on a real coastline).
        if (collectShore && k < 4) {
          const arr = shoreCand.get(oid);
          if (arr.length < COLONY_PER_PORT_CAND && isContinentalLand(world, ni)) {
            arr.push({ landTi: ni, waterTi: ti, d, f: world.fert[ni] || 0 });
          }
        }
        continue;
      }
      const no = owner[ni];
      if (no >= 0 && no !== oid) continue;       // another port's water (boundary handled below)
      const nd = d + SEA_STEP * mul[k] * windMul(world, ni, DX[k], DY[k]);
      if (nd > bud) continue;                    // beyond this port's range
      if (nd < dist[ni]) { dist[ni] = nd; owner[ni] = oid; prev[ni] = ti; heap.push(ni, nd); }
    }
  }

  // Direct sea links from where two ports' waters meet, using the FINAL
  // distances (computing the cost mid-flood, before a tile is settled,
  // picked off-axis meeting points and produced the V-shaped detours).
  // Checking right / down / both diagonals counts each adjacency once.
  const edges = new Map();   // "lo:hi" -> { cost, tiA, tiB }  (tiA owned lo, tiB owned hi)
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti];
    if (oid < 0) continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xp = tx === tw - 1 ? 0 : tx + 1, xm = tx === 0 ? tw - 1 : tx - 1;
    const cand = [
      [ty * tw + xp, 1],                          // right
      ty < th - 1 ? [ti + tw, 1] : null,          // down
      ty < th - 1 ? [(ty + 1) * tw + xp, SQRT2] : null,   // down-right
      ty < th - 1 ? [(ty + 1) * tw + xm, SQRT2] : null,   // down-left
    ];
    for (const c of cand) {
      if (!c) continue;
      const nj = c[0], no = owner[nj];
      if (no < 0 || no === oid) continue;
      const cost = dist[ti] + SEA_STEP * c[1] + dist[nj];
      const lo = oid < no ? oid : no, hi = oid < no ? no : oid;
      const tiLo = oid < no ? ti : nj, tiHi = oid < no ? nj : ti;
      const key = lo + ":" + hi;
      const ex = edges.get(key);
      if (!ex || cost < ex.cost) edges.set(key, { cost, tiA: tiLo, tiB: tiHi });
    }
  }

  // ── Build the port adjacency graph (both directions, with tile paths) ──
  const adj = new Map();   // portId -> [{ to, cost, tiles }]
  const addAdj = (a, b, cost, tiles) => {
    let la = adj.get(a); if (!la) { la = []; adj.set(a, la); } la.push({ to: b, cost, tiles });
  };
  const lanes = [];
  for (const [key, e] of edges) {
    const ci = key.indexOf(":");
    const lo = +key.slice(0, ci), hi = +key.slice(ci + 1);
    const A = world._byId ? world._byId.get(lo) : null;
    const B = world._byId ? world._byId.get(hi) : null;
    if (!A || !B) continue;
    // A DIRECT lane is a SINGLE voyage — one port must be able to sail the WHOLE
    // way (trade was never done mid-ocean). The flood lets two ports' waters MEET
    // at their combined range, but a lane only stands if ONE of them could cross
    // the whole gap: cost ≤ max(rangeA, rangeB). Longer hauls aren't direct — they
    // RELAY through a chain of ports (the transitive closure below), each leg a
    // real voyage. This is the stepping-stone structure (Lisbon→Cape→Goa→Indies).
    if (e.cost > Math.max(budget.get(lo) || 0, budget.get(hi) || 0)) continue;
    // Path lo → hi: lo.home, lo.embark…tiA, tiB…hi.embark, hi.home.
    const aSide = reconstruct(prev, e.tiA);            // lo.embark → tiA
    const bSide = reconstruct(prev, e.tiB);            // hi.embark → tiB
    bSide.reverse();                                   // tiB → hi.embark
    const tiles = [homeTi(A), ...aSide, ...bSide, homeTi(B)];
    addAdj(lo, hi, e.cost, tiles);
    addAdj(hi, lo, e.cost, tiles.slice().reverse());
    lanes.push({ tiles, cost: e.cost });
  }
  world._seaLanes = lanes;

  // ── Transitive closure: each sailing port reaches every port the lane
  // network connects it to (cost = shortest chain). Tiles are kept for the
  // 1-hop (direct) links so the overlay can animate them; multi-hop links
  // carry cost only (the static lane network shows the channels). ──
  for (const src of ports) {
    if ((budget.get(src.id) || 0) <= 0) continue;       // non-sailing: leaf only
    const pd = new Map();   // portId -> cost
    const ph = new MinHeap();
    pd.set(src.id, 0); ph.push(src.id, 0);
    // Map portId -> direct edge tiles from src (1-hop), if any.
    const directTiles = new Map();
    const srcAdj = adj.get(src.id);
    if (srcAdj) for (const e of srcAdj) if (!directTiles.has(e.to)) directTiles.set(e.to, e.tiles);
    while (ph.n > 0) {
      const { ti: pid, d } = ph.popMin();
      if (d > (pd.get(pid) ?? Infinity)) continue;
      const la = adj.get(pid);
      if (!la) continue;
      for (const e of la) {
        const nd = d + e.cost;
        if (nd < (pd.get(e.to) ?? Infinity)) { pd.set(e.to, nd); ph.push(e.to, nd); }
      }
    }
    // Keep the partners this port derives the MOST VALUE from — gravity (the
    // partner's economic size) plus the LUXURY it can source there, discounted by
    // freight — not merely the nearest. A distant metropolis or a scarce-spice
    // island can now outrank a near hamlet, so long high-value routes form.
    const reached = [];
    for (const [pid, cost] of pd) {
      if (pid === src.id) continue;
      const peer = world._byId ? world._byId.get(pid) : null;
      if (!peer) continue;
      const gravity = Math.sqrt(Math.max(1, peer.people || 0));
      const value = (gravity + T.SEA_LUX_PULL * (peer._luxSupply || 0)) / (1 + cost * SEA_FREIGHT_K);
      reached.push([pid, cost, value]);
    }
    reached.sort((a, b) => b[2] - a[2]);   // most valuable first
    const keep = reached.length > T.SEA_MAX_PEERS ? T.SEA_MAX_PEERS : reached.length;
    for (let i = 0; i < keep; i++) {
      const pid = reached[i][0], cost = reached[i][1];
      const peer = world._byId ? world._byId.get(pid) : null;
      if (!peer) continue;
      linkSea(src, peer, cost, directTiles.get(pid) || null);
    }
  }

  // ── Colonisation: each eligible port founds at its best clear shore ──
  for (const pid of eligible) {
    const A = world._byId ? world._byId.get(pid) : null;
    if (!A) continue;
    tryColonize(world, A, shoreCand.get(pid), prev);
  }
}

// Record a bidirectional sea trade link, keeping the cheaper cost. tiles
// (when present) run src→peer; the peer stores the reverse so the lower-id
// endpoint — the one the trade pass iterates — has them oriented toward
// the peer.
function linkSea(src, peer, cost, tiles) {
  if (!src._seaReach) src._seaReach = new Map();
  if (!peer._seaReach) peer._seaReach = new Map();
  const exA = src._seaReach.get(peer.id);
  if (!exA || cost < exA.cost) src._seaReach.set(peer.id, { cost, tiles, sea: true });
  const rev = tiles ? tiles.slice().reverse() : null;
  const exB = peer._seaReach.get(src.id);
  if (!exB || cost < exB.cost) peer._seaReach.set(src.id, { cost, tiles: rev, sea: true });
}

// Pick the best unsettled shore in port A's reachable waters and launch a
// colony ship toward it. Colonists + a coin endowment migrate out of A.
// ── Directed colonisation: the spice quest ──────────────────────────────
// A wealthy port that craves luxury it can neither produce nor yet reach by sea
// seeks the nearest KNOWN luxury source it cannot reach, and founds its next
// outpost as far TOWARD that prize as it can — the stepping-stone push that built
// the trade empires (Lisbon → the African forts → the Cape → Goa → the Indies).
// Each outpost repeats from its new shore, so the chain marches to the source and
// the resupply-relay route opens. Returns the target settlement, or null.
const SEA_LUX_RES     = ["spices", "furs", "incense", "dyes"];
const LUX_QUEST_MIN   = 1;     // minimum spare luxury demand to mount a quest
const LUX_SOURCE_MIN  = 0.20;  // a settlement on this much luxury RESOURCE is a "known source"
const OUTPOST_FERT_MIN = 0.02; // a quest outpost needs only a toehold — it lives on trade + the mother's supply, not soil
function luxResOf(s) { const lr = s.localRes || {}; let v = 0; for (const id of SEA_LUX_RES) v += lr[id] || 0; return v; }
function luxuryGoal(world, A) {
  if ((A._luxDemand || 0) < LUX_QUEST_MIN || luxResOf(A) >= LUX_SOURCE_MIN) return null;   // not seeking, or makes its own
  const byId = world._byId;
  // SATED only if the luxury SUPPLY it can already reach by sea MEETS its demand —
  // reaching one minor source doesn't sate a hungry market (Europe reached the
  // Levant yet still craved the Indies). So the questers are the wealthy ports FAR
  // from luxury — the Atlantic powers — exactly who drove the spice trade.
  let reachSupply = 0;
  if (A._seaReach && byId) for (const pid of A._seaReach.keys()) {
    const p = byId.get(typeof pid === "number" ? pid : +pid);
    if (p) reachSupply += p._luxSupply || 0;
  }
  if (reachSupply >= (A._luxDemand || 0)) return null;   // demand met by reachable sources — no quest
  const tw = world.tw, ax = A.pos.x, ay = A.pos.y;
  let goal = null, best = Infinity;
  for (const p of world.settlements) {
    if (p.mode !== "settled" || luxResOf(p) < LUX_SOURCE_MIN) continue;
    if (A._seaReach && A._seaReach.has(p.id)) continue;    // already reachable
    let dx = Math.abs(p.pos.x - ax); if (dx > tw / 2) dx = tw - dx; const dy = p.pos.y - ay;
    const d = dx * dx + dy * dy;
    if (d < best) { best = d; goal = p; }
  }
  return goal;
}

function tryColonize(world, A, cands, prev) {
  if (!cands || cands.length === 0) return;
  const { tw } = world;
  // DIRECTED toward a distant luxury source (the spice quest, cached in the
  // eligibility pass) if the port craves one; otherwise opportunistic — best shore.
  const goal = A._questGoal || null;
  let chosen = null;
  if (goal) {
    const gx = goal.pos.x, gy = goal.pos.y;
    const gd = (c) => { const cy = (c.landTi / tw) | 0, cx = c.landTi - cy * tw; let dx = Math.abs(cx - gx); if (dx > tw / 2) dx = tw - dx; const dy = cy - gy; return dx * dx + dy * dy; };
    cands.sort((p, q) => gd(p) - gd(q));   // the reachable shore NEAREST the prize → march toward it
    for (const c of cands) { if (c.f < OUTPOST_FERT_MIN) continue; if (siteIsClear(world, c.landTi)) { chosen = c; break; } }
  } else {
    cands.sort((p, q) => q.f - p.f);       // best fertile shore first
    for (const c of cands) { if (c.f < 0.05) break; if (siteIsClear(world, c.landTi)) { chosen = c; break; } }
  }
  if (!chosen) return;

  const water = reconstruct(prev, chosen.waterTi);     // A.embark → landing water
  const homeA = (A.pos.y | 0) * tw + (A.pos.x | 0);
  let full = [homeA, ...water, chosen.landTi];
  if (full.length > MAX_ROUTE_TILES) full = full.slice(0, MAX_ROUTE_TILES);
  const endow = Math.min((A.wealth || 0) * COLONY_ENDOW_FRAC, COLONY_ENDOW_CAP);
  A.people -= COLONY_PEOPLE;
  A.wealth = (A.wealth || 0) - endow;
  recordOut(A, OUT_COLONY, endow);
  A._lastColony = world.step;

  if (!world.ships) world.ships = [];
  world.ships.push({
    id: (world._nextShipId = (world._nextShipId || 0) + 1), kind: "colony",
    owner: A.id, countryId: A.countryId, cultureId: dominantCulture(A),
    knowledge: { ...A.knowledge },
    people: COLONY_PEOPLE, wealth: endow,
    landTi: chosen.landTi,
    path: full.map(ti => ({ x: (ti % tw) + 0.5, y: ((ti / tw) | 0) + 0.5 })),
    idx: 0, speed: T.SHIP_SPEED * (1 + techEff(A).seaSpeed),
    x: A.pos.x, y: A.pos.y,
  });
  A._coloniesSent = (A._coloniesSent || 0) + 1;
  logEvent(world, "colony.departed", { s: A.id, sName: A.name, polity: A.countryId });
}

// A landing tile is clear if no settlement sits within COLONY_MIN_DIST. The
// spatial grid returns exactly those (vs an O(settlements) scan per candidate).
// The grid is rebuilt at step start, so a colony founded earlier THIS step
// (makeSettlement, not gridAdd) isn't in it yet — but foundColony re-checks at
// landing time, so the spacing is still enforced at the outcome.
function siteIsClear(world, lti) {
  const { tw } = world;
  const ty = (lti / tw) | 0, tx = lti - ty * tw;
  let clear = true;
  forEachNear(world, tx, ty, COLONY_MIN_DIST, () => { clear = false; });
  return clear;
}

// ── Per tick: advance every colony ship; found its colony on arrival ──
export function moveShips(world) {
  const ships = world.ships;
  if (!ships || ships.length === 0) return;
  const { tw, th } = world;
  const live = [];
  const _dt = world._dt || 1;   // granularity: a voyage covers the same history-span at any SIM_GRANULARITY
  for (const sh of ships) {
    sh.idx += sh.speed * _dt;
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
  // A settlement may have appeared on the target during the voyage. Rather than
  // delete the expedition (which would silently destroy its colonists AND their
  // coin endowment — both were already debited from the founder at launch, so
  // dropping them leaks population and breaks the closed money supply), the
  // fleet TURNS BACK: its people and treasury return to the founder if it still
  // stands. (If the founder is gone, the loss is unavoidable but rare.)
  if (!siteIsClear(world, sh.landTi)) {
    const home = world._byId && world._byId.get(sh.owner);
    if (home && home.mode === "settled") {
      home.people = (home.people || 0) + (sh.people || 0);
      home.wealth = (home.wealth || 0) + (sh.wealth || 0);
    }
    return;
  }
  const colony = makeSettlement(world, lx + 0.5, ly + 0.5, {
    people: sh.people,
    knowledge: { ...sh.knowledge },
    parentId: sh.owner,
    kind: "colony",
    cultureId: sh.cultureId ?? -1,
  });
  colony.countryId = sh.countryId;        // colonial allegiance to the founder's realm
  colony.wealth = sh.wealth || 0;
  colony._isColony = true;
}
