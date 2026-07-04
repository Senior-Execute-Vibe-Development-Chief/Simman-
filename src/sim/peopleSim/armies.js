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
import { techEff, URBAN_BASE_RURAL } from "./settlement.js";
import { fragmentRealm, bankMomentum, MOMENTUM_PER_TILE, MOMENTUM_PER_STORM, recordOccupation, BALANCE_W, BALANCE_CAP } from "./conquest.js";
import { aggressionAttackMul, aggressionArmyMul } from "./personality.js";
import { identityWeightsFor, casusBelliMul } from "./cohesion.js";
import { realmName } from "./chronicle.js";
import { inCrisis } from "./dynasties.js";
import { getPolity as _getPolity } from "./entities.js";
import { logEvent } from "./events.js";
import { getPolity } from "./entities.js";
import { T } from "./tuning.js";
import { recordIn, IN_STATE_PAY } from "./money.js";

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
// Conscription — the temporary WAR LEVY raised on top of the standing professional army.
const CONSCRIPT_WINDOW = 200;  // ticks after a war-pass a realm still counts as mobilised
const CONSCRIPT_DEF    = 0.5;  // mobilisation intensity per unit of DEFENSIVE load (heartland under assault → total war)
const CONSCRIPT_OFF    = 0.18; // mobilisation intensity per OFFENSIVE front (a campaign of choice mobilises less)
const MOBILIZE_SPEED   = 4;    // the levy musters in / disbands ×this faster than peacetime recruitment
const WAR_SPOILS    = 0.6;    // war-weariness relief a realm banks each time it storms a city (conquest.js)
const PLUNDER_FRAC  = 0.30;   // share of a stormed city's coin that is portable and seizable — sacks pay (a conserved transfer to the victor's treasury)
const INDEMNITY_FRAC = 0.25;  // max share of the beaten side's treasury paid as reparations at a truce (scaled by how one-sided the exhaustion is)
const TRADE_PEACE_W  = 2.0;   // how much mutual trade LENGTHENS a truce: at pairTrade >= its own war-relief scale the peace holds ~3x as long (merchants fund the settlement)
const CONGRESS_JOIN  = 0.75;  // a third belligerent already worn past this fraction of TRUCE_EXHAUST joins the settlement (wars end at conferences, not dyad by dyad)

// ── War-dead ledger ─────────────────────────────────────────────────────
// Military losses accumulated per warring PAIR (key "lo:hi"), emitted as a
// war.ended event when the pair makes peace (truce) or the war fades from
// memory. Feeds the Richardson war-deadliness validate gate and the
// chronicle ("a war that killed ten thousand"). Persisted (persist.js).
function tallyDead(world, ccA, ccB, n) {
  if (!(n > 0) || ccA < 0 || ccB < 0 || ccA === ccB) return;
  const m = world._warDead || (world._warDead = new Map());
  const key = Math.min(ccA, ccB) + ":" + Math.max(ccA, ccB);
  m.set(key, (m.get(key) || 0) + n);
}
// Exported: conquest.js settles a war the same way when a belligerent SUBMITS
// (capitulation is a peace — the war's dead are reckoned at the knee-bending).
export function closeWar(world, key, how) {
  const m = world._warDead;
  const dead = m ? m.get(key) || 0 : 0;
  if (m) m.delete(key);
  const [a, b] = key.split(":").map(Number);
  logEvent(world, "war.ended", { polity: a, to: b, name: realmName(world, a), toName: realmName(world, b),
    dead: Math.round(dead), how });
}
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
const CLAIM_BAR         = 0.62;        // CLAIMANT_WARS: a live succession claim on the defender cuts the claimant's
                                       // attack bar to this — a real casus belli, so wars OF succession actually fire
const DOM_ATTACK_P      = 0.45;        // a DOMINANT realm (conquest.js _dominance) attacks on a slimmer margin —
                                       // bar ÷ dominance^this — so a great power expands by conquest where the pack
                                       // stalls (Rome, the Mongols, the Ottomans). Bounded by the dominance cap.
const DOM_CAPTURE_P     = 0.4;         // …and BLITZES: its fronts take more countryside per pass (rate & per-front cap
                                       // × dominance^this), so a hegemon's conquest sweeps a region in a campaign
                                       // instead of nibbling it over centuries — the decisive pre-modern expansion.
const ASSAULT_MARGIN    = 2;           // front must reach within (defender core + this) of the home
const ASSAULT_ARMY_COST = 0.4;         // share of the victor's garrison spent taking a city
// Offensive throttle & strategic depth now live in the NATIONAL WAR CAPACITY block
// inside advanceFronts (national field army × WAR_CONCENTRATION / WAR_DEFENSE_DRAG / DEF_PRIORITY / war-exhaustion):
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
  // Combat multiplier from the discovered war techs (tech.js), lifted for mounted
  // pastoral nomads — open-steppe horse peoples fight as cavalry hosts far above
  // their numbers (the steppe-conqueror edge; see s._nomad in settlement.js).
  return techEff(s).military * (1 + T.NOMAD_MIL * (s._nomad || 0));
}
function might(s) { return (s.army || 0) * techMul(s); }
// Effective defensive might of a settlement holding its OWN core: the greater
// of its paid garrison and the citizen militia its population can raise — the
// militia weighted by the city's morale (a disloyal/rioting populace barely
// defends the regime).
// Fortification: the construction tree's defense channel (masonry → the
// arch → castles/cathedral masons → star forts), which GUNPOWDER erodes
// (tech.js: gunpowder carries negative defense fx — the end of the castle
// age arrives per-theatre, when a neighbour's chemistry matures, never on a
// date). Weight: a fully-fortified city is ~2.5x harder to storm — walls
// decided sieges without making them unwinnable (starvation still works).
const WALL_W = 1.5;
function homeMight(s) {
  const morale = Math.max(MILITIA_MORALE_FLOOR, (s.loyalty ?? 1) - 0.5 * (s.unrest || 0));
  const militia = (s.people || 0) * T.HOME_MILITIA_FRAC * morale;
  const walls = 1 + WALL_W * Math.max(0, techEff(s).defenseLevel || 0);
  return Math.max(s.army || 0, militia) * techMul(s) * walls;
}

