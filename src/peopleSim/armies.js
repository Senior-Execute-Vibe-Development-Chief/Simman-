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

import { CORE_R } from "./territory.js";

const ARMY_FRACTION = 0.08;   // garrison cap as a fraction of population
const ARMY_GROW     = 0.05;   // growth toward the cap per muster
const UPKEEP_PER    = 0.4;    // wealth per soldier per muster
export const MUSTER_INTERVAL   = 100;
export const CONQUEST_INTERVAL = 50;

const ATTACK_MIN_RATIO  = 1.15;        // must out-power a neighbour by this to push
const CAPTURE_SCALE     = 7;           // tiles/pass per unit of power-ratio advantage
const MAX_CAPTURE       = 28;          // hard cap on tiles flipped per front per pass
const CITY_STORM_RATIO  = 2.0;         // power ratio needed to storm the core (annex)
const CITY_ASSAULT_DIST = CORE_R + 2;  // attacker must have pushed this close to the home
                                       // (covers the whole re-carved core, so the front
                                       // doesn't flicker on the heartland tiles)
const ATTRITION         = 0.035;       // army drained per warring front per pass

function techMul(s) {
  const k = s.knowledge || {};
  return 1 + (k.metallurgy || 0) * 1.5 + (k.mobility || 0) * 0.8;
}
function might(s) { return (s.army || 0) * techMul(s); }

// ── Periodic: grow + pay garrisons ──
export function musterArmies(world) {
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const cap = s.people * ARMY_FRACTION;
    s.army = (s.army || 0) + (cap - (s.army || 0)) * ARMY_GROW;
    if (s.army < 0) s.army = 0;
    const cost = s.army * UPKEEP_PER;
    if ((s.wealth || 0) >= cost) s.wealth -= cost;
    else { s.army = (s.wealth || 0) / UPKEEP_PER; s.wealth = 0; }   // disband the unpaid
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
    const key = bestA + ":" + d;
    let pc = pairs.get(key);
    if (!pc) { pc = { att: A, def: D, tiles: [], canStorm: false }; pairs.set(key, pc); }
    if (distHome <= CITY_ASSAULT_DIST) pc.canStorm = true;   // front at the heartland
    else pc.tiles.push({ ti, distHome });                    // capturable countryside
  }

  // Resolve each front: storm the city if the front reached it with
  // overwhelming power; otherwise grind the countryside forward.
  for (const pc of pairs.values()) {
    const { att, def } = pc;
    if (att.mode !== "settled" || def.mode !== "settled" || att.countryId === def.countryId) continue;
    const adv = att._M / Math.max(1, def._M);

    if (pc.canStorm && adv >= CITY_STORM_RATIO) {
      def.countryId = att.countryId;                        // annexed — its realm flips
      if (def.history) def.history.push({ step: world.step, type: "conquered", by: att.id });
      def.army = Math.max(0, (def.army || 0) - att._M * ATTRITION * 2 / techMul(def));
      att.army = Math.max(0, (att.army || 0) - def._M * ATTRITION / techMul(att));
      continue;
    }

    const budget = Math.min(MAX_CAPTURE, Math.floor((adv - 1) * CAPTURE_SCALE));
    if (budget >= 1 && pc.tiles.length) {
      // Drive toward the city: take the tiles nearest the defender's home.
      pc.tiles.sort((p, q) => p.distHome - q.distHome);
      const n = Math.min(budget, pc.tiles.length);
      for (let i = 0; i < n; i++) owner[pc.tiles[i].ti] = att.id;
    }
    att.army = Math.max(0, (att.army || 0) - def._M * ATTRITION / techMul(att));
    def.army = Math.max(0, (def.army || 0) - att._M * ATTRITION / techMul(def));
  }
}
