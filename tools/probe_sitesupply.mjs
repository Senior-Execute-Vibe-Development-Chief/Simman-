// ── C1 v3 site-ledger invariance instrument (docs/design-c-siting-ledger.md §3/§6.7) ──
//
// The market-site ledger's whole claim is that drainage/coast TOPOLOGY at
// absolute physical bars, quantized at the market horizon, is a REAL quantity
// — the same Earth carries the same candidate market sites at any grid. This
// probe measures that claim directly, at t=0 (the ledger is static worldgen),
// across 240/480/960 pixels × 2 seeds:
//
//   • raw flow-tree nodes at CATCH_TRIB = 60e3 km² discharge-equivalent
//     (confluences / true-ocean mouths / terminal sinks) and raw anchorage
//     maxima (shelter ≥ SHELTER_MIN local maxima of near-shore sea tiles)
//   • the horizon-quantized skeleton per class — river nodes (Class N alone)
//     and anchorages (Class H alone) — plus the union ledger (N first, then
//     H: a mouth in a bay is one site)
//   • cross-grid POSITION match: share of one grid's sites with a site of
//     the other grid within TOWN_BASIN_R/2 = 5 ref-tiles (the quantizer's
//     own scale), both directions
//   • nearest-neighbour spacing of the union ledger in ref-tiles (mean, cv —
//     geography-following cv ~0.4-0.5, nothing like a covering law's 0.21)
//
// DISCIPLINE BARS (§3, hard): 480↔960 count drift ≤ ±10% for river nodes AND
// anchorages-alone; union position match 480↔960 ≥ 90% (min of directions).
// The 240 grid is the accepted representation-limit class (sub-pixel bays,
// under-resolved 60e3 km² network): reported, WARN outside ±25%, never hard.
//
// RE-RUN THIS TABLE whenever worldgen's hydrology (riverGen, the pipeline's
// river/moisture stages) changes — the ledger stands on it.
//
//   node tools/probe_sitesupply.mjs            (seeds 8817,4242 — the design table)
//   SITE_SEEDS="8817,31337" node tools/probe_sitesupply.mjs
import { buildSim } from "./_harness.mjs";
import { buildSiteLedger } from "../src/sim/peopleSim/crystallize.js";

const SEEDS = (process.env.SITE_SEEDS || "8817,4242").split(",").map(Number).filter(Number.isFinite);
const GRIDS = [240, 480, 960];
const REF_W = 240;    // ref-tile frame: the calibrated 480-pixel world's 240-tile sim grid
const MATCH_R = 5;    // ref-tiles = TOWN_BASIN_R/2, the quantizer's own scale

// Class-alone quantizer (same greedy keep-largest the ledger runs, on one
// class's sorted candidate list) — for the per-class invariance rows.
function quantizeAlone(cands, D, tw) {
  const D2 = D * D, ax = [], ay = [];
  for (const c of cands) {
    let ok = true;
    for (let i = 0; i < ax.length; i++) {
      let dx = Math.abs(ax[i] - c.x); if (dx > tw / 2) dx = tw - dx;
      const dy = ay[i] - c.y;
      if (dx * dx + dy * dy < D2) { ok = false; break; }
    }
    if (ok) { ax.push(c.x); ay.push(c.y); }
  }
  return ax.length;
}

