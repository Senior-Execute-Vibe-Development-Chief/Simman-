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
import { T } from "./tuning.js";

// Per-country reach (transport-cost) projected from its settlements: a country
// claims land out to COUNTRY_REACH_BASE + capital-organisation × COUNTRY_REACH_ORG
// of travel cost from its nearest settlement. Org-scaled, so primitive realms
// stay compact (the early map fragments into small city-states with wilderness
// between) and high-org empires reach far (consolidation with the era). Beyond
// it, land is wilderness — which is where stateless frontier hamlets live.
const COUNTRY_REACH_BASE = 8;
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
// Reach is also scaled by how BIG the realm is, so a claim is backed by real
// settlements rather than the capital's tech alone. budget ×= clamp(members /
// REACH_SIZE_REF, REACH_SIZE_MIN, 1): a fledgling realm projects only a fraction
// of its tech-reach (no continent-from-three-cities) and earns the full reach as
// it grows to a continental-scale state.
const REACH_SIZE_REF = 32;    // settlements for full reach (was 20 — a realm must be bigger before it projects its whole tech-reach, so a few-city state stays regional)
const REACH_SIZE_MIN = 0.25;  // a tiny realm still projects at least this fraction
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
  const { N, tw, th, elev } = world;
  const resScale = resScaleFor(tw);   // tile budgets are res-relative → keep the same world-fraction at any grid size (see RES_REF_W)
  let co = world._countryOwner;
  if (!co || co.length !== N) co = world._countryOwner = new Int32Array(N);
  co.fill(-1);
  let cost = world._countryCost;
  if (!cost || cost.length !== N) cost = world._countryCost = new Float64Array(N);
  cost.fill(Infinity);

  // Per-country reach budget + the knowledge used for edge cost — both taken
  // from the country's most-organised settlement (its de-facto capital).
  const budget = new Map(), knOf = new Map(), capOrg = new Map(), claimCap = new Map(), members = new Map(), capPos = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;   // stateless settlements don't seed
    const c = s.countryId;
    members.set(c, (members.get(c) || 0) + 1);
    const org = s._techEff ? s._techEff.reachLevel : ((s.knowledge && s.knowledge.organization) || 0);   // admin reach from techs (tech.js)
    if (!capOrg.has(c) || org > capOrg.get(c)) {
      capOrg.set(c, org);
      capPos.set(c, s.pos);          // the most-organised settlement = the realm's de-facto capital (the anchor reach radiates from)
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
      budget.set(c, (COUNTRY_REACH_BASE + org * COUNTRY_REACH_ORG) * eraMul * resScale);
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
    const sf = Math.max(REACH_SIZE_MIN, Math.min(1, (members.get(c) || 1) / REACH_SIZE_REF));
    budget.set(c, b * sf);
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
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (!(elev[ti] > 0 && cost[ti] > 0)) continue;
    const c = s.countryId;
    const full = budget.get(c) || 0;
    const integMin = INTEGRATE_MIN * resScale;   // day-one basin is a tile distance → res-relative
    const age = world.step - (s._integratedAt ?? -Infinity);
    let sb = age < INTEGRATE_TICKS
      ? Math.min(full, integMin + Math.max(0, full - integMin) * (age / INTEGRATE_TICKS))
      : full;
    // CAPITAL ANCHOR: a settlement projects the realm's reach less the FARTHER it
    // sits from the capital — authority radiates from one centre and fades with
    // distance, so the territory pulls into a compact blob around the capital
    // instead of sprawling to wherever any town happens to be. The capital itself
    // (distance 0) projects the full reach; a far frontier town anchors only a
    // small basin. So the union of basins reads as one centred region, not a
    // scatter, and a far salient that a nearer RIVAL capital reaches more cheaply
    // cedes to it — the power-Voronoi-of-capitals that makes real borders blobby.
    const cp = capPos.get(c);
    if (anchor > 0 && cp) {
      let dx = Math.abs(s.pos.x - cp.x); if (dx > tw / 2) dx = tw - dx;
      const dy = s.pos.y - cp.y;
      const capDist = Math.sqrt(dx * dx + dy * dy);
      sb *= 1 / (1 + anchor * capDist / (ANCHOR_SCALE * resScale));   // falloff distance is res-relative → blobs keep shape at any grid size
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
      const ni = ns[k]; if (ni < 0 || elev[ni] <= 0) continue;
      let ec = localEdgeCost(world, ti, ni, kn, true);   // roads ignored
      if (ec === Infinity) continue;
      if (ec > cap) ec = cap + (ec - cap) * CLAIM_SOFT;  // soft cap: ease harsh terrain but keep its gradient (no straight-wall borders)
      ec *= 1 + (noise[ni] - 0.5) * (2 * NOISE_AMP);     // organic meander → borders wander instead of cutting straight
      const nd = d + ec * mul[k];
      if (nd > basinBud) continue;                       // basin's (recency-limited) reach budget
      if (nd < cost[ni]) { cost[ni] = nd; co[ni] = c; seedBud[ni] = basinBud; heap.push(ni, nd, c); }
    }
  }
  closeRealmGaps(world, co, T.REALM_GAP_FILL);
  return co;
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
  for (let y = 0; y < th; y++) {                       // ← nearest country to the WEST
    let last = -1, lastP = -1e9; const row = y * tw;
    for (let x = 0; x < tw; x++) { const ti = row + x;
      if (elev[ti] <= 0) { last = -1; lastP = -1e9; wC[ti] = -1; wD[ti] = FAR; continue; }
      const d = x - lastP;
      if (last >= 0 && d <= D) { wC[ti] = last; wD[ti] = d; } else { wC[ti] = -1; wD[ti] = FAR; }
      if (co[ti] >= 0) { last = co[ti]; lastP = x; }
    }
  }
  for (let y = 0; y < th; y++) {                       // → nearest country to the EAST
    let last = -1, lastP = 1e9; const row = y * tw;
    for (let x = tw - 1; x >= 0; x--) { const ti = row + x;
      if (elev[ti] <= 0) { last = -1; lastP = 1e9; eC[ti] = -1; eD[ti] = FAR; continue; }
      const d = lastP - x;
      if (last >= 0 && d <= D) { eC[ti] = last; eD[ti] = d; } else { eC[ti] = -1; eD[ti] = FAR; }
      if (co[ti] >= 0) { last = co[ti]; lastP = x; }
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
  let fills = world._gapFills;
  if (!fills || fills.length < N) fills = world._gapFills = new Int32Array(N);
  let n = 0;
  for (let ti = 0; ti < N; ti++) {
    if (co[ti] >= 0 || elev[ti] <= 0) continue;
    if (wC[ti] < 0 || eC[ti] < 0 || nC[ti] < 0 || sC[ti] < 0) continue;   // not fully enclosed → leave wild (no fingers)
    let c = wC[ti], cd = wD[ti];                                          // nearest of the four flanks wins the tile
    if (eD[ti] < cd) { c = eC[ti]; cd = eD[ti]; }
    if (nD[ti] < cd) { c = nC[ti]; cd = nD[ti]; }
    if (sD[ti] < cd) { c = sC[ti]; cd = sD[ti]; }
    fills[n++] = ti; fills[n++] = c;
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
      // village / town: follow the land (region), or stateless on the frontier
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
export function nucleateFrontierStates(world) {
  const lever = T.FRONTIER_FOUNDING;          // 0 = off (old behaviour), 1 = default, >1 = easier
  if (!(lever > 0)) return;
  const tw = world.tw, halfTw = tw / 2;
  const seatPop = NUCLEATE_SEAT_POP / lever, clusterPop = NUCLEATE_CLUSTER_POP / lever;
  const capD2 = (NUCLEATE_CAP_DIST / Math.sqrt(lever)) ** 2;
  const caps = [];
  if (world.countries) for (const c of world.countries.values()) if (c.capital && c.capital.mode === "settled") caps.push(c.capital.pos);
  const cand = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId >= 0 || (s.people || 0) < seatPop) continue;
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
    if (isLeader && cp >= clusterPop) cand.push({ s, cp });
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
    placed.push({ x: s.pos.x, y: s.pos.y }); n++;
  }
}

// Re-export the city threshold so other passes agree on what a "city" is.
export { CITY_TIER };
