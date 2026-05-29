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

const ARMY_FRACTION = 0.08;   // garrison cap as a fraction of population
const ARMY_GROW     = 0.05;   // growth toward the cap per muster
const UPKEEP_PER    = 0.4;    // wealth per soldier per muster
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

// ── Periodic: grow + pay garrisons ──
export function musterArmies(world) {
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const cap = s.people * ARMY_FRACTION;
    s.army = (s.army || 0) + (cap - (s.army || 0)) * ARMY_GROW;
    if (s.army < 0) s.army = 0;
    const cost = s.army * UPKEEP_PER;
    if ((s.wealth || 0) >= cost) { s.wealth -= cost; recordOut(s, OUT_MILITARY, cost); }
    else { s.army = (s.wealth || 0) / UPKEEP_PER; recordOut(s, OUT_MILITARY, s.wealth || 0); s.wealth = 0; }   // disband the unpaid
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
          def._disloyalSince = undefined;
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
