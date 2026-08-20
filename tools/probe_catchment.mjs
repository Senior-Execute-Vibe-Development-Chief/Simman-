// THE MEGA-CATCHMENT MEASUREMENT (census prosecution 2026-08-20): the owner's
// live register shows one first-census city holding a 13.6M-person catchment
// (~34% of humanity), ~30 cities at the Classical dawn, states born at
// 150k-950k km², and 2.5-4x fewer realms at tw=960 than tw=480. Hypothesis
// chain to test, upstream to downstream:
//   cell lattice too coarse → genesis lane one-city-per-cell (claimed[k] hard
//   block; the PEER_LATTICE multi-seat law is honored only by the other birth
//   channels) → too few cities → each city's persistent territory absorbs its
//   whole basin → catchment = civilization → states born continental.
// This measures every link at checkpoints:
//   A. cell geometry: cells, land-cell area distribution (the market lattice)
//   B. catchment distribution: per-city km², census, seat→tile radius (km)
//   C. the mint funnel: sites | claimed-blocked | mass-short | basin-fail |
//      eligible | mint-ready | tallyBar count | minted (city count)
//   D. peer slots: Σ floor(mass/basinBar) over claimed cells vs seats taken —
//      how many cities the peopled cells could FEED vs how many exist
//
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1" node tools/probe_catchment.mjs [steps=26000] [W=480] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { labelSiteLedger, siteClaims, URBAN_SHARE_REF } from "../src/sim/peopleSim/crystallize.js";
import { TIER_CORE } from "../src/sim/peopleSim/settlement.js";
import { telEnable } from "../src/sim/peopleSim/telemetry.js";
import { POP_SCALE } from "../src/sim/units.js";

const STEPS = +(process.argv[2] || 26000), W = +(process.argv[3] || 480), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
telEnable(world);

const { tw, th, N } = world;
const km2PerTileAt = (ty) => {
  const kmX = (40075 / tw) * Math.cos(((ty + 0.5) / th - 0.5) * Math.PI);
  const kmY = 40075 / 2 / th;
  return Math.max(0, kmX * kmY);
};
const kmDist = (x1, y1, x2, y2) => {
  let dx = Math.abs(x1 - x2); if (dx > tw / 2) dx = tw - dx;
  const latM = Math.cos((((y1 + y2) / 2 + 0.5) / th - 0.5) * Math.PI);
  return Math.hypot(dx * (40075 / tw) * latM, (y1 - y2) * (40075 / 2 / th));
};
const q = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.round(p * (a.length - 1)))]; };

// A. Cell geometry (static lattice) — once.
{
  const L = labelSiteLedger(world);
  const cellArea = new Float64Array(L.sites.length);
  for (let i = 0; i < N; i++) {
    const k = L.siteId[i];
    if (k >= 0 && world.elev[i] > 0) cellArea[k] += km2PerTileAt((i / tw) | 0);
  }
  const areas = [...cellArea].filter((a) => a > 0);
  console.log(`[cells] ${L.sites.length} market cells, ${areas.length} with land · land-cell km²: median ${Math.round(q(areas, 0.5) / 1e3)}k · p90 ${Math.round(q(areas, 0.9) / 1e3)}k · max ${Math.round(Math.max(...areas) / 1e3)}k`);
  console.log(`[cells] equivalent circle radius of the MEDIAN land cell: ${Math.round(Math.sqrt(q(areas, 0.5) / Math.PI))} km`);
}

