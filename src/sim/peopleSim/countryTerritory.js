// ── Country territory: one clean per-country cost-Voronoi ────────────
//
// world._countryOwner — countryId per tile (-1 = wilderness / water). THE
// political map, and it is a single clean partition by construction: every land
// tile is assigned to the NEAREST COUNTRY by travel cost (multi-source Dijkstra
// seeded from that country's settlements), out to a per-country reach budget set
// by organisation. Tiles beyond every country's reach stay wilderness. This is
// the Transport-Test border the design is built on — clean borders, no flecks,
// because it's one partition, not a union of per-settlement patches.
//
// SOVEREIGNTY vs POPULATION are now separate layers:
//   • Population — settlements (villages / towns / cities). There can be MANY;
//     they carry the economy (food/trade/pop via territory.js owner[]).
//   • Sovereignty — countries. A village is NEVER its own country: it ADOPTS the
//     country of the tile it sits on (adoptAndFound). Only a CITY anchors a
//     country, and new countries appear only from a city founding in wilderness
//     or from secession (conquest.js). So the political map stays clean however
//     many villages spawn.
//
// The rendered border (countryClaim.js relaxClaim) crawls toward _countryOwner,
// so land changes animate tile-by-tile.

import { localEdgeCost } from "./transport.js";
import { forEachNear } from "./spatialGrid.js";
import { grownLiveOwnerAt } from "./countryClaim.js";
import { ensurePolity } from "./entities.js";
import { settlementPower } from "./conquest.js";
import { T } from "./tuning.js";
import { claimHostility } from "./habitability.js";

// Per-country reach (transport-cost) projected from its settlements: a country
// claims land out to COUNTRY_REACH_BASE + capital-organisation × COUNTRY_REACH_ORG
// of travel cost from its nearest settlement. Org-scaled, so primitive realms
// stay compact (the early map fragments into small city-states with wilderness
// between) and high-org empires reach far (consolidation with the era). Beyond
// it, land is wilderness — which is where stateless frontier hamlets live.
const _envNum = (k, d) => (typeof process !== "undefined" && process.env && +process.env[k]) || d;
// Force-override variant for env vars that shadow a LIVE LEVER: an explicitly-set env
// (including "0") returns its number and wins over the T.* lever; unset/garbage returns
// NaN and defers to the lever. (_envNum can't express an explicit 0 — `+  "0" || d` → d.)
const _envForce = (k) => { const v = typeof process !== "undefined" && process.env ? process.env[k] : undefined; return v != null && v !== "" ? +v : NaN; };
// Persistent-territory master switch: the T lever (live-tunable) OR the SIM_PERSIST_TERR
// env (for headless A/B — mirrors the SIM_* override pattern used throughout this file).
// SIM_PERSIST_TERR=1 forces ON, =0 forces OFF, unset defers to the lever.
const _persistEnv = (typeof process !== "undefined" && process.env && process.env.SIM_PERSIST_TERR) || "";
function persistentTerritoryOn() {
  if (_persistEnv === "1") return true;
  if (_persistEnv === "0") return false;
  return T.PERSISTENT_TERRITORY > 0;
}
// Admin-distance master switch (T.FIELD_ADMIN lever / SIM_FIELD_ADMIN env for headless A/B):
// under the field polity, price territory in ADMINISTRATION units (load = 1 + d/ADMIN_HALF,
// d = travel cost from the realm's nearest seat) instead of flat tiles. See fieldPolityTerritory.
const _fieldAdminEnv = (typeof process !== "undefined" && process.env && process.env.SIM_FIELD_ADMIN) || "";
function fieldAdminOn() {
  if (_fieldAdminEnv === "1") return true;
  if (_fieldAdminEnv === "0") return false;
  return T.FIELD_ADMIN > 0;
}
// Naval-administration master switch (T.FIELD_NAVAL lever / SIM_FIELD_NAVAL env for headless
// A/B): the admin-distance walk and the frontier growth may TRAVERSE (never claim) water at
// the nav-gated sail cost, bounded per crossing by the navigation excursion budget below.
// Requires FIELD_ADMIN: traversal is priced through cumulative distance, and the lever-off
// BFS connectivity would maroon (release) every across-water march the growth claimed — so
// without the admin walk this lever is inert rather than self-contradictory.
const _fieldNavalEnv = (typeof process !== "undefined" && process.env && process.env.SIM_FIELD_NAVAL) || "";
function fieldNavalOn() {
  if (_fieldNavalEnv === "1") return true;
  if (_fieldNavalEnv === "0") return false;
  return T.FIELD_NAVAL > 0;
}
// Excursion budget: the most CONSECUTIVE water tiles one crossing may bridge, per realm —
// none below the seafaring floor (the same T.NAV_EMBARK_THRESH that gates water in the
// transport cost field, so traversal and pricing agree on who can put to sea), a strait's
// width at coastal seafaring, a small sea for an ocean-going power. Ported intact from the
// legacy merge's naval contiguity (see mergePersistentTerritory below) — same physical
// meaning, resolution-scaled like every reach quantity. Beyond bounding WHO crosses WHAT,
// it bounds the walk itself to the coastal fringe (never O(countries × ocean)).
const NAVAL_HOP_PER_NAV = 7;
// Units recalibration for the extent constants under FIELD_ADMIN: FIELD_SPAN and the
// coverage floor were calibrated in TILES (flat model); under load pricing every tile
// costs ≥1 load (measured mid-game average ≈ 1.18 at the validate grid), so the
// unchanged constants would silently shrink every realm by that factor. This re-expresses
// the SAME calibration per load unit — the pricing changes WHERE capacity is spent
// (near, cheap land over remote, harsh land), not how much it administers on average.
const ADMIN_LOAD_RECAL = 1.18;
const COUNTRY_REACH_BASE = _envNum("SIM_REACH_BASE", 4);   // small base so ORGANISATION dominates reach — a weak chiefdom holds a tiny core, an empire projects far (was 8: even org→0 states sprawled)
const COUNTRY_REACH_ORG  = _envNum("SIM_REACH_ORG", 14);   // reach per organisation tech (was 20 — empires were continental too early; a 14→26 trial over-inflated empires at APP resolution and was reverted — empire size is resolution-sensitive via the size-gate, so it must be calibrated at the shipped width, not the 240-wide gate)
// ── Frontier-fill: claiming the harsh interior as engineering matures ──
// For most of history great regions were politically EMPTY — no state claimed
// the deep Sahara, the high Himalaya, the Amazon, interior Africa. They filled
// in LATE, and chiefly by being CLAIMED out to a natural boundary (the colonial
// partition of Africa drew borders straight across the desert; modern states
// leave no terra nullius). The thing that let a state administer terrain it could
// never densely settle was ENGINEERING — roads, forts, depots, surveys
// (construction tech). So we CAP the per-tile CLAIM cost, and lower that cap as
// the capital's construction matures: a neolithic realm is walled out of the
// mountains and deserts (they stay open wilderness, as in antiquity), while a
// developed one projects a claim across them at roughly plains-cost — so the
// blank interiors fill to their natural boundaries and get partitioned among the
// bordering states, instead of staying empty for all time. (Climbs from no
// effective cap at construction 0 down toward CLAIM_CAP_FLOOR near construction 1.)
const CLAIM_CAP_CEIL  = 40;   // construction 0: harsh tiles uncapped (ranges/deserts wall the claim)
const CLAIM_CAP_FLOOR = 1.5;  // construction 1: even alpine/desert claimable at ~plains cost
// The cap is SOFT, not a hard clamp: above the cap the excess cost is compressed
// (× CLAIM_SOFT) rather than flattened to a single value. A hard clamp made every
// harsh tile cost exactly the same, which turns the cost-Voronoi into a geometric
// one — and geometric bisectors between two realms are dead-straight LINES (the
// "straight wall" carving across deserts/ranges). Keeping a little of the terrain
// gradient lets the border still slump onto the real ridge/desert spine.
const CLAIM_SOFT      = 0.12;
// A realm's political claim HUGS habitable land. Beyond the raw transport cost of
// crossing hostile ground, barren land (deep desert, bare alpine rock) has almost no
// population to settle, tax or garrison, so a state can't run a border across it the
// way it runs one up a green river valley or along a coast. We amplify the per-tile
// CLAIM cost on low-fertility land only (movement and trade are untouched) — which is
// what carves Egypt-/Chile-style RIBBON realms: the claim runs cheap along the fertile
// corridor and stalls in the waste. The penalty bites only BELOW the reference
// fertility (good land and ordinary frontier march pay nothing) and ramps with the
// square of the shortfall, so only genuine wasteland resists hard.
const CLAIM_FERT_REF  = 0.12;  // fertility below which hostility starts. Deliberately LOW: only TRUE wasteland (deep desert, bare rock, fert→0) resists. Steppe/savanna/dry marginal land claims at plain transport cost — historically that was LOW-resistance land (open, sparse, nobody to fight), how Russia/the khanates/Sahel states got huge. Fertility caps POPULATION, not political reach.
const CLAIM_HOSTILITY = 3.0;   // ×(1 + this·deficit²) on barren land: 0 = old isotropic blob, up = tighter river/coast ribbons
// PHASE 3 (T.POP_FIELD): political territory is grown by CAPACITY, not stamped from the
// economic food-catchment. The catchment stamp made realm area = member-count × catchment
// and left the capacity target slack (the crux finding, docs/field-polity-spec.md), so no
// size lever could bind. Under the lever a small pinned CORE per member is the only stamp
// (stability floor); the rest of the realm's extent is grown toward FIELD_SPAN·capacity and
// trimmed to it — so size finally tracks region-capacity. The fill rate is boosted so that
// capacity-bounded coverage builds up over a handful of passes (there is no catchment bulk
// to seed it). The economic catchment (_territoryOwner) still feeds FOOD, unchanged.
const CORE_R   = 1;   // half-width (tiles) of the pinned urban core stamped per member
const POP_FILL = 12;  // rateCap multiplier under POP_FIELD: realms reach their (binding) capacity
                      // target in fewer passes, so coverage fills sooner and size is capped by
                      // FIELD_SPAN·capacity (not by how far growth got) — making size tunable.