// (The old marching-reinforcement columns — dispatchReinforcements/moveArmies
// and world.armies — were removed: nothing called them since siege relief moved
// to the national defensive-split model (defShareOf), so columns never spawned
// and the renderer's marching-army overlay could never fire.)

function armyCapFrac(world, s) {
  let f = ARMY_TIER_FRAC[s.tier | 0] ?? ARMY_TIER_FRAC[0];
  const c = world.countries && world.countries.get(s.countryId);
  if (c && c.capitalId === s.id) f += ARMY_CAPITAL_BONUS;   // the capital fields a bit more
  // A warlike realm keeps a bigger garrison for its size; a mercantile /
  // cautious one fields less (personality.js aggressionArmyMul).
  if (c && c.personality) f *= aggressionArmyMul(c.personality);
  // A standing PROFESSIONAL army is an institution of an ORGANISED state. A neolithic
  // chiefdom keeps only a small warrior band — for a big war it raises a temporary levy
  // instead (conscription, a later stage); a literate, bureaucratic realm fields a large
  // professional army for its size. PRO_ORG_FLOOR = what an org-0 realm fields vs org-1.
  const org = Math.max(0, Math.min(1, (s.knowledge && s.knowledge.organization) || 0));
  f *= T.PRO_ORG_FLOOR + (1 - T.PRO_ORG_FLOOR) * org;
  return f * T.ARMY_SIZE_MULT;   // global garrison-size dial (tuning.js)
}

// ── Periodic: grow + provision garrisons ──
// Pay the standing armies the wages accrued since the last tranche (the rate
// is set by the polity pass's fiscal block — see conquest.js). Solvency is
// the tranche's paid/due, EMA-smoothed so one lean week doesn't read as
// bankruptcy but sustained arrears does.
function payWages(world) {
  if (!world.countries || !world.polities) return;
  for (const c of world.countries.values()) {
    const gov = world.polities.get(c.id);
    if (!gov || gov.endedStep >= 0 || !(gov._wagePerTick > 0)) continue;
    const elapsed = world.step - (gov._lastWagePay ?? world.step);
    gov._lastWagePay = world.step;
    if (elapsed <= 0) continue;
    const due = gov._wagePerTick * elapsed;
    let totalArmy = 0;
    for (const s of c.members) if (s.countryId === c.id && s.army > 0) totalArmy += s.army;
    const paid = Math.min(Math.max(0, gov.treasury), due);
    if (paid > 0 && totalArmy > 0) {
      for (const s of c.members) {
        if (s.countryId !== c.id || !(s.army > 0)) continue;
        const share = paid * (s.army / totalArmy);
        s.wealth = (s.wealth || 0) + share; recordIn(s, IN_STATE_PAY, share);
      }
      gov.treasury -= paid; gov._wagePaidAccum = (gov._wagePaidAccum || 0) + paid;   // folded into the fiscal EMA at the polity pass
    }
    if (due > 0.01) gov._solvency = 0.5 * (gov._solvency ?? 1) + 0.5 * (paid / due);
  }
}

