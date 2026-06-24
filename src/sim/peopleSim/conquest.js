// ── Polities (countries) ──────────────────────────────────────────────
//
// Every settlement belongs to a COUNTRY (s.countryId), starting as its own
// city-state. CONQUEST is carried out by armies (armies.js) — when an army
// captures a settlement it flips its countryId. This module handles the
// bookkeeping: grouping settlements into countries (capital = strongest
// member), tribute up to the capital, and SECESSION — the counter-force
// that fragments over-extended empires so they rise and fall.
//
// Secession is STICKY: a member must stay beyond the capital's hold range
// for a sustained grace period before breaking away. Without this, a town
// captured right at the frontier would secede the very next pass and get
// re-taken, making the borders flicker.

import { recordIn, recordOut, IN_AID, IN_STATE_PAY, IN_TARIFFS, OUT_TRIBUTE } from "./money.js";
import { shockUnrest } from "./shocks.js";
import { localEdgeCost } from "./transport.js";
import { personalityOf, inheritPersonality, driftPersonality, expansionReachMul } from "./personality.js";
import { CITY_TIER, resScaleFor } from "./countryTerritory.js";
import { techEff } from "./settlement.js";
import { realmName } from "./chronicle.js";
import { logEvent } from "./events.js";
import { ensurePolity, endPolity, getPolity, reconcilePolities } from "./entities.js";
import { identityWeightsNow, identityGrievance, adminFriction, identityGrievanceCause } from "./cohesion.js";
import { T } from "./tuning.js";

// POLITY_INTERVAL (the polity-pass cadence) is a runtime lever — see tuning.js
// (T.POLITY_INTERVAL); index.js gates the pass on it.
// Sub-city absorption requires the absorbing power to have at least this
// much ORGANISATION (state apparatus) before it can administratively
// swallow a touching village. Below this threshold the village stays
// independent — only direct conquest by armies can take it. Bronze-age
// society is the floor; chalcolithic and earlier are too primitive to
// integrate a foreign realm administratively.
// T.ABSORB_ORG_MIN (org-tech a city needs before it can peacefully vacuum
// neighbouring village/town statelets), T.ABSORB_PROB_MAX and ABSORB_RATE (the
// per-pass defection rate) are runtime levers — tuning.js. Raising the gate /
// lowering the rate keeps many small states alive deeper into the timeline.
// A realm may only absorb a new province while its admin load is below this
// fraction of its capacity — leaving slack so the freshly taken land lands
// INSIDE the budget instead of instantly over-extending and seceding back
// (the absorb↔secede oscillation that flipped whole swathes each pass).
const ABSORB_HEADROOM  = 0.90;
// Great-power engulfment of a weak STATELET: when a realm out-powers a
// neighbour's WHOLE country by this much, it can absorb that neighbour's
// settlements PAST its normal capacity headroom — up to LOPSIDED_HEADROOM ×
// capacity (a great power over-extends to swallow tiny states) and at the faster
// ENGULF_PROB rate. This is the consolidation force that pulls the late-game
// splotch of tiny states into a few multi-city empires; it only fires on
// lopsided matchups, so peer empires don't peel border villages off each other.
const LOPSIDED_ENGULF  = 5.0;   // a realm must out-power a neighbour's WHOLE country by this much to engulf it past its normal admin headroom (the great-power consolidation that merges city-states into multi-city empires — the source of provinces)
const ENGULF_PROB      = 0.35;  // per-pass engulf rate once lopsided
// Capacity ceiling for lopsided engulfment: a great power may over-extend to
// this MULTIPLE of its admin budget while engulfing statelets — enough to
// consolidate a neighbourhood of city-states into a multi-city empire, but NOT
// to swallow a continent. Past it, even a lopsided absorber must first shed an
// over-extended province (the over-budget frontier secedes) before it can take
// another — the boom-bust ceiling that stops one realm eating the whole map.
const LOPSIDED_HEADROOM = 1.6;
// A realm's whole country must out-power a neighbour's whole country by
// T.ABSORB_DOMINANCE before it can administratively absorb that neighbour's
// frontier settlements (absorbWeakNeighbors). Hysteresis: only clearly-minor
// neighbours erode, so comparable empires hold a stable border, not flip-flop.
// Down = aggressive consolidation (fewer/larger nations); up = multipolar.
// (Runtime lever — tuning.js T.ABSORB_DOMINANCE.)
// A landlocked territory fragment hemmed in on at least this fraction of its
// border by a SINGLE realm is treated as enclosed-inside-it and ceded to that
// realm (eliminateEnclaves) — cleaning up the marooned "bits stuck inside
// another country". 1.0 would mean only PERFECTLY enclosed bits; 0.8 also mops
// up a fragment whose border is mostly one neighbour with a sliver touching a
// third. (Regions containing a city are exempt — see eliminateEnclaves.)
const ENCLAVE_DOMINANCE = 0.80;
// A CITY-led region is normally only absorbed when FULLY (100%) enclosed — a seat
// of government doesn't change hands lightly. But that left small city-states
// DEEPLY ENGULFED by a great power persisting as parasitic specks marooned far
// inside it, with unnatural borders. So a city-led enclave whose sealed perimeter
// is ≥ CITY_ENCLAVE_DOMINANCE one realm, AND which that realm out-powers by
// ≥ CITY_ENCLAVE_POWER×, is peacefully ANNEXED instead. A genuine state (multi-city,
// not out-powered) still only changes hands by conquest. (SIM_CITY_ENCLAVE=0 reverts.)
const CITY_ENCLAVE_DOMINANCE = 0.90;
const CITY_ENCLAVE_POWER     = 1.5;
const _cityEnclaveOff = (typeof process !== "undefined" && process.env && process.env.SIM_CITY_ENCLAVE === "0") || false;
// Maximum per-polity-pass defection probability. Caps the rate at which
// a sub-city settlement can flip to a touching foreign realm — even a
// tiny village vs a massive cradle defects over multiple passes, never
// in a single tick. With POLITY_INTERVAL=150 and T.ABSORB_PROB_MAX=0.10,
// a fully-pressured village takes ~10 passes (~1500 ticks) on average.
// (Runtime lever — tuning.js T.ABSORB_PROB_MAX.)

// ── Government treasury (fiscal redistribution) ───────────────────────
// The realm's coin is taxed into a GOVERNMENT treasury (not the capital
// city's own purse) and spent straight back out — army pay to the garrisons,
// public works to the provinces. Because the state taxes and spends at the
// same high bandwidth (it touches every member directly, unlike throughput-
// limited trade), a roughly balanced budget keeps coin circulating to the
// periphery instead of pooling at the throne. Treasury lives on the
// persistent polity record (entities.js — stable across capital changes).
// ARMY_WAGE -> runtime lever (tuning.js T.ARMY_WAGE)
const WAR_SURCHARGE = 1.2;  // each level of war (defensive front / besieged capital) multiplies the army bill
const RESERVE_PASSES = 3;   // war-chest the state keeps (passes of peacetime army pay) before funding works
const SOLVENCY_FLOOR = 0.5; // a fully bankrupt state still retains this fraction of its control budget
// ── Debasement (Currency Phase 3) ──────────────────────────────────────
// A state that can't cover its army bill melts down the coinage — strikes
// lighter coins for emergency revenue (seigniorage). Its currency FINENESS
// falls, which weakens its foreign trade (roads.js reads gov.fineness), but the
// minted coin keeps the army paid a while longer — the classic war-finance
// spiral (Rome's denarius, every cash-strapped medieval crown). Solvent states
// slowly restore the coinage toward full fineness. T.DEBASE_AGGRO gates it.
const DEBASE_STEP       = 0.03;  // fineness lost per pass while debasing
const DEBASE_SEIGN_SCALE = 10;   // seigniorage = (fineness drop) × army bill × this — so revenue is
                                 // tied to the DROP and self-limits at the floor (no infinite minting)
const DEBASE_RECOVER    = 0.012; // fineness restored per pass when comfortably solvent
const FINENESS_MIN      = 0.35;  // floor — even a desperate mint keeps some metal in the coin

// ── Variable taxation ─────────────────────────────────────────────────
// The tax rate climbs under fiscal stress (war + insolvency) toward a cap — a
// desperate treasury squeezes harder. That funds the army, but the
// overtaxation feeds POPULAR UNREST: the classic trap where taxing to pay for
// a war drives the people to revolt (France 1789, late Ming, late Rome).
const TAX_BASE     = 0.06;   // baseline share of a member's wealth taxed per pass
// TAX_MAX -> runtime lever (tuning.js T.TAX_MAX)
const TAX_WAR      = 0.025;  // extra rate per level of war
const TAX_BANKRUPT = 0.12;   // extra rate × how insolvent the state was last pass
const TAX_DRIFT    = 0.25;   // how fast the actual rate moves toward its target (no whipsaw)
const COURT_SHARE  = 0.55;   // share of the realm's tax REVENUE consumed at the capital — the court,
                             // the central bureaucracy, the capital's monuments & clientele. This is what
                             // made a capital live on TAXES, not its own workshops (Versailles, Rome on
                             // provincial grain, the Forbidden City), so the seat reads as tax-funded. The
                             // REST funds the army & provincial works (disburseTreasury), the guns-vs-court tension.

// ── Popular unrest → rebellion ────────────────────────────────────────
// Unrest is a SECOND stock alongside loyalty (kept separate so neither masks
// the other): loyalty = administrative cohesion (overextension → orderly
// secession); unrest = popular grievance (hardship → destructive rebellion).
// It accumulates from hunger / conscription / war fatigue / overtaxation,
// cools in peace + plenty, bleeds loyalty, and at the top boils over.
const CONSCRIPT_REF = 0.15;  // garrison/pop fraction at which the conscription grievance saturates
const HUNGER_W   = 1.0;      // grievance weights (hunger dominates, as in history)
const CONSCRIPT_W = 0.4;
const WARFAT_W   = 0.5;
const OVERTAX_W  = 0.7;
// UNREST_GAIN -> runtime lever (tuning.js T.UNREST_GAIN)
const UNREST_RELIEF = 0.06;  // how fast unrest cools when the people are content
const UNREST_LOYALTY_BLEED = 0.12;  // an angry populace also erodes administrative loyalty
const UNREST_RADIUS_MIN = 15;       // a rebellion rallies discontented neighbours within this (or range)
const UNREST_JOIN = 0.6;            // a co-member this discontented joins a nearby uprising
const REBEL_POP   = 0.82;    // a rebellion costs a town this fraction of its people...
const REBEL_WEALTH = 0.5;    // ...this fraction of its wealth...
const REBEL_ARMY  = 0.4;     // ...and its garrison mutinies down to this
const RIOT_POP    = 0.90;    // the capital RIOTS instead of seceding: lighter damage, no breakaway
const RIOT_WEALTH = 0.65;
const RIOT_ARMY   = 0.7;
// Failed revolts (the bid was geographically un-viable — landlocked enclave
// surrounded by parent loyalists). Damage is between a riot and a rebellion
// — the rising actually fought, but lost. No new state forms.
const FAILED_REVOLT_POP    = 0.88;
const FAILED_REVOLT_WEALTH = 0.55;
const FAILED_REVOLT_ARMY   = 0.35;
const SPOILS_DECAY = 0.85;   // war-weariness relief (banked on conquest in armies.js) fades per pass

// The fiscal record IS the persistent polity entity (entities.js): treasury,
// revenue/spend, momentum and tax state all live on it and survive capital
// changes, conquest, and restoration.
export function govOf(world, countryId) {
  return ensurePolity(world, countryId, { silent: true });
}

// Bank conquest momentum onto the conquering country (armies.js calls this
// when it captures tiles / storms a city). Momentum adds hold-capacity in the
// polity pass and decays fast, so a stalled conqueror fragments — see the
// MOMENTUM_* block. The cap is applied on read in the polity pass.
export function bankMomentum(world, countryId, amount) {
  if (!(amount > 0)) return;
  const g = govOf(world, countryId);
  g._momentum = (g._momentum || 0) + amount;
}

// ── Control budget (overextension) ───────────────────────────────────
// An empire holds its provinces out of a finite CONTROL BUDGET projected
// from its CENTRE. Each province draws some of that budget (its admin
// LOAD, ∝ distance-to-liege / size / how recently it was taken); the
// realm spends the budget on its cheapest provinces first. Provinces that
// don't fit lose LOYALTY each pass and eventually secede; provinces that
// fit recover loyalty. Because the budget is computed from the capital's
// LIVE strength, a weakening capital (war, plague, a sacked throne)
// shrinks the budget and the frontier sheds — overextension becomes a
// dynamic event, not a fixed radius. Magnitudes are in "reach-units":
// a province sitting exactly at the capital's reach costs a load of ~1.
// CAP_BASE -> runtime lever (tuning.js T.CAP_BASE)
// CAP_SEAT -> runtime lever (tuning.js T.CAP_SEAT)
const SEAT_BONUS_CAP = 10;   // total seat contribution is capped (admin has diminishing returns)
// Coercive capacity (Tilly): how many provinces the centre can hold is EMERGENT
// from its coercive POWER, not fixed dials. capacity = CAP_K · log2(1 + capPower
// / POW_REF) + seat bonuses. A stronger capital (army + people + development)
// holds more; war / insolvency sap it; circumscription eases it. Replaces the
// old CAP_BASE / CAP_POP / CAP_ORG count-forcing dials.
//
// CAP_K is the coercion coefficient — how many reach-units of province a unit of
// log-power holds. It sets the SUSTAINABLE empire size: the floor a realm
// fragments back TO once conquest stalls and its over-reach sheds (secession is
// the perturbation; this is the equilibrium it relaxes toward). Too low and even
// an organised empire can hold only a handful of seats, so once secession works
// the whole map shatters into statelets and the country count runs away; too
// high and a realm holds everything it ever conquers and never fragments (the
// immortal juggernaut). Calibrated so a high-org capital sustains a real empire
// (~a dozen-plus seats) while still being out-conquerable past its budget — so
// great powers persist AND shed their over-extension.
const CAP_K   = 2.6;
const POW_REF = 380;
// Dominant-empire tail: a capital whose coercive power stands well ABOVE the typical
// capital of its age projects authority over a disproportionately larger realm — the
// few great powers (Rome, the Caliphate, the Mongol khans, Britain) that tower over a
// fragmented pack instead of the log2 compressing everyone to one uniform ceiling.
// Measured RELATIVE to the era's mean capital power (world._meanCapPower), so the
// global demographic scaling (index.js _eraProd) can't wash it out; bounded so the
// hegemon is dominant, not all-consuming, and self-limiting — a rising giant lifts the
// mean it is measured against.
const CAP_DOM_W   = 0.9;   // extra capacity per (above-average power)^P
const CAP_DOM_P   = 1.5;   // CONVEX: only genuine OUTLIERS tower — a power-law tail of a few great
                           // powers, not a uniformly bigger pack (sustainable size ≈ capacity^⅔, so
                           // the top core needs ~6–8× capacity to reach a Rome-scale share of the map)