// ── TILE_POLITY coverage floor ──────────────────────────────────────────────
// Under capital-only anchoring (TILE_POLITY) the per-settlement anchors no longer
// paint the settled belt, so a realm's extent is ONLY its capacity-grown blob — and
// the Tilly stack computes NO hold-capacity for a SOLO city-state (conquest.js sizes
// MULTI-province holds and skips the lone realm), so `_capacity` is 0, the growth
// target is 0, and the realm FREEZES at its capital core. It never covers its region,
// never touches a neighbour, so war finds no fronts (captured=0) and nothing
// consolidates — the measured 3-14%-claimed over-fragmentation. Fix the MECHANISM:
// every realm is guaranteed a growth target of at least an ORG-scaled administrative
// HINTERLAND around its capital — the coverage the settlement scatter used to give,
// now emergent from the capital's reach (organisation tech, the same thing that sized
// the entity-model catchment). Capacity still sets size ABOVE this floor (a great
// power sprawls past its hinterland into low-pop marches, FIELD_SPAN·capacity), so the
// size distribution is unchanged where capacity already binds; only the frozen small
// realms grow to cover their own land, restoring fronts and consolidation.
// Both are LIVE LEVERS (T.COVER_BASE / T.COVER_ORG, "Empire size & cohesion"), read at
// use time in fieldPolityTerritory; the SIM_COVER_* envs FORCE-override them for headless
// sweeps (the SIM_* override pattern used throughout this file — unset defers to the lever).
const COVER_BASE_ENV = _envForce("SIM_COVER_BASE");   // lever def 25: ref-tiles a realm covers around its capital at organisation 0 (a chiefdom's core region)
const COVER_ORG_ENV  = _envForce("SIM_COVER_ORG");    // lever def 150: + this × capital organisation — an administered hinterland scales with statecraft
// Wet-tropic claim resistance: hot AND wet rainforest (the Congo, the Amazon, New
// Guinea) was easy to walk through but near-impossible to ADMINISTER — disease,
// no roads, leached soil, no storable surplus to tax or garrison. So it amplifies
// CLAIM cost like a soft waste, leaving the deep wet tropics a sparse stateless
// frontier rather than another wall-to-wall statelet patchwork. Crucially it keys
// on hot+WET, so the open hot+DRY steppe/savanna (Sahel, the khanates' grass sea)
// is untouched and still claims cheap. Scaled by the realm's `host` factor, so it
// fades with logistics tech — pre-modern realms stall at the jungle edge, the
// industrial/colonial era finally penetrates it.
const WET_TROPIC_RESIST = 1.0;   // strength of the disease/tsetse-belt claim drag (see claimHostility)
// How far a realm projects a CLAIM also grows with the era. In antiquity a state
// was an island of territory in a sea of unclaimed land — most of the world
// belonged to no polity (steppe, forest, desert, the deep interior). The modern
// norm is the opposite: every habitable region is some state's, claimed out to a
// natural boundary. So the reach budget is multiplied by an ERA factor that
// climbs with the capital's construction (the surveying/road/communication tech
// that lets authority carry far), turning the ancient archipelago of realms into
// the modern wall-to-wall partition as the centuries pass.
const REACH_ERA = 2;          // budget ×(1 + construction² · REACH_ERA): ~×1 ancient, ~×3 modern (was 3 — eased so realms don't balloon mid-era). OLD-path (TECH_EFFECTS=0) only.
const LOGI_REACH = 2.2;       // budget ×(1 + logisticsLevel · LOGI_REACH): transport/comms-gated era scaling (Roads≈Rome-scale, Rail+Telegraph≈continental). NEW path.
// There is NO synthetic "frontier close". The ancient archipelago of realms becomes
// the modern wall-to-wall partition PURELY through each realm's own reach growing as
// it develops: the per-settlement reach budget above is multiplied by eraMul, which
// climbs with LOGISTICS tech (LOGI_REACH — roads→rail→telegraph→steamship), so an
// industrialised realm naturally projects its border far enough to swallow the open
// interior, while a pre-rail world keeps its terra nullius because its reach simply
// can't span it. Coverage is therefore an emergent consequence of development, never
// a special global flood keyed on a year, an era index, or a logistics threshold.
// (Interior wastes fully enclosed by a single realm still fill — see
// fillEnclosedWaste — but that's a topological cartographer's rule, not a time gate.)
// Reach is also scaled by how BIG the realm is, so a claim is backed by real
// settlements rather than the capital's tech alone. budget ×= clamp(members /
// REACH_SIZE_REF, REACH_SIZE_MIN, 1): a fledgling realm projects only a fraction
// of its tech-reach (no continent-from-three-cities) and earns the full reach as
// it grows to a continental-scale state.
const REACH_SIZE_REF = 16;    // settlements for full reach (was 32 — but the log2 hold capacity caps realms at ~6–17 members, so the super-linear tail below NEVER FIRED; at 16 full reach + the compounding tail sit inside what a strong realm actually achieves. The original job — a 3-city cradle must not project a continental claim — is still done by the sub-reference ramp)
const REACH_SIZE_MIN = 0.25;  // a tiny realm still projects at least this fraction
// Each SETTLEMENT projects reach in proportion to its OWN population, not just the
// nation's tech. Territory area ∝ basin², so basin ∝ √pop makes a settlement's claim
// scale with its people: a city of CLAIM_POP_REF wields the full national reach, a
// frontier hamlet only its neighbourhood. Without it, a realm collapsed to one tiny
// settlement still projected a continental claim — the modern-era "pop-25 holds the
// largest territory" artifact (a 25-person hamlet flying a 447-tile border). Floored
// at the settlement's own ground (integMin), so coverage is never lost.
const CLAIM_POP_REF = 1000;
// Power-weighted borders (T.CLAIM_POW): clamp on the per-realm claim weight, so a
// hegemon dominates its marches (×CLAIM_W_MAX reach / border push) but can't swallow
// the continent in one pass, and a weakling still holds a small core (×CLAIM_W_MIN).
const CLAIM_W_MIN = 0.6, CLAIM_W_MAX = 2.2;
// Past the reference, scale keeps PAYING (sqrt, dampened) instead of clamping to 1.
// The clamp was an equalizer: a 60-member empire projected the same claim as a
// 32-member one, so every mature realm converged on the same regional size (the
// country-size diagnostic showed max/median FALLING 24→2.4 over time, Gini 0.36 —
// no dominant empires, ever). With the super-linear tail, members → budget →
// adopted villages → members compounds for the realm that's already winning; the
// loop stays bounded because member count itself is gated by the log2 hold
// capacity and secession (conquest.js), so it amplifies a leader without minting
// an immortal juggernaut.
const REACH_SIZE_SUPER = 0.7; // budget mult at 4×REF = 1 + (√4−1)·0.7 = ×1.7
// Continental LOGISTICS (the rail/telegraph era reach multiplier) needs a NETWORK of
// cities to project: a realm earns the full era-boost only at this many settlements,
// and a smaller/CRUMBLING realm gets it proportionally — so a modern rump of one or
// two cities reaches only regionally, not continentally. The hollow-husk fix: a
// declining empire's claim deflates with it. The 3-seed full-scale review found 9–13
// under-populated mega-claims per world (e.g. 1217 tiles held by ONE 533-person
// settlement) — fallen empires still flying an imperial border because the budget
// tracked TECH, which only ratchets up, not current size. Legit many-member sparse
// realms (Mongol/thalassocracy) are above the reference and keep full reach.
const LOGI_SIZE_REF = 12;
// Personality into the claim: an Expansionist realm (personality.js, −1..1)
// projects a meaningfully wider political claim, an Insular one pulls in. This is
// a deliberate ASYMMETRY source — temperament is intrinsic, persistent over
// centuries and defies geography, so it's what lets two equal-tech neighbours
// diverge into a sprawling conqueror and a compact homebody (Rome vs the
// city-states it ate). Appetite only — tech still sets what a realm CAN hold.
const CLAIM_PERS_SPAN = 0.25; // ±25% budget at the expansionism poles
// Enclosed-waste fill (the cartographer's rule): interior wasteland wholly
// surrounded by ONE realm is coloured in — there is no rival claimant by
// construction, and route/denial control over enclosed waste was real (the
// Caliphate's inner deserts are drawn solid; Egypt's FRONTIER desert is not —
// frontier waste still resists via the fertility-hostility, keeping the ribbon).
// Capped relative to the realm's claimed size so a thin ring can't swallow a
// continent-sized waste.
const ENCLOSED_FILL_MAX = 1.0; // max filled-pocket size, × the realm's claimed tile count
// CAPITAL ANCHOR: a settlement's projected reach falls off with its distance from
// the capital (see seeding) — the basin HALVES at capDist = ANCHOR_SCALE / anchor
// tiles, so territory hugs the capital and realms read as compact blobs instead of
// sprawling along the settlement scatter. The strength is the CAPITAL_ANCHOR lever.
const ANCHOR_SCALE = 40;
// ── Resolution invariance ─────────────────────────────────────────────
// The reach quantities here (the BASE/ORG budget, ANCHOR_SCALE, INTEGRATE_MIN)
// are absolute travel-COST units ≈ tiles, and were tuned on the 240-wide test
// grid. The SHIPPED world runs 4× wider (sim ≈960), where a fixed tile-budget
// covers only ¼ the linear fraction of the map — so every realm collapsed to a
// capital-sized blob and the political map shattered into a confetti of tiny
// proto-states at ~6% claimed land (the full-res regression: "weird small proto
// states, confettified, countries not growing"). It read fine only because the
// constants were validated at the 240-wide test resolution — the blind spot. Fix:
// normalise every tile-DISTANCE quantity by the map width, so a realm projects the
// same FRACTION of the world at any resolution. At the test grid resScale=1
// (behaviour unchanged, backwards-compatible); at the 960-wide world resScale=4.
// (Per-EDGE costs like CLAIM_CAP are NOT scaled — crossing one mountain tile costs
// the same however fine the grid; only cumulative reach distances scale.)
const RES_REF_W = 240;
const _resScaleEnv = (typeof process !== "undefined" && process.env && +process.env.SIM_RES_SCALE) || 0;
// tw/RES_REF_W keeps a realm's REACH at a constant world-FRACTION at any grid. The old
// Math.max(1, …) floor left it un-scaled BELOW the reference (tw<240): reach stayed a fixed
// tile count while the grid shrank, so a coarse sim (the new Quarter setting, or a small map)
// claimed a far larger fraction — realms ~2.3× oversized at tw=120. Un-clamp below the reference
// (matching rNormPop, which never clamped) so density and reach agree symmetrically both ways.
// Byte-identical at/above 240 (the app default, the 480 validate grid); the RES_INVARIANT_POP=0
// escape hatch keeps the legacy clamp for exact-legacy runs.
function resScaleFor(tw) { return _resScaleEnv > 0 ? _resScaleEnv : (T.RES_INVARIANT_POP ? tw / RES_REF_W : Math.max(1, tw / RES_REF_W)); }
export { resScaleFor };
// Capital colouring (DEFAULT ON): per-settlement coverage (every settlement holds its own
// ground, so populated land is never abandoned) RECOLOURED by nearest capital, so the
// country↔country border is a smooth capital cost-bisector instead of the union of
// per-settlement bubbles. The earlier "it just recedes" was NOT this — it was settlements
// going STATELESS (a stateless settlement projects no territory); frontier TOWNS founding
// city-states (adoptAndFound) fixes that upstream, so this reads clean now. The flood is
// bounded to claimed land (recolorByCapital) so it adds no territory-pass hitch.
// SIM_CAPITAL_ONLY=0 reverts to raw per-settlement seeding (bubbly).
const _capitalOnly = !(typeof process !== "undefined" && process.env && process.env.SIM_CAPITAL_ONLY === "0");
// ── Gradual integration of newly-acquired land ───────────────────────
// A settlement that just joined this realm out of the WILD (adoptAndFound stamps
// _integratedAt when a stateless settlement adopts a country, as the realm's
// territory grows into it) does NOT immediately project the country's full reach
// from its own location — that made the country's colour BLOOM out around each
// freshly-absorbed frontier settlement. Instead its territorial basin starts at
// INTEGRATE_MIN and grows to the full country reach over INTEGRATE_TICKS, so the
// captured frontier fills in gradually FROM the realm rather than radiating out
// of the new settlement. (Conquest/secession are unaffected — they never stamp
// _integratedAt, so a stormed city or a seceded province keeps its land at once.)
const INTEGRATE_TICKS = 3000;
const INTEGRATE_MIN   = 2;     // reach-units a just-adopted settlement projects on day one
// Reach RAMP: a country's claimed reach EASES toward its tech-budget rather than
// snapping to it, so territory grows in gradually instead of exploding to
// continent size the moment cities emerge / the construction era turns (the
// mid-game "continent-power explosion"). A realm earns its full reach over
// ~1/BUDGET_RAMP territory passes; a brand-new country starts near the base reach.
const BUDGET_RAMP = 0.06;
// ── Organic borders ──────────────────────────────────────────────────
// A uniform cost field makes the cost-Voronoi bisector between two realms a dead-
// straight LINE (the "geometric border / straight-line land grab" artefact). A
// smooth, low-frequency NOISE field multiplied into the per-tile claim cost gives
// the frontier somewhere to meander, so borders wander organically (and still
// slump onto real ridges/rivers/coasts via the terrain term) instead of cutting
// straight across open ground. Coherent (≈NOISE_CELL-tile wavelength), wraps in
// longitude, cached per world.
const NOISE_CELL = 13;
const NOISE_AMP  = 0.30;       // ± fraction the claim cost wobbles (0.30 ⇒ ×0.70..×1.30)
// Tier at/above which a settlement is a sovereign ANCHOR that can found and hold
// a country (a real seat of government). Below it, settlements ADOPT their
// territory's country or stay stateless on the frontier — they are pure
// population, never sovereign.
//
// CITY (tier 2). Towns (tier 1) used to qualify, which let EVERY town in a reach-
// gap mint its own micro-state and secede alone — the "swarm of tiny nations
// parasitising an empire" + a runaway country count (60+ realms, most <120 tiles,
// at 480x240). Requiring a real CITY makes sovereignty substantial: the count
// lands near the realistic ~80-100-country target (cities are far rarer than
// towns), secessions need a city so they break off province-sized chunks rather
// than single towns, and frontier towns are just population until a city emerges
// or a realm's territory reaches them. (The old "cities tiled everything" worry
// predated the reach-budget trim + gradual integration + slowed consolidation,
// which now keep even a sparse set of city-states regional.)
const CITY_TIER = 2;
const SQRT2 = Math.SQRT2;

// The 4th lane (w) is the WATER-RUN depth under FIELD_NAVAL — how many consecutive water
// tiles the entry's path has been at sea (0 on land, reset at every landfall), checked
// against the realm's navigation excursion budget. Land-only callers never pass it (0).
class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.c = new Int32Array(cap); this.w = new Int32Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const k = this.cap * 2; const t = new Int32Array(k); t.set(this.ti); this.ti = t; const d = new Float64Array(k); d.set(this.d); this.d = d; const c = new Int32Array(k); c.set(this.c); this.c = c; const w = new Int32Array(k); w.set(this.w); this.w = w; this.cap = k; }
  push(ti, d, c, w = 0) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; this.c[i] = c; this.w[i] = w; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; this._sw(p, i); i = p; } }
  _sw(a, b) { const t = this.ti[a]; this.ti[a] = this.ti[b]; this.ti[b] = t; const d = this.d[a]; this.d[a] = this.d[b]; this.d[b] = d; const c = this.c[a]; this.c[a] = this.c[b]; this.c[b] = c; const w = this.w[a]; this.w[a] = this.w[b]; this.w[b] = w; }
  popMin() { const ti = this.ti[0], d = this.d[0], c = this.c[0], w = this.w[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; this.c[0] = this.c[this.n]; this.w[0] = this.w[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; this._sw(b, i); i = b; } } return { ti, d, c, w }; }
}

