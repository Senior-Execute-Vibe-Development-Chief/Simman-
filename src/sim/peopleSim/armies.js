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
import { tel, telPass } from "./telemetry.js";
import { resScaleFor } from "./countryTerritory.js";
import { techEff, URBAN_BASE_RURAL, recordCaptives } from "./settlement.js";
import { slavePull } from "./slavery.js";
import { fragmentRealm, bankMomentum, MOMENTUM_PER_TILE, MOMENTUM_PER_STORM, recordOccupation, BALANCE_W, BALANCE_CAP, bendTheKnee } from "./conquest.js";
import { ridgeHoldAt, refugeHoldAt, RIVER_DEF_W, RIVER_DEF_ENG, ALPINE_DEF_BASE, ALPINE_DEF_SLOPE, ALPINE_DEF_ENG, TERRAIN_DEF_CAP } from "./transport.js";
import { aggressionAttackMul, aggressionArmyMul } from "./personality.js";
import { identityWeightsFor, casusBelliMul } from "./cohesion.js";
import { realmName } from "./chronicle.js";
import { inCrisis } from "./dynasties.js";
import { getPolity as _getPolity } from "./entities.js";
import { logEvent } from "./events.js";
import { getPolity } from "./entities.js";
import { T, rNormPop } from "./tuning.js";
import { recordIn, IN_STATE_PAY } from "./money.js";
import { feedGrievance, SACK_GRIEV_FRAC } from "./loyaltyField.js";
import { fieldShift } from "./popField.js";
import { forEachNear } from "./spatialGrid.js";

// Army size is gated by TIER and FOOD, not coin. A garrison is a slice of
// population (capped by tier — villages keep a token watch, cities/capitals
// field real armies). The garrison also EATS (provisioning, in updateFood),
// so a settlement that can't cover that food drains its granary and the army
// DESERTS — you can't field more troops than you can feed. Coin upkeep is now
// a small secondary cost (pay/equipment), not the binding constraint.
const ARMY_TIER_FRAC = [0.02, 0.05, 0.09, 0.11].map(f => f * 1.075);  // garrison cap as fraction of pop, by tier.
// Tier-C C1 deflation audit: a FRACTION, not an absolute bar — per-label
// garrisons shrink as label supply divides the census, but label count rises
// in step, so Σ garrison ≈ frac × Σ census stays supply-invariant; the
// thresholds that consume garrisons are the 85th-percentile fortRef and the
// smoothed median _musterRatio (below), both rank/median reads that
// self-recalibrate with entity count (verified at the C1 flip, not re-anchored).
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
const TOLL_GREAT     = 0.03;  // the toll (war dead / the belligerents' combined people) at which a war reads as GREAT — ~3% of a population dead is the recorded scale of the wars that bought generation-long peaces; the T.TRUCE_TOLL duration term saturates here
const CONGRESS_JOIN  = 0.75;  // a third belligerent already worn past this fraction of TRUCE_EXHAUST joins the settlement (wars end at conferences, not dyad by dyad)
// Frozen-front settlement (T.STALEMATE_TICKS, the status-quo peace): the war's front
// DISPLACEMENT is a signed per-pass tile exchange folded into an EMA; the war reads
// as frozen when that velocity sits under STALE_EPS for a full window. Signed on
// purpose — a two-sided front trading the same border tiles nets to zero (the line
// is not moving), while a persistent one-directional advance stays high.
const MOVE_EMA_KEEP = 0.8;    // EMA memory per war pass (~5-pass ≈ a campaign season's smoothing)
const STALE_EPS     = 0.75;   // displacement velocity (net tiles/pass, smoothed) below which the line reads as frozen

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
// ── War-throughput instrumentation (opt-in — tools/probe_warbars.mjs) ────────
// world.debug.war = mkWarDebug() turns on per-pass counters: each candidate
// attacker→defender pair's most permissive tile is kept and, if rejected,
// attributed to the single PIVOTAL bar factor (the largest one whose removal
// alone would have let the front open) — or "parity" (raw power short even
// bare) or "stack" (only the combination rejects). Truce-blocked pairs and
// every war ending (how / duration / exhaustion / age) are tallied too.
// Null by default: zero cost, and the instrumented bar product is hoisted
// verbatim (same IEEE multiply chain), so normal runs are byte-identical.
export function mkWarDebug() {
  return { step: -1, pairs: new Map(), trucePairs: new Set(), signed: [],
           tot: { cand: 0, opened: 0, truceBlocked: 0, parity: 0, stack: 0,
                  agg: 0, trade: 0, amphib: 0, war: 0, casus: 0, claim: 0, dom: 0, coal: 0, warsStarted: 0 } };
}
export function foldWarDebug(W) {
  if (!W || !W.pairs) return;
  for (const r of W.pairs.values()) {
    W.tot.cand++;
    if (r.passed) { W.tot.opened++; continue; }
    if (r.attM < r.base) { W.tot.parity++; continue; }
    let piv = null, pivV = 1;
    for (const k in r.f) { const v = r.f[k]; if (v > 1 && r.minBar / v <= r.attM && v > pivV) { piv = k; pivV = v; } }
    if (piv) W.tot[piv]++; else W.tot.stack++;
  }
  W.tot.truceBlocked += W.trucePairs.size;
  W.pairs.clear(); W.trucePairs.clear();
}
const wdbgPass = (W, step) => { if (W.step !== step) { foldWarDebug(W); W.step = step; } };

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
// T.WAR_FINISH — SIEGES LIFT (the consolidation battery's verdict,
// docs/consolidation-2026-08-20.md). The grind above gave the DEFENDER a
// clock (SIEGE_STARVE: the granary) but the BESIEGER none — a camp sat for
// free until the walls broke, so over enough passes every siege succeeded
// (per-roll p→1) and the register boiled (measured: ~2,700 realm deaths per
// 4k steps at 32k, every capital cycling ~1,000 steps). History's camps had
// the SHORTER clock: a stationary host eats out its district in weeks, then
// dysentery, arrears and the harvest break it — most sieges FAILED. So a
// siege is a RACE between the city's granary and the camp's endurance:
// base endurance ≈ a campaign season-to-year for an unsupplied host,
// stretched by the attacker's logistics tech (the same commissariat channel
// that stretches projection and administrative reach) — a bronze-age levy
// goes home at harvest, Rome sits out Carthage. When the camp's clock runs
// out first the siege LIFTS and the campaign ends in the treaty machinery
// below (signPeace: trade/toll-scaled truce, indemnity, congress) — failed
// campaigns produce PEACE, not an eternal front. One exception: a city
// already starving (granary broken) is on the eve of the breach — no camp
// lifts then; the race has resolved. Rides T.WAR_FINISH; inert at lever 0.
const SIEGE_ENDURE      = 150;   // ticks an unsupplied host sustains a static camp (~a season-to-year at the TRUCE_TICKS=1500≈generation span)
const SIEGE_ENDURE_LOGI = 3;     // a mature commissariat sustains ×(1+this·logistics) — multi-year investments at logistics 1
// T.WAR_FINISH — THE WORKS TAKE A SEASON. A wall is never carried the
// afternoon the army arrives: circumvallation, ramps, towers, mining — the
// engineering that turns an investment into a breach — is months of labour
// at the fastest (Alesia ~2 months, Masada ~3, Tyre 7; a year-plus is
// ordinary). The break test below therefore also requires the CONTINUOUS
// siege (the same camp clock the endurance race reads) to be at least this
// old, so every successful storm costs the besieger real presence — during
// which relief, exhaustion, the treasury and the camp's own endurance all
// get their say. Without it, 76-89% of storms that reached assault strength
// broke the walls the SAME 50-tick pass (measured, v1-v2 arms) and conquest
// ran at the war-pass cadence instead of history's.
const SIEGE_WORKS       = 60;    // ticks of standing siege before a breach is even possible (~a year at the generation span)
// T.WAR_FINISH — SIEGE MOBILIZATION (the militia's stale-fraction bug, v2
// arm): HOME_MILITIA_FRAC (0.035) was tuned when the militia base was the
// CATCHMENT census; the urban-walls re-basing onto _urbanPop (5-20× smaller)
// silently cut every militia to a twentieth of its calibrated strength — the
// same-pass storm breaks were armies beating skeleton crews. A besieged city
// arms its able-bodied — the siege levée history records at ~a fifth of the
// urban population (Tyre, Jerusalem, Constantinople man the whole circuit) —
// which also lands the militia back at the absolute scale the catchment
// fraction was producing. Lever 0 keeps the catchment fraction byte-identically.
const SIEGE_MOBILIZE    = 0.20;  // able-bodied share of the URBAN core that mans its own walls under siege

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
// ── Fortress zone of control (the tile-war role of a walled town) ─────
// A walled, manned strongpoint dominates the ground around it: the
// defender's tiles within its shadow resist at a multiple, decaying with
// distance — so fronts stall at fortress lines (the limes, the march
// castles, the bastide belts) until the attacker masses what a siege
// really took, instead of flowing around militarily-transparent towns.
// Gated on the walls ABILITY (the masonry tech); magnitude = the walls
// level (defense channel — which gunpowder erodes, ending the castle age
// per-theatre) × how MANNED the place is (garrison vs reference). This is
// what a garrison/march town is FOR: before it, a non-capital settlement
// decided nothing locally — national armies fight the open field, only
// capitals are stormed, and towns flipped with their ground without a
// fight (measured/owner-reviewed 2026-07: "do garrison towns make
// sense?" — they didn't, yet).
const FORT_R            = 3;    // REFERENCE-tiles of shadow (×rNormPop at use)
const FORT_W            = 2.0;  // peak added defense multiple at the fortress itself, fully walled + manned
// The garrison at which walls count as fully manned / a base stages at full
// capacity is NOT a constant any more: it is derived each war pass from the
// age's own garrison scale (see fortRef in advanceFronts — the 85th-percentile
// settled garrison, T.FORT_GARRISON_REF > 0 restores the legacy absolute). The
// old absolutes (40 manned / 5 base-minimum) were tuned to the pre-Tier-B3
// phantom-fish population, ~5× the honest scale that food wave landed: at
// honest garrisons of ~2-10 nothing ever qualified as a forward base (force
// projection collapsed to capital-only decay) and no wall ever counted manned
// past the 0.4 floor — the same stale-absolute class as TIER_SCALE_REF.
const BASE_OF_REF       = 0.125;   // a post stages as a BASE at an eighth of a manned fortress's complement (the legacy 5-of-40 watch→base share)
function homeMight(s) {
  const morale = Math.max(MILITIA_MORALE_FLOOR, (s.loyalty ?? 1) - 0.5 * (s.unrest || 0));
  // T.WAR_FINISH — THE WALLS ARE MANNED BY THE CITY, NOT THE PROVINCE. Under
  // ONE_POP `s.people` is the CATCHMENT census (city + the countryside it
  // works — CLAUDE.md's own repeated trap, caught here a fourth time), so the
  // militia floor priced every storm against the whole province's men: the
  // variance arc measured 370/370 sieges failing on it and treated the symptom
  // with starvation; at the shipped statelet grid the storm funnel still reads
  // 7 falls in 11,597 attempts. History mans the ramparts with the people who
  // live inside them — the URBAN core (the honest `_urbanPop` the LAND_KNOW
  // wave measured, ~12k for a typical ancient city) — while the countryside
  // is what the besieger forages. Lever 0 (and any regime without the urban
  // read) keeps the catchment militia byte-identically.
  const militia = T.WAR_FINISH && s._urbanPop != null
    ? s._urbanPop * SIEGE_MOBILIZE * morale        // the siege levée: the core arms its able-bodied (header at SIEGE_MOBILIZE)
    : (s.people || 0) * T.HOME_MILITIA_FRAC * morale;
  const walls = 1 + WALL_W * Math.max(0, techEff(s).defenseLevel || 0);
  return Math.max(s.army || 0, militia) * techMul(s) * walls;
}