const CAP_DOM_MAX = 8.0;   // ceiling on the dominance multiplier (a hegemon, not an immortal world-eater)
// Empire size is NOT capped. It emerges from the existing over-extension
// mechanism: provinces past a realm's REACH bleed loyalty and revolt. We gate
// that reach (`range`, the admin-load denominator) hard on transport tech below —
// so without roads/rail/telegraph a realm's conquests sit "too far", bleed
// loyalty, and break away on their own, making continental size very UNLIKELY
// (not impossible) before the tech to actually extend reach exists.
// Contiguity toll: projecting administrative authority THROUGH a foreign
// country's territory costs this much more per tile. So a province cut off from
// the capital's contiguous realm (an enemy wedge between them) reads as very far
// — its load spikes and it drifts to independence — while a connected province
// is reached normally. This is what makes an invasion that SPLITS an empire
// shear off the severed part as a successor state, instead of slow nibbling.
// (rival territory is now fully IMPASSABLE to reach — see capitalTransportCosts —
//  so a realm holds only what it can reach through its own land, wilderness or sea)
const COERCE_CAP    = 2.5;   // a far-stronger capital coerces a province (caps the load cut)
// SIZE_LOAD -> runtime lever (tuning.js T.SIZE_LOAD)
const SIZE_REF      = 1000;  // population scale for the size term
const RECENCY_LOAD  = 1.0;   // a freshly conquered province costs this much extra...
// RECENCY_TICKS -> runtime lever (tuning.js T.RECENCY_TICKS)
const LOYAL_RECOVER = 0.06;  // per pass: covered provinces climb toward full loyalty
// LOYAL_DECAY -> runtime lever (tuning.js T.LOYAL_DECAY)
// The deeper past the budget a province sits, the faster it bleeds loyalty —
// but UNCAPPED that term is ruinous: a realm holding 6× its budget (which the
// old absorb/conquest paths let happen) gave its frontier `over≈5`, so those
// provinces lost ~0.84 loyalty in a SINGLE pass and the whole over-extended tail
// seceded at once — a total political-map repaint every few passes (the "instant
// claiming back and forth"). Capping `over` turns that cliff into a slope: an
// over-stretched realm sheds its frontier ring by ring over several passes, so
// borders MOVE instead of teleporting. (The realm still loses the land — just
// legibly, as a retreat, not an implosion.)
const OVER_DECAY_CAP = 1.0;  // max value of the over-extension multiplier term
// How much the capital's ORGANIZATION slows an over-budget province's loyalty
// bleed (administrative glue: records, garrisons, integrated economy, roads).
// At org=1 a province bleeds at (1 − T.LOYAL_ORG_HOLD) of the base rate. THE
// empire-lifespan dial: low = even advanced empires fragment fast (short-lived
// empires, churny map); high → near-immortal great powers. (Runtime lever —
// tuning.js T.LOYAL_ORG_HOLD.)

// ── Contagious secession (amplifier) ──────────────────────────────────
// A revolt is regional, not solitary: when a province's loyalty collapses,
// it rallies the RESTLESS neighbours around it into one successor state
// (with their combined garrisons), instead of seceding alone only to be
// re-annexed next pass. This is what turns a frontier wobble into a real
// breakaway realm.
const REVOLT_JOIN_LOYALTY = 0.5;  // a co-member this disloyal joins a nearby uprising
// ── Historical homeland / national identity ──────────────────────────
// A settlement remembers the NATION it natively belongs to (`_homeland`, a
// country id; <0 means "I'm in my homeland now"). Conquest PRESERVES it — an
// occupied people keep their identity and yearn to restore it — so when their
// region revolts within living memory it re-emerges as that SAME country (its id,
// hue and history continue): Poland partitioned then restored. But identity FADES:
// after HOMELAND_MEMORY steps under occupation a settlement ASSIMILATES to its
// ruler (homeland cleared), and a late revolt there forms a NEW state on the old
// administrative lines instead. `_homelandFell` marks when it last left home.
const HOMELAND_MEMORY = 6000;   // ~a couple of generations before a conquered people assimilate
// Record that `s` changed hands fromId → toId (conquest / absorption): keep its
// native homeland, stamp when it first fell, and snap back to "native" if it was
// just RE-TAKEN by its own homeland.
export function recordOccupation(s, fromId, toId, step) {
  if (s._homeland === toId) { s._homeland = -1; s._homelandFell = -1; return; }   // home again
  if (s._homeland === undefined || s._homeland < 0) { s._homeland = fromId; s._homelandFell = step; }
  // else: already occupied by someone — keep its true homeland and original fall step
}
// ── Capital-fall fragmentation (amplifier) ────────────────────────────
// When the capital itself is stormed, the leaderless empire SHATTERS: the
// conqueror keeps the captured throne-city, but the far provinces don't
// meekly transfer — they break into regional successor states around their
// strongest surviving cities (the Diadochi after Alexander).
const FRAG_MAX_STATES = 12;   // CEILING on successor realms; the actual count scales with the dead realm's city-count (Roman few ↔ Chinese many)
const FRAG_SEPARATION = 18;   // successor capitals must be at least this far apart

// ── War duress (capacity catalysts) ───────────────────────────────────
// War throttles the control budget: a realm at war on several fronts has its
// army and attention split, and a realm whose CAPITAL is under attack is
// pinned defending the throne instead of governing the frontier. Both shrink
// capacity, so a realm stable in peace sheds provinces (via the loyalty
// budget + contagion) the moment it's pressured — the dynamic trigger for
// overextension. The effect lingers a window past the last front, then the
// budget recovers as the realm consolidates in peace.
const MULTIFRONT_PENALTY  = 0.35;  // each enemy beyond the first divides capacity by (1 + this)
const SIEGE_CAPACITY_MULT = 0.5;   // capital's heartland under assault → budget halved
const WAR_CAPACITY_MULT   = 0.8;   // capital's countryside merely raided → mild throttle
const SIEGE_WINDOW        = 300;   // ticks the siege/war throttle lingers after the last front
// Administrative RESILIENCE: how much an ORGANISED state shrugs off the war/
// fiscal-duress capacity throttle. A literate-bureaucratic empire (standing
// army, deep officialdom, roads, granaries) keeps governing its core while a
// frontier war rages; a chiefdom's levy disperses and its grip fails. At the
// capital's org × this fraction the throttle is eased toward 1 — so a high-org
// EMPIRE no longer sheds its provinces the instant a border skirmish flares
// (which was shattering every large realm the moment it consolidated), while a
// primitive realm still fragments under stress. (Keep < 1 so even the most
// advanced empire isn't perfectly war-proof — great powers still fall, just on
// a slower, deliberate timescale rather than at every frontier wobble.)
// (Runtime lever — tuning.js T.DURESS_RESILIENCE.)

// ── Conquest momentum (the rise-and-shatter of the steppe empire) ─────
// A realm on a winning streak coheres around the conquest itself: loot,
// prestige, fear, and shared enterprise hold a far larger domain together
// than its settled administration ever could — SO LONG AS IT KEEPS WINNING.
// The Mongols, Alexander, Timur, the Arab conquests, Attila: each held an
// impossible expanse on momentum, then shattered within a generation the
// moment the conquest stalled (no soft targets left, a lost battle, the
// khan's death). We model that with a per-country MOMENTUM stock (lives on
// the persistent gov object, keyed by countryId):
//   • FED by successful conquest — tiles captured + cities stormed
//     (banked in armies.js via bankMomentum).
//   • Each pass it ADDS hold-capacity (a conqueror holds far past its static
//     budget while the streak runs), then DECAYS fast.
//   • When the streak stops, momentum craters in a few passes → the capacity
//     it was propping up vanishes → the over-extended frontier sheds all at
//     once: a hard, Mongol-style fragmentation. (Hard snap, not a glide.)
// MOMENTUM_CAP -> runtime lever (tuning.js T.MOMENTUM_CAP)
const MOMENTUM_DECAY      = 0.55;  // per polity pass: momentum retained when not fed (hard snap)
export const MOMENTUM_PER_TILE  = 0.05;  // momentum banked per enemy tile captured
export const MOMENTUM_PER_STORM = 3.0;   // momentum banked per enemy CITY stormed

// ── Overmighty governor (ambition-driven secession) ───────────────────
// A powerful regional governor doesn't wait for the budget to fail. If his
// own city grows strong RELATIVE TO THE THRONE and sits on an independent
// power base — far from the capital, commanding his own vassals — he schemes,
// and eventually declares independence, taking his WHOLE sub-realm (his branch
// of the liege hierarchy) with him, loyal or not. War at the centre emboldens
// him. This is the breakaway duke / over-mighty subject, distinct from a
// frontier crumbling under an over-stretched budget. (A strong city RIGHT BY
// the capital is the loyal court / heir apparent — it tends to inherit the
// throne via rebuildCountries rather than secede.)
const AMBITION_RATIO   = 0.55;  // a governor at least this strong (vs the throne) starts to scheme
const AMBITION_MIN_FAR = 0.5;   // ...and at least this far out (reach-units); a core city stays loyal
const AMBITION_FAR     = 1.8;   // distance amplifies ambition this much
const AMBITION_GAIN    = 0.06;  // ambition-stock growth per pass at full margin
const AMBITION_DURESS  = 1.6;   // a besieged throne emboldens governors (multiplier)
// Naval administration is no longer a special-case discount on _isPort
// pairs — water embarkation in localEdgeCost (transport.js) gives the
// capital's Dijkstra a sea-highway over coastal water when it has
// navigation, so capitalTransportCosts() naturally reaches overseas
// members at a steeply discounted cost (≈3 per tile at full nav, vs
// Infinity below the embarkation threshold). Same effect, applied
// uniformly to every reach calculation.
// Economic hold: a province worth keeping is held far beyond the normal
// administrative range — the empire pours resources into clinging to it.
// This is the Spanish-silver effect: Potosí was the far side of the world,
// but the bullion made it worth a fleet and an army to keep. A member's
// pull = its mining income (the "valuables") plus a slice of its treasury
// (the tribute it can be milked for); its effective distance to the
// capital is divided by (1 + that pull), so rich colonies don't secede.
const VALUE_HOLD_CAP   = 4;       // richest provinces held from up to 5× the range
const MINE_HOLD_SCALE  = 0.15;    // per unit of mining income / tick
const TREASURE_HOLD_DIV = 60000;  // wealth that contributes one unit of pull (cap 2)
// Colonial support: a young colony draws food + coin from the mother
// country's capital each polity pass (and pays no tribute) until it matures.
const COLONY_SUPPLY_TICKS = 4000;
const COLONY_SUPPLY_FOOD  = 40;
const COLONY_SUPPLY_COIN  = 300;

function holdPull(s) {
  const mine = (s._minedRate || 0) * MINE_HOLD_SCALE;
  const treasure = Math.min(2, (s.wealth || 0) / TREASURE_HOLD_DIV);
  return 1 + Math.min(VALUE_HOLD_CAP, mine + treasure);
}
// How "fresh" a conquest still is, 1 (just taken) → 0 (fully digested).
// A newly seized province is restless and costs extra to administer; rapid
// expansion piles up this load and triggers indigestion-overextension.
function recencyFactor(world, s) {
  const age = world.step - (s._conqueredAt ?? -Infinity);
  if (!(age < T.RECENCY_TICKS)) return 0;   // also handles age === Infinity
  return 1 - age / T.RECENCY_TICKS;
}
// Base hold range (tiles) from the capital's reach techs — how far it can
// administer. Grows with organization/mobility/navigation; then SHRINKS
// with empire size (overstretch), so big empires can't hold their
// periphery and fragment into successor states.
const RANGE_BASE = 8 * 1.02, RANGE_ORG = 16 * 1.02, RANGE_MOB = 10 * 1.02, RANGE_NAV = 6 * 1.02;
// Transport-gated hold-distance (TECH_EFFECTS path): the dominant term is now
// LOGISTICS (roads → rail → telegraph), with admin a minor helper and horses/
// ships trimmed (they already feed the logistics channel). So a road-less realm
// can hold only a COMPACT core — distant conquests revolt — and continental
// SPREAD needs rail+telegraph. Diagnosis (probe_landconc) showed admin alone was
// projecting empires across continents without the transport history required.
const RANGE_BASE_T = 5, RANGE_LOGI = 24, RANGE_ADMIN = 2, RANGE_MOB_T = 4, RANGE_NAV_T = 3;
// A/B override for the resolution-scaling of the hold reach (rebuildCountries):
// unset → auto (resScaleFor, the fix); =1 → unscaled (reproduces the patchwork bug).
const _holdScaleEnv = (typeof process !== "undefined" && process.env && +process.env.SIM_HOLD_SCALE) || 0;
// Frontier-anchored secession (default on): a loose patch secedes only if it reaches
// the realm's outer edge, so breakaways peel off the frontier as solid chunks instead
// of carving holes out of the interior. SIM_FRONTIER_SECEDE=0 reverts (any loose patch sheds).
const _frontierSecede = !(typeof process !== "undefined" && process.env && process.env.SIM_FRONTIER_SECEDE === "0");
// (all ×1.02 re-anchor the 0.5-pivot expansionReachMul — personality.js;
//  c.range = RANGE_expr × reachMul, so behaviour is identical to the old form)

// ── Major-river administrative frontier ───────────────────────────────
// A great river is a natural border: holding a province on the FAR bank
// costs the centre extra reach to cross. The toll is CONSTRUCTION-gated —
// a chalcolithic realm (cons≈0) pays the full toll and is walled by a
// great river (the Rhine/Danube/Nile frontier effect), while an engineered
// realm (Roman pontoons, bridges) crosses it cheaply. Only MAJOR/GREAT
// rivers (mag ≥ 3) wall an empire; minor streams (mag 2) don't. The toll
// enters the admin load at FULL weight (unlike generic terrain, which is
// half-weighted) so rivers genuinely bound a low-tech empire's extent.
const RIVER_TOLL_MAX  = 6;     // reach-units to cross a major river at zero construction
const RIVER_TOLL_CONS = 5;     // construction shaves up to this off the toll
const RIVER_TOLL_MIN  = 0.5;   // floor — even a bridged crossing isn't free