// Smooth value-noise field (≈NOISE_CELL-tile wavelength, longitude-wrapping),
// in [0,1], cached on the world. Multiplied into the per-tile claim cost so the
// cost-Voronoi border meanders instead of running straight (see NOISE_* above).
function claimNoise(world) {
  if (world._claimNoise && world._claimNoise.length === world.N) return world._claimNoise;
  const { N, tw, th } = world;
  const noise = new Float32Array(N);
  const cols = Math.max(1, Math.round(tw / NOISE_CELL)), rows = Math.ceil(th / NOISE_CELL) + 1;
  const grid = new Float32Array(cols * rows);
  const seed = (world.seed || 1) >>> 0;
  for (let i = 0; i < grid.length; i++) {
    let h = (i * 2654435761 ^ (seed * 40503)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    grid[i] = (h >>> 0) / 4294967295;
  }
  for (let ty = 0; ty < th; ty++) {
    const gy = ty / NOISE_CELL; let y0 = gy | 0; const fy = gy - y0; if (y0 >= rows - 1) y0 = rows - 2;
    const sy = fy * fy * (3 - 2 * fy);
    for (let tx = 0; tx < tw; tx++) {
      const gx = tx / NOISE_CELL; const x0 = gx % cols | 0; const fx = (gx - (gx | 0)); const x1 = (x0 + 1) % cols;
      const sx = fx * fx * (3 - 2 * fx);
      const a = grid[y0 * cols + x0], b = grid[y0 * cols + x1], c = grid[(y0 + 1) * cols + x0], d = grid[(y0 + 1) * cols + x1];
      const top = a + (b - a) * sx, bot = c + (d - c) * sx;
      noise[ty * tw + tx] = top + (bot - top) * sy;
    }
  }
  world._claimNoise = noise;
  return noise;
}

// ── FIELD POLITY (T.FIELD_POLITY, docs/field-polity-spec.md) ────────────────
// The political map is the AUTHORED, persistent ontology. A country's EXTENT is NOT
// the union of its settlements' reach bubbles (the entity model below) — it is one
// persistent blob on _countryOwner that GROWS at its own frontier into cheap adjacent
// wilderness, bounded by the country's Tilly hold-capacity (conquest.js, the stack we
// calibrated), and priced by the SAME terrain cost field (relief walls, deserts, seas,
// fertility-hostility) the entity Voronoi used. Settlements are DRESSING: they anchor
// their home tile and supply the capacity; they never each project territory, and a
// subject's countryId is DERIVED from the ground (adoptAndFound). Cities change hands
// only by the discrete events (war storm / secession / absorption), never by peaceful
// field growth (growth enters WILD land only) — so every statecraft gate still holds.
//   Size now flows capacity → area directly: a realm holds ≈ FIELD_SPAN·capacity tiles,
// grown gradually and shed when capacity falls (rise-and-fall on the map itself), so
// the country-size distribution IS the (validated) capacity distribution rather than a
// settlement-count artefact. Tick order (index.js): this runs in computeCountryTerritory,
// BEFORE adoptAndFound derives subject flags and BEFORE updatePolities recomputes
// capacity — so cap/load read here are ≤1 polity-interval stale, which is fine (capacity
// drifts slowly and has its own hysteresis).
const FIELD_SPAN_DEF = 6.0;   // tiles a realm's administration holds per unit hold-capacity (T.FIELD_SPAN lever; 6 since comboE — was 12, see docs/empire-consolidation-2026-07.md)
// SIZE_BY_POP: reference-tiles of SPARSE FRONTIER a fully-logistic (industrial:
// roads→rail, logisticsLevel→1) state administers BEYOND its populated core. This
// is what claims the deserts/tundra/marches real empires held but their population
// never filled — and it is ~0 in the pre-road era, so it lifts coverage toward
// full ONLY as the world industrialises (the "rises with development" target),
// never as an early floor. Added to the pop core, not max()'d — a low-pop realm on
// the early frontier stays small; a developed one spreads over its marches.
const MARCH_LOG_TILES = 150;
// Sweep knobs (env, unset = defaults): the march's SIZE and how steeply it gates on
// logistics (POW>1 keeps the early frontier small — march ≈ 0 until roads mature —
// and pushes the map-fill toward the true industrial era).
const MARCH_TILES_ENV = (typeof process !== "undefined" && process.env && +process.env.SIM_MARCH_TILES) || 0;
const MARCH_POW = (typeof process !== "undefined" && process.env && +process.env.SIM_MARCH_POW) || 1;
function fieldPolityTerritory(world) {
  const FIELD_SPAN = T.FIELD_SPAN || FIELD_SPAN_DEF;
  const { N, tw, th, elev, fert, temp, moist } = world;
  const resScale = resScaleFor(tw), r2 = resScale * resScale;
  let co = world._countryOwner;
  if (!co || co.length !== N) { co = world._countryOwner = new Int32Array(N); co.fill(-1); }

  // Living polities + per-country capacity/knowledge (the Tilly stack from the last
  // updatePolities; one-interval stale is acceptable).
  const alive = new Set();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) alive.add(s.countryId);
  const capOf = new Map(), knOf = new Map(), hostOf = new Map(), claimCap = new Map(), logiOf = new Map();
  if (world.countries) for (const [cid, c] of world.countries) {
    if (!alive.has(cid) || !c.capital) continue;
    capOf.set(cid, Math.max(0, c._capacity || 0));
    knOf.set(cid, c.capital.knowledge || {});
    const cons = (c.capital.knowledge && c.capital.knowledge.construction) || 0;
    const logi = (c.capital._techEff ? c.capital._techEff.logisticsLevel : cons * cons) || 0;
    logiOf.set(cid, logi);                                      // SIZE_BY_POP: the reach-over-sparse-land driver (roads→rail)
    hostOf.set(cid, CLAIM_HOSTILITY * Math.max(0, 1 - logi));   // the modern partition of the wastes (fades with logistics)
    claimCap.set(cid, CLAIM_CAP_FLOOR + (CLAIM_CAP_CEIL - CLAIM_CAP_FLOOR) * Math.max(0, 1 - cons));
  }

  // Per-edge CLAIM cost for a realm stepping from ti into land tile ni: the transport
  // edge cost, soft-capped (engineering), amplified on barren / wet-tropic ground
  // (hostility fades with the realm's logistics), wobbled by the organic-border noise.
  // ONE function shared by the frontier growth AND the admin-distance walk below — if
  // the two priced an edge differently, a tile's admin load would flip between the
  // pass that claimed it and the next pass's re-walk.
  const noise = claimNoise(world);
  const edgeCostFor = (ti, ni, kn, cap, host) => {
    let ec = localEdgeCost(world, ti, ni, kn, true);
    if (ec === Infinity) return Infinity;
    if (ec > cap) ec = cap + (ec - cap) * CLAIM_SOFT;
    // Fertility-hostility + wet-tropic amplify LAND claims only (they model land nobody
    // can settle, tax or garrison). A WATER edge (naval traversal — elev ≤ 0 targets only
    // ever reach here under FIELD_NAVAL) is priced purely by its nav-gated mode cost:
    // fert=0 at sea would otherwise re-tax every sailed tile as if it were deep desert.
    if (host > 0 && elev[ni] > 0) {
      const fdef = (CLAIM_FERT_REF - (fert ? fert[ni] : CLAIM_FERT_REF)) / CLAIM_FERT_REF;
      if (fdef > 0) ec *= 1 + host * fdef * fdef;
      if (temp && moist) { const wt = claimHostility(temp[ni], moist[ni]); if (wt > 0) ec *= 1 + host * WET_TROPIC_RESIST * wt; }
    }
    ec *= 1 + (noise[ni] - 0.5) * (2 * NOISE_AMP);
    return ec;
  };

  // ── Administrative DISTANCE (T.FIELD_ADMIN, default on) ──────────────────────
  // The tyranny of distance, restored to the field model. The legacy reach-Voronoi
  // bounded every claim by cumulative travel cost from a settlement and pulled basins
  // toward the capital (CAPITAL_ANCHOR); the field model replaced both with a flat
  // AREA target, under which a tile at the tip of a 100-tile tendril costs the centre
  // exactly as much as one beside the capital — so nothing preferred compact shapes,
  // and long runs accreted contorted, overextended smears (measured: top-realm
  // compactness 0.3 → 0.05 over 60k steps at the app grid). Under the lever each tile
  // instead carries an admin LOAD of 1 + d/ADMIN_HALF — d being its travel cost from
  // the realm's nearest SEAT (capital home tile / member cores), priced by the same
  // tech-aware edge-cost field as movement — and held/target/growth/shed all trade in
  // load, not tiles. Near, cheap land is administered at face value; far or harsh land
  // consumes multiples of capacity; an over-target realm sheds its MOST REMOTE marches
  // first. Because d is priced through the tech-discounted edge costs, the affordable
  // radius grows emergently as roads/rail cut movement cost — never from an era gate —
  // and a steppe or sea-lane empire still sprawls where movement is genuinely cheap.
  const adminOn = fieldAdminOn();
  // ── Naval administration (T.FIELD_NAVAL, default on) ─────────────────────────
  // The two walks below (admin distance, frontier growth) may TRAVERSE water — never
  // claim it — at the same nav-gated sail cost every mover pays (transport.js water
  // mode: impassable below the embark floor, perilous hop just above it, undercutting
  // the plains at full navigation; port tax on embark/landfall). So a realm that can
  // sail administers and grows across straits and small seas, its far shore priced at
  // its TRUE sea distance in admin load — the maritime empire as a consequence of the
  // cost field, not a special case. Two bounds keep it honest and cheap:
  //   • the EXCURSION BUDGET — at most (1+7·nav)·resScale consecutive water tiles per
  //     crossing (0 below NAV_EMBARK_THRESH): pre-naval realms stay walled by water,
  //     and the walk touches only the coastal fringe, never O(countries × ocean);
  //   • PER-REALM water distances — a shared dist[] on water would hand a contested
  //     strait to whichever realm relaxes it first and maroon the rival's far shore
  //     every pass (the exact bug the legacy merge documents at its naval-contiguity
  //     block), so sea distance is keyed (realm, tile) on the fringe.
  const navalOn = adminOn && fieldNavalOn();
  const hopOf = navalOn ? new Map() : null;   // cid → excursion budget (consecutive water tiles)
  const hopBudget = (cid) => {
    let h = hopOf.get(cid);
    if (h === undefined) {
      const kn = knOf.get(cid), nav = (kn && kn.navigation) || 0;
      h = nav < (T.NAV_EMBARK_THRESH ?? 0.10) ? 0 : Math.round((1 + NAVAL_HOP_PER_NAV * nav) * resScale);
      hopOf.set(cid, h);
    }
    return h;
  };
  const wDistAdmin = navalOn ? new Map() : null;   // (cid·N + water ti) → sea distance, admin walk
  const wDistGrow = navalOn ? new Map() : null;    // (cid·N + water ti) → sea distance, growth walk
  const ADMIN_HALF_EFF = Math.max(1e-9, (T.ADMIN_HALF || 15) * resScale);   // cumulative distance → res-scaled like every reach quantity
  const loadOfD = (d) => 1 + d / ADMIN_HALF_EFF;   // admin load of a tile at travel-cost d from its realm's nearest seat
  const spanEff = FIELD_SPAN * (adminOn ? ADMIN_LOAD_RECAL : 1);   // tile-calibrated span → load units (see ADMIN_LOAD_RECAL)
  let dist = null;   // per-tile d (Float64, Infinity = unreached), filled by the connectivity walk below

  // 1. ANCHOR home tiles. DEFAULT: every settled home tile (seats AND subjects) — guarantees
  //    the blob contains its cities and seeds a newborn polity's one-tile core.
  //    TILE_POLITY: only the CAPITAL anchors. A polity's spatial identity becomes its capital
  //    + the land it has grown and holds; non-capital cities ride the ground (they derive their
  //    flag below) but never pin/seed/create territory — so the field stops JUMPING to where
  //    settlements spawn or are captured. Steps 1b/3/6 all key off homeTiles, so this one change
  //    makes the whole anchor/core/connectivity/shed stack capital-only.
  const homeTiles = new Map();
  if (T.TILE_POLITY) {
    const anchored = new Set();
    if (world.countries) for (const [cid, c] of world.countries) {
      if (!alive.has(cid) || !c.capital || c.capital.mode !== "settled") continue;
      const ti = (c.capital.pos.y | 0) * tw + (c.capital.pos.x | 0);
      if (elev[ti] <= 0) continue;
      co[ti] = cid;
      homeTiles.set(cid, [ti]);
      anchored.add(cid);
    }
    // Fallback: any alive country not yet capital-anchored (the territory pass runs before
    // world.countries is built on step 1, and the post-load warm-up skips the polity pass)
    // anchors its settlements, so its loaded/newborn land is never released for want of a seed.
    for (const s of world.settlements) {
      if (s.mode !== "settled" || s.countryId < 0 || anchored.has(s.countryId)) continue;
      const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
      if (elev[ti] <= 0) continue;
      co[ti] = s.countryId;
      let a = homeTiles.get(s.countryId); if (!a) homeTiles.set(s.countryId, a = []); a.push(ti);
    }
  } else {
    for (const s of world.settlements) {
      if (s.mode !== "settled" || s.countryId < 0) continue;
      const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
      if (elev[ti] <= 0) continue;
      co[ti] = s.countryId;
      let a = homeTiles.get(s.countryId); if (!a) homeTiles.set(s.countryId, a = []); a.push(ti);
    }
  }

  // 1b. STAMP economic catchments into the political field: a settled member's WORKED
  //    land (its _territoryOwner catchment — the real, bounded hinterland the economy
  //    already computes) flies that member's flag. This is what makes a political EVENT
  //    actually transfer TERRITORY on the map: war/secession/absorption all flip
  //    s.countryId (never the field), so without this a stormed city is a lone enclave
  //    and its countryside stays the defender's. Here the member's catchment follows its
  //    flag every pass. `worked` also PINS this land against the shed/smooth below —
  //    a realm never sheds land its people actively work. Marches BEYOND the worked land
  //    are the capacity-driven frontier growth (steps 4-5), so extent = worked economy
  //    + admin marches, NOT the old per-settlement reach-bubble union.
  const terr = world._territoryOwner, byId = world._byId;
  let worked = world._fpWorked; if (!worked || worked.length !== N) worked = world._fpWorked = new Uint8Array(N);
  worked.fill(0);
  if (T.POP_FIELD) {
    // PHASE 3: stamp only a small pinned CORE per member (the stability floor) — NOT the
    // economic catchment. Political extent beyond the cores is grown by capacity (steps
    // 4-6), so realm size tracks region-capacity instead of the catchment union.
    for (const [cid, arr] of homeTiles) {
      for (const hti of arr) {
        const hy = (hti / tw) | 0, hx = hti - hy * tw;
        for (let dy = -CORE_R; dy <= CORE_R; dy++) {
          const yy = hy + dy; if (yy < 0 || yy >= th) continue;
          for (let dx = -CORE_R; dx <= CORE_R; dx++) {
            const ni = yy * tw + ((hx + dx + tw) % tw);
            if (elev[ni] <= 0) continue;
            co[ni] = cid; worked[ni] = 1;
          }
        }
      }
    }
  } else if (terr && byId) {
    for (let ti = 0; ti < N; ti++) {
      if (elev[ti] <= 0) continue;
      const oid = terr[ti]; if (oid < 0) continue;
      const s = byId.get(oid);
      if (s && s.mode === "settled" && s.countryId >= 0) { co[ti] = s.countryId; worked[ti] = 1; }
    }
  }

  // 2. RELEASE dead-owner land (a fallen realm's blob reverts to wilderness).
  for (let ti = 0; ti < N; ti++) { const c = co[ti]; if (c >= 0 && !alive.has(c)) co[ti] = -1; }

  // 3. CONNECTIVITY (+ admin distance): release any tile not reachable from a home tile
  //    of its OWNER through same-owner land (a fragment severed by conquest reverts to
  //    wild). Seed from home tiles AND every WORKED tile: a tile the realm's economy
  //    actively farms is held by definition and must never be released (step 6 shed
  //    honours the same worked-pin). Walk 8-CONNECTED to match the catchment stamp
  //    (territory.js, diagonal) and the frontier growth (step 5, diagonal): a
  //    4-connected release would strip any tile attached only diagonally / across a
  //    naval hop — which the 8-connected stamp/growth re-add every pass — so co never
  //    reaches a fixed point at ragged coasts or inter-realm diagonal borders and the
  //    growth budget leaks re-claiming held ground.
  //    Under FIELD_ADMIN the same walk is a cost Dijkstra (same seeds, same edges, same
  //    reachable set), so it ALSO yields d — each tile's travel cost from the realm's
  //    nearest seat — which the load pricing below reads.
  if (adminOn) {
    dist = world._fpDist; if (!dist || dist.length !== N) dist = world._fpDist = new Float64Array(N);
    dist.fill(Infinity);
    const dheap = new MinHeap();
    for (const arr of homeTiles.values()) for (const ti of arr) if (dist[ti] > 0) { dist[ti] = 0; dheap.push(ti, 0, co[ti]); }
    for (let ti = 0; ti < N; ti++) if (worked[ti] && co[ti] >= 0 && dist[ti] > 0) { dist[ti] = 0; dheap.push(ti, 0, co[ti]); }
    while (dheap.n > 0) {
      const { ti, d, c, w } = dheap.popMin();
      // Stale-entry check: a water tile's distance lives in the per-realm sea map
      // (dist[] stays Infinity at sea — the sea is traversed, never held).
      if (navalOn && elev[ti] <= 0 ? d > wDistAdmin.get(c * N + ti) : d > dist[ti]) continue;
      const kn = knOf.get(c), cap = claimCap.get(c) || CLAIM_CAP_CEIL, host = hostOf.get(c) ?? CLAIM_HOSTILITY;
      const ty2 = (ti / tw) | 0, tx2 = ti - ty2 * tw;
      const xm = tx2 === 0 ? tw - 1 : tx2 - 1, xp = tx2 === tw - 1 ? 0 : tx2 + 1;
      const ns = [
        ty2 * tw + xm, ty2 * tw + xp, ty2 > 0 ? ti - tw : -1, ty2 < th - 1 ? ti + tw : -1,
        ty2 > 0 ? (ty2 - 1) * tw + xm : -1, ty2 > 0 ? (ty2 - 1) * tw + xp : -1,
        ty2 < th - 1 ? (ty2 + 1) * tw + xm : -1, ty2 < th - 1 ? (ty2 + 1) * tw + xp : -1,
      ];
      const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
      for (let k = 0; k < 8; k++) {
        const ni = ns[k]; if (ni < 0) continue;
        if (elev[ni] > 0) {
          if (co[ni] !== c) continue;   // same-owner LAND — exactly the flood's edges (landfall resets the water run)
          const ec = edgeCostFor(ti, ni, kn, cap, host);
          if (ec === Infinity) continue;
          const nd = d + ec * mul[k];
          if (nd < dist[ni]) { dist[ni] = nd; dheap.push(ni, nd, c); }
        } else if (navalOn && w < hopBudget(c)) {
          // At sea: authority sails on at the nav-gated water cost (Infinity below the
          // embark floor), while the excursion budget bounds this water run.
          const ec = edgeCostFor(ti, ni, kn, cap, host);
          if (ec === Infinity) continue;
          const nd = d + ec * mul[k];
          const wk = c * N + ni, cur = wDistAdmin.get(wk);
          if (cur === undefined || nd < cur) { wDistAdmin.set(wk, nd); dheap.push(ni, nd, c, w + 1); }
        }
      }
    }
    for (let ti = 0; ti < N; ti++) if (co[ti] >= 0 && dist[ti] === Infinity) co[ti] = -1;
  } else {
    let reach = world._fpReach; if (!reach || reach.length !== N) reach = world._fpReach = new Uint8Array(N);
    reach.fill(0);
    let q = world._fpQ; if (!q || q.length !== N) q = world._fpQ = new Int32Array(N);
    let qt = 0;
    for (const arr of homeTiles.values()) for (const ti of arr) if (!reach[ti]) { reach[ti] = 1; q[qt++] = ti; }
    for (let ti = 0; ti < N; ti++) if (worked[ti] && co[ti] >= 0 && !reach[ti]) { reach[ti] = 1; q[qt++] = ti; }
    for (let h = 0; h < qt; h++) {
      const ti = q[h], c = co[ti];
      const ty2 = (ti / tw) | 0, tx2 = ti - ty2 * tw;
      const xm = tx2 === 0 ? tw - 1 : tx2 - 1, xp = tx2 === tw - 1 ? 0 : tx2 + 1;
      const ns = [
        ty2 * tw + xm, ty2 * tw + xp, ty2 > 0 ? ti - tw : -1, ty2 < th - 1 ? ti + tw : -1,
        ty2 > 0 ? (ty2 - 1) * tw + xm : -1, ty2 > 0 ? (ty2 - 1) * tw + xp : -1,
        ty2 < th - 1 ? (ty2 + 1) * tw + xm : -1, ty2 < th - 1 ? (ty2 + 1) * tw + xp : -1,
      ];
      for (let k = 0; k < 8; k++) { const ni = ns[k]; if (ni >= 0 && !reach[ni] && co[ni] === c) { reach[ni] = 1; q[qt++] = ni; } }
    }
    for (let ti = 0; ti < N; ti++) if (co[ti] >= 0 && !reach[ti]) co[ti] = -1;
  }

  // 4. Held ADMINISTRATION (post-release) → grow/shed budgets vs the capacity target.
  //    Under FIELD_ADMIN a tile counts as its admin load (1 + d/ADMIN_HALF), so the same
  //    capacity holds MORE near/cheap land than far/harsh land — the distance attenuation
  //    of authority. Lever off: flat tile counts (the prior model, byte-identical).
  const held = new Map();
  for (let ti = 0; ti < N; ti++) { const c = co[ti]; if (c >= 0) held.set(c, (held.get(c) || 0) + (adminOn ? loadOfD(dist[ti]) : 1)); }
  // TARGET = FIELD_SPAN·capacity: the whole size limit lives in the (validated) Tilly
  // capacity, which already collapses under war/insolvency (duress) and towers for a
  // dominant fiscal-logistic power — so area tracks capacity directly. Growth toward
  // the target is RATE-CAPPED per pass for gradualness; it is NOT also gated by spare
  // capacity (that double-counted the limit and stalled every mature realm at
  // load≈capacity → spare≈0). A realm whose capacity FELL below its held area sheds
  // the excess in step 6.
  //   RES-INVARIANT RATE: the target (FIELD_SPAN·capacity·r2) is already invariant in
  //   real km² per unit capacity; the rate must be too, so the fill TRAJECTORY matches
  //   across grids. Territory passes fire every TERRITORY_INTERVAL·rNorm ticks
  //   (rNorm≈resScale) — resScale× LESS often at high res — so tiles/pass carries an
  //   extra ×resScale (→ EXPAND_RATE·resScale³) to hold real-area-grown-per-step
  //   constant. Calibrated at the 480-probe (resScale 2).
  const target = new Map(), grow = new Map();
  // Phase 3 fills coverage from cores (no catchment bulk), so the per-pass integration cap
  // is boosted (POP_FILL) to reach the capacity target over a handful of passes.
  const rateCap = Math.max(1, Math.round((T.EXPAND_RATE ?? 8) * r2 * resScale * (T.POP_FIELD ? POP_FILL : 1)));
  // Coverage-floor levers (env force-overrides for headless sweeps; see COVER_*_ENV).
  const coverBase = Number.isFinite(COVER_BASE_ENV) ? COVER_BASE_ENV : (T.COVER_BASE ?? 25);
  const coverOrg  = Number.isFinite(COVER_ORG_ENV)  ? COVER_ORG_ENV  : (T.COVER_ORG ?? 260);
  // SIZE_BY_POP: extent tracks the PEOPLE a realm governs, not a fixed floor.
  // Governed popField per realm, and a self-calibrating tiles-per-person constant
  // benchmarked to the MEDIAN established realm (the _refRevenue pattern — no fitted
  // density). A realm's target is then capped at govPop×popCapK: under-populated
  // realms (fresh frontier states) shrink to what their people justify (sub-Egypt
  // realms exist), the median-and-above (the developed core) are unchanged, and the
  // map fills LATE as population grows rather than EARLY by a floor. Byte-identical
  // when off (nothing computes).
  let govPopOf = null, popCapK = 0;
  if (T.SIZE_BY_POP && world.popField) {
    govPopOf = new Map();
    const pf = world.popField;
    for (let ti = 0; ti < N; ti++) { const c = co[ti]; if (c < 0 || !(elev[ti] > 0)) continue; govPopOf.set(c, (govPopOf.get(c) || 0) + pf[ti]); }
    const gps = [], tgs = [];
    for (const [cid, cp] of capOf) {
      if (cp <= 0) continue;                                   // benchmark on established (capacity-bearing) realms
      const gp = govPopOf.get(cid) || 0;
      if (gp > 0) { gps.push(gp); tgs.push(spanEff * cp * r2); }
    }
    if (gps.length) {
      gps.sort((a, b) => a - b); tgs.sort((a, b) => a - b);
      const medGP = gps[gps.length >> 1], medTG = tgs[tgs.length >> 1];
      if (medGP > 0 && medTG > 0) popCapK = medTG / medGP;     // tiles per governed-person at the median realm
    }
  }
  for (const [cid, cp] of capOf) {
    let t = Math.round(spanEff * Math.max(0, cp) * r2);
    if (T.SIZE_BY_POP && popCapK > 0) {
      // Population-driven extent (no floor). Nomads exempt — a steppe confederation
      // holds vast sparse land by MOMENTUM, not by the people on it. A capless solo
      // (cp=0, conquest.js sizes only multi-province holds) is driven purely by its
      // population, so a lone city-state grows to its people's worth instead of
      // freezing at its core; a realm WITH capacity keeps that as the defensible ceiling.
      const c = world.countries && world.countries.get(cid);
      if (c && c._nomadic) {
        // exempt: keep the capacity target (below)
      } else {
        // Populated CORE (people-driven) + administrative MARCH (logistics-driven,
        // ~0 pre-road, growing with roads/rail). The march is the ceiling-lift that
        // makes coverage RISE WITH DEVELOPMENT: a developed realm claims the sparse
        // frontier its logistics reach, filling the late map, while an early / low-pop
        // realm (short march) stays small. Capacity is NOT the ceiling here — it is
        // median-anchored (log2-compressed) and would re-cap the whole map at the
        // median; the growth Dijkstra's admin-load attenuation is the real reach bound.
        const popCap = Math.round((govPopOf.get(cid) || 0) * popCapK);
        const marchTiles = MARCH_TILES_ENV > 0 ? MARCH_TILES_ENV : MARCH_LOG_TILES;
        const march = Math.round(marchTiles * Math.pow(logiOf.get(cid) || 0, MARCH_POW) * r2);
        t = popCap + march;
      }
      if (t <= 0) { if (cp <= 0 && (govPopOf.get(cid) || 0) <= 0) continue; }  // capless + peopleless newborn: hold (cold-start)
    } else if (T.TILE_POLITY) {
      // COVERAGE FLOOR (capital-only anchoring): guarantee every realm a growth target
      // of at least an org-scaled administrative hinterland, so a solo city-state whose
      // Tilly capacity is 0 (conquest.js sizes only multi-province holds) still covers
      // its region instead of freezing at its capital core. max() with the capacity
      // target, so great powers (capacity-bound) are unchanged — only the frozen small
      // realms grow. This also SUPERSEDES the cold-start guard below: a floor'd realm has
      // a real target ≥ its held core, so step 6 never sheds a capless realm's frontier.
      // (Under FIELD_ADMIN target and floor are load-denominated, like everything here.)
      const kn = knOf.get(cid);
      const org = (kn && kn.organization) || 0;
      const floor = Math.round((coverBase + coverOrg * org) * r2 * (adminOn ? ADMIN_LOAD_RECAL : 1));
      if (floor > t) t = floor;
    } else if (cp <= 0) {
      // A realm with NO real capacity yet — a newborn minted after the last polity pass,
      // or every realm on the FIRST territory pass after a LOAD (capacity is recomputed in
      // updatePolities, which the load warm-up does not run) — is left untouched: no target,
      // so it neither grows nor sheds and simply HOLDS its stamped/anchored field until the
      // next polity pass computes its capacity. Without this a capless realm reads target=0
      // and step 6 sheds its ENTIRE frontier on that pass (the cold-start load divergence).
      continue;
    }
    if (t <= 0) continue;
    target.set(cid, t);
    const g = Math.min(Math.max(0, t - (held.get(cid) || 0)), rateCap);
    if (g > 0) grow.set(cid, g);
  }

  // 5. FRONTIER GROWTH — bounded multi-source Dijkstra from each blob's edge into WILD
  //    land only, per-country budget = min(EXPAND_RATE·spare, target−held), terrain-
  //    priced exactly like the entity Voronoi (soft-capped relief + fertility-hostility
  //    ribbon-hug + wet-tropic + organic noise). Contested wild goes to whoever reaches
  //    it cheaper.
  if (grow.size) {
    let cost = world._fpCost; if (!cost || cost.length !== N) cost = world._fpCost = new Float64Array(N);
    cost.fill(Infinity);
    const heap = new MinHeap();
    for (let ti = 0; ti < N; ti++) {
      const c = co[ti]; if (c < 0 || !grow.has(c)) continue;
      const y = (ti / tw) | 0, x = ti - y * tw;
      const ns = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1];
      // Under FIELD_ADMIN a frontier tile seeds at its OWN distance-from-seat, so the
      // expansion wave carries true cumulative distance: growth naturally prefers the
      // frontier near the realm's seats over the tip of a far tendril (which used to
      // restart at zero and grow as cheaply as the capital's suburbs), and contested
      // wild goes to whoever can actually administer it more cheaply.
      // FIELD_NAVAL: a coastal tile is frontier too — an island realm whose land border
      // is all sea would otherwise never seed, freezing it however naval it becomes.
      // Only realms with a live excursion budget seed on water (pre-naval coasts stay inert).
      for (let k = 0; k < 4; k++) { const ni = ns[k]; if (ni >= 0 && ((elev[ni] > 0 && co[ni] < 0) || (navalOn && elev[ni] <= 0 && hopBudget(c) > 0))) { const d0 = adminOn ? dist[ti] : 0; cost[ti] = d0; heap.push(ti, d0, c); break; } }
    }
    const budget = new Map(grow);
    while (heap.n > 0) {
      const { ti, d, c, w } = heap.popMin();
      // Water entries live in the per-realm sea map (cost[] is land-only here, and a
      // shared sea entry would let one realm's cheap crossing block a rival's).
      if (navalOn && elev[ti] <= 0 ? d > wDistGrow.get(c * N + ti) : d > cost[ti]) continue;
      if ((budget.get(c) || 0) <= 0) continue;
      const kn = knOf.get(c), cap = claimCap.get(c) || CLAIM_CAP_CEIL, host = hostOf.get(c) ?? CLAIM_HOSTILITY;
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const ns = [
        ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1,
        ty > 0 ? (ty - 1) * tw + xm : -1, ty > 0 ? (ty - 1) * tw + xp : -1,
        ty < th - 1 ? (ty + 1) * tw + xm : -1, ty < th - 1 ? (ty + 1) * tw + xp : -1,
      ];
      const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
      for (let k = 0; k < 8; k++) {
        const ni = ns[k]; if (ni < 0) continue;
        // FIELD_NAVAL: the wave may SAIL over water (traverse only — the sea is never
        // claimed, consumes no growth budget) within the excursion budget; the far
        // shore then claims like any frontier tile, arriving at its true sea distance
        // (so a distant landfall costs its full admin load — colonies are dear).
        if (elev[ni] <= 0) {
          if (!(navalOn && w < hopBudget(c))) continue;
          const ec = edgeCostFor(ti, ni, kn, cap, host);
          if (ec === Infinity) continue;
          const nd = d + ec * mul[k];
          const wk = c * N + ni, cur = wDistGrow.get(wk);
          if (cur === undefined || nd < cur) { wDistGrow.set(wk, nd); heap.push(ni, nd, c, w + 1); }
          continue;
        }
        if (co[ni] >= 0) continue;                         // grow into WILD land only (never another realm)
        const ec = edgeCostFor(ti, ni, kn, cap, host);
        if (ec === Infinity) continue;
        const nd = d + ec * mul[k];
        // Only lower cost[ni] when we actually CLAIM it (budget remains). Lowering it for
        // an exhausted-budget realm would reserve the wild tile — a solvent competitor
        // then needs to beat the lower cost and is locked out, sterilising contested land
        // neither realm ends up holding. (Budget can drain to 0 mid-relaxation as earlier
        // neighbours of this same pop are claimed, so the guard must be here, not only at pop.)
        // FIELD_ADMIN: a claimed tile consumes its admin LOAD from the budget (a remote
        // or harsh tile spends multiples), and its distance is stamped so this pass's
        // shed / next pass's walk read the same d the claim was priced at.
        if (nd < cost[ni] && (budget.get(c) || 0) > 0) {
          cost[ni] = nd; co[ni] = c; budget.set(c, budget.get(c) - (adminOn ? loadOfD(nd) : 1)); heap.push(ni, nd, c);
          if (adminOn) dist[ni] = nd;
        }
      }
    }
  }

  // 6. SHED over-capacity marches: a realm holding more than its target releases its
  //    most PERIPHERAL settlement-less tiles (wild-adjacent, no home tile, not worked) —
  //    so a weakened realm's frontier recedes on the map, rise-and-fall without needing a
  //    secession event for every lost march. ONE O(N) sweep collects each over-target
  //    realm's peripheral candidates. (Only one ring recedes per pass; a realm far over
  //    target keeps shedding over subsequent passes — gradual, which is correct.)
  //    FIELD_ADMIN: candidates are released MOST REMOTE FIRST (by d, each refunding its
  //    admin load) — the frontier a weakening centre actually loses grip on is its
  //    farthest, dearest march, not whichever edge tile happens to scan first. The
  //    per-realm sort is over edge candidates only (a perimeter, not N). Lever off:
  //    the flat scan-order release, byte-identical.
  {
    const excess = new Map();
    for (const [cid, t] of target) { const h = held.get(cid) || 0; if (h > t) excess.set(cid, h - t); }
    if (excess.size) {
      let home = world._fpHome; if (!home || home.length !== N) home = world._fpHome = new Uint8Array(N);
      home.fill(0);
      for (const arr of homeTiles.values()) for (const ti of arr) home[ti] = 1;
      if (adminOn) {
        const cands = new Map();   // cid → edge-tile candidates (built in one O(N) sweep)
        for (let ti = 0; ti < N; ti++) {
          const cid = co[ti];
          if (cid < 0 || home[ti] || worked[ti] || !excess.has(cid)) continue;
          const y = (ti / tw) | 0, x = ti - y * tw;
          const ns = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1];
          for (let k = 0; k < 4; k++) {
            const ni = ns[k];
            if (ni >= 0 && (elev[ni] <= 0 || co[ni] < 0)) { let a = cands.get(cid); if (!a) cands.set(cid, a = []); a.push(ti); break; }
          }
        }
        for (const [cid, arr] of cands) {
          let rem = excess.get(cid);
          arr.sort((a, b) => (dist[b] - dist[a]) || (a - b));   // most remote first (index tiebreak keeps it deterministic)
          for (const ti of arr) { if (!(rem > 0)) break; co[ti] = -1; rem -= loadOfD(dist[ti]); }
        }
      } else {
        for (let ti = 0; ti < N; ti++) {
          const cid = co[ti];
          if (cid < 0 || home[ti] || worked[ti]) continue;
          const rem = excess.get(cid); if (!(rem > 0)) continue;   // realm not over target (or quota spent)
          const y = (ti / tw) | 0, x = ti - y * tw;
          const ns = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1];
          let edge = false;
          for (let k = 0; k < 4; k++) { const ni = ns[k]; if (ni >= 0 && (elev[ni] <= 0 || co[ni] < 0)) { edge = true; break; } }
          if (edge) { co[ti] = -1; excess.set(cid, rem - 1); }
        }
      }
    }
  }

  // 7. Cartography (reused, pure _countryOwner ops): fill interior pockets, partition
  //    the gaps between neighbours, smooth the border. Home tiles are pinned in the
  //    smoother, so no realm is smoothed out of existence.
  fillEnclosedWaste(world, co);
  closeRealmGaps(world, co, T.REALM_GAP_FILL);
  smoothCountryBorders(world, co, T.BORDER_SMOOTH | 0);
}