// ── Force projection decays with distance (T.WAR_REACH, TILE_WAR only) ────────
// The §4c-designed locality the tile-war launched without: under TILE_WAR every
// combatant is a NATION whose whole field army meets every battle — so a realm
// projects FULL national might at every tile of its frontier simultaneously,
// however far from its capital. Measured consequence (probe_empires,
// docs/empire-consolidation-2026-07.md): nobody ever clears the front bar
// against a 10-20×-dominant realm anywhere on its border, the top realms sit at
// ZERO defensive fronts, their capitals are never approached, and the top-5 are
// IMMORTAL over whole runs. With projection decay, strength is local: effective
// might at a battlefield = national might × exp(−d/H), d = distance from the
// realm's own capital, H = WAR_REACH reference-tiles (resolution-scaled),
// stretched by logistics tech ×(1 + PROJ_LOGI·logisticsLevel) — the same
// roads→rail channel (and weight) that stretches administrative reach
// (countryTerritory.js LOGI_REACH), so armies and administration ride one
// logistics truth, emergently, never a date. EXPONENTIAL because supply-line
// loss is per-march-day MULTIPLICATIVE: each day out, the train consumes/loses
// a constant FRACTION of what it can deliver (the classical logistics of the
// Macedonian army), so deliverable force compounds down with distance — the
// only shape that lets a modest power at its own doorstep out-project a
// many-times-larger empire's far frontier (a ratio gate that a hyperbolic tail
// never inverts). A giant's far periphery is then defended (and attacked) at a
// small fraction of its might: neighbours bite it there, decline becomes
// territorial, and a realm ground back to its heartland meets its besiegers at
// parity — great powers can FALL. Not a cliff: a Macedon CAN march on
// Persepolis — it pays per march-day, and the e-folding distance grows with
// logistics (a rail-age power projects across a continent).
const PROJ_LOGI = 2.2;

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
    // T.MUSTER_FIELD: the recruitment base is the realm's GOVERNED PEOPLE — the
    // popField over the land it holds — not the sum of its city censuses. Armies
    // were the countryside under arms; under cities-only entities (DISSOLVE_FARMS)
    // the census sum systematically under-counts every realm whose people live
    // outside catchment towns (the steppe, the marches, the agrarian valley) — the
    // SAME under-count POW_FIELD fixed for coercive power, applied to the manpower
    // pool. Median-anchored (median census-sum ÷ median governed-people, low-passed
    // like _refRevenue) so MANPOWER_FRAC keeps its calibration at the median realm:
    // war still costs the same men where it always did, but the DISTRIBUTION is the
    // land's — an agrarian empire out-musters a merchant league of the same city
    // count. Garrison caps and the per-city rural levy structure stay urban (cities
    // HOST troops); only the national pool re-bases. 0 = the census sum (byte-identical).
    if (T.MUSTER_FIELD > 0 && T.POP_FIELD && world.popField && world._countryOwner) {
      const pf = world.popField, co = world._countryOwner, elevA = world.elev, Nn = world.N;
      const gov = new Map();
      for (let ti = 0; ti < Nn; ti++) { const cc = co[ti]; if (cc >= 0 && elevA[ti] > 0) gov.set(cc, (gov.get(cc) || 0) + pf[ti]); }
      const cen = [], gv = [];
      for (const [cc, p] of natPop) { const g = gov.get(cc) || 0; if (g > 0 && p > 0) { cen.push(p); gv.push(g); } }
      if (cen.length >= 5) {
        cen.sort((a, b) => a - b); gv.sort((a, b) => a - b);
        const r = cen[cen.length >> 1] / Math.max(1e-9, gv[gv.length >> 1]);
        const prev = world._musterRatio || 0;
        world._musterRatio = prev > 0 ? prev + (r - prev) * 0.25 : r;   // the _refRevenue low-pass reasoning
      }
      const mr = world._musterRatio || 0;
      if (mr > 0) for (const [cc] of natPop) { const g = gov.get(cc) || 0; if (g > 0) natPop.set(cc, g * mr); }
    }
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

  // T.WAR_FINISH — THE GARRISON EATS WHAT THE CITY EATS. The desertion test
  // below reads the settlement food LEDGER (_foodSupply vs _foodDemand), but
  // under the field regime the ledger is vestigial for the census: people are
  // fed by the land's capacity (popField vs capField — the derive's own
  // truth), and the owner's first LAND_KNOW report already showed its shadow
  // ("starving but not shrinking": the ledger reads deficit while the
  // population holds). Measured at the consolidation lap (probe_armyfunnel,
  // live arm): 90-97% of ALL settlements fail the ledger test with
  // _foodSupply p50 = 0.00 while their populations grow — so every garrison
  // on Earth melts 20% per muster forever, world army ~1 sim-unit, and every
  // decisive war channel starves downstream (storm 7/11,597, capture
  // 10/2,914). The fix is one OR: a settlement whose ledger reads hungry is
  // still FED if the field that actually feeds its people covers them —
  // Σ capField ≥ Σ popField over its own catchment, the same 0.98 margin the
  // ledger test uses (no new constant). The ledger keeps its meaning where
  // it is the truth (sieges, import economies); it just stops disbanding
  // armies the census never starved. Lever 0 = ledger-only, byte-identical.
  let _ffPf = null, _ffCf = null;
  if (T.WAR_FINISH && T.ONE_POP && world.popField && world.capField && world._territoryOwner) {
    _ffPf = new Map(); _ffCf = new Map();
    const pf = world.popField, cfA = world.capField, ow = world._territoryOwner, Nn = world.N;
    for (let ti = 0; ti < Nn; ti++) {
      const sid = ow[ti]; if (sid < 0) continue;
      _ffPf.set(sid, (_ffPf.get(sid) || 0) + pf[ti]);
      _ffCf.set(sid, (_ffCf.get(sid) || 0) + cfA[ti]);
    }
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
    let starved = fed < (s._foodDemand || 0) * 0.98;
    if (starved && _ffPf) {
      const p = _ffPf.get(s.id) || 0;
      if (p > 0 && (_ffCf.get(s.id) || 0) >= p * 0.98) starved = false;   // the land feeds them (see the T.WAR_FINISH note above)
    }
    if (starved) {
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
      // T.WAR_FINISH — the professional core is an URBAN institution: under
      // ONE_POP `s.people` is the CATCHMENT (city + countryside), so the
      // "whole population" read armed every city with 5-9% of a PROVINCE —
      // and the first battery arm measured the consequence: catchment-fed
      // armies against urban-manned walls (the homeMight re-grounding) made
      // every storm succeed, flows ran ended=96/shattered=137 per 4k steps
      // against founded=36, and the size distribution COMPRESSED (gini 0.39)
      // — a boiling map that grinds instead of consolidating. The three
      // population reads now sit on one honest split: the PAID core is
      // urban (_urbanPop), the wartime levy is rural (_ruralPop, already
      // split-aware below), the walls are urban (homeMight). Regimes
      // without the urban read keep the whole-census core byte-identically.
      let popCap = (T.WAR_FINISH && s._urbanPop != null ? s._urbanPop : s.people) * frac;
      // T.WAR_FINISH — THE LEVY IS UNPAID (the first battery's verdict): the
      // waged establishment is the PROFESSIONAL core alone. Cache it before
      // the levy stacks on top: the fiscal block bills min(army, _proCap),
      // the solvency melt spares the levy (men never promised coin do not
      // desert over arrears — they are subject duty), and the storm reads
      // the pro share as its assault force (levies blockade; they do not
      // escalade walls). One cached scalar, three consumers.
      if (T.WAR_FINISH) s._proCap = popCap;
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
    if (solvency < 0.999) {
      if (T.WAR_FINISH && s._proCap != null) {
        // Arrears melt the PAID men only — the unpaid levy never had wages
        // to be owed (see the T.WAR_FINISH note above). This is what breaks
        // the measured bankruptcy spiral: a statelet at war no longer loses
        // its whole host to a thin treasury, just its professionals.
        const pro = Math.min(s.army || 0, s._proCap);
        const levy = (s.army || 0) - pro;
        s.army = levy + pro * (BANKRUPT_DESERT + (1 - BANKRUPT_DESERT) * solvency);
      } else {
        s.army *= BANKRUPT_DESERT + (1 - BANKRUPT_DESERT) * solvency;
      }
    }
    if (s.army < 0) s.army = 0;
  }
  // T.WAR_FINISH — the realm's PROFESSIONAL SHARE, for the storm's assault
  // force (levies blockade and fight relief battles in the field; walls are
  // taken by regulars). Fraction, not head-count, so the between-muster
  // casualty drift cancels.
  if (T.WAR_FINISH && world.countries) {
    const proS = new Map(), armS = new Map();
    for (const s of world.settlements) {
      if (s.mode !== "settled" || s.countryId < 0 || !(s.army > 0)) continue;
      const pro = Math.min(s.army, s._proCap != null ? s._proCap : s.army);
      proS.set(s.countryId, (proS.get(s.countryId) || 0) + pro);
      armS.set(s.countryId, (armS.get(s.countryId) || 0) + s.army);
    }
    for (const c of world.countries.values()) {
      const a = armS.get(c.id) || 0;
      c._proFrac = a > 0 ? (proS.get(c.id) || 0) / a : 1;
    }
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
// ── Capitulation (deditio): a decisively LOST war ends on the victor's terms ──
// Measured (tools/probe_warbars.mjs): every treaty signed on the LOSER's
// exhaustion — the beaten side paid a one-time indemnity, KEPT its land, and got
// a 770-1125 dyn-year protective truce. Victory reset the board, the inverse of
// how most ancient wars ended: the beaten court became a CLIENT whose weight
// joined the victor's next war (Rome's socii — the road from victory to network
// growth). So: when the exhaustion gap says the war was decisively lost, not
// mutually bled, AND the victor's live network field-might clearly out-scales
// the loser's, the loser bends the knee (conquest.js bendTheKnee — the existing
// dependency wiring: tribute, bloc, no internal fronts, network power) instead
// of taking the protective truce. The counterweights are already built: the
// coalition arrayed against the victor raises the required edge (coalitionBarOf),
// a vassal that outgrows its lord breaks free (independence), and the identity/
// coalition brakes still govern peacetime cascades. T.CAPITULATE=0 recovers the
// pure-truce treaty table byte-identically.
const CAPIT_GAP   = 0.5;   // exhaustion gap (|eA−eB|/TRUCE_EXHAUST) past which a war reads as decisively lost
const CAPIT_RATIO = 2.0;   // the victor's live network might must out-scale the loser's by this much — a pyrrhic near-peer war never vassalizes an equal

export function advanceFronts(world) {
  // TILE_POLITY (4c): war is fought COUNTRY vs COUNTRY over the political field
  // (world._countryOwner). owner[ti] is then a COUNTRY id, resolved through a per-country
  // war-ADAPTER (built after natMight below) instead of the per-settlement map — so the
  // whole tactical layer (front scan, capture, storm, casualties) runs on tiles and a
  // captured city just inherits the flag. Default: the per-settlement catchment map.
  const TILE_WAR = !!T.TILE_POLITY;
  const WDBG = (world.debug && world.debug.war) || null;   // opt-in throughput counters (probe_warbars) — null in normal runs
  const owner = TILE_WAR ? world._countryOwner : world._territoryOwner;
  const byId = world._byId;
  if (!owner || !byId) return;
  const { N, tw, th } = world;
  // CTRL_LIVE: the control field authors _countryOwner, so capturing tiles here washes out
  // next tick. Instead a winning front writes FORWARD PRESSURE (world._warFront/_warAdv) that
  // the field bulges into the defender toward its capital (controlField.js). Cleared each pass
  // so ended wars / receded fronts stop pushing.
  // (T.CTRL_LIVE removed 2026-07 — prototype failed its gate. Bound false so the
  // field-war branches below are provably dead; strip them on the next war pass.)
  const CTRL_LIVE = false;
  let warFront = null, warAdv = null;
  if (CTRL_LIVE) {
    warFront = world._warFront; warAdv = world._warAdv;
    if (!warFront || warFront.length !== N) { warFront = world._warFront = new Int32Array(N); warAdv = world._warAdv = new Float32Array(N); }
    warFront.fill(-1);
  }
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
  // T.TILE_IDENTITY: the kinship-RESTRAINT side of the casus reads the DEFENDER
  // REALM's PEOPLE — the people-weighted culture of its member CITIES plus their
  // governed COUNTRYSIDE (the field people via the _rurCulMix stamps — the
  // absorbResistance blend, cohesion.js) — instead of its capital city's
  // census mix. This is the counterweight to the irredentist term (Stage 2
  // wired only the righteous side to the ground, which tilted the balance:
  // biggest realm +17–30% in the windowed A/B). A long-settled nation-state's
  // assimilated ground is authentically KIN to its cultural siblings (restraint
  // strengthens — kin states spare each other), while an empire of restless
  // conquered foreigners reads FOREIGN however cosmopolitan its capital
  // (restraint weakens — the "liberator" carves it up). Same field, same
  // era-weights, no new constants: only the READ moves onto the land.
  // Aggregated once per war pass; lever off ⇒ null ⇒ the capital-mix read,
  // byte-identical (the extra casusBelliMul argument is undefined).
  // (T.TILE_IDENTITY removed 2026-07 — Stage-2 lever failed its invariant gate.
  // The realm-countryside culture aggregate and the tile-irredentist read went
  // with it; casusBelliMul's off-path (capital-mix) reads are the behaviour.)
  const realmCulOf = null;
  // Salience per PAIR of belligerents (cohesion.js): the more developed side
  // brings its era's political question to the war — righteous religion
  // between medieval courts, the national cause once either party
  // industrialises — while two ancient rivals fight ancient wars.
  const casusOf = (attCC, defCC, tileOwner, ti) => {
    const A = capOf.get(attCC), D = capOf.get(defCC);
    // T.TILE_IDENTITY: the irredentist term reads THE CONTESTED GROUND's own
    // people (the per-tile culture field) instead of the tileOwner entity —
    // under TILE_WAR that entity is the country adapter (no culMix) and the
    // term was structurally INERT (audit 2026-07 OPEN #3, now wired). Only the
    // land front passes a tile; the amphibious bars stay pair-level (their
    // beaches are enumerated after the bar) — undefined there keeps the term
    // reading 0 under tile-war exactly as before.
    let tShare;   // undefined → the capital-mix read (the T.TILE_IDENTITY tile read was removed 2026-07)
    // Kinship restraint reads the defender REALM's people under the lever
    // (undefined off-path / for unregistered realms → the capital-mix read).
    const dGround = realmCulOf ? realmCulOf.get(defCC) : undefined;
    return casusBelliMul(A, D, tileOwner, identityWeightsFor(world, A, D), tShare, dGround);
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
  // Per-war MOVEMENT ledger, in two parts, read by the STALEMATE settlement below:
  //   _warBornAt  ("lo:hi" → step)  — when the war opened (stamped at war.began; lazy
  //                for a loaded save's ongoing wars, so nothing settles spuriously).
  //   _warMoveEma ("lo:hi" → float) — the front's NET displacement velocity, low-passed:
  //                each war pass accumulates the SIGNED tile exchange (lo-side captures
  //                minus hi-side captures) and folds it into an EMA. The sign matters —
  //                a two-sided front ping-ponging the same border tiles nets to ~zero
  //                (the LINE is not moving: a stalemate), while a genuine advance keeps
  //                a persistent signed velocity. A binary "any capture = movement" clock
  //                was measured to wash out entirely by the Industrial era (active wars
  //                identical to the no-fix baseline): dense late-game fronts always
  //                trade SOME tiles, so only net displacement separates war from freeze.
  // Deliberately NOT persisted — rebuilt within one window after load.
  let warBorn = world._warBornAt; if (!warBorn) warBorn = world._warBornAt = new Map();
  let moveEma = world._warMoveEma; if (!moveEma) moveEma = world._warMoveEma = new Map();
  const passNet = new Map();   // this pass's signed tile exchange per pair ("lo:hi" → net toward lo)
  const bumpMove = (att, def, n) => {
    if (!(n > 0) || att < 0 || def < 0 || att === def) return;
    const lo = Math.min(att, def), hi = Math.max(att, def);
    const key = lo + ":" + hi;
    passNet.set(key, (passNet.get(key) || 0) + (att === lo ? n : -n));
  };
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

  // ── Scale-honest fortress reference (T.FORT_GARRISON_REF; header at FORT_R) ──
  // fortRef = the garrison of a first-rank stronghold OF THIS AGE: the
  // 85th-percentile settled garrison, floored at a pair of watchmen (below
  // that, "manning" is not a military statement). baseMin = BASE_OF_REF of
  // that complement (never below one man): the watch→base threshold rides the
  // same scale. Stateless — recomputed each pass from live garrisons — so it
  // is deterministic, save/load-safe and resolution-free (per-settlement men,
  // not per-tile), and it self-calibrates across population scales and eras:
  // war costs and mans the same RELATIVE force everywhere the way the old
  // absolutes only did at the one population they were tuned on.
  // T.FORT_GARRISON_REF > 0 = that absolute legacy pair (40 → manned-at-40 /
  // base-at-5, byte-identical).
  let fortRef;
  if (T.FORT_GARRISON_REF > 0) fortRef = T.FORT_GARRISON_REF;
  else {
    const g = [];
    for (const s of world.settlements) if (s.mode === "settled") g.push(s.army || 0);
    g.sort((a, b) => a - b);
    fortRef = Math.max(2, g.length ? g[Math.min(g.length - 1, Math.floor(g.length * 0.85))] : 2);
  }
  const baseMin = Math.max(1, fortRef * BASE_OF_REF);
  world._fortRef = fortRef;   // diagnostic surface (probes / info panel); derived, never persisted, never read back by the sim

  const natMight = new Map();   // countryId → Σ might = the NATIONAL FIELD ARMY (Σ garrison × tech)
  const natArmy = new Map();    // countryId → Σ raw garrison (for the adapter's army + casualty reconcile)
  const natNomadW = new Map();  // countryId → Σ garrison × _nomad (army-weighted cavalry share, for the adapter's techMul)
  const membersOf = TILE_WAR ? new Map() : null;   // countryId → member settlements (casualty distribution)
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    s._M = might(s);
    s._homeTi = (s.pos.y | 0) * tw + (s.pos.x | 0);
    s._armyStart = s.army || 0; s._ccStart = s.countryId;   // snapshot for the manpower casualty tally (end of pass)
    if (s.countryId >= 0) {
      natMight.set(s.countryId, (natMight.get(s.countryId) || 0) + s._M);
      natArmy.set(s.countryId, (natArmy.get(s.countryId) || 0) + (s.army || 0));
      natNomadW.set(s.countryId, (natNomadW.get(s.countryId) || 0) + (s.army || 0) * (s._nomad || 0));
      if (membersOf) { let a = membersOf.get(s.countryId); if (!a) membersOf.set(s.countryId, a = []); a.push(s); }
    }
  }
  // TILE_WAR: one combatant ADAPTER per alive country — a settlement-shaped object the
  // existing (already country-keyed) front/force machinery drives, but whose id IS the
  // country, whose might is the national army, and whose home/court is the capital tile.
  // owner[ti] (a country id) resolves through `own`; capturing a tile flips _countryOwner;
  // storming a capital fragments the realm; casualties on adapter.army reconcile to real
  // garrisons after the pass. Non-TILE_WAR: `own` is just the settlement lookup, unchanged.
  let own = byId;
  const adapters = TILE_WAR ? new Map() : null;
  if (TILE_WAR) {
    if (world.countries) for (const [cc, c] of world.countries) {
      const cap = c.capital;
      if (!cap || cap.mode !== "settled" || cc < 0) continue;
      adapters.set(cc, {
        id: cc, countryId: cc, mode: "settled", _isAdapter: true, _capital: cap,
        _M: natMight.get(cc) || 0, army: natArmy.get(cc) || 0,
        _homeTi: (cap.pos.y | 0) * tw + (cap.pos.x | 0), pos: cap.pos, tier: cap.tier | 0,
        knowledge: cap.knowledge, name: realmName(world, cc), _seaReach: cap._seaReach,
        people: cap.people || 0, wealth: cap.wealth || 0,
        loyalty: cap.loyalty ?? 1, unrest: cap.unrest || 0,
        _conqueredAt: cap._conqueredAt ?? -Infinity, _ambition: cap._ambition || 0,
        _armyStart: natArmy.get(cc) || 0,
        // Army-weighted cavalry share, so techMul(adapter) keeps the steppe
        // multiplier its own _M already bakes in per member (it silently read
        // `adapter._nomad` as undefined → nomad realms bled extra attrition).
        _nomad: (natArmy.get(cc) || 0) > 0 ? (natNomadW.get(cc) || 0) / natArmy.get(cc) : 0,
      });
    }
    own = adapters;
  }

  // Force-projection decay (T.WAR_REACH; PROJ_LOGI comment above homeMight). Each
  // nation's halving distance is stamped once per pass from its capital's logistics;
  // projOf(S, ti) = S's effective-might multiplier fighting at tile ti. Lever 0
  // (default) → projOf is exactly 1 everywhere (×1.0 is IEEE-exact: byte-identical).
  const WAR_REACH = TILE_WAR ? Math.max(0, T.WAR_REACH || 0) : 0;
  if (WAR_REACH > 0 && adapters) {
    const rs = resScaleFor(tw);
    for (const ad of adapters.values()) {
      const cap = ad._capital;
      const cons = (cap.knowledge && cap.knowledge.construction) || 0;
      const logi = (cap._techEff ? cap._techEff.logisticsLevel : cons * cons) || 0;   // the countryTerritory.js:401 idiom — one logistics truth
      ad._projHalf = WAR_REACH * (1 + PROJ_LOGI * logi) * rs;
      // ── Forward bases (owner review 2026-07: a garrison town's real point
      // is PROJECTION — troops stationed at the border defend it and answer
      // threats because they are NEAR it, not because masonry radiates).
      // Projection no longer decays from the capital alone: it decays from
      // the nearest base the realm actually MANS. A base's capacity is how
      // garrisoned it is (vs the manned-walls reference) — a small watch
      // stages a fraction of the national effort, the heartland always
      // stages all of it — folded in as max(capacity·e^(−d/H)) over bases
      // in projOf. Symmetric on purpose: campaigns launch from border
      // fortresses too (the limes legions, the march castles); and the
      // fiscal wage system already prices a manned frontier, so basing is
      // a real budget choice, never free.
      const cc2 = world.countries.get(ad.id);
      const bases = [{ x: cap.pos.x, y: cap.pos.y, cap: 1 }];
      if (cc2) for (const m of cc2.members) {
        if (m === cap || m.mode !== "settled") continue;
        const g = m.army || 0;
        if (g < baseMin) continue;                                // a watch, not a base — by the age's own scale
        bases.push({ x: m.pos.x, y: m.pos.y, cap: Math.min(1, g / fortRef) });
      }
      ad._bases = bases;
    }
  }
  // War-rate resolution invariance (audit 2026-07): the tile-capture budget is an
  // AREA rate. The war pass fires at a FIXED tick cadence (index.js — unlike the
  // territory pass, which thins by rNorm), so holding real km² conquered per unit
  // history constant across grids needs exactly ×resScale² on the budget — the
  // missing peer of EXPAND_RATE's ×resScale³ (which also absorbs its thinned
  // cadence). Momentum banked and front-displacement (stalemate EMA) are then
  // ÷r2War back into REFERENCE-tile units, so MOMENTUM_CAP and STALE_EPS keep one
  // meaning at every grid. r2War = 1 at the validated 240-tile reference (480px
  // probes) — byte-identical there; corrects the shipped 960 (war swept real area
  // at ¼ the validated rate) and the 320 smoke grid (9/4× — re-keys those hashes).
  const r2War = resScaleFor(tw) ** 2;
  const projOf = (S, ti) => {
    const H = S._projHalf;
    if (!(WAR_REACH > 0) || !(H > 0)) return 1;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const bases = S._bases;
    if (!bases) {   // no base list (legacy path): single-point decay from home
      const h = S._homeTi, hy = (h / tw) | 0, hx = h - hy * tw;
      let dx = Math.abs(tx - hx); if (dx > tw / 2) dx = tw - dx;   // longitude wraps
      const dy = ty - hy;
      return Math.exp(-Math.sqrt(dx * dx + dy * dy) / H);   // per-march-day multiplicative supply loss (see PROJ_LOGI comment)
    }
    // Forward basing: supply runs from the nearest base the realm MANS —
    // max over bases of capacity·e^(−d/H) (capacity ≤ 1, capital = 1), so a
    // garrisoned march town holds and launches at the border what the
    // distant heartland alone never could (see the base-list note above).
    let best = 0;
    for (let i = 0; i < bases.length; i++) {
      const b = bases[i];
      let dx = Math.abs(tx - b.x); if (dx > tw / 2) dx = tw - dx;
      const dy = ty - b.y;
      const p = b.cap * Math.exp(-Math.sqrt(dx * dx + dy * dy) / H);
      if (p > best) best = p;
    }
    return best;
  };

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
  const _fortRn = rNormPop(world);   // fortress shadow is a REAL distance (see FORT_R)
  const pairs = new Map();   // "att:def" -> { att, def, tiles:[{ti,distHome}], canStorm }
  // T.WAR_FINISH command capacity, the WITHIN-PASS half: _offEnemies is last
  // pass's state, so without this a peaceful realm could open a war against
  // every neighbour in ONE pass and the serial constraint never bound (the
  // measured 517→479 near-no-op). One NEW enemy per attacker per pass, the
  // first in deterministic tile order; wars already open are untouched.
  const _newWarBy = T.WAR_FINISH ? new Map() : null;
  for (let ti = 0; ti < N; ti++) {
    const d = owner[ti];
    if (d < 0) continue;
    const D = own.get(d);
    if (!D || D.mode !== "settled") continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    let bestA = -1, bestM = -1;
    for (let k = 0; k < 4; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      const a = owner[ni]; if (a < 0 || a === d) continue;
      const A = own.get(a);
      if (!A || A.mode !== "settled" || A.countryId === D.countryId
          || inTruce(A.countryId, D.countryId)
          || bondedCC(A.countryId, D.countryId)) {   // a signed peace holds; a suzerain-vassal bond holds harder
        if (WDBG && A && A.mode === "settled" && A.countryId !== D.countryId && inTruce(A.countryId, D.countryId)) {
          wdbgPass(WDBG, world.step); WDBG.trucePairs.add(A.countryId + ":" + D.countryId);
        }
        continue;
      }
      // Candidates rank (and later clear the bar) by PROJECTED might at THIS tile —
      // a nearby modest power can out-project a distant giant (T.WAR_REACH; ×1 off).
      const am = A._M * projOf(A, ti);
      if (am > bestM) { bestM = am; bestA = a; }
    }
    if (bestA < 0) continue;
    const A = own.get(bestA);
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
    // (The weights are the shared terrain-hold constants — transport.js,
    // one definition for war/storm/absorption; values unchanged.)
    let terrainDef = 1;
    if (world.riverMag && world.riverMag[ti] >= 2) {
      const cons = (D.knowledge && D.knowledge.construction) || 0;
      terrainDef *= 1 + RIVER_DEF_W * (1 - RIVER_DEF_ENG * cons);    // ≈3.2× at neolithic, ≈2× at high-construction
    }
    if (world.elev[ti] > 0.5) {
      const cons = (D.knowledge && D.knowledge.construction) || 0;
      // Steeper highland defends harder, scaling past the 0.5 threshold, so a
      // mountain wall genuinely channels invasions instead of being plowed flat.
      const alp = Math.min(1, (world.elev[ti] - 0.5) / 0.3);
      terrainDef *= 1 + (ALPINE_DEF_BASE + ALPINE_DEF_SLOPE * alp) * (1 - ALPINE_DEF_ENG * cons);   // ≈2–4.6× rough/high alpine
    }
    // RIDGE country (T.REFUGE): gorge-and-ridge land — world.relief past the
    // movement cost's own 0.07 floor — defends even where cell-MEAN altitude
    // never crosses 0.5 (the Alps average ~0.31 and slipped under the alpine
    // term entirely; the same blindness the claim cost fixed with this field).
    // Fronts now stall in broken country, which is where the map's refuge
    // statelets live. ×1 exactly at lever 0.
    if (T.REFUGE > 0) {
      const cons = (D.knowledge && D.knowledge.construction) || 0;
      const rh = ridgeHoldAt(world, ti, cons);
      if (rh > 0) terrainDef *= 1 + T.REFUGE * rh;
    }
    // ── Fortress shadow (see FORT_R above) ──────────────────────────
    // The strongest walled-and-manned strongpoint of the DEFENDER's own
    // country within FORT_R lends the tile its shadow, fading linearly
    // with distance. Only frontier tiles reach this code (an eligible
    // enemy neighbour exists), so the grid query cost rides the front
    // length, not the map.
    {
      const fr = FORT_R * _fortRn;
      let fortAdd = 0;
      forEachNear(world, tx + 0.5, ty + 0.5, fr, (S, d2) => {
        if (S.mode !== "settled" || S.countryId !== defCC) return;
        const eff = techEff(S);
        if (!eff.walls) return;
        const manned = 0.4 + 0.6 * Math.min(1, (S.army || 0) / fortRef);
        const f = FORT_W * Math.max(0, eff.defenseLevel || 0) * manned * Math.max(0, 1 - Math.sqrt(d2) / fr);
        if (f > fortAdd) fortAdd = f;
      });
      terrainDef *= 1 + fortAdd;
    }
    if (terrainDef > TERRAIN_DEF_CAP) terrainDef = TERRAIN_DEF_CAP;   // cap — a single tile can't be unconquerable
    // Even a vastly-stronger attacker is CHANNELLED by terrain (and by the
    // fortress line): a river/mountain/castle-shadow tile resists ~up to 6× a
    // plain, so fronts snap to ridges, rivers and marches and pour through
    // the gaps between, rather than advancing as a wall.
    const effDef = D._M * projOf(D, ti) * thinFactor * terrainDef;   // the defender projects to its own frontier too (×1 at lever 0)
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
    // (factors hoisted verbatim — same call sequence, same IEEE product chain — so the
    // throughput instrumentation below can attribute a rejection without re-deriving)
    // Irredentism (T.TILE_IDENTITY): passing `ti` lets the casus term read THE
    // CONTESTED TILE's own people from the identity field — a co-national
    // countryside under foreign rule lowers the attacker's bar tile by tile
    // (the audit's "structurally inert under tile-war" item, now wired; lever
    // off → tShare undefined → the adapter-read 0 of the default mode,
    // byte-identical).
    const _wb = warBarOf(A.countryId), _cs = casusOf(A.countryId, D.countryId, D, ti),
          _cl = claimBarOf(A.countryId, D.countryId), _db = domBarOf(A.countryId),
          _cb = coalitionBarOf(A.countryId, D.countryId);
    const bar = effDef * T.ATTACK_MIN_RATIO * aggMul * (1 + tf * TRADE_PEACE_MAX) * _wb * _cs * _cl * _db * _cb;
    if (WDBG) {
      wdbgPass(WDBG, world.step);
      const wk = A.countryId + ":" + D.countryId;
      let r = WDBG.pairs.get(wk);
      if (!r) WDBG.pairs.set(wk, r = { attM: bestM, base: effDef * T.ATTACK_MIN_RATIO, minBar: bar,
        f: { agg: aggMul, trade: 1 + tf * TRADE_PEACE_MAX, war: _wb, casus: _cs, claim: _cl, dom: _db, coal: _cb }, passed: false });
      else if (bar < r.minBar) { r.minBar = bar; r.base = effDef * T.ATTACK_MIN_RATIO; r.attM = bestM;
        r.f = { agg: aggMul, trade: 1 + tf * TRADE_PEACE_MAX, war: _wb, casus: _cs, claim: _cl, dom: _db, coal: _cb }; }
      if (bestM >= bar) r.passed = true;
    }
    // FUNNEL (telemetry.js) — WAR INITIATION: why does this attacker NOT push onto
    // this tile? A front opening here is what becomes a `war.began`, so this is the
    // gate the whole conquest question rests on, and it was measurable only through
    // the bespoke WDBG structure above — opt-in, shaped for one probe
    // (probe_warbars), and speaking a different language from every other funnel.
    //
    // The bar is a PRODUCT of six brakes over the raw defence, so the binding one is
    // the LARGEST multiplier above 1 — the opposite of crystallize.js, where the
    // terms are probabilities and the SMALLEST binds. Same rule underneath: name the
    // constraint that actually did the work, never "the roll failed". If every brake
    // is at or below 1 the attacker is simply outmatched, which is a different
    // finding from being deterred and must not be confused with one.
    //
    // Guarded whole so a disabled run does no attribution work at all: this is the
    // hottest loop in the sim, per attacker per contested tile per tick.
    // T.WAR_FINISH — COMMAND CAPACITY: a court prosecutes its wars SERIALLY.
    // Measured without this (the levy lap's third arm): on the dense peer map
    // every realm pressed every neighbour simultaneously — war volume scaled
    // with register size × adjacency, and the shatter cyclone ACCELERATED as
    // the register grew (ended 1,289 / shattered 1,749 vs founded 112 per 4k
    // at 28k). History's constraint is command: the king leads one campaign
    // (pre-modern states fought serially; the multi-front war is a
    // late-logistics luxury — Rome's two-theatre wars rode roads and fleets).
    // A realm already prosecuting offensives against its capacity in DISTINCT
    // enemies refuses to open a war against a NEW one; existing wars press on
    // (never freeze a war mid-fight), defence is never capped (you don't
    // choose to be invaded). Capacity = 1 + logistics steps (the same tech
    // channel that stretches reach and projection): one war for an early
    // court, up to three at full logistics. ×none at lever 0.
    const _capBlocked = T.WAR_FINISH && (() => {
      const off = aCountry && aCountry._offEnemies;
      if (off && off.has(D.countryId)) return false;              // an open war continues
      const opened = _newWarBy.get(A.countryId);
      if (opened !== undefined && opened !== D.countryId) return true;   // one NEW enemy per pass
      const lg = aCountry && aCountry.capital ? (techEff(aCountry.capital).logisticsLevel || 0) : 0;
      if ((off ? off.size : 0) >= 1 + Math.round(2 * Math.max(0, Math.min(1, lg)))) return true;
      if (opened === undefined) _newWarBy.set(A.countryId, D.countryId);
      return false;
    })();
    if (world._tel) {
      tel(world, "attack", "CANDIDATE");
      if (_capBlocked) tel(world, "attack", "commandCapacity");
      else if (bestM >= bar) telPass(world, "attack");
      else {
        let worstName = null, worstVal = 1 + 1e-9;
        const brake = (n, v) => { if (v > worstVal) { worstVal = v; worstName = n; } };
        brake("aggressionTemperament", aggMul);
        brake("tradePeace", 1 + tf * TRADE_PEACE_MAX);
        brake("warWeariness", _wb);
        brake("noCasusBelli", _cs);
        brake("claimBar", _cl);
        brake("dominanceBar", _db);
        brake("coalitionDeterrence", _cb);
        tel(world, "attack", worstName || "outmatched(noBrakeBinding)");
      }
    }
    if (_capBlocked || bestM < bar) continue;   // command capacity (T.WAR_FINISH), then projected attacker vs projected defender (raw vs raw at lever 0)
    // Distance of this tile from the defender's home (longitude wraps).
    const dh = D._homeTi, dhy = (dh / tw) | 0, dhx = dh - dhy * tw;
    let ddx = Math.abs(tx - dhx); if (ddx > tw / 2) ddx = tw - ddx;
    const ddy = ty - dhy;
    const distHome = Math.sqrt(ddx * ddx + ddy * ddy);
    const assaultDist = coreRadiusFor(D) + ASSAULT_MARGIN;   // scales with the city's size
    const key = bestA + ":" + d;
    let pc = pairs.get(key);
    if (!pc) { pc = { att: A, def: D, tiles: [], canStorm: false, _pjA: 0, _pjD: 0, _pjN: 0 }; pairs.set(key, pc); }
    if (distHome <= assaultDist) pc.canStorm = true;         // front at the heartland
    // capturable countryside — unless this tile was just flipped and is still
    // in its post-capture hold, which keeps a stalled front from ping-ponging
    // the same border tiles back and forth every pass.
    else if (world.step - capturedAt[ti] >= T.TILE_CAPTURE_GRACE) {
      pc.tiles.push({ ti, distHome });
      // Mean battlefield projection per side (T.WAR_REACH): the countryside fight
      // below is resolved at the contested tiles' average projection.
      if (WAR_REACH > 0) { pc._pjA += projOf(A, ti); pc._pjD += projOf(D, ti); pc._pjN++; }
    }
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
  // TILE_WAR: the same doctrine at NATION level — a country can invade where any of
  // its embarkable ports can sail (the port-level sea-lane web aggregated to a
  // country-pair adjacency), the whole national field army fights the beachhead
  // (adapters, exactly like a land front), and the landing beaches are the DEFENDER
  // COUNTRY's water-edge tiles under the same home-distance / storm-radius / grace
  // rules. This was the "restore in a later slice" gap: under the default tile-war
  // mode populated enemy shores were simply unconquerable (no Punic Wars — a
  // Mediterranean-shaped empire was structurally impossible), measured while
  // attributing the no-hegemon bottleneck (tools/probe_warbars.mjs). AMPHIB_BAR=0
  // recovers the sea-blind war byte-identically.
  if (T.AMPHIB_BAR > 0 && TILE_WAR) {
    // 1. Country-pair sea adjacency: any port with real seacraft that can sail to a
    //    foreign port opens its COUNTRY's invasion lane to that port's COUNTRY.
    const seaCC = new Map();   // attacker countryId → Set(defender countryId)
    for (const P of world.settlements) {
      if (P.mode !== "settled" || P.countryId < 0 || !P._seaReach || P._seaReach.size === 0) continue;
      if (((P.knowledge && P.knowledge.navigation) || 0) < AMPHIB_NAV_MIN) continue;
      for (const pid of P._seaReach.keys()) {
        const Q = byId.get(pid);
        if (!Q || Q.mode !== "settled" || Q.countryId < 0 || Q.countryId === P.countryId) continue;
        let s = seaCC.get(P.countryId); if (!s) seaCC.set(P.countryId, s = new Set());
        s.add(Q.countryId);
      }
    }
    // 2. Bar-check each lane with the full land stack × AMPHIB_BAR (an opposed
    //    landing wants overwhelming superiority) — national army vs national army.
    const amphibByDef = new Map();   // defender countryId → pending beachhead pairs
    for (const [acc, defs] of seaCC) {
      const A = own.get(acc);
      if (!A || !(A._M > 0)) continue;
      const aCountry = world.countries && world.countries.get(acc);
      const aggMul = aCountry && aCountry.personality ? aggressionAttackMul(aCountry.personality) : 1;
      for (const dcc of defs) {
        const D = own.get(dcc);
        if (!D || inTruce(acc, dcc) || bondedCC(acc, dcc)) continue;
        const key = acc + ":" + dcc;
        if (pairs.has(key)) continue;                        // already met on land
        const tf = tradeFactor(acc, dcc);
        // (tileOwner = adapter here too — the irredentist casus term is inert under
        // TILE_WAR; see the land-scan note above.)
        const _wb = warBarOf(acc), _cs = casusOf(acc, dcc, D), _cl = claimBarOf(acc, dcc),
              _db = domBarOf(acc), _cb = coalitionBarOf(acc, dcc);
        const bar = D._M * T.ATTACK_MIN_RATIO * aggMul * (1 + tf * TRADE_PEACE_MAX) * T.AMPHIB_BAR * _wb * _cs * _cl * _db * _cb;
        if (WDBG) {
          wdbgPass(WDBG, world.step);
          let r = WDBG.pairs.get(key);
          const f = { agg: aggMul, trade: 1 + tf * TRADE_PEACE_MAX, amphib: T.AMPHIB_BAR, war: _wb, casus: _cs, claim: _cl, dom: _db, coal: _cb };
          if (!r) WDBG.pairs.set(key, r = { attM: A._M, base: D._M * T.ATTACK_MIN_RATIO, minBar: bar, f, passed: false });
          else if (bar < r.minBar) { r.minBar = bar; r.base = D._M * T.ATTACK_MIN_RATIO; r.attM = A._M; r.f = f; }
          if (A._M >= bar) r.passed = true;
        }
        // T.WAR_REACH: the landing bar is PER BEACH — both armies project to the
        // actual shore (step 3), so a giant's far coast is as biteable as its far
        // land frontier and a landing near ITS OWN ports is cheap. The lane-level
        // test would price every beach at full national might on both sides (the
        // exact locality bug the lever exists to fix), so it is deferred; carry the
        // bar FACTORS (bar ÷ D._M) for the per-tile test. Lever 0: the original
        // lane-level rejection, byte-identical.
        if (WAR_REACH > 0) {
          const pc = { att: A, def: D, tiles: [], canStorm: false, _key: key, _pjA: 0, _pjD: 0, _pjN: 0, _tileBar: bar / Math.max(1e-12, D._M) };
          let l = amphibByDef.get(dcc); if (!l) amphibByDef.set(dcc, l = []);
          l.push(pc);
          continue;
        }
        if (A._M < bar) continue;
        const pc = { att: A, def: D, tiles: [], canStorm: false, _key: key, _pjA: 0, _pjD: 0, _pjN: 0 };
        let l = amphibByDef.get(dcc); if (!l) amphibByDef.set(dcc, l = []);
        l.push(pc);
      }
    }
    // 3. Landing beaches: the defender country's water-edge tiles (one owner scan,
    //    same rules as the land scan; a beach near the capital storms it from the sea).
    if (amphibByDef.size) {
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
        const D = own.get(d);
        if (!D) continue;
        const dh = D._homeTi, dhy = (dh / tw) | 0, dhx = dh - dhy * tw;
        let ddx = Math.abs(tx - dhx); if (ddx > tw / 2) ddx = tw - ddx;
        const ddy = ty - dhy;
        const distHome = Math.sqrt(ddx * ddx + ddy * ddy);
        const assaultDist = coreRadiusFor(D) + ASSAULT_MARGIN;
        for (const pc of cands) {
          // Deferred per-beach bar (T.WAR_REACH; lane-level at lever 0, see step 2):
          // each side projects to THIS shore.
          if (WAR_REACH > 0) {
            const pjD = projOf(D, ti);
            if (pc.att._M * projOf(pc.att, ti) < D._M * pjD * pc._tileBar) continue;
            if (distHome <= assaultDist) { pc.canStorm = true; continue; }
            if (world.step - capturedAt[ti] >= T.TILE_CAPTURE_GRACE) {
              pc.tiles.push({ ti, distHome });
              pc._pjA += projOf(pc.att, ti); pc._pjD += pjD; pc._pjN++;
            }
            continue;
          }
          if (distHome <= assaultDist) pc.canStorm = true;   // the capital fronts the water — stormable from the sea
          else if (world.step - capturedAt[ti] >= T.TILE_CAPTURE_GRACE) pc.tiles.push({ ti, distHome });
        }
      }
      for (const cands of amphibByDef.values())
        for (const pc of cands)
          if (pc.canStorm || pc.tiles.length) pairs.set(pc._key, pc);
    }
  }
  if (T.AMPHIB_BAR > 0 && !TILE_WAR) {   // legacy per-settlement mode (non-tile war)
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
  // T.WAR_FINISH — the CAMP CLOCK (header at SIEGE_ENDURE): when each pair's
  // CONTINUOUS siege began. Renewed every pass the front stands at the
  // heartland; an entry not renewed within the polity cadence lapsed de
  // facto (the front broke — a later return is a FRESH siege). Scratch,
  // never persisted — rebuilt within one pass, the _warBornAt doctrine.
  let siegeOpen = null;
  if (T.WAR_FINISH) {
    siegeOpen = world._siegeOpen; if (!siegeOpen) siegeOpen = world._siegeOpen = new Map();
    if (siegeOpen.size) { const stale = (T.POLITY_INTERVAL || 150) * 1.5; for (const [k, sg] of siegeOpen) if (world.step - sg.last > stale) siegeOpen.delete(k); }
  }
  for (const pc of pairs.values()) {
    besieged.add(pc.def);
    pc.def._warAt = world.step;                       // core/countryside under attack
    if (pc.canStorm) {
      pc.def._siegeAt = world.step;                   // front at the heartland (true siege)
      // T.SIEGE_STARVE: stamp the SETTLEMENT under siege — settlement.js
      // chokes its supply and drains its granary while this stays fresh.
      { const sc = pc.def._capital || pc.def; if (sc && sc.pos) sc._besiegedAt = world.step; }
      if (siegeOpen) {   // the camp clock opens (or keeps running) at the walls
        const k = pc.att.countryId + ":" + pc.def.countryId;
        const sg = siegeOpen.get(k);
        if (sg) sg.last = world.step; else siegeOpen.set(k, { since: world.step, last: world.step });
      }
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
      warBorn.set(Math.min(attId, defId) + ":" + Math.max(attId, defId), world.step);   // a genuinely NEW war: its stalemate age starts here
      if (WDBG) WDBG.tot.warsStarted++;
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
        // The pair has fought before within this run's memory: the war+slavery
        // breakdown measured ~90-170 war.began/1k late-game, most of them the
        // SAME rivalries re-flaring after each truce lapse — annotate, so the
        // chronicle can say "the war resumed" instead of minting a fresh war
        // per flare. Event-content only; no sim state reads it.
        rematch: last !== undefined ? 1 : 0,
      });
      if (pa) pa._reignWars = (pa._reignWars || 0) + 1;   // a war of the reigning ruler's making (epithet deeds)
    }
    if (seen.size > 4000) {   // prune stale pairs so the map can't grow unbounded
      for (const [k, st] of seen) if (world.step - st > (WAR_MEMORY * 3) / (world._dt || 1)) {
        seen.delete(k);
        if (world._warDead && world._warDead.has(k)) {
          if (WDBG) WDBG.signed.push({ how: "faded", age: 0 });
          closeWar(world, k, "faded");   // no peace was signed — the war petered out (a side died, fronts dissolved)
        }
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
  let signPeace = null;   // hoisted: the siege-lift path (T.WAR_FINISH, advance loop below) signs through the SAME treaty machinery
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
    signPeace = (a, b, how = "truce") => {
      const key = Math.min(a, b) + ":" + Math.max(a, b);
      if ((truces.get(key) || 0) > world.step) return false;   // already at peace
      const trade = pairTrade ? (pairTrade.get(key) || 0) : 0;
      // T.TRUCE_TRADE_OWN — the reference above is a TAUTOLOGY. tradeRef is 2× the
      // live MEDIAN pair-trade, so the median pair reads tradeW = 0.500 exactly, in
      // every era, by construction (measured at steps 6000/9000/12000/16000/21000:
      // 0.500 at all five, with 26-32% of pairs pinned at the cap). The era contrast
      // this whole block exists for — "an integrated late-game world signs LONG
      // peaces while subsistence antiquity stays endemic-warlike" — is therefore
      // structurally impossible: the term instead adds a FLAT ~2× to every truce at
      // every level of development, which is where the measured ~3000t mean peace
      // against a 1500t base comes from. It is the same defect class as the removed
      // world._sizePopK size anchor: a live cross-realm median used as the reference
      // normalizes away the very quantity it is meant to detect.
      //   On the lever, interdependence is measured against the pair's OWN economic
      // life: what share of these two realms' entire commerce runs between them.
      // Numerator and denominator are both this tick's link money, so inflation and
      // money-supply drift cancel exactly (the objection the median was answering),
      // it is a property of the pair rather than of the world, and full dependence is
      // 1.0 by definition — so it introduces no new constant. Measured share (median
      // over pairs): 0.008 at step 6000, rising to 0.03-0.05 later, with the most
      // integrated pairs at 0.37 — near-zero in subsistence antiquity, real for a
      // genuinely interdependent pair, exactly as the design above describes.
      let tradeW;
      const ownTot = (T.TRUCE_TRADE_OWN || 0) > 0 ? world._tradeTotals : null;
      if (ownTot) {
        const den = (ownTot.get(a) || 0) + (ownTot.get(b) || 0);
        tradeW = den > 0 ? Math.min(1, trade / den) : 0;
      } else {
        tradeW = Math.min(1, trade / tradeRef);
      }
      // The peace lasts as long as the war HURT (T.TRUCE_TOLL): duration also
      // scales with the war's own toll — its reckoned dead over the
      // belligerents' combined people. A war that bled the pair ~TOLL_GREAT
      // (a GREAT war) buys a generation-plus treaty; a bloodless border
      // skirmish buys only the base paper, so the marches stay restless
      // (intended) while great rivalries become episodic instead of
      // flickering on the flat truce clock. Measured need (war+slavery
      // breakdown, 2026-07): ~50-60% of late declarations are the SAME pairs
      // re-flaring the moment the flat truce lapses, ~70% of them
      // non-trading, so the trade term alone cannot pace them — the toll is
      // the pair-specific state that should. 0 = flat duration (byte-identical).
      let tollW = 0;
      if (T.TRUCE_TOLL > 0) {
        const dead = world._warDead ? (world._warDead.get(key) || 0) : 0;
        if (dead > 0) {
          let pop = 0;
          const ca = world.countries && world.countries.get(a), cb = world.countries && world.countries.get(b);
          if (ca) for (const m of ca.members) pop += Math.max(0, m.people || 0);
          if (cb) for (const m of cb.members) pop += Math.max(0, m.people || 0);
          tollW = Math.min(1, dead / (Math.max(1, pop) * TOLL_GREAT));
        }
      }
      const dur = (T.TRUCE_TICKS * (1 + TRADE_PEACE_W * tradeW + T.TRUCE_TOLL * tollW)) / (world._dt || 1);
      truces.set(key, world.step + dur);
      if (WDBG) WDBG.signed.push({ how, dur: Math.round(dur * (world._dt || 1)), age: world.step - (warBorn.get(key) ?? world.step),
        exhHi: Math.max(exh.get(a) || 0, exh.get(b) || 0), exhLo: Math.min(exh.get(a) || 0, exh.get(b) || 0) });
      warBorn.delete(key); moveEma.delete(key);   // the settled war's ledger dies with it (a reopened war re-registers at war.began)
      closeWar(world, key, how);       // the war's dead are reckoned at the peace
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
    // WARS THAT STOP MOVING END (T.STALEMATE_TICKS — the frozen-front settlement).
    // The exhaustion treaty above only ends HIGH-INTENSITY wars, and the measured
    // late-game map is the opposite failure: dozens of smouldering fronts that never
    // push anyone near the truce bar (measured at the app grid: 57 active wars at one
    // Medieval checkpoint, endings collapsed to 0.7 per 1000 steps, mean exhaustion
    // 0.09) — permanent background war that reads as noise, not history. What history
    // actually has: most wars ended in a NEGOTIATED STATUS QUO once neither side could
    // move the line — uti possidetis, not collapse. So a warring pair whose front has
    // produced NO territorial movement (no countryside captured, no city under storm,
    // by either side — the _warLastMove ledger) for a full window signs the same
    // trade-scaled treaty, reparations only where the exhaustion gap is one-sided
    // (signPeace already gates that). Gated purely on the war's OWN state — a war that
    // is genuinely advancing never settles this way, however long it runs; a wall that
    // holds for a generation is a peace nobody bothered to sign, so the scribes sign it.
    // Fold this pass's signed tile exchange into each active war's displacement EMA
    // (MOVE_EMA_KEEP per war pass ≈ a few-pass memory), and age-track every pair.
    // Ledger hygiene: entries for pairs no longer at war are dropped, so the maps
    // stay bounded by the live war count.
    const staleWin = T.STALEMATE_TICKS > 0 ? T.STALEMATE_TICKS / (world._dt || 1) : 0;
    if (staleWin > 0) {
      // Age + displacement fold for every pair CURRENTLY at the front, and a
      // last-fronted stamp (warLastFront) for the de-facto closure sweep below.
      let warLastFront = world._warLastFront; if (!warLastFront) warLastFront = world._warLastFront = new Map();
      for (const [cc, es] of allEnemies) {
        if (cc < 0) continue;
        for (const ecc of es) {
          if (ecc <= cc || ecc < 0) continue;
          const key = cc + ":" + ecc;
          if (!warBorn.has(key)) warBorn.set(key, world.step);   // loaded save / pre-ledger war: age starts now
          warLastFront.set(key, world.step);
          moveEma.set(key, (moveEma.get(key) || 0) * MOVE_EMA_KEEP + (passNet.get(key) || 0));
        }
      }
      // DE-FACTO ENDINGS: a war whose fronts have DISSOLVED (neither side has fielded a
      // front for a full window) ended in fact — nobody is fighting it — but its
      // casualty ledger sat open forever (_warDead pairs were only reckoned by the rare
      // memory prune), so the map read as saturated with wars nobody was fighting. The
      // measured stock: fronts dissolve when the attack calculus turns (bars rise,
      // armies drain) without ever crossing a treaty threshold. Reckon them: the war
      // ends "faded", its dead are recorded, and the pair's ledger clears. No truce is
      // signed — nothing was agreed; hostilities may genuinely resume later as a NEW war.
      if (world._warDead && world._warDead.size) {
        for (const key of [...world._warDead.keys()]) {
          const i = key.indexOf(":"); const a = +key.slice(0, i), b = +key.slice(i + 1);
          const s = allEnemies.get(a);
          if (s && s.has(b)) continue;                       // still being fought — the treaty loop below judges it
          const lastF = warLastFront.get(key);
          if (lastF === undefined) { warLastFront.set(key, world.step); continue; }   // first sight (load): clock starts
          if (world.step - lastF >= staleWin) {
            if (WDBG) WDBG.signed.push({ how: "faded", age: world.step - (warBorn.get(key) ?? world.step) });
            closeWar(world, key, "faded");
            warBorn.delete(key); moveEma.delete(key); warLastFront.delete(key);
          }
        }
      }
      if (warBorn.size > 512) {
        for (const k of [...warBorn.keys()]) {
          const i = k.indexOf(":"); const a = +k.slice(0, i), b = +k.slice(i + 1);
          const s = allEnemies.get(a);
          if (!s || !s.has(b)) { warBorn.delete(k); moveEma.delete(k); }
        }
      }
      if (warLastFront.size > 1024) {
        for (const [k, st] of warLastFront) if (world.step - st >= staleWin * 2) warLastFront.delete(k);
      }
    }
    for (const [cc, es] of allEnemies) {
      if (cc < 0) continue;
      const eA = exh.get(cc) || 0;
      for (const ecc of es) {
        if (ecc <= cc || ecc < 0) continue;          // each pair once
        let how = null;
        if (eA >= TRUCE_EXHAUST || (exh.get(ecc) || 0) >= TRUCE_EXHAUST) how = "truce";
        else if (staleWin > 0) {
          const key = cc + ":" + ecc;                // cc < ecc by the guard above
          const born = warBorn.get(key) ?? world.step;
          // Old enough to judge, and the LINE is not moving: the low-passed net
          // displacement sits under a tile's worth of drift — ping-ponged border
          // tiles cancel; only a persistent one-directional advance keeps it high.
          if (world.step - born >= staleWin && Math.abs(moveEma.get(key) || 0) < STALE_EPS) how = "stalemate";
        }
        if (!how) continue;
        // CAPITULATION intercepts the exhaustion treaty (header at CAPIT_GAP): a
        // decisively beaten court bends the knee — the victor gains a tributary
        // network instead of handing its victim a millennium of protection. The
        // knee-bend IS this pair's settlement (no truce, no congress); the victor
        // stays free to press its other wars — serial conquest, at last possible.
        if (how === "truce" && T.CAPITULATE) {
          const eB = exh.get(ecc) || 0;
          const gap = Math.abs(eA - eB) / TRUCE_EXHAUST;
          if (gap >= CAPIT_GAP) {
            const loser = eA > eB ? cc : ecc, winner = eA > eB ? ecc : cc;
            let wM = natMight.get(winner) || 0, lM = natMight.get(loser) || 0;
            if (ovFr) for (const [dep, over] of ovFr) {   // live network might: a suzerain weighs with its clients
              if (over === winner) wM += natMight.get(dep) || 0;
              else if (over === loser) lM += natMight.get(dep) || 0;
            }
            if (wM >= lM * CAPIT_RATIO * coalitionBarOf(winner, loser)
                && bendTheKnee(world, loser, winner, "capitulation")) {
              const key = cc + ":" + ecc;
              if (WDBG) WDBG.signed.push({ how: "capitulation", dur: 0, age: world.step - (warBorn.get(key) ?? world.step),
                exhHi: Math.max(eA, eB), exhLo: Math.min(eA, eB) });
              warBorn.delete(key); moveEma.delete(key);
              continue;
            }
          }
        }
        if (!signPeace(cc, ecc, how)) continue;
        // the congress: exhausted co-belligerents of either side settle too —
        // wars end at conferences (a stalemate settlement convenes one just the same)
        for (const side of [cc, ecc]) {
          const others = allEnemies.get(side);
          if (!others) continue;
          for (const third of others) {
            if (third < 0 || third === cc || third === ecc) continue;
            if ((exh.get(third) || 0) >= TRUCE_EXHAUST * CONGRESS_JOIN
                || (exh.get(side) || 0) >= TRUCE_EXHAUST) signPeace(side, third, how);
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
  // ── Coalition war (T.ALLY_FRONT): the bloc FIGHTS its common threat ──────────
  // The balance-of-power layer already forms blocs against a hegemon
  // (updateAlliances: _allianceTarget) and prices their DETERRENCE into the attack
  // bar (coalitionBarOf) — but in the actual fighting every realm stood alone, so
  // deterrence had no teeth: a hegemon that shrugged the bar met each member one at
  // a time (no War of the Grand Alliance, no coalition that breaks a Napoleon).
  // Under the lever, a SERIOUS front (a storm) between a bloc member and the bloc's
  // TARGET draws the rest of the bloc in, both ways: allies reinforce a member the
  // hegemon is storming, and join a member's push on the hegemon's own heartland —
  // the offensive half is the giant-killer. Each ally commits T.ALLY_FRONT of
  // conserved allocation weight (a real slice of its one pool — its own fronts
  // weaken while it campaigns, the same conservation as everything here) and its
  // force ARRIVES at its WAR_REACH projection at the theatre (the stormed capital):
  // a neighbour marches an army, a distant ally sends a token — coalition reach is
  // the same physics as every other reach, never a diplomatic teleport. v1 scope:
  // storms only (allies mass for the decisive battle; border grinding stays
  // bilateral), the assist joins the FIELD battle (advCity's relief side or the
  // attacker's siege army), not the wall-breaking grind, and assisting realms pay
  // pool-commitment but not attrition/exhaustion yet. 0 = off (byte-identical).
  const ASSIST = TILE_WAR ? Math.max(0, T.ALLY_FRONT || 0) : 0;
  if (ASSIST > 0 && allianceTarget) {
    const blocOf = new Map();   // target hegemon → bloc member ids
    for (const [cc, tgt] of allianceTarget) { if (tgt >= 0 && own.get(cc)) { let a = blocOf.get(tgt); if (!a) blocOf.set(tgt, a = []); a.push(cc); } }
    for (const pc of pairs.values()) {
      if (!pc.canStorm) continue;
      const acc = pc.att.countryId, dcc = pc.def.countryId; if (acc === dcc) continue;
      // DEFENSIVE ONLY: the stormed member balances against its attacker → the bloc
      // relieves it. The offensive half (the bloc joining a member's storm of its
      // target) was built and MEASURED HARMFUL: _allianceTarget is each realm's own
      // biggest threat — usually a MID-TIER neighbour, not the global hegemon — so
      // offensive assists dogpiled the second rank and cleared the true giant's
      // peer competition (windowed biggest realm 9.7→12.3 Mkm² on 8817, 10.5 on
      // 4242). Relief-only keeps the teeth pointed the right way: the coalition
      // saves the hegemon's victims and never wins anyone else's conquests.
      const hg = allianceTarget.get(dcc) === acc ? acc : -1;
      if (hg < 0) continue;
      const members = blocOf.get(hg); if (!members) continue;
      for (const ally of members) {
        if (ally === acc || ally === dcc) continue;
        if (inTruce(ally, hg) || bondedCC(ally, hg)) continue;   // a signed peace with the hegemon holds
        let l = pc._assistDefIds; if (!l) l = pc._assistDefIds = [];
        l.push(ally);
        addW(ally, ASSIST);   // the committed slice of the ally's one pool
      }
    }
  }
  // Effective pool: the national field army, worn down by war-exhaustion.
  const effPool = (cc) => (natMight.get(cc) || 0) * (1 - Math.min(0.9, exh.get(cc) || 0));
  // The force a realm actually commits to one front — its pool × that front's share of its
  // total weight. Sum over a realm's fronts = its whole pool (the conservation).
  const offForceOf = (acc, dcc) => { const W = totW.get(acc) || 0; if (W <= 0) return 0; return ((offW.get(acc + ":" + dcc) || 0) / W) * effPool(acc); };
  const defForceOf = (dcc, acc) => { const W = totW.get(dcc) || 0; if (W <= 0) return effPool(dcc); return ((defW.get(dcc + ":" + acc) || 0) / W) * effPool(dcc); };
  // Coalition assists resolved into THEATRE-LOCAL force — after totW is final, so
  // each ally's contribution is its committed share of its whole (exhaustion-worn)
  // pool, projected to the stormed capital (T.WAR_REACH physics).
  if (ASSIST > 0) {
    for (const pc of pairs.values()) {
      const ids = pc._assistDefIds; if (!ids) continue;
      let sum = 0;
      for (const ally of ids) {
        const A2 = own.get(ally); if (!A2) continue;
        const W = totW.get(ally) || 0; if (!(W > 0)) continue;
        sum += (ASSIST / W) * effPool(ally) * projOf(A2, pc.def._homeTi);
      }
      pc._assistDef = sum;
    }
  }

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
  if (ENCIRCLE > 0 && !TILE_WAR) {   // TILE_WAR v1: per-settlement octant scan — encMulOf returns 1 (no penalty) meanwhile
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
  const _siegeLifted = siegeOpen ? [] : null;   // pairs whose camp broke this pass — their peace signs after the loop
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
    const attForce0 = offForceOf(acc, dcc);            // A's share of its finite army on THIS front
    const em = encMulOf(def);                          // <1 if the defender is pressed from several sides
    const defForce0 = defForceOf(dcc, acc);            // D's share of its finite army defending THIS front
    // T.WAR_REACH: both armies project to the BATTLEFIELD. The countryside fight is
    // resolved at the contested tiles' mean projection per side; the storm below is
    // fought at the defender's capital (attacker decayed by that distance, defender
    // at home). ×1 exactly at lever 0 (_pjN stays 0), so the ratios are unchanged.
    const pjA = pc._pjN > 0 ? pc._pjA / pc._pjN : 1, pjD = pc._pjN > 0 ? pc._pjD / pc._pjN : 1;
    const attForce = attForce0 * pjA;
    const defForce = defForce0 * pjD;
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
      // T.WAR_REACH: the storm is fought AT the capital — the attacker projects at the
      // capital's distance from ITS home; the defending field army IS home (undecayed
      // defForce0). And the FORTRESS is the capital's OWN garrison/militia/walls: under
      // TILE_WAR the adapter's `army` is the NATIONAL pool, which both put the whole
      // army on the walls and double-counted it with the relief share (defForce) — so a
      // giant's capital was unstormable even with its field army pinned elsewhere. The
      // localization rides the lever (one measured change: war strength is local);
      // lever 0 keeps the adapter-pool fortress byte-identically.
      const pjCap = WAR_REACH > 0 ? projOf(att, def._homeTi) : 1;
      // ── The seat's GROUND joins its walls (T.REFUGE) ──────────────────────
      // The storm — the realm-killer — had no terrain term at all: a lagoon
      // city, an alpine eyrie and a plains town all stormed at bare homeMight,
      // which is why the map kept no mountain statelets (the countryside scan
      // above prices terrain, but losing countryside never kills a realm; the
      // storm does). The fortress now multiplies by the seat tile's river-moat/
      // high-ground/ridge hold (transport.js terrainHoldAt — the same physics
      // the tile defence uses, same engineering erosion, same cap), so a
      // defensible seat holds out and is starved or overawed into vassalage
      // instead (channels that already exist and are not gated on terrain).
      // ×1 exactly at lever 0.
      const seatS = TILE_WAR ? def._capital : def;
      const seatHold = T.REFUGE > 0 && seatS
        ? refugeHoldAt(world, (seatS.pos.y | 0) * tw + (seatS.pos.x | 0), (seatS.knowledge && seatS.knowledge.construction) || 0)
        : 1;
      // T.SIEGE_STARVE — THE WALLS EAT FROM THE GRANARY (the storm funnel's
      // verdict, docs/variance-arc-2026-08-13.md: 370/370 sieges failed on
      // the population-proportional militia floor, which no bombard can
      // grind — a populous capital could NEVER fall). History's sieges ended
      // by starvation: the fields are the besieger's, the city eats its
      // stores, and when they empty the militia withers. The hunger factor
      // is the famine law's own ratio (supply/core-need, once stores are
      // empty) — the fall clock is the GRANARY, so siege duration is
      // emergent: a stocked metropolis holds for years, an empty town for
      // weeks, and a relieved city (the field army breaking the siege)
      // re-supplies. Zero new constants.
      const hungerOf = (s2) => (T.SIEGE_STARVE && s2 && s2._besiegedNow && (s2.food || 0) <= 0.01)
        ? Math.max(0, Math.min(1, (s2._foodSupply || 0) / Math.max(1e-9, s2._coreNeed || 1))) : 1;
      const defHome = homeMight(WAR_REACH > 0 && TILE_WAR ? def._capital : def) * seatHold * hungerOf(seatS);
      // T.WAR_FINISH — LEVIES DO NOT STORM WALLS. The assault force is the
      // attacker's PROFESSIONAL share (c._proFrac, cached at muster): a
      // peasant levy blockades, forages and fights relief battles in the
      // field — escalade is regulars' work (Sumer to the middle ages, the
      // levy's uselessness at walls is a constant of siegecraft). The
      // defender's relief army (defForce0) keeps its levy — levies LIFT
      // sieges. This is what turns the measured storm firehose (557 falls
      // per 4k steps, capitals cycling) back into rare decisive events an
      // empire's professional core can still force. ×1 exactly at lever 0.
      const attCrec = world.countries && world.countries.get(acc);
      const proF = T.WAR_FINISH && attCrec && attCrec._proFrac != null ? attCrec._proFrac : 1;
      // T.ALLY_FRONT: the coalition's relief army stands with the defender at the
      // walls (already theatre-projected; +0 exactly at lever 0).
      const advCity = (attForce0 * pjCap * proF) / Math.max(1, (defForce0 + (pc._assistDef || 0) + defHome) * em);
      tel(world, "storm", "frontAtHeartland");   // FUNNEL (variance arc): why does no capital fall?
      // T.WAR_FINISH — the CAMP'S clock runs out (header at SIEGE_ENDURE):
      // past its logistics-stretched endurance, a camp before a city that
      // still EATS breaks before the walls do. The siege lifts, and the
      // campaign ends in a real treaty (signed after the loop): the truce
      // bars a re-siege until it lapses, so failed campaigns buy peace.
      if (siegeOpen) {
        const sg = siegeOpen.get(acc + ":" + dcc);
        if (sg) {
          const logi = attCrec && attCrec.capital ? (techEff(attCrec.capital).logisticsLevel || 0) : 0;
          const endure = (SIEGE_ENDURE * (1 + SIEGE_ENDURE_LOGI * logi)) / (world._dt || 1);
          if (world.step - sg.since > endure && hungerOf(seatS) > 0.5) {
            tel(world, "storm", "siegeLifts");
            siegeOpen.delete(acc + ":" + dcc);
            if (_siegeLifted && signPeace) _siegeLifted.push([acc, dcc]);
            continue;   // the host goes home — no storm, no countryside taken; the peace signs below
          }
        }
      }
      // A recently-conquered city is still pacified (garrisoned) and can't be
      // besieged yet — that grace stops rival empires trading it back and forth.
      if (advCity < T.CITY_STORM_RATIO) tel(world, "storm", "assaultTooWeak");
      else if (world.step - (def._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE) tel(world, "storm", "pacifiedGrace");
      // T.WAR_FINISH — THE STORM IS FOUGHT BY THE COMMITTED FORCE. The grind
      // and break tests below compared the walls against the attacker's
      // entire NATIONAL might (att._M — a relic from before the war-capacity
      // block existed): at the dense statelet register a 10-city realm's pool
      // is ~10× any young city's urban militia, so 87% of storm-strength
      // sieges broke the walls the SAME pass (grinding=60 vs PASSED=409 per
      // 4k, measured) and the register boiled. The force that fights the
      // assault is the force the capacity block actually COMMITS to this
      // front (attForce0 — concentration, exhaustion and multi-front splits
      // included), exactly what advCity above already prices: storming now
      // demands CONCENTRATION, so a many-front realm cannot instant-break
      // everywhere at once. ×att._M unchanged at lever 0.
      const stormM = T.WAR_FINISH ? attForce0 : att._M;
      if (advCity >= T.CITY_STORM_RATIO && world.step - (def._conqueredAt ?? -Infinity) >= T.CONQUEST_GRACE) {
        // Bombard: grind the garrison; the besiegers bleed against the defence
        // they actually face (the militia floor, not the melted garrison).
        {
          const dDef = Math.min(def.army || 0, stormM * pjCap * proF * SIEGE_DMG);   // the besieger grinds at PROJECTED PROFESSIONAL strength (×1 at lever 0)
          const dAtt = Math.min(att.army || 0, defHome * T.ATTRITION / techMul(att));
          def.army = (def.army || 0) - dDef;
          att.army = (att.army || 0) - dAtt;
          tallyDead(world, att.countryId, def.countryId, dDef + dAtt);
        }
        // Defence as the siege grinds on: the garrison falls, but never below
        // the (morale-weighted) citizen militia — homeMight recomputed on the
        // now-reduced garrison returns exactly that floor. (Under WAR_REACH the
        // fortress is the capital settlement's own garrison, whose grind lands via
        // the post-pass reconciliation — the siege wears it down pass over pass.)
        // The seat's ground holds through the siege too (T.REFUGE; ×1 at lever 0).
        const defNow = homeMight(WAR_REACH > 0 && TILE_WAR ? def._capital : def) * seatHold * hungerOf(seatS);
        // T.WAR_FINISH — the works clock (header at SIEGE_WORKS): a breach
        // needs the siege to have STOOD long enough to build one. Reads the
        // same continuous-siege stamp the endurance race uses; always done at
        // lever 0 (siegeOpen null — byte-identical).
        const _sgW = siegeOpen ? siegeOpen.get(acc + ":" + dcc) : null;
        const worksDone = !siegeOpen || (_sgW && world.step - _sgW.since >= SIEGE_WORKS / (world._dt || 1));
        const breakMet = defNow * em <= stormM * pjCap * proF * SIEGE_BREAK;   // a city encircled on many sides breaks sooner (its defence is split)
        if (breakMet && !worksDone) tel(world, "storm", "worksInProgress");
        if (!breakMet) tel(world, "storm", "wallsHold(grinding)");
        if (breakMet && worksDone) {
          // The SETTLEMENT that changes hands: under TILE_WAR `def` is a country adapter, so
          // the storm falls on its real capital (which fragments the realm); otherwise on the
          // settlement itself. Army mechanics below stay on `def`/`att` (the national pools).
          telPass(world, "storm");   // the throne-city falls — the cascade's trigger
          const dS = TILE_WAR ? def._capital : def;
          // Was this the capital of its realm? Under TILE_WAR the adapter IS the realm's seat.
          const dc = world.countries && world.countries.get(dcc);
          const defWasCapital = TILE_WAR ? true : !!(dc && dc.capitalId === dS.id);
          const oldId = dcc;
          // Defence broken — the throne-city falls to the attacker.
          dS.countryId = acc;
          recordOccupation(dS, oldId, acc, world.step);   // remember the nation it just lost (homeland)
          // Record the storm as a structured event. Names are captured at
          // event time so the log reads as contemporaries knew the actors.
          {
            const dName = dS.name || "a settlement";
            const toName = realmName(world, acc);
            if (defWasCapital && oldId >= 0) {
              logEvent(world, "polity.shattered", { polity: oldId, to: acc, toName,
                s: dS.id, sName: dName, x: dS.pos.x | 0, y: dS.pos.y | 0 });
            } else {
              logEvent(world, "settlement.captured", { s: dS.id, sName: dName, tier: dS.tier | 0,
                from: oldId, fromName: oldId >= 0 ? realmName(world, oldId) : undefined,
                to: acc, toName, x: dS.pos.x | 0, y: dS.pos.y | 0 });
            }
          }
          if (world.debug && world.debug.land) { world.debug.land.conquest++; const g = world.debug.land.gain; g.set(acc, (g.get(acc) || 0) + 1); }
          dS._conqueredAt = world.step;
          dS._sackedAt = world.step;   // stormed by force — production penalty in computeExportValue
          if (siegeOpen) siegeOpen.delete(acc + ":" + dcc);   // the race resolved — the walls broke first
          // GRIEV_LEDGER: the sack is the deepest wound a nation takes — the
          // dead, the enslaved (the captives below), the scattered. Counted as
          // a fraction of the city's people at the moment it fell.
          feedGrievance(world, oldId, acc, (dS.people || 0) * SACK_GRIEV_FRAC);
          // Captives: the sack of a city carries off part of its people into bondage —
          // war as the primary supply of the slave trade (the captor sells/works them).
          // × √slavePull (slavery.js): the sack happens for war reasons, but how much of
          // it is ENSLAVED rises with the victor's market — sub-linearly (the dealers who
          // followed the legions bought what they could carry, not the whole city).
          if (T.SLAVERY && T.CAPTURE_FRAC > 0 && (dS.people || 0) > 0) {
            // The CAPTOR is a real settlement — under TILE_WAR `att` is the transient
            // per-pass adapter, and writing the captives to it discarded them at end of
            // pass: war supplied ZERO slaves and ~CAPTURE_FRAC of every stormed
            // capital's people vanished (a conservation leak). Mirror the dS pattern
            // (def→def._capital): the victor's CAPITAL takes the captives, and the
            // slave-market pull is read at that capital's own trade component (the
            // adapter's id is a countryId — the wrong key space for _slaveScarcity).
            const captor = TILE_WAR ? att._capital : att;
            const taken = (dS.people || 0) * Math.min(0.5, T.CAPTURE_FRAC * Math.sqrt(slavePull(world, captor)));
            recordCaptives(captor, dS, taken);   // the carried-off carry who they are (SLAVE_PEOPLE)
            dS.people -= taken; captor._captives = (captor._captives || 0) + taken;
            fieldShift(world, dS, -taken);    // one population: the captive trains empty the LAND (FIELD_DEMOG); arrivals land where the market buys them
          }
          dS.loyalty = 0.35;   // a fresh conquest starts restless (conquest.js)
          dS._ambition = 0;    // a freshly subdued city isn't plotting (yet)
          dS.unrest = 0;       // the conquered populace is cowed for now
          // Spoils of war ease the victor's war-weariness (conquest.js unrest).
          const ag = getPolity(world, acc);
          if (ag) ag._spoils = Math.min(2, (ag._spoils || 0) + WAR_SPOILS);
          // PLUNDER: a sack strips a share of the city's portable coin into the victor's chest.
          if (ag && (dS.wealth || 0) > 0) {
            const plunder = (dS.wealth || 0) * PLUNDER_FRAC;
            dS.wealth -= plunder;
            ag.treasury = (ag.treasury || 0) + plunder;
            // Extraction income: plunder banks toward the victor elite's land-buying
            // (latifundia, conquest.js) — the same sack that supplies the CAPTIVES above
            // supplies the CASH that will demand them, so the whole estate complex rides
            // military dominance through two channels the slave market then clears.
            if (T.LATIFUNDIA) ag._conqFlow = (ag._conqFlow || 0) + plunder;
          }
          // Sack: a stormed CAPITAL loses its administrative apparatus (the dark-age trigger).
          if (T.KNOW_DECAY > 0 && dS.knowledge) {
            const hit = Math.min(0.5, (defWasCapital ? 0.22 : 0.10) * T.KNOW_DECAY);
            dS.knowledge.organization = Math.max(0, dS.knowledge.organization * (1 - hit));
            dS.knowledge.construction = Math.max(0, dS.knowledge.construction * (1 - hit * 0.6));
          }
          bankMomentum(world, acc, MOMENTUM_PER_STORM);   // a stormed city feeds the winning streak
          tallyDead(world, acc, oldId, (att.army || 0) * ASSAULT_ARMY_COST + (def.army || 0) * 0.7);
          att.army = Math.max(0, (att.army || 0) * (1 - ASSAULT_ARMY_COST));
          def.army = Math.max(0, (def.army || 0) * 0.3);
          // Capital fallen → the leaderless realm shatters into regional successors.
          if (defWasCapital) fragmentRealm(world, oldId, dS.id);
        }
      }
      continue;   // front's at the core — no countryside left to nibble here
    }

    const domCap = domCaptureOf(acc);   // a dominant realm sweeps more countryside per pass (Mongol-style blitz)
    if (CTRL_LIVE) {
      // War on the field: stamp forward pressure on the WHOLE contested front (the field
      // decides how far the border bulges, ∝ the winning margin adv−1); no direct tile grab.
      if (pc.tiles.length) {
        for (const p of pc.tiles) { const cti = p.ti; if (owner[cti] === def.id) { warFront[cti] = att.id; warAdv[cti] = adv - 1; } }
        const capT = Math.min(pc.tiles.length, T.MAX_CAPTURE * domCap * r2War);
        bankMomentum(world, att.countryId, (capT / r2War) * MOMENTUM_PER_TILE);
        bumpMove(att.countryId, def.countryId, (adv - 1) * (capT / r2War));   // field pressure = signed displacement (reference-tile units)
      }
      { const dAtt = Math.min(att.army || 0, def._M * pjD * T.ATTRITION / techMul(att)); const dDef = Math.min(def.army || 0, att._M * pjA * T.ATTRITION / techMul(def)); att.army = (att.army || 0) - dAtt; def.army = (def.army || 0) - dDef; tallyDead(world, att.countryId, def.countryId, dAtt + dDef); }
      continue;
    }
    const budget = Math.min(Math.round(T.MAX_CAPTURE * domCap * r2War), Math.floor((adv - 1) * CAPTURE_SCALE * domCap * r2War));
    // WHY does a live front take no ground? "86 wars, 1 settlement transferred in 12k
    // steps" was measured for two sessions with no way to see which half failed —
    // whether fronts never open, or open and then cannot convert an advantage into
    // tiles. `adv` is the attacker's margin: adv<=1 is a front that is not winning;
    // budget<1 is a front that IS winning but by too thin a margin for CAPTURE_SCALE
    // to round up to a single tile. Those need opposite fixes.
    tel(world, "capture", "CANDIDATE");
    if (!pc.tiles.length) tel(world, "capture", "noContestedTiles");
    else if (adv <= 1) tel(world, "capture", "attackerNotWinning(adv<=1)");
    else if (budget < 1) tel(world, "capture", "marginTooThinToTakeOneTile");
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
        // GRIEV_LEDGER: the people on the ground taken by force grieve the taker
        // (popField — the land's people, the canonical count). Fed HERE, at the
        // one tile-flip war writes, so peaceful absorption and border smoothing
        // never grieve; conquest.js decays it over generations.
        if (T.GRIEV_LEDGER && world.popField) feedGrievance(world, def.countryId, att.countryId, world.popField[cti]);
      }
      if (captured > 0) { telPass(world, "capture"); tel(world, "capture", "~tilesTaken", captured); }
      else tel(world, "capture", "allTilesTakenByAnotherAttacker");
      if (captured > 0) {
        bankMomentum(world, att.countryId, (captured / r2War) * MOMENTUM_PER_TILE);   // captured countryside feeds the streak (reference-tile units)
        bumpMove(att.countryId, def.countryId, captured / r2War);                      // signed displacement: nets against the counter-front's captures
      }
    }
    {
      const dAtt = Math.min(att.army || 0, def._M * pjD * T.ATTRITION / techMul(att));   // casualties dealt at range fall with projection (×1 at lever 0)
      const dDef = Math.min(def.army || 0, att._M * pjA * T.ATTRITION / techMul(def));
      att.army = (att.army || 0) - dAtt;
      def.army = (def.army || 0) - dDef;
      tallyDead(world, att.countryId, def.countryId, dAtt + dDef);
    }
  }

  // T.WAR_FINISH — the lifted sieges sign their peace through the full treaty
  // machinery (trade/toll-scaled duration, indemnity, congress; header at
  // SIEGE_ENDURE). Signed after the loop so a pass resolves all fronts first.
  if (_siegeLifted && _siegeLifted.length && signPeace) for (const [a, b] of _siegeLifted) signPeace(a, b, "siegeLifted");

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
      c._offEnemies = m ? new Set(m.keys()) : null;   // T.WAR_FINISH command-capacity gate reads WHO (an open war continues; only NEW enemies are refused)
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

  // TILE_WAR casualty RECONCILIATION: the pass fought with per-country ADAPTER armies (the
  // national pool); the losses are real, so drain each realm's member garrisons by the same
  // fraction the national army fell — so s.army reflects the battle below (manpower tally) and
  // at the next muster. Distributes proportionally, so a bled-white realm can't refield fast.
  if (TILE_WAR && adapters) {
    for (const [cc, ad] of adapters) {
      const start = ad._armyStart || 0;
      const loss = start - (ad.army || 0);
      if (loss <= 0 || start <= 0) continue;
      const frac = Math.min(1, loss / start);
      const mem = membersOf.get(cc);
      if (mem) for (const s of mem) s.army = Math.max(0, (s.army || 0) * (1 - frac));
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