// Toll for an edge that steps ONTO a major-river tile from a non-river
// tile — one charge per river crossed (travelling ALONG a river is free,
// so a riverine heartland isn't self-penalised). Returns 0 for any other
// edge. Construction bridges the toll down toward RIVER_TOLL_MIN.
function majorRiverToll(world, fromTi, toTi, cons) {
  const rm = world.riverMag;
  if (!rm) return 0;
  const toMajor   = rm[toTi]   >= 3 && world.elev[toTi]   > 0;
  if (!toMajor) return 0;
  const fromMajor = rm[fromTi] >= 3 && world.elev[fromTi] > 0;
  if (fromMajor) return 0;     // already on the river → travelling along it, not crossing
  return Math.max(RIVER_TOLL_MIN, RIVER_TOLL_MAX - cons * RIVER_TOLL_CONS);
}


// Military/administrative weight, used to pick the capital (strongest member).
export function settlementPower(s) {
  const e = techEff(s);
  const mil = e.military;                           // combat strength from war techs (tech.js)
  const org = 1 + e.reachLevel * 0.6;              // admin weight from the reach techs (Writing → Code of Laws → Democracy)
  return Math.max(1, s.people) * mil * org;
}

function dist(world, ax, ay, bx, by) {
  let dx = Math.abs(ax - bx); if (dx > world.tw / 2) dx = world.tw - dx;
  const dy = ay - by; return Math.sqrt(dx * dx + dy * dy);
}

// Group settlements into countries and choose each capital. Rebuilt every
// pass from the persistent s.countryId.
export function rebuildCountries(world) {
  const countries = new Map();
  // Resolution-invariant hold reach: the territorial reach (countryTerritory.js)
  // scales with the map so a realm claims the same FRACTION of the world at any
  // grid size — the admin/hold reach below MUST scale identically, or a big-map
  // realm claims far more than its (unscaled) grip can hold and its whole frontier
  // reads as chronically "loose", shedding scattered patches on every side every
  // time a seed collapses (the "patchwork secession, multiple sections, 2 sides"
  // artefact). At the 240-grid resScale=1 (unchanged); at the shipped 960 it's ×4.
  // (SIM_HOLD_SCALE env forces a fixed value, for A/B against the unscaled bug.)
  const resScale = _holdScaleEnv > 0 ? _holdScaleEnv : resScaleFor(world.tw);
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    s._isCapital = false;                                     // cleared; re-stamped on each realm's seat below
    if (s.countryId < 0) continue;   // stateless frontier settlements belong to no country
    let c = countries.get(s.countryId);
    if (!c) { c = { id: s.countryId, members: [], capital: null }; countries.set(s.countryId, c); }
    c.members.push(s);
  }
  for (const c of countries.values()) {
    let best = null, bp = -1, urb = null, bpu = -1;
    for (const s of c.members) {
      const p = settlementPower(s);
      if (p > bp) { bp = p; best = s; }
      if ((s.tier | 0) >= 1 && p > bpu) { bpu = p; urb = s; }   // the realm's leading URBAN centre
    }
    // A state's SEAT is its leading town/city — the court, market and garrison sit in
    // an urban centre, not a rural district. So prefer the top URBAN member; only a
    // WHOLLY rural realm seats at its largest region, until that region founds its
    // capital town (crystallize.js capital genesis + court relocation), after which
    // the town outranks the region here and becomes the seat. This is what stops a
    // realm's capital reading as a "farming region" once it has any town at all.
    best = urb || best;
    c.capital = best;
    c.capitalId = best.id;
    if (best) best._isCapital = true;
    const k = best.knowledge || {};
    const bE = techEff(best), bMob = k.mobility || 0, bNav = k.navigation || 0;
    const rangeOld = RANGE_BASE + bE.reachLevel * RANGE_ORG + bMob * RANGE_MOB + bNav * RANGE_NAV;
    const rangeNew = RANGE_BASE_T + bE.logisticsLevel * RANGE_LOGI + bE.reachLevel * RANGE_ADMIN + bMob * RANGE_MOB_T + bNav * RANGE_NAV_T;
    c.range = rangeOld + (rangeNew - rangeOld) * T.TECH_EFFECTS;   // transport-gated hold-distance (TE=0 → old admin-driven)
    // Personality nudges reach: an expansionist realm projects authority a
    // little farther, a cautious one pulls in. Knowledge still sets the bulk
    // of the reach — this is a mild temperament colouring on top (see
    // personality.js). The personality is lazily seeded from the capital's
    // environment the first time it's read.
    c.personality = personalityOf(world, c);
    c.range *= expansionReachMul(c.personality);
    // GRIP (hold reach): c.range is the realm's hold-distance in raw tile-cost — it
    // stays unscaled so it remains the Dijkstra SEARCH bound (maxCost = range×25),
    // which must not blow up with the map size (a ×4 there floods 16× the area and
    // froze the polity pass for seconds). The GRIP that's compared against actual
    // map distances — the admin load (d/grip) and the secession reach (effReach) —
    // is res-scaled so a big-map realm holds the same FRACTION it claims (the
    // territorial reach is res-scaled too; without this the surplus frontier reads
    // as chronically "loose" and sheds in scattered patches — see resScale note).
    c.holdReach = c.range * resScale;
    c.hue = ((c.id * 61) % 360 + 360) % 360;
    buildHierarchy(world, c);
    assignProvinces(world, c);
  }
  world.countries = countries;
  return countries;
}

// Administrative tree inside one country: every settlement answers to the
// NEAREST larger settlement (one of strictly higher tier), forming the
// chain village → town → regional city → capital. The capital is the root.
// Tribute then flows up this chain one level at a time, and the info panel
// can show the full lineage. Because each liege is strictly higher-tier than
// its vassal (capital excepted), the pointers can't cycle.
function buildHierarchy(world, c) {
  const members = c.members;
  for (const s of members) { s._vassalCount = 0; s._depth = 0; }
  for (const s of members) {
    if (s.id === c.capitalId) { s.liegeId = -1; continue; }
    const st = s.tier | 0;
    let best = c.capital, bestD = Infinity;
    for (const m of members) {
      if (m === s || (m.tier | 0) <= st) continue;        // liege must be larger
      const d = dist(world, s.pos.x, s.pos.y, m.pos.x, m.pos.y);
      if (d < bestD) { bestD = d; best = m; }
    }
    s.liegeId = best.id;
  }
  // Tally direct vassals (for the "provincial seat" role + display).
  const byId = new Map(); for (const m of members) byId.set(m.id, m);
  for (const s of members) {
    if (s.liegeId >= 0) { const L = byId.get(s.liegeId); if (L) L._vassalCount++; }
  }
}

// PROVINCES — assign every member to the nearest CITY of its realm (the capital
// is always a seat, even if it's only a town): a city plus the settlements nearest
// to it. Used by the GOVERNOR-revolt path (declareIndependence — an overmighty
// governor takes his whole province) and as a coarse admin grouping. NOTE:
// over-extension secession no longer sheds by this unit — it's tile-driven now
// (shedFrontier carves loose territory by the cities standing on it); and the
// drawn Provinces overlay is its own territory-catchment + homeland partition.
function assignProvinces(world, c) {
  const seats = [];
  for (const m of c.members) if (m.id === c.capitalId || (m.tier | 0) >= CITY_TIER) seats.push(m);
  if (seats.length === 0 && c.capital) seats.push(c.capital);
  for (const s of c.members) {
    let best = seats[0], bd = Infinity;
    for (const seat of seats) {
      const d = dist(world, s.pos.x, s.pos.y, seat.pos.x, seat.pos.y);
      if (d < bd) { bd = d; best = seat; }
    }
    s._provinceCity = best ? best.id : c.capitalId;
  }
}

// A breakaway needs a country id distinct from the parent realm. Country ids
// are settlement ids by convention, and the realm's id is its FOUNDER's id —
// which, once a stronger city has taken the capital role, may belong to an
// ordinary member that's now breaking away. So prefer the seed's id, but if
// that IS the parent realm's id, borrow another bloc member's id instead.
function freshCountryId(c, bloc) {
  if (bloc[0].id !== c.id) return bloc[0].id;        // seed's own id is free
  for (const m of bloc) if (m.id !== c.id) return m.id;
  return -1;                                          // degenerate: nothing distinct to use
}

// Mark a freshly-seceded / successor country so its territory SNAPS into place
// at once on the next render pass, rather than crawling out as a slow wave —
// secession is a political event (the province is its own that day), unlike a
// conquest front. Consumed + cleared in countryClaim.js relaxClaim.
function snapClaim(world, id) {
  if (id < 0) return;
  (world._claimSnap || (world._claimSnap = new Set())).add(id);
  // A state born of secession / fragmentation / re-emergence INHERITS a developed,
  // administered region — it should hold that region at once, not ramp its reach up
  // from the cradle base over thousands of steps (which left the territory it broke
  // off with sitting as wilderness in the meantime). Mark it so the territory pass
  // seeds its reach at the full (size-scaled) target immediately.
  (world._inheritReach || (world._inheritReach = new Set())).add(id);
}

// History rarely produced fully landlocked enclaves seceding from a still-
// functioning empire — the seceding state has no allies it can reach, no
// trade route the parent doesn't control, no escape route, so the parent
// simply sieges it forever. (Andorra-style microstates exist only because
// the surrounder LET them — by gift, not by force.) Capital-fall
// fragmentation is the historical exception and is handled separately.
//
// This predicate tests whether the bloc's combined territory touches
// ANYTHING that isn't the parent country — another country, unclaimed
// land, or sea. If yes, secession is geographically viable; if no, the
// bloc is fully enclosed and the attempt fails (the loyalty/ambition/
// unrest still discharges as DAMAGE — see ravage callers).
function hasOutsideBorder(world, parentCountryId, bloc) {
  const owner = world._territoryOwner;
  if (!owner || !world._byId) return true;            // no territory data yet → don't block
  const tw = world.tw, th = world.th, N = world.N;
  const blocIds = new Set();
  for (const m of bloc) blocIds.add(m.id);
  // Country of each tile-owner-id, cached so we don't look up countryId per tile.
  const ownerCountry = new Map();
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti]; if (oid < 0) continue;
    if (!blocIds.has(oid)) continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    // 4-neighbour border check (wrap in x).
    const xm = tx === 0 ? tw - 1 : tx - 1;
    const xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp,
                ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      const nOwner = owner[ni];
      if (nOwner < 0) return true;                    // unclaimed / sea = outside border
      if (blocIds.has(nOwner)) continue;              // tile owned by a bloc-mate, still "inside"
      let nc = ownerCountry.get(nOwner);
      if (nc === undefined) {
        const ns2 = world._byId.get(nOwner);
        nc = ns2 ? ns2.countryId : parentCountryId;
        ownerCountry.set(nOwner, nc);
      }
      if (nc !== parentCountryId) return true;        // touches a foreign country
    }
  }
  return false;                                       // fully enclosed by parent
}

// A successor state needs a SEAT of government to carry sovereignty — the
// same bar a stateless settlement must clear to FOUND a country in the first
// place (adoptAndFound uses CITY_TIER: a town or above can anchor a realm; a
// plain village is pure population and can't). Secession is held to that SAME
// threshold, not a stricter one: any bloc containing a tier ≥ CITY_TIER seat
// (town+) can break away as a country; a bloc of only villages has no seat and
// fails (it riots and re-pacifies instead). Requiring a full CITY (tier 2)
// here was the bug that made empires immortal — a realm built of towns and
// villages (the normal case: a town capital ruling a sea of villages) had NO
// member that could ever lead a breakaway, so its frontier revolts ALL failed
// the gate, re-pacified, and stayed however far past the hold budget it sat.
function blocHasCity(bloc) {
  for (const m of bloc) if ((m.tier | 0) >= CITY_TIER) return true;
  return false;
}

// Trim a candidate revolt bloc to the members that form a CONTIGUOUS region
// with the seed — reachable from the seed by walking the PARENT REALM's own
// contiguous land (the country Voronoi, _countryOwner) within the revolt
// radius. Walking the realm itself — not the sparse per-settlement catchments
// — is what lets a regional uprising rally a whole frontier PROVINCE (the
// towns and the villages between them) into ONE successor state, instead of
// each town breaking away alone as a 1-member fleck (the lone-town nibbling
// that never actually fragmented an empire). A member marooned across the sea,
// or behind a foreign wedge that severs its land link to the revolt's core,
// can't physically follow and stays with the parent. Flooding outward from the
// seed (bounded by the radius disk) keeps this cheap — no full-map scan.
function filterToConnectedBloc(world, bloc, seed, radius) {
  const co = world._countryOwner;
  if (!co) return bloc;                            // no political map yet — fall back to as-given
  const tw = world.tw, th = world.th;
  const parentId = seed.countryId;
  // Home tile → member, so the flood marks which candidates it reaches.
  const homeOf = new Map();
  for (const m of bloc) homeOf.set((m.pos.y | 0) * tw + (m.pos.x | 0), m);
  // An optional radius keeps a contagious REVOLT regional; the ambition/rebellion
  // paths pass none (Infinity) and flood the whole connected branch instead.
  const sx = seed.pos.x | 0, sy = seed.pos.y | 0;
  const r2 = (radius && isFinite(radius)) ? radius * radius : Infinity;
  const start = sy * tw + sx;
  const reached = new Set([seed]);
  const visited = new Set([start]);
  const q = [start];
  while (q.length) {
    const ti = q.pop();
    const hit = homeOf.get(ti); if (hit) reached.add(hit);
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp,
                ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k]; if (ni < 0 || visited.has(ni)) continue;
      const ny = (ni / tw) | 0, nx = ni - ny * tw;
      const hit2 = homeOf.get(ni); if (hit2) reached.add(hit2);  // a member sitting right on the border still joins
      if (co[ni] !== parentId) continue;           // only flood through the parent's own contiguous land
      let dx = Math.abs(nx - sx); if (dx > tw / 2) dx = tw - dx;
      const dy = ny - sy;
      if (dx * dx + dy * dy > r2) continue;         // stay within the revolt radius
      visited.add(ni); q.push(ni);
    }
  }
  return bloc.filter(m => reached.has(m));
}

// ── Provincial secession: an over-stretched empire sheds whole PROVINCES ──
// History never fragmented an empire one town at a time. The unit of secession
// was a REGION with its own seat of government and army — a province under its
// governor, a satrapy under its general, an ulus under its khan — and when the
// centre weakened that regional seat carried its WHOLE administrative branch (its
// towns and the villages beneath them) out of the realm. Adjacent restless
// provinces then rallied to the strongest seat among them into ONE successor
// state: Rome shedding the Gallic Empire (Gaul+Britain+Hispania under the general
// Postumus) and the Palmyrene Empire (Egypt+Syria under Zenobia) in the Crisis of
// the Third Century; the Mongol realm splitting along its ulus/appanage lines into
// the four khanates after Möngke's death; Alexander's empire carved among the
// Diadochi by satrapy. So secession here is at the granularity of the PROVINCE —
// a top-level seat (a city/town answering directly to the capital) plus its whole
// subtree — and neighbouring restless provinces COALESCE under the strongest
// regional seat. An empire fragments into a few large successor realms along its
// administrative seams, never into a confetti of single seceding towns.