// Clean per-country cost-Voronoi → world._countryOwner. Runs on the territory pass.
export function computeCountryTerritory(world) {
  // CTRL_LIVE: the control field (controlField.js) authors _countryOwner every tick, so the
  // periodic recompute is skipped entirely — the political map is the continuously-relaxing
  // field, not a rebuilt Voronoi. (The field runs after the settlement pass; on the very
  // first tick _countryOwner is briefly unset until it runs, which is fine — cradles carry a
  // seeded countryId.)
  if (T.CTRL_LIVE) return;
  // FIELD POLITY (T.FIELD_POLITY, docs/field-polity-spec.md): the political map is
  // the AUTHORED persistent state — countries grow at their own frontier and war
  // moves tiles; settlements derive their flag from the ground. The seeded reach-
  // Voronoi below (settlement bubbles → capital recolor → persistence merge) is the
  // legacy entity model, kept byte-identical under lever-off.
  if (T.FIELD_POLITY) { fieldPolityTerritory(world); return; }
  const { N, tw, th, elev, fert, temp, moist } = world;
  const resScale = resScaleFor(tw);   // tile budgets are res-relative → keep the same world-fraction at any grid size (see RES_REF_W)
  let co = world._countryOwner;
  let coFresh = false;
  if (!co || co.length !== N) { co = world._countryOwner = new Int32Array(N); coFresh = true; }
  // PERSISTENT TERRITORY (T.PERSISTENT_TERRITORY): the reach-Voronoi below is a
  // STATELESS recompute — it drops any land a realm's live reach no longer covers,
  // so conquered ground snaps back to wilderness the moment the capital weakens and
  // the map never carries the history of who took what. When the lever is on we
  // demote the Voronoi to a FRONTIER-PROJECTION layer and make _countryOwner sticky:
  // snapshot last pass's map now (before the recompute wipes it), rebuild the fresh
  // reach map as usual, then durably re-assert the marches the reach receded from
  // (mergePersistentTerritory at the end). _coPrev is scratch — it's rebuilt from the
  // already-saved _countryOwner each pass, so persistence adds no new save state.
  const persist = persistentTerritoryOn();
  let prev = null;
  if (persist && !coFresh) {   // a fresh (all-zero) array is not a prior map — skip persistence on the very first pass / after a resize
    let cp = world._coPrev;
    if (!cp || cp.length !== N) cp = world._coPrev = new Int32Array(N);
    cp.set(co);
    prev = cp;
  }
  co.fill(-1);
  let cost = world._countryCost;
  if (!cost || cost.length !== N) cost = world._countryCost = new Float64Array(N);
  cost.fill(Infinity);

  // Per-country reach budget + the knowledge used for edge cost — taken from
  // the country's POLITICAL capital (rebuildCountries' pick, when a polity
  // pass has run) so the border anchor radiates from the same city the rest
  // of the sim calls the capital; before the first polity pass — or if the
  // capital died between passes — fall back to the most-organised settlement.
  const budget = new Map(), knOf = new Map(), capOrg = new Map(), claimCap = new Map(), members = new Map(), capPos = new Map(), eraBoost = new Map(), hostOf = new Map(), capApt = new Map();
  const politicalCap = new Map();   // countryId → capital settlement id (conquest.js rebuildCountries)
  if (world.countries) for (const [cid, c] of world.countries) if (c && c.capitalId != null) politicalCap.set(cid, c.capitalId);
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;   // stateless settlements don't seed
    const c = s.countryId;
    members.set(c, (members.get(c) || 0) + 1);
    const isPolCap = politicalCap.get(c) === s.id;
    const org = s._techEff ? s._techEff.reachLevel : ((s.knowledge && s.knowledge.organization) || 0);   // admin reach from techs (tech.js)
    const rank = isPolCap ? Infinity : org;                  // the throne outranks any org score (selection only — budgets use the real org)
    if (!capOrg.has(c) || rank > capOrg.get(c)) {
      capOrg.set(c, rank);
      capApt.set(c, s._orgApt || 0); // the ruling stock's heritable organisation aptitude
      capPos.set(c, s.pos);          // the capital — the anchor authority radiates from
      knOf.set(c, s.knowledge || {});
      // Empire SIZE is unlocked by TRANSPORT & COMMUNICATION tech, not raw
      // construction: a road-less realm stays regional however many monuments it
      // raises (the tyranny of distance), Roads make it Rome-scale, and only Rail
      // + Telegraph (+ steam/ocean for maritime) enable a continental, British-
      // scale empire — see tech.js logistics channel. Blended with the old
      // construction² curve by TECH_EFFECTS so the lever still reverts cleanly.
      const cons = (s.knowledge && s.knowledge.construction) || 0;
      const logi = s._techEff ? s._techEff.logisticsLevel : cons * cons;
      const eraMul = 1 + (cons * cons * REACH_ERA) * (1 - T.TECH_EFFECTS) + (logi * LOGI_REACH) * T.TECH_EFFECTS;
      // eraMul (the continental-logistics boost) is applied SIZE-GATED below, so a
      // one-city rump can't ride modern tech to a continental claim — store the base
      // reach and the boost separately.
      budget.set(c, (COUNTRY_REACH_BASE + org * COUNTRY_REACH_ORG) * resScale);
      eraBoost.set(c, eraMul);
      // The partition of the wastes is MODERN: pre-industrial states left the
      // deep desert / high ranges / ice as unclaimed marches (nothing to tax),
      // but the rail-and-telegraph era abolished terra nullius — straight
      // treaty lines through the Sahara, watershed conventions through the
      // Himalaya, polar claims — because empty land was claimed to PREEMPT
      // rivals once nominal control became projectable. So the barren-land
      // claim hostility FADES with logistics tech: medieval realms still hug
      // the rivers; industrial ones partition the wasteland to the midline.
      hostOf.set(c, CLAIM_HOSTILITY * Math.max(0, 1 - logi));
      claimCap.set(c, CLAIM_CAP_FLOOR + (CLAIM_CAP_CEIL - CLAIM_CAP_FLOOR) * Math.max(0, 1 - cons));
    }
  }
  // Reach must be BACKED by the realm, not just its capital's tech: scale the
  // budget by how many settlements the country actually has. Without this a
  // 3-city cradle with high construction projects a continental claim out of
  // nothing (the early-game balloon). A small realm is throttled to REACH_SIZE_MIN
  // of its tech-reach and earns the full continental projection only as it grows
  // to REACH_SIZE_REF settlements.
  for (const [c, b] of budget) {
    const mem = members.get(c) || 1;
    const rel = mem / REACH_SIZE_REF;
    const sf = rel >= 1
      ? 1 + (Math.sqrt(rel) - 1) * REACH_SIZE_SUPER   // size keeps paying past the reference (see REACH_SIZE_SUPER)
      : Math.max(REACH_SIZE_MIN, rel);
    // Continental logistics needs a network of cities — gate the era-boost by size so
    // a crumbling / one-city realm reaches only regionally (the hollow-husk fix).
    const emGated = 1 + ((eraBoost.get(c) || 1) - 1) * Math.min(1, mem / LOGI_SIZE_REF);
    const pers = world.personalities && world.personalities.get(c);
    const persMul = pers ? 1 + (pers.expansionism || 0) * CLAIM_PERS_SPAN : 1;
    // Heritable aptitude pays out as extra STATE CAPACITY (boost #2): a realm run
    // by a high-aptitude stock projects administrative reach further for the same
    // tech — the institutional edge of the "winter peoples" made territorial.
    const aptMul = T.ORG_APTITUDE > 0 ? 1 + T.ORG_APT_CAP * (capApt.get(c) || 0) : 1;
    budget.set(c, b * emGated * sf * persMul * aptMul);
  }
  // Ease each country's reach toward that (size-scaled tech) target so territory
  // grows in gradually instead of snapping to a continental claim in one pass
  // (smooths the mid-game explosion — see BUDGET_RAMP). A brand-new CRADLE starts
  // near the base reach and earns the rest over many passes; but a state born of
  // SECESSION / fragmentation / re-emergence (flagged in _inheritReach by snapClaim)
  // inherits an administered region and seeds at its FULL target at once, so the
  // land it broke off with stays held instead of reverting to wilderness while a
  // fresh reach ramps up.
  let ramp = world._cBudgetRamp; if (!ramp) ramp = world._cBudgetRamp = new Map();
  const inherit = world._inheritReach;
  for (const [c, target] of budget) {
    const prev = ramp.get(c);
    const next = prev === undefined
      ? ((inherit && inherit.has(c)) ? target : Math.min(target, COUNTRY_REACH_BASE * resScale))
      : prev + (target - prev) * BUDGET_RAMP;
    ramp.set(c, next);
    budget.set(c, next);
  }
  if (inherit && inherit.size) for (const c of inherit) if (ramp.has(c)) inherit.delete(c);   // one-shot, once seeded
  for (const c of [...ramp.keys()]) if (!budget.has(c)) ramp.delete(c);

  // Per-tile basin budget: how far the SEED that claimed a tile may project.
  // Normally the country's full reach; smaller for a freshly-integrated frontier
  // settlement (grows over INTEGRATE_TICKS) so captured land fills in gradually.
  let seedBud = world._countrySeedBud;
  if (!seedBud || seedBud.length !== N) seedBud = world._countrySeedBud = new Float64Array(N);
  const noise = claimNoise(world);

  // Seed: every country-affiliated settlement plants its country at cost 0, with
  // a basin budget capped by how INTEGRATED it is (a just-adopted wild settlement
  // starts at INTEGRATE_MIN and earns the full reach over INTEGRATE_TICKS).
  const heap = new MinHeap();
  const anchor = T.CAPITAL_ANCHOR;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;
    const c = s.countryId;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (!(elev[ti] > 0 && cost[ti] > 0)) continue;
    const full = budget.get(c) || 0;
    // EVERY settlement carves a basin — this is the COVERAGE, so populated land is
    // never abandoned to wilderness (a settlement always holds at least its own ground;
    // that's what stops a realm's outliers being stranded when the capital's reach dips).
    // Recency eases a just-adopted settlement in. The capital anchor compacts the union
    // into a blob — but in capital-COLOUR mode the recolor pass below reshapes the cells,
    // so we skip the anchor there and let each settlement hold its FULL basin (max
    // coverage), and let the recolor draw the smooth borders.
    const integMin = INTEGRATE_MIN * resScale;   // day-one basin is a tile distance → res-relative
    // This settlement's OWN reach: the national budget scaled by its size (√pop), but
    // never below its own ground. A great city wields the full national reach; a
    // frontier hamlet only its neighbourhood — so claims follow where the PEOPLE are,
    // and a one-hamlet rump can't fly a continental border.
    // DISSOLVE_FARMS: a settlement's `people` bundles its rural countryside, so a
    // big farming province would wield the FULL national reach and realms balloon to
    // span continents. Scale reach by the URBAN CORE instead — administrative reach
    // follows the city/court, not the peasantry — so only genuine cities project far
    // and a realm's extent stays bounded (as the many small farming regions bounded
    // it in the old model).
    // …and a higher pop reference under DISSOLVE: with far fewer (but bigger)
    // settlements, each covering its full reach over-claims the world, so a city
    // must be ~2.5× as populous to wield the full national reach. Together these
    // keep the largest realm a believable empire, not a continent-spanner.
    const claimPop = T.DISSOLVE_FARMS ? (s._urbanPop != null ? s._urbanPop : (s.people || 0)) : (s.people || 0);
    const ref = CLAIM_POP_REF * (T.DISSOLVE_FARMS ? 2.5 : 1);
    const reach = Math.max(integMin, full * Math.min(1, Math.sqrt(claimPop / ref)));
    const age = world.step - (s._integratedAt ?? -Infinity);
    let sb = age < INTEGRATE_TICKS
      ? Math.min(reach, integMin + Math.max(0, reach - integMin) * (age / INTEGRATE_TICKS))
      : reach;
    if (!_capitalOnly && anchor > 0) {
      const cp = capPos.get(c);
      if (cp) {
        let dx = Math.abs(s.pos.x - cp.x); if (dx > tw / 2) dx = tw - dx;
        const dy = s.pos.y - cp.y;
        const capDist = Math.sqrt(dx * dx + dy * dy);
        sb *= 1 / (1 + anchor * capDist / (ANCHOR_SCALE * resScale));
      }
    }
    cost[ti] = 0; co[ti] = c; seedBud[ti] = sb; heap.push(ti, 0, c);
  }
  // POWER-WEIGHTED BORDERS: a per-realm claim weight from its STRENGTH (capital
  // power: people × military × org). A stronger realm's flood accumulates cost more
  // slowly (ec / weight), so its boundary with a weaker neighbour falls PAST the
  // geometric midpoint — the strong push their sphere into the weak's frontier
  // (settled tiles are cost-0 sources, so cities still need conquest). Weight =
  // (strength / median strength)^CLAIM_POW, compressed and clamped so a hegemon
  // dominates its marches without eating the map. CLAIM_POW=0 → the old midpoint.
  const claimW = new Map();
  if (T.CLAIM_POW > 0) {
    const powByCountry = new Map();
    for (const s of world.settlements) {
      if (s.mode !== "settled" || s.countryId < 0) continue;
      const p = settlementPower(s);
      if (p > (powByCountry.get(s.countryId) || 0)) powByCountry.set(s.countryId, p);
    }
    const vals = [...powByCountry.values()].sort((a, b) => a - b);
    const ref = vals.length ? vals[vals.length >> 1] : 1;   // the MEDIAN realm strength is the neutral ×1 weight
    for (const [cid, p] of powByCountry) {
      const w = Math.pow(Math.max(1e-6, p / Math.max(1e-6, ref)), T.CLAIM_POW);
      claimW.set(cid, w < CLAIM_W_MIN ? CLAIM_W_MIN : w > CLAIM_W_MAX ? CLAIM_W_MAX : w);
    }
  }
  // Multi-source Dijkstra: every land tile goes to the nearest country (by travel
  // cost) within that country's reach budget; another country's tile is just a
  // cheaper claim, so the boundary lands on the (power-weighted) cost-bisector.
  while (heap.n > 0) {
    const { ti, d, c } = heap.popMin();
    if (d > cost[ti]) continue;
    const wc = claimW.get(c) || 1;   // power weight: strong realms accumulate cost slower
    const basinBud = seedBud[ti];                    // this basin's reach cap (recency-limited for new land)
    const kn = knOf.get(c);
    const cap = claimCap.get(c) || CLAIM_CAP_CEIL;   // construction-eased per-tile claim cost ceiling
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [
      ty * tw + xm, ty * tw + xp,
      ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1,
      ty > 0 ? (ty - 1) * tw + xm : -1, ty > 0 ? (ty - 1) * tw + xp : -1,
      ty < th - 1 ? (ty + 1) * tw + xm : -1, ty < th - 1 ? (ty + 1) * tw + xp : -1,
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      const water = elev[ni] <= 0;                       // sea / lake: traversable but never CLAIMED
      let ec = localEdgeCost(world, ti, ni, kn, true);   // roads ignored; water → Infinity unless the realm has the nav floor, then the sail cost
      if (ec === Infinity) continue;                     // pre-naval realms are still walled by the sea
      // Soft-cap eases harsh TERRAIN so mountains don't hard-wall a border — but
      // NOT water: the steep sail cost (× budget) is what confines a realm to short
      // crossings (a strait, an enclosed sea) and keeps it out of the open ocean.
      if (!water && ec > cap) ec = cap + (ec - cap) * CLAIM_SOFT;
      // Ribbon-hug: barren (low-fertility) land — deep desert, bare alpine rock — has
      // no population to settle or garrison, so a border barely crosses it. Amplify the
      // CLAIM cost there (only below CLAIM_FERT_REF, ∝ shortfall²) so a realm runs a long
      // thin claim up a green river/coast and stalls in the waste. Water is exempt.
      // Per-claimant: the hostility fades with the realm's logistics tech (hostOf —
      // the modern partition of the wastes; see the seeding loop).
      const host = hostOf.get(c) ?? CLAIM_HOSTILITY;
      if (!water && host > 0) {
        const fdef = (CLAIM_FERT_REF - (fert ? fert[ni] : CLAIM_FERT_REF)) / CLAIM_FERT_REF;
        if (fdef > 0) ec *= 1 + host * fdef * fdef;
        // Disease/tsetse claim resistance: the humid malaria + tsetse belt stalls a
        // border (sparse, stateless, near-impossible to administer); the open DRY
        // Sahel/steppe is untouched and still claims cheap (Mali, Songhai, the
        // khanates ran huge across the grass sea). Broadened from rainforest-only to
        // the savanna woodland — see habitability.js claimHostility.
        if (temp && moist) {
          const wt = claimHostility(temp[ni], moist[ni]);
          if (wt > 0) ec *= 1 + host * WET_TROPIC_RESIST * wt;
        }
      }
      ec *= 1 + (noise[ni] - 0.5) * (2 * NOISE_AMP);     // organic meander → borders wander instead of cutting straight
      const nd = d + ec * mul[k] / wc;                   // power-weighted: a stronger realm pushes its border past the midpoint
      if (nd > basinBud) continue;                       // basin's (recency-limited) reach budget — also caps how far a realm sails its border
      // Claim LAND; a water tile only propagates the cost frontier (a navy crossing
      // it), so the two shores of a narrow sea knit into ONE contiguous realm
      // without the sea itself flying a flag.
      if (nd < cost[ni]) { cost[ni] = nd; if (!water) co[ni] = c; seedBud[ni] = basinBud; heap.push(ni, nd, c); }
    }
  }
  // The capital pass only SMOOTHS borders (recolours already-claimed tiles to their
  // nearest capital). It claims no wilderness — coverage came entirely from the
  // per-settlement reach flood above, whose budget grows with each realm's own
  // logistics tech, so the continents fill (or don't) as development actually warrants.
  if (_capitalOnly) recolorByCapital(world, co, capPos, knOf, claimCap);
  fillEnclosedWaste(world, co);
  closeRealmGaps(world, co, T.REALM_GAP_FILL);
  smoothCountryBorders(world, co, T.BORDER_SMOOTH | 0);
  // Persistent-territory merge (lever on): the passes above produced the FRESH
  // reach-projection map; now durably re-assert the marches last pass's map held
  // that the live reach has since receded from, so borders track the conquest
  // ledger instead of snapping back with every fluctuation in a capital's strength.
  if (prev) {
    mergePersistentTerritory(world, co, prev);
    // The merge re-stamps the map from raw settlement catchments + sticky marches, which
    // UN-SMOOTHS the border straightening the pass above did — leaving ragged fringes and
    // thin march tendrils. Re-run the majority-filter smoothing on the merged result with
    // ALL worked (catchment) land pinned — that is real ledger-held land the merge just
    // asserted, and the filter used to recolour its edges to rival majorities one pass
    // after the merge granted them. Only the un-settled march protrusions erode,
    // straightening a realm into a coherent blob without touching what it actually holds.
    smoothCountryBorders(world, co, T.BORDER_SMOOTH | 0, /*pinWorked*/ true);
  }
  return co;
}

