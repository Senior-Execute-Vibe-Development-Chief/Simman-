// ── Military: garrisons + tile-by-tile territorial conquest ──────────
//
// Each settlement raises a GARRISON (s.army) — soldiers levied from its
// population and paid from its wealth (musterArmies). Military MIGHT is the
// garrison scaled by metallurgy / mobility tech.
//
// Conquest is TERRITORIAL and granular (advanceFronts): a settlement that
// out-powers a bordering enemy pushes the front from its OWN land into the
// enemy's, flipping the frontier tiles it can overrun one pass at a time.
// A city's CORE (territory.js cores) is re-asserted every territory pass,
// so the front eats a victim's countryside but stalls at its well-defended
// heartland — until the attacker, having pushed right up to the core with
// overwhelming strength, STORMS the town: the settlement is annexed into
// the attacker's country and all of its land flies the conqueror's colours.
// Fighting drains both garrisons (attrition), so over-extended offensives
// stall and the front ebbs and flows.

import { coreRadiusFor } from "./territory.js";
import { recordOut, OUT_MILITARY } from "./money.js";
import { findPath } from "./roads.js";

// Army size is gated by TIER and FOOD, not coin. A garrison is a slice of
// population (capped by tier — villages keep a token watch, cities/capitals
// field real armies). The garrison also EATS (provisioning, in updateFood),
// so a settlement that can't cover that food drains its granary and the army
// DESERTS — you can't field more troops than you can feed. Coin upkeep is now
// a small secondary cost (pay/equipment), not the binding constraint.
const ARMY_TIER_FRAC = [0.02, 0.05, 0.09, 0.11];  // garrison cap as fraction of pop, by tier
const ARMY_CAPITAL_BONUS = 0.03;                  // the capital fields a bit more
const ARMY_GROW     = 0.05;   // growth toward the cap per muster
const ARMY_DESERT   = 0.80;   // when food-starved, the garrison melts to this each muster
const UPKEEP_PER    = 0.12;   // wealth per soldier per muster (small; food is the real cost)
export const MUSTER_INTERVAL   = 100;
export const CONQUEST_INTERVAL = 50;
// A freshly stormed settlement is PACIFIED for this long: it can't be
// re-stormed and it won't secede (conquest.js reads this), so a garrisoned
// new province is firmly held for an age instead of flip-flopping between
// rival empires every pass. The single biggest stabiliser of the political
// map — without it contested frontier cities ping-pong endlessly.
export const CONQUEST_GRACE = 800;

const ATTACK_MIN_RATIO  = 1.12;        // must out-power a neighbour by this to push
const CAPTURE_SCALE     = 5;           // tiles/pass per unit of power-ratio advantage
const MAX_CAPTURE       = 24;          // hard cap on tiles flipped per front per pass
const CITY_STORM_RATIO  = 1.6;         // power ratio needed to besiege the core
const ASSAULT_MARGIN    = 2;           // front must reach within (defender core + this) of the home
const ATTRITION         = 0.035;       // army drained per warring front per pass
const ASSAULT_ARMY_COST = 0.4;         // share of the victor's garrison spent taking a city
// Siege: once the front reaches the heartland the city does NOT fall at
// once. The besiegers grind the garrison down over several passes (SIEGE_DMG
// of the attacker's might per pass); the city is only stormed once its
// defence breaks (drops below SIEGE_BREAK of the attacker's might). So a
// well-garrisoned city visibly holds out under a shrinking front, while an
// undefended one falls quickly.
const SIEGE_DMG         = 0.06;
const SIEGE_BREAK       = 0.15;

function techMul(s) {
  const k = s.knowledge || {};
  return 1 + (k.metallurgy || 0) * 1.5 + (k.mobility || 0) * 0.8;
}
function might(s) { return (s.army || 0) * techMul(s); }

// ── Marching reinforcements ──
// When a settlement is besieged, its realm-mates detach part of their garrison
// and MARCH it to the front along roads (slow over wilderness, fast on roads),
// arriving after a real transit delay. So a small frontier town gets overrun
// before help comes, while a connected capital can relieve a siege — and the
// senders are weakened while their troops are away. Modelled as moving units
// (world.armies), same as colony ships.
const MARCH_SPEED        = 0.6;   // base path-tiles advanced per tick
const ROAD_MARCH_MULT    = 2.5;   // marching along a road is this much faster
const REINFORCE_SEND_FRAC = 0.4;  // fraction of a sender's garrison dispatched
const REINFORCE_COOLDOWN  = 200;  // ticks before a settlement sends again
const REINFORCE_MAX_SENDERS = 5;  // nearest realm-mates that respond to one siege
const REINFORCE_MIN_ARMY  = 3;    // a sender needs at least this many troops to bother
const MAX_MARCHES         = 240;  // global cap on in-flight columns (perf)

function distTiles(world, ax, ay, bx, by) {
  let dx = Math.abs(ax - bx); if (dx > world.tw / 2) dx = world.tw - dx;
  const dy = ay - by; return Math.sqrt(dx * dx + dy * dy);
}