// HOMELAND RESTORATION: among `members` currently held by `ownerId`, each distinct
// fallen nation (`_homeland`) that is FULLY GONE and forms a viable contiguous bloc
// (≥2 settlements rallying a seat — its historical capital if risen, else a town)
// re-emerges as that SAME country — its id, hue (derived from id) and history
// continue: Poland restored, the USSR back into its republics, Rome shedding Gaul
// AS Gaul. A nation that still flies its flag somewhere (a live rump) is left for
// reunification, not cloned. `requireBorder` is set for a GRADUAL revolt (a
// breakaway needs an outside edge); it's waived on TOTAL collapse (the realm is
// dissolving anyway). Runs before any city-based fragmentation. Returns the ids.
function restoreNations(world, members, ownerId, requireBorder) {
  const restored = new Set();
  const live = new Set();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) live.add(s.countryId);
  const byH = new Map();
  for (const m of members) {
    const Hh = m._homeland ?? -1;
    if (Hh < 0 || m.countryId !== ownerId) continue;
    let a = byH.get(Hh); if (!a) byH.set(Hh, a = []); a.push(m);
  }
  for (const [H, group] of byH) {
    if (live.has(H)) continue;          // a rump still flies the old flag — reunify, don't clone
    if (group.length < 2) continue;     // too small to be a state, not a whole province
    // Seat = the historical capital (whatever its tier now — a fallen capital
    // still rallies its nation), else the strongest TOWN-or-better among the
    // risen. A bloc of mere villages has no seat to re-form a state around. (No
    // full-CITY bar: that was to stop single-TOWN confetti, which the
    // ≥2-contiguous-settlements + town-seat rule already prevents for a nation.)
    let seat = group.find(m => m.id === H);
    if (!seat) for (const m of group) if ((m.tier | 0) >= 1 && (!seat || settlementPower(m) > settlementPower(seat))) seat = m;
    if (!seat) continue;                // only villages, and not even the old capital
    const bloc = filterToConnectedBloc(world, group, seat, Infinity);   // the WHOLE connected nation
    if (bloc.length < 2) continue;
    if (requireBorder && !hasOutsideBorder(world, ownerId, bloc)) continue;
    // Re-open the nation's persistent record (logs polity.restored); its
    // temperament is still on it, so inherit only fills a genuine void
    // (a nation that fell before it ever had a recorded character).
    ensurePolity(world, H, { how: "restored", seat, from: ownerId, fromName: realmName(world, ownerId) });
    inheritPersonality(world, ownerId, H);
    snapClaim(world, H);
    if (world.debug) world.debug.restored = (world.debug.restored || 0) + 1;
    for (const m of bloc) {
      m.countryId = H; m._homeland = -1; m._homelandFell = -1;    // home again
      m.loyalty = m === seat ? 1 : 0.85; m._ambition = 0; m._conqueredAt = world.step;
      restored.add(m.id);
    }
  }
  return restored;
}

// ── Tile-driven frontier secession ───────────────────────────────────────
// Authority is a FIELD over territory — strongest at the capital, decaying with
// transport distance — and settlements just sit on it. When a realm over-stretches
// its grip pulls inward (the effective reach shrinks with STRESS), and the tiles
// that fall outside it go LOOSE. A contiguous loose patch that has actually turned
// restless (it carries a loyalty-collapsed seed — the gradual hysteresis still
// decides WHEN) sheds: the patch is partitioned among the CITIES standing on it (a
// nearest-city watershed) and every such cell secedes as a successor. So the
// NUMBER of pieces scales with how far the collapse reaches — a thin frontier band
// with one city peels off as one breakaway (edge erosion); a besieged, insolvent
// empire whose grip has collapsed across many provinces shatters into many warlord
// successors (Chinese-style) or a few large blocks (Roman) depending on how many
// cities the loose zone holds. A loose patch with NO city is abandoned to the
// wilderness: its settlements fall stateless and the land reverts — the edge of
// empire simply recedes. Fallen nations still re-emerge as themselves first.
function shedFrontier(world, c, seeds, tcosts, range, stress) {
  // Fallen-nation re-emergence first: an occupied homeland that has turned
  // restless returns as ITSELF before any fresh successor is carved from it.
  const seededH = new Set();
  for (const sd of seeds) if (sd.countryId === c.id && (sd._homeland ?? -1) >= 0) seededH.add(sd._homeland);
  if (seededH.size) {
    const restless = c.members.filter(m => m.countryId === c.id && seededH.has(m._homeland ?? -1)
      && (m.loyalty ?? 1) <= REVOLT_JOIN_LOYALTY && world.step - (m._conqueredAt ?? -Infinity) >= T.CONQUEST_GRACE);
    restoreNations(world, restless, c.id, true);
  }
  const co = world._countryOwner, owner = world._territoryOwner, localCost = world._countryCost;
  if (!co || !owner) return;
  const tw = world.tw, th = world.th, N = world.N;
  // The grip shrinks with stress (over-extension + war + insolvency are all folded
  // into the capacity the stress was measured against): the more over-stretched the
  // realm, the more of it falls outside reach and goes loose.
  const effReach = range / (1 + T.SECEDE_GRIP * Math.max(0, stress));
  const seedSet = new Set(seeds.map(s => s.id));
  // Capital transport-distance per tile ≈ (capital → the settlement that administers
  // it) + (that settlement → the tile): reuse the per-member costs and the territory
  // cost field, so there's no extra per-tile Dijkstra. A tile is LOOSE when that
  // exceeds the (stress-shrunk) grip. Gap-fill interior (no settlement basin) stays.
  const memberHome = new Map();
  for (const m of c.members) if (m.countryId === c.id) memberHome.set((m.pos.y | 0) * tw + (m.pos.x | 0), m);
  const looseAt = (ti) => {
    if (co[ti] !== c.id) return false;
    const m = owner[ti]; if (m < 0) return false;
    const cd = tcosts.get(m);
    if (cd === undefined || !isFinite(cd)) return true;            // an unreachable holding is loose by definition
    const lc = localCost ? localCost[ti] : 0;
    return cd + (isFinite(lc) ? lc : 0) > effReach;
  };
  // Flood contiguous loose patches. A patch secedes only if it (a) carries a restless
  // seed AND (b) reaches the realm's FRONTIER — its outer border with wilderness, the
  // sea, a rival, or the world edge. A purely INTERIOR loose pocket (a hard-to-reach
  // massif ringed by held core, or anything far in cost from an off-centre capital) is
  // NOT carved out: doing so punched a hole or cut the realm in two — the "secession in
  // the middle / odd shape cutting all the way through" artefact. So a breakaway is
  // always a contiguous chunk peeling off the EDGE; an unreachable interior just stays
  // nominally held until the front itself recedes to it. (SIM_FRONTIER_SECEDE=0 reverts.)
  const seen = new Uint8Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (seen[s0] || !looseAt(s0)) continue;
    const stack = [s0]; seen[s0] = 1; let hasSeed = false, touchesEdge = false; const members = [];
    while (stack.length) {
      const ti = stack.pop();
      const hm = memberHome.get(ti);
      if (hm) { members.push(hm); if (seedSet.has(hm.id)) hasSeed = true; }
      const ty = (ti / tw) | 0, tx = ti - ty * tw, xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      for (let k = 0; k < 4; k++) {
        const ni = ns[k];
        if (ni < 0) { touchesEdge = true; continue; }     // world edge (pole) = frontier
        if (co[ni] !== c.id) touchesEdge = true;          // neighbour is wilderness / sea / a rival → patch reaches the realm's edge
        if (seen[ni] || !looseAt(ni)) continue;
        seen[ni] = 1; stack.push(ni);
      }
    }
    if (hasSeed && members.length && (touchesEdge || !_frontierSecede)) shedPatch(world, c, members);
  }
}

// Carve one loose patch loose. The patch SECEDES as its own state(s): each CITY on
// it anchors a successor and the settlements join their nearest such city (a
// watershed) — #cities → #pieces, so severity sets the shape. If the patch has no
// city, its strongest TOWN leads a single frontier state (the land doesn't
// evaporate just because no metropolis sits on it). Only a lone village or empty
// over-claimed tiles have no government to inherit: those fall stateless and the
// land reverts to wilderness (the rim recedes).
function shedPatch(world, c, members) {
  let seats = members.filter(m => (m.tier | 0) >= CITY_TIER && m.id !== c.capitalId);
  if (seats.length === 0) {
    // No city — the biggest town becomes a frontier capital, provided the patch is
    // a real region (a seat plus at least one dependent), not a single hamlet.
    const towns = members.filter(m => (m.tier | 0) >= 1 && m.id !== c.capitalId);
    if (towns.length && members.length >= 2) {
      let best = towns[0]; for (const t of towns) if (settlementPower(t) > settlementPower(best)) best = t;
      seats = [best];
    }
  }
  if (seats.length === 0) {
    // Genuinely marginal frontier (a lone village, or bare tiles): no polity forms.
    for (const m of members) {
      if (m.countryId !== c.id) continue;
      m.countryId = -1; m.loyalty = 1; m._ambition = 0; m._conqueredAt = world.step;   // falls stateless; tiles revert
      logEvent(world, "settlement.lapsed", { s: m.id, sName: m.name, from: c.id, fromName: realmName(world, c.id) });
    }
    return;
  }
  const groups = new Map();
  for (const seat of seats) groups.set(seat.id, []);
  for (const m of members) {
    if (m.countryId !== c.id) continue;
    let best = seats[0], bd = Infinity;
    for (const seat of seats) { const d = dist(world, seat.pos.x, seat.pos.y, m.pos.x, m.pos.y); if (d < bd) { bd = d; best = seat; } }
    groups.get(best.id).push(m);
  }
  for (const seat of seats) {
    const grp = groups.get(seat.id);
    if (!grp || !grp.length) continue;
    const newId = freshCountryId(c, [seat, ...grp.filter(m => m !== seat)]);   // the seat leads (its own id, unless that IS the parent)
    if (newId < 0) continue;
    ensurePolity(world, newId, { silent: true, seat });
    inheritPersonality(world, c.id, newId);        // successor inherits the parent's temperament (with drift)
    snapClaim(world, newId);                       // the cell is its own that day (instant, not a slow wave)
    for (const m of grp) {
      m.countryId = newId;
      if (m._homeland === newId) { m._homeland = -1; m._homelandFell = -1; }   // re-formed its own old nation → home
      m.loyalty = m === seat ? 1 : 0.8;
      m._ambition = 0;
      m._conqueredAt = world.step;                 // anti-flicker grace
    }
    logEvent(world, "polity.seceded", { polity: newId, from: c.id, fromName: realmName(world, c.id),
      seatName: seat && seat.name, x: seat ? seat.pos.x | 0 : undefined, y: seat ? seat.pos.y | 0 : undefined });
  }
}

// The throne has fallen: scatter the dead empire's surviving provinces into
// regional successor states around their strongest cities. Called from
// armies.js the moment a capital is stormed. The conqueror (excludeId) keeps
// only the captured throne-city; everything else fragments.
export function fragmentRealm(world, oldId, excludeId) {
  // The conqueror sacks the treasury — the fallen state's war-chest is seized
  // into the victor's coffers (keeps the coin conserved + a great war prize).
  // Only zero the dead chest once it has actually been CREDITED somewhere; if
  // the conqueror can't be resolved the coin stays put (and rides along if the
  // nation is later restored under the same id) instead of being destroyed.
  const deadName = realmName(world, oldId);
  {
    const dead = getPolity(world, oldId);
    if (dead && dead.treasury > 0) {
      const conq = world._byId ? world._byId.get(excludeId) : null;
      if (conq && conq.countryId != null && conq.countryId >= 0) {
        govOf(world, conq.countryId).treasury += dead.treasury;
        dead.treasury = 0;
      }
    }
  }
  {
    const conq = world._byId ? world._byId.get(excludeId) : null;
    const by = conq && conq.countryId != null ? conq.countryId : -1;
    endPolity(world, oldId, "conquest", by, by >= 0 ? realmName(world, by) : undefined);
  }
  let survivors = [];
  for (const s of world.settlements) {
    if (s.mode === "settled" && s.countryId === oldId && s.id !== excludeId) survivors.push(s);
  }
  if (survivors.length === 0) return;
  // The dying realm's occupied nations (still in living memory) re-emerge as
  // THEMSELVES — same id, hue, history; only the native/assimilated remainder
  // fragments into city-based successors below (the Diadochi case).
  const restoredIds = restoreNations(world, survivors, oldId, false);
  if (restoredIds.size) survivors = survivors.filter(s => !restoredIds.has(s.id));
  if (survivors.length === 0) return;
  if (survivors.length === 1) {
    const s = survivors[0];
    ensurePolity(world, s.id, { how: "fragment", seat: s, from: oldId, fromName: deadName });
    inheritPersonality(world, oldId, s.id);       // lone successor keeps the old realm's temperament
    snapClaim(world, s.id);                        // the realm shatters at once, not as a wave
    s.countryId = s.id; s.loyalty = 1; s._conqueredAt = world.step;
    return;
  }
  // Successor capitals: the strongest surviving cities, spread apart so the
  // fragments are genuinely separate regions rather than rivals next door. How
  // MANY scales with the dead realm's size — a compact empire splits into a
  // couple of large successors (Roman/Diadochi), a sprawling many-citied one
  // shatters into a crowd of warlord states (Chinese): the number of pieces
  // tracks the severity/scale of the collapse, not a fixed cap.
  const cityCount = survivors.reduce((n, s) => n + ((s.tier | 0) >= CITY_TIER ? 1 : 0), 0);
  const maxStates = Math.max(2, Math.min(FRAG_MAX_STATES, Math.ceil(cityCount / 2)));
  const ranked = survivors.slice().sort((a, b) => settlementPower(b) - settlementPower(a));
  const capitals = [];
  for (const s of ranked) {
    if (capitals.length >= maxStates) break;
    let far = true;
    for (const cap of capitals) {
      if (dist(world, s.pos.x, s.pos.y, cap.pos.x, cap.pos.y) < FRAG_SEPARATION) { far = false; break; }
    }
    if (far) capitals.push(s);
  }
  // Each successor realm inherits the dead empire's temperament (with drift),
  // so the Diadochi share their predecessor's character before diverging.
  for (const cap of capitals) {
    ensurePolity(world, cap.id, { how: "fragment", seat: cap, from: oldId, fromName: deadName });
    inheritPersonality(world, oldId, cap.id);
    snapClaim(world, cap.id);
  }
  // Each survivor joins its nearest successor capital.
  for (const s of survivors) {
    let best = capitals[0], bd = Infinity;
    for (const cap of capitals) {
      const d = dist(world, s.pos.x, s.pos.y, cap.pos.x, cap.pos.y);
      if (d < bd) { bd = d; best = cap; }
    }
    s.countryId = best.id;
    s.loyalty = s.id === best.id ? 1 : 0.9;
    s._conqueredAt = world.step;                  // successors get breathing room (grace)
  }
}