// ── Persistent territory (sticky political map) ────────────────────────────────
// The stateless reach-Voronoi (co, freshly computed this pass) sets borders on the
// CAPITAL cost-bisector (recolorByCapital), so worked land flips between two realms
// the instant their relative strength/reach shifts — with no conquest at all. That is
// the "samey / snapping" map: history doesn't show because the border tracks live
// power, not who actually HOLDS the ground. Persistence fixes the REPRESENTATION:
//
//   • CORE — a tile physically WORKED by a settlement (its food catchment,
//     _territoryOwner) is coloured by that settlement's COUNTRY (the conquest ledger),
//     overriding the capital bisector. A settlement's countryId changes only by
//     conquest / absorption / secession (conquest.js, armies.js), so worked land is
//     durable and path-dependent by construction — the union of a realm's catchments
//     IS its persistent heartland, and heavy-tailed seat counts become heavy-tailed
//     worked AREA. (Cities are cost-0 sources, so they never change hands here.)
//   • MARCH — a claimed tile with no settlement on it keeps the FRESH reach projection
//     (the frontier-projection layer the spec demotes the Voronoi to), but is made
//     STICKY: a march the reach receded from is durably re-asserted from last pass's
//     map (`prev`) while its owner lives.
//
// Two self-cleaning rules stop the map ratcheting solid: a march whose owner is dead,
// or no longer CONTIGUOUS (through same-owner land) with any core/reached tile of that
// owner, is released to wilderness — so when a realm's settlements move away its
// marooned marches fall back. Over-extension still sheds through secession (conquest.js).
function mergePersistentTerritory(world, co, prev) {
  const { N, tw, th, elev } = world;
  const owner = world._territoryOwner, byId = world._byId;   // per-settlement catchment → settlement
  // Countries still alive (hold ≥1 settled member) — a dead realm's marches must not linger.
  const alive = world._persistAlive || (world._persistAlive = new Set());
  alive.clear();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) alive.add(s.countryId);
  // CORE: recolour every WORKED tile to the country of the settlement that works it —
  // the ledger, not the capital bisector. These are the anchors the connectivity flood
  // below spreads from.
  let q = world._persistQ; if (!q || q.length !== N) q = world._persistQ = new Int32Array(N);
  let reached = world._persistReach; if (!reached || reached.length !== N) reached = world._persistReach = new Uint8Array(N);
  reached.fill(0);
  let qt = 0;
  if (owner && byId) {
    for (let ti = 0; ti < N; ti++) {
      if (elev[ti] <= 0) continue;
      const oid = owner[ti];
      if (oid < 0) continue;
      const s = byId.get(oid);
      if (!s || s.mode !== "settled" || s.countryId < 0) continue;
      co[ti] = s.countryId;                    // worked land = its settlement's realm (durable)
      reached[ti] = 1; q[qt++] = ti;           // and an anchor for march connectivity
    }
  }
  // MARCH stickiness: re-assert a march the fresh reach left WILD (co === -1) from last
  // pass while its owner lives; every other claimed tile (a fresh reach projection) is a
  // candidate march, connectivity-checked below.
  for (let ti = 0; ti < N; ti++) {
    if (elev[ti] <= 0) continue;
    if (co[ti] < 0) { const p = prev[ti]; if (p >= 0 && alive.has(p)) co[ti] = p; }
  }
  // Connectivity flood from the CORE anchors through same-owner tiles. A tile
  // (march) NOT reached from a core tile of its own owner is marooned (its
  // owner's settlements have moved on) and is released to wilderness.
  //
  // NAVAL CONTIGUITY: a land-only flood declared every across-water claim
  // marooned, killing the mare-nostrum / colonial-coast pattern the fresh
  // reach deliberately produces ("the two shores of a narrow sea knit into
  // ONE contiguous realm"). Contiguity may instead hop open water on a budget
  // set by the realm's own NAVIGATION: none below the seafaring floor (water
  // still breaks a chiefdom's realm), a strait's width at coastal seafaring,
  // a small sea for an ocean-going power. Resolution-scaled like every other
  // reach quantity, and read from the same emergent tech that prices sea
  // movement everywhere else — never from era or map identity.
  const hopOf = new Map();   // countryId → max consecutive water tiles bridged
  const hopBudget = (cid) => {
    let h = hopOf.get(cid);
    if (h === undefined) {
      const c = world.countries && world.countries.get(cid);
      const nav = (c && c.capital && c.capital.knowledge && c.capital.knowledge.navigation) || 0;
      // The seafaring floor is the SAME lever that gates water in the
      // transport cost field (T.NAV_EMBARK_THRESH) — claim production and
      // claim retention must agree on who can put to sea, or moving the
      // lever maroons legitimately-sailed shores (or retains unsailable
      // ones). Above the floor the bridgeable width ramps with navigation,
      // resolution-scaled like every reach quantity.
      h = nav < (T.NAV_EMBARK_THRESH ?? 0.10) ? 0 : Math.round((1 + 7 * nav) * resScaleFor(tw));
      hopOf.set(cid, h);
    }
    return h;
  };
  // Water hops carry (owner, depth) as explicit frontier entries, and a water
  // tile may be crossed by SEVERAL realms in one pass — exclusive first-touch
  // ownership let deterministic BFS order hand a contested strait to the same
  // realm every merge, marooning the rival's far-shore march every pass
  // forever. Land tiles stay single-owner (reached[] as before); only the
  // small coastal water fringe pays the per-owner bookkeeping.
  const wSeen = new Map();   // water ti → Set(ownerIds that crossed it)
  let wq = [];               // water frontier: [ti, owner, depth] triples
  const pushWater = (ni, oc, d) => {
    let s = wSeen.get(ni);
    if (!s) wSeen.set(ni, s = new Set());
    if (s.has(oc)) return;
    s.add(oc); wq.push(ni, oc, d);
  };
  for (let qh = 0; qh < qt; qh++) {
    const ti = q[qh];
    const oc = co[ti];
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k];
      if (ni < 0) continue;
      if (elev[ni] > 0) {
        if (!reached[ni] && co[ni] === oc) { reached[ni] = 1; q[qt++] = ni; }
      } else if (hopBudget(oc) > 0) {
        pushWater(ni, oc, 1);
      }
    }
    // Drain the water frontier interleaved: land found across water re-enters
    // the main land queue and continues flooding normally.
    for (let wh = 0; wh < wq.length; wh += 3) {
      const wi = wq[wh], woc = wq[wh + 1], wd = wq[wh + 2];
      const wy = (wi / tw) | 0, wx = wi - wy * tw;
      const wxm = wx === 0 ? tw - 1 : wx - 1, wxp = wx === tw - 1 ? 0 : wx + 1;
      const wns = [wy * tw + wxm, wy * tw + wxp, wy > 0 ? wi - tw : -1, wy < th - 1 ? wi + tw : -1];
      for (let k = 0; k < 4; k++) {
        const ni = wns[k];
        if (ni < 0) continue;
        if (elev[ni] > 0) {
          if (!reached[ni] && co[ni] === woc) { reached[ni] = 1; q[qt++] = ni; }
        } else if (wd < hopBudget(woc)) {
          pushWater(ni, woc, wd + 1);
        }
      }
    }
    wq.length = 0;
  }
  for (let ti = 0; ti < N; ti++) if (elev[ti] > 0 && co[ti] >= 0 && !reached[ti]) co[ti] = -1;
}

