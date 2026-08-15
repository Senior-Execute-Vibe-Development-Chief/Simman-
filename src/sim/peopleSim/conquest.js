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

import { recordIn, recordOut, IN_AID, IN_TRIBUTE, IN_STATE_PAY, IN_TARIFFS, IN_FINANCE, OUT_TRIBUTE, OUT_AID } from "./money.js";
import { shockUnrest } from "./shocks.js";
import { localEdgeCost, tileOpenness, refugeHoldAt } from "./transport.js";
import { TECHS } from "./tech.js";
import { inCrisis } from "./dynasties.js";
import { personalityOf, inheritPersonality, driftPersonality, expansionReachMul } from "./personality.js";
import { CITY_TIER, resScaleFor, successorStatesOn } from "./countryTerritory.js";
import { techEff, getWealthReserve, recordCaptives, monetization, realOutputOf } from "./settlement.js";
import { TRADABLE } from "./goods.js";   // resource-hunger absorption term (T.RESOURCE_WARS)
import { realmName } from "./chronicle.js";
import { logEvent } from "./events.js";
import { ensurePolity, endPolity, getPolity, getOrCreateRecord, reconcilePolities, updateTribute, SIZE_REF } from "./entities.js";
import { identityWeightsFor, identityGrievance, adminFriction, identityGrievanceCause, absorbResistance } from "./cohesion.js";
import { T, passWindow } from "./tuning.js";
import { hash32 } from "./rng.js";
import { closeWar } from "./armies.js";
import { updateLoyaltyField, updateGrievLedger, grievOf, ATTACH_SECEDE, GRIEV_UNREST_W } from "./loyaltyField.js";
import { tel, telPass } from "./telemetry.js";
import { fieldShift } from "./popField.js";

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
// ── Submission (vassalage) ────────────────────────────────────────────
// A statelet facing hopeless odds SUBMITS to the dominant neighbour instead of
// waiting to be ground down: it keeps its court, seat, faith and internal rule
// but takes an overlord — entering the SAME dependency plumbing colonies use
// (pol._overlord → tribute stream, bloc membership, no fronts inside the pair,
// the independence line as the exit, full annexation only via the normal
// absorb path once assimilation lowers identity resistance). This is the
// consolidation force that organises the late-game map into suzerainty
// networks — it replaces the old lopsided-engulfment override, which reached
// past the admin-capacity mechanism to vacuum statelets off the map directly.
const SUBMIT_RATIO = 5.0;  // odds (their whole network vs yours) past which a court chooses tribute over annihilation — resistance is demonstrably hopeless
// Submission is a HAZARD per tick of history, not a per-pass roll — so the
// POLITY_INTERVAL perf lever never changes how fast courts capitulate (per-pass
// rolls would run 5× hotter at interval 30 than at 150). ≈ once per ~600 ticks
// of sustained hopeless odds: a court holds out a generation or two, not forever.
const SUBMIT_HAZARD   = 0.0017; // per-tick capitulation hazard under hopeless odds (converted to a per-pass probability by _passProb, which never saturates)
const SUBMIT_REACH = 1.5;  // a suzerain overawes out to this multiple of its hold reach: a punitive expedition ranges past where a permanent garrison (direct administration) can sit, and a vassal costs no garrison — it administers itself
// ── Nomad confederations (a polity MODE, derived every pass — see classifyNomads) ──
// Riding is REAL past the chariot gate — the same mobility threshold the tech
// tree itself uses (throws if the tree ever renames it, instead of silently
// classifying nobody).
const _chariotTech = TECHS.find(t => t.id === "chariots");
if (!_chariotTech) throw new Error("conquest.js: TECHS has no 'chariots' — nomad classification needs its mobility gate");
const CHARIOT_MOB = _chariotTech.gate[1];
const NOMAD_OPEN_MIN   = 0.5;   // a tile is saddle-country when at least half the full riding discount is available there (transport.js tileOpenness: dry grass, low relief)
const NOMAD_FERT_MAX   = 0.35;  // ...and too poor to farm: below this yield the herd beats the plough (floodplain agriculture is indexed from fert ≥ 0.25; 0.35 is marginal cropland at best)
const NOMAD_HORSES_MIN = 0.05;  // herds must actually be reachable at the seat — the same floor the economy uses for horse wealth to exist at all (LEGACY seat-test only; the field test reads herds from the mobility gate itself — see classifyNomads)
const NOMAD_PEOPLE_MAJ = 0.5;   // a realm is pastoral when the MAJORITY of its governed people live on saddle-country — the definition of the mode, not a dial
const NOMAD_MOMENTUM   = 2;     // a confederation is a charisma-glued winning streak: banked conquest/raid momentum counts (and can carry) double for a nomadic realm — and evaporates on the same decay clock, so a stalled horde deflates fast
// Post-khan shatter: a contested succession disputes the ONLY thing holding a
// confederation together. Hazard per tick of history while a dynastic crisis is
// live — ≈ even odds across one crisis window, because steppe confederations
// rarely survived a contested succession intact.
const NOMAD_SHATTER_HAZARD = 0.0023;
// The raid economy (hordeRaids): what the steppe cannot grow it takes from the
// sown. Per-tick hazard of a raid season against a given rich neighbour
// (≈ one season per generation per target when undeterred); the take is the
// same "portable, seizable share" logic as a sack's PLUNDER_FRAC, spread over
// a season of border raids instead of one storm, scaled by the wealth gradient
// and throttled by the defender's power.
const RAID_REACH   = 2.0;    // a horde raids out to this multiple of its hold reach — raiding parties range far past what the khan governs
const RAID_HAZARD  = 0.0017; // per-tick chance of a raid season against one target realm
const RAID_TAKE    = 0.10;   // ceiling share of a reachable settlement's portable coin one season carries off (before gradient/defence scaling)
const RAID_CAPTIVE = 0.03;   // ceiling share of a raided settlement's people swept into the captive trains (slave machinery; only when T.SLAVERY)
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
// ── Government spending (monuments / infrastructure / debt) ─────────────
const MONUMENT_DECAY = 0.9985; // the monuments/legitimacy stock fades very slowly — a cathedral or
                               // forum keeps overawing the people for ages after it's built
const DEBT_INTEREST  = 0.03;   // interest per pass on outstanding state debt (paid to the financier city)
const DEBT_CAP_MULT  = 6;      // a state may owe at most this many peacetime army bills before creditors cut it off
const MONUMENT_REF   = 0.6;    // monuments-stock per head at which legitimacy is half-saturated (calibration)
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
// TAX_BASE -> runtime lever (tuning.js T.TAX_BASE): baseline share of a member's
// wealth taxed per pass. Lowered from the old 0.06 — at 0.06 the state recycled more
// coin per pass (as army pay) than the private trade economy generated, so "state pay"
// was almost every settlement's largest income; at the lever default most settlements
// now visibly live on their TRADE (goods/food/luxuries/tolls) instead.
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
const ESTATE_DRIFT = 0.12;   // consolidation clock: elites with cash buy land FAST (~63% of the way per 8 polity passes ≈ 3 centuries — the Punic-Wars→Gracchi rise)
const ESTATE_BREAK = 0.02;   // fragmentation clock: breaking estates means coercing the elite itself, so tenure unwinds on the slow institutional clock (serfdom's) — the ratchet the Gracchi died on
const CONQ_DECAY = 0.92;     // a conquest fortune is spent down over ~2 generations (half-life ~10 passes) — real wealth seeking assets, not the 4-pass morale pulse _spoils models
const CONQ_REV_FLOOR = 30;   // treasury income below which "share of state income" is noise (a petty band's one raid is not a fiscal-military state)