function nnRef(sites, tw, rn) {
  const ds = [];
  for (let i = 0; i < sites.length; i++) {
    let best = Infinity;
    for (let j = 0; j < sites.length; j++) {
      if (i === j) continue;
      let dx = Math.abs(sites[i].x - sites[j].x); if (dx > tw / 2) dx = tw - dx;
      const dy = sites[i].y - sites[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    if (isFinite(best)) ds.push(Math.sqrt(best) / rn);
  }
  if (!ds.length) return { mean: 0, cv: 0 };
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ds.length);
  return { mean, cv: mean > 0 ? sd / mean : 0 };
}

// Position match A→B in the ref frame (x wraps at REF_W).
function matchFrac(A, B) {
  if (!A.length) return 1;
  let hit = 0;
  for (const a of A) {
    for (const b of B) {
      let dx = Math.abs(a.rx - b.rx); if (dx > REF_W / 2) dx = REF_W - dx;
      const dy = a.ry - b.ry;
      if (dx * dx + dy * dy <= MATCH_R * MATCH_R) { hit++; break; }
    }
  }
  return hit / A.length;
}

const pct = (a, b) => (b > 0 ? ((100 * (a - b)) / b).toFixed(1) : "n/a");
let hardFail = 0;

for (const seed of SEEDS) {
  console.log(`\n────────── seed ${seed} ──────────`);
  const per = new Map();
  for (const W of GRIDS) {
    const world = buildSim({ W, H: W >> 1, seed });
    const t0 = performance.now();
    const { sites, raw, candN, candH, D } = buildSiteLedger(world, { detail: true });
    const ms = performance.now() - t0;
    const tw = world.tw, rn = tw / REF_W;
    const by = { conf: 0, mouth: 0, sink: 0, bay: 0 };
    for (const s of sites) by[s.cls]++;
    const rivers = sites.filter((s) => s.cls !== "bay");   // = Class N quantized alone (N ranks first)
    const bayAlone = quantizeAlone(candH, D, tw);
    const refSites = sites.map((s) => ({ rx: s.x / rn, ry: s.y / rn }));
    const refRivers = rivers.map((s) => ({ rx: s.x / rn, ry: s.y / rn }));
    const nn = nnRef(sites, tw, rn);
    per.set(W, { riverN: rivers.length, bayAlone, union: sites.length, refSites, refRivers });
    console.log(
      `${String(W).padStart(4)}px tw=${String(tw).padStart(3)}  raw conf/mouth/sink=${raw.conf}/${raw.mouth}/${raw.sink} bayMax=${raw.bay}  ` +
      `merged: rivers=${rivers.length} (c${by.conf}/m${by.mouth}/s${by.sink}) anchAlone=${bayAlone}  ` +
      `UNION=${sites.length} (+${by.bay} bays)  nn=${nn.mean.toFixed(1)}ref cv${nn.cv.toFixed(2)}  ${ms.toFixed(0)}ms`
    );
  }
  const g480 = per.get(480), g960 = per.get(960), g240 = per.get(240);
  if (g480 && g960) {
    const dRiver = Math.abs(g960.riverN / g480.riverN - 1) * 100;
    const dBay = Math.abs(g960.bayAlone / g480.bayAlone - 1) * 100;
    const dUnion = Math.abs(g960.union / g480.union - 1) * 100;
    const mAB = matchFrac(g480.refSites, g960.refSites), mBA = matchFrac(g960.refSites, g480.refSites);
    const mR = Math.min(matchFrac(g480.refRivers, g960.refRivers), matchFrac(g960.refRivers, g480.refRivers));
    const mUnion = Math.min(mAB, mBA);
    const okRiver = dRiver <= 10, okBay = dBay <= 10, okMatch = mUnion >= 0.90;
    if (!okRiver || !okBay || !okMatch) hardFail++;
    console.log(
      `480↔960: rivers ${pct(g960.riverN, g480.riverN)}% ${okRiver ? "OK" : "FAIL(>±10%)"}  ` +
      `anchorages ${pct(g960.bayAlone, g480.bayAlone)}% ${okBay ? "OK" : "FAIL(>±10%)"}  ` +
      `union ${pct(g960.union, g480.union)}% (${dUnion.toFixed(1)}%)  ` +
      `posMatch union=${(100 * mUnion).toFixed(1)}% (→${(100 * mAB).toFixed(1)}/←${(100 * mBA).toFixed(1)}) rivers=${(100 * mR).toFixed(1)}% ${okMatch ? "OK" : "FAIL(<90%)"}`
    );
  }
  if (g240 && g480) {
    const dR = Math.abs(g240.riverN / g480.riverN - 1) * 100, dB = Math.abs(g240.bayAlone / g480.bayAlone - 1) * 100;
    const warn = dR > 25 || dB > 25 ? "  WARN(>±25% — representation limit, see §3)" : "";
    console.log(`240↔480: rivers ${pct(g240.riverN, g480.riverN)}%  anchorages ${pct(g240.bayAlone, g480.bayAlone)}%  union ${pct(g240.union, g480.union)}%  (informational)${warn}`);
  }
}
console.log(hardFail ? `\n[sitesupply] FAIL — ${hardFail} seed(s) broke a §3 hard bar` : `\n[sitesupply] PASS — ledger invariant within the §3 bars on all seeds`);
process.exit(hardFail ? 1 : 0);