// ── Capital colouring ────────────────────────────────────────────────────────
// Smooth borders WITHOUT stranding anyone. The per-settlement Voronoi above gives
// full COVERAGE (every settlement holds ground, so populated land is never blank),
// but its country-vs-country seam zig-zags between rival settlements — the bubbly
// edge. So overlay a clean capital Voronoi: flood the whole landmass from every
// realm's CAPITAL (same terrain edge-cost + noise, so it slumps onto coasts/rivers),
// giving each land tile its NEAREST capital, then RECOLOUR every already-claimed tile
// to that capital's realm. Coverage is untouched (a tile stays claimed iff a
// settlement reached it) — only the COLOUR changes, so the border between two realms
// becomes the smooth capital cost-bisector while no settlement is ever left on
// wilderness. A border settlement nearer a RIVAL capital is recoloured to it (a
// frontier town joins the closer power) rather than stranded — there is always a
// successor, never blank ground.
function recolorByCapital(world, co, capPos, knOf, claimCap) {
  const { N, tw, th, elev } = world;
  let capColor = world._capColor;
  if (!capColor || capColor.length !== N) capColor = world._capColor = new Int32Array(N);
  let capCost = world._capCostF;
  if (!capCost || capCost.length !== N) capCost = world._capCostF = new Float64Array(N);
  capColor.fill(-1); capCost.fill(Infinity);
  const noise = claimNoise(world);
  const heap = new MinHeap();
  for (const [c, pos] of capPos) {
    const ti = (pos.y | 0) * tw + (pos.x | 0);
    if (elev[ti] <= 0) continue;
    capCost[ti] = 0; capColor[ti] = c; heap.push(ti, 0, c);
  }
  while (heap.n > 0) {
    const { ti, d, c } = heap.popMin();
    if (d > capCost[ti]) continue;
    const kn = knOf.get(c);
    const cap = claimCap.get(c) || CLAIM_CAP_CEIL;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [
      ty * tw + xm, ty * tw + xp,
      ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1,
      ty > 0 ? (ty - 1) * tw + xm : -1, ty > 0 ? (ty - 1) * tw + xp : -1,
      ty < th - 1 ? (ty + 1) * tw + xm : -1, ty < th - 1 ? (ty + 1) * tw + xp : -1,
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k]; if (ni < 0 || elev[ni] <= 0) continue;
      let ec = localEdgeCost(world, ti, ni, kn, true);
      if (ec === Infinity) continue;
      if (ec > cap) ec = cap + (ec - cap) * CLAIM_SOFT;
      ec *= 1 + (noise[ni] - 0.5) * (2 * NOISE_AMP);
      const nd = d + ec * mul[k];
      // Recolour ONLY already-claimed land (to its nearest capital). Wilderness is
      // never annexed here — coverage is whatever the per-settlement reach flood
      // actually reached, so this pass changes colours, never the claimed extent.
      if (co[ni] < 0) continue;
      if (nd < capCost[ni]) { capCost[ni] = nd; capColor[ni] = c; heap.push(ni, nd, c); }
    }
  }
  for (let ti = 0; ti < N; ti++) if (capColor[ti] >= 0) co[ti] = capColor[ti];   // recolour every claimed tile the flood reached to its nearest capital
}