// An overmighty governor declares independence and takes his sub-realm with
// him — the whole liege branch under `seed` follows their lord into the new
// state, regardless of their own loyalty.
function declareIndependence(world, c, seed) {
  // The governor takes his PROVINCE — his city plus the settlements nearest to it
  // (assignProvinces); the whole region follows its lord out.
  let bloc = c.members.filter(m => m.countryId === c.id && (m._provinceCity ?? c.capitalId) === seed.id);
  // Only settlements whose tiles connect to the governor's through the realm's own
  // land can physically follow him — one stranded across the sea or behind a
  // foreign wedge stays with the parent. (No radius: the whole connected province
  // follows its lord, however far it reaches.)
  bloc = filterToConnectedBloc(world, bloc, seed, Infinity);
  const newId = freshCountryId(c, bloc);
  if (newId < 0) { seed._ambition = 0; return; }                       // can't split cleanly — vent it
  // Even an ambitious governor can't carve out an enclave with no
  // outside border — his bid is crushed by the surrounding loyalists.
  // The plot still costs him (army loss, ambition reset, cooldown).
  if (!hasOutsideBorder(world, c.id, bloc) || !blocHasCity(bloc)) {
    for (const m of bloc) {
      ravage(m, FAILED_REVOLT_POP, FAILED_REVOLT_WEALTH, FAILED_REVOLT_ARMY);
      m._ambition = 0;
      m.loyalty = 0.5;
      m._conqueredAt = world.step;
    }
    return;
  }
  ensurePolity(world, newId, { silent: true, seat: seed });
  inheritPersonality(world, c.id, newId);        // the breakaway carries its parent's temperament (with drift)
  snapClaim(world, newId);                        // instantaneous secession
  for (const m of bloc) {
    m.countryId = newId;
    m._conqueredAt = world.step;                 // the breakaway realm gets breathing room (grace)
    m._ambition = 0;
    m.loyalty = m === seed ? 1 : 0.9;            // vassals are committed to their lord's new realm
  }
  logEvent(world, "polity.seceded", { polity: newId, from: c.id, fromName: realmName(world, c.id),
    seatName: seed && seed.name, x: seed ? seed.pos.x | 0 : undefined, y: seed ? seed.pos.y | 0 : undefined });
}

// Damage a town in a rising — people die or flee, wealth is looted, the
// garrison mutinies.
function ravage(s, popMul, wealthMul, armyMul) {
  s.people = Math.max(1, (s.people || 0) * popMul);
  s.wealth = Math.max(0, (s.wealth || 0) * wealthMul);
  s.army   = Math.max(0, (s.army || 0) * armyMul);
}

// A popular REBELLION (distinct from an orderly secession): each boiled-over
// town guts itself and rallies the discontented HEARTLAND around it into a
// rebel state — destructive, and able to fire in the core, not just the edge.
// The capital can't break from itself, so it RIOTS instead (damage, no
// breakaway) — a starving throne loses people, shrinking the control budget.
function rebel(world, c, seeds) {
  const radius = Math.max(UNREST_RADIUS_MIN, c.holdReach || c.range);   // rally radius is a map distance → res-scaled grip
  for (const seed of seeds) {
    if (seed.id === c.capitalId) {            // the throne riots, it doesn't secede
      ravage(seed, RIOT_POP, RIOT_WEALTH, RIOT_ARMY);
      seed.unrest = 0;
      continue;
    }
    if (seed.countryId !== c.id) continue;    // already swept into an earlier rising this pass
    let bloc = [seed];
    for (const m of c.members) {
      if (m === seed || m.countryId !== c.id || m.id === c.capitalId) continue;
      if ((m.unrest ?? 0) < UNREST_JOIN) continue;                    // content → doesn't rise
      const pacified = world.step - (m._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE;
      const infant   = m.parentSettlementId >= 0 && world.step - (m.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (pacified || infant) continue;                              // garrison holds it down for now
      if (dist(world, seed.pos.x, seed.pos.y, m.pos.x, m.pos.y) > radius) continue;
      bloc.push(m);
    }
    // Connectivity filter — the rising rallies the contiguous heartland around
    // the seed; members it can't reach through the realm's own land can't follow
    // (see filterToConnectedBloc). The seat is the strongest member (rebuildCountries).
    bloc = filterToConnectedBloc(world, bloc, seed, radius);
    const newId = freshCountryId(c, bloc);
    if (newId < 0) { seed.unrest = 0; continue; }
    // A landlocked rebellion can RIOT (do damage) but can't carve out a
    // sovereign state — the parent's loyal provinces surround and crush it.
    // The pressure still vents (unrest reset, towns damaged, grace), it
    // just doesn't produce a successor realm.
    if (!hasOutsideBorder(world, c.id, bloc) || !blocHasCity(bloc)) {
      for (const m of bloc) {
        ravage(m, REBEL_POP, REBEL_WEALTH, REBEL_ARMY);
        m.unrest = 0;
        m.loyalty = 0.5;
        m._conqueredAt = world.step;
      }
      continue;
    }
    snapClaim(world, newId);                   // a rebellion seizes its territory at once
    ensurePolity(world, newId, { silent: true, seat: seed });
    for (const m of bloc) {
      ravage(m, REBEL_POP, REBEL_WEALTH, REBEL_ARMY);
      m.countryId = newId;
      m.unrest = 0;                            // the rising vents the grievance
      m.loyalty = 1;                           // loyal to the new rebel realm
      m._conqueredAt = world.step;             // resists immediate re-annex (anti-flicker)
    }
    logEvent(world, "polity.seceded", { polity: newId, from: c.id, fromName: realmName(world, c.id),
      seatName: seed && seed.name, x: seed ? seed.pos.x | 0 : undefined, y: seed ? seed.pos.y | 0 : undefined });
  }
}

// Spend the treasury, army first. The army has the FIRST claim on the
// treasury; if it can't be paid in full the state is INSOLVENT (gov._solvency
// < 1), which both makes garrisons desert (armies.js) and throttles the
// control budget (capacity) — the fiscal-military collapse trigger. Only the
// surplus above a war-chest reserve is spent on public works / dole.
function disburseTreasury(world, c, gov, warLevel) {
  const members = c.members;
  // Wages and the reserve scale with the realm's local price level
  // (inflation.js). An inflated economy needs more coin to pay the same
  // soldiers — Spain-after-Potosí dynamics — and the war-chest grows with
  // the wage bill so a state still has a couple of passes' buffer at any P.
  // (b) NOMINAL-inflation model: army wages are REAL (base), not × the price
  // level — the absolute money supply doesn't bankrupt states. (localP still
  // drives Hume + the ticker; debasement's bite comes via FX/seigniorage later.)
  const realmP = 1;
  // Wages also scale with the AVERAGE TIER of the realm. A village's
  // soldiers are cheap militia (food + a little equipment), while a city
  // fields professional infantry that demand real pay. Without this, tiny
  // village-tier countries paid the same wages as Roman legions, and the
  // fiscal-military spiral instantly crushed them — they bankrupted within
  // 1-2 passes of forming. This restores the realistic case of a small
  // viable state.
  let _tierTotal = 0, _tierN = 0;
  for (const s of members) { _tierTotal += s.tier | 0; _tierN++; }
  const avgTier = _tierN > 0 ? _tierTotal / _tierN : 0;
  const tierFactor = 0.3 + 0.7 * Math.min(1, avgTier / 2);  // 0.3 at village, 0.65 at town, 1.0 at city+
  const wage = T.ARMY_WAGE * realmP * tierFactor;
  // War surcharge only really applies to real states (with at least one
  // city). A village-level realm can't afford a war and shouldn't be modelled
  // as paying for one — its army either runs away or is dismantled (food
  // desertion handles that), not bankrupted.
  let hasCity = false;
  for (const s of members) if ((s.tier | 0) >= 2) { hasCity = true; break; }
  const effSurcharge = hasCity ? WAR_SURCHARGE : 0;
  let spent = 0;

  // ── 1. ARMY PAY (first claim) ──
  // War multiplies the bill: campaigning/being besieged costs far more than a
  // peacetime garrison — this is what actually drains a treasury and bankrupts
  // a state under sustained or multi-front war.
  let totalArmy = 0;
  for (const s of members) if (s.countryId === c.id) totalArmy += s.army || 0;
  const armyBill = totalArmy * wage * (1 + effSurcharge * (warLevel || 0));
  // DEBASEMENT (Phase 3): if the treasury can't cover the army bill, melt the
  // coinage — mint emergency seigniorage (lowering fineness) to ease the
  // shortfall; in comfortable times restore the coin toward full fineness.
  if (T.DEBASE_AGGRO > 0 && armyBill > 0.01) {
    const f0 = gov.fineness ?? 1;
    if (gov.treasury < armyBill && f0 > FINENESS_MIN) {
      const f1 = Math.max(FINENESS_MIN, f0 - DEBASE_STEP * T.DEBASE_AGGRO);
      gov.fineness = f1;
      const seigniorage = (f0 - f1) * armyBill * DEBASE_SEIGN_SCALE;   // ∝ the DROP → self-limits at the floor
      gov.treasury += seigniorage; gov._revenue += seigniorage;
    } else if (gov.treasury > armyBill * RESERVE_PASSES * 1.5 && f0 < 1) {
      gov.fineness = Math.min(1, f0 + DEBASE_RECOVER);
    }
  }
  const armyPaid = Math.min(Math.max(0, gov.treasury), armyBill);
  gov._solvency = armyBill > 0.01 ? armyPaid / armyBill : 1;   // 1 = fully paid; < 1 = arrears
  if (armyPaid > 0 && totalArmy > 0) {
    for (const s of members) {
      if (s.countryId !== c.id || !(s.army > 0)) continue;
      const share = armyPaid * (s.army / totalArmy);
      s.wealth = (s.wealth || 0) + share; recordIn(s, IN_STATE_PAY, share);
    }
    gov.treasury -= armyPaid; spent += armyPaid;
  }

  // ── 2. PUBLIC WORKS / DOLE — only the surplus above the war-chest reserve ──
  // The reserve is sized on the PEACETIME bill (built up in peace, drawn down
  // by a war's surcharge) so a solvent state can ride out a war for a while
  // before going bankrupt. It's also the coin a conqueror seizes.
  const reserve = totalArmy * wage * RESERVE_PASSES;
  let budget = gov.treasury - reserve;
  if (budget > 0.01) {
    let totW = 0;
    for (const s of members) {
      if (s.countryId !== c.id || s.id === c.capitalId) continue;
      const boost = (s._housingPressed ? 0.5 : 0) + ((s._foodDemand || 0) > (s._foodSupply || 0) ? 0.5 : 0);
      s._govW = Math.max(0, s.people || 0) * (1 + boost);
      totW += s._govW;
    }
    if (totW > 0) {
      for (const s of members) {
        if (s.countryId !== c.id || s.id === c.capitalId) continue;
        const share = budget * (s._govW / totW);
        s.wealth = (s.wealth || 0) + share; recordIn(s, IN_STATE_PAY, share);
      }
      gov.treasury -= budget; spent += budget;
    }
  }
  gov._spend = gov._spend * 0.9 + spent * 0.1;
}

// ── Capital → member transport cost (terrain + naval) ────────────────
// The "real" distance an empire's centre must project authority across.
// We Dijkstra outward from the capital, charging the raw terrain cost per
// step — so a Himalayan-isolated province costs the centre far more than
// its straight-line distance suggests, while a province on the open plain
// is exactly as expensive as the euclidean reading.
//
// Tech does NOT discount land travel here — that belongs in c.range (the
// reach BUDGET), not in the distance. Otherwise a high-tech empire pays
// 4× less per plain tile and the budget never bites. The only tech that
// enters this Dijkstra is NAVIGATION, which gates water embarkation: a
// port capital with navigation projects authority across coastal water at
// the same cost as overland (the sea-highway effect that lets a colonial
// empire span the ocean). Without navigation, water is Infinity.
//
// The search is bounded by ~25 × range so we don't walk the whole map, and
// returns as soon as every member's home tile is hit. With ~20 countries
// and member-rich heartlands the per-pass cost is well under 1ms.
// Preallocated typed-array binary min-heap (reused across capitalTransportCosts
// calls via clear() — no per-pop array resize, no per-call allocation). popMin
// writes the result into shared fields (om_ti/om_d) instead of allocating an
// object per pop, since this runs millions of times per polity pass.
class _PolHeap {
  constructor(cap = 8192) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.n = 0; this.cap = cap; this.om_ti = 0; this.om_d = 0; }
  clear() { this.n = 0; }
  _grow() { const k = this.cap * 2; const t = new Int32Array(k); t.set(this.ti); this.ti = t; const d = new Float64Array(k); d.set(this.d); this.d = d; this.cap = k; }
  push(ti, d) {
    if (this.n >= this.cap) this._grow();
    let i = this.n++; this.ti[i] = ti; this.d[i] = d;
    while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break;
      const tt = this.ti[p], td = this.d[p];
      this.ti[p] = this.ti[i]; this.d[p] = this.d[i];
      this.ti[i] = tt; this.d[i] = td; i = p;
    }
  }
  popMin() {
    this.om_ti = this.ti[0]; this.om_d = this.d[0]; this.n--;
    if (this.n > 0) {
      this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2; let b = i;
        if (l < this.n && this.d[l] < this.d[b]) b = l;
        if (r < this.n && this.d[r] < this.d[b]) b = r;
        if (b === i) break;
        const tt = this.ti[b], td = this.d[b];
        this.ti[b] = this.ti[i]; this.d[b] = this.d[i];
        this.ti[i] = tt; this.d[i] = td; i = b;
      }
    }
  }
}
// 8-neighbour cost multipliers (orthogonal 1, diagonal √2) — module-level so the
// hot Dijkstra inner loop doesn't reallocate it per tile.
const POL_MUL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
function capitalTransportCosts(world, c) {
  const { tw, th } = world;
  const cap = c.capital;
  // Pass navigation + mobility ONLY — strips the generic land tech-multipliers
  // (construction's road discount is budget-side), but keeps the two
  // "environment becomes a highway" techs: navigation opens the SEA lane
  // (embarkation gate; cost ~12→3 as nav rises) and mobility opens the STEPPE
  // (open flat country rides at a fraction of foot cost — the yam-relay reach
  // that let horse empires hold provinces across distances no foot bureaucracy
  // could). Mobility's generic wagon discount also rides in (≤30% — fair:
  // mounted couriers extended every empire's reach somewhat).
  const kn  = { navigation: (cap.knowledge && cap.knowledge.navigation) || 0,
                mobility:   (cap.knowledge && cap.knowledge.mobility)   || 0 };
  // Major-river crossings are tracked SEPARATELY (full-weight barrier, not
  // halved with generic terrain) and bridged down by the capital's
  // construction tech — see majorRiverToll.
  const cons = (cap.knowledge && cap.knowledge.construction) || 0;
  const out = new Map();
  const cross = new Map();   // member id → major-river toll accrued on its cheapest path
  const homes = new Map();
  let pending = 0;
  for (const m of c.members) {
    if (m.id === c.capitalId) { out.set(m.id, 0); cross.set(m.id, 0); continue; }
    const ti = (m.pos.y | 0) * tw + (m.pos.x | 0);
    homes.set(ti, m.id);
    pending++;
  }
  if (pending === 0) return { cost: out, cross };
  const co = world._countryOwner;   // for the contiguity toll (crossing foreign land)
  const maxCost = Math.max(50, c.range * 25);
  // Persistent, GENERATION-STAMPED scratch (was per-call Maps — this Dijkstra
  // runs once per country every polity pass and was the single biggest sim
  // hitch). A tile's dist[]/crossB[] count only while stamp[ti] === gen, so a
  // fresh gen each call "clears" all N tiles in O(1) without touching memory.
  const N = world.N;
  let dist = world._polDist, stamp = world._polStamp, crossB = world._polCross;
  if (!dist || dist.length !== N) {
    dist = world._polDist = new Float64Array(N);
    stamp = world._polStamp = new Int32Array(N);   // 0 = untouched; gen runs 1,2,3,…
    crossB = world._polCross = new Float64Array(N);
    world._polGen = 0;
  }
  const gen = (world._polGen = (world._polGen | 0) + 1);
  const cid = c.id;
  const capTi = (cap.pos.y | 0) * tw + (cap.pos.x | 0);
  dist[capTi] = 0; crossB[capTi] = 0; stamp[capTi] = gen;
  const heap = world._polHeap || (world._polHeap = new _PolHeap());
  heap.clear();
  heap.push(capTi, 0);
  while (heap.n > 0 && pending > 0) {
    heap.popMin(); const ti = heap.om_ti, d = heap.om_d;
    if (d > maxCost) break;
    if (d > dist[ti]) continue;   // stale heap entry (this tile already finalised cheaper)
    const hit = homes.get(ti);
    if (hit !== undefined) { out.set(hit, d); cross.set(hit, crossB[ti] || 0); homes.delete(ti); pending--; }
    const ty = (ti / tw) | 0;
    const tx = ti - ty * tw;
    const xm = tx === 0      ? tw - 1 : tx - 1;
    const xp = tx === tw - 1 ? 0      : tx + 1;
    const yu = ty - 1, yd = ty + 1;
    const ns = [
      ty * tw + xm, ty * tw + xp,
      yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
      yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
      yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1,
    ];
    const baseCross = crossB[ti];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      if (co) { const oc = co[ni]; if (oc >= 0 && oc !== cid) continue; }  // contiguity FIRST (cheap): a RIVAL's land is impassable — skip it before the costly edge eval (only own land, wilderness, or the sea project reach)
      const ec = localEdgeCost(world, ti, ni, kn, true);  // admin reach ignores roads
      if (ec === Infinity) continue;
      const nd = d + ec * POL_MUL[k];
      if (nd > maxCost) continue;
      if (stamp[ni] !== gen || nd < dist[ni]) {
        dist[ni] = nd;
        crossB[ni] = baseCross + majorRiverToll(world, ti, ni, cons);
        stamp[ni] = gen;
        heap.push(ni, nd);
      }
    }
  }
  return { cost: out, cross };
}

