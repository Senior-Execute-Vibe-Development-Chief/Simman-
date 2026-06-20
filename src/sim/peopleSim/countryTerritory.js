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
import { grownOwnerAt } from "./countryClaim.js";
import { ensurePolity } from "./entities.js";
import { T } from "./tuning.js";
import { stepToYear } from "../calendar.js";

// Per-country reach (transport-cost) projected from its settlements: a country
// claims land out to COUNTRY_REACH_BASE + capital-organisation × COUNTRY_REACH_ORG
// of travel cost from its nearest settlement. Org-scaled, so primitive realms
// stay compact (the early map fragments into small city-states with wilderness
// between) and high-org empires reach far (consolidation with the era). Beyond
// it, land is wilderness — which is where stateless frontier hamlets live.
const COUNTRY_REACH_BASE = 4;   // small base so ORGANISATION dominates reach — a weak chiefdom holds a tiny core, an empire projects far (was 8: even org→0 states sprawled)
const COUNTRY_REACH_ORG  = 14;   // reach per organisation tech (was 20 — empires were continental too early)
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
// Wet-tropic claim resistance: hot AND wet rainforest (the Congo, the Amazon, New
// Guinea) was easy to walk through but near-impossible to ADMINISTER — disease,
// no roads, leached soil, no storable surplus to tax or garrison. So it amplifies
// CLAIM cost like a soft waste, leaving the deep wet tropics a sparse stateless
// frontier rather than another wall-to-wall statelet patchwork. Crucially it keys
// on hot+WET, so the open hot+DRY steppe/savanna (Sahel, the khanates' grass sea)
// is untouched and still claims cheap. Scaled by the realm's `host` factor, so it
// fades with logistics tech — pre-modern realms stall at the jungle edge, the
// industrial/colonial era finally penetrates it.
const WET_TROPIC_RESIST = 1.0;
const WET_TROPIC_T0 = 0.78, WET_TROPIC_TSPAN = 0.10;   // temperature ramp (matches the agri wet-tropic penalty)
const WET_TROPIC_M0 = 0.60, WET_TROPIC_MSPAN = 0.25;   // moisture ramp
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
// The industrial "closing of the frontier": once rail+telegraph make nominal
// control projectable, states partition ALL contiguous land to the nearest
// capital (no terra nullius ~1900). Modelled cheaply in recolorByCapital as a
// wilderness-claim cost budget that GROWS (quadratically, so it bites only the
// late industrial era) with the world's logistics level — pre-modern realms still
// hug rivers/coasts; industrial ones fill the continents to the midline. The flood
// is one O(land) pass, so this is far cheaper than projecting bigger reach-disks.
// The multi-source capital Voronoi saturates at a SMALL budget (each capital only
// has to reach the midpoint to its neighbours), so the budget is modest and ramps
// THROUGH the critical range over the industrial era — a sudden huge budget both
// snaps to 100% overnight AND over-extends realms into collapse. Tuned so the fill
// climbs across ~1845–1900 (the real Scramble) and tops out near-complete by ~1930.
const FRONTIER_CLOSE = 28;    // wilderness-claim budget at era 1 = FRONTIER_CLOSE · resScale · era² (was 80: the modern era colonised ALL the wastes, abolishing terra nullius — eased so undeveloped frontiers keep their unclaimed wilderness)
const FRONTIER_DOM   = 0.7;   // a DOMINANT realm pushes its wilderness-claim frontier farther (budget × dominance^this):
                              // the great powers partition the open interior into continental empires (Russia, the USA,
                              // the Raj, the Scramble) instead of every realm grabbing an equal slice — bounded by the
                              // competitive midline where rival floods meet (conquest.js _dominance)
const DOM_HINTERLAND = 2;     // a dominant core also claims its regional HINTERLAND ahead of the industrial close
                              // (budget × resScale × (dominance−1) × hinterland-era): an ordinary realm gets 0 (open
                              // marches preserved), but a Rome / Persia / Mongol fills its near-wilderness, so the
                              // classical & medieval great powers tower regionally, not just the modern continental ones