// ── Enclosed-waste fill (the cartographer's rule) ──────────────────────
// Flood each UNCLAIMED land pocket (4-neighbour, x wraps; water and the poles
// seal). A pocket bordered by exactly ONE country — no rival claimant — is
// coloured in as that country's interior waste, capped at ENCLOSED_FILL_MAX ×
// the realm's claimed size. Pockets touching two countries (a contested march)
// or the open wilderness (frontier waste) stay wild — that's what keeps the
// Nile a ribbon while the Caliphate's inner desert is drawn solid. Filled
// tiles keep cost=Infinity: they're assertion, not administration, and the
// secession pass already treats settlement-less tiles as inert (conquest.js
// looseAt: no administering basin → never loose).
function fillEnclosedWaste(world, co) {
  const { N, tw, th, elev } = world;
  let seen = world._wasteSeen;
  if (!seen || seen.length !== N) seen = world._wasteSeen = new Uint8Array(N);
  seen.fill(0);
  const claimed = new Map();
  for (let ti = 0; ti < N; ti++) { const c = co[ti]; if (c >= 0) claimed.set(c, (claimed.get(c) || 0) + 1); }
  if (claimed.size === 0) return;
  const stack = [], comp = [];
  for (let i = 0; i < N; i++) {
    if (seen[i] || co[i] >= 0 || elev[i] <= 0) continue;
    comp.length = 0; stack.length = 0;
    stack.push(i); seen[i] = 1;
    let border = -2;                       // -2 none yet · -1 contested (≥2 realms)
    while (stack.length) {
      const ti = stack.pop(); comp.push(ti);
      const y = (ti / tw) | 0, x = ti - y * tw;
      const ns4 = [
        y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw),
        y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1,
      ];
      for (let k = 0; k < 4; k++) {
        const ni = ns4[k];
        if (ni < 0 || elev[ni] <= 0) continue;             // pole / water seals
        const oc = co[ni];
        if (oc >= 0) { if (border === -2) border = oc; else if (border !== oc) border = -1; continue; }
        if (!seen[ni]) { seen[ni] = 1; stack.push(ni); }
      }
    }
    if (border < 0) continue;              // open, island, or contested — stays wild
    if (comp.length > (claimed.get(border) || 0) * ENCLOSED_FILL_MAX) continue;
    for (let k = 0; k < comp.length; k++) co[comp[k]] = border;
  }
}

// ── Border smoothing ─────────────────────────────────────────────────────────
// The per-settlement cost-Voronoi gives every realm a SCALLOPED edge: each
// settlement claims a roughly circular basin, so a country's outline is the union
// of bubbles — nothing like a real border, which runs along a coast / river / ridge
// or as a clean negotiated line. Sweep a majority filter over the political map a
// few times: a land tile becomes whichever country (or wilderness) holds a clear
// majority of its 8 neighbours. Protrusions (a bubble poking out) erode, notches
// fill, so the frontier straightens toward a clean line and single-tile flecks
// dissolve — area roughly preserved. Settlement HOME tiles are pinned, so no realm
// is ever smoothed out of existence (its basin regrows next pass). Iterations =
// BORDER_SMOOTH. O(passes·N).
function smoothCountryBorders(world, co, iters, pinWorked = false) {
  if (!(iters > 0)) return;
  const { N, tw, th, elev } = world;
  let prot = world._smoothProt;
  if (!prot || prot.length !== N) prot = world._smoothProt = new Uint8Array(N);
  prot.fill(0);
  for (const s of world.settlements) { if (s.mode === "settled") prot[(s.pos.y | 0) * tw + (s.pos.x | 0)] = 1; }
  // Post-merge mode: every WORKED catchment tile (a live settlement's food
  // territory — the durable ledger land the merge just stamped) is pinned too.
  if (pinWorked && world._territoryOwner) {
    const own = world._territoryOwner;
    const pinnable = new Set();
    for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) pinnable.add(s.id);
    for (let ti = 0; ti < N; ti++) { const oid = own[ti]; if (oid >= 0 && pinnable.has(oid)) prot[ti] = 1; }
  }
  let snap = world._smoothSnap;
  if (!snap || snap.length !== N) snap = world._smoothSnap = new Int32Array(N);
  // tiny fixed-size tally over the ≤8 distinct neighbour values (cheaper than a Map)
  const vals = new Int32Array(8), cnts = new Int32Array(8);
  for (let it = 0; it < iters; it++) {
    snap.set(co);                                   // frozen read; writes go to co
    for (let ti = 0; ti < N; ti++) {
      if (elev[ti] <= 0 || prot[ti]) continue;      // water + settlement homes are fixed
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const yu = ty - 1, yd = ty + 1;
      const ns = [
        ty * tw + xm, ty * tw + xp,
        yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
        yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
        yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1,
      ];
      let m = 0, best = snap[ti], bestC = 0;
      for (let k = 0; k < 8; k++) {
        const ni = ns[k]; if (ni < 0 || elev[ni] <= 0) continue;   // off-map / sea doesn't vote
        const v = snap[ni];
        let j = 0; for (; j < m; j++) if (vals[j] === v) break;
        if (j === m) { vals[m] = v; cnts[m] = 1; m++; } else cnts[j]++;
        if (cnts[j] > bestC) { bestC = cnts[j]; best = v; }
      }
      if (bestC >= 5 && best !== snap[ti]) co[ti] = best;          // clear majority of the 8-neighbourhood → adopt it
    }
  }
}

// ── Partition the gaps: no terra nullius between neighbours ──────────────────
// Unclaimed LAND that sits BETWEEN claimed territory — flanked by a country on
// both sides of an axis (W&E or N&S) within D tiles — is handed to the NEARER of
// the flanking countries. So an interior gap of one realm fills solid (same
// country both sides), AND the no-man's-land BETWEEN two realms is split along
// the midline so they border directly — a modern wall-to-wall partition rather
// than a sea of blank buffer. What stays wilderness is the genuinely OPEN
// frontier: land with a country within D on only one side (or none), facing a
// large uninhabited expanse — the deep desert/ice/interior beyond any state's
// reach. WATER blocks the span (a strait is never bridged into land). Four linear
// sweeps → O(N). Set D=0 (REALM_GAP_FILL) to recover the raw cost-Voronoi basins.
function closeRealmGaps(world, co, D) {
  if (!(D > 0)) return;
  const { N, tw, th, elev } = world;
  // T.REALM_GAP_FILL is REFERENCE-tiles: the fillable no-man's-land is a real
  // width, so it scales like every other distance here (×resScale; audit 2026-07 —
  // it was raw tiles, so the shipped 960 grid closed gaps of only HALF the real
  // width the validated 240-tile reference did). ×1 exactly at the reference.
  D = D * resScaleFor(tw);
  // Per tile, the nearest country AND its distance looking W / E / N / S — with
  // wilderness transparent and water opaque (a ray dies at the coast).
  let buf = world._gapBuf;
  if (!buf || buf.wC.length !== N) buf = world._gapBuf = {
    wC: new Int32Array(N), eC: new Int32Array(N), nC: new Int32Array(N), sC: new Int32Array(N),
    wD: new Int32Array(N), eD: new Int32Array(N), nD: new Int32Array(N), sD: new Int32Array(N) };
  const { wC, eC, nC, sC, wD, eD, nD, sD } = buf;
  const FAR = 1 << 28;
  // The W/E sweeps WRAP (longitude is periodic — every other pass in this file
  // wraps, and an unwrapped sweep left gap-fill artifacts hugging the
  // antimeridian seam): each row is scanned twice, the second sweep carrying
  // the seam state across x=0 so a country just west of the seam flanks land
  // just east of it. N/S clamp (the poles don't wrap).
  for (let y = 0; y < th; y++) {                       // ← nearest country to the WEST
    let last = -1, lastP = -1e9; const row = y * tw;
    for (let p = 0; p < 2; p++) {
      if (p === 1) { if (last < 0) break; lastP -= tw; }   // carry across the seam
      for (let x = 0; x < tw; x++) { const ti = row + x;
        if (elev[ti] <= 0) { last = -1; lastP = -1e9; if (p === 0) { wC[ti] = -1; wD[ti] = FAR; } continue; }
        const d = x - lastP;
        if (last >= 0 && d <= D) {
          if (p === 0 || d < wD[ti]) { wC[ti] = last; wD[ti] = d; }
        } else if (p === 0) { wC[ti] = -1; wD[ti] = FAR; }
        else break;                                        // second sweep only matters within D of the seam
        if (co[ti] >= 0) { last = co[ti]; lastP = x; if (p === 1) { p = 2; break; } }
      }
    }
  }
  for (let y = 0; y < th; y++) {                       // → nearest country to the EAST
    let last = -1, lastP = 1e9; const row = y * tw;
    for (let p = 0; p < 2; p++) {
      if (p === 1) { if (last < 0) break; lastP += tw; }   // carry across the seam
      for (let x = tw - 1; x >= 0; x--) { const ti = row + x;
        if (elev[ti] <= 0) { last = -1; lastP = 1e9; if (p === 0) { eC[ti] = -1; eD[ti] = FAR; } continue; }
        const d = lastP - x;
        if (last >= 0 && d <= D) {
          if (p === 0 || d < eD[ti]) { eC[ti] = last; eD[ti] = d; }
        } else if (p === 0) { eC[ti] = -1; eD[ti] = FAR; }
        else break;
        if (co[ti] >= 0) { last = co[ti]; lastP = x; if (p === 1) { p = 2; break; } }
      }
    }
  }
  for (let x = 0; x < tw; x++) {                       // ↓ nearest country to the NORTH
    let last = -1, lastP = -1e9;
    for (let y = 0; y < th; y++) { const ti = y * tw + x;
      if (elev[ti] <= 0) { last = -1; lastP = -1e9; nC[ti] = -1; nD[ti] = FAR; continue; }
      const d = y - lastP;
      if (last >= 0 && d <= D) { nC[ti] = last; nD[ti] = d; } else { nC[ti] = -1; nD[ti] = FAR; }
      if (co[ti] >= 0) { last = co[ti]; lastP = y; }
    }
  }
  for (let x = 0; x < tw; x++) {                       // ↑ nearest country to the SOUTH
    let last = -1, lastP = 1e9;
    for (let y = th - 1; y >= 0; y--) { const ti = y * tw + x;
      if (elev[ti] <= 0) { last = -1; lastP = 1e9; sC[ti] = -1; sD[ti] = FAR; continue; }
      const d = lastP - y;
      if (last >= 0 && d <= D) { sC[ti] = last; sD[ti] = d; } else { sC[ti] = -1; sD[ti] = FAR; }
      if (co[ti] >= 0) { last = co[ti]; lastP = y; }
    }
  }
  // Fill ONLY tiles ENCLOSED on all four cardinal sides within D — a genuine
  // pocket / hole / surrounded buffer — and hand each to its NEAREST flanking
  // country. Requiring all four (not just one opposite pair) is what stops thin
  // axis-aligned CHANNELS from filling: a one-axis flank would string two far
  // basins together with a rectilinear finger, which read as "weirdly stringy"
  // countries. A pocket is open on no side, so it fills cleanly without fingers;
  // open frontiers and long buffers (open on a perpendicular axis) stay wilderness.
  // (gather first, write after, so fills don't seed off each other within a pass.)
  // ── Smooth assignment ────────────────────────────────────────────────
  // Each enclosed no-man's-land tile goes to the country nearest by an 8-connected
  // flood from every country border — a real distance field, so the filled gaps
  // meet on smooth Voronoi bisectors. The OLD rule handed each tile to the nearest
  // of its four CARDINAL flanks; that axis-aligned metric made the bisectors cross
  // in straight bars, stamping rectilinear "X"/"H" shapes into the no-man's-land
  // (the worse the more gap the now-compact realms leave to fill). The 4-sweep test
  // above still decides WHICH tiles are fillable (genuinely enclosed pockets), so
  // open frontier and long buffers stay wild — only the COLOURING of the pockets
  // changes. O(N): each tile enters the flood queue at most once.
  let near = world._gapNear;
  if (!near || near.length !== N) near = world._gapNear = new Int32Array(N);
  let bq = world._gapQ;
  if (!bq || bq.length !== N) bq = world._gapQ = new Int32Array(N);
  let bd = world._gapBD;
  if (!bd || bd.length !== N) bd = world._gapBD = new Int32Array(N);
  near.fill(-1);
  let qt = 0;
  for (let ti = 0; ti < N; ti++) if (elev[ti] > 0 && co[ti] >= 0) { near[ti] = co[ti]; bd[ti] = 0; bq[qt++] = ti; }
  for (let qh = 0; qh < qt; qh++) {
    const ti = bq[qh]; const d = bd[ti]; if (d >= D) continue;     // bounded by the gap-fill range
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty*tw+xm, ty*tw+xp, ty>0?ti-tw:-1, ty<th-1?ti+tw:-1,
                ty>0?(ty-1)*tw+xm:-1, ty>0?(ty-1)*tw+xp:-1, ty<th-1?(ty+1)*tw+xm:-1, ty<th-1?(ty+1)*tw+xp:-1];
    for (let k = 0; k < 8; k++) { const ni = ns[k]; if (ni < 0 || elev[ni] <= 0 || near[ni] >= 0) continue; near[ni] = near[ti]; bd[ni] = d + 1; bq[qt++] = ni; }
  }
  let fills = world._gapFills;
  if (!fills || fills.length < N) fills = world._gapFills = new Int32Array(N);
  let n = 0;
  for (let ti = 0; ti < N; ti++) {
    if (co[ti] >= 0 || elev[ti] <= 0) continue;
    if (wC[ti] < 0 || eC[ti] < 0 || nC[ti] < 0 || sC[ti] < 0) continue;   // not fully enclosed → leave wild (no fingers)
    const c = near[ti];                                                   // smooth nearest country (not the axis-aligned cardinal flank)
    if (c >= 0) { fills[n++] = ti; fills[n++] = c; }
  }
  for (let i = 0; i < n; i += 2) co[fills[i]] = fills[i + 1];
}