export function musterArmies(world) {
  payWages(world);   // wages flow before the solvency-driven desertion below reads the result
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
      // Standing professional army (org-scaled in armyCapFrac). In WAR the realm also raises
      // a temporary CONSCRIPT levy on top — a slice of the populace called to the colours,
      // scaled by how hard-pressed it is (fighting for the heartland mobilises far harder than
      // nibbling a frontier). Conscripts cost food AND lost farm labour (the famine cycle, see
      // updateFood), and the levy demobilises in peace as the cap drops back to the professional core.
      let frac = armyCapFrac(world, s);
      const c = world.countries && world.countries.get(s.countryId);
      const atWar = c && (world.step - (c._warStamp ?? -1e9)) < CONSCRIPT_WINDOW / (world._dt || 1);   // history-span, like TRUCE_TICKS
      // Defence of the heartland is unconditional; the OFFENSIVE levy is gated by the
      // realm's value-vs-cost war commitment (advanceFronts) — it won't bleed its people
      // for a war it is losing or that isn't worth the cost, unless pride drives it on.
      // The PROFESSIONAL core scales with the settlement's WHOLE population (it is
      // paid from the treasury, raised in town and country alike). The wartime
      // CONSCRIPT levy is a PEASANT levy — it comes from the RURAL countryside, not
      // the towns — so a heavily urbanised realm can mass far fewer conscripts and
      // must lean on its regulars: the historical drift from feudal levy to standing
      // army as cities grow. (Legacy non-DISSOLVE model: _ruralPop is 0, so the levy
      // falls back to the whole populace and this is algebraically unchanged.)
      let popCap = s.people * frac;
      if (atWar) {
        const levyFrac = T.CONSCRIPT_FRAC * Math.min(1, CONSCRIPT_DEF * (c._defLoad || 0) + CONSCRIPT_OFF * (c._offFronts || 0) * (c._warCommit ?? 1));
        // Normalise the rural levy to the pre-industrial baseline (URBAN_BASE_RURAL):
        // a ~90%-rural agrarian realm levies its FULL peasant share (unchanged from
        // the old whole-population levy), and only a realm that urbanises BELOW that
        // baseline loses conscript capacity. Clamp so it never exceeds the populace.
        const levyPop = T.DISSOLVE_FARMS ? Math.min(s.people, (s._ruralPop || 0) / URBAN_BASE_RURAL) : s.people;
        popCap += levyPop * levyFrac;
      }
      // The levy musters in and disbands faster than peacetime recruitment.
      const grow = (atWar || (s.army || 0) > popCap) ? Math.min(0.6, T.ARMY_GROW * MOBILIZE_SPEED) : T.ARMY_GROW;
      s.army = (s.army || 0) + (popCap - (s.army || 0)) * grow;
    }
    // Unpaid troops desert. The army is funded by the state treasury
    // (conquest.js); when the treasury can't cover the wage bill the realm is
    // insolvent (gov._solvency < 1) and its garrisons melt away in proportion
    // to the shortfall — the fiscal-military collapse trigger. (City-states
    // have no treasury and field food-fed militias, so they never go bankrupt.)
    const gov = getPolity(world, s.countryId);
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

  // ── Explicit two-tier national army: PROFESSIONAL core vs CONSCRIPT levy ──────────
  // The standing peacetime cap (armyCapFrac, org-scaled) is the permanent professional
  // core; whatever a realm holds ABOVE it is its temporary wartime conscript levy. Track
  // the two per realm so the panel reads as "regulars + levies" and the national army is
  // an explicit pair, not an emergent sum of garrisons.
  if (world.countries) {
    const proSum = new Map(), conSum = new Map();
    for (const s of world.settlements) {
      if (s.mode !== "settled" || s.countryId < 0) continue;
      const army = s.army || 0;
      const proBase = Math.min(army, s.people * armyCapFrac(world, s));
      proSum.set(s.countryId, (proSum.get(s.countryId) || 0) + proBase);
      conSum.set(s.countryId, (conSum.get(s.countryId) || 0) + (army - proBase));
    }
    for (const [cc, c] of world.countries) { c._armyPro = proSum.get(cc) || 0; c._armyCon = conSum.get(cc) || 0; }
  }
}

// ── Periodic: advance every active war front by tile capture / storm ──
// Navigation below this carries no invasion force — coastal rafts ferry traders,
// not armies. Above it, a port can open amphibious beachheads on the enemy ports
// its sea lanes reach (see the amphibious block in advanceFronts; bar = T.AMPHIB_BAR).
const AMPHIB_NAV_MIN = 0.25;