const HINTER_YEAR0   = -1000; // hinterland-claim begins (deep antiquity keeps its empty marches even under a strong core)
const HINTER_YEAR1   = 200;   // …full by the classical era (the age of Rome, Han, Persia, the Maurya)
const FRONTIER_YEAR0 = 1760;  // the close BEGINS (era 0) — pre-industrial world keeps its open marches / terra nullius
const FRONTIER_YEAR1 = 1930;  // era 1 — the whole partitioned world (Scramble for Africa done ~1914)
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
function resScaleFor(tw) { return _resScaleEnv > 0 ? _resScaleEnv : Math.max(1, tw / RES_REF_W); }
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

class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.c = new Int32Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const k = this.cap * 2; const t = new Int32Array(k); t.set(this.ti); this.ti = t; const d = new Float64Array(k); d.set(this.d); this.d = d; const c = new Int32Array(k); c.set(this.c); this.c = c; this.cap = k; }
  push(ti, d, c) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; this.c[i] = c; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; this._sw(p, i); i = p; } }
  _sw(a, b) { const t = this.ti[a]; this.ti[a] = this.ti[b]; this.ti[b] = t; const d = this.d[a]; this.d[a] = this.d[b]; this.d[b] = d; const c = this.c[a]; this.c[a] = this.c[b]; this.c[b] = c; }
  popMin() { const ti = this.ti[0], d = this.d[0], c = this.c[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; this.c[0] = this.c[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; this._sw(b, i); i = b; } } return { ti, d, c }; }
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

