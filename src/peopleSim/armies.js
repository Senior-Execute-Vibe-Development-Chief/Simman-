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
import { techEff } from "./settlement.js";
import { findPath } from "./roads.js";
import { forEachNear } from "./spatialGrid.js";
import { localEdgeCost } from "./transport.js";
import { fragmentRealm, bankMomentum, MOMENTUM_PER_TILE, MOMENTUM_PER_STORM, recordOccupation } from "./conquest.js";
import { aggressionAttackMul, aggressionArmyMul } from "./personality.js";
import { T } from "./tuning.js";

// Army size is gated by TIER and FOOD, not coin. A garrison is a slice of
// population (capped by tier — villages keep a token watch, cities/capitals
// field real armies). The garrison also EATS (provisioning, in updateFood),
// so a settlement that can't cover that food drains its granary and the army
// DESERTS — you can't field more troops than you can feed. Coin upkeep is now
// a small secondary cost (pay/equipment), not the binding constraint.
const ARMY_TIER_FRAC = [0.02, 0.05, 0.09, 0.11].map(f => f * 1.075);  // garrison cap as fraction of pop, by tier
const ARMY_CAPITAL_BONUS = 0.03 * 1.075;          // the capital fields a bit more
// (TIER_FRAC and CAPITAL_BONUS ×1.075 re-anchor the 0.5-pivot aggressionArmyMul
//  — personality.js; behaviour identical to the old 0.85+a·0.45 form)
// ARMY_GROW (recruitment speed) is a runtime lever — see tuning.js (T.ARMY_GROW).
const ARMY_DESERT   = 0.80;   // when food-starved, the garrison melts to this each muster
const BANKRUPT_DESERT = 0.70; // when wholly unpaid (insolvent state), the garrison melts to this each muster
const WAR_SPOILS    = 0.6;    // war-weariness relief a realm banks each time it storms a city (conquest.js)
export const MUSTER_INTERVAL   = 100;
// CONQUEST_INTERVAL (war-pass cadence) is a runtime lever — tuning.js
// T.CONQUEST_INTERVAL; index.js gates advanceFronts on it.
// A freshly stormed settlement is PACIFIED for this long: it can't be
// re-stormed and it won't secede (conquest.js reads this), so a garrisoned
// new province is firmly held for an age instead of flip-flopping between
// rival empires every pass. The single biggest stabiliser of the political
// map — without it contested frontier cities ping-pong endlessly.
// (Runtime lever — see tuning.js T.CONQUEST_GRACE.)
// The same idea one rung down, for COUNTRYSIDE tiles. A frontier tile has no
// garrison of its own, and a freshly-grabbed border tile is by definition a
// thin protrusion into the enemy (low thinFactor), so without hysteresis the
// two sides' fronts trade the exact same tiles back every pass — the political
// map visibly flickers along contested borders. Once a tile is captured it is
// HELD for this long before it can flip again, so a front that stalls sits
// still instead of ping-ponging. It does NOT slow a genuine advance: the next
// pass eats the enemy's still-untouched tiles deeper in (their grace clock is
// cold), only the just-taken ring is locked.
// (Runtime lever — see tuning.js T.TILE_CAPTURE_GRACE.)

// ATTACK_MIN_RATIO, MAX_CAPTURE, CITY_STORM_RATIO, ATTRITION are runtime levers
// (tuning.js). ATTACK_MIN_RATIO's old 1.12×1.05 re-anchored the 0.5-pivot
// aggressionAttackMul — its tuning default (1.176) preserves that exactly.
const CAPTURE_SCALE     = 5;           // tiles/pass per unit of power-ratio advantage
const ASSAULT_MARGIN    = 2;           // front must reach within (defender core + this) of the home
const ASSAULT_ARMY_COST = 0.4;         // share of the victor's garrison spent taking a city
// Offensive throttle & strategic depth now live in the NATIONAL WAR CAPACITY block
// inside advanceFronts (national field army × WAR_CONCENTRATION / WAR_DEFENSE_DRAG / WAR_DEF_SPLIT / war-exhaustion):
// a realm has finite force split across its fronts, so it can't conquer on one while
// overrun on another, nor knife many neighbours at once, and an established power
// fields reserves a small upstart can't match.
// Siege: once the front reaches the heartland the city does NOT fall at
// once. The besiegers grind the garrison down over several passes (SIEGE_DMG
// of the attacker's might per pass); the city is only stormed once its
// defence breaks (drops below SIEGE_BREAK of the attacker's might). So a
// well-garrisoned city visibly holds out under a shrinking front, while an
// undefended one falls quickly.
const SIEGE_DMG         = 0.06;
const SIEGE_BREAK       = 0.15;