// A war ends in a treaty once either side's exhaustion crosses this (see the
// truce block in advanceFronts). Below it, low-grade border raiding never
// formally "ends" — the marches stay restless; only real wars sign peaces.
const TRUCE_EXHAUST = 0.4;

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

  // Exhaustion CLOSES fronts (episodic war). The full-scale review found war was
  // permanent — ~165/165 realms fighting at every checkpoint, exhaustion pinned at
  // its cap — because exhaustion only weakened the punch (offMulPair) but never
  // stopped an attack from qualifying, and the scan re-opens every profitable
  // front every pass. Raising the ATTACK BAR with the attacker's exhaustion (last
  // pass's value — it moves slowly) means a worn realm stops pushing, its fronts
  // close, exhaustion decays through a real peace-window, and war turns episodic:
  // campaign → a generation of peace → campaign. Defence is never gated. A warlike
  // realm's aggMul still discounts the bar, so the proud fight on longest.
  // A real COPY (not an alias of world._warExhaust): the bar must read last
  // pass's values even after the update loop below mutates the live map.
  const exhPrev = world._warExhaust ? new Map(world._warExhaust) : null;
  const warBarOf = (cc) => 1 + T.EXHAUST_WAR_BAR * (exhPrev ? (exhPrev.get(cc) || 0) : 0);

  // Casus belli (cohesion.js): a righteous war against a foreign-faith (medieval) or
  // foreign-people (modern) neighbour clears the attack bar more easily; co-religionist
  // / co-national kinship restrains it; a province of the attacker's OWN people under
  // foreign rule is eagerly liberated. Era-weighted → ~neutral in antiquity. The state
  // CORE is the capital's dominant identity, looked up per country once per pass.
  const capOf = new Map();
  if (world.countries) for (const c of world.countries.values()) if (c.capital) capOf.set(c.id, c.capital);
  // Salience per PAIR of belligerents (cohesion.js): the more developed side
  // brings its era's political question to the war — righteous religion
  // between medieval courts, the national cause once either party
  // industrialises — while two ancient rivals fight ancient wars.
  const casusOf = (attCC, defCC, tileOwner) => {
    const A = capOf.get(attCC), D = capOf.get(defCC);
    return casusBelliMul(A, D, tileOwner, identityWeightsFor(world, A, D));
  };
  // A dominant realm projects military power — it attacks on a slimmer margin, so a
  // great power expands by conquest where the pack stalls (Rome, the Mongols).
  const domBarOf = (attCC) => { const c = world.countries && world.countries.get(attCC); const d = c && c._dominance ? c._dominance : 1; return 1 / Math.pow(Math.max(1, d), DOM_ATTACK_P); };
  // A live succession claim on the DEFENDER (dynasties.js world._succClaims) is a casus
  // belli: the claimant's realm presses the throne on a slimmer margin — a war OF
  // succession. Only that specific claimant realm gets the discount, only while the claim
  // window holds; 1 (no effect) for everyone else and whenever CLAIMANT_WARS is off.
  const claimBarOf = (attCC, defCC) => {
    const cl = T.CLAIMANT_WARS && world._succClaims ? world._succClaims.get(defCC) : null;
    return cl && cl.by === attCC && world.step <= cl.until ? CLAIM_BAR : 1;
  };
  const domCaptureOf = (attCC) => { const c = world.countries && world.countries.get(attCC); const d = c && c._dominance ? c._dominance : 1; return Math.pow(Math.max(1, d), DOM_CAPTURE_P); };

  // ── Balance of power (conquest.js updateAlliances) ───────────────────────────
  // The emergent brake on the runaway hegemon, replacing hard anti-runaway caps.
  // When the DEFENDER balances against THIS attacker (it sees the attacker as the
  // regional threat), a COALITION of everyone who fears the same hegemon backs the
  // defence — the attack bar rises in proportion to how big that bloc is RELATIVE to
  // the hegemon (blocMight / hegemonPower). A giant facing a matching coalition stalls;
  // one facing only sparse, fragmented neighbours (no bloc can form) keeps rolling.
  // ALLIES are strongly RELUCTANT to attack each other — a standing bloc holds its
  // internal borders — but not INCAPABLE: an overwhelming intra-bloc imbalance can
  // still erupt (a hard skip froze the top tier into a dead, deathless stalemate;
  // history's coalitions fought internally even while arrayed against a common foe).
  const allianceTarget = world._allianceTarget, blocMight = world._blocMight, countryPow = world._countryPow, alliesMap = world._allies;
  const areAllies = (a, b) => { if (a === b) return false; const s = alliesMap && alliesMap.get(a); return !!(s && s.has(b)); };
  const ALLY_BAR = 4;   // an ally requires ~4× the usual edge before a bloc member breaks ranks to attack it
  const overlordOf = world._overlordOf, overlordReach = world._overlordReach;
  const coalitionBarOf = (attCC, defCC) => {
    let mul = 1;
    if (areAllies(attCC, defCC)) mul *= ALLY_BAR;               // bloc cohesion: hard to fight an ally, not impossible
    if (allianceTarget && allianceTarget.get(defCC) === attCC) {
      const bloc = (blocMight && blocMight.get(attCC)) || 0;
      const hp = (countryPow && countryPow.get(attCC)) || 1;
      mul *= 1 + BALANCE_W * Math.min(BALANCE_CAP, bloc / hp);  // coalition weight backs the threatened member's defence
    }
    // Colonial PROTECTION: the metropole defends its colony — but only with the force its navy
    // can PROJECT across the distance (conquest.js _overlordReach), not its full might. A colony
    // just offshore is shielded by the whole mother country; one an ocean away, barely at all —
    // so an attacker on a remote, weakly-held colony faces little more than the colony itself.
    if (overlordOf) {
      const over = overlordOf.get(defCC);
      if (over != null && over !== attCC) {
        const op = (countryPow && countryPow.get(over)) || 0;
        const hp = (countryPow && countryPow.get(attCC)) || 1;
        const proj = (overlordReach && overlordReach.get(defCC)) || 0;
        mul *= 1 + BALANCE_W * Math.min(BALANCE_CAP, (op / hp) * proj);
      }
    }
    return mul;
  };

  // Wars END IN A PEACE (dyadic truces). The exhaustion bar alone could not break
  // the permanent-war equilibrium because it is MUSICAL CHAIRS: exhaustion stops a
  // realm attacking, but someone nearby is always rested, and the rested attack the
  // worn — so every realm stays under assault and pinned at max exhaustion. What
  // history has that a fade-out lacks: a war ends in a TREATY that binds BOTH sides
  // for a generation. When a war has worn either side past TRUCE_EXHAUST, the pair
  // signs a truce for T.TRUCE_TICKS: neither can open a front on the other until it
  // lapses. Low-grade border skirmishing (load too light to exhaust) never truces —
  // the marches stay restless, as they were — but the big wars become episodic.
  let truces = world._truces; if (!truces) truces = world._truces = new Map();
  if (truces.size) for (const [k, until] of truces) { if (until <= world.step) truces.delete(k); }
  const inTruce = (a, b) => {
    if (truces.size === 0 || a < 0 || b < 0) return false;
    const u = truces.get(a < b ? a + ":" + b : b + ":" + a);
    return u !== undefined && u > world.step;
  };
  // A suzerain and its dependency never open fronts on each other — read LIVE
  // from the overlord map (a submission mid-window must stop the war NOW), not
  // from the amortised _allies rebuild, whose staleness let a hegemon keep
  // sacking a statelet that had already bent the knee.
  const ovFr = world._overlordOf;
  const bondedCC = (a, b) => !!ovFr && (ovFr.get(a) === b || ovFr.get(b) === a);

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
      if (!A || A.mode !== "settled" || A.countryId === D.countryId
          || inTruce(A.countryId, D.countryId)
          || bondedCC(A.countryId, D.countryId)) continue;   // a signed peace holds; a suzerain-vassal bond holds harder
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
    if (A._M < effDef * T.ATTACK_MIN_RATIO * aggMul * (1 + tf * TRADE_PEACE_MAX) * warBarOf(A.countryId) * casusOf(A.countryId, D.countryId, D) * claimBarOf(A.countryId, D.countryId) * domBarOf(A.countryId) * coalitionBarOf(A.countryId, D.countryId)) continue;
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

  // ── Amphibious assault (nav-gated beachheads) ──────────────────────────
  // The scan above pairs only TILE-ADJACENT enemies, so war could never cross
  // water: a populated far shore was unconquerable however dominant the navy
  // (no Punic Wars, no crossing into the Balkans — cross-sea empire was limited
  // to colonising wilderness). A port that can SAIL to an enemy port — the same
  // sea-lane web the carrying trade uses; you invade where you can sail — opens
  // a BEACHHEAD front: the defender's water-edge tiles become contestable as if
  // adjacent, and a beach inside the city's assault radius lets the port itself
  // be stormed from the sea. Gates: real seacraft (nav ≥ AMPHIB_NAV_MIN — rafts
  // don't carry armies), an embarked army, and a power bar T.AMPHIB_BAR× the
  // usual land threshold (an opposed landing wants overwhelming superiority).
  // From the beachhead on, the normal front machinery — national field armies,
  // concentration, exhaustion, reinforcement sailing — grinds inland or is
  // thrown back, exactly as on land.
  if (T.AMPHIB_BAR > 0) {
    const amphibByDef = new Map();   // defender id → pending beachhead pairs onto it
    for (const A of world.settlements) {
      if (A.mode !== "settled" || !A._seaReach || A._seaReach.size === 0) continue;
      if (!(A._M > 0)) continue;
      if (((A.knowledge && A.knowledge.navigation) || 0) < AMPHIB_NAV_MIN) continue;
      const aCountry = world.countries && world.countries.get(A.countryId);
      const aggMul = aCountry && aCountry.personality ? aggressionAttackMul(aCountry.personality) : 1;
      for (const pid of A._seaReach.keys()) {
        const D = byId.get(pid);
        if (!D || D.mode !== "settled" || D.countryId === A.countryId
            || inTruce(A.countryId, D.countryId)
            || bondedCC(A.countryId, D.countryId)) continue;   // a signed peace holds at sea too; so does the suzerain-vassal bond
        const key = A.id + ":" + pid;
        if (pairs.has(key)) continue;                        // already met on land
        const tf = tradeFactor(A.countryId, D.countryId);
        if (A._M < D._M * T.ATTACK_MIN_RATIO * aggMul * (1 + tf * TRADE_PEACE_MAX) * T.AMPHIB_BAR * warBarOf(A.countryId) * casusOf(A.countryId, D.countryId, D) * claimBarOf(A.countryId, D.countryId) * domBarOf(A.countryId) * coalitionBarOf(A.countryId, D.countryId)) continue;
        const pc = { att: A, def: D, tiles: [], canStorm: false, _key: key };
        let l = amphibByDef.get(pid); if (!l) amphibByDef.set(pid, l = []);
        l.push(pc);
      }
    }
    if (amphibByDef.size) {
      // One territory scan: collect each targeted defender's WATER-EDGE tiles
      // (the landing beaches), with the same home-distance / storm-radius /
      // capture-grace rules as the land scan.
      const elevA = world.elev;
      for (let ti = 0; ti < N; ti++) {
        const d = owner[ti];
        if (d < 0) continue;
        const cands = amphibByDef.get(d); if (!cands) continue;
        const ty = (ti / tw) | 0, tx = ti - ty * tw;
        const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
        const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
        let beach = false;
        for (let k = 0; k < 4; k++) { const ni = ns[k]; if (ni >= 0 && elevA[ni] <= 0) { beach = true; break; } }
        if (!beach) continue;
        const D = byId.get(d);
        const dh = D._homeTi, dhy = (dh / tw) | 0, dhx = dh - dhy * tw;
        let ddx = Math.abs(tx - dhx); if (ddx > tw / 2) ddx = tw - ddx;
        const ddy = ty - dhy;
        const distHome = Math.sqrt(ddx * ddx + ddy * ddy);
        const assaultDist = coreRadiusFor(D) + ASSAULT_MARGIN;
        for (const pc of cands) {
          if (distHome <= assaultDist) pc.canStorm = true;   // the port city fronts the water — stormable from the sea
          else if (world.step - capturedAt[ti] >= T.TILE_CAPTURE_GRACE) pc.tiles.push({ ti, distHome });
        }
      }
      for (const cands of amphibByDef.values())
        for (const pc of cands)
          if (pc.canStorm || pc.tiles.length) pairs.set(pc._key, pc);
    }
  }

  // Stamp each
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
  // New WARS (a pair newly at serious blows since the last pass) get a cause-
  // annotated event: the structured log records WHY this war was plausible —
  // a succession crisis in the victim, a clash of state faiths, the
  // attacker's temperament — so later historiography has motives to cite.
  {
    // Hysteresis: a front that pauses and re-forms within living memory is
    // the SAME war, not a new one — log war.began only for genuinely fresh
    // (or long-dormant) pairs.
    const WAR_MEMORY = 900;
    if (!world._warSeenAt) world._warSeenAt = new Map();
    const seen = world._warSeenAt;
    for (const [defId, set] of fronts) for (const attId of set) {
      const key = attId + ":" + defId;
      const last = seen.get(key);
      seen.set(key, world.step);
      if (last !== undefined && world.step - last < WAR_MEMORY / (world._dt || 1)) continue;
      const pa = _getPolity(world, attId), pd = _getPolity(world, defId);
      const fa = pa ? pa.faithId : -1, fd = pd ? pd.faithId : -1;
      const pers = pa && pa.personality;
      logEvent(world, "war.began", {
        from: attId, to: defId,
        name: realmName(world, attId), defName: realmName(world, defId),
        crisis: inCrisis(world, defId) ? 1 : 0,
        claim: (T.CLAIMANT_WARS && world._succClaims && (world._succClaims.get(defId) || {}).by === attId) ? 1 : 0,
        faithClash: fa >= 0 && fd >= 0 && fa !== fd ? 1 : 0,
        aggression: pers ? +(pers.aggression || 0).toFixed(2) : 0,
      });
      if (pa) pa._reignWars = (pa._reignWars || 0) + 1;   // a war of the reigning ruler's making (epithet deeds)
    }
    if (seen.size > 4000) {   // prune stale pairs so the map can't grow unbounded
      for (const [k, st] of seen) if (world.step - st > (WAR_MEMORY * 3) / (world._dt || 1)) {
        seen.delete(k);
        if (world._warDead && world._warDead.has(k)) closeWar(world, k, "faded");   // no peace was signed — the war petered out (a side died, fronts dissolved)
      }
    }
  }
  // (Siege relief is no longer a marching column — the conserved defensive allocation
  // already brings the realm's spare field army to bear on a besieged front.)

  // ── National war capacity ──────────────────────────────────────────────
  // Inter-state war is NOT a duel between two frontier garrisons — it is decided by
  // NATIONAL FIELD ARMIES (natMight = Σ garrison×tech, capped by manpower + treasury).
  // Per realm, tally the distinct enemy NATIONS it is engaged with — offensive fronts
  // (it is attacking) vs defensive load/attackers (it is assaulted). These feed the
  // CONSERVED ALLOCATION below: a realm's one finite army is split across all its fronts
  // (offence + defence, shares summing to one), so a border town's garrison decides
  // nothing in the open field — only the national army's share on that front does.
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
  // Sign the peaces: any warring pair where EITHER side has been worn past
  // TRUCE_EXHAUST ends in a truce binding BOTH for T.TRUCE_TICKS (header above).
  // Stateless raiders (countryId < 0) sign nothing — the wild marches stay wild.
  if (T.TRUCE_TICKS > 0) {
    // Peace terms are emergent state, not a flat cooldown:
    //  * DURATION scales with the pair's mutual trade (world._tradePairs,
    //    tallied from the live cross-border money flows): war between heavy
    //    trading partners interrupts profitable exchange, so their merchants
    //    fund a durable settlement — an integrated late-game world signs
    //    LONG peaces while subsistence antiquity stays endemic-warlike.
    //    This is the brake on late-game all-pairs war saturation.
    //  * INDEMNITY: a clearly-beaten side (one-sided exhaustion) pays
    //    reparations from its treasury — a conserved transfer, so losing a
    //    war has a fiscal bill beyond the wage book.
    //  * CONGRESS: when a pair settles, any third belligerent of either side
    //    already worn near the truce bar joins the settlement — wars end at
    //    conferences, not dyad by dyad.
    const pairTrade = world._tradePairs;
    // "Heavily interdependent" is measured against the era's OWN median
    // pair-trade — self-calibrating across eras, maps and money supplies
    // (an absolute coin threshold would mean nothing in both 3000 BC and 1900).
    let tradeRef = 1e-6;
    if (pairTrade && pairTrade.size) {
      const vs = [...pairTrade.values()].sort((x, y) => x - y);
      tradeRef = Math.max(1e-6, 2 * vs[vs.length >> 1]);
    }
    const signPeace = (a, b) => {
      const key = Math.min(a, b) + ":" + Math.max(a, b);
      if ((truces.get(key) || 0) > world.step) return false;   // already at peace
      const trade = pairTrade ? (pairTrade.get(key) || 0) : 0;
      const tradeW = Math.min(1, trade / tradeRef);
      const dur = (T.TRUCE_TICKS * (1 + TRADE_PEACE_W * tradeW)) / (world._dt || 1);
      truces.set(key, world.step + dur);
      closeWar(world, key, "truce");   // the war's dead are reckoned at the peace
      // reparations from the clearly-beaten side, proportional to how
      // one-sided the exhaustion is and bounded by what it can actually pay
      const eA2 = exh.get(a) || 0, eB2 = exh.get(b) || 0;
      const gap = Math.abs(eA2 - eB2) / Math.max(1e-6, TRUCE_EXHAUST);
      if (gap > 0.25) {
        const loser = eA2 > eB2 ? a : b, winner = eA2 > eB2 ? b : a;
        const lg = getPolity(world, loser), wg = getPolity(world, winner);
        if (lg && wg && (lg.treasury || 0) > 0) {
          const pay = Math.max(0, lg.treasury) * INDEMNITY_FRAC * Math.min(1, gap);
          lg.treasury -= pay; wg.treasury = (wg.treasury || 0) + pay;
          logEvent(world, "war.indemnity", { polity: loser, name: realmName(world, loser),
            to: winner, toName: realmName(world, winner), amount: Math.round(pay) });
        }
      }
      return true;
    };
    for (const [cc, es] of allEnemies) {
      if (cc < 0) continue;
      const eA = exh.get(cc) || 0;
      for (const ecc of es) {
        if (ecc <= cc || ecc < 0) continue;          // each pair once
        if (eA >= TRUCE_EXHAUST || (exh.get(ecc) || 0) >= TRUCE_EXHAUST) {
          if (!signPeace(cc, ecc)) continue;
          // the congress: exhausted co-belligerents of either side settle too
          for (const side of [cc, ecc]) {
            const others = allEnemies.get(side);
            if (!others) continue;
            for (const third of others) {
              if (third < 0 || third === cc || third === ecc) continue;
              if ((exh.get(third) || 0) >= TRUCE_EXHAUST * CONGRESS_JOIN
                  || (exh.get(side) || 0) >= TRUCE_EXHAUST) signPeace(side, third);
            }
          }
        }
      }
    }
  }

  // A front's offensive EFFICIENCY (0..1) — concentration rank × rest, pinned by
  // defensive load. Retained only for the info panel / war-commitment proxy below;
  // the FORCE that decides a front is the conserved allocation (next block).
  const concRestTied = (acc, dcc) => {
    const m = attNat.get(acc); const f = m && m.get(dcc);
    const tied = 1 + T.WAR_DEFENSE_DRAG * (defLoad.get(acc) || 0);
    const rested = 1 - Math.min(0.9, exh.get(acc) || 0);
    return (f ? f.conc : 1) * rested / tied;
  };

  // ── Conserved national army allocation (the grounded field-army model) ───────
  // The NATIONAL FIELD ARMY is the force that decides a war — not the border garrison
  // (natMight = Σ garrison×tech, itself capped by MANPOWER and the treasury). But it is
  // ONE FINITE POOL: a realm cannot throw its whole strength at every front at once. It
  // SPLITS the army across the wars it fights — offensive AND defensive together — by
  // priority: defence of the heartland first, then the concentrated main offensive effort,
  // secondary fronts merely held. The shares SUM TO ONE, so the army is genuinely divided,
  // not multiplied: a realm fighting two wars halves its weight on each; a realm whose
  // capital is besieged pours most of its army into defence and has little left to expand.
  // No more double-spending the same army on offence and defence (the old offMul/defShare
  // multipliers each drew on the full pool). War-exhaustion scales the EFFECTIVE pool (a
  // worn army fights at a fraction), and battle casualties drain the manpower pool, so a
  // big war leaves a realm weak for a generation (musterArmies). For a clean 1-v-1 war the
  // shares are 1.0 on each side — identical to the old model; conservation bites only when
  // a realm is stretched across several fronts, which is exactly where it should.
  const DEF_PRIORITY = 2.5;   // a SERIOUS defensive front (a town under storm) commands this × an equal offensive main effort — a realm defends its heartland before it expands
  const offW = new Map();     // "A:D" → A's offensive weight against D (concentration rank, ≤1)
  const defW = new Map();     // "D:A" → D's defensive weight vs attacker A (already priority-scaled)
  for (const [acc, m] of attNat) for (const [dcc, f] of m) offW.set(acc + ":" + dcc, f.conc);
  for (const pc of pairs.values()) {
    const acc = pc.att.countryId, dcc = pc.def.countryId; if (acc === dcc) continue;
    const dc = world.countries && world.countries.get(dcc);
    const isCap = !!(dc && dc.capitalId === pc.def.id);
    // A SERIOUS siege (a town being stormed) commands the national field army with priority;
    // a mere border skirmish is held by the local garrison and barely competes with the
    // realm's own offensives — so it must NOT tie down half the army the way a siege does.
    const w = pc.canStorm ? DEF_PRIORITY * (isCap ? 1.6 : 1.0) : 0.4;
    const k = dcc + ":" + acc;
    defW.set(k, (defW.get(k) || 0) + w);
  }
  // Each realm's TOTAL committed weight = Σ its offensive efforts + Σ its (priority-scaled) defensive efforts.
  const totW = new Map();
  const addW = (cc, w) => totW.set(cc, (totW.get(cc) || 0) + w);
  for (const [k, w] of offW) addW(+k.slice(0, k.indexOf(":")), w);
  for (const [k, w] of defW) addW(+k.slice(0, k.indexOf(":")), w);
  // Effective pool: the national field army, worn down by war-exhaustion.
  const effPool = (cc) => (natMight.get(cc) || 0) * (1 - Math.min(0.9, exh.get(cc) || 0));
  // The force a realm actually commits to one front — its pool × that front's share of its
  // total weight. Sum over a realm's fronts = its whole pool (the conservation).
  const offForceOf = (acc, dcc) => { const W = totW.get(acc) || 0; if (W <= 0) return 0; return ((offW.get(acc + ":" + dcc) || 0) / W) * effPool(acc); };
  const defForceOf = (dcc, acc) => { const W = totW.get(dcc) || 0; if (W <= 0) return effPool(dcc); return ((defW.get(dcc + ":" + acc) || 0) / W) * effPool(dcc); };

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
    const attForce = offForceOf(acc, dcc);             // A's share of its finite army on THIS front
    const em = encMulOf(def);                          // <1 if the defender is pressed from several sides
    const defForce = defForceOf(dcc, acc);             // D's share of its finite army defending THIS front
    const adv = attForce / Math.max(1, defForce * em);

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
      const advCity = attForce / Math.max(1, (defForce + defHome) * em);
      // A recently-conquered city is still pacified (garrisoned) and can't be
      // besieged yet — that grace stops rival empires trading it back and forth.
      if (advCity >= T.CITY_STORM_RATIO && world.step - (def._conqueredAt ?? -Infinity) >= T.CONQUEST_GRACE) {
        // Bombard: grind the garrison; the besiegers bleed against the defence
        // they actually face (the militia floor, not the melted garrison).
        {
          const dDef = Math.min(def.army || 0, att._M * SIEGE_DMG);
          const dAtt = Math.min(att.army || 0, defHome * T.ATTRITION / techMul(att));
          def.army = (def.army || 0) - dDef;
          att.army = (att.army || 0) - dAtt;
          tallyDead(world, att.countryId, def.countryId, dDef + dAtt);
        }
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
          // Record the storm as a structured event. Names are captured at
          // event time so the log reads as contemporaries knew the actors.
          {
            const dName = def.name || "a settlement";
            const toName = realmName(world, att.countryId);
            if (defWasCapital && oldId >= 0) {
              logEvent(world, "polity.shattered", { polity: oldId, to: att.countryId, toName,
                s: def.id, sName: dName, x: def.pos.x | 0, y: def.pos.y | 0 });
            } else {
              logEvent(world, "settlement.captured", { s: def.id, sName: dName, tier: def.tier | 0,
                from: oldId, fromName: oldId >= 0 ? realmName(world, oldId) : undefined,
                to: att.countryId, toName, x: def.pos.x | 0, y: def.pos.y | 0 });
            }
          }
          if (world.debug && world.debug.land) { world.debug.land.conquest++; const g = world.debug.land.gain; g.set(att.countryId, (g.get(att.countryId) || 0) + 1); }
          def._conqueredAt = world.step;
          def._sackedAt = world.step;   // stormed by force — production penalty in computeExportValue
          // Captives: the sack of a city carries off part of its people into bondage —
          // war as the primary supply of the slave trade (the captor sells/works them).
          if (T.SLAVERY && T.CAPTURE_FRAC > 0 && (def.people || 0) > 0) {
            const taken = (def.people || 0) * T.CAPTURE_FRAC;
            def.people -= taken; att._captives = (att._captives || 0) + taken;
          }
          def.loyalty = 0.35;   // a fresh conquest starts restless (conquest.js)
          def._ambition = 0;    // a freshly subdued city isn't plotting (yet)
          def.unrest = 0;       // the conquered populace is cowed for now
          // Spoils of war ease the victor's war-weariness (conquest.js unrest).
          const ag = getPolity(world, att.countryId);
          if (ag) ag._spoils = Math.min(2, (ag._spoils || 0) + WAR_SPOILS);
          // PLUNDER: a sack strips a share of the city's portable coin into the
          // victor's war chest — a conserved TRANSFER (the old model left every
          // stormed city's wealth untouched, so conquest paid nothing and war
          // had no fiscal upside to weigh against its wage bill). The fraction
          // means "the share of coin that is seizable in a sack"; the rest is
          // hidden, buried, or not coin at all.
          if (ag && (def.wealth || 0) > 0) {
            const plunder = (def.wealth || 0) * PLUNDER_FRAC;
            def.wealth -= plunder;
            ag.treasury = (ag.treasury || 0) + plunder;
          }
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
          tallyDead(world, att.countryId, oldId, (att.army || 0) * ASSAULT_ARMY_COST + (def.army || 0) * 0.7);
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

    const domCap = domCaptureOf(acc);   // a dominant realm sweeps more countryside per pass (Mongol-style blitz)
    const budget = Math.min(Math.round(T.MAX_CAPTURE * domCap), Math.floor((adv - 1) * CAPTURE_SCALE * domCap));
    if (budget >= 1 && pc.tiles.length) {
      // Advance the front BROADLY: take the outermost contested tiles first
      // so the defender's countryside erodes ring by ring (visible) instead
      // of a thin salient spiking straight to the capital. Tile lists were
      // collected in one pre-pass scan, so a tile can appear in TWO attackers'
      // lists — re-check it still belongs to this defender before flipping,
      // or the second attacker double-captures it (and double-banks momentum).
      pc.tiles.sort((p, q) => q.distHome - p.distHome);
      let captured = 0;
      for (let i = 0; i < pc.tiles.length && captured < budget; i++) {
        const cti = pc.tiles[i].ti;
        if (owner[cti] !== def.id) continue;   // already taken earlier this pass
        owner[cti] = att.id; capturedAt[cti] = world.step; captured++;
      }
      if (captured > 0) bankMomentum(world, att.countryId, captured * MOMENTUM_PER_TILE);   // captured countryside feeds the streak
    }
    {
      const dAtt = Math.min(att.army || 0, def._M * T.ATTRITION / techMul(att));
      const dDef = Math.min(def.army || 0, att._M * T.ATTRITION / techMul(def));
      att.army = (att.army || 0) - dAtt;
      def.army = (def.army || 0) - dDef;
      tallyDead(world, att.countryId, def.countryId, dAtt + dDef);
    }
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

      // ── Value-vs-cost war calculus (offensive commitment) ──────────────────
      // How hard A will press its wars of CHOICE (defence of the homeland is
      // unconditional). It weighs the PRIZE — an expansionist/warlike realm values
      // conquest, but only while it's WINNING (its national-army ratio over its main
      // foe), and a winning streak (momentum) inflates that — against the COST:
      // war-exhaustion plus a drained manpower pool. A proud/WARLIKE realm DISCOUNTS
      // the cost and fights a ruinous war on (the sunk-cost trap); a MERCANTILE one
      // feels it fully and cuts its losses. Low commit ⇒ it stops conscripting for the
      // offensive (musterArmies) — the campaign withers to a de-facto peace.
      const p = c.personality;
      if (p && m && m.size) {
        let topE = -1, topPrio = -Infinity;
        for (const [dcc, f] of m) if (f.prio > topPrio) { topPrio = f.prio; topE = dcc; }
        const winning = Math.min(2, (natMight.get(cc) || 0) / Math.max(1, natMight.get(topE) || 0));
        // a bold ruler presses wars of choice; a timid one holds back (dynasties.js c._rulerWar)
        const appetite = Math.max(0, Math.min(1, (0.35 + 0.4 * (p.expansionism || 0) + 0.3 * (p.aggression || 0)) * (c._rulerWar || 1)));
        const gov = getPolity(world, cc);
        const mom = Math.min(1, ((gov && gov._momentum) || 0) / Math.max(1, T.MOMENTUM_CAP || 1));
        const mpR = c._manpowerCap > 0 ? (c._manpower || 0) / c._manpowerCap : 1;
        const weariness = (exh.get(cc) || 0) + (1 - mpR);                                   // war-weariness + bled white
        const sunkBlind = Math.max(0, Math.min(1, 0.5 + 0.5 * (p.aggression || 0) - 0.4 * (p.commerce || 0)));
        c._warCommit = Math.max(0, Math.min(1.3, appetite * winning * (1 + 0.5 * mom) - weariness * (1 - sunkBlind)));
      } else c._warCommit = 1;
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