// Each besieged settlement calls its nearest realm-mates to march troops in.
function dispatchReinforcements(world, besieged) {
  if (!world.armies) world.armies = [];
  if (world.armies.length >= MAX_MARCHES) return;
  const tw = world.tw;
  for (const def of besieged) {
    const senders = [];
    for (const m of world.settlements) {
      if (m.mode !== "settled" || m.id === def.id) continue;
      if (m.countryId !== def.countryId) continue;
      if ((m.army || 0) < REINFORCE_MIN_ARMY) continue;
      if (world.step - (m._lastReinforce ?? -Infinity) < REINFORCE_COOLDOWN) continue;
      senders.push({ m, d: distTiles(world, m.pos.x, m.pos.y, def.pos.x, def.pos.y) });
    }
    senders.sort((a, b) => a.d - b.d);
    let sent = 0;
    for (const { m } of senders) {
      if (sent >= REINFORCE_MAX_SENDERS || world.armies.length >= MAX_MARCHES) break;
      const path = findPath(world, m, def);          // road-aware route (none → can't relieve)
      if (!path || path.tiles.length < 2) continue;
      const troops = (m.army || 0) * REINFORCE_SEND_FRAC;
      if (troops < 1) continue;
      m.army -= troops;                               // committed: gone from home until they arrive
      m._lastReinforce = world.step;
      world.armies.push({
        owner: m.id, countryId: m.countryId, troops, targetId: def.id,
        path: path.tiles.map(ti => ({ x: (ti % tw) + 0.5, y: ((ti / tw) | 0) + 0.5 })),
        idx: 0, x: m.pos.x, y: m.pos.y,
      });
      sent++;
    }
  }
}

// ── Per tick: advance every marching column; merge into the garrison on arrival ──
export function moveArmies(world) {
  const arr = world.armies;
  if (!arr || arr.length === 0) return;
  const { tw, th, roadQuality: rq } = world;
  const live = [];
  for (const m of arr) {
    const path = m.path;
    const ti = (Math.max(0, Math.min(th - 1, m.y | 0))) * tw + (((m.x | 0) % tw + tw) % tw);
    const onRoad = rq && rq[ti] < 1.0;
    m.idx += MARCH_SPEED * (onRoad ? ROAD_MARCH_MULT : 1);
    if (!path || path.length < 2 || m.idx >= path.length - 1) {
      // Arrived: the column joins its target's garrison (if it still stands
      // and is still friendly). Otherwise the relief force is lost.
      const def = world._byId ? world._byId.get(m.targetId) : null;
      if (def && def.mode === "settled" && def.countryId === m.countryId) def.army = (def.army || 0) + m.troops;
      continue;
    }
    const i0 = m.idx | 0, i1 = Math.min(path.length - 1, i0 + 1), fr = m.idx - i0;
    const p0 = path[i0], p1 = path[i1];
    let dxp = p1.x - p0.x; if (dxp > tw / 2) dxp -= tw; else if (dxp < -tw / 2) dxp += tw;
    m.x = ((p0.x + dxp * fr) % tw + tw) % tw;
    m.y = Math.max(0, Math.min(th - 1, p0.y + (p1.y - p0.y) * fr));
    live.push(m);
  }
  world.armies = live;
}

function armyCapFrac(world, s) {
  let f = ARMY_TIER_FRAC[s.tier | 0] ?? ARMY_TIER_FRAC[0];
  const c = world.countries && world.countries.get(s.countryId);
  if (c && c.capitalId === s.id) f += ARMY_CAPITAL_BONUS;   // the capital fields a bit more
  return f;
}

// ── Periodic: grow + provision garrisons ──
export function musterArmies(world) {
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    // Can the settlement actually FEED its garrison? The signal is an
    // UNCOVERED food deficit — local production + grain imports falling short
    // of total demand (which includes the garrison's provisioning). Low STORED
    // food isn't enough (import-fed towns always run their granary near empty);
    // only a real shortfall starves the army into desertion. Fed settlements
    // grow their garrison to the tier/political cap. This is the soft "can't
    // field more than you can feed" limit.
    const fed = (s._foodSupply || 0) + (s._foodImportRate || 0);
    if (fed < (s._foodDemand || 0) * 0.98) {
      s.army = (s.army || 0) * ARMY_DESERT;
    } else {
      const popCap = s.people * armyCapFrac(world, s);   // tier/political limit
      s.army = (s.army || 0) + (popCap - (s.army || 0)) * ARMY_GROW;
    }
    if (s.army < 0) s.army = 0;
    // Small coin upkeep (pay/equipment) — a minor sink, no longer the gate.
    const cost = s.army * UPKEEP_PER;
    if ((s.wealth || 0) >= cost) { s.wealth -= cost; recordOut(s, OUT_MILITARY, cost); }
    else { recordOut(s, OUT_MILITARY, s.wealth || 0); s.wealth = 0; }   // can't fully pay: army stays (food-fed), treasury drained
  }
}

