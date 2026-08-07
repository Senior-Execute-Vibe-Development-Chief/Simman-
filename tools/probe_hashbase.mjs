// Byte-identity guard for any settlement/persist change: run fixed seeds a fixed
// number of steps and print the full-state hash. Capture at baseline, compare
// after each change — identical hash ⇒ byte-identical trajectory (stronger than
// the smoke determinism check, which only compares run-to-run on the same code).
// NB: the hash DEFINITION itself changes when hashWorld's field set changes, so a
// baseline is only comparable within one hashWorld version.
//   node tools/probe_hashbase.mjs [steps]
// NB (branch consolidation 2026-07): the empire-consolidation line (SIZE_BY_POP,
// MUSTER_FIELD/PROV_FIELD/BIRTH_FIELD, …) and the one-population line (DEV_FIELD,
// FIELD_DEMOG, ONE_POP + URBAN_AGGLOM/URBAN_GAMMA) were merged — BOTH default-on
// now, a combination neither history below was captured under. The current baseline
// MUST be recaptured on the merged build; the two blocks below are each line's
// pre-merge anchor, kept for provenance (reset either line via the SIM_TUNE in its
// entry).
// ── empire-consolidation line (pre-merge anchor) ──
// Identity Stage 2 (T.TILE_IDENTITY, default 0 — the sticky per-tile culture
// layer + irredentist/rural-cohesion consumers) is byte-TRANSPARENT off: this
// pair AND the 480 reference pair verified unchanged with the code in. The
// lever-on functional gate is tools/probe_identity2.mjs (ghost identity,
// countryside stamps, v4 top-2 roundtrip).
// Current baseline (2500 steps): 4a9e8680/85bbdbc4 (the hearth-maturity suit
// clamp DROPPED — rich land legitimately accelerates domestication below the
// package's nominal lag; the min(1,·) clamp made every rich rice hearth mature
// at exactly domLagY, a measured synchrony artifact. Same-commit family as the
// lane flip below; genesis re-keys, so every stream moves.)
// Prior baseline (2500 steps): b19c2674/1994cbe9 (the DIVERGENCE LANE flipped
// on — GROW_SEASON, CROP_PHOTOPERIOD, CRADLE_PACKAGE, INVENT_STAGGER, 2026-08:
// growing-season agronomy, photoperiod-bound early maize, package-read cradle
// placement, and package-lag hearth maturation (domLagY). Genesis AND live
// agronomy both re-key, so every stream moves. SIM_TUNE="GROW_SEASON=0,
// CROP_PHOTOPERIOD=0,CRADLE_PACKAGE=0,INVENT_STAGGER=0" recovers the prior
// pair f3c02ff0/c4ce3177 exactly — which was itself byte-identical through the
// shape wave's lever additions (PEER_POLITY/REFUGE/VASSAL_SHIELD/GROW_STATECRAFT
// at their pre-flip 0s; docs/shape-of-the-map-2026-08.md).)
// Prior baseline (2500 steps): b988776a/e58bdc35 (SPAN_TECH flipped 0→0.85 —
// the administrative span is EARNED by statecraft; stone-age paint shrinks to
// its org, the mature ruler unchanged. docs/budget-gated-expansion.md addendum
// 5. SIM_TUNE="SPAN_TECH=0" recovers the pair below.)
// Prior baseline (2500 steps): 4a956f14/2a8e6fce (CRADLE_EVE flipped 1→0 —
// the eve-of-states head start REMOVED: cradles seed as natural villages and the
// first kingdoms EMERGE ~5.2k steps later; the genesis balloon gone at its root.
// docs/budget-gated-expansion.md addendum 3. SIM_TUNE="CRADLE_EVE=1" recovers
// the pair below exactly.)
// Prior baseline (2500 steps): e5d6ac69/9b014b38 (FAITH_FRONTIER flipped 0→1 —
// cross-family conversion discount + established-church suppression of rival
// missions; the faith monoculture fix, docs/history-shape-audit-2026-07.md §2.
// SIM_TUNE="FAITH_FRONTIER=0" recovers the pair below for bisection.)
// Prior baseline (2500 steps): 7b5d5861/473a336c (history-shape audit 2026-07:
// TWO deliberate default changes moved genesis + trajectory together — the Indus
// joins EARTH_HEARTH_SITES (a fourth cradle exists from tick 0, so every earth
// stream re-keys) and COLLAPSE_SCAR flipped 0→0.7 (state sundering scars the
// dying realm's organization technique; docs/history-shape-audit-2026-07.md).
// SIM_TUNE="COLLAPSE_SCAR=0" isolates the hearth-only world for bisection.)
// Prior baseline (2500 steps): a264fb6c/bd4b8f36 (SIZE_BY_POP flipped DEFAULT
// 0→1 — realm size = governed-people core (smoothed+persisted popCapK anchor) +
// logistics march, replacing the COVER_BASE/COVER_ORG floor so realms smaller
// than Egypt exist and coverage rises with development; docs/empire-consolidation-
// 2026-07.md "THE MINIMUM-EGYPT FIX". SIM_TUNE="SIZE_BY_POP=0" recovers the prior
// pair below EXACTLY. The 480 reference pair ALSO moved (6c46c2d1/9262bb95) — a
// deliberate default behaviour change, the first to move the reference guard.)
// Prior baseline (2500 steps): f9eb7306/8d66ed8d (the rs=4 arc part 2,
// 2026-07: sub-stepped POP_MIGRATE — total migration share ×rn² per firing,
// substeps ≤ MIG_SHARE_MAX. On this sub-reference 320 grid the share DROPS
// (0.06→0.0267: its D was 2.25× too fast in real units), re-keying the
// stream. Shipped SECOND, after the road-wiring fix below — the same patch
// A/B'd HARMFUL on the unwired world and census +22% on the wired one
// (docs/empire-consolidation-2026-07.md "THE rs=4 ARC" §1/§3b). The 480
// reference pair is UNCHANGED (b9c264b9/100239cd, bit-exact n=1 there).)
// Prior baseline (2500 steps): 85674ac7/2db3bf8 (the rs=4 arc, 2026-07:
// the trade-WIRING radii are real distances — CLOSE_NEIGHBOUR_DIST and
// partnerReachFor ×rNormPop (roads.js), NUCLEATE_R/NUCLEATE_CAP_DIST
// ×resScaleFor (countryTerritory.js). This 320 grid sits BELOW the reference
// (rn≈0.67) so its wiring radii TIGHTEN (20→13.3 etc.) and the stream re-keys;
// the 480 reference pair is UNCHANGED (b9c264b9/100239cd, verified across
// every increment — the factors are ×1.0 exactly there).)
// Prior baseline (2500 steps): 36e38967/f57f0ddd (development-clock
// res-invariance, 2026-07: popField cap/seed are per REAL area (÷rNormPop²),
// and the remaining unscaled cumulative-cost thresholds ride the grid —
// DIFFUSE_COST_K, trade freight, reach/pathfind search budgets, the admin-flood
// search bound (now sharing holdReach's scale). This probe's 320 grid sits
// BELOW the reference (rn≈0.67) so the factors re-key it — its previously
// UNDER-populated field (0.44× the reference level) now matches the reference,
// and its diffusion/freight scales tightened to match its cheaper raw costs.
// The 480 grid (tw=240 = the reference) is BYTE-IDENTICAL by construction
// (verified b9c264b9/100239cd pre AND post, 2500 steps, seeds 8817/31337) —
// every ×/÷ factor is exactly 1 there, so all documented 480 numbers stand.
// There is NO lever: like the audit's war-rate/gap-fill fixes, correctness at
// non-reference grids is not opt-in; the reference is the invariant.
// docs/empire-consolidation-2026-07.md "RES-INVARIANCE ARC".)
// Prior baseline (2500 steps): fcb58415/2fc112a5 — same pair as the cities-only
// purge below: ORG_APT_CAP was WIRED into the field capacity (the dead payout
// finally fires) but then measured at 0.15 AND 0.4 to fatten the biggest realm
// ~+50% (a rich-get-richer multiplier), so it ships DEFAULT 0 (opt-in variance,
// the CAP_GEO precedent) — aptMul ×1 exactly, so defaults stay on the prior
// trajectory. ORG_APT_CAP=0.4 gives fcb58415/7e78c085 (8817 unchanged at this
// horizon — no capital aptitude accrues by 2500). ALLY_FRONT (defensive-only
// coalition relief) at default 0 — byte-transparent off.
// Prior baseline (2500 steps): fcb58415/2fc112a5 (cities-only census purge —
// MUSTER_FIELD/PROV_FIELD/BIRTH_FIELD default ON: manpower from governed popField,
// the admin-load ledger reads each province's governed catchment people, frontier
// states are born of the stateless basin's popField mass; anchors persisted;
// docs/settlement-ontology.md STATUS UPDATE + docs/audit-2026-07.md).
// SIM_TUNE="MUSTER_FIELD=0,PROV_FIELD=0,BIRTH_FIELD=0" recovers the prior pair
// below EXACTLY.
// Prior baseline (2500 steps): 341a3443/c9e04c68 (audit 2026-07 fixes: war-sack
// captives land on the victor's real capital instead of the throwaway TILE_WAR
// adapter — war supplies slaves again and the stormed-city population leak is
// closed; adapters carry army-weighted _nomad; war capture budget/momentum and
// REALM_GAP_FILL/MARKET_RANGE are resolution-invariant (×resScale²/×resScale/×rn).
// This probe's 320px grid sits BELOW the 240-tile reference (rn≈0.67), so the
// invariance factors re-key it; the 480px probe grid IS the reference (×1 exactly)
// and its windowed numbers are unchanged by the F-class fixes. docs/audit-2026-07.md.)
// Prior baseline (2500 steps): e2f4dd54/6cb39c4d (WAR_REACH 15 default — war
// force projection decays exp(−d/H) from the capital, the immortal-giants fix;
// docs/empire-consolidation-2026-07.md). SIM_TUNE="WAR_REACH=0" recovers the
// prior pair below EXACTLY (the projection-blind war, one lever away).
// Prior baseline (2500 steps): d8fc9f8f/bab1ad19 (comboE empire-consolidation
// defaults — FIELD_SPAN 6, COVER_ORG 260, EXPAND_RATE 8, REGION_SPACING 1.0, with
// COVER_BASE/COVER_ORG newly exposed as live levers;
// docs/empire-consolidation-2026-07.md). The exposure itself is byte-TRANSPARENT:
// SIM_TUNE="FIELD_SPAN=12,COVER_ORG=150,EXPAND_RATE=1.5,REGION_SPACING=1.2"
// recovers the prior pair below EXACTLY (same hash stream — the flip is purely the
// four values), and setting COVER_ORG=260 via SIM_TUNE vs via the legacy
// SIM_COVER_ORG env gives the SAME pair (d6eeee6e/d449827a on the pre-flip build) —
// lever path ≡ env path.
// ── one-population line (pre-merge anchor) ──
// Current baseline (2500 steps): 55e75b44/e7a0d06f (one population slice B —
// ONE_POP + URBAN_AGGLOM 0.13 + URBAN_GAMMA 0.5 defaults: the city is a
// concentration of the field, its size↔economy Zipf slope grounded in the
// density-graded urban graveyard (excess mortality rises ∝ coreDensity^γ, so
// equilibrium size is sublinear in economy). The urban spikes, the agglomeration
// concentration flow and the persisted _onePopScale re-key the stream. Setting
// ONE_POP=0 (or URBAN_AGGLOM=0) recovers the pre-flip lever-off world
// f925a9f/fd5cb49c in TRAJECTORY — proven byte-exact by THIS probe. NB the older
// 3d0683ae/8dfe387d pair below predates slice B's _onePopScale hashing and is
// STALE; f925a9f/fd5cb49c is the live lever-off anchor.
// Prior baseline (2500 steps): 3d0683ae/8dfe387d (one population slice A —
// FIELD_DEMOG default: demographic events mirror onto the popField; also
// hashes popField itself (R1 hygiene: it was persisted-but-unhashed), so the
// stream is re-keyed). FIELD_DEMOG=0 recovers the DEV_FIELD world 34a5023
// (6add39d2/edc95670) in TRAJECTORY — proven byte-exact by full-serialize
// sha256 diff.
// Prior baseline (2500 steps): 6add39d2/edc95670 (regional development —
// DEV_FIELD default: popField capacity reads the LOCAL technique via the
// Neolithic wave of advance + the pastoral rangeland term; hashes devField +
// the wave clock, so the stream is re-keyed). DEV_FIELD=0 recovers the
// ontology-V2 world 9a3dd8c (83ccc922/574e8595) in TRAJECTORY — proven
// byte-exact by full-serialize sha256 (a7169bb0/51824730 both builds).
// Prior baseline (2500 steps): 83ccc922/574e8595 (ontology V2 — LOYAL_FIELD
// + GRIEV_LEDGER defaults: tile homeland memory, the attachment continuum,
// the nation-pair grievance ledger; hashes the field + ledger + scan clock,
// so the stream is re-keyed). LOYAL_FIELD=0,GRIEV_LEDGER=0 gives
// bc3c6d97/e31009f7 — proven ≡ the hegemonic-stagnation world 86b86bd
// (1c2e5537/a5c52317) in TRAJECTORY by full-serialize sha256 diff
// (febc68db/82cf55df both builds, modulo the registered-but-empty natGriev
// table key).
// Prior baseline (2500 steps): 1c2e5537/a5c52317 (hegemonic stagnation —
// PEER_COMPETE + HEGEMONY_STAG 0.75 defaults; also hashes _hegF/_peerPeak, so
// the stream is re-keyed). PEER_COMPETE=0,HEGEMONY_STAG=0 recovers the 3000 BC
// world d206d81 in TRAJECTORY (proven by state-digest diff — the hash pair
// itself re-keyed with the new hashed fields).
// Older baseline (2500 steps): 17836a8b/c446da26 (the 3000 BC start — the
// eve-of-states genesis seed + SCI_COMPOUND_FLOOR 0.7 antiquity rate). A GENESIS
// change re-keys every trajectory from step 0, so all prior lever-off recovery
// pairs below are ARCHIVED history (they described the stone-age-seed world);
// lever A/Bs from here compare against THIS pair.
// Pre-3000BC baseline (2500 steps): d1a9bd55/4d779574 (LATIFUNDIA + SLAVE_PULL
// defaults — the classical demand engine + the price-responsive slave market
// with the stateless-frontier razzia guard).
// LATIFUNDIA=0,SLAVE_PULL=0 gives e38f1de/b17ee7b2 — NOT the pre-wave pair below,
// because hashing `_estates` re-keyed the hash STREAM (the NB above); the lever-off
// TRAJECTORY was proven identical to e84780f both by a 2500-step state-digest diff
// and by a line-identical 42k probe_latifundia run against the pre-wave build.
// Pre-latifundia baseline (2500 steps, old hash stream): 692c38be/2532b712
// (SCI_COMPOUND 1.5 + LABOR_INNOV 0.6 defaults — the chronology repacing;
// LABOR_INNOV=0 gives 1c56993f/eeff4048, SCI_COMPOUND=0 recovers the pre-chronology
// f4530e0a/18235178).
// Older baseline (2500 steps, RES_INVARIANT_POP default ON — this probe grid is 320-pixel/tw160, rNorm 0.67):
//   8817=d3acad98  31337=ffeab697   (REACTIVE-SETTLEMENT model, TILE_POLITY + CATCHMENT_CLIP
//   default ON — settlements are reactionary to the political map: only the CAPITAL anchors a
//   border, and the economic catchment is clipped to the tiles its country already holds, so a
//   settlement never creates or moves a border. TILE_POLITY=0 + CATCHMENT_CLIP=0 recovers the
//   prior FIELD-SIMULATION default byte-identically: 8817=809cfa67 31337=8da625d2 — that hash is
//   now the lever-off baseline (people on a per-tile population field, territory grown by governed
//   capacity from member cores; POP_FIELD=0 under it recovers the pre-field settlement model
//   8817=ed576254 31337=92744c20). Under POP_FIELD=0, FIELD_POLITY=0 further recovers the ENTITY model
//   7a3afd73/7e8d33f. Prior default
//   (REGION_SPACING 1.2, entity model) was 7a3afd73/7e8d33f; RES_INVARIANT_POP=0 under it
//   478cd406/827e1f09. Earlier: 8a3eca3c/2a354abf (ridge relief); 38a440bb/53cd01ed
//   (empire mortality); 22b292be/53cd01ed (statecraft symmetry); f2b5211b/2f83e5c5
//   (real-width floodplain ribbon); 316e19ea/9d292e22 (ribbon rescale).)
//   (CAP_MODEL=0 recovers the legacy fitted-tail baseline 6df86092/82c7f3f — the grounded
//   capacity model is the first change to move THIS 2500-step guard, since real states
//   extract revenue and differentiate in capacity well before dynasties form. Earlier
//   hashWorld field sets: 20b4f37e/43c73b01 pre-registry-hashing, 11ad8765/27063acb pre-hardening.)
// NB: at 2500 steps the kin graph is still EMPTY — for dynasty-bearing coverage use
// tools/probe_roundtrip_deep.mjs (8000 steps). The W6-F dynastic levers (CROSS_REALM_HEIRS /
// CLAIMANT_WARS) do not fire here, so their flip left this guard unchanged; CAP_MODEL does.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { hashWorld } from "../src/sim/persist.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "2500", 10);
const SEEDS = [8817, 31337];
const W = 320, H = 160;
// Env-overridable levers (unset = defaults): CAP_MODEL=0 recovers the fitted-tail baseline.
for (const k of ["CROSS_REALM_HEIRS", "CLAIMANT_WARS", "CLAIM_POWER_WIN", "CAP_MODEL", "CAP_FISC", "CAP_LOG", "RES_INVARIANT_POP", "LOYAL_FIELD", "GRIEV_LEDGER", "DEV_FIELD", "FIELD_DEMOG", "ONE_POP", "URBAN_AGGLOM", "URBAN_GAMMA"]) if (process.env[k] != null) T[k] = +process.env[k];
for (const seed of SEEDS) {
  const world = buildSim({ W, H, seed });
  stepPeopleSim(world, STEPS);
  console.log(`seed=${seed} steps=${STEPS}  hash=${hashWorld(world)}`);
}
