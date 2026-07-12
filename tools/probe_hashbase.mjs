// Byte-identity guard for any settlement/persist change: run fixed seeds a fixed
// number of steps and print the full-state hash. Capture at baseline, compare
// after each change — identical hash ⇒ byte-identical trajectory (stronger than
// the smoke determinism check, which only compares run-to-run on the same code).
// NB: the hash DEFINITION itself changes when hashWorld's field set changes, so a
// baseline is only comparable within one hashWorld version.
//   node tools/probe_hashbase.mjs [steps]
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