// Clean per-country cost-Voronoi → world._countryOwner. Runs on the territory pass.
export function computeCountryTerritory(world) {
  const { N, tw, th, elev, fert, temp, moist } = world;
  const resScale = resScaleFor(tw);   // tile budgets are res-relative → keep the same world-fraction at any grid size (see RES_REF_W)
  let co = world._countryOwner;
  if (!co || co.length !== N) co = world._countryOwner = new Int32Array(N);
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
  let maxLogi = 0;                   // world's highest logistics level — gates the industrial frontier-close
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
      if (logi > maxLogi) maxLogi = logi;   // the world's leading logistics level → drives the frontier-closing budget
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
    const reach = Math.max(integMin, full * Math.min(1, Math.sqrt((s.people || 0) / CLAIM_POP_REF)));
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
  // Multi-source Dijkstra: every land tile goes to the nearest country (by travel
  // cost) within that country's reach budget; another country's tile is just a
  // cheaper claim, so the boundary lands on the cost-bisector (clean border).
  while (heap.n > 0) {
    const { ti, d, c } = heap.popMin();
    if (d > cost[ti]) continue;
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
        // Wet-tropic resistance: hot+wet rainforest stalls a border (sparse,
        // stateless deep tropics); hot+dry steppe is untouched.
        if (temp && moist) {
          const wt = Math.min(1, Math.max(0, (temp[ni] - WET_TROPIC_T0) / WET_TROPIC_TSPAN))
                   * Math.min(1, Math.max(0, (moist[ni] - WET_TROPIC_M0) / WET_TROPIC_MSPAN));
          if (wt > 0) ec *= 1 + host * WET_TROPIC_RESIST * wt;
        }
      }
      ec *= 1 + (noise[ni] - 0.5) * (2 * NOISE_AMP);     // organic meander → borders wander instead of cutting straight
      const nd = d + ec * mul[k];
      if (nd > basinBud) continue;                       // basin's (recency-limited) reach budget — also caps how far a realm sails its border
      // Claim LAND; a water tile only propagates the cost frontier (a navy crossing
      // it), so the two shores of a narrow sea knit into ONE contiguous realm
      // without the sea itself flying a flag.
      if (nd < cost[ni]) { cost[ni] = nd; if (!water) co[ni] = c; seedBud[ni] = basinBud; heap.push(ni, nd, c); }
    }
  }
  // Industrial frontier-close: nominal control only becomes projectable with RAIL +
  // TELEGRAPH (high logistics) — roads gave Rome its marches, not a closed frontier.
  // Engage only above FRONTIER_LOGI, then ramp quadratically to a map-spanning budget
  // by full industrialisation (~1900). Zero through antiquity and the medieval world.
  world._maxLogi = maxLogi;
  // The closing of the frontier is a calendar event (~1650→1920: the colonial
  // scramble + the abolition of terra nullius). The calendar is itself tech-pace
  // calibrated (stepToYear tracks the LEADING civilisation), so gating on the year
  // gives a tech-driven close that reliably fires by the industrial era — the raw
  // logistics level plateaus too low to threshold on. era² ⇒ back-loaded (sharp
  // ~1900), matching how fast the world actually partitioned.
  const yr = stepToYear(world.step);
  const era = Math.max(0, Math.min(1, (yr - FRONTIER_YEAR0) / (FRONTIER_YEAR1 - FRONTIER_YEAR0)));
  const frontierBudget = FRONTIER_CLOSE * resScale * era * era;
  if (_capitalOnly) recolorByCapital(world, co, capPos, knOf, claimCap, frontierBudget);
  fillEnclosedWaste(world, co);
  closeRealmGaps(world, co, T.REALM_GAP_FILL);
  smoothCountryBorders(world, co, T.BORDER_SMOOTH | 0);
  return co;
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
function recolorByCapital(world, co, capPos, knOf, claimCap, frontierBudget = 0) {
  const { N, tw, th, elev } = world;
  let capColor = world._capColor;
  if (!capColor || capColor.length !== N) capColor = world._capColor = new Int32Array(N);
  let capCost = world._capCostF;
  if (!capCost || capCost.length !== N) capCost = world._capCostF = new Float64Array(N);
  capColor.fill(-1); capCost.fill(Infinity);
  const noise = claimNoise(world);
  // Dominant realms partition a LARGER share of the open interior (continental empires),
  // and a dominant core ALSO claims its regional hinterland ahead of the industrial close
  // (DOM_HINTERLAND, present in every era; 0 for ordinary realms, which keep open marches).
  const rs = resScaleFor(world.tw);
  const hYr = stepToYear(world.step);
  const hinterEra = Math.max(0, Math.min(1, (hYr - HINTER_YEAR0) / (HINTER_YEAR1 - HINTER_YEAR0)));   // 0 in deep antiquity → 1 by the classical age
  const domBudget = new Map();
  if (world.countries) for (const [c] of capPos) {
    const cc = world.countries.get(c);
    const dom = cc && cc._dominance ? cc._dominance : 1;
    domBudget.set(c, frontierBudget * Math.pow(dom, FRONTIER_DOM) + DOM_HINTERLAND * rs * hinterEra * Math.max(0, dom - 1));
  }
  const budgetOf = (c) => domBudget.get(c) ?? frontierBudget;
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
      // Claimed land is always traversable (recolour to the nearest capital);
      // WILDERNESS is flooded only within the frontier-close budget — 0 in
      // antiquity (so the pass stays a recolour), growing to map-spanning by the
      // industrial era so the continents partition to the midline (no terra nullius).
      if (co[ni] < 0 && nd >= budgetOf(c)) continue;
      if (nd < capCost[ni]) { capCost[ni] = nd; capColor[ni] = c; heap.push(ni, nd, c); }
    }
  }
  for (let ti = 0; ti < N; ti++) if (capColor[ti] >= 0) co[ti] = capColor[ti];   // claim every tile the flood reached — claimed land recoloured, budgeted wilderness annexed
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
function smoothCountryBorders(world, co, iters) {
  if (!(iters > 0)) return;
  const { N, tw, th, elev } = world;
  let prot = world._smoothProt;
  if (!prot || prot.length !== N) prot = world._smoothProt = new Uint8Array(N);
  prot.fill(0);
  for (const s of world.settlements) { if (s.mode === "settled") prot[(s.pos.y | 0) * tw + (s.pos.x | 0)] = 1; }
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
  const co = world._countryOwner, tw = world.tw, elev = world.elev;
  if (!co) return;   // territory pass hasn't run yet — nothing to adopt from
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    const region = elev[ti] > 0 ? grownOwnerAt(world, ti) : -1;
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
      // A developed frontier settlement — a TOWN (tier ≥ 1) stranded in TRUE WILDERNESS
      // (beyond EVERY realm's reach, co[ti] < 0, not merely outside the crawled border)
      // — FOUNDS its own city-state instead of persisting as a stateless economy that
      // builds roads and trades in no-man's-land. A mere hamlet (tier 0) stays as
      // population until it develops or a realm's border reaches it — not every hamlet
      // is a state, but a real town on the frontier is a polity.
      if (s.countryId < 0 && region < 0 && (s.tier | 0) >= 1 && co[ti] < 0
          && ((s.knowledge && s.knowledge.organization) || 0) >= T.ORG_STATE_MIN) {   // a frontier town founds a state only with the statecraft for it
        s.countryId = s.id; s._sovereignSeat = world.step; s.loyalty = 1; s._integratedAt = world.step;
        ensurePolity(world, s.id, { how: "frontier", seat: s });
        continue;
      }
      // otherwise village / town: follow the land (region), or stateless on the frontier
      if (s.countryId !== region) {
        if (s.countryId < 0 && region >= 0) s._integratedAt = world.step;   // wild → joined a realm: grow its basin in from the border, don't bloom
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
const NUCLEATE_R          = 9;      // cluster radius, tiles
const NUCLEATE_SEAT_POP   = 160;    // the seat must be a real regional centre (a large village / town)
const NUCLEATE_CLUSTER_POP= 400;    // total stateless population nearby to be a viable state
const NUCLEATE_CAP_DIST   = 8;      // ...and at least this far from any existing capital
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
  const seatPop = NUCLEATE_SEAT_POP / lever, clusterPop = NUCLEATE_CLUSTER_POP / lever;
  const capD2 = (NUCLEATE_CAP_DIST / Math.sqrt(lever)) ** 2;
  const caps = [];
  if (world.countries) for (const c of world.countries.values()) if (c.capital && c.capital.mode === "settled") caps.push(c.capital.pos);
  const fert = world.fert;
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
    const capMul = (1 + NUCLEATE_CAP_SPREAD * (1 - capNorm)) * (1 + T.STATE_DISEASE * (s._wetTropic || 0))
                 / (1 + T.FRAGMENT * (s._rugged || 0));
    if ((s.people || 0) < seatPop * capMul) continue;
    let dCap = Infinity;                        // isolation from existing states' heartlands
    for (const p of caps) { let dx = Math.abs(p.x - s.pos.x); if (dx > halfTw) dx = tw - dx; const dy = p.y - s.pos.y; const d2 = dx * dx + dy * dy; if (d2 < dCap) dCap = d2; }
    if (caps.length && dCap < capD2) continue;
    let cp = 0, isLeader = true;                // viable cluster + this settlement leads it
    forEachNear(world, s.pos.x, s.pos.y, NUCLEATE_R, (o) => {
      if (o.mode !== "settled" || o.countryId >= 0) return;
      cp += o.people || 0;
      const op = o.people || 0, sp = s.people || 0;
      if (op > sp || (op === sp && o.id < s.id)) isLeader = false;
    });
    if (isLeader && cp >= clusterPop * capMul) cand.push({ s, cp });
  }
  if (!cand.length) return;
  cand.sort((a, b) => b.cp - a.cp);             // most-developed clusters first
  const placed = []; let n = 0;
  for (const { s } of cand) {
    if (n >= NUCLEATE_MAX_PASS) break;
    let tooClose = false;                        // don't mint two adjacent states in one pass
    for (const p of placed) { let dx = Math.abs(p.x - s.pos.x); if (dx > halfTw) dx = tw - dx; const dy = p.y - s.pos.y; if (dx * dx + dy * dy < (NUCLEATE_R * 2) ** 2) { tooClose = true; break; } }
    if (tooClose) continue;
    s.countryId = s.id; s._sovereignSeat = world.step; s.loyalty = 1; s._integratedAt = world.step;
    ensurePolity(world, s.id, { how: "frontier", seat: s });
    placed.push({ x: s.pos.x, y: s.pos.y }); n++;
  }
}

// Re-export the city threshold so other passes agree on what a "city" is.
export { CITY_TIER };