export function updatePolities(world) {
  const _pf = world._dbgProfile ? (world.debug.pol = { rebuild: 0, transport: 0, loop: 0, absorb: 0 }) : null;
  let _pt = _pf ? performance.now() : 0;
  const countries = rebuildCountries(world);
  if (_pf) { _pf.rebuild = performance.now() - _pt; _pt = performance.now(); }

  // Assimilation: a people held beyond living memory (HOMELAND_MEMORY) lose their
  // old national identity and become natives of their current ruler — so a LATE
  // revolt there forms a NEW state on the administrative lines, not the old nation.
  // Home-by-any-path also clears: a secession that hands a settlement back its own
  // original nation-id (freshCountryId reusing it) is a homecoming too — drop the
  // now self-referential marker so it can't linger or re-trigger a restoration.
  for (const s of world.settlements) {
    if (s.mode !== "settled" || (s._homeland ?? -1) < 0) continue;
    if (s._homeland === s.countryId
        || ((s._homelandFell ?? -1) >= 0 && world.step - s._homelandFell > HOMELAND_MEMORY)) {
      s._homeland = -1; s._homelandFell = -1;
    }
  }

  // Era-weighted salience of the four identity layers (cohesion.js). One read per
  // pass — the year is global — shared by the unrest grievance and the admin-load
  // friction below. The axis of conflict it emphasises shifts with the calendar:
  // faith in the medieval, language across the bureaucratic eras, peoples in the modern.
  const idW = identityWeightsNow(world);
  // MEDIAN capital power across the REAL states (multi-member) this pass — the era
  // baseline the dominant-empire boost is measured against (see CAP_DOM_W). The median
  // (not the mean) is deliberate: it is robust to the hegemon's OWN outsized core, so a
  // great power keeps its dominance for ages instead of deflating the very average it is
  // measured against and self-fragmenting — persistent Romes, not one-era flashes.
  { const cps = [];
    for (const c of countries.values()) if (c.capital && c.members.length > 1) cps.push(settlementPower(c.capital));
    cps.sort((a, b) => a - b);
    world._refCapPower = cps.length ? cps[cps.length >> 1] : 1; }
  for (const c of countries.values()) {
    if (c.members.length <= 1) { if (c.members[0]) c.members[0].loyalty = 1; continue; }   // city-state: loyal to itself

    const cap = c.capital;
    const capPower = settlementPower(cap);
    // (The raw hold-distance c.range bounds the Dijkstra search inside
    // capitalTransportCosts; everything HERE compares against the res-scaled grip.)
    const holdRange = Math.max(1, c.holdReach || c.range);   // res-scaled grip → compared against map distances (admin load, secession reach)
    // Real per-member projection cost from the capital, via tech × terrain.
    // The Himalayas / oceans / rivers all drain the centre's reach budget
    // exactly the way they drain a column's movement. (Naval shortcuts are
    // already baked into localEdgeCost via water embarkation, so we no
    // longer apply a separate _isPort discount here.)
    const _tt = _pf ? performance.now() : 0;
    const { cost: tcosts, cross: tcross } = capitalTransportCosts(world, c);
    if (_pf) _pf.transport += performance.now() - _tt;
    const reachCeil = holdRange * 25;   // load-space ceiling for an unreachable member (grip frame, like the load → load≈25 ⇒ secede); the Dijkstra SEARCH bound (maxCost) stays raw for perf

    // ── Control budget: what the centre can administer (reach-units) ──
    // The capital projects a base budget that grows with its own size; loyal
    // regional seats run sub-administrations that extend it. A weak/declining
    // capital → small budget → the frontier can't be held.
    let seatBonus = 0;
    for (const s of c.members) {
      if (s.id === c.capitalId) continue;
      const isSeat = (s.tier | 0) >= 2 || (s._vassalCount || 0) > 0;
      if (!isSeat) continue;
      const seatSize = Math.min(2, Math.log2(1 + (s.people || 0) / SIZE_REF));
      seatBonus += T.CAP_SEAT * (s.loyalty ?? 1) * seatSize;   // disloyal/small seats help less
    }
    // Organization buys administrative CAPACITY (slots), not just reach: a
    // literate-bureaucratic state (records, roads, a professional officialdom)
    // governs far more provinces than a chiefdom. Without this term a high-org
    // empire had long reach but the same handful of slots, so the moment conquest
    // grew it past that handful it over-extended and shattered — the late-game
    // re-fragmentation. Scaling capacity with org lets large empires that form by
    // conquest actually HOLD, so consolidation persists into the late game.
    const capE = techEff(cap);
    const capCoh = capE.cohesion;           // administrative glue (stability techs: law, institutions, religion)
    // Capacity grows with the capital's coercive POWER (people × military-tech ×
    // organisation — see settlementPower), compressed through log2 so it climbs
    // steeply at first then levels: a primitive realm holds barely more than its
    // base (the EARLY map stays fragmented into small city-states), while a
    // developed, organised, populous capital sustains a real empire of many
    // provinces (the classical/imperial CONSOLIDATION into a few great powers).
    // Loyal regional seats add their own sub-administration on top (seatBonus).
    // Because it tracks the capital's LIVE strength, a weakening centre (war,
    // plague, a sacked throne) shrinks capacity and the frontier sheds — and an
    // empire that conquers past this budget holds the excess only on pacification
    // grace, then fragments back toward it once the conquest stalls.
    //
    // INSTITUTIONS move the ceiling itself (T.CAP_INST). The log2 keeps any
    // GIVEN institutional level out-conquerable (no immortal juggernaut), but
    // historically the curve ROSE with each delegation revolution — Assyria's
    // provincial system, the satrapies, Rome's governors, Han commanderies —
    // and a fixed coefficient pinned every era to "~a dozen seats" (the
    // uniform-empire-size finding, tools/diag_countries.mjs). capCoh is the
    // cohesion tech channel (mysticism → code of laws → feudalism → democracy
    // → telegraph), so the multiplier climbs exactly when bureaucracy is
    // invented; it scales the seat cap too — satrapies ARE the delegation.
    const instMul = 1 + capCoh * T.CAP_INST;
    // Dominance: a capital far above the era's mean sustains a disproportionately
    // larger realm (the great-power tail), bounded and self-limiting (CAP_DOM_*).
    const relPow = capPower / Math.max(1, world._refCapPower || capPower);
    const dominance = Math.min(CAP_DOM_MAX, 1 + CAP_DOM_W * Math.pow(Math.max(0, relPow - 1), CAP_DOM_P));
    c._dominance = dominance;   // info panel: how far this realm out-cores the age
    const peaceCapacity = (CAP_K * instMul * Math.log2(1 + capPower / POW_REF)
                        + Math.min(SEAT_BONUS_CAP * instMul, seatBonus)) * dominance;

    // ── War duress: throttle the budget while the realm is fighting ────
    // (fronts are tallied in armies.js advanceFronts → world._fronts.)
    const fb = world._fronts && world._fronts.byCountry;
    const fronts = fb ? (fb.get(c.id) ? fb.get(c.id).size : 0) : 0;
    const besiegedCap = world.step - (cap._siegeAt ?? -Infinity) < SIEGE_WINDOW;
    const raidedCap   = world.step - (cap._warAt   ?? -Infinity) < SIEGE_WINDOW;
    let duress = 1;
    if (fronts > 1) duress /= (1 + MULTIFRONT_PENALTY * Math.min(3, fronts - 1));   // split army/attention (capped)
    if (besiegedCap)     duress *= SIEGE_CAPACITY_MULT;                  // throne pinned
    else if (raidedCap)  duress *= WAR_CAPACITY_MULT;                    // core harried
    // War intensity drives the army's wartime cost surcharge (disburseTreasury).
    const warLevel = fronts + (besiegedCap ? 2 : raidedCap ? 1 : 0);
    // Fiscal duress (death-spiral): a state that can't pay its army (last
    // pass's solvency, from disburseTreasury) loses its grip on the frontier.
    // Lose provinces → lose tax revenue → can't pay → capacity falls → lose
    // more — the self-reinforcing collapse.
    const gov = govOf(world, c.id);
    const solvency = gov._solvency ?? 1;
    let fiscalDuress = SOLVENCY_FLOOR + solvency * (1 - SOLVENCY_FLOOR);
    // Organised states weather both war and insolvency far better — ease both
    // throttles toward 1 by the capital's org, so large high-org empires HOLD
    // under pressure instead of shattering at the first frontier war.
    const resilience = 1 - capCoh * T.DURESS_RESILIENCE;
    duress       = 1 - (1 - duress)       * resilience;
    fiscalDuress = 1 - (1 - fiscalDuress) * resilience;
    // Conquest momentum: a winning streak (banked in armies.js) holds a far
    // larger domain together than the settled budget could — but it decays
    // FAST once the conquering stops, so the moment the streak ends the
    // propped-up frontier sheds in a few passes (hard snap). Added on top of
    // the throttled budget so even a multi-front war-machine over-holds while
    // it's winning, then shatters when it stalls.
    const momentum = Math.min(T.MOMENTUM_CAP, gov._momentum || 0);
    gov._momentum = momentum * MOMENTUM_DECAY;     // decay each pass; conquest re-banks it (armies.js)
    const capacity = peaceCapacity * duress * fiscalDuress + momentum;
    c._capacity = capacity;        // (already duress-adjusted) for the info panel
    c._momentum = momentum;        // for the info panel
    c._fronts = fronts;
    c._capitalBesieged = besiegedCap;
    c._solvency = solvency;

    // Variable taxation: war + insolvency push the rate up toward a cap. Recent
    // conquests bank war-weariness relief (_spoils, in armies.js) that fades.
    const targetTax = Math.min(T.TAX_MAX, TAX_BASE + TAX_WAR * warLevel + TAX_BANKRUPT * (1 - solvency));
    gov._taxRate = (gov._taxRate ?? TAX_BASE) + (targetTax - (gov._taxRate ?? TAX_BASE)) * TAX_DRIFT;
    gov._spoils = (gov._spoils || 0) * SPOILS_DECAY;
    c._taxRate = gov._taxRate;

    // ── Popular unrest: hardship piles up; peace + plenty + light taxes cool it.
    // At the top it boils over into a rebellion (rebel(), fired after secession).
    const taxOver = Math.max(0, (gov._taxRate - TAX_BASE) / (T.TAX_MAX - TAX_BASE));
    const warFat = Math.min(1, warLevel * 0.4) * (1 - Math.min(1, gov._spoils || 0));
    const rebelSeeds = [];
    for (const s of c.members) {
      if (s.countryId !== c.id) continue;
      const fed = s._foodSupply || 0;   // _foodSupply now includes hierarchy-aggregated grain (foodHierarchy.js)
      const demand = s._foodDemand || 0.0001;
      const hunger = fed < demand ? Math.min(1, (demand - fed) / demand) : 0;
      const conscript = Math.min(1, ((s.army || 0) / Math.max(1, s.people)) / CONSCRIPT_REF);
      const gH = hunger * HUNGER_W, gC = conscript * CONSCRIPT_W, gW = warFat * WARFAT_W, gT = taxOver * OVERTAX_W;
      const gS = shockUnrest(world, s);   // direct famine/plague distress (shocks.js)
      const gI = identityGrievance(cap, s, idW);   // heterodox-faith / foreign-people grievance vs the state core (era-weighted, cohesion.js)
      s.unrest = Math.max(0, Math.min(1, (s.unrest || 0) + (gH + gC + gW + gT + gS + gI) * T.UNREST_GAIN - UNREST_RELIEF));
      s._unrestCause = s._plagueActive ? "plague"
                     : gI >= gH && gI >= gT && gI >= gW && gI >= gC ? identityGrievanceCause(cap, s, idW)
                     : gH >= gC && gH >= gW && gH >= gT ? "famine"
                     : gT >= gC && gT >= gW ? "taxes"
                     : gW >= gC ? "war fatigue" : "conscription";
      if (s.unrest > 0.5) s.loyalty = Math.max(0, (s.loyalty ?? 1) - UNREST_LOYALTY_BLEED * (s.unrest - 0.5));  // anger erodes loyalty
      const pacified = world.step - (s._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE;
      if (s.unrest >= 1 && (s.id === c.capitalId || !pacified)) rebelSeeds.push(s);
    }

    // ── Per-member admin load (cost to hold) ──────────────────────────
    const loads = [];
    for (const s of c.members) {
      if (s.id === c.capitalId) { s.loyalty = 1; s._ambition = 0; s._capCost = 0; s._capCostId = c.id; continue; }
      // Distance the CENTRE must project authority across. Start from the
      // straight-line reading, then add HALF the terrain surcharge over
      // that baseline (mountains and water hurt; easy terrain doesn't help —
      // otherwise riverine/coastal capitals project authority too cheaply
      // and rival the historic mega-empires for the wrong reasons). The
      // result: a province behind the Himalayas reads as several times
      // farther; a province across plain reads at its true distance.
      const eucl = dist(world, cap.pos.x, cap.pos.y, s.pos.x, s.pos.y);
      const tc   = tcosts.get(s.id);
      // Stamp the capital-relative transport cost for the culture pass's
      // prestige standardization (cultures.js): the connected heartland adopts
      // the capital's tongue, the remote / unreachable marches resist. Same
      // units as holdRange (the load below compares tc directly against it), so
      // cultures.js can scale the pull by tc / holdReach.
      s._capCost = (tc === undefined || !isFinite(tc)) ? Infinity : tc;
      s._capCostId = c.id;
      const tcEff = (tc === undefined || !isFinite(tc)) ? reachCeil : tc;
      const surcharge = Math.max(0, tcEff - eucl);
      // Major-river crossings are a FULL-weight, construction-gated barrier
      // (generic terrain above is half-weighted): a low-construction realm
      // is walled by a great river, an engineered one bridges it.
      const riverToll = tcross.get(s.id) || 0;
      let d = eucl + surcharge + riverToll;   // FULL route cost: detouring around a rival (rivals impassable) costs its true extra distance
      d /= holdPull(s);                                               // value cling
      const coerce  = Math.min(COERCE_CAP, Math.sqrt(capPower / Math.max(1, settlementPower(s))));
      const sizeMul = 1 + T.SIZE_LOAD * Math.min(3, Math.log2(1 + (s.people || 0) / SIZE_REF));
      const recMul  = 1 + RECENCY_LOAD * recencyFactor(world, s);
      const langMul = 1 + adminFriction(cap, s, idW);   // a foreign-tongue province is costlier to govern → polyglot empires overreach sooner (cohesion.js)
      const load = (d / holdRange) * sizeMul * recMul * langMul / coerce;   // grip: res-scaled so the held FRACTION matches the (res-scaled) territorial reach
      s._langFriction = langMul - 1;   // info panel: administrative friction from tongue mismatch
      s._adminLoad = load;            // for the info panel
      loads.push({ s, load });
    }

    // ── Spend the budget on the cheapest provinces first ──────────────
    // Walk provinces from cheapest to dearest, spending the budget. Those
    // that fit are "covered" and recover loyalty; the rest are over-extended
    // and bleed loyalty (faster the deeper past the line they sit). When a
    // province's loyalty stock hits zero it breaks away. Recently-conquered
    // and infant colonies are GARRISONED — held firm while loyalty settles,
    // so the map doesn't flicker right after a capture or a founding.
    loads.sort((a, b) => a.load - b.load);
    let cum = 0;
    const seeds = [];   // provinces whose loyalty collapsed this pass → revolt seeds
    for (const { s, load } of loads) {
      cum += load;
      const covered  = cum <= capacity;
      const pacified = world.step - (s._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE;
      const infant   = s.parentSettlementId >= 0 && world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (pacified || infant) {
        // Held by garrison / colonial project: nudge loyalty toward its base
        // but never secede yet.
        const base = pacified ? 0.5 : 0.7;
        s.loyalty = (s.loyalty ?? base) + (base - (s.loyalty ?? base)) * 0.15;
        continue;
      }
      if (covered) {
        s.loyalty = Math.min(1, (s.loyalty ?? 1) + LOYAL_RECOVER * (1 - (s.loyalty ?? 1)));
      } else {
        // How deep past the budget — CAPPED so a wildly over-extended realm
        // sheds gradually (ring by ring over passes) instead of its whole
        // frontier collapsing in one tick (see OVER_DECAY_CAP).
        const over = Math.min(OVER_DECAY_CAP, (cum - capacity) / capacity);
        // An ORGANISED empire's provinces are administratively STICKY — records,
        // garrisons, an integrated economy and roads bind a province to the
        // realm, so it bleeds loyalty slowly even while over-budget. This is the
        // direct lever that lets a large high-org empire HOLD (it sheds its
        // frontier over many passes, a slow imperial overstretch, rather than
        // shattering wholesale the moment a war pushes it past budget). A
        // primitive realm (low org) has no such glue and fragments fast.
        const orgHold = 1 - capCoh * T.LOYAL_ORG_HOLD;
        s.loyalty = Math.max(0, (s.loyalty ?? 1) - T.LOYAL_DECAY * (1 + over) * orgHold);
        if (s.loyalty <= 0) seeds.push(s);                 // collapsed — defer (revolt is contagious)
      }
    }
    c._loadTotal = cum;   // total admin load drawn (vs c._capacity)
    // The frontier sheds along the control field: how far over budget the realm
    // sits (war + insolvency are already folded into the throttled capacity) sets
    // the STRESS that shrinks its grip, so a mild overstretch peels the rim while a
    // deep collapse loosens many provinces at once (see shedFrontier).
    if (seeds.length) {
      const stress = capacity > 0 ? Math.max(0, cum / capacity - 1) : 4;
      shedFrontier(world, c, seeds, tcosts, holdRange, stress);   // grip = res-scaled hold reach (see holdRange)
    }
    // Boiled-over towns rise up (destructive, heartland-capable — see rebel()).
    if (rebelSeeds.length) rebel(world, c, rebelSeeds);

    // ── Overmighty governors: ambition-driven breakaway (with sub-realm) ──
    // Independent of the budget: a strong, distant governor schemes and, when
    // his ambition matures, declares independence and takes his vassal branch
    // with him. A besieged throne emboldens him.
    for (const s of c.members) {
      if (s.countryId !== c.id || s.id === c.capitalId) continue;     // gone / is the throne
      const seat = (s.tier | 0) >= CITY_TIER;    // must be a CITY (a province seat) — it takes its province with it
      const pacified = world.step - (s._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE;
      const infant   = s.parentSettlementId >= 0 && world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      const ratio = settlementPower(s) / capPower;                    // strength vs the throne
      // Same blended distance as the hold load — a governor across a
      // mountain range is "farther" than its straight-line reading,
      // proportionally embolder.
      const eucl = dist(world, cap.pos.x, cap.pos.y, s.pos.x, s.pos.y);
      const tc   = tcosts.get(s.id);
      const tcEff = (tc === undefined || !isFinite(tc)) ? reachCeil : tc;
      // A governor across a great river is "farther" too (same full-weight
      // river toll as the hold load) — so a far-bank seat schemes harder.
      const far  = (eucl + Math.max(0, tcEff - eucl) + (tcross.get(s.id) || 0)) / holdRange;
      if (!seat || pacified || infant || ratio < AMBITION_RATIO || far < AMBITION_MIN_FAR) {
        if (s._ambition) s._ambition = Math.max(0, s._ambition - AMBITION_GAIN);   // fades when unqualified
        continue;
      }
      const margin = (ratio - AMBITION_RATIO) / (1 - AMBITION_RATIO);  // 0 at threshold → 1 near parity
      const duressMul = besiegedCap ? AMBITION_DURESS : (raidedCap ? 1.2 : 1);
      s._ambition = (s._ambition || 0) + AMBITION_GAIN * margin * (1 + AMBITION_FAR * far) * duressMul;
      if (s._ambition >= 1) declareIndependence(world, c, s);
    }

    // ── State finances: tax members into the treasury, then spend it back ──
    // REVENUE: each established member pays tribute (the state tax) into the
    // GOVERNMENT treasury — not the capital city's private purse. (Customs
    // duties were already paid into the treasury during the trade pass.) A
    // YOUNG colony instead RECEIVES support (food from the capital's granary +
    // coin from the treasury) until it matures, so a raw frontier survives.
    // (gov fetched above for the fiscal-duress capacity term.)
    for (const s of c.members) {
      if (s.id === c.capitalId || s.countryId !== c.id) continue;
      const youngColony = s.parentSettlementId >= 0 &&
                          world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS;
      if (youngColony) {
        const food = Math.min(COLONY_SUPPLY_FOOD, Math.max(0, (c.capital.food || 0) - 20));
        if (food > 0) { c.capital.food -= food; s.food = (s.food || 0) + food; }
        // Colony subsidy scales with the realm's price level so a settlement
        // founded in an inflated economy gets a real (P-adjusted) endowment.
        const grant = COLONY_SUPPLY_COIN;   // (b) real terms, not × the price level
        const coin = Math.min(grant, Math.max(0, gov.treasury));
        if (coin > 0) { gov.treasury -= coin; s.wealth = (s.wealth || 0) + coin; recordIn(s, IN_AID, coin); }
        continue;                                   // subsidised, not taxed
      }
      const give = Math.max(0, s.wealth || 0) * (gov._taxRate ?? TAX_BASE);
      if (give > 0) { s.wealth -= give; gov.treasury += give; gov._revenue += give; recordOut(s, OUT_TRIBUTE, give); }
      // PRODUCE LEVY (rent + tithe on the HARVEST): a landlord/church share of a settlement's
      // farm OUTPUT, taken off the top every pass — what kept real peasants poor (their surplus
      // skimmed as a share of the crop, not their cash hoard) and what funds the towns. It falls
      // on FARMED output (_landFood) only, so the agrarian countryside pays it and cities (which
      // grow nothing) don't — draining the village hoards UP to the state, then out to the cities.
      // The levy now tracks the realm's VARIABLE tax rate (war / insolvency push it
      // up), so a state at war taxes its countryside's HARVEST harder — not just its
      // cash — and that over-extraction feeds the over-tax grievance into revolt
      // (the "raise taxes for the war → the provinces rise up" loop). 1× at the base
      // rate, scaling up toward TAX_MAX/TAX_BASE in a hard war.
      if (T.FARM_RENT > 0 && (s._landFood || 0) > 0) {
        const taxMul = (gov._taxRate ?? TAX_BASE) / TAX_BASE;
        const rent = Math.min(Math.max(0, s.wealth || 0), (s._landFood || 0) * T.FARM_RENT * taxMul * T.POLITY_INTERVAL);
        if (rent > 0) { s.wealth -= rent; gov.treasury += rent; gov._revenue += rent; recordOut(s, OUT_TRIBUTE, rent); }
      }
    }
    // COURT & CAPITAL: a share of this pass's tax revenue is consumed AT the seat —
    // the court, the central bureaucracy, the capital's works & clientele — so the
    // capital reads as a TAX-funded seat rather than a merchant. Taken from the
    // treasury (conserved) before the rest is disbursed to the army & provinces.
    if (cap && gov._revenue > 0) {
      const court = Math.min(Math.max(0, gov.treasury), gov._revenue * COURT_SHARE);
      if (court > 0) { gov.treasury -= court; cap.wealth = (cap.wealth || 0) + court; recordIn(cap, IN_TARIFFS, court); }
    }
    // EXPENDITURE: spend the treasury back out (army pay → garrisons, then
    // works/dole → provinces). Balanced budget ⇒ the throne stops hoarding.
    disburseTreasury(world, c, gov, warLevel);
    c._treasury = gov.treasury;
    c._fineness = gov.fineness ?? 1;   // currency strength (1 = full metal; < 1 = debased) — for the UI
    c._govRevenue = gov._revenue; gov._revenue = 0;   // per-pass revenue, for the panel
    c._govSpend = gov._spend;

    // Temperament drifts with lived experience (war hardens militarism, long
    // solvent peace lets commerce flower, lost ground turns a realm inward,
    // steady growth emboldens expansion) — see personality.js driftPersonality.
    driftPersonality(world, c, { warLevel, solvency });
  }
  if (_pf) { _pf.loop = performance.now() - _pt; _pt = performance.now(); }

  // ── Peaceful consolidation (erode weak neighbours into strong realms) ──
  // A dominant, organised realm administratively absorbs the frontier
  // settlements of a much weaker touching neighbour. How DEVELOPED a settlement
  // it can integrate scales with its organization tech (tierCapForOrg), so the
  // map consolidates AS THE ERA ADVANCES — villages in the bronze age, towns and
  // small cities by the iron age. Genuinely-strong neighbours and undiscovered
  // frontier are untouched, and a pacified-grace gate stops re-flipping a
  // freshly seceded/conquered settlement.
  absorbWeakNeighbors(world, countries);
  if (_pf) _pf.absorb = performance.now() - _pt;

  // Reconcile the persistent polity registry against the live view: register
  // substantial newcomers, close the records of realms that vanished. (No
  // pruning — fallen realms keep their record, history and temperament.)
  reconcilePolities(world, countries);
}

// Does this realm have administrative room for one more province? A realm
// already drawing its full capacity (load ≥ capacity) would immediately
// over-extend on anything it absorbed, secede it next pass, and oscillate.
// We require a small slack so the new province lands inside the budget.
//
// `extra` is the load ALREADY committed to this realm by earlier absorptions
// in the SAME pass — without it, every absorption this pass checks against the
// realm's stale pre-pass load, so a realm with a sliver of headroom vacuums a
// dozen villages at once and is massively over-extended next pass (the very
// absorb↔secede oscillation this gate exists to stop). Charging each
// absorption forward closes that hole — a pass fills only the real headroom.
function hasAbsorbHeadroom(c, extra = 0, mult = ABSORB_HEADROOM) {
  if (!c) return false;
  const cap = c._capacity, load = c._loadTotal;
  if (cap == null || load == null) return true;        // no budget data yet → allow
  return load + extra < cap * mult;
}

// Cheap estimate of the admin load a freshly-absorbed province adds to a realm
// — euclidean distance / reach (the same calibration the full load uses: a
// province at the capital's reach costs ~1), floored so an adjacent village is
// never free. Used only to charge in-pass absorptions against the headroom gate
// above; the real load is recomputed from scratch next polity pass.
function estAbsorbLoad(world, c, m) {
  const cap = c.capital; if (!cap) return 1;
  let dx = Math.abs(cap.pos.x - m.pos.x); if (dx > world.tw / 2) dx = world.tw - dx;
  const dy = cap.pos.y - m.pos.y;
  const eucl = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0.5, eucl / Math.max(1, c.holdReach || c.range));   // eucl is a map distance → res-scaled grip
}

// Org → highest target TIER a realm can administratively absorb. THE
// consolidate-with-the-era knob: a bronze-age power (org ~0.5) can only vacuum
// villages off a touching statelet, but an iron-age empire (org ~0.8) integrates
// towns and small cities — so a fragmented classical patchwork coalesces into
// empires late instead of staying confetti. (Below T.ABSORB_ORG_MIN nothing
// absorbs at all.)
function tierCapForOrg(org) { return org >= 0.85 ? 3 : org >= 0.72 ? 2 : org >= 0.60 ? 1 : 0; }

function absorbWeakNeighbors(world, countries) {
  const owner = world._territoryOwner, byId = world._byId;
  if (!owner || !byId) return;
  const tw = world.tw, th = world.th, N = world.N;
  const co = world._countryOwner;   // country-primary territory (incl. marches)
  // Per-country total power, for the dominance gate (only a realm that clearly
  // out-powers a neighbour's WHOLE country can erode it — so peer empires don't
  // peel border settlements off each other and flip-flop).
  const countryPower = new Map();
  for (const c of countries.values()) {
    let pow = 0; for (const m of c.members) pow += settlementPower(m);
    countryPower.set(c.id, pow);
  }
  // Per-settlement exposure to strong, organised foreign realms able to absorb a
  // settlement of its tier. Walk every tile once, crediting each qualifying
  // foreign neighbour to the settlement that owns the home tile (so a frontier
  // town feels the empire's pull while one deep in its own realm doesn't).
  const perSett = new Map();
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti]; if (oid < 0) continue;
    const m = byId.get(oid);
    if (!m || m.mode !== "settled") continue;
    const myCC = m.countryId;
    const myCountryPow = countryPower.get(myCC) || 1;
    const myTier = m.tier | 0;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp,
                ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      // The neighbour's COUNTRY: the owning settlement's country if this tile is
      // someone's catchment, else the country-primary owner of the tile (an
      // empire's MARCH — claimed land with no settlement on it). Using the march
      // owner is what lets a statelet ENGULFED by a big empire's frontier be
      // seen as bordering that empire — without it, a speck surrounded by marches
      // looks like it borders only wilderness and is never absorbed (the "sludge").
      const no = owner[ni];
      let ncc;
      if (no >= 0) { const fs = byId.get(no); if (!fs) continue; ncc = fs.countryId; }
      else { ncc = co ? co[ni] : -1; }
      if (ncc < 0 || ncc === myCC) continue;
      const F = countries.get(ncc); if (!F) continue;
      const fOrg = techEff(F.capital).reachLevel;   // foreign realm's statecraft, from its admin techs (reachLevel tracks org)
      if (fOrg < T.ABSORB_ORG_MIN) continue;
      if (myTier > tierCapForOrg(fOrg)) continue;            // too developed for F's statecraft
      if ((countryPower.get(F.id) || 1) < myCountryPow * T.ABSORB_DOMINANCE) continue;  // not dominant enough
      const orgFactor = Math.min(1, (fOrg - T.ABSORB_ORG_MIN) / (1 - T.ABSORB_ORG_MIN));
      let perCc = perSett.get(m.id);
      if (!perCc) { perCc = new Map(); perSett.set(m.id, perCc); }
      perCc.set(F.id, (perCc.get(F.id) || 0) + settlementPower(F.capital) * orgFactor);
    }
  }
  // Per-settlement probabilistic defection. A village that's heavily
  // exposed to a strong foreign neighbour rolls a per-pass chance to
  // defect; one that's barely touching rolls a lower chance. This
  // produces the visible "village-by-village, year by year" pattern of
  // a small statelet being eroded into a great power's orbit, instead
  // of the entire statelet flipping atomically in one tick.
  // Load each realm commits to absorptions THIS pass, so a realm with a
  // little headroom can't swallow a dozen villages at once (see
  // hasAbsorbHeadroom — without this the gate checks every candidate against
  // the same stale pre-pass load and the realm over-extends in one tick).
  const absorbedLoad = new Map();
  for (const [settId, scoreMap] of perSett) {
    const m = byId.get(settId);
    if (!m || m.mode !== "settled") continue;
    if (world.step - (m._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE) continue;
    let bestId = -1, bestScore = -1;
    for (const [cid, score] of scoreMap) if (score > bestScore) { bestScore = score; bestId = cid; }
    if (bestId < 0) continue;
    // Don't absorb into a realm that can't AFFORD the new province: if the
    // absorber is already at/over its administrative budget, the freshly
    // taken village would be over-extended and secede again next pass — the
    // absorb↔secede oscillation that flips whole swathes back and forth.
    // Only pull in what the surrounder has the spare capacity to hold —
    // counting what it has already taken on this pass.
    const target = countries.get(bestId);
    const committed = absorbedLoad.get(bestId) || 0;
    // Lopsided: the absorber out-powers this settlement's WHOLE country by
    // LOPSIDED_ENGULF — a great power vs a statelet. Then it engulfs even with no
    // headroom (and faster, below); otherwise it must have spare capacity.
    const myCountryPow = countryPower.get(m.countryId) || 1;
    const lopsided = (countryPower.get(bestId) || 1) >= myCountryPow * LOPSIDED_ENGULF;
    // Lopsided great powers may over-extend (up to LOPSIDED_HEADROOM × capacity)
    // but are NOT exempt from the ceiling — without an upper bound a dominant
    // realm engulfs the whole map. Past the ceiling it must shed before it grows.
    if (!hasAbsorbHeadroom(target, committed, lopsided ? LOPSIDED_HEADROOM : ABSORB_HEADROOM)) continue;
    const myPower = Math.max(1, settlementPower(m));
    // Defection chance per polity pass — caps at T.ABSORB_PROB_MAX normally; a
    // lopsided great-power engulfment goes at the faster ENGULF_PROB so the
    // splotch of tiny states is consolidated within a few passes, not never.
    const ratio = bestScore / myPower;
    let prob = Math.min(T.ABSORB_PROB_MAX, ratio * T.ABSORB_RATE);
    if (lopsided) prob = Math.max(prob, ENGULF_PROB);
    // Deterministic hash on (id, step) — same input always rolls the same
    // outcome, so debugging is reproducible and there's no jitter.
    const r = ((m.id * 9301 + world.step * 49297 + 7) % 233280) / 233280;
    if (r > prob) continue;
    const oldCC = m.countryId;
    m.countryId = bestId;
    recordOccupation(m, oldCC, bestId, world.step);   // absorbed people keep their homeland identity
    logEvent(world, "settlement.annexed", { s: m.id, sName: m.name || "a settlement",
      from: oldCC, fromName: oldCC >= 0 ? realmName(world, oldCC) : undefined,
      to: bestId, toName: realmName(world, bestId) });
    if (world.debug && world.debug.land) { world.debug.land.absorb++; const g = world.debug.land.gain; g.set(bestId, (g.get(bestId) || 0) + 1); }
    m.loyalty = 0.6;                          // absorbed, not yet truly part of the realm
    m._conqueredAt = world.step;              // brief grace to settle in
    absorbedLoad.set(bestId, committed + estAbsorbLoad(world, target, m));
  }

  // ── Enclave elimination ─────────────────────────────────────────────
  // Nothing should sit fully enclosed inside one country: not a marooned
  // fragment of another realm, not a whole engulfed country, and not a pocket
  // of wild land. Any connected region of NON-{surrounder} territory (and the
  // unclaimed land threaded through it) that touches only ONE country and the
  // map edge nowhere is instantly claimed by that surrounding country.
  // (Coastlines count as an outside border — a region touching sea is NOT
  // enclosed, so islands and ports keep their independence: Vatican-style
  // landlocked holdouts are absorbed, West-Berlin-by-sea-resupply are not.)
  eliminateEnclaves(world, countries);
}