// ── Home defence (citizen militia floor) ─────────────────────────────
// A city's paid garrison can desert (food shortfall, or an insolvent state
// that can't make payroll), but the CITIZENS still man the walls when their
// own homes are stormed. So a settlement's effective might DEFENDING ITS OWN
// CORE never falls below a militia levy proportional to its population.
//
// Why this exists: without it, the chain over-extension → insolvency →
// garrison desertion left big cities with a ~zero garrison, so any neighbour
// stormed them in a single pass; storming a CAPITAL shatters the realm
// (fragmentRealm), the leaderless fragments are instantly re-stormed, and the
// whole political map boils (measured: ~300 city-captures per 2000 ticks on a
// 255-settlement map — every city taken ~1.6× per window). The militia floor
// makes a bankrupt city cost a real army to take, so wars between two
// exhausted realms STALEMATE (positional sieges) instead of trading capitals
// every pass. It is HOME-ONLY: it does not project to capture tiles or defend
// distant countryside — only to make the city itself defensible. The fraction
// sits below a solvent city's full garrison cap (ARMY_TIER_FRAC ~0.10 for a
// city), so a paid garrison still dominates when the state can afford one; the
// floor only bites once the garrison has melted away.
// HOME_MILITIA_FRAC -> runtime lever (tuning.js T.HOME_MILITIA_FRAC) — the
// fraction of population that mans the walls; THE dial for the
// consolidation↔fragmentation balance (0 reproduces the old boiling map).
// ...but citizens only turn out for a regime they still believe in. A city in
// open revolt (loyalty gone, unrest boiling) won't man the walls for the
// throne — it throws the gates. So the militia floor scales with MORALE
// (loyalty, less unrest): a stable, content city is a hard nut even when
// bankrupt, while a collapsing realm's cities fall readily. THIS is what keeps
// conquest as the mechanism that prunes failing empires (so the map still
// consolidates) instead of freezing every border (the over-correction a flat
// floor produced: cities unconquerable → realms never merge → confetti).
const MILITIA_MORALE_FLOOR = 0.2;   // even a mutinous city musters this fraction

function techMul(s) {
  return techEff(s).military;   // combat multiplier from the discovered war techs (tech.js)
}
function might(s) { return (s.army || 0) * techMul(s); }
// Effective defensive might of a settlement holding its OWN core: the greater
// of its paid garrison and the citizen militia its population can raise — the
// militia weighted by the city's morale (a disloyal/rioting populace barely
// defends the regime).
function homeMight(s) {
  const morale = Math.max(MILITIA_MORALE_FLOOR, (s.loyalty ?? 1) - 0.5 * (s.unrest || 0));
  const militia = (s.people || 0) * T.HOME_MILITIA_FRAC * morale;
  return Math.max(s.army || 0, militia) * techMul(s);
}

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
// Only NEARBY realm-mates can relieve a siege in time: a column marches at
// MARCH_SPEED and a siege lasts a handful of conquest passes, so a sender across
// the map never arrives. Bounding the sender search to this radius also lets the
// spatial grid answer it locally instead of scanning every settlement (the
// O(besieged × settlements) scan was part of the late-game blow-up).
const REINFORCE_RANGE     = 90;
// Hard cap on relief PATHFINDS per conquest pass. Late game can have hundreds of
// simultaneous sieges, and each sender needs a full-map A* route — unbounded,
// that single pass dominated the whole tick (multi-second spikes). With a budget
// the cost is bounded; sieges left unrelieved this pass simply get another shot
// next conquest pass (they persist for many passes), and the budget is spent on
// the most important sieges first (triage below).
const MAX_REINFORCE_PATHS = 64;