// ── Periodic: advance every active war front by tile capture / storm ──
export function advanceFronts(world) {
  const owner = world._territoryOwner;
  const byId = world._byId;
  if (!owner || !byId) return;
  const { N, tw, th } = world;

  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    s._M = might(s);
    s._homeTi = (s.pos.y | 0) * tw + (s.pos.x | 0);
  }

  // One scan of the territory map. For each owned tile, find the strongest
  // ENEMY settlement (different country) adjacent to it that out-powers the
  // owner — that enemy can capture this tile. Group candidates by
  // attacker→defender front; flag fronts that have reached the city core.
  const pairs = new Map();   // "att:def" -> { att, def, tiles:[{ti,distHome}], canStorm }
  for (let ti = 0; ti < N; ti++) {
    const d = owner[ti];
    if (d < 0) continue;
    const D = byId.get(d);
    if (!D || D.mode !== "settled") continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    let bestA = -1, bestM = -1;
    for (let k = 0; k < 4; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      const a = owner[ni]; if (a < 0 || a === d) continue;
      const A = byId.get(a);
      if (!A || A.mode !== "settled" || A.countryId === D.countryId) continue;
      if (A._M > bestM) { bestM = A._M; bestA = a; }
    }
    if (bestA < 0) continue;
    const A = byId.get(bestA);
    if (A._M < D._M * ATTACK_MIN_RATIO) continue;        // not strong enough here
    // Distance of this tile from the defender's home (longitude wraps).
    const dh = D._homeTi, dhy = (dh / tw) | 0, dhx = dh - dhy * tw;
    let ddx = Math.abs(tx - dhx); if (ddx > tw / 2) ddx = tw - ddx;
    const ddy = ty - dhy;
    const distHome = Math.sqrt(ddx * ddx + ddy * ddy);
    const assaultDist = coreRadiusFor(D) + ASSAULT_MARGIN;   // scales with the city's size
    const key = bestA + ":" + d;
    let pc = pairs.get(key);
    if (!pc) { pc = { att: A, def: D, tiles: [], canStorm: false }; pairs.set(key, pc); }
    if (distHome <= assaultDist) pc.canStorm = true;         // front at the heartland
    else pc.tiles.push({ ti, distHome });                    // capturable countryside
  }

  // Realm-mates march to relieve every settlement under attack (over transit
  // time — see dispatchReinforcements / moveArmies).
  const besieged = new Set();
  for (const pc of pairs.values()) besieged.add(pc.def);
  if (besieged.size) dispatchReinforcements(world, besieged);

  // Resolve each front: besiege the city if the front reached its
  // heartland; otherwise grind the countryside forward, tile by tile.
  for (const pc of pairs.values()) {
    const { att, def } = pc;
    if (att.mode !== "settled" || def.mode !== "settled" || att.countryId === def.countryId) continue;
    const adv = att._M / Math.max(1, def._M);

    if (pc.canStorm) {
      // Front is at the heartland. A recently-conquered city is still
      // pacified (garrisoned) and can't be besieged yet — that grace stops
      // rival empires trading it back and forth.
      if (adv >= CITY_STORM_RATIO && world.step - (def._conqueredAt ?? -Infinity) >= CONQUEST_GRACE) {
        // Bombard: grind the garrison; the besiegers bleed a little too.
        def.army = Math.max(0, (def.army || 0) - att._M * SIEGE_DMG);
        att.army = Math.max(0, (att.army || 0) - def._M * ATTRITION / techMul(att));
        const defNow = def.army * techMul(def);
        if (defNow <= att._M * SIEGE_BREAK) {
          // Defence broken — the city falls and its whole realm flips.
          def.countryId = att.countryId;
          def._conqueredAt = world.step;
          def.loyalty = 0.35;   // a fresh conquest starts restless (conquest.js)
          if (def.history) def.history.push({ step: world.step, type: "conquered", by: att.id });
          att.army = Math.max(0, (att.army || 0) * (1 - ASSAULT_ARMY_COST));
          def.army = Math.max(0, (def.army || 0) * 0.3);
        }
      }
      continue;   // front's at the core — no countryside left to nibble here
    }

    const budget = Math.min(MAX_CAPTURE, Math.floor((adv - 1) * CAPTURE_SCALE));
    if (budget >= 1 && pc.tiles.length) {
      // Advance the front BROADLY: take the outermost contested tiles first
      // so the defender's countryside erodes ring by ring (visible) instead
      // of a thin salient spiking straight to the capital.
      pc.tiles.sort((p, q) => q.distHome - p.distHome);
      const n = Math.min(budget, pc.tiles.length);
      for (let i = 0; i < n; i++) owner[pc.tiles[i].ti] = att.id;
    }
    att.army = Math.max(0, (att.army || 0) - def._M * ATTRITION / techMul(att));
    def.army = Math.max(0, (def.army || 0) - att._M * ATTRITION / techMul(def));
  }
}
