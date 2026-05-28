// ── Armies ────────────────────────────────────────────────────────────
//
// Each settlement raises a garrison — soldiers LEVIED from its population
// and PAID from its wealth. A settlement that out-musters a bordering
// enemy sends a FIELD ARMY: a moving entity that marches to the target,
// fights the defender's garrison, and — if it wins — captures the
// settlement into the attacker's country (the survivors become its new
// garrison). Conquest is therefore a discrete, visible event (army dots
// marching), not an abstract power flip, which also stops the political
// borders from flickering.

let _armyId = 1;
export function resetArmyIds() { _armyId = 1; }

const ARMY_FRACTION     = 0.08;   // max soldiers as a fraction of population (the levy cap)
const ARMY_GROW         = 0.05;   // garrison growth toward the cap per muster
const UPKEEP_PER        = 0.4;    // wealth per soldier per muster cycle
const MIN_ARMY          = 12;     // below this a garrison won't campaign
const FIELD_FRACTION    = 0.6;    // share of the garrison sent on campaign
const ATTACK_CONFIDENCE = 1.25;   // field strength must beat the target garrison by this
const HOME_DEFENSE      = 1.4;    // defenders fight better at home
const MARCH_SPEED       = 0.45;   // tiles per tick, ×(1+mobility)

export const MUSTER_INTERVAL = 100;

function techMul(s) {
  const k = s.knowledge || {};
  return 1 + (k.metallurgy || 0) * 1.5 + (k.mobility || 0) * 0.8;
}

// ── Per tick: move every army, resolve combat on arrival ──
export function moveArmies(world) {
  const armies = world.armies;
  if (!armies || armies.length === 0) return;
  const { tw, th } = world;
  const live = [];
  for (const a of armies) {
    const target = world._byId.get(a.target);
    if (!target || target.mode !== "settled") continue;   // target gone — army dissolves
    let dx = target.pos.x - a.x;
    if (dx > tw / 2) dx -= tw; else if (dx < -tw / 2) dx += tw;
    const dy = target.pos.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= a.speed + 0.6) { resolveCombat(world, a, target); continue; }   // arrived
    a.x = ((a.x + dx / d * a.speed) % tw + tw) % tw;
    a.y = Math.max(0, Math.min(th - 1, a.y + dy / d * a.speed));
    live.push(a);
  }
  world.armies = live;
}

function resolveCombat(world, a, target) {
  const atk = a.size * a.strengthPer;
  const def = (target.army || 0) * techMul(target) * HOME_DEFENSE;
  if (atk > def) {
    // Attacker wins and captures the settlement; survivors garrison it.
    const survivors = a.size * (1 - def / atk);
    if (target.countryId !== a.countryId) {
      target.countryId = a.countryId;
      if (target.history) target.history.push({ step: world.step, type: "conquered", by: a.countryId });
    }
    target.army = Math.max(0, survivors);
  } else {
    // Defender holds; the assault is spent, the garrison bloodied.
    target.army = Math.max(0, (target.army || 0) * (1 - (def > 0 ? atk / def : 1)));
  }
  // army entity is dropped (not pushed back into world.armies)
}

// ── Periodic: grow + pay garrisons, then launch attacks ──
export function musterArmies(world) {
  // Muster + upkeep.
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const cap = s.people * ARMY_FRACTION;
    s.army = (s.army || 0) + (cap - (s.army || 0)) * ARMY_GROW;
    if (s.army < 0) s.army = 0;
    const cost = s.army * UPKEEP_PER;
    if ((s.wealth || 0) >= cost) s.wealth -= cost;
    else { s.army = (s.wealth || 0) / UPKEEP_PER; s.wealth = 0; }   // disband the unpaid
  }
  // Launch attacks from frontier settlements at weaker neighbours.
  const borders = world._borders;
  if (!borders) return;
  if (!world.armies) world.armies = [];
  const inFlight = new Set(world.armies.map(a => a.owner));
  for (const [aid, neigh] of borders) {
    const A = world._byId.get(aid);
    if (!A || A.mode !== "settled" || inFlight.has(aid) || (A.army || 0) < MIN_ARMY) continue;
    let best = null, bestDef = Infinity;
    for (const bid of neigh) {
      const B = world._byId.get(bid);
      if (!B || B.mode !== "settled" || B.countryId === A.countryId) continue;
      const def = (B.army || 0) * techMul(B) * HOME_DEFENSE;
      if (def < bestDef) { bestDef = def; best = B; }
    }
    if (!best) continue;
    const field = (A.army || 0) * FIELD_FRACTION;
    if (field * techMul(A) > bestDef * ATTACK_CONFIDENCE) {
      A.army -= field;
      world.armies.push({
        id: _armyId++, owner: aid, countryId: A.countryId, target: best.id,
        size: field, strengthPer: techMul(A),
        x: A.pos.x, y: A.pos.y, speed: MARCH_SPEED * (1 + (A.knowledge.mobility || 0)), mode: "marching",
      });
      inFlight.add(aid);
    }
  }
}