// Besieged settlements call their nearest realm-mates to march troops in. Cost
// is bounded three ways: senders are found via the spatial grid within
// REINFORCE_RANGE, only the nearest few are pathed per siege, and a global
// per-pass pathfind budget caps the total work (capitals/large cities first).
function dispatchReinforcements(world, besieged) {
  if (!world.armies) world.armies = [];
  if (world.armies.length >= MAX_MARCHES) return;
  const tw = world.tw;
  // Triage: spend the limited relief budget on the most important sieges first
  // (the throne, then larger settlements), so a swamped frontier can't starve
  // the capital of reinforcements.
  const order = [...besieged].sort((a, b) => {
    const ca = world.countries && world.countries.get(a.countryId);
    const cb = world.countries && world.countries.get(b.countryId);
    const capA = ca && ca.capitalId === a.id ? 1 : 0;
    const capB = cb && cb.capitalId === b.id ? 1 : 0;
    if (capA !== capB) return capB - capA;
    return (b.people || 0) - (a.people || 0);
  });
  let pathBudget = MAX_REINFORCE_PATHS;
  for (const def of order) {
    if (pathBudget <= 0 || world.armies.length >= MAX_MARCHES) break;
    // Nearby same-realm senders with troops to spare and off cooldown — gathered
    // from the spatial grid (local, not a full-settlement scan).
    const cands = [];
    forEachNear(world, def.pos.x, def.pos.y, REINFORCE_RANGE, (m, d2) => {
      if (m.id === def.id || m.countryId !== def.countryId) return;
      if ((m.army || 0) < REINFORCE_MIN_ARMY) return;
      if (world.step - (m._lastReinforce ?? -Infinity) < REINFORCE_COOLDOWN) return;
      cands.push({ m, d2 });
    });
    if (cands.length === 0) continue;
    cands.sort((a, b) => a.d2 - b.d2);
    // Path only the nearest few candidates (each is one A*), capped by the global
    // budget — so a single siege can never path the whole realm.
    let sent = 0;
    const tries = Math.min(cands.length, REINFORCE_MAX_SENDERS);
    for (let i = 0; i < tries; i++) {
      if (sent >= REINFORCE_MAX_SENDERS || pathBudget <= 0 || world.armies.length >= MAX_MARCHES) break;
      const m = cands[i].m;
      pathBudget--;
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
  // A warlike realm keeps a bigger garrison for its size; a mercantile /
  // cautious one fields less (personality.js aggressionArmyMul).
  if (c && c.personality) f *= aggressionArmyMul(c.personality);
  return f * T.ARMY_SIZE_MULT;   // global garrison-size dial (tuning.js)
}

// ── Periodic: grow + provision garrisons ──
export function musterArmies(world) {
  // National MANPOWER pool — the trained men a realm can field. It REGENERATES from
  // POPULATION (recruits coming of age) toward a ceiling (a fraction of national pop),
  // and is DRAINED by battle casualties (advanceFronts). The standing army can never
  // exceed it, so a realm bled white in a long war can't instantly re-arm — it must wait
  // a generation for its population to grow the men back. War now costs MEN, not just
  // coin and morale. (MANPOWER_FRAC = 0 turns the whole pool off.)
  let mp = world._manpower; if (!mp) mp = world._manpower = new Map();
  const natPop = new Map();
  if (T.MANPOWER_FRAC > 0) {
    for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) natPop.set(s.countryId, (natPop.get(s.countryId) || 0) + (s.people || 0));
    const seen = new Set();
    for (const [cc, pop] of natPop) {
      const cap = T.MANPOWER_FRAC * pop;
      const cur = mp.has(cc) ? mp.get(cc) : cap;                 // a new realm starts with a full reserve
      // Regrow toward the ceiling, but never ABOVE it — a realm that lost territory (its
      // pop-based ceiling just dropped) sheds the surplus at once: those men live in the
      // lost provinces now, not the rump.
      mp.set(cc, Math.min(cap, cur + (cap - cur) * T.MANPOWER_REGEN));
      seen.add(cc);
    }
    for (const cc of [...mp.keys()]) if (!seen.has(cc)) mp.delete(cc);   // drop dead realms
  }

  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    // Can the settlement actually FEED its garrison? The signal is an
    // UNCOVERED food deficit — local production + grain imports falling short
    // of total demand (which includes the garrison's provisioning). Low STORED
    // food isn't enough (import-fed towns always run their granary near empty);
    // only a real shortfall starves the army into desertion. Fed settlements
    // grow their garrison to the tier/political cap. This is the soft "can't
    // field more than you can feed" limit.
    const fed = s._foodSupply || 0;   // _foodSupply now includes hierarchy-aggregated grain (foodHierarchy.js)
    if (fed < (s._foodDemand || 0) * 0.98) {
      s.army = (s.army || 0) * ARMY_DESERT;
    } else {
      const popCap = s.people * armyCapFrac(world, s);   // tier/political limit
      s.army = (s.army || 0) + (popCap - (s.army || 0)) * T.ARMY_GROW;
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

  // Cap the standing army at the manpower pool: if a realm's garrisons sum to more men
  // than it has trained, scale them all back to fit — the reserve simply isn't there.
  // (After a bloody war drained the pool, this is what keeps the army hollowed out until
  // the population regrows it above.)
  if (T.MANPOWER_FRAC > 0) {
    const deployed = new Map();
    for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) deployed.set(s.countryId, (deployed.get(s.countryId) || 0) + (s.army || 0));
    const scale = new Map();
    for (const [cc, dep] of deployed) { const cap = mp.get(cc) || 0; if (dep > cap && dep > 0) scale.set(cc, cap / dep); }
    if (scale.size) for (const s of world.settlements) { if (s.mode !== "settled") continue; const sc = scale.get(s.countryId); if (sc != null) s.army *= sc; }
    if (world.countries) for (const [cc, pop] of natPop) { const c = world.countries.get(cc); if (c) { c._manpower = mp.get(cc) || 0; c._manpowerCap = T.MANPOWER_FRAC * pop; } }
  }
}

// ── Periodic: advance every active war front by tile capture / storm ──
export function advanceFronts(world) {
  const owner = world._territoryOwner;
  const byId = world._byId;
  if (!owner || !byId) return;
  const { N, tw, th } = world;
  // Per-tile "captured at step" clock for the post-capture hold (see
  // TILE_CAPTURE_GRACE). Cold (-Infinity) everywhere until a tile is flipped by
  // a front, so a stable border is never affected.
  let capturedAt = world._tileCapturedAt;
  if (!capturedAt || capturedAt.length !== N) {
    capturedAt = world._tileCapturedAt = new Float64Array(N).fill(-Infinity);
  }

  const natMight = new Map();   // countryId → Σ might = the NATIONAL FIELD ARMY (Σ garrison × tech)
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    s._M = might(s);
    s._homeTi = (s.pos.y | 0) * tw + (s.pos.x | 0);
    s._armyStart = s.army || 0; s._ccStart = s.countryId;   // snapshot for the manpower casualty tally (end of pass)
    if (s.countryId >= 0) natMight.set(s.countryId, (natMight.get(s.countryId) || 0) + s._M);
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
      terrainDef *= 1 + 2.2 * (1 - 0.6 * cons);    // ≈3.2× at neolithic, ≈2× at high-construction
    }
    if (world.elev[ti] > 0.5) {
      const cons = (D.knowledge && D.knowledge.construction) || 0;
      // Steeper highland defends harder, scaling past the 0.5 threshold, so a
      // mountain wall genuinely channels invasions instead of being plowed flat.
      const alp = Math.min(1, (world.elev[ti] - 0.5) / 0.3);
      terrainDef *= 1 + (1.0 + 1.6 * alp) * (1 - 0.5 * cons);   // ≈2–4.6× rough/high alpine
    }
    if (terrainDef > 6) terrainDef = 6;            // cap — a single tile can't be unconquerable
    // Even a vastly-stronger attacker is CHANNELLED by terrain: a river/mountain
    // tile resists ~up to 6× a plain, so fronts snap to ridges and rivers and
    // pour through the passes/valleys between, rather than advancing as a wall.
    const effDef = D._M * thinFactor * terrainDef;
    // Trade peace raises the bar: between two countries with a profitable
    // trade link, opportunistic encroachment is suppressed (it's bad
    // business). A saturated trade peer requires ~2× the normal advantage
    // to capture a tile from.
    const tf = tradeFactor(A.countryId, D.countryId);
    // The ATTACKER's temperament sets how much of an edge it demands before
    // pushing: a warlike realm attacks on a slim margin, a cautious/merchant
    // one wants a clear advantage (personality.js aggressionAttackMul).
    const aCountry = world.countries && world.countries.get(A.countryId);
    const aggMul = aCountry && aCountry.personality ? aggressionAttackMul(aCountry.personality) : 1;
    if (A._M < effDef * T.ATTACK_MIN_RATIO * aggMul * (1 + tf * TRADE_PEACE_MAX)) continue;
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
    // capturable countryside — unless this tile was just flipped and is still
    // in its post-capture hold, which keeps a stalled front from ping-ponging
    // the same border tiles back and forth every pass.
    else if (world.step - capturedAt[ti] >= T.TILE_CAPTURE_GRACE) pc.tiles.push({ ti, distHome });
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

  // ── National war capacity ──────────────────────────────────────────────
  // Inter-state war is NOT a duel between two frontier garrisons — it is decided by
  // NATIONAL FIELD ARMIES (natMight = Σ garrison×tech, capped by manpower + treasury).
  // Per realm, tally the distinct enemy NATIONS it is engaged with — offensive fronts
  // (it is attacking) vs defensive load/attackers (it is assaulted). From those:
  //   • offMulPair — how the attacker ALLOCATES its national army to a front:
  //     CONCENTRATED on the main effort (secondary fronts merely hold), sapped while
  //     troops are pinned defending, worn by war-exhaustion. Times natMight = the force.
  //   • defShareOf — how the defender SPLITS its national army across the fronts it is
  //     attacked on (whole army vs one invader; divided among many). A border town's
  //     garrison decides nothing in the open field — only the national armies do.
  const allEnemies = new Map();   // cc → Set(enemy cc) either direction (depth divisor)
  const defLoad    = new Map();   // cc → Σ defensive weight it is under (besieged capital heaviest)
  const attNat     = new Map();   // attacker cc → Map(enemy cc → {prio, serious, conc}) — its national fronts
  const attackersOf= new Map();   // defender cc → Set(enemy cc) attacking it (defensive front count)
  const addEnemy = (cc, ecc) => { let s = allEnemies.get(cc); if (!s) allEnemies.set(cc, s = new Set()); s.add(ecc); };
  for (const pc of pairs.values()) {
    const acc = pc.att.countryId, dcc = pc.def.countryId;
    if (acc === dcc) continue;
    addEnemy(acc, dcc); addEnemy(dcc, acc);
    let m = attNat.get(acc); if (!m) attNat.set(acc, m = new Map());
    let f = m.get(dcc); if (!f) m.set(dcc, f = { prio: 0, serious: false, conc: 1 });
    const prio = (pc.canStorm ? 1e7 : 0) + pc.att._M;   // assault outranks a skirmish, then by army committed
    if (prio > f.prio) f.prio = prio;
    if (pc.canStorm) f.serious = true;
    let da = attackersOf.get(dcc); if (!da) attackersOf.set(dcc, da = new Set()); da.add(acc);
    const dc = world.countries && world.countries.get(dcc);
    const isCap = !!(dc && dc.capitalId === pc.def.id);
    defLoad.set(dcc, (defLoad.get(dcc) || 0) + (pc.canStorm ? (isCap ? 1.6 : 1.0) : 0.4));
  }

  // CONCENTRATION (main effort): a realm has finite command, supply and reserves, so
  // however many borders it has it can wage only a FEW real wars at once. Rank each
  // realm's enemy NATIONS (a heartland assault outranks a border skirmish, then by the
  // army committed) and fall off geometrically (WAR_CONCENTRATION): the WHOLE front
  // against the priority enemy pushes at full force, other enemies are merely held.
  // So a realm fights 1–2 wars at a time, and the chosen one advances as a BROAD front
  // (every frontier settlement against that enemy) — not all enemies feebly at once (old
  // automaton), not a lone tile-spike (the spread/arrow), not nothing (even division).
  const seriousOff = new Map();   // attacker cc → # of enemy NATIONS it is seriously assaulting (exhaustion)
  for (const [acc, m] of attNat) {
    const fronts = [...m.values()].sort((a, b) => b.prio - a.prio);
    for (let i = 0; i < fronts.length; i++) fronts[i].conc = Math.pow(T.WAR_CONCENTRATION, i);
    let sc = 0; for (const f of fronts) if (f.serious) sc++;
    if (sc) seriousOff.set(acc, sc);
  }

  // War-exhaustion (persists on world): rises with SERIOUS war load (enemy nations it is
  // assaulting + assaults it is under), decays toward zero in peace — so a long or
  // many-fronted war grinds a realm to a de-facto standstill and rest restores its
  // punch. (advanceFronts runs every CONQUEST_INTERVAL ticks = one pass.)
  let exh = world._warExhaust; if (!exh) exh = world._warExhaust = new Map();
  const seenCC = new Set();
  for (const cc of allEnemies.keys()) {
    const load = (seriousOff.get(cc) || 0) + (defLoad.get(cc) || 0);
    exh.set(cc, Math.min(T.WAR_EXHAUST_MAX, (exh.get(cc) || 0) * T.WAR_EXHAUST_DECAY + T.WAR_EXHAUST_RATE * load));
    seenCC.add(cc);
  }
  for (const [cc, e] of exh) if (!seenCC.has(cc)) { const v = e * T.WAR_EXHAUST_DECAY; if (v < 0.002) exh.delete(cc); else exh.set(cc, v); }

  // A front's offensive multiplier: its enemy-nation concentration rank × war-weariness
  // ÷ defensive tie-down (troops pinned defending can't also attack).
  const concRestTied = (acc, dcc) => {
    const m = attNat.get(acc); const f = m && m.get(dcc);
    const tied = 1 + T.WAR_DEFENSE_DRAG * (defLoad.get(acc) || 0);
    const rested = 1 - Math.min(0.9, exh.get(acc) || 0);
    return (f ? f.conc : 1) * rested / tied;
  };
  const offMulPair = (pc) => concRestTied(pc.att.countryId, pc.def.countryId);
  // The NATIONAL FIELD ARMY is the force that decides a war — not the border garrison.
  // A realm projects its whole army (natMight = Σ garrison×tech, itself capped by national
  // MANPOWER and the treasury) onto a front, CONCENTRATED on its main effort. Its enemy
  // resists with ITS national army, SPLIT across the fronts it is defending (a realm
  // assailed by many divides its field army; one fighting a single war meets the invader
  // whole). So who takes ground is the national-army RATIO on that front — manpower × tech
  // × treasury — and a border town's garrison matters only as a fortress in a siege (below).
  const defShareOf = (cc) => {
    const a = attackersOf.get(cc);
    return 1 / (1 + T.WAR_DEF_SPLIT * Math.max(0, (a ? a.size : 1) - 1));
  };
  const fieldForce = (cc) => (natMight.get(cc) || 0);

  // ── Encirclement ─────────────────────────────────────────────────────
  // A settlement assaulted from many DIRECTIONS must split its defence across
  // them, so it falls faster — a surrounded salient or engulfed statelet can't
  // hold ground pressed from every side. Tally the distinct compass octants the
  // attacking fronts come from (per defender) and divide its effective defence by
  // (1 + ENCIRCLE x (directions-1)). One clean front = full strength; pressed from
  // all sides it crumbles — so the war system itself dissolves the strange
  // surrounded shapes instead of leaving them marooned inside a neighbour.
  const ENCIRCLE = T.ENCIRCLE_PENALTY ?? 0;
  const halfTw = tw / 2;
  // Source: scan the territory map once and, per settlement, record which compass
  // octants of its OWN land border an ENEMY country (not wilderness or sea). A
  // settlement facing foes on a couple of octants is a normal frontier; one ringed
  // on most sides is surrounded. Geographic, so it doesn't matter whether one big
  // neighbour or several border it.
  const encMask = new Map();   // settlement id → bitmask of octants its land meets an enemy
  if (ENCIRCLE > 0) {
    for (let ti = 0; ti < N; ti++) {
      const d = owner[ti]; if (d < 0) continue;
      const D = byId.get(d); if (!D || D.mode !== "settled") continue;
      const dcc = D.countryId; if (dcc < 0) continue;
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      let enemy = false;
      for (let k = 0; k < 4; k++) { const ni = ns[k]; if (ni < 0) continue; const o = owner[ni]; if (o < 0 || o === d) continue; const O = byId.get(o); if (O && O.countryId !== dcc) { enemy = true; break; } }
      if (!enemy) continue;
      let ddx = tx - (D.pos.x | 0); if (ddx > halfTw) ddx -= tw; else if (ddx < -halfTw) ddx += tw;
      const oct = (((Math.atan2(ty - (D.pos.y | 0), ddx) + Math.PI) / (Math.PI / 4)) | 0) & 7;
      encMask.set(d, (encMask.get(d) || 0) | (1 << oct));
    }
  }
  const ENC_FREE = 4;   // a normal frontier settlement meets enemies on ~3-4 octants; the penalty applies only BEYOND that (genuinely surrounded)
  const encMulOf = (def) => {
    const m = encMask.get(def.id); if (!m) return 1;
    let n = 0; for (let b = m; b; b >>= 1) n += b & 1;        // popcount = enemy-bordered directions
    const over = n - ENC_FREE; if (over <= 0) return 1;       // ≤ normal frontier → no penalty
    return 1 / (1 + ENCIRCLE * over);                          // surrounded → defence split, falls faster
  };

  // Resolve each front: besiege the city if the front reached its
  // heartland; otherwise grind the countryside forward, tile by tile.
  for (const pc of pairs.values()) {
    const { att, def } = pc;
    if (att.mode !== "settled" || def.mode !== "settled" || att.countryId === def.countryId) continue;
    // The attacker's effective offensive might is throttled while it is itself
    // under attack — a realm fighting for its own heartland can't also expand.
    const acc = att.countryId, dcc = def.countryId;
    // The attacker projects its NATIONAL field army onto this front — concentrated on its
    // main effort, worn by war-weariness, sapped while pinned defending. The defender meets
    // it with its OWN national army, split across the fronts it defends and the directions
    // it is pressed from. Who takes the countryside is the national-army ratio here.
    const attForce = fieldForce(acc) * offMulPair(pc);
    const em = encMulOf(def);                          // <1 if the defender is pressed from several sides
    const adv = attForce / Math.max(1, fieldForce(dcc) * defShareOf(dcc) * em);

    if (pc.canStorm) {
      // Front is at the heartland. The city defends with its garrison OR its
      // citizen militia, whichever is greater (homeMight) — so a city whose
      // paid garrison deserted under bankruptcy is NOT free real estate; it
      // still takes a real army to storm. This is the single biggest brake on
      // the boiling-map churn (see HOME_MILITIA_FRAC).
      // The capital is stormed only if the attacker's national assault force overcomes the
      // defender's RELIEF army (the field army it can spare for this front) PLUS the city's
      // own fortress — garrison or citizen-militia behind the walls (homeMight). So a
      // relieved capital holds against a far larger invader; an isolated one (its field army
      // spent or pinned elsewhere) falls to its walls alone.
      const defHome = homeMight(def);
      const advCity = attForce / Math.max(1, (fieldForce(dcc) * defShareOf(dcc) + defHome) * em);
      // A recently-conquered city is still pacified (garrisoned) and can't be
      // besieged yet — that grace stops rival empires trading it back and forth.
      if (advCity >= T.CITY_STORM_RATIO && world.step - (def._conqueredAt ?? -Infinity) >= T.CONQUEST_GRACE) {
        // Bombard: grind the garrison; the besiegers bleed against the defence
        // they actually face (the militia floor, not the melted garrison).
        def.army = Math.max(0, (def.army || 0) - att._M * SIEGE_DMG);
        att.army = Math.max(0, (att.army || 0) - defHome * T.ATTRITION / techMul(att));
        // Defence as the siege grinds on: the garrison falls, but never below
        // the (morale-weighted) citizen militia — homeMight recomputed on the
        // now-reduced garrison returns exactly that floor.
        const defNow = homeMight(def);
        if (defNow * em <= att._M * SIEGE_BREAK) {   // a city encircled on many sides breaks sooner (its defence is split)
          // Was this the capital of its realm? (Decide before the flip.)
          const dc = world.countries && world.countries.get(def.countryId);
          const defWasCapital = !!(dc && dc.capitalId === def.id);
          const oldId = def.countryId;
          // Defence broken — the throne-city falls to the attacker.
          def.countryId = att.countryId;
          recordOccupation(def, oldId, att.countryId, world.step);   // remember the nation it just lost (homeland)
          if (world.debug && world.debug.land) { world.debug.land.conquest++; const g = world.debug.land.gain; g.set(att.countryId, (g.get(att.countryId) || 0) + 1); }
          def._conqueredAt = world.step;
          def._sackedAt = world.step;   // stormed by force — production penalty in computeExportValue
          def.loyalty = 0.35;   // a fresh conquest starts restless (conquest.js)
          def._ambition = 0;    // a freshly subdued city isn't plotting (yet)
          def.unrest = 0;       // the conquered populace is cowed for now
          // Spoils of war ease the victor's war-weariness (conquest.js unrest).
          const ag = world.governments && world.governments.get(att.countryId);
          if (ag) ag._spoils = Math.min(2, (ag._spoils || 0) + WAR_SPOILS);
          if (def.history) def.history.push({ step: world.step, type: "conquered", by: att.id });
          // Sack: the storm burns institutions, records and workshops. A
          // stormed CAPITAL loses its whole administrative apparatus — the
          // classic dark-age trigger (the fall of Rome, the Bronze-Age
          // collapse); a provincial city far less. (T.KNOW_DECAY gates the
          // whole dark-age system; 0 = off.)
          if (T.KNOW_DECAY > 0 && def.knowledge) {
            const hit = Math.min(0.5, (defWasCapital ? 0.22 : 0.10) * T.KNOW_DECAY);
            def.knowledge.organization = Math.max(0, def.knowledge.organization * (1 - hit));
            def.knowledge.construction = Math.max(0, def.knowledge.construction * (1 - hit * 0.6));
          }
          bankMomentum(world, att.countryId, MOMENTUM_PER_STORM);   // a stormed city feeds the winning streak
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

    const budget = Math.min(T.MAX_CAPTURE, Math.floor((adv - 1) * CAPTURE_SCALE));
    if (budget >= 1 && pc.tiles.length) {
      // Advance the front BROADLY: take the outermost contested tiles first
      // so the defender's countryside erodes ring by ring (visible) instead
      // of a thin salient spiking straight to the capital.
      pc.tiles.sort((p, q) => q.distHome - p.distHome);
      const n = Math.min(budget, pc.tiles.length);
      for (let i = 0; i < n; i++) { const cti = pc.tiles[i].ti; owner[cti] = att.id; capturedAt[cti] = world.step; }
      bankMomentum(world, att.countryId, n * MOMENTUM_PER_TILE);   // captured countryside feeds the streak
    }
    att.army = Math.max(0, (att.army || 0) - def._M * T.ATTRITION / techMul(att));
    def.army = Math.max(0, (def.army || 0) - att._M * T.ATTRITION / techMul(def));
  }

  // Expose each warring realm's strategic state — for the info panel and probes:
  // how many fronts it is attacking on, how hard it's pinned defending, its
  // war-exhaustion, and the resulting offensive-capacity multiplier.
  if (world.countries) {
    for (const cc of allEnemies.keys()) {
      const c = world.countries.get(cc); if (!c) continue;
      const m = attNat.get(cc);
      let mainMul = 0, eff = 0;
      if (m) for (const dcc of m.keys()) { const mul = concRestTied(cc, dcc); if (mul > mainMul) mainMul = mul; if (mul > 0.3) eff++; }
      c._offFronts = m ? m.size : 0;            // distinct enemy NATIONS it is attacking
      c._effFronts = eff;                       // of those, how many it can actually PUSH (offMul > 0.3)
      c._mainOffMul = mainMul;                  // its main-effort capacity
      c._defLoad = defLoad.get(cc) || 0;
      c._warExhaust = exh.get(cc) || 0;
      c._warStamp = world.step;                 // freshness: engaged THIS pass
    }
  }

  // MANPOWER casualties: every garrison that SHRANK this pass did so in battle (attrition,
  // bombardment, a stormed city's losses) — those men are DEAD, so drain them from their
  // realm's manpower pool (attributed to who owned them when they fell, before any conquest
  // flip). The pool only regrows from population (musterArmies), so a bloody war leaves the
  // realm unable to refield its army for a generation — lasting, demographic war-weariness.
  if (T.MANPOWER_FRAC > 0) {
    let mp = world._manpower; if (!mp) mp = world._manpower = new Map();
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const cc = s._ccStart; if (cc == null || cc < 0) continue;
      const loss = (s._armyStart || 0) - (s.army || 0);
      if (loss > 0 && mp.has(cc)) mp.set(cc, Math.max(0, mp.get(cc) - loss));
    }
  }
}