// Flood-fill the whole map once. Each maximal region NOT owned by a given
// country, if it borders exactly one country and never the sea/edge, is an
// enclave wholly inside that country and gets claimed. Land settlements in the
// region flip to the surrounder; wild tiles are stamped to it directly.
function eliminateEnclaves(world, countries) {
  const owner = world._territoryOwner, byId = world._byId;
  if (!owner || !byId) return;
  const { tw, th, N, elev } = world;
  // tile → countryId of its owner (-1 wild land, -2 sea/empty).
  const tileCountry = (ti) => {
    if (elev[ti] <= 0) return -2;                 // sea
    const oid = owner[ti];
    if (oid < 0) return -1;                        // wild land
    const s = byId.get(oid);
    return s ? s.countryId : -1;
  };
  const visited = new Uint8Array(N);
  // Per-country power, for the city-enclave annexation gate (a much stronger realm
  // peacefully absorbs a small city-state it has engulfed).
  const cPow = new Map();
  for (const c of countries.values()) { let p = 0; for (const m of c.members) p += settlementPower(m); cPow.set(c.id, p); }
  const region = [];                               // reused per flood
  const q = [];
  for (let start = 0; start < N; start++) {
    if (visited[start]) continue;
    const surrounder = tileCountry(start);
    visited[start] = 1;
    // We flood the COMPLEMENT of each country: skip tiles that belong to a
    // country (they're flooded as part of detecting OTHER regions' borders).
    // Seed only on wild land or a foreign-country tile; pure-country tiles are
    // walls we discover from the region side.
    // Flood the maximal connected region of "everything that is NOT exactly
    // one particular surrounding country". To keep it simple and correct we
    // flood by EQUAL tileCountry value across {wild, sea, or a given country}.
    region.length = 0; q.length = 0;
    q.push(start); region.push(start);
    let touchesEdge = false;
    const borderCount = new Map();                  // bounding countryId (or wild -1) → border length
    const selfCC = surrounder;                     // the region's own classification
    while (q.length) {
      const ti = q.pop();
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      if (ty === 0 || ty === th - 1) touchesEdge = true;   // map top/bottom = open border
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const ns = [ty * tw + xm, ty * tw + xp,
                  ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      for (let k = 0; k < 4; k++) {
        const ni = ns[k]; if (ni < 0) continue;
        const ncc = tileCountry(ni);
        if (ncc === selfCC) {
          if (!visited[ni]) { visited[ni] = 1; q.push(ni); region.push(ni); }
        } else if (ncc === -2) {
          touchesEdge = true;                       // sea = open border
        } else {
          borderCount.set(ncc, (borderCount.get(ncc) || 0) + 1);   // weight by shared border
        }
      }
    }
    // An enclave is a region that never touches sea or the map edge and is
    // dominated by a single bounding country. Wild land (-1) bordering it does
    // NOT count as a bounding country, but the region must still be sealed.
    if (touchesEdge) continue;
    borderCount.delete(-1);                          // wild doesn't bound
    if (borderCount.size === 0) continue;            // whole-map country / interior wilderness
    // Dominant bounding country = the one sharing the most border with the
    // region. We cede the region to it when it CLEARLY surrounds it. Exactly-one
    // bounder is the strict enclave (Vatican); a landlocked fragment hemmed in
    // ≥ DOMINANCE on its border by one realm (the rest a sliver of some third
    // party) is the same situation in practice — a marooned bit "stuck inside"
    // a neighbour — and is cleaned up the same way. A region holding an actual
    // CITY is exempt from the relaxed rule: a seat of government doesn't change
    // hands without conquest, so a city only flips when TRULY (fully) enclosed.
    let intoId = -1, bestBord = 0, totBord = 0;
    for (const [cc, n] of borderCount) { totBord += n; if (n > bestBord) { bestBord = n; intoId = cc; } }
    if (intoId === selfCC) continue;                // region already that country
    let regionHasCity = false;
    for (const ti of region) { const o = owner[ti]; if (o >= 0) { const s = byId.get(o); if (s && (s.tier | 0) >= 2) { regionHasCity = true; break; } } }
    let needFrac = ENCLAVE_DOMINANCE;
    if (regionHasCity) {
      // City-state: needs FULL enclosure, UNLESS a much stronger realm deeply
      // engulfs it (then it's peacefully annexed — see CITY_ENCLAVE_* note).
      const domPow = cPow.get(intoId) || 0, selfP = cPow.get(selfCC) ?? Infinity;
      needFrac = (!_cityEnclaveOff && domPow >= selfP * CITY_ENCLAVE_POWER) ? CITY_ENCLAVE_DOMINANCE : 1.0;
    }
    if (bestBord < totBord * needFrac) continue;    // no realm clearly surrounds it → leave it
    const into = countries.get(intoId);
    if (!into) continue;
    // Claim it POLITICALLY: flip the settlements in the region. The land
    // itself follows on the next territory pass — settlements that changed
    // country re-seed the country Voronoi, and computeTerritory grows the
    // economic catchments into the wild pocket organically. We deliberately
    // do NOT stamp the per-settlement ECONOMIC owner[] array here any more:
    // dumping the (often infertile, transport-unreachable) enclave tiles onto
    // the surrounder's CAPITAL inflated its _terrTiles with land it could
    // never farm, and under FARM_FERT_FLOOR that phantom acreage actively
    // REDUCED the capital's net food every pass — absorbing an enclave made
    // the empire hungrier. Political fill of true wilderness pockets is
    // already handled by fillEnclosedWaste / closeRealmGaps (countryTerritory).
    for (const ti of region) {
      if (elev[ti] <= 0) continue;
      const oid = owner[ti];
      if (oid < 0) continue;
      const s = byId.get(oid);
      if (s && s.countryId !== intoId) {
        s.countryId = intoId;
        s.loyalty = 0.6;
        s._conqueredAt = world.step;
      }
    }
  }
}
