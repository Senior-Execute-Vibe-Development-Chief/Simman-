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
import { findPath } from "./roads.js";
import { localEdgeCost } from "./transport.js";
import { fragmentRealm } from "./conquest.js";

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
const BANKRUPT_DESERT = 0.70; // when wholly unpaid (insolvent state), the garrison melts to this each muster
const WAR_SPOILS    = 0.6;    // war-weariness relief a realm banks each time it storms a city (conquest.js)
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
      // Snapshot the dispatching settlement's tech so the column moves at
      // the speed its TRAINING earned (the troops carry their doctrine with
      // them, not the home town's). Keeping the raw tile indices on the path
      // lets moveArmies look up terrain cost per step.
      const k = m.knowledge || {};
      world.armies.push({
        owner: m.id, countryId: m.countryId, troops, targetId: def.id,
        path: path.tiles.map(ti => ({ x: (ti % tw) + 0.5, y: ((ti / tw) | 0) + 0.5 })),
        pathTiles: path.tiles,
        knowledge: { construction: k.construction||0,
                     organization: k.organization||0, mobility: k.mobility||0,
                     navigation: k.navigation||0 },
        idx: 0, x: m.pos.x, y: m.pos.y,
      });
      sent++;
    }
  }
}

// ── Per tick: advance every marching column; merge into the garrison on arrival ──
// March speed reads the per-tile terrain cost via localEdgeCost (transport.js)
// modulated by the column's own knowledge snapshot — so a Mongol cavalry horde
// gallops across plains while a stone-age levy plods through mountains. Roads
// dominate (cost ≈ 0.08-0.25, so ~4-12× the base speed). The same edge-cost
// function the trade pathfinder uses, applied symmetrically to military movement.
export function moveArmies(world) {
  const arr = world.armies;
  if (!arr || arr.length === 0) return;
  const { tw, th } = world;
  const live = [];
  for (const m of arr) {
    const path = m.path, pathTiles = m.pathTiles;
    if (!path || path.length < 2 || m.idx >= path.length - 1) {
      // Arrived: the column joins its target's garrison (if it still stands
      // and is still friendly). Otherwise the relief force is lost.
      const def = world._byId ? world._byId.get(m.targetId) : null;
      if (def && def.mode === "settled" && def.countryId === m.countryId) def.army = (def.army || 0) + m.troops;
      continue;
    }
    // Per-step movement cost: integer tile we're about to leave → next tile.
    // Higher cost = slower step (m.idx advances less).
    const i0 = m.idx | 0, i1 = Math.min(path.length - 1, i0 + 1);
    let stepMul = 1;
    if (pathTiles && pathTiles.length === path.length) {
      const c = localEdgeCost(world, pathTiles[i0], pathTiles[i1], m.knowledge);
      // Speed scales as 1/√c so the spread stays moderate:
      //   road (c≈0.10) → ~3.2× speed
      //   plain, base tech (c≈1.0) → 1.0× speed
      //   plain, max tech (c≈0.25) → 2.0× speed
      //   hills (c≈3) → 0.58× speed
      //   high mountain (c≈10) → 0.32× speed
      // Bounded above so a perfect worn road doesn't blow past sane limits.
      stepMul = isFinite(c) ? Math.min(4, 1 / Math.sqrt(Math.max(0.05, c))) : 0.5;
    } else {
      // Backwards-compatibility: legacy columns without pathTiles fall back
      // to a flat road check (the pre-terrain behaviour).
      const ti = (Math.max(0, Math.min(th - 1, m.y | 0))) * tw + (((m.x | 0) % tw + tw) % tw);
      const onRoad = world.roadQuality && world.roadQuality[ti] < 1.0;
      stepMul = onRoad ? ROAD_MARCH_MULT : 1;
    }
    m.idx += MARCH_SPEED * stepMul;
    const fr = m.idx - i0;
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
    // Unpaid troops desert. The army is funded by the state treasury
    // (conquest.js); when the treasury can't cover the wage bill the realm is
    // insolvent (gov._solvency < 1) and its garrisons melt away in proportion
    // to the shortfall — the fiscal-military collapse trigger. (City-states
    // have no treasury and field food-fed militias, so they never go bankrupt.)
    const gov = world.governments && world.governments.get(s.countryId);
    const solvency = gov && gov._solvency != null ? gov._solvency : 1;
    if (solvency < 0.999) s.army *= BANKRUPT_DESERT + (1 - BANKRUPT_DESERT) * solvency;
    if (s.army < 0) s.army = 0;
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

  // Trade-dampened encroachment: a frontier with active cross-border trade
  // sees less opportunistic encroachment (it's bad business to grab tiles
  // from a profitable peer). Build a country-pair → recent inter-country
  // trade magnitude index from world._linkMoney; tile-capture rate is
  // multiplied by 1/(1 + tradeFactor) so peaceful trading neighbours hold
  // stable borders even with mild power asymmetries.
  // Softened (was ×2 max bar increase) now that the SACK PRODUCTION PENALTY
  // (settlement.js sackPenalty) provides the structural reason — conquering
  // a trade partner DESTROYS the trade asset, so the calculus naturally
  // discourages it. The dampener is now just the secondary "political
  // friction" effect (merchant lobby, international norms) and tops out at
  // +50% required advantage instead of +100%.
  const TRADE_PEACE_REF = 8;   // total cross-border money/tick at which the dampener saturates
  const TRADE_PEACE_MAX = 0.5; // max multiplier on ATTACK_MIN_RATIO from trade peace
  const tradePair = new Map();   // "ccA:ccB" (sorted) → magnitude
  const lm = world._linkMoney;
  if (lm) {
    for (const [key, net] of lm) {
      const colon = key.indexOf(":");
      const aId = +key.slice(0, colon), bId = +key.slice(colon + 1);
      const Sa = byId.get(aId), Sb = byId.get(bId);
      if (!Sa || !Sb || Sa.countryId === Sb.countryId) continue;
      const cA = Math.min(Sa.countryId, Sb.countryId);
      const cB = Math.max(Sa.countryId, Sb.countryId);
      const k = cA + ":" + cB;
      tradePair.set(k, (tradePair.get(k) || 0) + Math.abs(net));
    }
  }
  const tradeFactor = (ccA, ccB) => {
    const cA = Math.min(ccA, ccB), cB = Math.max(ccA, ccB);
    const v = tradePair.get(cA + ":" + cB);
    if (!v) return 0;
    return Math.min(1, v / TRADE_PEACE_REF);
  };

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
    // ── Thin-tile defence penalty ───────────────────────────────────
    // A tile's defensibility is proportional to how much of its
    // neighbourhood is the same country — heartland tiles (8/8 own-
    // country neighbours) defend at full strength, an isthmus (2/8) at
    // a fraction, and an enclave fragment (0/8) effectively undefended.
    // Cheap 8-neighbour scan; produces the historical pattern where
    // long thin protrusions collapse first under pressure and enclave
    // fragments naturally fall to the surrounding power.
    let sameCC = 0, cellTotal = 0;
    const defCC = D.countryId;
    const yu = ty - 1, yd = ty + 1;
    const cells = [
      ty * tw + xm, ty * tw + xp,
      yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
      yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
      yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1,
    ];
    for (let k = 0; k < 8; k++) {
      const ni = cells[k]; if (ni < 0) continue;
      cellTotal++;
      const oid = owner[ni]; if (oid < 0) continue;
      const ns2 = byId.get(oid);
      if (ns2 && ns2.countryId === defCC) sameCC++;
    }
    // Floor at 0.1 — even an isolated tile takes SOME effort to grab,
    // so the per-pass attrition still applies. Maps 0/8 → 0.1, 4/8 → 0.55, 8/8 → 1.
    const thinFactor = cellTotal > 0 ? Math.max(0.1, sameCC / cellTotal) : 1;
    // ── Terrain defensive multiplier ────────────────────────────────
    // A tile on a major river, in mountains, or in dense forest is
    // structurally easier to defend than open plain. The attacker has
    // to ford, climb, or pick through cover under fire. Construction
    // tech bridges rivers and engineers passes — high-construction
    // defenders lose most of the river bonus (Roman engineers; modern
    // pontoons). This is what makes fronts visibly SNAP to rivers and
    // mountain ridges instead of plowing straight across the map.
    let terrainDef = 1;
    if (world.riverMag && world.riverMag[ti] >= 2) {
      const cons = (D.knowledge && D.knowledge.construction) || 0;
      terrainDef *= 1 + 1.5 * (1 - 0.6 * cons);    // ≈2.5× at neolithic, ≈1.6× at high-construction
    }
    if (world.elev[ti] > 0.55) {
      const cons = (D.knowledge && D.knowledge.construction) || 0;
      terrainDef *= 1 + 1.0 * (1 - 0.5 * cons);    // ≈2.0× rough alpine, ≈1.5× with engineered passes
    }
    if (terrainDef > 3.5) terrainDef = 3.5;        // cap — a single tile can't be unconquerable
    const effDef = D._M * thinFactor * terrainDef;
    // Trade peace raises the bar: between two countries with a profitable
    // trade link, opportunistic encroachment is suppressed (it's bad
    // business). A saturated trade peer requires ~2× the normal advantage
    // to capture a tile from.
    const tf = tradeFactor(A.countryId, D.countryId);
    if (A._M < effDef * ATTACK_MIN_RATIO * (1 + tf * TRADE_PEACE_MAX)) continue;
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
  // time — see dispatchReinforcements / moveArmies). While here, stamp each
  // defender with the current step (a war/siege clock the polity pass reads to
  // throttle a realm's control budget) and tally, per country, the distinct
  // enemy countries it's engaged with — its front count, for the multi-front
  // overextension catalyst (conquest.js).
  const besieged = new Set();
  const fronts = new Map();   // countryId → Set(enemy countryId) it is DEFENDING against
  const addFront = (a, b) => { let s = fronts.get(a); if (!s) fronts.set(a, s = new Set()); s.add(b); };
  for (const pc of pairs.values()) {
    besieged.add(pc.def);
    pc.def._warAt = world.step;                       // core/countryside under attack
    if (pc.canStorm) {
      pc.def._siegeAt = world.step;                   // front at the heartland (true siege)
      // Multi-front strain counts only SERIOUS defensive fronts: a distinct
      // enemy actually assaulting one of the realm's towns. Mere border
      // skirmishing (a strong neighbour nibbling a weak frontier tile) is not
      // a war that splits the army — otherwise every large realm reads as
      // permanently multi-front simply from bordering many polities.
      addFront(pc.def.countryId, pc.att.countryId);
    }
  }
  world._fronts = { stamp: world.step, byCountry: fronts };
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
          // Was this the capital of its realm? (Decide before the flip.)
          const dc = world.countries && world.countries.get(def.countryId);
          const defWasCapital = !!(dc && dc.capitalId === def.id);
          const oldId = def.countryId;
          // Defence broken — the throne-city falls to the attacker.
          def.countryId = att.countryId;
          def._conqueredAt = world.step;
          def._sackedAt = world.step;   // stormed by force — production penalty in computeExportValue
          def.loyalty = 0.35;   // a fresh conquest starts restless (conquest.js)
          def._ambition = 0;    // a freshly subdued city isn't plotting (yet)
          def.unrest = 0;       // the conquered populace is cowed for now
          // Spoils of war ease the victor's war-weariness (conquest.js unrest).
          const ag = world.governments && world.governments.get(att.countryId);
          if (ag) ag._spoils = Math.min(2, (ag._spoils || 0) + WAR_SPOILS);
          if (def.history) def.history.push({ step: world.step, type: "conquered", by: att.id });
          att.army = Math.max(0, (att.army || 0) * (1 - ASSAULT_ARMY_COST));
          def.army = Math.max(0, (def.army || 0) * 0.3);
          // If it was the capital, the leaderless empire shatters into
          // regional successor states rather than handing the conqueror the
          // whole realm intact (conquest.js).
          if (defWasCapital) fragmentRealm(world, oldId, def.id);
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