// The fiscal record IS the persistent polity entity (entities.js): treasury,
// revenue/spend, momentum and tax state all live on it and survive capital
// changes, conquest, and restoration.
export function govOf(world, countryId) {
  // Lifecycle-neutral: fiscal bookkeeping must never resurrect a dead realm.
  return getOrCreateRecord(world, countryId);
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
// old count-forcing dials (CAP_BASE/CAP_POP/CAP_ORG — all removed).
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
// The relative-unit twin of CAP_K (T.CAP_RELATIVE; see the capacity-ruler note in
// updatePolities): same physical meaning — provinces held per unit of log-relative
// power — re-derived because the relative ruler's log2 argument is the era-median
// ratio (≈1 for a median capital) where the legacy base was absolute-inflated
// (≈3-4 at the classical era CAP_K was calibrated in). SIM_CAPK_REL overrides for
// headless calibration sweeps.
const CAP_K_REL = (typeof process !== "undefined" && process.env && +process.env.SIM_CAPK_REL) || 7.8;
// Saturation scale of the fiscal-surplus → capacity response (CAP_MODEL): the surplus
// level (in multiples of the peer mean) beyond which extra extraction buys almost no
// additional administrative reach in the same era — absorptive capacity, Tilly's
// bureaucracy as the bottleneck, not the treasury. ~linear below 1×-over-peers (the
// calibrated regime), asymptoting at this value. SIM_FISC_SAT overrides for sweeps.
const FISC_SAT = (typeof process !== "undefined" && process.env && +process.env.SIM_FISC_SAT) || 3.5;
const POW_REF = 380;
// Dominant-empire tail: a capital whose coercive power stands well ABOVE the typical
// capital of its age projects authority over a disproportionately larger realm — the
// few great powers (Rome, the Caliphate, the Mongol khans, Britain) that tower over a
// fragmented pack instead of the log2 compressing everyone to one uniform ceiling.
// Measured RELATIVE to the era's median capital power (world._refCapPower), so the
// global demographic scaling (index.js _eraProd) can't wash it out; bounded so the
// hegemon is dominant, not all-consuming, and self-limiting — a rising giant lifts the
// median it is measured against.
const CAP_DOM_W   = 0.9;   // extra capacity per (above-average power)^P
const CAP_DOM_P   = 1.5;   // CONVEX: only genuine OUTLIERS tower — a power-law tail of a few great
                           // powers, not a uniformly bigger pack (sustainable size ≈ capacity^⅔, so
                           // the top core needs ~6–8× capacity to reach a Rome-scale share of the map)
// The dominance CEILING emerges from institutional development: T.CAP_DOM_MAX is the
// MATURE-bureaucracy ceiling; a primitive realm (capCoh→0) saturates at this far
// lower base instead (see the domCeil derivation in updatePolities). Not a fixed
// era-blind clamp — the most a hegemon can tower scales with its delegation tech.
const CAP_DOM_CEIL_BASE = 4;   // primitive (capCoh→0) dominance ceiling — early hegemons stay bounded
// CAP_MODEL (T.CAP_MODEL, W6-C R5) — the GROUNDED replacement for the fitted CAP_DOM_W/P
// tail. Instead of asserting "capacity ∝ (relative power)^1.5" (a curve-fit exponent with
// no mechanism), dominance is derived from Tilly's real levers: a realm towers over its
// peers when it EXTRACTS more fiscal surplus than they do AND has the LOGISTICS to project
// it — logistics multiplies what a unit of surplus BUYS (a bronze-age surplus hires runners,
// a rail-age surplus governs a continent), so dominance = 1 + CAP_FISC·surplus·(1 +
// CAP_LOG·logistics): LINEAR in surplus, with the convexity of the great-power tail carried
// by the logistics channel rising late — sprawling integrated empires only emerge once the
// reach techs exist. (The original form carried an extra ∝ fiscalSurplus² compounding term;
// it had no physical derivation — surplus entered twice — and it turned any dip in the
// small-sample peer median into a planet-scale mandate: the measured Renaissance capacity
// spikes, ×4-8 in one polity pass, behind the late-game territorial blow-up. It also never
// actually ran — it read capE.logistics, a field techEffects doesn't return, so the
// compounding was silently 0 and CAP_LOG was a dead lever until this wiring fix.) The two
// weights are physical coefficients (provinces per unit fiscal surplus; how much further a
// unit of surplus reaches per unit of logistics tech), each with independent meaning — not a
// shape dialled to an outcome. Same emergent ceiling (domCeil). Reads world._refRevenue +
// gov._lastRevenue (see updatePolities). Both live in tuning.js (T.CAP_FISC, T.CAP_LOG) so
// the grounded tail can be A/B-calibrated against the size gates without a rebuild.
// The peer baseline is SMOOTHED (REF_REV_SMOOTH): the raw per-pass median whipsaws — it is
// taken over the handful of multi-member realms, and one war-gutted entry moves it several-
// fold (measured 276→126→49→179 across consecutive polity passes), which every solvent realm
// then reads as suddenly out-taxing its peers. Peer expectations are institutional and move
// over years, so the reference eases toward the fresh median like _impCapacity does for
// capacity — an honest low-pass on a noisy emergent statistic, not a fitted floor.
const REF_REV_SMOOTH = 0.25;  // per polity pass: reference ≈ the last ~4 passes' median
// STATE_WORKS rates (the maintained-reach stock; see the block in rebuildCountries).
// Each has meaning on its own: how much extra writ a unit of √(fiscal scale above
// the era's median) buys, how fast a state can lay network per pass at full
// construction, and how fast an unmaintained network dilapidates. BUILD ≪ DECAY is
// the asymmetry that makes the arc historical: generations to build the roads, a
// crisis to lose them.
const WORKS_GAIN  = 0.55;   // works stock per √(fiscal scale over the era's median realm)
const WORKS_BUILD = 0.030;  // per pass at construction 1.0 — an imperial road system is decades of work
const WORKS_DECAY = 0.085;  // per pass unmaintained — dilapidation outruns construction ~3×
// Imperial-hysteresis rates:
const CAP_IMP_RISE  = 0.04;   // imperial-capacity stock rises toward live capacity (institutions accrete)
const CAP_IMP_DECAY = 0.010;  // ...and decays ~4× slower when power falls (institutions persist → hysteresis)
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
// SIZE_REF -> shared with the adoption fisc test (entities.js) — one ruler for "how big to govern"
const RECENCY_LOAD  = 1.0;   // a freshly conquered province costs this much extra...
// RECENCY_TICKS -> runtime lever (tuning.js T.RECENCY_TICKS)
const LOYAL_RECOVER = 0.06;  // per pass: covered provinces climb toward full loyalty
// CTRL_LIVE: a province is loyal while the field holds it at ≥ this fraction of the CAPITAL's
// hold; below it (the weakly-held outer frontier) it bleeds loyalty and can secede — a
// self-scaling fragmentation brake so a big empire sheds its far marches while a compact realm
// holds firm. Env-tunable for the live-field balance.
const CTRL_LOYAL_FRAC = (typeof process !== "undefined" && process.env && +process.env.SIM_CTRL_LOYAL) || 0.18;
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
// ── Balance of power: emergent alliances against the regional threat ──────────
// The missing self-correcting force. A realm grows by conquest where it out-powers
// its neighbours — but in reality that very growth turns the neighbours into a
// COALITION: weak and similar-sized powers that fear the same rising hegemon band
// together, and their combined weight backs each member's defence, so the giant's
// expansion stalls exactly when it has grown threatening enough to alarm a matching
// bloc (Europe balancing Habsburg/Bourbon/Napoleonic France). Where no such bloc
// can form — a realm facing only sparse, fragmented, far-weaker neighbours or empty
// land (Russia into Siberia, the US across the plains) — nothing balances it and it
// runs away. So empire size emerges from the NEIGHBOURHOOD, not a hard ceiling: the
// coalition's strength relative to the hegemon IS the cap, and it is whatever the
// map makes it. This replaces the stack of "can't swallow the continent" constants.
const THREAT_RATIO   = 1.25;  // a bordering realm this many× your power is a "threat" you balance against
export const BALANCE_W   = 1.1;   // how hard a coalition backs a member it defends (× the attack bar, ∝ bloc/hegemon power)
export const BALANCE_CAP = 3.0;   // ceiling on that backing (a coalition deters, it doesn't make a member invincible)
const ALLY_TRADE_REF = 6;     // cross-border money/tick at which two realms are "mutual-benefit" allies regardless of threat
const ALLIANCE_EVERY = 600;   // recompute the (slow-drifting) alliance map this often
// Naive `world.step % EVERY === 0` is DEAD inside this phase-offset pass (it
// froze the alliance map at its first build) — see passWindow (tuning.js).
const _polityWindow = (world, every) => passWindow(world, T.POLITY_INTERVAL, every);
// The polity pass's span in ticks — per-tick hazards multiply by this so a
// per-history rate never varies with the POLITY_INTERVAL perf lever.
const _passTicks = () => Math.max(1, Math.round(T.POLITY_INTERVAL * (T.SIM_GRANULARITY || 1)));
// Per-pass probability of a per-tick HAZARD firing at least once across the
// pass span — the EXACT compounding 1-(1-h)^ticks, which is cadence-invariant
// AND can never reach 1 (a naive hazard×ticks saturates past 1 once the perf
// lever is turned up, silently making the event fire every pass — a rate set by
// the cadence, not the world). Used by every per-tick hazard in this pass.
const _passProb = (hazard) => 1 - Math.pow(1 - hazard, _passTicks());

// ── Colonial dependencies: a self-governing colony bound to an overlord ───────
// An overseas colony (sea.js) is founded as its OWN realm — own capital, own LOCAL
// administrative reach, so it holds and rolls its own frontier instead of stalling as
// an unsheddable far province on the metropole's admin budget — but it is a DEPENDENCY
// of its founder (polity._overlord): the two never fight and stand together as one bloc,
// the colony's weight counts toward the metropole's empire, and goods/tribute flow home
// while protection and tech flow out. It breaks free — one clean political INDEPENDENCE,
// not per-province secession — once it has OUTGROWN the metropole (the US/Latin-America
// arc), which emerges from their relative power, never from a date.
const INDEPENDENCE_EVERY  = 600;   // how often the independence check runs (perf cadence)
const INDEP_POWER_RATIO   = 0.8;   // a dependency whose power reaches this fraction of the force the metropole can PROJECT to it has outgrown the apron strings → independence
const TRIBUTE_FRAC        = 0.15;  // share of a MATURE dependency's treasury remitted home to the overlord each polity pass
const COLONY_TECH_DIFFUSE = 0.06;  // base per-pass rate the colony seat's knowledge is pulled toward the metropole's (× the metropole's reach)
// Naval power projection: a metropole protects, supplies and holds a colony only as far as
// its navy can REACH — projection DECAYS with distance and RISES with naval-logistics tech
// (Spain's tenuous Pacific grip vs Britain's steam-navy global reach). proj = navalReach /
// (navalReach + distance) ∈ (0,1]; it governs EVERY parent→colony flow and the independence
// line, so protection and support are neither automatic nor perfect — the realistic limit on
// how far, and how strongly, an empire can hold across the sea. This is WHY distant colonies
// broke away: the metropole simply could not project enough force to hold them.
const NAVAL_REACH_BASE    = 8;     // REFERENCE-tiles (×resScaleFor at other grids) a metropole can project with no naval tech (coastal reach)
const NAVAL_REACH_NAV     = 70;    // extra projection REFERENCE-tiles at full navigation tech

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
// T.ELITE_FRACTURE sub-constants (docs/hegemon-ossification-2026-07.md §6). Each
// has independent meaning; the master lever weight scales the whole family, ×0 off.
const ELITE_PROJ       = 1.0;   // (1) weight of distance-attenuation on the throne's PROJECTED suppression (÷(1+PROJ·far))
const ELITE_COURT_FRAC = 0.35;  // a province counts as a rival COURT at ≥ this fraction of the throne (elite overproduction)
const ELITE_COURT_W    = 0.5;   // (2) each extra strong court adds this to the ambition gain (courts embolden each other)
const ELITE_MAGNATE_W  = 1.2;   // (3) magnate estates (_estates 0..1) fund the breaker — full estate ~ +1.2× gain
const ELITE_CRISIS_EMBOLDEN = 1.8;  // (4) a succession crisis multiplies the gain (the Diadochi opening)
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
// T.REACH_GROUND — the ZERO-TECH base re-grounded to the pre-logistics fact
// (the variance arc's density root, docs/variance-arc-2026-08-13.md: "in the
// whole middle east area, only really 2 nations ever FIT"). RANGE_BASE_T = 5
// cost-units ≈ an ~800km easy-terrain hold radius for a court with NO
// logistics at all — the base was doing the empire's work, so every newborn
// realm was born imperial-sized (measured: median realm 440-565k km² by step
// 6,000 — Old-Kingdom Egypt's whole footprint at best, ~5× the early-bronze
// norm) and a region that historically carried Egypt + Hatti + Mitanni +
// Assyria + Babylon + Elam + a dozen Levantine city-states "fills" at two.
// History's pre-road, pre-horse court administered ~50-150km directly (days
// of donkey round-trip); everything farther was logistics — which the law
// already prices (RANGE_LOGI carries roads→rail; rivers are cheap tiles, so
// Egypt's court runs far ALONG THE VALLEY on a small budget: the valley
// kingdom emerges from geography, not from a floor). Under the lever the
// base falls to ~1 cost-unit (~a day or three of easy country, ~150km) and
// every longer arm is EARNED. 0 = the imperial floor (byte-identical).
const RANGE_BASE_G = 1;

// Editor helper: the territorial hold-reach (in map tiles) a realm seated at
// `seat` would project from its tech + personality — the same formula
// rebuildCountries uses (above), so the country editor can fill a realm to the
// outer extent its tech actually allows.
export function estimateCountryRange(world, seat, personality) {
  const k = seat.knowledge || {};
  const bE = techEff(seat), bMob = k.mobility || 0, bNav = k.navigation || 0;
  const rangeOld = RANGE_BASE + bE.reachLevel * RANGE_ORG + bMob * RANGE_MOB + bNav * RANGE_NAV;
  const rangeNew = RANGE_BASE_T + bE.logisticsLevel * RANGE_LOGI + bE.reachLevel * RANGE_ADMIN + bMob * RANGE_MOB_T + bNav * RANGE_NAV_T;
  let range = rangeOld + (rangeNew - rangeOld) * T.TECH_EFFECTS;
  if (personality) range *= expansionReachMul(personality);
  const rs = _holdScaleEnv > 0 ? _holdScaleEnv : resScaleFor(world.tw);
  return range * rs;
}
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
    const rangeNew = (T.REACH_GROUND ? RANGE_BASE_G : RANGE_BASE_T) + bE.logisticsLevel * RANGE_LOGI + bE.reachLevel * RANGE_ADMIN + bMob * RANGE_MOB_T + bNav * RANGE_NAV_T;
    c.range = rangeOld + (rangeNew - rangeOld) * T.TECH_EFFECTS;   // transport-gated hold-distance (TE=0 → old admin-driven)
    // Personality nudges reach: an expansionist realm projects authority a
    // little farther, a cautious one pulls in. Knowledge still sets the bulk
    // of the reach — this is a mild temperament colouring on top (see
    // personality.js). The personality is lazily seeded from the capital's
    // environment the first time it's read.
    c.personality = personalityOf(world, c);
    c.range *= expansionReachMul(c.personality);
    // GRIP (hold reach): c.range is the realm's hold-distance in raw tile-cost.
    // The GRIP that's compared against actual map distances — the admin load
    // (d/grip) and the secession reach (effReach) — is res-scaled so a big-map
    // realm holds the same FRACTION it claims (the territorial reach is
    // res-scaled too; without this the surplus frontier reads as chronically
    // "loose" and sheds in scattered patches — see resScale note). The Dijkstra
    // SEARCH bound (capitalTransportCosts' maxCost = range×25) carries the SAME
    // scale since the res-invariance pass (2026-07): raw, it truncated the
    // flood at 1/resScale of the real admin radius and the outer belt of every
    // big fine-grid realm read "unreachable → secede". The old blow-up fear is
    // handled by the flood's pending-members early-exit, not by under-searching.
    c.holdReach = c.range * resScale;
    c.hue = ((c.id * 61) % 360 + 360) % 360;
    buildHierarchy(world, c);
    assignProvinces(world, c);
  }
  // ── T.STATE_WORKS: the road, the relay, the waystation — reach as a
  // MAINTAINED STOCK (2026-08-14, docs/atlas-gap-2026-08-14.md cause I) ──────
  // c.range above is a pure function of the CAPITAL'S TECH, so every realm in
  // an era holds the same radius and the map has no reach outliers — measured
  // as "administrative reach ramps linearly where history stepped"
  // (docs/50k-run-2026-08-01.md §7b, recorded as hypothesis, never built).
  // History's giants were exactly that outlier: the Royal Road, the cursus
  // publicus, the Grand Canal, the yam relay — a state that out-collected its
  // contemporaries converted the difference into WORKS and governed 3-5× the
  // country its neighbours could, then lost the network when the fisc failed
  // (Rome's roads after the third-century crisis; the canal silting).
  //
  // Why this is not the guarded loop: the capacity tail deliberately reads
  // surplus PER MEMBER because "the tail rewards sheer SIZE and capacity
  // compounds on itself" (~L2547). That guard is about a revenue MULTIPLIER,
  // which has no restoring force. A works STOCK does, in three independent
  // ways: (1) a network over a territory scales with the AREA it must serve,
  // so the extent a fisc can maintain goes as √(fiscal scale) — territory is
  // already ∝ reach², so the feedback loop's gain is ~1, not >1, and the
  // equilibrium is set by the upkeep constant rather than by the feedback;
  // (2) marginal frontier land is emptier than the core (the existing
  // hostility/capacity physics), so revenue grows SLOWER than area; (3) the
  // administrative-returns ceiling below. And the failure mode is the point:
  // unfunded upkeep decays the stock FASTER than construction rebuilds it, so
  // an overextended empire's reach collapses and it sheds — the bust the
  // owner's "50 year empires" asks for, from the same mechanism as the boom.
  //
  // The measure is RELATIVE TO THE ERA'S MEDIAN REALM (the codebase's own
  // smoothed-ruler idiom — _refRevenue, _refCapPowerS, _refRealmPop): a realm
  // at parity gets nothing, and when every state industrialises together
  // nobody gains — extraordinary reach is always extraordinary FOR ITS TIME,
  // never a clock. No coin moves: this models what a fisc can SUSTAIN, not a
  // new money sink (the closed-supply conservation invariant is untouched).
  if (T.STATE_WORKS > 0) {
    const sus = [];
    const susOf = new Map();
    for (const c of countries.values()) {
      const g = govOf(world, c.id);
      // Total fiscal extraction in era-normalized units ("how many median
      // members' worth of income does this state collect"): the one reading a
      // network's upkeep genuinely demands — "can Rome afford the cursus
      // publicus" has no per-head answer.
      const s = Math.max(0, (g._lastRevenue || 0) / Math.max(1, world._refRevenue || 1));
      susOf.set(c.id, s);
      if (c.members.length > 1) sus.push(s);
    }
    if (sus.length) {
      sus.sort((a, b) => a - b);
      const med = Math.max(1e-6, sus[sus.length >> 1]);
      const prev = world._refWorks;
      world._refWorks = prev > 0 ? prev + (med - prev) * REF_REV_SMOOTH : med;
    }
    const ref = Math.max(1e-6, world._refWorks || 0);
    for (const c of countries.values()) {
      const g = govOf(world, c.id);
      const rel = (susOf.get(c.id) || 0) / ref;
      // √ of the scale ABOVE the era's median — the areal-network law (a
      // network serving area ∝ R² costs upkeep ∝ R², so the extent a given
      // income sustains goes as √income), capped by administrative returns:
      // past some density more roads stop extending the writ, because a
      // courier still has to rest and an order still takes days.
      const target = Math.min(T.WORKS_CEIL, WORKS_GAIN * Math.sqrt(Math.max(0, rel - 1)));
      const have = g._works || 0;
      // Asymmetric: construction is slow and tech-gated (a bronze-age state
      // cannot lay a rail network); dilapidation is fast and needs no one.
      const rate = target > have
        ? WORKS_BUILD * Math.max(0, (c.capital && c.capital.knowledge && c.capital.knowledge.construction) || 0)
        : WORKS_DECAY;
      const next = have + (target - have) * rate;
      g._works = Number.isFinite(next) ? Math.max(0, Math.min(T.WORKS_CEIL, next)) : 0;
      // The stock extends the writ, and the grip is re-derived from it: a state
      // that out-collects its era and spends the difference on roads, relays and
      // waystations governs further per unit of statecraft — and loses that reach
      // when the network is no longer maintained. 0 stock ⇒ x1, byte-identical to
      // the tech-only radius. (Runs after the capital/range pass because the build
      // rate is gated on the CAPITAL's construction — before it, every capital is
      // still null and the rate would silently be zero. Hierarchy and provinces
      // read neither range nor holdReach, so nothing upstream sees the change.)
      if (g._works > 0) { c.range *= 1 + T.STATE_WORKS * g._works; c.holdReach = c.range * resScale; }
    }
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

// The REGIONAL radius a provincial seat administers (reference tiles; res-scaled
// like every other map distance): a province is the land within a region's span of
// its seat. Numerically equal to countryTerritory's NUCLEATE_R at the 240 reference
// — but NB NUCLEATE_R is used UNSCALED there (a latent res-invariance inconsistency,
// noted, not this change's to fix), so the two diverge on larger grids.
const PROVINCE_SPAN = 9;
// PROVINCES — assign every member to the nearest SEAT of its realm: the capital,
// any CITY, and any LOCALLY-STRONGEST member (no stronger realm-mate within a
// PROVINCE_SPAN — the label-free regional centre). The functional clause matters:
// the CITY label floats with the age's total population (settlement.js updateTier),
// pinning labelled cities to the top handful of the world — so a tier test alone
// left big town-built realms with NO provincial seats at all, which silently killed
// the governor-breakaway channel (see blocHasSeat) and made over-extended empires
// immortal. A local power maximum is a seat whatever the census calls it.
// Used by the GOVERNOR-revolt path (declareIndependence — an overmighty
// governor takes his whole province) and as a coarse admin grouping. NOTE:
// over-extension secession no longer sheds by this unit — it's tile-driven now
// (shedFrontier carves loose territory by the cities standing on it); and the
// drawn Provinces overlay is its own territory-catchment + homeland partition.
function assignProvinces(world, c) {
  const seats = [];
  const span = PROVINCE_SPAN * resScaleFor(world.tw);
  const span2 = span * span, halfTw = world.tw / 2;
  const pow = c.members.map(m => settlementPower(m));      // precomputed once — the pair loop below is O(n²)
  const d2 = (a, b) => { let dx = Math.abs(a.pos.x - b.pos.x); if (dx > halfTw) dx = world.tw - dx; const dy = a.pos.y - b.pos.y; return dx * dx + dy * dy; };
  for (let i = 0; i < c.members.length; i++) {
    const m = c.members[i];
    if (m.id === c.capitalId || (m.tier | 0) >= CITY_TIER) { seats.push(m); continue; }
    let localTop = true;                                   // locally-strongest member = regional seat
    for (let j = 0; j < c.members.length; j++) {
      if (j === i) continue;
      if (pow[j] > pow[i] && d2(m, c.members[j]) < span2) { localTop = false; break; }
    }
    if (localTop) seats.push(m);
  }
  if (seats.length === 0 && c.capital) seats.push(c.capital);
  for (const s of c.members) {
    let best = seats[0], bd = Infinity;
    for (const seat of seats) {
      const d = d2(s, seat);
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
// (Exported for countryTerritory's restoration-from-the-ground foundings —
// a re-emerging nation is an already-administered claim, same as secession.)
export function snapClaim(world, id) {
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

// A successor state needs a SEAT of government to carry sovereignty: a CITY, or
// any member that is its own PROVINCIAL seat (assignProvinces — a regional centre
// with a working administration, whatever the census labels it). History note,
// twice-learned: this gate once required a full CITY (tier 2) and that "was the
// bug that made empires immortal — a realm built of towns and villages had NO
// member that could ever lead a breakaway, so its frontier revolts ALL failed the
// gate, re-pacified, and stayed however far past the hold budget it sat." It was
// fixed by reading CITY_TIER when CITY_TIER meant TOWN — and silently re-broken
// when CITY_TIER was raised to 2 to kill the founding micro-state swarm (a
// correct change for FOUNDING, see countryTerritory.js), dragging this bar up
// with it (measured at 24k steps: 12 secessions vs 76 polity deaths, capacity
// slack ~200 on the leader). Founding and secession guard different pathologies
// and need different bars: a successor INHERITS a functioning administration, so
// the functional provincial-seat test — not the floating city label — is the bar.
function blocHasSeat(bloc) {
  for (const m of bloc) if ((m.tier | 0) >= CITY_TIER || m._provinceCity === m.id) return true;
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
    // LOYAL_FIELD: "restless" is the PEOPLE's detachment (county attachment),
    // not the seat's administrative stock — the yearning that restores a nation
    // lives on the ground, whose memory the derive already put in m._homeland.
    const restless = c.members.filter(m => m.countryId === c.id && seededH.has(m._homeland ?? -1)
      && (T.LOYAL_FIELD ? (m._attach ?? m.loyalty ?? 1) : (m.loyalty ?? 1)) <= REVOLT_JOIN_LOYALTY
      && world.step - (m._conqueredAt ?? -Infinity) >= T.CONQUEST_GRACE);
    restoreNations(world, restless, c.id, true);
  }
  const co = world._countryOwner, owner = world._territoryOwner, localCost = world._countryCost;
  if (!co || !owner) return;
  const tw = world.tw, th = world.th;
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
  // Flood only the realm's own loose patches, seeded from its MEMBER home tiles —
  // not a full-map O(N) scan. A patch can only secede if it carries a restless
  // seed (a member), so a patch with no member on it is never shed; seeding from
  // member tiles therefore reaches every sheddable patch while touching only the
  // realm's land. `seen` is a Set (patch-sized), not a per-call Uint8Array(N).
  const seen = new Set();
  for (const m0 of memberHome.values()) {
    const s0 = (m0.pos.y | 0) * tw + (m0.pos.x | 0);
    if (seen.has(s0) || !looseAt(s0)) continue;
    const stack = [s0]; seen.add(s0); let hasSeed = false, touchesEdge = false; const members = [];
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
        if (seen.has(ni) || !looseAt(ni)) continue;
        seen.add(ni); stack.push(ni);
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
function shedPatch(world, c, members, how) {
  // Successor seats (T.SUCCESSOR_STATES): a CITY, or any member that is its own
  // PROVINCIAL seat — blocHasSeat's exact member test (see its twice-learned
  // history above). The floating CITY label pins labelled cities to the age's
  // top handful, so the label-only bar left almost every shed patch seatless and
  // the towns-fallback/lapse floor below was the whole outcome (measured: 0
  // polity.seceded per 24k). A provincial seat is spacing-bounded by construction
  // (locally-strongest within PROVINCE_SPAN — assignProvinces, stamped fresh at
  // the top of this same polity pass), so successors are province-sized, never
  // per-town — founding and secession need different bars. A non-city seat also
  // needs the patch to be a real region (≥2 members — a successor is a seat plus
  // at least one dependent, restoreNations' rule; the towns-fallback's own bar):
  // a stranded lone town lapses rather than minting a 1-member fleck.
  const succ = successorStatesOn();
  let seats = succ
    ? members.filter(m => m.id !== c.capitalId
        && ((m.tier | 0) >= CITY_TIER || (m._provinceCity === m.id && members.length >= 2)))
    : members.filter(m => (m.tier | 0) >= CITY_TIER && m.id !== c.capitalId);
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
  // Anti-confetti fold (T.SUCCESSOR_STATES): a successor is a seat PLUS at least
  // one dependent — the same ≥2 rule restoreNations enforces. A non-city seat the
  // watershed left alone folds into the nearest other seat's cell (distance tie →
  // smaller id); a full CITY alone remains a city-state; a single-seat patch is
  // one successor, as before.
  if (succ && seats.length >= 2) {
    for (let i = seats.length - 1; i >= 0 && seats.length >= 2; i--) {
      const seat = seats[i];
      if ((seat.tier | 0) >= CITY_TIER) continue;
      const grp = groups.get(seat.id);
      if (grp && grp.length >= 2) continue;
      let near = null, nd = Infinity;
      for (const o of seats) {
        if (o === seat) continue;
        const d = dist(world, seat.pos.x, seat.pos.y, o.pos.x, o.pos.y);
        if (d < nd || (d === nd && near && o.id < near.id)) { nd = d; near = o; }
      }
      if (!near) continue;
      const ng = groups.get(near.id);
      if (grp) for (const m of grp) ng.push(m);
      groups.delete(seat.id);
      seats.splice(i, 1);
    }
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
    // `how` ("receded", from resolveOrphanedMarches) is additive — narrators
    // and every existing reader ignore it; absent on the classic revolt path.
    const ev = { polity: newId, from: c.id, fromName: realmName(world, c.id),
      seatName: seat && seat.name, x: seat ? seat.pos.x | 0 : undefined, y: seat ? seat.pos.y | 0 : undefined };
    if (how) ev.how = how;
    logEvent(world, "polity.seceded", ev);
  }
}

// ── The silent shed made witnessable (T.SUCCESSOR_STATES) ────────────────────
// The territory pass's connectivity release and over-capacity shed set tiles to
// wilderness with NO political event: a settled march dropped off the map with
// its towns, people and homeland memory intact and nothing recorded (measured:
// 99.86% of ~2117 released tiles went realm→wilderness, 35 silent settlement
// lapses, 0 secessions per 24k — docs/design-successor-states.md). Called from
// index.js between computeCountryTerritory (which fills world._fpRel) and
// adoptAndFound (whose unguarded derivation would otherwise silently lapse the
// orphans in the same firing): settled members standing on ground their own
// realm no longer holds — and no rival took (a realm→realm flip is a border
// shift, adoptAndFound's business) — resolve through the EXISTING machinery:
// fallen nations re-emerge first (restoreNations), a patch with a functional
// seat secedes as a successor statelet (shedPatch), a seatless remainder
// honestly lapses (settlement.lapsed) — and either way the parent's recession
// is chronicled (polity.receded). The released-by mask already blocks only the
// PARENT re-taking its shed; a successor is a different id, so its claim is the
// genuine new-realm capture the carto churn fix explicitly allows.
export function resolveOrphanedMarches(world) {
  if (!successorStatesOn() || !T.FIELD_POLITY) return;
  const co = world._countryOwner, rel = world._fpRel;
  if (!co) return;
  const tw = world.tw, elev = world.elev, pf = world.popField;
  // 1. ORPHANS, grouped by realm (settlement-array order — deterministic).
  const byRealm = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (!(elev[ti] > 0) || co[ti] >= 0) continue;         // held ground (own or a rival's) → not an orphan
    let a = byRealm.get(s.countryId); if (!a) byRealm.set(s.countryId, a = []); a.push(s);
  }
  for (const [cid, orphans] of byRealm) {
    const c = world.countries && world.countries.get(cid);
    // No countries view yet (a realm minted since the last polity pass), or the
    // throne itself among the orphans (the death machinery's case, not a march):
    // leave them to the derivation — which now witnesses the lapse.
    if (!c || orphans.some(m => m.id === c.capitalId)) continue;
    // 2. FALLEN NATIONS first (the ground under a conquered march remembers):
    //    the existing machinery verbatim — requireBorder=false, already outside.
    const restored = restoreNations(world, orphans.filter(m => (m._homeland ?? -1) >= 0), cid, false);
    // 3. SUCCESSOR STATELET vs HONEST REVERSION — split by WHY the ground was
    //    released (countryTerritory.js world._fpRelCut). A march the realm was
    //    SEVERED from (step 3: unreachable through its own land, or past the
    //    administrative horizon) has genuinely lost its centre, and a province
    //    that has lost its centre raising its own flag is the Diadochi case this
    //    design is for — it goes to shedPatch, which still applies every seat and
    //    anti-confetti test. Ground the border merely TRIMMED (step 6's
    //    over-capacity shed, 6b's marginal release) is the frontier walking back
    //    one ring toward what the realm can administer; that fires every pass on
    //    any realm above target and is not a political event at all, so it takes
    //    shedPatch's own lapse branch verbatim — the settlement falls stateless
    //    and the land reverts, witnessed.
    //    Without the split, every routine frontier adjustment minted a statelet:
    //    measured at the app grid, 15 polity.receded in the first 2000 steps of a
    //    world holding four realms, and the median realm cut from 12 tiles to 3
    //    (docs/early-game-size-loop-2026-07-31.md).
    const relCut = world._fpRelCut;
    const rest = orphans.filter(m => !restored.has(m.id) && m.countryId === cid);
    const severed = [], trimmed = [];
    for (const m of rest) {
      const mi = (m.pos.y | 0) * tw + (m.pos.x | 0);
      (relCut && relCut[mi] ? severed : trimmed).push(m);
    }
    if (severed.length) shedPatch(world, c, severed, "receded");
    for (const m of trimmed) {
      if (m.countryId !== cid) continue;
      m.countryId = -1; m.loyalty = 1; m._ambition = 0; m._conqueredAt = world.step;
      logEvent(world, "settlement.lapsed", { s: m.id, sName: m.name, from: cid, fromName: realmName(world, cid) });
    }
    // 4. ANCHOR the outcome so this firing's adoptAndFound can't undo it: every
    //    orphan that ended in a (new or restored) realm stamps its home tile —
    //    the same semantics as the territory pass's anchor fallback. Uncharged
    //    this pass (≤1 tile/member — the same under-charge the fill headroom
    //    already accepts); any overshoot is one small shed next pass.
    for (const m of orphans) {
      if (m.countryId >= 0 && m.countryId !== cid) co[(m.pos.y | 0) * tw + (m.pos.x | 0)] = m.countryId;
    }
    // 5. The WITNESS record either way: what the parent's grip lost this firing.
    let relTiles = 0, relPeople = 0;
    if (rel && pf) for (let ti = 0; ti < world.N; ti++) if (rel[ti] === cid) { relTiles++; relPeople += pf[ti]; }
    logEvent(world, "polity.receded", { polity: cid, name: realmName(world, cid), tiles: relTiles,
      people: Math.round(relPeople), n: orphans.length, s: orphans[0].id, sName: orphans[0].name,
      x: orphans[0].pos.x | 0, y: orphans[0].pos.y | 0 });
  }
  // People-but-no-settlement marches (shed ground with field people, no entity):
  // a debug tally, not an event — the log stays entity-anchored throughout.
  if (rel && pf) {
    let t = 0, p = 0;
    for (let ti = 0; ti < world.N; ti++) {
      const r = rel[ti];
      if (r >= 0 && pf[ti] > 0 && !byRealm.has(r)) { t++; p += pf[ti]; }
    }
    if (t > 0) {
      const dbg = world.debug || (world.debug = {});
      dbg.recededTiles = (dbg.recededTiles || 0) + t;
      dbg.recededPeople = (dbg.recededPeople || 0) + p;
    }
  }
}

// Record WHO carries a dead polity's mantle on its persistent record
// (rec.succId): the principal fragment of a shatter. Restoration needs no
// pointer — it re-opens the same id. The pointer is what lets obligations
// bound to the crown (today: a colony's dependency link) follow the
// succession instead of evaporating with the id; see the metropole-fall
// resolution in updatePolities. Never self-referential.
function recordSuccessor(world, deadId, heirId) {
  if (heirId == null || heirId < 0 || heirId === deadId) return;
  const rec = getPolity(world, deadId);
  if (rec && rec.endedStep >= 0) rec.succId = heirId;
}

// The throne has fallen: scatter the dead empire's surviving provinces into
// regional successor states around their strongest cities. Called from
// armies.js the moment a capital is stormed. The conqueror (excludeId) keeps
// only the captured throne-city; everything else fragments.
// `how` labels the polity.ended record: "conquest" (default — a stormed
// capital, excludeId = the conqueror's settlement) or "succession" (the
// post-khan shatter — no conqueror, excludeId -1, every member fragments and
// the dead khan's chest stays on the record, buried with the house).
export function fragmentRealm(world, oldId, excludeId, how = "conquest") {
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
    endPolity(world, oldId, how, by, by >= 0 ? realmName(world, by) : undefined);
    // T.CONQUEST_CASCADE — THE NETWORK IS INHERITED (wave 2, docs/variance-
    // arc-2026-08-13.md): a decisive conquest transfers the fallen realm's
    // WHOLE dependency network to the victor, as it historically did — Cyrus
    // beat Media in one campaign and inherited its empire entire; Alexander
    // administered Persia through Persia's own satraps. Before this, the
    // fallen suzerain's vassal bonds simply dangled/dissolved, so even a
    // decisive war destroyed structure instead of concentrating it — half of
    // why no bloc ever grew past 4-5 members. Succession shatters (how ≠
    // "conquest") still scatter: there is no victor to inherit.
    if (T.CONQUEST_CASCADE && how === "conquest" && by >= 0 && world.polities) {
      const ov = world._overlordOf;
      for (const p of world.polities.values()) {
        if (!p || p._overlord !== oldId || p.endedStep >= 0 || p.id === by) continue;
        p._overlord = by;
        if (ov) ov.set(p.id, by);
        logEvent(world, "polity.submitted", { polity: p.id, name: realmName(world, p.id),
          to: by, toName: realmName(world, by), how: "inherited" });
      }
    }
  }
  let survivors = [];
  for (const s of world.settlements) {
    if (s.mode === "settled" && s.countryId === oldId && s.id !== excludeId) survivors.push(s);
  }
  if (survivors.length === 0) return;
  // ── Collapse scars institutions (T.COLLAPSE_SCAR) ────────────────────
  // The dying STATE's administrative apparatus dissolves with it: every member
  // loses organization technique in proportion to how palace-dependent its own
  // statecraft was (org ×= 1 − SCAR·org). This is the POLITICAL twin of the
  // demographic dark-age channel (KNOW_DECAY reads pop drawdown/isolation and
  // so cannot see a collapse that starves no one) — it is what makes successor
  // and restored states born diminished rather than full-strength, so
  // re-consolidation runs through the learning law instead of being free.
  // The stormed throne city itself is NOT hit here: it left the realm before
  // this call, and its own hit arrives through the sack → drawdown channel.
  if (T.COLLAPSE_SCAR > 0) {
    for (const s of survivors) {
      const k = s.knowledge;
      if (k && k.organization > 0) k.organization = Math.max(0, k.organization * (1 - T.COLLAPSE_SCAR * k.organization));
    }
  }
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
    recordSuccessor(world, oldId, s.id);           // the lone fragment carries the dead state's mantle (colonies follow it)
    return;
  }
  // Successor capitals: the strongest surviving cities, spread apart so the
  // fragments are genuinely separate regions rather than rivals next door. How
  // MANY scales with the dead realm's size — a compact empire splits into a
  // couple of large successors (Roman/Diadochi), a sprawling many-citied one
  // shatters into a crowd of warlord states (Chinese): the number of pieces
  // tracks the severity/scale of the collapse, not a fixed cap.
  // T.SUCCESSOR_STATES: the basis is FUNCTIONAL seats — a city, or a member that
  // is its own provincial seat (blocHasSeat's member test) — because the floating
  // CITY label pins labelled cities to the age's top handful, so the label basis
  // read 0 at every realm size the sim actually produces and the Diadochi channel
  // starved (measured: 16 shatters, 0 fragment successors per 24k). Staleness of
  // _provinceCity here is one polity interval — the same blocHasSeat/
  // declareIndependence already accept.
  const succ = successorStatesOn();
  const isFnSeat = (s) => (s.tier | 0) >= CITY_TIER || (succ && s._provinceCity === s.id);
  const seatCount = survivors.reduce((n, s) => n + (isFnSeat(s) ? 1 : 0), 0);
  const maxStates = Math.max(2, Math.min(FRAG_MAX_STATES, Math.ceil(seatCount / 2)));   // adjacent provinces coalesce in pairs
  const ranked = survivors.slice().sort((a, b) => settlementPower(b) - settlementPower(a));
  const capitals = [];
  // Never re-anchor a successor on the DEAD realm's own id: country ids ARE
  // settlement ids, so a successor whose seat is the founder settlement
  // (s.id === oldId) would reuse oldId — and ensurePolity would REOPEN the
  // record endPolity just closed, logging a spurious ended+restored pair and
  // handing the "shattered" realm its own buried war-chest back (the succession
  // shatter degrading to a self-rename). The founder settlement still joins its
  // nearest successor below; the id dies with the house, as intended.
  if (succ) {
    // Pass 1: only FUNCTIONAL seats carry a successor crown (power-ranked, spaced).
    for (const s of ranked) {
      if (capitals.length >= maxStates) break;
      if (s.id === oldId || !isFnSeat(s)) continue;
      let far = true;
      for (const cap of capitals) {
        if (dist(world, s.pos.x, s.pos.y, cap.pos.x, cap.pos.y) < FRAG_SEPARATION) { far = false; break; }
      }
      if (far) capitals.push(s);
    }
    // Pass 2: the Diadochi floor — a seat-poor realm still splits in two, topped
    // up from ANY survivor (the pre-lever behavior for seatless realms).
    if (capitals.length < 2) for (const s of ranked) {
      if (capitals.length >= 2) break;
      if (s.id === oldId || capitals.includes(s)) continue;
      let far = true;
      for (const cap of capitals) {
        if (dist(world, s.pos.x, s.pos.y, cap.pos.x, cap.pos.y) < FRAG_SEPARATION) { far = false; break; }
      }
      if (far) capitals.push(s);
    }
  } else {
    for (const s of ranked) {
      if (capitals.length >= maxStates) break;
      if (s.id === oldId) continue;
      let far = true;
      for (const cap of capitals) {
        if (dist(world, s.pos.x, s.pos.y, cap.pos.x, cap.pos.y) < FRAG_SEPARATION) { far = false; break; }
      }
      if (far) capitals.push(s);
    }
  }
  // Each successor realm inherits the dead empire's temperament (with drift),
  // so the Diadochi share their predecessor's character before diverging.
  for (const cap of capitals) {
    ensurePolity(world, cap.id, { how: "fragment", seat: cap, from: oldId, fromName: deadName });
    inheritPersonality(world, oldId, cap.id);
    snapClaim(world, cap.id);
  }
  // The PRINCIPAL successor — the strongest fragment (capitals[] is filled in
  // power-rank order) — carries the dead state's mantle on the registry, so
  // obligations bound to the crown (a colony's dependency link) can follow the
  // succession instead of evaporating with the id.
  if (capitals.length) recordSuccessor(world, oldId, capitals[0].id);
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
  if (!hasOutsideBorder(world, c.id, bloc) || !blocHasSeat(bloc)) {
    for (const m of bloc) {
      ravage(world, m, FAILED_REVOLT_POP, FAILED_REVOLT_WEALTH, FAILED_REVOLT_ARMY);
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
function ravage(world, s, popMul, wealthMul, armyMul) {
  const _b = s.people;
  s.people = Math.max(1, (s.people || 0) * popMul);
  fieldShift(world, s, s.people - _b);   // one population: the rising's dead and fled leave the LAND too (FIELD_DEMOG)
  // SLAVE_PEOPLE: the unfree live inside s.people, so a ravaged town's losses fall on
  // free and unfree alike (never more unfree than people).
  if (T.SLAVERY && T.SLAVE_PEOPLE && (s._unfree || 0) > 0) s._unfree = Math.min((s._unfree || 0) * popMul, Math.max(0, s.people - 1));
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
      ravage(world, seed, RIOT_POP, RIOT_WEALTH, RIOT_ARMY);
      seed.unrest = 0;
      continue;
    }
    if (seed.countryId !== c.id) continue;    // already swept into an earlier rising this pass
    let bloc = [seed];
    for (const m of c.members) {
      if (m === seed || m.countryId !== c.id || m.id === c.capitalId) continue;
      if ((m.unrest ?? 0) < UNREST_JOIN) continue;                    // content → doesn't rise
      const pacified = world.step - (m._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE;
      const infant   = m.parentSettlementId >= 0 && world.step - (m.foundedStep || 0) < COLONY_SUPPLY_TICKS / (world._dt || 1);
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
    if (!hasOutsideBorder(world, c.id, bloc) || !blocHasSeat(bloc)) {
      for (const m of bloc) {
        ravage(world, m, REBEL_POP, REBEL_WEALTH, REBEL_ARMY);
        m.unrest = 0;
        m.loyalty = 0.5;
        m._conqueredAt = world.step;
      }
      continue;
    }
    snapClaim(world, newId);                   // a rebellion seizes its territory at once
    ensurePolity(world, newId, { silent: true, seat: seed });
    for (const m of bloc) {
      ravage(world, m, REBEL_POP, REBEL_WEALTH, REBEL_ARMY);
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
  const cap = c.capital;
  // The FINANCIER: the realm's wealthiest city — the bankers who lend the crown its
  // war money and live off the interest (Genoa, Augsburg, Amsterdam). A whole income
  // archetype: a great merchant city that grows rich financing the state.
  let financier = null;
  for (const s of members) {
    if (s.countryId !== c.id) continue;
    if (!financier || (s.wealth || 0) > (financier.wealth || 0)) financier = s;
  }

  // ── 1. ARMY PAY (first claim) ──
  // War multiplies the bill: campaigning/being besieged costs far more than a
  // peacetime garrison — this is what actually drains a treasury and bankrupts
  // a state under sustained or multi-front war.
  let totalArmy = 0;
  for (const s of members) if (s.countryId === c.id) totalArmy += s.army || 0;
  let armyBill = totalArmy * wage * (1 + effSurcharge * (warLevel || 0));
  const debtCap = totalArmy * wage * DEBT_CAP_MULT;
  // IN-KIND PROVISIONING (T.MONETIZE — the levy→coin arc's expenditure side): the
  // harvest share collected in kind this pass (gov._inKind, the produce levy's
  // unmonetized remainder) feeds the army DIRECTLY — levy hosts served for grain,
  // land and obligation for millennia before coined wages. It offsets the wage
  // bill up to all of it; only what the grain cannot cover must be found in COIN
  // (loans / debasement below) — so a coinless bronze-age realm can EAT and
  // garrison without the fiscal-military death spiral, but cannot HIRE beyond its
  // levy: the standing professional army awaits monetization. Grain is consumed
  // or spoils — the stock never hoards across passes the way coin does.
  if (T.MONETIZE > 0 && (gov._inKind || 0) > 0) {
    const provisioned = Math.min(armyBill, gov._inKind);
    armyBill -= provisioned;
    gov._inKind = 0;
  }
  // WAR LOANS (the FIRST recourse when short): the crown borrows the gap from its
  // financier city (up to a debt ceiling) — war on credit. The lender's coin pays the
  // army now; the crown owes it back with interest (serviced below). Borrowing comes
  // BEFORE debasement — a state melts its coinage only as a last resort, when even its
  // bankers won't extend more credit — so existing credit REPLACES minting rather than
  // adding to it (avoids an inflationary debt+debasement double-faucet).
  if (T.STATE_DEBT > 0 && financier && armyBill > gov.treasury) {
    const room = Math.max(0, debtCap - (gov._debt || 0));
    const lendable = Math.max(0, (financier.wealth || 0) - getWealthReserve(financier));
    const loan = Math.min(armyBill - gov.treasury, room, lendable);
    if (loan > 0.01) { financier.wealth -= loan; gov.treasury += loan; gov._debt = (gov._debt || 0) + loan; }
  }
  // DEBASEMENT (Phase 3): if the treasury STILL can't cover the army bill (credit
  // exhausted), melt the coinage — mint emergency seigniorage (lowering fineness) to
  // ease the shortfall; in comfortable times restore the coin toward full fineness.
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
  // CONTINUOUS PAY (review I93): financing decisions (loans, debasement) stay
  // here — structural, periodic — but the CASH leaves on the muster cadence
  // (armies.js payWages) at a per-tick rate. The old lump-sum pulsed up to
  // ~78% of the whole money supply through treasuries and back in one tick
  // every polity pass, whipsawing prices and the Hume flow at a fixed period.
  // Solvency is refreshed by each pay tranche against what was actually due.
  const passTicks = Math.max(1, Math.round(T.POLITY_INTERVAL * (T.SIM_GRANULARITY || 1)));
  gov._wagePerTick = armyBill / passTicks;
  spent += gov._wagePaidAccum || 0;   // wages the muster tranches actually paid since last pass (fiscal EMA input)
  gov._wagePaidAccum = 0;
  if (gov._lastWagePay === undefined) gov._lastWagePay = world.step;
  if (gov._solvency === undefined) gov._solvency = 1;

  // ── 1.5 DEBT SERVICE ── interest on the crown's debt, paid to the financier city as
  // its 'war loans' income. Unpaid interest CAPITALISES (clamped to the ceiling): a
  // state that keeps borrowing for war slides into a debt trap (Habsburg Spain's serial
  // defaults), its revenue increasingly eaten by interest instead of guns or works.
  if ((gov._debt || 0) > 0.01) {
    const interest = gov._debt * DEBT_INTEREST;
    const payI = Math.min(Math.max(0, gov.treasury), interest);
    if (payI > 0 && financier) { gov.treasury -= payI; financier.wealth = (financier.wealth || 0) + payI; recordIn(financier, IN_FINANCE, payI); spent += payI; }
    gov._debt = Math.min(debtCap, gov._debt + (interest - payI));   // shortfall capitalises, bounded
  }

  // ── 2. SURPLUS — debt repayment, then PURPOSEFUL spending ──
  // The reserve is the war-chest (peacetime bill × passes), built in peace, drawn down
  // in war; also the coin a conqueror seizes. Above it, a solvent throne doesn't just
  // dole coin per head — it deleverages, then BUILDS: monuments & games at the seat
  // (legitimacy that cools unrest realm-wide), infrastructure (roads that cheapen its
  // trade), and relief to provinces in distress. Concentrating spending this way, rather
  // than a universal per-capita dole, is also why the throne isn't every town's paymaster.
  const reserve = totalArmy * wage * RESERVE_PASSES;
  let budget = gov.treasury - reserve;
  if (budget > 0.01) {
    // Repay principal in good times (deleverage) before discretionary works — not booked
    // as the financier's income (it's their capital returned, not interest earned).
    if ((gov._debt || 0) > 0.01 && financier) {
      const repay = Math.min(budget * 0.5, gov._debt);
      if (repay > 0.01) { gov.treasury -= repay; financier.wealth = (financier.wealth || 0) + repay; gov._debt -= repay; spent += repay; budget -= repay; }
    }
    // MONUMENTS & GAMES at the seat → a slowly-fading legitimacy stock the unrest pass
    // reads (bread & circuses); booked as state pay to the capital (the works' labour).
    const mon = budget * T.SPEND_MONUMENT;
    if (mon > 0.01 && cap) {
      cap.wealth = (cap.wealth || 0) + mon; recordIn(cap, IN_STATE_PAY, mon);
      gov._monuments = (gov._monuments || 0) * MONUMENT_DECAY + mon;
      gov.treasury -= mon; spent += mon;
    }
    // INFRASTRUCTURE → roads (cheaper trade) + public-works employment for the members.
    const infra = budget * T.SPEND_INFRA;
    if (infra > 0.01) spent += spendInfrastructure(world, c, gov, infra);
    // RELIEF / dole → the remainder, weighted HEAVILY toward provinces in actual
    // distress (housing-pressed / food-short) so it reads as famine relief, not a wage.
    const relief = Math.min(Math.max(0, gov.treasury - reserve), budget * T.SPEND_RELIEF);
    if (relief > 0.01) {
      let totW = 0;
      for (const s of members) {
        if (s.countryId !== c.id || s.id === c.capitalId) continue;
        const boost = (s._housingPressed ? 1.5 : 0) + ((s._foodDemand || 0) > (s._foodSupply || 0) ? 1.5 : 0);
        s._govW = Math.max(0, s.people || 0) * (0.2 + boost);   // small per-capita floor + heavy need weighting
        totW += s._govW;
      }
      if (totW > 0) {
        for (const s of members) {
          if (s.countryId !== c.id || s.id === c.capitalId) continue;
          const share = relief * (s._govW / totW);
          s.wealth = (s.wealth || 0) + share; recordIn(s, IN_STATE_PAY, share);
        }
        gov.treasury -= relief; spent += relief;
      }
    }
    // Whatever is left stays as TREASURE (hoard above the war chest) — recirculated when
    // a conqueror seizes the treasury.
  }
  gov._spend = gov._spend * 0.9 + spent * 0.1;
}

// Public works: roads & canals. Booked as state pay (the labour) to the members,
// weighted by size, and improves the road quality on their tiles — a developmental
// state gradually cheapens its own trade. Bounded: roads improve slowly and never past
// the worn-arterial floor (0.08), so this can't explode the trade economy.
function spendInfrastructure(world, c, gov, budget) {
  const members = c.members;
  let totP = 0;
  for (const s of members) if (s.countryId === c.id) totP += Math.max(0, s.people || 0);
  if (totP <= 0) return 0;
  const rq = world.roadQuality, tw = world.tw;
  let spent = 0;
  for (const s of members) {
    if (s.countryId !== c.id) continue;
    const share = budget * Math.max(0, s.people || 0) / totP;
    if (share <= 0) continue;
    s.wealth = (s.wealth || 0) + share; recordIn(s, IN_STATE_PAY, share);
    spent += share;
    if (rq && s.pos) {
      const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
      const improve = Math.min(0.015, (share / Math.max(1, s.people || 0)) * T.INFRA_ROAD);
      if (improve > 0) rq[ti] = Math.max(0.08, rq[ti] - improve);
    }
  }
  gov.treasury -= spent;
  return spent;
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
  // The search bound covers the same REAL radius at any grid (×the same scale
  // holdReach carries, so the bound and reachCeil = holdReach×25 are one
  // quantity again): raw, it reached only 1/resScale of the real admin radius
  // at fine grids, so the outer half of every big realm's real reach read
  // "unreachable" (load ceiling → secede) — a driver of the measured fine-grid
  // fragmentation excess (audit OPEN #5b). Perf is bounded: the loop
  // early-exits when every member is found (pending), so the wider bound only
  // extends searches that were genuinely truncating. ×1 exactly at the
  // reference.
  const _hrs = _holdScaleEnv > 0 ? _holdScaleEnv : resScaleFor(world.tw);
  const maxCost = Math.max(50, c.range * 25) * _hrs;
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

// ── Field-grounded national power (T.POW_FIELD, default on) ─────────────────
// The nation's coercive weight is its GOVERNED PEOPLE — the population field over
// the land it actually holds — projected through its court's tech (the capital's
// mil·org multiplier), not the sum of its member-settlement entities. The roster
// sum made the census the SUBSTANCE of the state: national power jumped when a
// village adopted or defected (a bookkeeping line moving), not when land or people
// changed hands, and it under-counts realms whose people live outside catchment
// towns — the steppe above all, which is why this precedes the nomad work.
//   Applied as an OVERLAY: every consumer keeps its exact entity-summed baseline
// (byte-identical when the lever is off, and float-order-identical — the sites sum
// in different iteration orders, so funnelling them through one shared sum would
// drift last bits), then field values replace entries the field can price. Realms
// with no owned tiles this pass keep their entity sum — mixed entries share units
// because the field measure is MEDIAN-ANCHORED to the entity measure over the same
// realms in the same pass: the median realm's power is unchanged, only the
// DISTRIBUTION shifts from "member headcount" to "governed population" (the same
// grounding pattern as hold-capacity's governed-region power, extended from the
// capacity ruler to the war/alliance ruler — and self-calibrating, never a fitted
// constant). The O(N) field sweep is memoised per tick: alliances, submissions,
// absorb, enclaves and raids all read it within one polity pass.
function fieldPowerOverlay(world, countries, entPow) {
  if (!(T.POW_FIELD > 0) || !T.POP_FIELD) return;
  const pf = world.popField, co = world._countryOwner, elev = world.elev;
  if (!pf || !co || !countries || !entPow.size) return;
  let rpop = world._fpowRpop;
  if (!rpop || world._fpowStep !== world.step) {
    rpop = world._fpowRpop = new Map(); world._fpowStep = world.step;
    const N = world.N;
    for (let ti = 0; ti < N; ti++) { const cc = co[ti]; if (cc >= 0 && elev[ti] > 0) rpop.set(cc, (rpop.get(cc) || 0) + pf[ti]); }
  }
  const raw = new Map();
  for (const id of entPow.keys()) {
    const c = countries.get(id), cap = c && c.capital;
    const gp = rpop.get(id) || 0;
    if (!cap || !(gp > 0)) continue;                    // field can't price it → keeps its entity sum
    raw.set(id, gp * (settlementPower(cap) / Math.max(1, cap.people || 0)));   // governed people × the court's mil·org
  }
  if (!raw.size) return;
  // Median anchor over the SAME realm set in both measures (intersection), so the
  // scale is a like-for-like exchange rate, not skewed by unpriceable newborns.
  const ids = [...raw.keys()];
  const medOf = (get) => { const a = ids.map(get).filter((v) => v > 0).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
  const eMed = medOf((id) => entPow.get(id) || 0), rMed = medOf((id) => raw.get(id) || 0);
  if (!(eMed > 0) || !(rMed > 0)) return;
  const scale = eMed / rMed;
  for (const [id, v] of raw) entPow.set(id, v * scale);
}

// Recompute the balance-of-power alliance map (slow-drifting → amortised on
// ALLIANCE_EVERY). Writes three world fields read by the war pass (armies.js):
//   _allianceTarget : countryId → the hegemon it balances AGAINST (-1 = none)
//   _allies         : countryId → Set of allied countryIds (won't attack each other)
//   _blocMight      : hegemonId → total power of the coalition arrayed against it
// and _countryPow (countryId → national coercive power) for the front-bar scaling.
export function updateAlliances(world) {
  const countries = world.countries, owner = world._territoryOwner, byId = world._byId;
  if (!countries || !owner || !byId) return;
  const { tw, th } = world;
  // Resolve a tile's SETTLEMENT owner to its COUNTRY — the war pass works on this
  // granular per-settlement territory map (_territoryOwner), not the sparse cored
  // _countryOwner (which barely touches between realms, so adjacency on it is empty).
  // KNOWN LIMIT: tiles with no settlement catchment read as wilderness here, so a
  // statelet ringed by an empire's unsettled MARCH feels no threat and never
  // submits (absorbWeakNeighbors sees marches and still consolidates it). Widening
  // this map to marches was tried and rejected: it inflates the balance-of-power
  // deterrent world-wide and flattens the war-deadliness tail — the threat map
  // wars calibrate against must not be quietly redefined by the vassalage pass.
  const ccAt = (i) => { const o = owner[i]; if (o < 0) return -1; const s = byId.get(o); return s ? s.countryId : -1; };
  // 1. national power = Σ settlementPower over every settled member of a realm (its whole
  //    coercive weight, not just the capital — a big multi-city empire is more threatening).
  const pow = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;
    pow.set(s.countryId, (pow.get(s.countryId) || 0) + settlementPower(s));
  }
  fieldPowerOverlay(world, countries, pow);   // POW_FIELD: governed people, not the member roster
  // T.CRAFTS_OF_LAND: a realm ARMED WITH BRONZE weighs more — the metal stock
  // the court traded for (or mined under its own claim) enters national power.
  // This is why bronze-age trade networks existed: tin IS threat.
  if (T.CRAFTS_OF_LAND) for (const id of pow.keys()) {
    const p = getPolity(world, id);
    if (p && (p.metal || 0) > 0) pow.set(id, pow.get(id) + p.metal * 2);
  }
  // 2. adjacency (shared-border length) from the granular territory map.
  const adj = new Map();   // id → Map(neighbourId → border tiles)
  const bump = (a, b) => { if (a === b || a < 0 || b < 0) return; let m = adj.get(a); if (!m) adj.set(a, m = new Map()); m.set(b, (m.get(b) || 0) + 1); };
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const c = ccAt(y * tw + x); if (c < 0) continue;
    const r = ccAt(y * tw + ((x + 1) % tw)); if (r !== c) { bump(c, r); bump(r, c); }
    if (y + 1 < th) { const d = ccAt((y + 1) * tw + x); if (d !== c) { bump(c, d); bump(d, c); } }
  }
  // 3. cross-border trade per country pair (mutual benefit) from the carrying trade.
  const tradePair = new Map(); const lm = world._linkMoney;
  if (lm && byId) for (const [key, net] of lm) {
    const colon = key.indexOf(":"); const Sa = byId.get(+key.slice(0, colon)), Sb = byId.get(+key.slice(colon + 1));
    if (!Sa || !Sb || Sa.countryId < 0 || Sb.countryId < 0 || Sa.countryId === Sb.countryId) continue;
    const k = Math.min(Sa.countryId, Sb.countryId) + ":" + Math.max(Sa.countryId, Sb.countryId);
    tradePair.set(k, (tradePair.get(k) || 0) + Math.abs(net));
  }
  const tradeOf = (a, b) => tradePair.get(Math.min(a, b) + ":" + Math.max(a, b)) || 0;
  world._tradePairs = tradePair;   // read by the truce pass: peace lasts while it pays (trade-scaled truce duration)
  // T.TRUCE_TRADE_OWN: each realm's TOTAL commerce (internal + cross-border), in the
  // SAME units and the same tick as tradePair, so the truce pass can express
  // interdependence as a SHARE of the pair's own economic life instead of against a
  // live cross-realm median. Inflation and money-supply drift cancel exactly (numerator
  // and denominator are both link money from this tick), which is what the median
  // reference was reaching for — without the median's fatal property of pinning the
  // typical pair at a fixed reading in every era. See armies.js signPeace.
  if (lm && byId) {
    const tot = new Map();
    for (const [key, net] of lm) {
      const colon = key.indexOf(":"); const Sa = byId.get(+key.slice(0, colon)), Sb = byId.get(+key.slice(colon + 1));
      if (!Sa || !Sb) continue;
      const v = Math.abs(net);
      if (Sa.countryId >= 0) tot.set(Sa.countryId, (tot.get(Sa.countryId) || 0) + v);
      if (Sb.countryId >= 0 && Sb.countryId !== Sa.countryId) tot.set(Sb.countryId, (tot.get(Sb.countryId) || 0) + v);
    }
    world._tradeTotals = tot;
  }
  // 4. each realm's dominant THREAT — the strongest neighbour that towers over it (but never
  //    its own overlord/dependency — a colony does not balance against its metropole).
  const ovT = world._overlordOf;
  const bonded = (a, b) => ovT && (ovT.get(a) === b || ovT.get(b) === a);
  const threat = new Map();
  for (const [id, nb] of adj) {
    const myPow = pow.get(id) || 1; let bestT = -1, bestR = THREAT_RATIO;
    for (const n of nb.keys()) { if (bonded(id, n)) continue; const r = (pow.get(n) || 1) / myPow; if (r > bestR) { bestR = r; bestT = n; } }
    threat.set(id, bestT);
  }
  // 5. allies = realms with a COMMON threat (balance against the same hegemon), PLUS
  //    mutual-benefit partners (heavy trade) — but never your own threat.
  const allies = new Map(); const ally = (a, b) => { if (a === b) return; let s = allies.get(a); if (!s) allies.set(a, s = new Set()); s.add(b); };
  for (const [id, nb] of adj) {
    const t = threat.get(id);
    for (const n of nb.keys()) {
      if (n === t || threat.get(n) === id) continue;          // your hegemon is no ally
      if ((t >= 0 && threat.get(n) === t)                     // common enemy → coalition
        || tradeOf(id, n) >= ALLY_TRADE_REF) { ally(id, n); ally(n, id); }   // or mutual benefit
    }
  }
  // 5b. Colonial blocs: an overlord and its dependencies stand together and never fight, and
  //     co-dependencies of the same metropole are bloc-mates too (the empire holds its colonies).
  const ov = world._overlordOf;
  if (ov) for (const [dep, over] of ov) {
    ally(dep, over); ally(over, dep);
    for (const [dep2, over2] of ov) if (over2 === over && dep2 !== dep) { ally(dep, dep2); }
  }
  // 6. coalition strength arrayed against each hegemon = Σ power of everyone balancing against it.
  const bloc = new Map();
  for (const [id, t] of threat) if (t >= 0) bloc.set(t, (bloc.get(t) || 0) + (pow.get(id) || 1));
  world._allianceTarget = threat; world._allies = allies; world._blocMight = bloc; world._countryPow = pow;
}

export function updatePolities(world) {
  const _pf = world._dbgProfile ? (world.debug.pol = { rebuild: 0, transport: 0, loop: 0, absorb: 0 }) : null;
  // T.TRIBUTE_OF_LAND: the storehouse economy accrues at the fisc cadence —
  // every polity (realm or nation of the land) skims the field people under
  // its borders in kind; realm overflow monetises at the capital's market.
  updateTribute(world, T.POLITY_INTERVAL | 0);
  let _pt = _pf ? performance.now() : 0;
  const countries = rebuildCountries(world);
  if (_pf) { _pf.rebuild = performance.now() - _pt; _pt = performance.now(); }
  // Nomad classification first — everything downstream (momentum, raids, the
  // post-khan shatter) reads this pass's fresh flags, never last pass's world.
  classifyNomads(world, countries);

  // ── Colonial dependencies: wire new colonies, validate links, grant independence ──
  {
    const _depPow = new Map();
    for (const c of countries.values()) { let p = 0; for (const m of c.members) if (m.mode === "settled" && m.countryId === c.id) p += settlementPower(m); _depPow.set(c.id, p); }
    fieldPowerOverlay(world, countries, _depPow);   // POW_FIELD: the independence line weighs governed people
    const blocPow = (c) => _depPow.get(c.id) || 0;
    // (a) Wire the founding marker (sea.js) → the durable polity link. Consumed only
    //     when the link is APPLIED — or provably never can be. The old form consumed
    //     it unconditionally on first sight: a colony whose founder id happened to be
    //     absent from THIS pass's live view (mid-conquest, mid-merge), or whose own
    //     polity record the reconciler hadn't registered yet (arrival racing the
    //     pass — reconcilePolities runs at the END of the pass), silently lost the
    //     link forever: an orphan micro-state that still culture-diverged as a colony
    //     but belonged to nobody.
    for (const s of world.settlements) {
      if (s._overlordCC == null) continue;
      const over = s._overlordCC;
      // Malformed marker — can never become a link. Drop.
      if (over < 0 || over === s.id) { s._overlordCC = undefined; continue; }
      // The colony itself lost sovereignty (annexed during/after the voyage): its
      // life as a self-governing dependency is over — the marker is moot. Drop,
      // never re-wire a later secession back to the old metropole.
      if (s.countryId !== s.id) { s._overlordCC = undefined; continue; }
      // The founder FELL (polity records are never deleted; endedStep marks death):
      // orphaned for good — no successor-tracing. Drop. Also drop when the founder
      // id is neither a live realm NOR on record — a never-registered statelet that
      // vanished can never return (restoration reopens RECORDS only).
      const founder = getPolity(world, over);
      if (founder ? founder.endedStep >= 0 : !countries.has(over)) { s._overlordCC = undefined; continue; }
      const pol = getPolity(world, s.id);
      // Already bound (vassalized/re-linked in the window) — the marker is moot. Drop.
      if (pol && pol._overlord != null) { s._overlordCC = undefined; continue; }
      // Not appliable THIS pass (founder id transiently out of the live view, or the
      // colony's own record not yet reconciled): KEEP the marker and retry next pass.
      if (!pol || !countries.has(over)) continue;
      s._overlordCC = undefined;                                   // consume: the link applies now
      pol._overlord = over;
      pol._depKind = "colony";                                     // a planted dependency (vs a submitted vassal) — drives investment and map rendering
      inheritPersonality(world, over, s.id);                       // the colony carries the metropole's temperament
      snapClaim(world, s.id);                                      // it administers its own ground at once
      logEvent(world, "colony.founded", { polity: s.id, from: over, fromName: realmName(world, over),
        seatName: s.name, x: s.pos.x | 0, y: s.pos.y | 0 });
    }
    // (a2) METROPOLE FALLS: succession or liberation — never a silent mass-drop.
    //      The old cliff: rebuildOverlords freed EVERY dependency the moment the
    //      overlord id left the live view — even a one-pass transient (mid-merge
    //      id shuffle), and even when the registry records a successor carrying
    //      the fallen state on (B1). Resolve each such bond from the PERSISTENT
    //      registry instead:
    //        • overlord ALIVE on record, merely out of this pass's view → WAIT
    //          (reconcilePolities closes the record at the end of this pass if
    //          the realm truly evaporated; the next pass resolves it for real);
    //        • ENDED, and the recorded succession chain (rec.succId) leads to a
    //          LIVE realm → the dependency PASSES TO THE HEIR — the crown's
    //          obligations travel with the crown's mantle;
    //        • ENDED with no living heir → honest LIBERATION, chronicled per
    //          colony (the Spanish-American arc: the metropole falls, the
    //          colonies go their own way).
    for (const c of countries.values()) {
      const pol = getPolity(world, c.id);
      if (!pol || pol._overlord == null || pol._overlord === c.id) continue;
      const over = pol._overlord;
      if (countries.has(over)) continue;                   // live and present — nothing to resolve
      const orec = getPolity(world, over);
      if (orec && orec.endedStep < 0) continue;            // transient absence — wait
      // Dead on record (or a never-registered statelet that vanished — no
      // record to succeed from). Walk the recorded succession chain, bounded:
      // each hop is itself a dead record's heir; stop at the first LIVE realm.
      let heir = -1, wait = false;
      { let cur = orec, hops = 0;
        while (cur && cur.endedStep >= 0 && hops++ < 8) {
          const nid = cur.succId != null ? cur.succId : -1;
          if (nid < 0 || nid === cur.id || nid === c.id) break;
          if (countries.has(nid)) { heir = nid; break; }
          const nrec = getPolity(world, nid);
          if (nrec && nrec.endedStep < 0) { wait = true; break; }   // heir alive on record, out of view this pass
          cur = nrec;
        } }
      if (wait) continue;
      // No cycles: the heir must not sit below THIS dependency in the overlord
      // pyramid (same rule submission enforces; walked on the records, bounded).
      if (heir >= 0) {
        let up = heir;
        for (let hops = 0; hops < countries.size && up != null && up >= 0; hops++) {
          const urec = getPolity(world, up);
          up = urec ? urec._overlord : null;
          if (up === c.id) { heir = -1; break; }
        }
      }
      if (heir >= 0) {
        pol._overlord = heir;                              // the dependency passes to the successor state (kind unchanged)
        logEvent(world, "colony.inherited", { polity: c.id, name: realmName(world, c.id),
          from: over, fromName: orec ? orec.name : undefined, to: heir, toName: realmName(world, heir) });
      } else {
        pol._overlord = undefined; pol._depKind = undefined;
        logEvent(world, "colony.independent", { polity: c.id, from: over,
          fromName: orec ? orec.name : undefined, name: realmName(world, c.id), how: "metropole-fell" });
      }
    }
    // (b/b2) Live overlord map + naval reach — extracted so loadWorld can warm
    //        the same state before its updateAlliances call (an overlord-blind
    //        alliance map let colonies balance against their own metropole for
    //        a whole post-load window).
    const { overlordOf, reachOf } = rebuildOverlords(world, countries);
    // (c) INDEPENDENCE — emergent, never timed. A dependency cuts the apron strings once its own
    //     power exceeds the force the metropole can PROJECT to it (its power × naval reach), not
    //     the metropole's total: a DISTANT colony, which the navy can barely reach, breaks free at
    //     far less relative strength than a near one. This is the American/Latin-American arc —
    //     the metropole loses what it cannot hold across the sea, sooner the farther it is.
    if (overlordOf.size && _polityWindow(world, INDEPENDENCE_EVERY)) {
      for (const [dep, over] of [...overlordOf]) {
        const dc = countries.get(dep), oc = countries.get(over);
        if (!dc || !oc) continue;
        const projForce = blocPow(oc) * (reachOf.get(dep) ?? 0);   // what the metropole can actually bring to bear
        if (blocPow(dc) >= INDEP_POWER_RATIO * projForce) {
          const pol = getPolity(world, dep); if (pol) { pol._overlord = undefined; pol._depKind = undefined; }
          overlordOf.delete(dep);
          logEvent(world, "colony.independent", { polity: dep, from: over,
            fromName: realmName(world, over), name: realmName(world, dep) });
        }
      }
    }
    // (d) The colonial ECONOMY, both directions. The metropole INVESTS in a young
    //     dependency — coin from its treasury, grain from its capital granary —
    //     so a raw frontier survives (the COLONY_SUPPLY that used to flow inside one country
    //     now flows ACROSS the overlord link, since a colony is its own realm). A MATURE,
    //     solvent dependency pays TRIBUTE home — a share of its treasury. The net flow
    //     reverses as the colony grows: investment out, then wealth extracted back — the arc
    //     of empire. (Goods flow already happens for free via the cross-border carrying trade.)
    for (const [dep, over] of overlordOf) {
      const dpol = getPolity(world, dep), opol = getPolity(world, over);
      const dc = countries.get(dep), oc = countries.get(over);
      if (!dpol || !opol || !dc || !oc || !dc.capital || !oc.capital) continue;
      const proj = reachOf.get(dep) ?? 0;   // how much the metropole can ship across the distance
      const young = world.step - (dc.capital.foundedStep || 0) < COLONY_SUPPLY_TICKS / (world._dt || 1);
      if (young) {
        // Investment flows only while the plantation is YOUNG — the metropole
        // funds its own venture through its formative years. It does NOT flow to
        // any mature dependency that happens to be poor: a submitted pauper
        // vassal would otherwise draw a perpetual subsidy every pass (a hegemon
        // with a ring of poor tributaries bled its treasury dry), inverting the
        // tribute relationship submission exists to create.
        const coin = Math.min(COLONY_SUPPLY_COIN * proj, Math.max(0, opol.treasury));
        if (coin > 0) { opol.treasury -= coin; dpol.treasury += coin; recordIn(dc.capital, IN_AID, coin); recordOut(oc.capital, OUT_AID, coin); }
        const need = (dc.capital._foodDemand || 0) - (dc.capital.food || 0);
        const food = Math.min(COLONY_SUPPLY_FOOD * proj, Math.max(0, (oc.capital.food || 0) - 20));
        if (need > 0 && food > 0) { oc.capital.food -= food; dc.capital.food = (dc.capital.food || 0) + food; }
      } else if ((dpol.treasury || 0) >= COLONY_SUPPLY_COIN) {
        // A mature, solvent dependency pays tribute home; a poor one neither
        // receives nor pays — tribute waits until its treasury can bear it.
        const trib = TRIBUTE_FRAC * Math.max(0, dpol.treasury);
        if (trib > 0) {
          dpol.treasury -= trib; opol.treasury += trib; recordOut(dc.capital, OUT_TRIBUTE, trib); recordIn(oc.capital, IN_TRIBUTE, trib);
          // Tribute is EXTRACTION income — coin taken by dominance, not raised at home.
          // It banks toward the overlord elite's land-buying (latifundia, updatePolities).
          if (T.LATIFUNDIA) opol._conqFlow = (opol._conqFlow || 0) + trib;
        }
      }
      // TECH TRANSFER: the metropole sends engineers, books and administrators — but only as fast
      // as it can REACH the colony, so a colony just within range keeps pace while a remote one
      // drifts technologically. Pull the colony seat's knowledge toward the overlord seat's
      // (× reach); it then diffuses onward through the colony's own settlements by the normal channel.
      const ok = oc.capital.knowledge, dk = dc.capital.knowledge;
      if (ok && dk) for (const key in ok) { const gap = ok[key] - (dk[key] || 0); if (gap > 0) dk[key] = (dk[key] || 0) + gap * COLONY_TECH_DIFFUSE * proj; }
    }
  }

  // ── Ontology V2 (loyaltyField.js): the land remembers, the people attach ──
  // One owner-diff scan stamps tile homeland memory, the attachment continuum
  // habituates toward each county's administrative condition, and settlements
  // DERIVE s._homeland/_attach from the ground. The grievance ledger decays
  // (allied dyads reconcile faster) and refreshes its era-median reference.
  updateGrievLedger(world, countries);
  updateLoyaltyField(world, countries);

  // Assimilation: a people held beyond living memory (HOMELAND_MEMORY) lose their
  // old national identity and become natives of their current ruler — so a LATE
  // revolt there forms a NEW state on the administrative lines, not the old nation.
  // Home-by-any-path also clears: a secession that hands a settlement back its own
  // original nation-id (freshCountryId reusing it) is a homecoming too — drop the
  // now self-referential marker so it can't linger or re-trigger a restoration.
  // Under LOYAL_FIELD both jobs move to the ground: the flat timer is replaced by
  // EMERGENT assimilation (attachment completing), and the homecoming clear is the
  // scan's own transfer semantics — the derive above already rewrote s._homeland.
  if (!T.LOYAL_FIELD) for (const s of world.settlements) {
    if (s.mode !== "settled" || (s._homeland ?? -1) < 0) continue;
    if (s._homeland === s.countryId
        || ((s._homelandFell ?? -1) >= 0 && world.step - s._homelandFell > HOMELAND_MEMORY / (world._dt || 1))) {
      s._homeland = -1; s._homelandFell = -1;
    }
  }

  // MEDIAN capital power across the REAL states (multi-member) this pass — the era
  // baseline the dominant-empire boost is measured against (see CAP_DOM_W). The median
  // (not the mean) is deliberate: it is robust to the hegemon's OWN outsized core, so a
  // great power keeps its dominance for ages instead of deflating the very average it is
  // measured against and self-fragmenting — persistent Romes, not one-era flashes.
  { const cps = [];
    for (const c of countries.values()) if (c.capital && c.members.length > 1) cps.push(settlementPower(c.capital));
    cps.sort((a, b) => a - b);
    world._refCapPower = cps.length ? cps[cps.length >> 1] : 1;
    // Smoothed copy for the CAP_RELATIVE capacity base (same low-pass rationale as
    // _refRevenue: the raw median is a small-sample statistic that can move several-fold
    // in one pass, and the capacity RULER must not).
    const prevPS = world._refCapPowerS;
    world._refCapPowerS = prevPS > 0 ? prevPS + (world._refCapPower - prevPS) * REF_REV_SMOOTH : world._refCapPower; }
  // CAP_MODEL: the MEDIAN fiscal extraction PER MEMBER across real states — the peer
  // baseline the grounded dominance tail is measured against (revenue is Tilly's real
  // currency of administrative reach, and it differs from raw coercive power by
  // extraction EFFICIENCY). Per MEMBER, not per realm — the member is the unit the
  // load/capacity model counts slots in, so efficiency per member is the like-for-like
  // normalization. A realm-total baseline paid the dominance tail for BULK: total
  // revenue is member-count × per-member take, so a 17-member realm of ordinary
  // members read ~5× "dominant" and its capacity compounded on its own size (measured:
  // capacity 225 vs load 24 at 17 members — the immortal-juggernaut loop the log2 was
  // built to prevent, reintroduced through the tail). Efficiency per unit ruled is
  // what actually let Rome hold more than its peers.
  // Same robust-median rationale as _refCapPower. Only read when the lever is on.
  if (T.CAP_MODEL) {
    // The peer baseline is the state system's MEMBER-WEIGHTED MEAN extraction —
    // Σ revenue / Σ members across real (multi-member) states — not the median of
    // the per-realm ratios. The median was a ~10-sample order statistic: one or two
    // war-gutted entries moved it several-fold (measured 521→187 across checkpoints
    // even under smoothing), and every solvent leader then read a 10-25× "surplus"
    // that pinned dominance at its ceiling — planet-scale area mandates from a
    // statistical artifact. The mean is a sum over the whole system: it only falls
    // when the SYSTEM's extraction falls (a real depression — in which the leader's
    // relative surplus reading stays honest), and the hegemon's own take lifts the
    // average it is measured against (self-limiting, as the dominance note intends).
    // Floor at ONE COIN per member per pass — the same unit-ful "is fiscal extraction
    // a real phenomenon yet?" quantum as before (mature per-member revenue runs
    // 10²-10³, so the floor is inert once coinage exists).
    let totRev = 0, totMem = 0;
    for (const c of countries.values()) if (c.capital && c.members.length > 1) { totRev += govOf(world, c.id)._lastRevenue || 0; totMem += c.members.length; }
    const meanRev = totMem > 0 ? Math.max(1, totRev / totMem) : 1;
    // Smoothed (REF_REV_SMOOTH) so even system-wide swings phase in over passes.
    const prevRef = world._refRevenue;
    world._refRevenue = prevRef > 0 ? prevRef + (meanRev - prevRef) * REF_REV_SMOOTH : meanRev; }
  // ── FIELD population as the coercive base (T.POP_FIELD) ─────────────────────
  // Under the field model a realm's hold-capacity is funded by the population it
  // actually GOVERNS — Tilly's real tax/manpower base is the whole region, not the
  // size of one capital city — instead of settlementPower(capital). Sum the per-tile
  // population field over each realm's owned ground, convert to power in the SAME
  // units as settlementPower (× the capital's tech mil·org), and ANCHOR the median
  // realm to the existing median capital-power (world._refCapPower). So the whole
  // capacity / dominance / duress / hysteresis stack downstream is byte-unchanged at
  // the median (backward-comparable) — only the DISTRIBUTION of the base power shifts
  // from "capital size" to "governed population", the point of the rewrite. The
  // reference is an emergent median (self-calibrating, like _refCapPower/_refRevenue),
  // never a fitted absolute.
  let regionPowOf = null, regionScale = 1;
  if (T.POP_FIELD && world.popField && world._countryOwner) {
    const pf = world.popField, co = world._countryOwner, elevA = world.elev, Nn = world.N;
    const rpop = new Map();
    for (let ti = 0; ti < Nn; ti++) { const cc = co[ti]; if (cc < 0 || !(elevA[ti] > 0)) continue; rpop.set(cc, (rpop.get(cc) || 0) + pf[ti]); }
    regionPowOf = new Map(); const rpows = [];
    for (const c of countries.values()) {
      if (!c.capital || c.members.length <= 1) continue;
      const cp = c.capital;
      const milOrg = settlementPower(cp) / Math.max(1, cp.people || 0);   // strip the capital's own people → the realm's mil·org multiplier
      const rp = (rpop.get(c.id) || 0) * milOrg;
      regionPowOf.set(c.id, rp); rpows.push(rp);
    }
    rpows.sort((a, b) => a - b);
    const refRegionPow = rpows.length ? Math.max(1e-6, rpows[rpows.length >> 1]) : 1;
    regionScale = (world._refCapPower || 1) / refRegionPow;   // median governed-region power → median capital power
  }
  // ── PROV_FIELD: a PROVINCE weighs its GOVERNED PEOPLE, not its city census ──────
  // Under cities-only entities (DISSOLVE_FARMS — every settlement is an urban node)
  // the member roster no longer contains the nation's people, so every census read in
  // the admin-load ledger under-counts the countryside: the load a province puts on
  // the centre (sizeMul), the militia it raises when it rises (provForce's levy — the
  // PEASANT revolt), and the heterogeneity that spreads the army thin (natForeign)
  // all read s.people. Under the lever each settled province carries s._govPeople —
  // the popField integral over its worked catchment (_territoryOwner; ⊆ the realm's
  // land under CATCHMENT_CLIP) — median-anchored to the census (median province
  // census ÷ median province governed-people, low-passed like _refRevenue) so
  // SIZE_REF / REBEL_LEVY / NAT_OVERREACH keep their calibration at the MEDIAN
  // province and only the DISTRIBUTION shifts: a small city administering a dense
  // valley weighs (and rebels) like the populous province it is, a walled town on
  // empty march like the outpost it is. Marches outside any catchment stay
  // province-unattributed (they price through the territorial admin load instead).
  // 0 = the city census (byte-identical).
  let provRatio = 0;
  if (T.PROV_FIELD > 0 && T.POP_FIELD && world.popField && world._territoryOwner && world._byId) {
    const pf = world.popField, terr = world._territoryOwner, elevA = world.elev, byId = world._byId, Nn = world.N;
    for (const s of world.settlements) if (s.mode === "settled") s._govPeople = 0;
    for (let ti = 0; ti < Nn; ti++) {
      const oid = terr[ti]; if (oid < 0 || !(elevA[ti] > 0)) continue;
      const s = byId.get(oid); if (!s || s.mode !== "settled") continue;
      s._govPeople += pf[ti];
    }
    const cen = [], gov = [];
    for (const s of world.settlements) if (s.mode === "settled" && (s._govPeople || 0) > 0 && (s.people || 0) > 0) { cen.push(s.people); gov.push(s._govPeople); }
    if (cen.length >= 8) {   // a real sample; below it keep the last smoothed ratio (or stay off pre-seed)
      cen.sort((a, b) => a - b); gov.sort((a, b) => a - b);
      const r = cen[cen.length >> 1] / Math.max(1e-9, gov[gov.length >> 1]);
      const prev = world._provRatio || 0;
      world._provRatio = prev > 0 ? prev + (r - prev) * REF_REV_SMOOTH : r;   // same low-pass reasoning as _refRevenue
    }
    provRatio = world._provRatio || 0;
  }
  // Balance of power: recompute the (slow-drifting) alliance map periodically — and
  // once on first run so the war pass never reads an undefined map. Self-calibrating,
  // not time-gated: it's a perf cadence (how OFTEN), the content is pure world state.
  if (!world._allianceTarget || _polityWindow(world, ALLIANCE_EVERY)) updateAlliances(world);
  // Vassalage: hopelessly-outmatched statelets submit to the neighbour that
  // towers over them (the threat map above), entering the dependency plumbing.
  // Runs every polity pass on the (slow-drifting) alliance data; the new
  // vassal's tribute/bloc wiring takes effect next pass via rebuildOverlords.
  considerSubmissions(world, countries);
  // The union of crowns: kin courts governing one cheap corridor merge — the
  // symmetry breaker that seeds the first multi-city realms (below).
  if (T.VALLEY_UNION) considerUnions(world, countries);
  // The second act: a mature suzerain integrates aged, governable client
  // courts as provinces (satrapization — territory finally consolidates).
  if (T.SATRAPIZE) considerIntegrations(world, countries);
  // The steppe collects: hordes raid the rich settled rim (or honour the
  // treaties of those who submitted above). After submissions so a court that
  // bent the knee this pass is spared this pass's raid season.
  hordeRaids(world, countries);
  for (const c of countries.values()) {
    if (c.members.length <= 1) {
      const solo = c.members[0];
      if (solo) {
        solo.loyalty = 1;   // a city-state is loyal to itself
        // ...and its stocks keep LIVING: unrest cools here too (the relief
        // used to live only in the multi-member loop, so a city-state born
        // of a duress secession kept its pre-secession unrest forever), and
        // the fiscal record recovers — disburseTreasury never runs for a
        // lone town, so a stale _solvency snapshot from imperial days
        // permanently deserted its garrison (BANKRUPT_DESERT every muster).
        solo.unrest = Math.max(0, (solo.unrest || 0) - UNREST_RELIEF);
        const soloGov = getPolity(world, c.id);
        if (soloGov) { soloGov._solvency = 1; soloGov._taxRate = 0; }
      }
      continue;
    }

    const cap = c.capital;
    const capPower = settlementPower(cap);
    // Base power feeding HOLD-CAPACITY only: the governed-region population under the
    // field model (pre-pass above), else the capital's settlement power. Everything
    // else — dominance (revenue), relPow, thronePower, the army/absorption maths — keeps
    // reading capPower, so this swaps ONLY what funds administrative reach.
    let capPowerCap = capPower;
    if (regionPowOf) { const rp = regionPowOf.get(c.id); if (rp != null) capPowerCap = Math.max(1, rp * regionScale); }
    // Era-weighted salience of the four identity layers, from THIS realm's own
    // development (cohesion.js identityWeightsFor) — the axis of conflict each
    // realm feels shifts as ITS society develops: faith in its medieval,
    // language across its bureaucratic era, the national idea when IT (or a
    // neighbour it faces) industrialises. Never the planet-wide leader.
    const idW = identityWeightsFor(world, cap);
    // The realm's mustered force (sum of member garrisons) — its monopoly on
    // organised violence, the thing that actually SUPPRESSES a province's revolt.
    let natArmy = 0; for (const m of c.members) natArmy += (m.army || 0);
    // Cultural heterogeneity the realm must garrison: each foreign-identity province
    // ties down part of the national army (see coerce below), so a POLYGLOT empire
    // spreads its force thin and can't suppress simultaneous nationalist revolts —
    // the imperial overstretch that fractured Austria-Hungary and the Ottomans into
    // nation-states — while a culturally-UNIFIED realm keeps its army concentrated and
    // holds firm. Era-weighted off emergent development (absorbResistance/cohesion.js):
    // near-silent in antiquity (multi-ethnic empires hold), cresting in the national age.
    let natForeign = 0;
    // PROV_FIELD: a province's weight in the realm's heterogeneity is its GOVERNED
    // people, mean-normalised within the realm (Σ weights = member count, so
    // NAT_OVERREACH keeps its calibration at uniform provinces) — a foreign-identity
    // province of a million weighs like the mass nationalist problem it is, a foreign
    // frontier fort like a garrison detail. provWMean also scales each province's OWN
    // share subtracted back in the load loop (armyAvail), keeping the two consistent.
    let provWMean = 0;
    if (provRatio > 0) {
      let wSum = 0, wN = 0;
      for (const m of c.members) { if (m.id === c.capitalId) continue; wSum += (m._govPeople || 0) * provRatio; wN++; }
      if (wN > 0 && wSum > 0) provWMean = wSum / wN;
    }
    if (T.HOLD_ARMY && T.NAT_OVERREACH > 0) {
      if (provWMean > 0) {
        for (const m of c.members) { if (m.id === c.capitalId) continue; natForeign += absorbResistance(cap, m, idW) * (((m._govPeople || 0) * provRatio) / provWMean); }
      } else {
        for (const m of c.members) { if (m.id === c.capitalId) continue; natForeign += absorbResistance(cap, m, idW); }
      }
    }
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
    const reachCeil = holdRange * 25;   // load-space ceiling for an unreachable member (grip frame, like the load → load≈25 ⇒ secede); the Dijkstra SEARCH bound (maxCost) now spans the same real radius (×holdReach's scale — res-invariance 2026-07), so "unreachable" once again means beyond-the-grip, not beyond-a-raw-tile-budget

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
    // The ceiling is NOT a fixed, era-blind number — administrative dominance ROSE
    // with each delegation revolution (satrapies → Roman governors → Han commanderies
    // → modern bureaucracy), so the MOST a capital can tower over its peers EMERGES
    // from its institutional development (capCoh), exactly as capacity does (instMul).
    // A bronze-age hegemon saturates low (Sargon's Akkad was vast but fragile); a
    // literate-bureaucratic empire towers far higher. This replaces the flat clamp
    // with an emergent bound — no anachronistic continent-eating chiefdom, and the
    // late-game ceiling still resolves to T.CAP_DOM_MAX as cohesion matures.
    const domCeil = CAP_DOM_CEIL_BASE + capCoh * (T.CAP_DOM_MAX - CAP_DOM_CEIL_BASE);
    let dominance;
    if (T.CAP_MODEL) {
      // GROUNDED tail (CAP_FISC/CAP_LOG): fiscal surplus over peers, each unit of it worth
      // more the better the LOGISTICS that project it (see the CAP_MODEL note above — linear
      // in surplus; the convexity of the tail comes from logistics rising late). Surplus =
      // last pass's extraction PER MEMBER vs the smoothed peer per-member median (revenue,
      // not raw power, is what funds administration — and it must be measured per unit
      // ruled, or the tail rewards sheer SIZE and capacity compounds on itself; see the
      // _refRevenue note). Logistics≈0 in the bronze age ⇒ the tail is small and flat; it
      // steepens as the reach techs (roads→rails) arrive ⇒ integrated mega-empires are a
      // LATE, earned phenomenon.
      const fiscalSurplusRaw = Math.max(0, ((govOf(world, c.id)._lastRevenue || 0) / Math.max(1, c.members.length)) / (world._refRevenue || 1) - 1);
      // DIMINISHING ABSORPTION: capacity gained per marginal unit of surplus falls off —
      // an administration can only convert so much extra coin into offices, roads and
      // garrisons per era (bureaucratic absorptive capacity). Saturating response
      // (linear below ~1×-over-peers, asymptote FISC_SAT): a genuinely out-taxing
      // hegemon still towers, but a freak surplus reading (a mining bonanza, a peer
      // system briefly impoverished) cannot mint a 20× administration overnight.
      const fiscalSurplus = FISC_SAT * (1 - Math.exp(-fiscalSurplusRaw / FISC_SAT));
      const logistics = capE.logisticsLevel || 0;   // (capE.logistics was a typo — that field doesn't exist, so the term was silently 0)
      dominance = Math.min(domCeil, 1 + T.CAP_FISC * fiscalSurplus * (1 + T.CAP_LOG * logistics));
      // ②c INDUSTRIAL_REACH (docs/industrial-transition-2026-07.md, default off): the
      // logistics revolution (rail, steam, telegraph) extends administrative reach
      // ABSOLUTELY — a rail-age state governs a continent per unit power where a bronze-
      // age one governs a valley — not only RELATIVE to peers. The grounded CAP_LOG tail
      // above is relative (fiscalSurplus vs the peer median), so when every realm
      // industrialises together no one gains surplus and the modern realm gets NO extra
      // reach → it sheds the ×N provinces INDUSTRIAL_CAP gave it (the fragmentation that
      // collapses the org-gated fiat, docs §9). This adds reach from the realm's OWN
      // reached industrial logistics (cap._indGate × the logistics tech — emergent, never
      // a clock), bounded by the SAME emergent domCeil (capCoh-scaled) so a modern state
      // towers but can't eat the map anachronistically. Byte-identical at 0.
      if (T.INDUSTRIAL_REACH > 0) dominance = Math.min(domCeil, dominance + T.INDUSTRIAL_REACH * (cap._indGate || 0) * logistics);
    } else {
      dominance = Math.min(domCeil, 1 + CAP_DOM_W * Math.pow(Math.max(0, relPow - 1), CAP_DOM_P));
    }
    c._dominance = dominance;   // info panel: how far this realm out-cores the age
    // GEOGRAPHIC CORE (absolute, founding-location advantage): a capital on a rich
    // river-valley / floodplain heartland projects power further than one on marginal
    // ground, in EVERY era — static geography, so a Nile/Mesopotamia/Yellow-River core
    // holds a structurally larger empire than a steppe-centred realm. A path-INDEPENDENT
    // source of size VARIETY that stops every realm relaxing to one characteristic size.
    // (CAP_GEO removed 2026-07: the "ships default 0" product decision — the
    // opt-in size-variance family (with ORG_APT_CAP) measured to fatten the
    // biggest realms; the emergent capacity ruler carries size variety now.)
    const geoMul = 1;
    // ── The capacity RULER (T.CAP_RELATIVE, default on) ─────────────────────────
    // The log2 base is measured against the ERA'S OWN median capital power (smoothed,
    // floored at POW_REF so genesis — when the median is tiny — is unchanged), not the
    // fixed absolute POW_REF alone. With the fixed base, the world's absolute power
    // inflation (population × tech multipliers: median capital power 380 → ~40,000
    // over the arc) lifted EVERY realm's capacity ~×20-40 regardless of relative
    // standing — the measured late-game incoherence where one capacity number was
    // simultaneously several times too big for the FIELD area target (giants never
    // shed by decline; the median realm targeted 4-6% of the planet) and several
    // times too small for the admin-load line (everyone read over-stretched). A
    // capacity of X now means "the administration to govern X median-realm-equivalents
    // of coercive power" in EVERY era; capacity still GROWS with development, but only
    // through the deliberate channels — institutions (instMul), delegated seats,
    // fiscal-logistic dominance, the cohesion-scaled dominance ceiling — never as a
    // windfall of the age's inflation. Self-calibrating, like _refCapPower/_refRevenue:
    // an emergent median, never a fitted absolute. 0 = the legacy fixed-380 base.
    const powRefEff = T.CAP_RELATIVE ? Math.max(POW_REF, world._refCapPowerS || 0) : POW_REF;
    // CAP_K re-derived for the relative unit (CAP_K_REL): the legacy coefficient was
    // calibrated with log2 arguments inflated by the era's absolute power (a median
    // classical capital read log2(1+med/380) ≈ 3-4 where the relative ruler reads
    // log2(2) = 1), so the same provinces-per-unit constant must be re-expressed in
    // the new unit or every capacity silently shrinks ~×3 and the org coverage floor
    // flattens the whole size distribution (measured: empire tail 5.4 → 1.8). One
    // constant, one meaning: provinces held per median-realm-equivalent of power.
    const capK = T.CAP_RELATIVE ? CAP_K_REL : CAP_K;
    // ORG_APT_CAP (audit 2026-07 wiring): the ruling stock's heritable organisation
    // aptitude multiplies the centre's hold capacity — the institutional edge made
    // territorial. This is the aptitude system's PAYOUT half, which was wired only
    // into the legacy reach-Voronoi (dead under FIELD_POLITY) while the learning
    // half ran — the lever read 0.4 and did nothing. Same gate and shape as the
    // legacy path (countryTerritory.js:929); ORG_APT_CAP=0 recovers the unwired
    // capacity byte-identically (×1 exact).
    const aptMul = 1;   // (ORG_APT_CAP removed 2026-07: measured windowed at 0.15 and 0.4, the capacity payout failed its gates; the aptitude LEARNING half lives on)
    let peaceCapacity = (capK * instMul * Math.log2(1 + capPowerCap / powRefEff)
                        + Math.min(SEAT_BONUS_CAP * instMul, seatBonus)) * dominance * geoMul * aptMul;
    // IMPERIAL HYSTERESIS (path dependence): the administrative reach, roads and
    // legitimacy a large realm accretes PERSIST after its raw power dips, so a once-
    // great empire holds together longer than its live strength alone would justify.
    // A slow stock on the persistent polity (rises fast, decays ~4× slower) floors the
    // capacity at a fraction of its recent imperial peak — turning the memoryless,
    // RELATIVE capacity into a path-dependent, ABSOLUTE one: durable Romes, not
    // one-era flashes, and the source of a lasting size hierarchy over a uniform field.
    const gov = govOf(world, c.id);
    const prevImp = gov._impCapacity || 0;
    gov._impCapacity = prevImp + (peaceCapacity - prevImp) * (peaceCapacity > prevImp ? CAP_IMP_RISE : CAP_IMP_DECAY);
    peaceCapacity = Math.max(peaceCapacity, gov._impCapacity * T.CAP_IMP_FLOOR);

    // ── War duress: throttle the budget while the realm is fighting ────
    // (fronts are tallied in armies.js advanceFronts → world._fronts.)
    const fb = world._fronts && world._fronts.byCountry;
    const fronts = fb ? (fb.get(c.id) ? fb.get(c.id).size : 0) : 0;
    const besiegedCap = world.step - (cap._siegeAt ?? -Infinity) < SIEGE_WINDOW / (world._dt || 1);
    const raidedCap   = world.step - (cap._warAt   ?? -Infinity) < SIEGE_WINDOW / (world._dt || 1);
    let duress = 1;
    if (fronts > 1) duress /= (1 + MULTIFRONT_PENALTY * Math.min(3, fronts - 1));   // split army/attention (capped)
    if (besiegedCap)     duress *= SIEGE_CAPACITY_MULT;                  // throne pinned
    else if (raidedCap)  duress *= WAR_CAPACITY_MULT;                    // core harried
    // War intensity drives the army's wartime cost surcharge (disburseTreasury).
    const warLevel = fronts + (besiegedCap ? 2 : raidedCap ? 1 : 0);
    gov._warLevel = warLevel;   // cached on the polity for the goods layer's wartime procurement read (T.ARMY_PROCURE) — refreshed every polity pass, like _solvency
    // Fiscal duress (death-spiral): a state that can't pay its army (last
    // pass's solvency, from disburseTreasury) loses its grip on the frontier.
    // Lose provinces → lose tax revenue → can't pay → capacity falls → lose
    // more — the self-reinforcing collapse.
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
    // For a NOMADIC realm the streak IS the state: charisma-glued confederations
    // are held together by success, so momentum counts (and can carry) double —
    // and rides the same decay clock, so a stalled horde deflates twice as hard.
    const banked = Math.min(T.MOMENTUM_CAP, gov._momentum || 0);   // the bank stays clamped at the settled cap, as ever
    const momentum = banked * (c._nomadic ? NOMAD_MOMENTUM : 1);   // ...but a horde RIDES it double
    gov._momentum = banked * MOMENTUM_DECAY;     // decay each pass; conquest re-banks it (armies.js)
    const capacity = peaceCapacity * duress * fiscalDuress + momentum;
    c._capacity = capacity;        // (already duress-adjusted) for the info panel
    c._momentum = momentum;        // for the info panel
    c._fronts = fronts;
    c._capitalBesieged = besiegedCap;
    c._solvency = solvency;

    // Variable taxation: war + insolvency push the rate up toward a cap. Recent
    // conquests bank war-weariness relief (_spoils, in armies.js) that fades.
    const targetTax = Math.min(T.TAX_MAX, T.TAX_BASE + TAX_WAR * warLevel + TAX_BANKRUPT * (1 - solvency));
    gov._taxRate = (gov._taxRate ?? T.TAX_BASE) + (targetTax - (gov._taxRate ?? T.TAX_BASE)) * TAX_DRIFT;
    gov._spoils = (gov._spoils || 0) * SPOILS_DECAY;
    c._taxRate = gov._taxRate;

    // ── LATIFUNDIA driver: the realm's EXTRACTION income share ──────────────
    // _conqFlow banks coin taken by force — sack plunder (armies.js) and tribute
    // received (dependency stream above) — and fades on the spoils clock, so it
    // reads "recent conquest wealth", not an eternal ledger. Rescaled to a per-pass
    // rate, its share against domestic revenue measures WHAT KIND of state this is:
    // a conquest state (Rome mid-expansion) near 1, a tax state at peace near 0.
    // That share — not any era or event — is what sends elite wealth into land below.
    let conqShare = 0;
    if (T.LATIFUNDIA) {
      gov._conqFlow = (gov._conqFlow || 0) * CONQ_DECAY;
      const ext = (1 - CONQ_DECAY) * gov._conqFlow;   // decayed bank → smoothed per-pass extraction income
      conqShare = ext / (ext + Math.max(0, gov._lastRevenue || 0) + CONQ_REV_FLOOR);
      c._conqShare = conqShare;   // info panel / probes
    }

    // ── Popular unrest: hardship piles up; peace + plenty + light taxes cool it.
    // At the top it boils over into a rebellion (rebel(), fired after secession).
    const taxOver = Math.max(0, (gov._taxRate - T.TAX_BASE) / (T.TAX_MAX - T.TAX_BASE));
    const warFat = Math.min(1, warLevel * 0.4) * (1 - Math.min(1, gov._spoils || 0));
    // MONUMENT LEGITIMACY (bread & circuses): the seat's accumulated monuments & games
    // (gov._monuments, built in disburseTreasury) overawe the people and cool unrest
    // across the realm — saturating, and relative to population so a vast empire needs
    // ever-grander works to keep the same legitimacy. A real reason to spend on cathedrals.
    let realmPop = 0;
    for (const s of c.members) if (s.countryId === c.id) realmPop += Math.max(0, s.people || 0);
    const legit = (gov._monuments || 0) > 0 ? gov._monuments / (gov._monuments + MONUMENT_REF * Math.max(1, realmPop)) : 0;
    c._legitimacy = legit;                         // info panel
    const monRelief = T.MONUMENT_LEGIT * legit;    // extra unrest cooling from prestige works
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
      // OLD WOUNDS (GRIEV_LEDGER): a province whose ground remembers a fallen
      // nation simmers under the ruler who harmed it, ∝ the pair ledger — the
      // NATIONAL-memory channel identity-mixture mismatch can't express. Reads
      // the ledger, which decays over generations, so it needs no era weight:
      // its amplitude IS the recency of the harm. Gone once assimilation
      // completes (the derive clears s._homeland).
      const gG = (T.GRIEV_LEDGER && (s._homeland ?? -1) >= 0) ? GRIEV_UNREST_W * grievOf(world, s._homeland, c.id) : 0;
      // SERFDOM (land-tenure coercion): bound peasants owing heavy labour-rent. It forms
      // where a settlement's GRAIN is in demand (export pull) and a STRONG realm can bind
      // the peasants (coercion), set against their ability to EXIT to towns/commerce. The
      // PLAGUE FORK: when a plague makes labour scarce, a strong-coercion realm binds the
      // survivors TIGHTER (the second serfdom — Eastern Europe) while a commercial/weak one
      // lets them bargain FREE (the West) — same shock, opposite institutions, never timed.
      const exportPull = s._exportFoodFrac || 0;   // a grain producer — the commercial-farm pull both land-tenure institutions key on
      // LATIFUNDIA (conquest estates): the elite's extraction income (conqShare, above)
      // goes into LAND wherever the land's produce finds a market (exportPull) — the
      // countryside consolidates into estates whose gang-labour demand the slave market
      // clears (settlement.js updateCoercedLabour). It grows and fragments on the slow
      // tenure clock, so when conquest stops the flow — and, generations later, the
      // estates — recede, while the captive supply dries much faster: the surviving
      // estates turn to bound tenants (the serfdom below) — the colonate, emergent.
      // Which coerced institution a grain belt gets is the DRIVER's doing: conquest
      // cash → slave estates (here); a strong lord where peasants can't exit → serfdom.
      if (T.LATIFUNDIA) {
        const estTarget = Math.min(1, T.ESTATE_FORM * conqShare * exportPull);
        const cur = s._estates || 0;
        // The tenure RATCHET: buying land is fast (cash meets a market); breaking
        // estates up means coercing the elite itself, so concentration accumulates
        // war by war and only unwinds on the slow institutional clock.
        s._estates = Math.max(0, Math.min(1, cur + (estTarget > cur ? ESTATE_DRIFT : ESTATE_BREAK) * (estTarget - cur)));
      }
      // SLAVE SOCIETY (coerced-labor.md §2 — the gSlave term): the enslaved share of a
      // settlement's population is a STANDING political grievance. A place worked by
      // chained gangs lives under the threat of the servile war however quiet it looks
      // (Spartacus's Italy, the Zanj marshes, Saint-Domingue) — masters patrol, fugitives
      // run, manumission is bargained, and the free poor fear the lash-economy's wage
      // floor. That price was missing: the estate-wrecking LOCAL revolt (settlement.js
      // updateCoercedLabour) fires only past a 60% ratio, so below it a slave economy
      // paid no political cost at all. Folded into the realm unrest sum like serfdom's
      // gSerf, so it feeds rebellion, loyalty bleed and secession through the same
      // machinery as every other grievance. Ratio form: under SLAVE_PEOPLE the unfree
      // live INSIDE s.people (denominator: people); the legacy separate-stock accounting
      // adds them — the spec's clamp(_unfree/(people+_unfree)), same as _unfreeRatio.
      const unfree = T.SLAVERY ? (s._unfree || 0) : 0;
      const gSlave = unfree > 0
        ? T.SLAVE_UNREST_W * Math.min(1, unfree / Math.max(1, (s.people || 0) + (T.SLAVE_PEOPLE ? 0 : unfree)))
        : 0;
      let gSerf = 0;
      if (T.SERFDOM) {
        const coercion = Math.min(1, (c._dominance || 1) / 4);              // a strong realm can bind
        // EXIT: how easily peasants escape — to nearby towns/commerce. Weighted toward
        // LOCAL connectivity (trade reach) so it varies place-to-place, giving a spatial fork.
        const exit = Math.min(1, (s._tradeReach ? s._tradeReach.size / 12 : 0) * 0.65 + ((s.knowledge && s.knowledge.organization) || 0) * 0.35);
        let serfTarget = Math.min(1, T.SERF_FORM * exportPull * coercion * (1 - 0.7 * exit));
        const scarce = s._plagueActive || ((s._plagueUntil || 0) > 0 && world.step < (s._plagueUntil || 0) + 2000);
        // The fork: a labour-scarce shock BINDS where the lord is strong and exit is poor
        // (coercion + isolation outweigh escape), else DISSOLVES serfdom (the West).
        if (scarce) serfTarget = (coercion + (1 - exit)) >= 1.0 ? Math.min(1, serfTarget + T.SERF_PLAGUE) : 0;
        s._serf = Math.max(0, Math.min(1, (s._serf || 0) + 0.02 * (serfTarget - (s._serf || 0))));
        gSerf = T.SERF_UNREST * s._serf;
      }
      // a shrewd, firm ruler keeps better order; a foolish, weak one lets it fray (dynasties.js c._rulerRelief, ±)
      s.unrest = Math.max(0, Math.min(1, (s.unrest || 0) + (gH + gC + gW + gT + gS + gI + gSerf + gSlave + gG) * T.UNREST_GAIN - UNREST_RELIEF - monRelief - (c._rulerRelief || 0)));
      const gBond = gSerf + gSlave;   // bondage grievances share one cause label
      s._unrestCause = s._plagueActive ? "plague"
                     : gBond > gG && gBond > gI && gBond >= gH && gBond >= gT && gBond >= gW && gBond >= gC ? "servile unrest"
                     : gG > gI && gG >= gH && gG >= gT && gG >= gW && gG >= gC ? "old wounds"
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
      // ABILITY to hold (motive + opportunity secession): the realm's NATIONAL ARMY
      // suppresses a province's own rebel capacity (garrison + a militia levy from its
      // people), decayed by the distance the army must march. A rich megacity has no
      // army of its own to match the nation's, so a solvent, unified state holds it;
      // a far province — or one whose realm's army has been drained by war casualties
      // or insolvent desertion (both already shrink s.army) — can break away. The
      // MOTIVE (loyalty/unrest) is the trigger handled below; this is the FEASIBILITY.
      // HOLD_ARMY=0 reverts to the old economic capital-vs-province ratio.
      // NATIONALIST LEVY: a province foreign to its ruler's people/tongue/faith raises
      // a far larger militia when it rises — the whole people mobilises on identity
      // lines (1848, the Ottoman Balkans, the breakup of Austria-Hungary), which regular
      // suppression can't match. So cultural distance multiplies the rebel levy, letting
      // foreign-identity provinces break military holding and secede into nation-states,
      // while a co-cultural province stays at the base levy and is held firmly. Pairs
      // with the absorption-resistance gate: foreign cities are both hard to absorb AND
      // hard to hold, so realms settle on their cultural core. Era-weighted off emergent
      // development (cohesion.js) — silent in antiquity (multi-ethnic empires hold),
      // cresting in the national age — never time-gated.
      const natRes = (T.HOLD_ARMY && (T.REBEL_IDENTITY > 0 || T.NAT_OVERREACH > 0)) ? absorbResistance(cap, s, idW) : 0;
      // PROV_FIELD: the province's PEOPLE are its governed catchment population
      // (anchored to census units), not the city census — so the rebel levy is the
      // countryside in revolt (the peasant rising the census could never raise) and
      // the size burden is the real administrative mass. At lever 0 provPeople is
      // exactly (s.people || 0) — the original expressions, byte-identical.
      const provPeople = provRatio > 0 && (s._govPeople || 0) > 0 ? s._govPeople * provRatio : (s.people || 0);
      const provForce = (s.army || 0) + provPeople * T.REBEL_LEVY * (1 + T.REBEL_IDENTITY * natRes);
      // The army that can actually be brought to bear HERE is the national force minus
      // what's tied down suppressing the realm's OTHER foreign provinces (natForeign −
      // this one's own share): a unified realm concentrates its whole army on each
      // revolt, a polyglot empire divides it across every restive march. (Under
      // PROV_FIELD the share subtracted is people-weighted, matching natForeign.)
      const natResW = provWMean > 0 ? natRes * ((s._govPeople || 0) * provRatio / provWMean) : natRes;
      const armyAvail = natArmy / (1 + T.NAT_OVERREACH * Math.max(0, natForeign - natResW));
      const coerce = T.HOLD_ARMY
        ? Math.min(COERCE_CAP, Math.sqrt((armyAvail * (holdRange / (holdRange + d)) + 1) / Math.max(1, provForce)))
        : Math.min(COERCE_CAP, Math.sqrt(capPower / Math.max(1, settlementPower(s))));
      const sizeMul = 1 + T.SIZE_LOAD * Math.min(3, Math.log2(1 + provPeople / SIZE_REF));
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
    // CTRL_LIVE: loyalty keys on the FIELD's hold, not the old capacity budget (which no longer
    // matches the field territory — that mismatch made the live map over-secede AND oscillate).
    // A province the field holds FIRMLY (hold near the capital's) is loyal; one it holds WEAKLY
    // (the far frontier, low control) is restless and bleeds loyalty — a self-consistent
    // fragmentation brake that scales with each realm, so a big empire sheds its outer marches
    // while a compact one holds firm, with no capacity stack.
    // (T.CTRL_LIVE removed 2026-07 — the field-hold loyalty read went with the
    // prototype; coverage is the capacity budget, as always.)
    for (const { s, load } of loads) {
      cum += load;
      const covered = cum <= capacity;
      const pacified = world.step - (s._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE;
      const infant   = s.parentSettlementId >= 0 && world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS / (world._dt || 1);
      // FUNNEL (telemetry.js) — SECESSION: why does this province NOT break away?
      // Wired because `life.polity.died` measures 0 at both grids: no realm has ever
      // ended in 9,000 steps, and shedding a province is the channel by which one
      // could. "Nothing ever fragments" is an ABSENCE, and an absence is exactly what
      // outcome state cannot explain — the realm count says a realm survived, never
      // which brake held it together.
      tel(world, "secede", "CANDIDATE");
      if (pacified || infant) {
        tel(world, "secede", pacified ? "garrisoned(recentConquest)" : "infantColony");
        // Held by garrison / colonial project: nudge loyalty toward its base
        // but never secede yet.
        const base = pacified ? 0.5 : 0.7;
        s.loyalty = (s.loyalty ?? base) + (base - (s.loyalty ?? base)) * 0.15;
        continue;
      }
      if (covered) {
        tel(world, "secede", "withinAdminBudget");
        s.loyalty = Math.min(1, (s.loyalty ?? 1) + LOYAL_RECOVER * (1 - (s.loyalty ?? 1)));
      } else {
        // How deep past the line — CAPPED so a wildly over-extended realm sheds gradually
        // (ring by ring over passes) instead of its whole frontier collapsing in one tick.
        // CTRL_LIVE uses the field-hold deficit (overField); else the capacity overspend.
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
        // LOYAL_FIELD hysteresis: a collapsed ADMINISTRATION only seeds a revolt
        // once its PEOPLE have detached too (county attachment past the restless
        // line). A long-held core forced over budget by one bad war stays restless
        // but holds — its people carry the realm; a fresh march (never attached)
        // sheds exactly as before. Detachment follows the collapsed stock on the
        // DETACH_TAU clock, so this delays a core's shedding, never prevents it.
        // Two brakes, and they need OPPOSITE fixes, so the funnel must tell them
        // apart: a province still spending down its loyalty stock is on its way out
        // and merely slow, while one whose PEOPLE remain attached is held by the
        // hysteresis and would not secede however long you waited.
        if (s.loyalty <= 0 && (!T.LOYAL_FIELD || (s._attach ?? 0) <= ATTACH_SECEDE)) {
          telPass(world, "secede");
          seeds.push(s);                                   // collapsed — defer (revolt is contagious)
        } else if (s.loyalty > 0) tel(world, "secede", "loyaltyStockNotYetSpent");
        else tel(world, "secede", "peopleStillAttached(hysteresis)");
      }
    }
    c._loadTotal = cum;   // total admin load drawn (vs c._capacity)
    // Persisted STRAIN (load ÷ capacity) for the budget-gated expansion levers:
    // adoption (adoptAndFound) and the territorial reach budget
    // (computeCountryTerritory) read it, so a court past its budget stops
    // taking on subjects and stops projecting — expansion asks "can I govern
    // this?" up front instead of only paying for the answer afterwards.
    // Stamped on the persistent polity record so save/load replays identically.
    gov._strain = capacity > 1e-6 ? cum / capacity : (cum > 0 ? 8 : 0);
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
    // The governor's POWER BASE is his whole PROVINCE (the members that follow
    // him out — declareIndependence takes exactly this bloc), not his lone seat:
    // a satrap's strength was his satrapy. For a size-1 province this reduces
    // to the old seat-only reading, so small realms are unaffected.
    const provPower = new Map();
    for (const m of c.members) {
      if (m.countryId !== c.id) continue;
      const seatId = m._provinceCity ?? c.capitalId;
      provPower.set(seatId, (provPower.get(seatId) || 0) + settlementPower(m));
    }
    // ── T.ELITE_FRACTURE (docs/hegemon-ossification-2026-07.md §6 blueprint) ──
    // The measured cause of the immortal hegemon (probe_hegemon @960/30k: one
    // realm holds #1 for 100% of the back-40%, unbroken 12k steps — the owner's
    // "big countries last Stone Age to Modern"): the great power has NO internal
    // break, only edge recession. The overmighty-governor channel is inert because
    // it treats the throne as OMNIPRESENT — a province qualifies at ratio ≥ 0.55 of
    // the throne's FULL power, but the crown's home province is the strongest by
    // construction, so provinces peak at ~0.30 and never scheme (ambMax=0.00 every
    // sample). History fractured great empires from within — the Diadochi, the Han
    // warlords, the Abbasid emirates, the Carolingian partition — via exactly the
    // forces the blueprint names. Four, all blended by the lever weight so elite=0
    // is byte-identical:
    const elite = T.ELITE_FRACTURE || 0;
    // (2) ELITE OVERPRODUCTION: the COUNT of provincial power bases strong enough
    // to be a rival court (≥ ELITE_COURT_FRAC of the throne). Rival courts embolden
    // each other — an empire dense with magnates is one dynastic stumble from
    // partition. Computed once per realm.
    let strongCourts = 0;
    if (elite > 0) {
      const tp = provPower.get(c.capitalId) || capPower;
      for (const [sid, pp] of provPower) if (sid !== c.capitalId && pp >= ELITE_COURT_FRAC * tp) strongCourts++;
    }
    const eliteCrisis = elite > 0 && inCrisis(world, c.id);   // (4) a succession crisis is the Diadochi trigger
    for (const s of c.members) {
      if (s.countryId !== c.id || s.id === c.capitalId) continue;     // gone / is the throne
      // A province seat by FUNCTION: a city, or the regional seat assignProvinces
      // chose (the locally-strongest member). The old CITY-only test starved big
      // town-built realms of any possible breakaway leader — the floating city
      // bar pins labelled cities to the age's top handful (see blocHasSeat).
      const seat = (s.tier | 0) >= CITY_TIER || s._provinceCity === s.id;
      const pacified = world.step - (s._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE;
      const infant   = s.parentSettlementId >= 0 && world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS / (world._dt || 1);
      // Province vs PROVINCE, not province vs the capital city alone: the throne's
      // strength is likewise its whole home province (court + the heartland around
      // it). Aggregate-vs-solo let any 4-village frontier province out-"power" an
      // imperial capital city and set every far seat scheming at once. Falls back
      // to the raw capital power if the throne's bucket is missing this pass.
      const thronePower = provPower.get(c.capitalId) || capPower;
      const rawRatio = (provPower.get(s.id) || settlementPower(s)) / Math.max(1, thronePower);   // the province's strength vs the throne's province
      // Same blended distance as the hold load — a governor across a
      // mountain range is "farther" than its straight-line reading,
      // proportionally embolder.
      const eucl = dist(world, cap.pos.x, cap.pos.y, s.pos.x, s.pos.y);
      const tc   = tcosts.get(s.id);
      const tcEff = (tc === undefined || !isFinite(tc)) ? reachCeil : tc;
      // A governor across a great river is "farther" too (same full-weight
      // river toll as the hold load) — so a far-bank seat schemes harder.
      const far  = (eucl + Math.max(0, tcEff - eucl) + (tcross.get(s.id) || 0)) / holdRange;
      // (1) DELIVERED, not owned: suppression must be PROJECTED. The throne's
      // power reaches a far governor attenuated by distance (÷(1+far)), so a
      // province competes against what the crown can actually MARCH to it, not
      // its full home strength. This is the single fix for the inert channel:
      // a raw-ratio-0.30 province at far 1.0 reads effective 0.60 and clears the
      // 0.55 bar. Precedent: the colonial-independence line already qualifies on
      // projected force (projForce = blocPow × reach). Blended by elite so 0 is
      // the raw ratio exactly.
      const ratio = rawRatio * (1 + elite * ELITE_PROJ * far);
      if (!seat || pacified || infant || ratio < AMBITION_RATIO || far < AMBITION_MIN_FAR) {
        if (s._ambition) s._ambition = Math.max(0, s._ambition - AMBITION_GAIN);   // fades when unqualified
        continue;
      }
      const margin = (ratio - AMBITION_RATIO) / (1 - AMBITION_RATIO);  // 0 at threshold → 1 near parity
      let duressMul = besiegedCap ? AMBITION_DURESS : (raidedCap ? 1.2 : 1);
      // (2) rival courts embolden each other; (3) the conquest→latifundia estates
      // FUND the breaker (ESTATE_BREAK's slow unwind gains political meaning); (4)
      // a succession crisis is the Diadochi opening. All blended by elite (×1 off).
      if (elite > 0) {
        duressMul *= 1 + elite * (ELITE_COURT_W * Math.max(0, strongCourts - 1)
                                + ELITE_MAGNATE_W * (s._estates || 0));
        if (eliteCrisis) duressMul *= 1 + elite * (ELITE_CRISIS_EMBOLDEN - 1);
      }
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
                          world.step - (s.foundedStep || 0) < COLONY_SUPPLY_TICKS / (world._dt || 1);
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
      const give = Math.max(0, s.wealth || 0) * (gov._taxRate ?? T.TAX_BASE);
      if (give > 0) { s.wealth -= give; gov.treasury += give; gov._revenue += give; recordOut(s, OUT_TRIBUTE, give); }
      // ②b MODERN_FISC (docs/industrial-transition-2026-07.md, default off): the modern
      // income tax. The wealth tax above reaches only the coin HOARD and the produce
      // levy below only the HARVEST; a modern revenue state (income tax, withholding, a
      // professional bureaucracy) taxes the whole real OUTPUT FLOW — the medieval few-%
      // → the modern ~40-50% of GDP. Levied on the STABLE real economy (realOutputOf,
      // people×productivity), priced to coin at the monetisation ratio world._inflRef,
      // and — exactly like the produce levy — the unmonetized remainder is taken IN KIND
      // (gov._inKind, which provisions the army before any coin is needed). So when a
      // monetary dip collapses the coin hoard, monetization falls with it and the tax
      // shifts to in-kind, keeping the state SOLVENT through the dip instead of
      // collapsing with the coin — breaking the modern fiscal-fragmentation spiral (②a's
      // residual). Emergent on the realm's OWN reached industrial development
      // (cap._indGate — capital org AND metallurgy past ~0.78, the INDUSTRIAL_CAP gate),
      // never a clock; the rate is a development curve, never a target solvency. The
      // revenue also feeds gov._lastRevenue, so the existing CAP_LOG reach (②c) is funded
      // for free. Byte-identical at MODERN_FISC=0.
      if (T.MODERN_FISC > 0 && cap && (cap._indGate || 0) > 0 && (world._inflRef || 0) > 0) {
        // realOutputOf×_inflRef is the output's COIN-VALUE (a stock, ≈ the money the
        // output supports — the same bridge the fiat backing uses), so this is a
        // per-pass share like the wealth tax above — NOT ×POLITY_INTERVAL (that factor
        // is for the produce levy, whose base _landFood is a per-tick harvest FLOW).
        const incomeDue = T.MODERN_FISC * cap._indGate * realOutputOf(s, world) * world._inflRef;
        if (incomeDue > 0) {
          const mz = T.MONETIZE > 0 ? monetization(s) : 1;
          const coinPart = Math.min(Math.max(0, s.wealth || 0), incomeDue * mz);   // purse-capped: coin must exist to remit
          if (coinPart > 0) { s.wealth -= coinPart; gov.treasury += coinPart; gov._revenue += coinPart; recordOut(s, OUT_TRIBUTE, coinPart); }
          const inKind = incomeDue * (1 - mz);
          if (inKind > 0) gov._inKind = (gov._inKind || 0) + inKind;   // provisions the army (disburseTreasury), like the produce levy's in-kind
        }
      }
      // PRODUCE LEVY (rent + tithe on the HARVEST): a landlord/church share of a settlement's
      // farm OUTPUT, taken off the top every pass — what kept real peasants poor (their surplus
      // skimmed as a share of the crop, not their cash hoard) and what funds the towns. It falls
      // on FARMED output (_landFood): the agrarian countryside pays it. Under the legacy model
      // cities grew nothing and were exempt; under DISSOLVE_FARMS every town works its own
      // catchment, so a city is tithed on its hinterland's HARVEST too — draining the rural
      // hoards UP to the state, then out to the great cities.
      // The levy now tracks the realm's VARIABLE tax rate (war / insolvency push it
      // up), so a state at war taxes its countryside's HARVEST harder — not just its
      // cash — and that over-extraction feeds the over-tax grievance into revolt
      // (the "raise taxes for the war → the provinces rise up" loop). 1× at the base
      // rate, scaling up toward TAX_MAX/TAX_BASE in a hard war.
      if (T.FARM_RENT > 0 && (s._landFood || 0) > 0) {
        const taxMul = (gov._taxRate ?? T.TAX_BASE) / T.TAX_BASE;
        // Serfdom skims a HEAVIER share of the harvest — bound peasants kept at subsistence,
        // their surplus extracted as labour-rent up to the lord/state (the serf breadbasket).
        const serfMul = T.SERFDOM ? 1 + T.SERF_RENT * (s._serf || 0) : 1;
        const rentDue = (s._landFood || 0) * T.FARM_RENT * serfMul * taxMul * T.POLITY_INTERVAL;
        if (T.MONETIZE > 0) {
          // THE LEVY→COIN ARC (T.MONETIZE): the harvest share is taken IN THE HARVEST.
          // The old form converted the whole produce levy to coin AND capped it by the
          // peasant's own purse — so an unmonetized village owed the state only what
          // little cash it happened to hold ("no coin, no state share": the same
          // anachronism the foodHierarchy levy fixed for city-feeding, still alive on
          // the fiscal side), while conversely the state's every income arrived as
          // spendable coin from genesis. Now only the settlement's MONETIZED fraction
          // of the rent is sold for cash into the treasury (still purse-capped — coin
          // must exist to move); the remainder is delivered IN KIND (gov._inKind, the
          // same value units) — grain that can feed soldiers and the court this pass
          // but cannot hire, hoard, or fund the fiscal-dominance reach that COIN
          // revenue projects (dominance reads gov._revenue, coin only). A realm of
          // coinless countryside is a TRIBUTE empire — it eats, garrisons, and holds
          // by coercion; the CASH empire, with its bankers and paid legions, emerges
          // only as its provinces monetize. Never a date: monetization is coin stock ×
          // market access per settlement (settlement.js monetization).
          const mz = monetization(s);
          const coinPart = Math.min(Math.max(0, s.wealth || 0), rentDue * mz);
          if (coinPart > 0) { s.wealth -= coinPart; gov.treasury += coinPart; gov._revenue += coinPart; recordOut(s, OUT_TRIBUTE, coinPart); }
          const inKind = rentDue * (1 - mz);
          if (inKind > 0) gov._inKind = (gov._inKind || 0) + inKind;
        } else {
          const rent = Math.min(Math.max(0, s.wealth || 0), rentDue);
          if (rent > 0) { s.wealth -= rent; gov.treasury += rent; gov._revenue += rent; recordOut(s, OUT_TRIBUTE, rent); }
        }
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
    gov._lastRevenue = gov._revenue;                  // CAP_MODEL: carry this pass's total fiscal extraction to next pass's capacity calc (revenue isn't accumulated yet when capacity runs). Persistent on gov; inert unless CAP_MODEL reads it.
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

  // ── Post-khan shatter ──────────────────────────────────────────────
  // A nomad confederation is a winning streak with a khan at its head, not an
  // institutionalized state — and a CONTESTED succession (a live dynastic
  // crisis) disputes the only thing holding it together. While the crisis
  // runs, the whole confederation can shatter wholesale into successor hordes
  // (fragmentRealm — the Diadochi machinery, entered by succession rather
  // than by a stormed capital). Settled realms are untouched: they shatter
  // only the ways they always could. Emergent both ways — a horde that
  // sedentarizes (flag off) outgrows the shatter the same pass.
  {
    const shatterP = _passProb(NOMAD_SHATTER_HAZARD);
    for (const c of [...countries.values()]) {
      if (!c._nomadic || c.members.length < 3) continue;
      if (!inCrisis(world, c.id)) continue;
      const r = hash32(world.seed || 1, "hordeShatter", c.id, world.step) / 4294967296;
      if (r > shatterP) continue;
      fragmentRealm(world, c.id, -1, "succession");
    }
  }

  // Reconcile the persistent polity registry against the live view: register
  // substantial newcomers, close the records of realms that vanished. (No
  // pruning — fallen realms keep their record, history and temperament.)
  reconcilePolities(world, countries);
}

// ── Nomad confederations: a polity MODE, derived, never stored ─────────
// A realm is NOMADIC when its SEAT sits in saddle-country (open riding
// terrain — the same openness the transport core discounts for mounted
// cultures — too poor to farm), its herds are real (horses reachable at the
// seat) and its riding is real (mobility at the chariot gate). No steppe, no
// horses, or no riding → never fires, on any map. The SEAT is the right
// granularity, not a population majority: everything a realm IS in this
// model — knowledge, personality, reach — reads from its capital, and
// rebuildCountries seats the court at the strongest member, so a horde that
// takes a rich farming city finds its court sitting in the sown next pass
// and the flag flips off — sedentarization (the Yuan arc) falls out of seat
// selection for free, while a farming empire that holds steppe marches never
// reads as a horde. Recomputed from live state every polity pass.
function classifyNomads(world, countries) {
  const tw = world.tw, fert = world.fert;
  // ── Field classification (T.NOMAD_FIELD, default on) ────────────────────────
  // The seat-tile test above was measured DEAD: 0 hordes over 24k steps on two
  // seeds (tools/probe_nomads.mjs). Its funnel dies on a conjunction that never
  // happens — the seat must be the realm's STRONGEST member (power ∝ people, so
  // courts always sit in the sown), on a saddle tile (settlements crystallize on
  // good land — only ~10 of ~110 ever sit there), with a horse DEPOSIT in its own
  // catchment (162 sparse deposit tiles world-wide, median fertility 0.70 — the
  // deposit models a horse-TRADE commodity, and barely overlaps the 40% of land
  // that is saddle-country). Pastoralism is not a point resource: the herd is the
  // GRASS, and the sim already encodes both halves — tileOpenness IS the pasture,
  // and mobility knowledge is itself gated on horse access at its source
  // (settlement.js: no horses, no mobility growth), so a court at the chariot
  // gate has proven its herds through the knowledge pipeline.
  //   So classify the MODE from what the realm's people actually are: nomadic
  // when the court rides (mobility ≥ the chariot gate) and the MAJORITY of its
  // GOVERNED PEOPLE (popField over its held tiles — same substance the power and
  // capacity rulers now read) live on saddle-country: open riding ground too poor
  // to farm. A realm whose people herd is a horde; one whose people plough is a
  // state, however much steppe march it holds. Sedentarization stays free — take
  // enough sown land and the people-majority flips the flag off next pass (the
  // Yuan arc), exactly as seat-selection used to promise but at the granularity
  // where it actually happens. Recomputed live every pass, never stored.
  if (T.NOMAD_FIELD && T.POP_FIELD && world.popField && world._countryOwner) {
    const pf = world.popField, co = world._countryOwner, elev = world.elev, N = world.N;
    const tot = new Map(), sad = new Map();
    for (let ti = 0; ti < N; ti++) {
      const cc = co[ti]; if (cc < 0 || elev[ti] <= 0) continue;
      const p = pf[ti]; if (!(p > 0)) continue;
      tot.set(cc, (tot.get(cc) || 0) + p);
      if (tileOpenness(world, ti) >= NOMAD_OPEN_MIN && (fert[ti] || 0) < NOMAD_FERT_MAX) sad.set(cc, (sad.get(cc) || 0) + p);
    }
    for (const c of countries.values()) {
      c._nomadic = false;
      const cap = c.capital; if (!cap) continue;
      if (((cap.knowledge && cap.knowledge.mobility) || 0) < CHARIOT_MOB) continue;  // no riding, no horde
      const t = tot.get(c.id) || 0;
      c._nomadic = t > 0 && (sad.get(c.id) || 0) > t * NOMAD_PEOPLE_MAJ;
    }
    return;
  }
  for (const c of countries.values()) {
    c._nomadic = false;
    const cap = c.capital; if (!cap) continue;
    if (((cap.knowledge && cap.knowledge.mobility) || 0) < CHARIOT_MOB) continue;  // no riding, no horde
    // Herds gate reads the seat's OWN-GROUND deposits (localRes), not the
    // trade-folded _effRes: a horde's herds are its own steppe, and localRes is
    // load-stable (re-derived on load by rederiveSiteStatics) whereas _effRes is
    // an unpersisted cache — keying a hard classification boolean on it forked
    // save/load continuations for any capital near the horse floor.
    const res = cap.localRes || {};
    if ((res.horses || 0) < NOMAD_HORSES_MIN) continue;                            // no herds, no horde
    const ti = (cap.pos.y | 0) * tw + (cap.pos.x | 0);
    c._nomadic = tileOpenness(world, ti) >= NOMAD_OPEN_MIN && (fert[ti] || 0) < NOMAD_FERT_MAX;
  }
}

// ── The raid economy of the steppe ─────────────────────────────────────
// A nomadic realm farms little — its land can't. What the steppe yields is
// force projection, and the horde converts it into the sown's wealth. Each
// polity pass, a settled realm within a horde's raiding range faces the
// steppe's terms: where tribute already flows (it SUBMITTED — the Xiongnu
// treaty, handled by the same considerSubmissions machinery as any hopeless
// matchup) or a truce holds, the treaty is honoured; otherwise the horde
// raids — a conserved sweep of portable coin (and captives, into the slave
// machinery) out of the victim's reachable settlements. Intensity rides the
// WEALTH GRADIENT between steppe and sown (a poor rim breeds no hordes) and
// is throttled by the defender's power (a strong empire suffers pinpricks; a
// soft one bleeds). A good season banks the same momentum conquest does —
// the confederation is glued together by success, so raiding snowballs
// toward the submission line — and the borderlands' unrest carries the fear.
function hordeRaids(world, countries) {
  // Nothing to do on a world with no hordes — the common case. Skip the whole
  // settlement sweep and Map builds rather than pay them every polity pass.
  let anyNomad = false;
  for (const c of countries.values()) if (c._nomadic) { anyNomad = true; break; }
  if (!anyNomad) return;
  // Per-realm live power / coin / heads, one sweep over the settlements. Coin
  // folds in the polity TREASURY (where raid loot lands) so a horde that has
  // grown rich reads as rich — the wealth GRADIENT the raid intensity rides
  // then closes from both sides as the steppe enriches (self-limiting), instead
  // of a one-way ratchet where looted coin is invisible to the gradient.
  const pow = new Map(), coin = new Map(), heads = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;
    pow.set(s.countryId, (pow.get(s.countryId) || 0) + settlementPower(s));
    coin.set(s.countryId, (coin.get(s.countryId) || 0) + (s.wealth || 0));
    heads.set(s.countryId, (heads.get(s.countryId) || 0) + (s.people || 0));
  }
  // POW_FIELD: a horde's might is its PEOPLE ON THE STEPPE, not its (few) towns —
  // the raid gradient reads the same field-grounded power as the war/alliance stack.
  fieldPowerOverlay(world, countries, pow);
  for (const c of countries.values()) {
    const gp = getPolity(world, c.id);
    if (gp && gp.treasury > 0) coin.set(c.id, (coin.get(c.id) || 0) + gp.treasury);
  }
  const raidP = _passProb(RAID_HAZARD);
  const ov = world._overlordOf, truces = world._truces;
  const bondedPair = (a, b) => ov && (ov.get(a) === b || ov.get(b) === a);
  const inTruce = (a, b) => {
    if (!truces) return false;
    const u = truces.get(Math.min(a, b) + ":" + Math.max(a, b));
    return u !== undefined && u > world.step;
  };
  for (const N of countries.values()) {
    if (!N._nomadic || !N.capital) continue;
    const wN = (coin.get(N.id) || 0) / Math.max(1, heads.get(N.id) || 1);   // the steppe's own wealth per head
    const reach = RAID_REACH * Math.max(1, N.holdReach);
    const powN = pow.get(N.id) || 1;
    for (const S of countries.values()) {
      if (S === N || !S.capital || S._nomadic) continue;   // the horde milks the SOWN — steppe-on-steppe is war, not business
      if (bondedPair(N.id, S.id) || inTruce(N.id, S.id)) continue;   // the treaty is honoured while it holds
      if (dist(world, N.capital.pos.x, N.capital.pos.y, S.capital.pos.x, S.capital.pos.y) > reach) continue;
      const wS = (coin.get(S.id) || 0) / Math.max(1, heads.get(S.id) || 1);
      if (wS <= wN) continue;                              // a poor rim breeds no hordes
      // Pair-unique deterministic key. hash32 takes two numeric args, so pass
      // N.id and S.id as SEPARATE fields — the old N.id*65537+S.id packing
      // collided once settlement ids passed 65537, correlating unrelated
      // raid pairs; the tagged two-arg form is collision-free for any ids.
      const r = hash32(world.seed || 1, "hordeRaid:" + N.id, S.id, world.step) / 4294967296;
      if (r > raidP) continue;
      const grad  = (wS - wN) / wS;                        // how much richer the sown is (0..1)
      const evade = powN / (powN + (pow.get(S.id) || 1));  // the share of the season the defence fails to parry
      const frac  = RAID_TAKE * grad * evade;
      if (frac <= 0.001) continue;
      let loot = 0, took = 0;
      const hit = [];
      for (const v of S.members) {
        if (v.mode !== "settled" || v.countryId !== S.id) continue;
        if (dist(world, N.capital.pos.x, N.capital.pos.y, v.pos.x, v.pos.y) > reach) continue;   // only what the riders can reach
        const p = (v.wealth || 0) * frac;
        if (p > 0) { v.wealth -= p; loot += p; }
        if (T.SLAVERY) {
          const g = Math.min((v.people || 0) * RAID_CAPTIVE * evade, (v.people || 0) * 0.2);
          if (g >= 1) { recordCaptives(N.capital, v, g); v.people -= g; took += g; fieldShift(world, v, -g); }   // the captive trains carry who they are (SLAVE_PEOPLE) — and empty the LAND (FIELD_DEMOG)
        }
        hit.push(v);
      }
      if (loot <= 0 && took < 1) continue;                 // a barren season leaves no mark — and no unrest (a raid that took nothing was no raid)
      for (const v of hit) v.unrest = Math.min(1, (v.unrest || 0) + 0.05);   // the borderlands that actually felt the riders live in fear
      if (loot > 0) { const npol = govOf(world, N.id); npol.treasury = (npol.treasury || 0) + loot; }   // conserved, like a sack's plunder
      if (took >= 1) N.capital._captives = (N.capital._captives || 0) + took;   // the captive trains ride for the slave markets
      // Prestige from a raid scales with how much it ENRICHED the horde relative
      // to what it had — a season that lifted a fortune glues the confederation,
      // a token skirmish barely registers (momentum ∝ achievement, like a sack's
      // plunder-scaled bank, not a flat city-storm bounty per poor-rim pinprick).
      const gain = Math.min(1, loot / Math.max(1, coin.get(N.id) || 1));
      bankMomentum(world, N.id, MOMENTUM_PER_STORM * evade * gain);
      logEvent(world, "horde.raid", { polity: S.id, name: realmName(world, S.id),
        from: N.id, fromName: realmName(world, N.id), loot: Math.round(loot), captives: Math.round(took) });
    }
  }
}

// ── Submission: a statelet facing hopeless odds takes an overlord ─────
// The vassalage entry point (see SUBMIT_* above). The alliance threat map
// nominates the candidate pairs (who towers over whom, slow-drifting); the
// DECISION is then made on live state — a court reads the odds it faces
// TODAY, not the ones from the last alliance rebuild: live network power
// (own settlements plus each side's direct dependencies — a metropole with a
// mighty network is no statelet, however small its home province), the
// suzerain's live reach, identity, and the coalition brake. On success the
// pair's war (if any) ends in capitulation and the dependency wiring is
// applied LIVE — the war pass must never sack a realm that has already knelt.
function considerSubmissions(world, countries) {
  const threat = world._allianceTarget;
  if (!threat || !world._countryPow) return;
  // Live power, network-inclusive (the same Σ settlementPower measure war uses;
  // recomputed here like absorbWeakNeighbors does, because up to three polity
  // passes roll between alliance rebuilds and courts don't submit to a hegemon
  // that was shattered two passes ago).
  const own = new Map();
  for (const c of countries.values()) {
    let p = 0; for (const m of c.members) if (m.mode === "settled" && m.countryId === c.id) p += settlementPower(m);
    own.set(c.id, p);
  }
  fieldPowerOverlay(world, countries, own);   // POW_FIELD: courts submit to governed weight, not roster length
  const ov = world._overlordOf;
  const eff = new Map(own);
  if (ov) for (const [dep, over] of ov) if (eff.has(over)) eff.set(over, (eff.get(over) || 0) + (own.get(dep) || 0));
  // Cadence-invariant per-pass probability (exact compounding, never saturates).
  const probBase = _passProb(SUBMIT_HAZARD);
  for (const [sid, hid] of threat) {
    if (hid < 0) continue;
    // FUNNEL (telemetry.js): vassalage is this sim's PRIMARY consolidation channel —
    // reading the chronicle established 16 `polity.submitted` against 0 annexations
    // over 16k steps — and it had no instrument that could say why a court did NOT
    // kneel. Tallied at the rejecting line, so the funnel cannot drift from the gate.
    tel(world, "submit", "CANDIDATE");
    const S = countries.get(sid), H = countries.get(hid);
    if (!S || !H || !S.capital || !H.capital) { tel(world, "submit", "noLiveSeat"); continue; }
    const spol = getPolity(world, sid);                     // pure read — the record is only minted on an actual submission
    if (spol && spol._overlord != null) { tel(world, "submit", "alreadyADependency"); continue; }
    const powS = eff.get(sid) || 1, powH = eff.get(hid) || 1;
    // T.CONQUEST_CASCADE — VICTORY COLLAPSES WITNESS RESISTANCE (wave 2 of the
    // variance arc, docs/variance-arc-2026-08-13.md). The funnel measured the
    // 5× bar rejecting 63% of all candidate pairs: among born-equals the
    // asymmetry the bar demands can never arise, so consolidation self-arrests
    // at every scale (singles vs singles, then blocs of 4-5 vs blocs of 4-5).
    // History's courts did not weigh STANDING power alone — they weighed the
    // DEMONSTRATED RECORD. After Thymbra every court to the Aegean submitted
    // to Cyrus at nothing like 5×; after Issus the Phoenician cities opened
    // their gates unfought. The sim already BANKS that record: conquest
    // momentum (govOf._momentum — fed by tiles captured and cities stormed,
    // fast-decaying, nomad-doubled). Here the witness bar reads it: the
    // effective ratio falls with the hegemon's momentum in stormed-city
    // equivalents (÷MOMENTUM_PER_STORM — the bank's own unit), floored at
    // PARITY (a court never kneels to a bloc weaker than itself, however
    // storied). A cold conqueror still needs the full 5×; a hot streak
    // overawes near-equals — and when the streak stalls, the bar snaps back
    // on momentum's own decay clock. Zero new constants; boom feeds the
    // existing bust machinery (momentum-crater shedding, capital-storm
    // shatter, elite fracture) the large fast-won structures it never had.
    let effRatio = SUBMIT_RATIO;
    if (T.CONQUEST_CASCADE) {
      const wins = (govOf(world, hid)._momentum || 0) / MOMENTUM_PER_STORM;
      effRatio = Math.max(1, SUBMIT_RATIO / (1 + wins));
    }
    if (powH < powS * effRatio) { tel(world, "submit", "resistanceNotHopeless"); continue; }
    // The suzerain must be able to PROJECT force to S's seat — overawing needs a
    // credible punitive expedition, which ranges SUBMIT_REACH past garrison range.
    const d = dist(world, H.capital.pos.x, H.capital.pos.y, S.capital.pos.x, S.capital.pos.y);
    if (d > SUBMIT_REACH * Math.max(1, H.holdReach)) { tel(world, "submit", "outOfProjectionReach"); continue; }
    // Deterministic per-(seed, settlement, step) roll — a pure function of its
    // key, so rolling BEFORE the identity/coalition work is free rejection.
    const r = hash32(world.seed || 1, "submit", sid, world.step) / 4294967296;
    if (r > probBase) { tel(world, "submit", "hazardRoll(waiting)"); continue; }
    // No cycles: if H's own overlord chain leads back to S, S can't take H as
    // suzerain (tribute pyramids — a vassal of a vassal — are fine; loops
    // aren't). An acyclic chain can't be longer than the live polity count.
    let up = hid, cyc = false;
    if (ov) for (let hops = 0; hops < countries.size && ov.has(up); hops++) {
      up = ov.get(up);
      if (up === sid) { cyc = true; break; }
    }
    if (cyc) { tel(world, "submit", "cycleWouldForm"); continue; }
    let prob = probBase;
    // Kin submit, foreigners resist longer. Same era-weighted identity brake as
    // peaceful absorption (T.ABSORB_IDENTITY) — it slows a wholly foreign court
    // by the full lever weight but never to zero (absorbResistance saturates at
    // exactly 1 for fully disjoint peoples; unscaled it made foreign submission
    // impossible forever, the opposite of "eventually bends").
    const mIdentity = 1 - T.ABSORB_IDENTITY * absorbResistance(H.capital, S.capital, identityWeightsFor(world, H.capital, S.capital));
    prob *= mIdentity;
    // Balance of power: a coalition arrayed against H guarantees the statelets
    // it would overawe — the same deterrence that throttles peaceful absorption.
    const brake = coalitionBrake(world, hid, world._countryPow.get(hid) || 1);
    prob /= brake;   // kept as a DIVISION: `p *= 1/b` differs from `p /= b` in the last
                     // ulp, and this feeds a comparison in a determinism-tested sim.
                     // The attribution below reads the same numbers without touching them.
    // Attributed to the SMALLER of the two brakes, never to "the roll failed" —
    // the same rule crystallize.js uses, so a funnel names the binding constraint
    // instead of the arithmetic that expressed it.
    if (r > prob) { tel(world, "submit", mIdentity <= 1 / brake ? "identityBrake(foreignCourt)" : "coalitionBrake(deterrence)"); continue; }
    if (bendTheKnee(world, sid, hid)) telPass(world, "submit");
    else tel(world, "submit", "bendTheKneeRefused");
  }
}

// ── T.VALLEY_UNION: the union of crowns in a cheap corridor (2026-08-11,
// docs/dawn-cradles-2026-08-07.md §8) ────────────────────────────────────────
// The owner's 174-AD map: a healthy filled world, every polity in one size
// band, no hegemon anywhere. Measured (probe_sizeband, tw=960, 22k steps): 67
// polities and multiCityRealms = 0 the WHOLE run — no realm ever holds two
// cities. The structure guarantees it: the mint law only creates cities
// OUTSIDE existing claims (1 city = 1 polity by construction), and every
// consolidation channel is ASYMMETRY-gated (SUBMIT_RATIO 5×, ABSORB_DOMINANCE)
// while the healthy synchronized dawn produces a cohort of NEAR-EQUALS — so
// consolidation needed asymmetry and asymmetry needed consolidation, and the
// political map froze as confetti. History's symmetry breaker was GEOGRAPHY:
// near-parity KIN city-states sharing one cheap corridor UNIFIED (the Nile
// valley cohering into Egypt c. 3100 BC — crowns merging among peers, not
// capitulation to a 5× hegemon), and the first multi-city kingdoms then
// generated the very asymmetries the existing overawe/absorb cascade runs on.
// This pass is that channel, from quantities the sim already owns:
//   · CORRIDOR — each capital lies within the OTHER court's holdReach: the
//     two courts already govern one stretch of country in every sense but
//     the crown (holdReach is the cost-grounded administrative radius, so
//     cheap river/coast country makes long corridors by itself);
//   · KINSHIP — the hazard scales by (1 − absorbResistance): full-kin courts
//     unify readily, wholly foreign neighbours essentially never (the same
//     era-weighted identity law every other peaceful transfer reads);
//   · A MILD EDGE — hazard × min(1, powH/powS − 1): exact parity never
//     merges (no coin-flip churn), a modest leader gathers its kin slowly,
//     2× gathers at the full submission hazard — smooth, no threshold;
//   · DETERRENCE — ÷ coalitionBrake, the same balance-of-power law that
//     throttles overawing, so a runaway uniter alarms its neighbours.
// The union is FULL (members join the winner at loyalty 1 — a negotiated
// union of kin courts, not an occupation) but identity REMEMBERS
// (recordOccupation): the old homeland persists in the cohesion ledger, so
// unions can break again through the existing secession/restoration
// machinery when the crown weakens. No new constants: SUBMIT_HAZARD,
// holdReach, absorbResistance, coalitionBrake, settlementPower recombined.
function considerUnions(world, countries) {
  if (!world._countryPow) return;
  const byId = world._byId;
  if (!byId) return;
  // Network power (own + dependencies), same measure the submission gate uses.
  const own = new Map();
  for (const c of countries.values()) {
    let p = 0; for (const m of c.members) if (m.mode === "settled" && m.countryId === c.id) p += settlementPower(m);
    own.set(c.id, p);
  }
  fieldPowerOverlay(world, countries, own);
  const ov = world._overlordOf;
  const eff = new Map(own);
  if (ov) for (const [dep, over] of ov) if (eff.has(over)) eff.set(over, (eff.get(over) || 0) + (own.get(dep) || 0));
  const probBase = _passProb(SUBMIT_HAZARD);
  const ids = [...countries.keys()].sort((a, b) => a - b);   // deterministic pair order
  for (const sid of ids) {
    const S = countries.get(sid);
    if (!S || !S.capital) continue;
    if (ov && ov.has(sid)) continue;                        // a dependency's crown is spoken for
    // A union of crowns is a SUCCESSION event, not a standing offer: courts
    // merged when the throne itself was in question (Aragon-Castile,
    // Poland-Lithuania, James VI & I) — a court without a secure succession
    // joins its kin rather than bleed over the crown. Ungated, the measured
    // rate ran hot and diluted war causality (unioncensus: wars 7→23 across
    // 3k steps as unions began; stylized 3 soft warnings over budget). The
    // crisis window is the dynasty machinery's own emergent signal — rate
    // now self-calibrates to dynastic fragility, and each union is a
    // chronicled human moment instead of background drift.
    if (!inCrisis(world, sid)) continue;
    // Deterministic per-(seed, court, step) roll BEFORE the pair scan — free rejection.
    const r = hash32(world.seed || 1, "union", sid, world.step) / 4294967296;
    if (r > probBase) continue;
    const powS = eff.get(sid) || 1;
    // The court unites with its strongest KIN corridor partner, if any qualifies.
    let best = -1, bestPull = 0;
    for (const hid of ids) {
      if (hid === sid) continue;
      const H = countries.get(hid);
      if (!H || !H.capital) continue;
      if (ov && ov.has(hid)) continue;
      const powH = eff.get(hid) || 1;
      if (powH <= powS) continue;                           // the LARGER court hosts the union
      const d = dist(world, H.capital.pos.x, H.capital.pos.y, S.capital.pos.x, S.capital.pos.y);
      // The corridor: EACH court could administer the other's seat today.
      if (d > Math.max(1, H.holdReach) || d > Math.max(1, S.holdReach)) continue;
      const kin = 1 - absorbResistance(H.capital, S.capital, identityWeightsFor(world, H.capital, S.capital));
      if (kin <= 0) continue;
      const edge = Math.min(1, powH / powS - 1);
      if (edge <= 0) continue;
      const pull = kin * edge / coalitionBrake(world, hid, world._countryPow.get(hid) || 1);
      if (pull > bestPull) { bestPull = pull; best = hid; }
    }
    if (best < 0) continue;
    // Second roll against the pair's own pull (kin × edge ÷ brake), so a
    // half-kin or barely-led union takes proportionally longer.
    const r2 = hash32(world.seed || 1, "unionPull", sid, world.step) / 4294967296;
    if (r2 > bestPull) continue;
    // THE ACT IS THE BOND, NOT THE TRANSFER (the third measured form, and the
    // one history wrote). Member-transfer was tried twice and the territory
    // machinery UNDID it both times — first through the zombie-crown lane
    // (no integration stamps), then, with every stamp, registry closure and
    // claim snap in place, through the honest one: a young realm's claim
    // budget cannot administer the second city's country, the crawl never
    // turns the junior's ground, and the derivation strips the member
    // (probe_unionhold3: byte-identical reversion THROUGH the full
    // paperwork). The sim was right — early unions of crowns were PERSONAL
    // UNIONS, two administrations under one senior crown (Aragon-Castile
    // kept separate cortes for centuries) — and the sim's tested vassalage
    // bond models exactly that: the junior keeps its realm, administration
    // and land (no budget violation, nothing for the territory law to
    // undo; VASSAL_SHIELD makes the bond the arrangement), while the
    // bloc's POWER aggregates (eff-network) — which is the asymmetry seed
    // the SUBMIT_RATIO cascade needs. Territorial consolidation follows
    // later through the existing org-gated machinery as statecraft
    // matures — the same two-act arc as Castile-Aragon → Spain.
    if (bendTheKnee(world, sid, best, "union")) telPass(world, "union");
    else tel(world, "union", "kneeRefused");
  }
}

// ── T.SATRAPIZE: the second act — a mature suzerain integrates its aged
// vassals as PROVINCES (2026-08-14, docs/atlas-gap-2026-08-14.md cause I) ────
// The union-of-crowns note above records the arc's shape: "territorial
// consolidation follows later through the existing org-gated machinery as
// statecraft matures — the same two-act arc as Castile-Aragon → Spain." But
// that second act never existed: VASSAL_SHIELD blocks the erosion lane on
// bonded pairs UNCONDITIONALLY, and no channel converts a whole client court
// into governed territory — so consolidation's product is forever a 4-5-member
// bloc the map (rightly) reads as separate states, and the top realm's share
// of the claimed world FALLS through the very eras history's hegemons owned
// (measured: 38% → 4-6% across 45k at tw=480; Persia/Rome/Abbasids re-enter
// 25-50% again and again). History's discriminator was ADMINISTRATIVE
// CAPACITY: while a crown cannot govern a far country directly, tribute is
// the only way to hold it (the shield's regime — Assyria's early tribute
// ring, the Heptarchy, the princely states); when statecraft matures past
// what the client's seat demands, the client becomes a province (Media under
// Cyrus, Judea AD 6, Pergamon by bequest). So the gate is the absorb
// machinery's own capacity law applied along the bond — org tier, admin
// headroom, direct-rule reach — braked by the same identity and
// balance-of-power laws every peaceful transfer reads, on the submission
// hazard's patience clock. No new constants. The transfer wears the annex
// lane's full paperwork (countryId + recordOccupation + loyalty/grace stamps
// + _countryOwner repaint), so the territory derivation KEEPS the province —
// the failure mode that undid union member-transfer twice (probe_unionhold3)
// was a YOUNG realm's claim budget, and the headroom/org gates are exactly
// what a young suzerain fails. The record ends how:"integrated" with the
// occupation memory written, so the restoration machinery can resurrect the
// old nation in a later crisis — provinces break away, satrapies rebelled.
// Colonies are untouched (their lane is independence/decolonization), and a
// young/foreign/over-tier vassal keeps the shield — the mosaic persists;
// only the aged, governable, kin-eroded bond is finally administered.
function considerIntegrations(world, countries) {
  const ov = world._overlordOf;
  if (!ov || !ov.size) return;
  const probBase = _passProb(SUBMIT_HAZARD);
  const bonds = [...ov.entries()].sort((a, b) => a[0] - b[0]);   // deterministic order
  for (const [sid, hid] of bonds) {
    tel(world, "integrate", "CANDIDATE");
    const S = countries.get(sid), H = countries.get(hid);
    if (!S || !H || !S.capital || !H.capital) { tel(world, "integrate", "noLiveSeat"); continue; }
    const pol = getPolity(world, sid);
    if (!pol || pol._depKind !== "vassal") { tel(world, "integrate", "notAVassalBond"); continue; }
    const fOrg = techEff(H.capital).reachLevel;
    if (fOrg < T.ABSORB_ORG_MIN) { tel(world, "integrate", "orgBelowMin"); continue; }
    if (tierCapForOrg(fOrg) < (S.capital.tier | 0)) { tel(world, "integrate", "seatAboveTierCap"); continue; }
    // Direct rule must REACH the client's seat — tribute ranges SUBMIT_REACH
    // past holdReach precisely because a vassal administers itself; a
    // province does not.
    const d = dist(world, H.capital.pos.x, H.capital.pos.y, S.capital.pos.x, S.capital.pos.y);
    if (d > Math.max(1, H.holdReach)) { tel(world, "integrate", "beyondDirectRule"); continue; }
    let addLoad = 0;
    for (const m of S.members) if (m.mode === "settled") addLoad += estAbsorbLoad(world, H, m);
    if (!hasAbsorbHeadroom(H, addLoad)) { tel(world, "integrate", "noAdminHeadroom"); continue; }
    const r = hash32(world.seed || 1, "satrapize", sid, world.step) / 4294967296;
    if (r > probBase) { tel(world, "integrate", "hazardRoll(waiting)"); continue; }
    // Kin provinces integrate readily, wholly foreign courts resist for
    // generations (never absolutely — the same saturating brake as submission
    // and absorption), and a coalition arrayed against the suzerain props up
    // the client's autonomy (Rome annexed clients when no peer could object).
    const mIdentity = 1 - T.ABSORB_IDENTITY * absorbResistance(H.capital, S.capital, identityWeightsFor(world, H.capital, S.capital));
    const brake = coalitionBrake(world, hid, (world._countryPow && world._countryPow.get(hid)) || 1);
    let prob = probBase * mIdentity;
    prob /= brake;
    if (r > prob) { tel(world, "integrate", mIdentity <= 1 / brake ? "identityBrake(foreignCourt)" : "coalitionBrake(deterrence)"); continue; }
    // ── The act: the client court becomes provinces of the empire ──
    const co = world._countryOwner, owner = world._territoryOwner;
    const tw = world.tw, N = world.N;
    const members = S.members.filter(m => m.mode === "settled" && m.countryId === sid);
    for (const m of members) {
      m.countryId = hid;
      recordOccupation(m, sid, hid, world.step);   // the old nation is remembered — restorable
      m.loyalty = 0.6;
      m._conqueredAt = world.step;                 // integration grace (anti-flicker)
      logEvent(world, "settlement.annexed", { s: m.id, sName: m.name || "a settlement",
        from: sid, fromName: realmName(world, sid), to: hid, toName: realmName(world, hid) });
      if (owner && co) {
        for (let ti = 0; ti < N; ti++) if (owner[ti] === m.id) co[ti] = hid;
        const hti = (m.pos.y | 0) * tw + (((m.pos.x | 0) % tw) + tw) % tw;
        if (world.elev[hti] > 0) co[hti] = hid;
      }
    }
    // The client's marches ride along — the whole country changes flag; the
    // claim crawl repaints ring by ring (no snap: absorption, not secession).
    if (co) for (let ti = 0; ti < N; ti++) if (co[ti] === sid) co[ti] = hid;
    // The chest joins the imperial fisc (the peaceful mirror of conquest seizure).
    const gS = govOf(world, sid), gH = govOf(world, hid);
    if (gS.treasury > 0) { gH.treasury += gS.treasury; gS.treasury = 0; }
    // The client's own dependencies pass to the empire (tribute pyramids
    // flatten one level — the cascade's network-inheritance rule, peacetime).
    if (world.polities) for (const [pid, p] of world.polities) {
      if (p && p._overlord === sid && p.endedStep < 0 && pid !== hid) { p._overlord = hid; ov.set(pid, hid); }
    }
    pol._overlord = undefined; pol._depKind = undefined; ov.delete(sid);
    endPolity(world, sid, "integrated", hid, realmName(world, hid));
    telPass(world, "integrate");
  }
}

// Apply a court's submission — the dependency wiring shared by peacetime overawing
// (considerSubmissions, above) and wartime CAPITULATION (armies.js treaty table):
// mint the record, set the bond, wire the live maps, end the pair's war as a
// peace, and announce it. Returns false if the court is already someone's
// dependency or has no live seat — the caller falls back to an ordinary treaty.
export function bendTheKnee(world, sid, hid, how = "submission") {
  const S = world.countries && world.countries.get(sid);
  if (!S || !S.capital) return false;
  const rec = getOrCreateRecord(world, sid, { seat: S.capital });
  if (!rec || rec._overlord != null) return false;
  rec._overlord = hid;
  rec._depKind = "vassal";                                // a submitted sovereign court, not a planted colony
  // Wire the bond LIVE — rebuildOverlords/updateAlliances only refresh later,
  // and in that window the war pass would read the old world: the suzerain
  // still opening fronts on its fresh tributary, the vassal's power still
  // counted in the coalition AGAINST its own overlord.
  if (world._overlordOf) world._overlordOf.set(sid, hid);
  if (world._allies) {
    let sa = world._allies.get(sid); if (!sa) world._allies.set(sid, sa = new Set()); sa.add(hid);
    let ha = world._allies.get(hid); if (!ha) world._allies.set(hid, ha = new Set()); ha.add(sid);
  }
  const threat = world._allianceTarget;
  if (threat && threat.get(sid) === hid) {
    threat.set(sid, -1);
    if (world._blocMight && world._countryPow) {
      const bm = world._blocMight.get(hid) || 0;
      world._blocMight.set(hid, Math.max(0, bm - (world._countryPow.get(sid) || 0)));
    }
  }
  // Submission IS the peace: any running war between the pair ends in
  // capitulation (its dead are reckoned), and a truce binds the suzerain —
  // a lord who accepts tribute does not sack the payer.
  if (T.TRUCE_TICKS > 0) {
    const truces = world._truces || (world._truces = new Map());
    const key = Math.min(sid, hid) + ":" + Math.max(sid, hid);
    truces.set(key, world.step + T.TRUCE_TICKS / (world._dt || 1));
    if (world._warDead && world._warDead.has(key)) closeWar(world, key, how);
  }
  logEvent(world, "polity.submitted", { polity: sid, name: realmName(world, sid),
    to: hid, toName: realmName(world, hid), how });
  return true;
}

// Connected-landmass labels (4-neighbour flood over elev>0, longitude wraps).
// Elevation is written once at world init (state.js initTerrain) and never
// mutated, so the labels are computed once and cached — deterministic and
// identical after a save/load. Used to decide whether an ARMY can march
// between two seats (same landmass) or only a NAVY can reach them.
function landLabels(world) {
  let lab = world._landLabel;
  if (lab && lab.length === world.N) return lab;
  const { tw, th, N, elev } = world;
  lab = world._landLabel = new Int32Array(N).fill(-1);
  const q = [];
  let next = 0;
  for (let start = 0; start < N; start++) {
    if (lab[start] >= 0 || elev[start] <= 0) continue;
    const id = next++;
    lab[start] = id; q.length = 0; q.push(start);
    while (q.length) {
      const ti = q.pop();
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const ns = [ty * tw + (tx === 0 ? tw - 1 : tx - 1), ty * tw + (tx === tw - 1 ? 0 : tx + 1),
                  ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      for (let k = 0; k < 4; k++) {
        const ni = ns[k];
        if (ni >= 0 && lab[ni] < 0 && elev[ni] > 0) { lab[ni] = id; q.push(ni); }
      }
    }
  }
  return lab;
}

// Balance-of-power brake shared by peaceful absorption and submission: the
// coalition arrayed against a hegemon (updateAlliances → _blocMight) props up
// the statelets it would swallow or overawe. One definition so the two
// consolidation paths can never drift apart — a statelet a coalition protects
// from annexation must not quietly submit as a vassal instead.
function coalitionBrake(world, hegemonId, hegemonPow) {
  if (!world._blocMight) return 1;
  const bm = world._blocMight.get(hegemonId) || 0;
  if (!(bm > 0)) return 1;
  return Math.min(BALANCE_CAP, 1 + BALANCE_W * (bm / Math.max(1, hegemonPow)));
}

// Live overlord map (self-referential links drop; a bond whose overlord is
// absent from the live view is left ON THE RECORD — whether that absence is a
// transient, a succession to follow, or a genuine fall is the REGISTRY's call,
// made by the metropole-fall resolution in updatePolities, never by this
// per-pass view) and the metropole's naval REACH to each colony — how much
// force/supply it can project across the distance, scaled by its
// naval-logistics tech. Governs protection, support and the independence
// line. Called from updatePolities every pass and from loadWorld to warm the
// maps before the post-load alliance rebuild.
export function rebuildOverlords(world, countries) {
  const overlordOf = world._overlordOf = new Map();
  for (const c of countries.values()) {
    const pol = getPolity(world, c.id);
    if (!pol || pol._overlord == null) continue;
    if (pol._overlord === c.id) { pol._overlord = undefined; pol._depKind = undefined; continue; }
    if (!countries.has(pol._overlord)) continue;   // no live overlord this pass: no flows, no severing (see note above)
    overlordOf.set(c.id, pol._overlord);
  }
  const reachOf = world._overlordReach = new Map();
  const tw = world.tw;
  const lab = landLabels(world);
  // Res-scale: NAVAL_REACH_* are REFERENCE-tile radii (calibrated at the 240 grid),
  // but d is a raw map distance — at a finer grid the same ocean is more raw tiles,
  // so an unscaled navalReach projected ~1/resScale the real force: at the shipped
  // 960 grid every colony sat at ~⅓ the projection it was tuned for, starving
  // (supply, tech diffusion ∝ proj) and breaking free at ~14% of metropole power.
  // Same scale (incl. the SIM_HOLD_SCALE A/B env) as holdReach, so BOTH arms of the
  // max(sea, land) below stay in the same units at every grid — see the arm note.
  const navScale = _holdScaleEnv > 0 ? _holdScaleEnv : resScaleFor(tw);
  for (const [dep, over] of overlordOf) {
    const dc = countries.get(dep), oc = countries.get(over);
    if (!dc || !oc || !dc.capital || !oc.capital) { reachOf.set(dep, 0); continue; }
    const d = dist(world, dc.capital.pos.x, dc.capital.pos.y, oc.capital.pos.x, oc.capital.pos.y);
    const nav = (oc.capital.knowledge && oc.capital.knowledge.navigation) || 0;
    const navalReach = (NAVAL_REACH_BASE + nav * NAVAL_REACH_NAV) * navScale;
    // Projection is by whichever ARM reaches: the navy across water (naval
    // reach), or the army over land — which marches out to the overlord's hold
    // reach, the same operational range that let a land VASSAL submit in the
    // first place. Without the land arm, an adjacent vassal's independence was
    // judged by the overlord's NAVY (near-zero pre-sail), so a freshly-submitted
    // statelet sat above the independence line and oscillated submit↔free.
    // The army arm exists ONLY where an army can MARCH — both seats on the same
    // landmass: that gate (not unit games) is what keeps an army from "marching"
    // across open ocean to overseas colonies and silencing the independence arc.
    // Both reaches now carry the SAME resolution scale against the same raw d,
    // so the sea-arm : land-arm balance is a resolution-invariant ratio — the
    // old imbalance (res-scaled hold vs raw naval) cannot re-emerge at any grid.
    const seaProj = navalReach / (navalReach + d);
    const oTi = (oc.capital.pos.y | 0) * tw + (oc.capital.pos.x | 0);
    const dTi = (dc.capital.pos.y | 0) * tw + (dc.capital.pos.x | 0);
    const sameLand = lab[oTi] >= 0 && lab[oTi] === lab[dTi];
    const hold = Math.max(1, oc.holdReach);
    const landProj = sameLand ? hold / (hold + d) : 0;
    reachOf.set(dep, Math.max(seaProj, landProj));
  }
  return { overlordOf, reachOf };
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
function hasAbsorbHeadroom(c, extra = 0) {
  if (!c) return false;
  const cap = c._capacity, load = c._loadTotal;
  if (cap == null || load == null) return true;        // no budget data yet → allow
  return load + extra < cap * ABSORB_HEADROOM;
}

// Cheap estimate of the admin load a freshly-absorbed province adds to a realm
// — euclidean distance / reach (the same calibration the full load uses: a
// province at the capital's reach costs ~1), floored so an adjacent village is
// never free. Used only to charge in-pass absorptions against the headroom gate
// above; the real load is recomputed from scratch next polity pass.
function estAbsorbLoad(world, c, m) {
  const cap = c.capital; if (!cap) return 1;
  const eucl = dist(world, cap.pos.x, cap.pos.y, m.pos.x, m.pos.y);
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
  const RES_WANT_MIN = 0.5;   // price-gap below which a neighbour's cheap good isn't worth leaning on (casual edges aren't casus belli)
  fieldPowerOverlay(world, countries, countryPower);   // POW_FIELD: dominance is over governed people
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
      // THE BOND IS THE ARRANGEMENT (T.VASSAL_SHIELD): the suzerain-vassal bond
      // already stops ARMIES (armies.js bondedCC gates every front) — but not
      // this channel, so an overlord quietly digested the very statelets whose
      // submission it accepted, and the vassal mosaic (tributaries, princely
      // states, the Empire's members — history's largest store of persistent
      // SMALL polities) could never accumulate. A lord who accepts tribute
      // neither sacks nor annexes the payer; the pull of every UNBONDED realm
      // is untouched, and the bond itself still dissolves through the existing
      // channels (overlord death, rebellion, rebuildOverlords lapses).
      if (T.VASSAL_SHIELD) {
        const ov = world._overlordOf;
        if (ov && (ov.get(myCC) === ncc || ov.get(ncc) === myCC)) continue;
      }
      const F = countries.get(ncc); if (!F || !F.capital) continue;   // a realm mid-collapse can have no capital this pass
      const fOrg = techEff(F.capital).reachLevel;   // foreign realm's statecraft, from its admin techs (reachLevel tracks org)
      if (fOrg < T.ABSORB_ORG_MIN) continue;
      if (myTier > tierCapForOrg(fOrg)) {
        // ...UNLESS F overwhelmingly out-powers m's WHOLE country: brute force takes a
        // developed neighbour's land too (a hegemon conquers what it cannot slowly
        // administer), so great powers consolidate even ADVANCED statelets late game
        // instead of leaving a sea of untouchable city-states. Army/power → land.
        if ((countryPower.get(ncc) || 1) < myCountryPow * T.ABSORB_FORCE) continue;
      }
      if ((countryPower.get(F.id) || 1) < myCountryPow * T.ABSORB_DOMINANCE) continue;  // not dominant enough
      const orgFactor = Math.min(1, (fOrg - T.ABSORB_ORG_MIN) / (1 - T.ABSORB_ORG_MIN));
      // Resource hunger (T.RESOURCE_WARS): the empire leans HARDER on the
      // neighbour holding what it lacks — each shippable good the border
      // settlement has CHEAP while F's capital finds it DEAR (a real
      // scarcity gap, ≥ RES_WANT_MIN price-points, not a casual edge) adds
      // pull. The Ruhr, the tin coasts, the grain shores: acquisitive
      // pressure pointed by the price map, biasing WHICH neighbours a
      // dominant realm erodes — never creating dominance it doesn't have
      // (all the power/org/headroom gates above still rule).
      let hunger = 1;
      if (T.RESOURCE_WARS > 0 && F.capital._gPrice && m._gPrice) {
        const Pf = F.capital._gPrice, Pm = m._gPrice;
        let want = 0;
        for (const g of TRADABLE) want += Math.max(0, Pf[g] - Pm[g] - RES_WANT_MIN);
        if (want > 0) hunger = 1 + T.RESOURCE_WARS * Math.min(2, want);
      }
      let perCc = perSett.get(m.id);
      if (!perCc) { perCc = new Map(); perSett.set(m.id, perCc); }
      perCc.set(F.id, (perCc.get(F.id) || 0) + settlementPower(F.capital) * orgFactor * hunger);
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
    if (!hasAbsorbHeadroom(target, committed)) continue;
    const myPower = Math.max(1, settlementPower(m));
    // Defection chance per polity pass — caps at T.ABSORB_PROB_MAX. (Hopelessly
    // outmatched STATELETS are consolidated by the submission/vassalage pass in
    // updatePolities, not by over-extending past the admin budget here.)
    const ratio = bestScore / myPower;
    let prob = Math.min(T.ABSORB_PROB_MAX, ratio * T.ABSORB_RATE);
    // CULTURAL RESISTANCE: a city of the absorber's OWN people/tongue/faith slides
    // into its orbit (building a national core); a foreign one clings to independence
    // and must be taken by direct CONQUEST (armies.js) instead of peacefully defecting.
    // This is what stops one realm engulfing every neighbour it out-powers across two
    // dozen cultures — realms coalesce into culturally-coherent nation-states.
    // Era-weighted (cohesion.js), so antiquity still permits multi-ethnic
    // empires and the national age fractures them — emergent, never time-gated.
    if (T.ABSORB_IDENTITY > 0 && target && target.capital) {
      // Salience from the two parties actually meeting (cohesion.js): the
      // absorber's court and the absorbed community.
      prob *= 1 - T.ABSORB_IDENTITY * absorbResistance(target.capital, m, identityWeightsFor(world, target.capital, m));
    }
    // BALANCE OF POWER caps a hegemon's PEACEFUL growth too, not just its wars. If a
    // coalition is arrayed against the absorber (updateAlliances → _blocMight: the Σ
    // power of every realm balancing against it), the statelets it would swallow are
    // propped up by that coalition — allied, subsidised, their independence guaranteed
    // — and resist joining its orbit. This is the SAME deterrence armies.js applies to
    // the hegemon's attacks (BALANCE_W / BALANCE_CAP), now also throttling absorption:
    // without it a would-be continental hegemon simply vacuumed up the connected
    // mainland (Europe → one nation) because peaceful absorption had no anti-hegemon
    // check at all, while nationalism stays near-silent for most of history. A realm no
    // one balances against — an isolated power facing only empty frontier or a
    // fragmented far-weaker pack — is unaffected and still consolidates (Russia into
    // Siberia). Emergent: the brake is the coalition's strength relative to the hegemon,
    // whatever the map makes it — never a size cap or a geography constant.
    if (world._countryPow) prob /= coalitionBrake(world, bestId, world._countryPow.get(bestId) || 1);
    // DEFENSIBLE GROUND resists the pull (T.REFUGE): peaceful absorption is the
    // shadow of coercion — "join the orbit or be taken" — and that shadow
    // attenuates over the same river-moat/high-ground/ridge walls that stall the
    // war pass (transport.js terrainHoldAt: one definition, engineering-eroded,
    // capped). A community behind real walls of rock keeps its independence for
    // as long as the ground holds; the mountain mosaics and moat cities history
    // actually kept are exactly this. ÷1 at lever 0.
    if (T.REFUGE > 0) prob /= refugeHoldAt(world, (m.pos.y | 0) * tw + (m.pos.x | 0), (m.knowledge && m.knowledge.construction) || 0);
    // Deterministic per-(seed, settlement, step) roll via the shared avalanche
    // hash. Unlike the old linear-congruential hash it varies with the WORLD SEED
    // (defections used to be identical across every seed) and doesn't correlate
    // consecutive ids (which made runs of neighbouring villages flip in lockstep).
    const r = hash32(world.seed || 1, "absorbDefect", m.id, world.step) / 4294967296;
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
    // FIELD-FOLLOW (TILE_POLITY): under capital-only anchoring a settlement's countryId
    // is DERIVED from the ground each pass, so flipping only m.countryId is reverted by
    // the next adoptAndFound (and a solo realm's absorbed capital is even stranded into
    // statelessness). Move the POLITICAL FIELD too — stamp m's worked region into
    // _countryOwner for its new realm — so the annexation actually TRANSFERS territory,
    // exactly as war (owner[cti]=att.id) and secession do. Bounded to m's own catchment,
    // which borders the absorber by construction, so the connectivity flood keeps it.
    if (T.TILE_POLITY && co) {
      for (let ti = 0; ti < N; ti++) if (owner[ti] === m.id) co[ti] = bestId;
      const hti = (m.pos.y | 0) * tw + (((m.pos.x | 0) % tw) + tw) % tw;
      if (world.elev[hti] > 0) co[hti] = bestId;
    }
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
  fieldPowerOverlay(world, countries, cPow);   // POW_FIELD: the annexation gate weighs governed people
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
    let regionHasCity = false, citySeatHold = 1;
    for (const ti of region) {
      const o = owner[ti]; if (o < 0) continue;
      const s = byId.get(o); if (!s || (s.tier | 0) < 2) continue;
      regionHasCity = true;
      // The engulfed city's own ground (T.REFUGE): a mountain-pocket or moat seat
      // raises the power dominance an engulfing realm needs before the pocket is
      // peacefully annexed — the enclave gate's own comment names Andorra and San
      // Marino as exactly what it was wrongly vacuuming. ×1 at lever 0.
      if (T.REFUGE > 0) {
        const h = refugeHoldAt(world, (s.pos.y | 0) * tw + (s.pos.x | 0), (s.knowledge && s.knowledge.construction) || 0);
        if (h > citySeatHold) citySeatHold = h;
      }
      if (!(T.REFUGE > 0)) break;   // no hold to compare — first city settles it (pre-lever scan order)
    }
    let needFrac = ENCLAVE_DOMINANCE;
    if (regionHasCity) {
      // City-state: needs FULL enclosure, UNLESS a much stronger realm deeply
      // engulfs it (then it's peacefully annexed — see CITY_ENCLAVE_* note).
      const domPow = cPow.get(intoId) || 0, selfP = cPow.get(selfCC) ?? Infinity;
      needFrac = (!_cityEnclaveOff && domPow >= selfP * CITY_ENCLAVE_POWER * citySeatHold) ? CITY_ENCLAVE_DOMINANCE : 1.0;
    }
    if (bestBord < totBord * needFrac) continue;    // no realm clearly surrounds it → leave it
    const into = countries.get(intoId);
    if (!into) continue;
    // T.VASSAL_SHIELD: an enclave that is the surrounder's own VASSAL (or its
    // suzerain — the Empire ringed by a mighty tributary) is not vacuumed: the
    // bond is the arrangement, exactly as in war and absorption. This is the
    // Andorra/San Marino configuration BY NAME in the gate's own history —
    // a statelet fully inside a great power, persisting because the
    // relationship is settled, not because the geometry is unfinished.
    if (T.VASSAL_SHIELD && selfCC >= 0) {
      const ov = world._overlordOf;
      if (ov && (ov.get(selfCC) === intoId || ov.get(intoId) === selfCC)) continue;
    }
    // STATECRAFT + CAPACITY gate — the same bars every other peaceful-transfer
    // channel pays (absorbWeakNeighbors): swallowing an engulfed community is an
    // act of ADMINISTRATION, not geometry. Ungated, this was the largest single
    // consolidation channel (measured: cradle realms at org 0.26-0.40 — BELOW
    // T.ABSORB_ORG_MIN — logging 30-41 enclave annexations apiece), and the new
    // ridge-relief walls made it worse: every mountain-pocket statelet pinched
    // between a realm's marches and a range read as an "enclave" and was vacuumed.
    // Historically those pockets are precisely where enclave statelets SURVIVE
    // (Andorra, San Marino — both alive today inside their surrounders). A realm
    // below the absorption bar, or already at its administrative budget, leaves
    // the pocket be; it persists until a QUALIFIED administration reaches it (or
    // it is taken by armies, which this never gated).
    if (!into.capital || (techEff(into.capital).reachLevel || 0) < T.ABSORB_ORG_MIN) continue;
    if (!hasAbsorbHeadroom(into)) continue;
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
        const oldCC = s.countryId;
        s.countryId = intoId;
        s.loyalty = 0.6;
        s._conqueredAt = world.step;
        // Same bookkeeping as every other transfer channel: occupation
        // memory (homeland identity, restoration claims) and the event log.
        // An enclave swallowed silently left no trace in any chronicle and
        // its people forgot their homeland instantly.
        recordOccupation(s, oldCC, intoId, world.step);
        logEvent(world, "settlement.annexed", { s: s.id, sName: s.name || "a settlement",
          from: oldCC, fromName: oldCC >= 0 ? realmName(world, oldCC) : undefined,
          to: intoId, toName: realmName(world, intoId),
          x: s.pos.x | 0, y: s.pos.y | 0 });
      }
    }
  }
}