// Settlements take their politics from the GROWN territory — the country whose
// border has actually CRAWLED over their tile (grownOwnerAt → world._countryClaim),
// NOT the realm's instantly-projected reach (world._countryOwner). So a settlement
// is claimed once the country grows over it, never ahead of the visible front:
//   • CITY (tier ≥ CITY_TIER): a sovereign ANCHOR. Keeps its countryId (changed
//     only by conquest / secession). A stateless city FOUNDS a country — its own
//     id if the border hasn't reached it, or joins the realm whose land it's on.
//   • VILLAGE / TOWN: never sovereign — adopts the country whose claim has grown
//     over its tile, or stays stateless (-1) until the front arrives. So spawning
//     many villages just populates the map; it never adds a country or a fleck,
//     and a frontier town waits for the border instead of lighting up early.
// (Cradles are seeded sovereign at genesis in state.js; secession mints city-led
// countries in conquest.js — those are the only other country sources.)
export function adoptAndFound(world) {
  const co = world._countryOwner, tw = world.tw, elev = world.elev, moist = world.moist;
  if (!co) return;   // territory pass hasn't run yet — nothing to adopt from
  // Per-realm statecraft, for the STATECRAFT-SYMMETRY adoption gate below: the
  // realm's most-organised settlement (the same fallback computeCountryTerritory
  // uses when no political capital is known) carries its administrative capacity.
  const realmOrg = new Map();
  const alive = new Set();
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;
    alive.add(s.countryId);
    const o = (s.knowledge && s.knowledge.organization) || 0;
    if (o > (realmOrg.get(s.countryId) || 0)) realmOrg.set(s.countryId, o);
  }
  // FIELD POLITY: a subject settlement derives its flag from the AUTHORED field
  // (_countryOwner) directly — the field's frontier growth is already throttled by
  // capacity, so there is no need for the render-crawl's implicit anti-runaway lag
  // (grownLiveOwnerAt reads the crawl; that throttle is an entity-model artefact).
  const fieldPolity = !!T.FIELD_POLITY;
  const ownerAt = (ti) => {
    if (fieldPolity) { const id = co[ti]; return id >= 0 && alive.has(id) ? id : -1; }
    return grownLiveOwnerAt(world, ti);
  };
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    const region = elev[ti] > 0 ? ownerAt(ti) : -1;
    // A CITY is a sovereign anchor; so is a frontier SEAT minted by
    // nucleateFrontierStates (a regional-leader town that founded a state — it
    // never reaches city tier in isolation, so it carries sovereignty by flag).
    if ((s.tier | 0) >= CITY_TIER || s._sovereignSeat) {
      if (s.countryId < 0) {
        s.countryId = region >= 0 ? region : s.id;   // stateless anchor: join its region, else found
        s._integratedAt = world.step;                // new sovereign / adopted land integrates its territory in gradually (anti-bloom; see INTEGRATE_*)
      }
      // a town/city with a country keeps it (sovereign)
    } else {
      // A developed frontier settlement stranded in TRUE WILDERNESS (beyond EVERY realm's
      // reach, co[ti] < 0, not merely outside the crawled border) — FOUNDS its own city-state
      // instead of persisting as a stateless economy in no-man's-land. The "real settlement"
      // bar is a TOWN (tier ≥ 1) OR a TIER-LOCKED CENTRE: a settlement developed enough to be a
      // town (organisation past the tier-1 statecraft threshold ≈0.60, tierCapForOrg) and grown
      // past regional-centre size, but pinned at tier 0 BECAUSE it is stateless (tier promotion
      // needs a state's hierarchy). Without that second clause such a settlement could NEVER
      // meet the founding bar — statelessness locked its tier, the tier gate blocked founding —
      // so it stayed nationless and, in the modern carrying-capacity boom, ballooned into a
      // multi-million-soul NATIONLESS MEGACITY (the pathology this guards against). A mere
      // hamlet (tier 0, undeveloped or small) still just waits — not every hamlet is a state.
      const org = (s.knowledge && s.knowledge.organization) || 0;
      const tierLockedCentre = (s.tier | 0) >= 1 || (org >= 0.60 && (s.people || 0) >= NUCLEATE_SEAT_POP);
      // FOREST/IRON gate (same as nucleateFrontierStates): an unbroken temperate forest
      // can be perfectly clever yet stay a stateless tribe until metallurgy clears it —
      // so a forested no-iron centre needs far more people before it founds a realm, even
      // a developed one. River valleys / open ground / iron-bearing forests are unaffected.
      const moistAt   = s._climMoist ?? (moist ? moist[ti] : 0.5);
      const riverOpen = Math.min(1, (s._riverAcc || 0) / 0.30);
      const ironReady = Math.min(1, ((s.knowledge && s.knowledge.metallurgy) || 0) / (T.LAND_CLEAR_METAL || 0.55));
      const forestLk  = Math.max(0, Math.min(1, (moistAt - 0.38) / 0.20)) * (1 - riverOpen) * (1 - ironReady);
      const forestBar = NUCLEATE_SEAT_POP * (1 + T.STATE_FOREST * forestLk);
      if (s.countryId < 0 && region < 0 && tierLockedCentre && co[ti] < 0
          && org >= T.ORG_STATE_MIN                       // the statecraft for territorial rule
          && (s.people || 0) >= forestBar) {              // and the people to clear+farm forest without iron
        s.countryId = s.id; s._sovereignSeat = world.step; s.loyalty = 1; s._integratedAt = world.step;
        ensurePolity(world, s.id, { how: "frontier", seat: s });
        continue;
      }
      // otherwise village / town: follow the land (region), or stateless on the frontier
      if (s.countryId !== region) {
        if (s.countryId < 0 && region >= 0) {
          // STATECRAFT SYMMETRY (docs/country-count-size-diagnosis.md): annexing an
          // INDEPENDENT community is territorial administration, and takes the same
          // organisation the founding bar demands of a people founding a state
          // (T.ORG_STATE_MIN — "the statecraft for territorial rule", exactly the
          // gate three lines up). A realm below it hasn't the records/bureaucracy
          // to integrate outsiders: its border crawling over a stateless settlement
          // does not make that settlement a subject — it stays independent
          // (primary-state fuel) until a QUALIFIED state reaches it or it founds/
          // joins one itself. Realm↔realm transfers (border shifts over already-
          // stated settlements) and losses to statelessness are untouched — those
          // are conquest/border dynamics, not primary adoption.
          if ((realmOrg.get(region) || 0) < T.ORG_STATE_MIN) continue;
          s._integratedAt = world.step;   // wild → joined a realm: grow its basin in from the border, don't bloom
        }
        s.countryId = region;
      }
    }
  }
}

// ── Frontier state nucleation (primary state formation) ───────────────
// Without this, new countries came ONLY from secession: a lone frontier
// settlement never reaches CITY tier in isolation (no trade network, no state
// backing — confirmed by tools/probe_genesis.mjs: 0 foundings, stateless cities
// always 0), so the founding bar in adoptAndFound could never be met, and
// stateless hamlets just got adopted by an expanding neighbour.
//
// Here a developed CLUSTER of stateless settlements on the open frontier
// crystallises into a NEW country — its largest member becomes the sovereign
// SEAT (a primary state), the rest become its first provinces once its territory
// floods out. Because "stateless" already means "on land beyond every empire's
// reach", a viable cluster encodes both of the things that should drive this:
// QUALITY of location (population actually grew there) and DISTANCE from other
// countries (it's unclaimed frontier) — with an explicit capital-distance gate
// on top so a new state can't pop up in an empire's heartland. Gated on real
// cluster population so the country count stays controlled (no micro-state swarm).
const NUCLEATE_R          = 9;      // cluster/basin radius, REFERENCE-tiles (×resScaleFor at other grids — a real distance)
const NUCLEATE_SEAT_POP   = 160;    // the seat must be a real regional centre (a large village / town)
const NUCLEATE_CLUSTER_POP= 400;    // total stateless population nearby to be a viable state
const NUCLEATE_CAP_DIST   = 8;      // ...and at least this far from any existing capital (REFERENCE-tiles, ×resScaleFor)
const NUCLEATE_MAX_PASS   = 4;      // cap new states minted per territory pass (anti-bloom)
// State-capacity gate (Diamond/Scott): a STATE needs a storable, taxable surplus,
// not just bodies. Forager-dense but low-surplus land (the wet tropics, leached
// rainforest, thin steppe) supported plenty of PEOPLE but few STATES — so the
// founding bar scales UP where the land's carrying capacity is low. A fertile
// river valley crystallises a state off a few hundred people; the Congo or the
// outback needs several times that, and so mostly stays peopled-but-stateless —
// a sparse frontier rather than the uniform statelet-patchwork that filled every
// habitable tile before. Capacity is read from the seat's fertility (which the
// alluvial boost already makes high on a fertile-river-in-desert cradle and low
// in already-wet rainforest).
const NUCLEATE_CAP_FERT_REF = 0.55;  // fertility at/above which the founding bar is at its floor
const NUCLEATE_CAP_SPREAD   = 3.0;   // low-capacity land needs up to (1+this)× the population to form a state
export function nucleateFrontierStates(world) {
  const lever = T.FRONTIER_FOUNDING;          // 0 = off (old behaviour), 1 = default, >1 = easier
  if (!(lever > 0)) return;
  const tw = world.tw, halfTw = tw / 2;
  // The founding radius and the capital-isolation gate are REAL distances
  // (res-invariance 2026-07): NUCLEATE_R is the basin whose people can cohere
  // into one polity, NUCLEATE_CAP_DIST the isolation that makes it frontier.
  // Raw, a finer grid gathered 1/rs² of the real basin's people (the per-real-
  // area popField sums per tile), so the viability bar was quietly ×rs² harder:
  // at the shipped 1920 default state birth all but stopped — the map kept a
  // stateless low-org tail and claimed% stalled. ×1 exactly at the reference.
  const _rsN = resScaleFor(tw);
  const nucR = NUCLEATE_R * _rsN, nucRi = Math.round(nucR);
  const seatPop = NUCLEATE_SEAT_POP / lever, clusterPop = NUCLEATE_CLUSTER_POP / lever;
  const capD2 = ((NUCLEATE_CAP_DIST * _rsN) / Math.sqrt(lever)) ** 2;
  const caps = [];
  if (world.countries) for (const c of world.countries.values()) if (c.capital && c.capital.mode === "settled") caps.push(c.capital.pos);
  const fert = world.fert, moist = world.moist;
  // ── BIRTH_FIELD (§4b, field-polity-spec): states are born of the PEOPLED LAND ──
  // Cluster viability was the summed CENSUS of nearby stateless settlements — but
  // under cities-only entities the census is the urban network, not the people, so
  // state birth was gated on URBAN density (countries "spawn with" settlement
  // clusters). Under the lever a candidate seat's viability is the STATELESS BASIN's
  // people: the popField mass over unclaimed land within the founding radius,
  // expressed in census units through the global census↔field exchange rate (both
  // totals exist from genesis — no realm-median needed before realms exist). The
  // seat itself stays a real city with the org/size gates (a court needs a seat);
  // what changed is WHOSE substance carries statehood — a lone town amid a dense
  // peopled valley founds the state its basin can carry, a cluster of towns on
  // empty land no longer manufactures one. 0 = the census cluster (byte-identical).
  let f2c = 0;
  if (T.BIRTH_FIELD > 0 && T.POP_FIELD && world.popField && world._countryOwner) {
    let cenT = 0, pfT = 0;
    for (const s of world.settlements) if (s.mode === "settled") cenT += s.people || 0;
    const pfA = world.popField, elevA = world.elev, Nn = world.N;
    for (let ti = 0; ti < Nn; ti++) if (elevA[ti] > 0) pfT += pfA[ti];
    if (cenT > 0 && pfT > 0) f2c = cenT / pfT;
  }
  const cand = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId >= 0) continue;
    // STATECRAFT GATE: a people without the organisation for territorial rule stays
    // STATELESS — a chiefdom/tribe that holds no bordered land (most of the pre-modern
    // world). Only once organisation crosses the threshold does a bordered realm
    // crystallise, so undeveloped frontiers no longer carve the map wall-to-wall.
    if (((s.knowledge && s.knowledge.organization) || 0) < T.ORG_STATE_MIN) continue;
    // State-capacity multiplier: low-fertility land needs a far bigger cluster
    // to crystallise a state (so it stays a sparse stateless frontier).
    const seatTi = (s.pos.y | 0) * tw + (((s.pos.x | 0) % tw) + tw) % tw;
    const capNorm = fert ? Math.min(1, Math.max(0, fert[seatTi] / NUCLEATE_CAP_FERT_REF)) : 1;
    // Broken, compartmented terrain splinters into many small states (the Aegean,
    // Italy, the Caucasus): ruggedness EASES the founding bar, so a smaller pocket
    // can hold out as its own polity. The disease-ridden wet tropics RAISE it: the
    // Congo / West-Africa / Amazon belt stayed segmentary and stateless far longer
    // than the temperate world or the warm-DRY river cradles (the Nile, Mesopotamia,
    // which carry no wet-tropic burden), so a centralised state needs a much bigger
    // population there to coalesce — leaving more land unclaimed (Diamond's thesis).
    // FOREST/IRON gate: an unbroken temperate forest can be high-tech yet stay a
    // stateless tribe until metallurgy gives it the axes + heavy plough to clear and
    // farm the woodland — why N. Europe / Russia / the N. American forest belt lagged
    // the open river cradles. River valleys (open alluvium) and already-cleared land
    // are exempt; the lock lifts as iron (metallurgy → LAND_CLEAR_METAL) arrives.
    const moistAt   = s._climMoist ?? (moist ? moist[seatTi] : 0.5);
    const riverOpen = Math.min(1, (s._riverAcc || 0) / 0.30);
    const forest    = Math.max(0, Math.min(1, (moistAt - 0.38) / 0.20)) * (1 - riverOpen);
    const ironReady = Math.min(1, ((s.knowledge && s.knowledge.metallurgy) || 0) / (T.LAND_CLEAR_METAL || 0.55));
    const forestLocked = forest * (1 - ironReady);
    const capMul = (1 + NUCLEATE_CAP_SPREAD * (1 - capNorm)) * (1 + T.STATE_DISEASE * (s._wetTropic || 0))
                 * (1 + T.STATE_FOREST * forestLocked)
                 / (1 + T.FRAGMENT * (s._rugged || 0));
    if ((s.people || 0) < seatPop * capMul) continue;
    let dCap = Infinity;                        // isolation from existing states' heartlands
    for (const p of caps) { let dx = Math.abs(p.x - s.pos.x); if (dx > halfTw) dx = tw - dx; const dy = p.y - s.pos.y; const d2 = dx * dx + dy * dy; if (d2 < dCap) dCap = d2; }
    if (caps.length && dCap < capD2) continue;
    let cp = 0, isLeader = true;                // viable cluster + this settlement leads it
    forEachNear(world, s.pos.x, s.pos.y, nucR, (o) => {
      if (o.mode !== "settled" || o.countryId >= 0) return;
      cp += o.people || 0;
      const op = o.people || 0, sp = s.people || 0;
      if (op > sp || (op === sp && o.id < s.id)) isLeader = false;
    });
    if (f2c > 0) {
      // BIRTH_FIELD: viability = the stateless basin's people (see the header note).
      // Leadership stays census-ranked — the seat is the leading CITY around (role 2).
      const pfA = world.popField, coA = world._countryOwner, elevA = world.elev, thh = world.th;
      const sy = s.pos.y | 0, sx = s.pos.x | 0;
      let mass = 0;
      for (let dy = -nucRi; dy <= nucRi; dy++) {
        const yy = sy + dy; if (yy < 0 || yy >= thh) continue;
        for (let dx = -nucRi; dx <= nucRi; dx++) {
          if (dx * dx + dy * dy > nucRi * nucRi) continue;
          const ti2 = yy * tw + (((sx + dx) % tw) + tw) % tw;
          if (!(elevA[ti2] > 0) || coA[ti2] >= 0) continue;   // claimed ground already carries a state
          mass += pfA[ti2];
        }
      }
      cp = mass * f2c;
    }
    if (isLeader && cp >= clusterPop * capMul) cand.push({ s, cp });
  }
  if (!cand.length) return;
  cand.sort((a, b) => b.cp - a.cp);             // most-developed clusters first
  const placed = []; let n = 0;
  for (const { s } of cand) {
    if (n >= NUCLEATE_MAX_PASS) break;
    let tooClose = false;                        // don't mint two adjacent states in one pass
    for (const p of placed) { let dx = Math.abs(p.x - s.pos.x); if (dx > halfTw) dx = tw - dx; const dy = p.y - s.pos.y; if (dx * dx + dy * dy < (nucR * 2) ** 2) { tooClose = true; break; } }
    if (tooClose) continue;
    s.countryId = s.id; s._sovereignSeat = world.step; s.loyalty = 1; s._integratedAt = world.step;
    ensurePolity(world, s.id, { how: "frontier", seat: s });
    placed.push({ x: s.pos.x, y: s.pos.y }); n++;
  }
}

// Re-export the city threshold so other passes agree on what a "city" is.
export { CITY_TIER };