const CKPT = 2000;
console.log(`step | cities realms | catch km² med/max | catch popM med/max | maxR km | topShare | funnel: claimedBlk massShort basinFail elig ready tallyBar | peer: seats/slots (cradle top)`);
for (let done = 0; done < STEPS; done += CKPT) {
  stepPeopleSim(world, Math.min(CKPT, STEPS - done));
  const cities = world.settlements.filter((s) => s.mode === "settled");
  const nC = world.countries ? world.countries.size : 0;

  // B. Catchments.
  const owner = world._territoryOwner;
  const area = new Map(), radius = new Map();
  if (owner) for (let i = 0; i < N; i++) {
    const id = owner[i];
    if (id < 0) continue;
    area.set(id, (area.get(id) || 0) + km2PerTileAt((i / tw) | 0));
  }
  for (const s of cities) {
    let r = 0;
    if (owner) for (let i = 0; i < N; i++) if (owner[i] === s.id) {
      const d = kmDist(s.pos.x, s.pos.y, i % tw, (i / tw) | 0);
      if (d > r) r = d;
    }
    radius.set(s.id, r);
  }
  const areas = cities.map((s) => area.get(s.id) || 0);
  const pops = cities.map((s) => (s.people || 0) * POP_SCALE / 1e6);
  const worldPop = (() => { let f = 0; const pf = world.popField; if (pf) for (let i = 0; i < N; i++) f += pf[i]; return f * (world._onePopScale || 0) * POP_SCALE / 1e6; })();
  const topPop = Math.max(0, ...pops);

  // C. Funnel (recompute eligibility-block reasons read-only from the caches).
  const L = labelSiteLedger(world);
  const claims = siteClaims(world);
  const bridge = world._onePopScale > 0 ? world._onePopScale : 1;
  const basinBarF = (TIER_CORE[2] / URBAN_SHARE_REF) / bridge;
  const elig = world._siteCityElig;
  let claimedBlk = 0, massShort = 0, basinFail = 0, eligN = 0, ready = 0;
  for (let k = 0; k < L.sites.length; k++) {
    if (claims.claimed[k]) { claimedBlk++; continue; }
    if (claims.mass[k] < basinBarF) { massShort++; continue; }
    const e = elig ? elig[k] : 0;
    if (e === 1) eligN++; else if (e === 2) ready++; else basinFail++;
  }
  const tb = world._tel && world._tel.get("siteCity") ? (world._tel.get("siteCity").get("tallyBar") || 0) : 0;

  // D. Peer slots on claimed cells.
  let seats = 0, slots = 0; const cradles = [];
  for (let k = 0; k < L.sites.length; k++) {
    if (!claims.claimed[k]) continue;
    const sl = Math.max(1, Math.floor(claims.mass[k] / basinBarF));
    seats += claims.count[k]; slots += sl;
    cradles.push([sl, claims.count[k], k]);
  }
  cradles.sort((a, b) => b[0] - a[0]);
  const topC = cradles.slice(0, 3).map(([sl, ct, k]) => `${ct}/${sl}@(${L.sites[k].x},${L.sites[k].y})`).join(" ");

  console.log(`${String(world.step).padStart(5)} | ${String(cities.length).padStart(3)} ${String(nC).padStart(3)} | ${Math.round(q(areas, 0.5) / 1e3)}k/${Math.round(Math.max(0, ...areas) / 1e3)}k | ${q(pops, 0.5).toFixed(2)}/${topPop.toFixed(2)} | ${Math.round(Math.max(0, ...[...radius.values()]))} | ${worldPop > 0 ? Math.round((topPop / worldPop) * 100) : 0}% | ${claimedBlk} ${massShort} ${basinFail} ${eligN} ${ready} ${tb} | ${seats}/${slots} (${topC})`);
}

// The full telemetry funnel — every channel that counted anything this run
// (peerlat: do the non-genesis founding channels even KNOCK on claimed cells,
// and what blocks them — the peer-seat question is the heart of this lap).
if (world._tel) {
  console.log(`\n[telemetry]`);
  for (const [ch, m] of world._tel) {
    console.log(`  ${ch}: ${[...m.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
}

// Final: the full catchment table, largest first.
const owner = world._territoryOwner;
const area = new Map();
if (owner) for (let i = 0; i < N; i++) { const id = owner[i]; if (id >= 0) area.set(id, (area.get(id) || 0) + km2PerTileAt((i / tw) | 0)); }
const rows = world.settlements.filter((s) => s.mode === "settled")
  .map((s) => ({ name: s.name, tier: s.tier, km2: Math.round(area.get(s.id) || 0), popM: +((s.people || 0) * POP_SCALE / 1e6).toFixed(2), urbanK: Math.round((s._urbanPop || 0) * POP_SCALE / 1e3), country: s.countryId }))
  .sort((a, b) => b.popM - a.popM);
console.log(`\n[catchments] final register, by catchment census:`);
for (const r of rows.slice(0, 15)) console.log(`  ${r.name.padEnd(14)} t${r.tier} c${String(r.country).padStart(3)} ${String(r.km2).padStart(8)} km² ${String(r.popM).padStart(7)}M ${String(r.urbanK).padStart(5)}k urban`);
console.log(`  … ${rows.length} cities total`);
