// THE IDEA LAYER — what actually carries a technique across this world.
//
// The density lane has now failed four times (v1 geometry, v2 resolution, v3
// reachability, v4 blocked on the tier bar), and v4's finding pointed upstream
// of all of them: `world.devField` — the agricultural technique field that sets
// capField, hence how densely land peoples — is stamped from SETTLEMENTS ONLY
// (popField.js stampDevSources) and relaxed by a LAND-ONLY wave (relaxDevWave).
//
// But the sim ALSO has a second, richer idea layer that nobody put next to the
// first: per-settlement `s.knowledge` (six tracks) diffuses continuously over
// the MERGED ROAD + SEA reach (settlement.js:2133), damped by route cost, with
// agriculture gated by climate similarity — and it FORGETS (T.KNOW_DECAY, the
// dark-age pass at settlement.js:2105).
//
// So there are two idea layers with different physics, coupled by a one-way
// stamp. This probe measures them SIDE BY SIDE, because the design question is
// which properties the general idea system has to have, and that is an
// empirical question about which layer is actually doing the work.
//
// Six readings per checkpoint:
//   A  devField coverage — how much of the planet knows farming at all
//   B  land components — the water barrier, per landmass, with/without hearths
//   C  the two layers head to head, incl. ORPHANED technique (land that
//      remembers farming no living settlement within a market horizon holds)
//   D  the ratchet asymmetry — settlements that FORGOT since the last
//      checkpoint vs devField tiles that fell (the field cannot fall: it is a
//      max-wave, `if (v > nxt[i]) nxt[i] = v`)
//   E  diffusion reach — mergeReach partner counts, i.e. is the rich layer
//      itself contact-starved
//   F  track differentiation — do the six tracks stay differentiated across
//      the world, or converge to one planetary technique
//
// Plus a one-off perf estimate (G): the cost of ONE max-wave pass over the land
// list, to size "a field per idea" before any design commits to it.
//
//   node tools/probe_ideas.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { mergeReach } from "../src/sim/peopleSim/roads.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const NEOLITHIC_AGRI = 0.45;   // crystallize.js:890 — the free-handout baseline
const TOWN_BASIN_R = 10;       // crystallize.js:263, REFERENCE tiles (×rn at use)
const TRACKS = ["agriculture", "construction", "organization", "metallurgy", "navigation", "mobility"];

const world = buildSim({ W, H: W / 2, seed: SEED });
const { tw, th, N } = world;
const rn = tw / 240;                       // the reference-tile normalisation
const HORIZON = Math.max(1, Math.round(TOWN_BASIN_R * rn));
const elev = world.elev;

const lonOf = (x) => (x / tw) * 360 - 180;
const latOf = (y) => 90 - (y / th) * 180;

// ── Land components, 4-connectivity with x-wrap ─────────────────────────────
// Exactly the neighbourhood relaxDevWave iterates, so a component is precisely
// "the set of tiles the farming wave can ever reach from any tile in it".
const comp = new Int32Array(N).fill(-1);
const compSize = [];
{
  const stack = new Int32Array(N);
  let nc = 0;
  for (let i0 = 0; i0 < N; i0++) {
    if (elev[i0] <= 0 || comp[i0] >= 0) continue;
    let sp = 0, size = 0;
    stack[sp++] = i0; comp[i0] = nc;
    while (sp > 0) {
      const i = stack[--sp]; size++;
      const y = (i / tw) | 0, x = i - y * tw;
      const nb = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw)];
      if (y > 0) nb.push(i - tw);
      if (y < th - 1) nb.push(i + tw);
      for (const j of nb) if (elev[j] > 0 && comp[j] < 0) { comp[j] = nc; stack[sp++] = j; }
    }
    compSize.push(size); nc++;
  }
}
const landN = compSize.reduce((a, b) => a + b, 0);

function pct(a, b) { return b > 0 ? ((100 * a) / b).toFixed(1) + "%" : "—"; }
function quant(arr, q) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
}

// Previous-checkpoint state, for the ratchet arm (D).
let prevAgri = null;      // settlement id -> agriculture
let prevDev = null;       // copy of devField

function report(step) {
  const setts = world.settlements.filter((s) => s.mode === "settled");
  const dev = world.devField;
  console.log(`\n═══ step ${step} — ${setts.length} settlements, ${world.countries ? world.countries.size : 0} realms`);
  if (!dev) { console.log("  (no devField yet)"); return; }

  // ── A. devField coverage ──────────────────────────────────────────────────
  let zero = 0, farming = 0, any = 0, dmax = 0;
  const devVals = [];
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) continue;
    const d = dev[i];
    if (d <= 0) zero++; else any++;
    if (d >= NEOLITHIC_AGRI) farming++;
    if (d > dmax) dmax = d;
    if ((i & 7) === 0) devVals.push(d);          // 1-in-8 sample for quantiles
  }
  // Population rides along, because the design's named risk (§7) is that a field
  // that can FALL releases capacity a historic peak was holding up: a leaner
  // world is the mechanism working, and it has to be measured, not discovered.
  let pfTot = 0;
  if (world.popField) for (let i = 0; i < N; i++) pfTot += world.popField[i];
  const cenTot = setts.reduce((a, s) => a + (s.people || 0), 0);
  console.log(`  P field pop ${(pfTot / 1e6).toFixed(2)}M (field units)   census Σs.people ${cenTot.toFixed(0)} sim-units`);

  console.log(`  A devField over ${landN} land tiles:`);
  console.log(`      exactly 0.000 : ${zero} (${pct(zero, landN)})   nonzero: ${any} (${pct(any, landN)})`);
  console.log(`      >= ${NEOLITHIC_AGRI} (farming): ${farming} (${pct(farming, landN)})`);
  console.log(`      p50 ${quant(devVals, 0.5).toFixed(3)}  p90 ${quant(devVals, 0.9).toFixed(3)}  max ${dmax.toFixed(3)}`);

  // ── B. land components: the water barrier ─────────────────────────────────
  const bySett = new Map();      // comp -> settlement count
  for (const s of setts) {
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    const c = comp[ti];
    if (c >= 0) bySett.set(c, (bySett.get(c) || 0) + 1);
  }
  const compDev = new Map();     // comp -> [sum, farmingTiles]
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) continue;
    const c = comp[i], e = compDev.get(c) || [0, 0];
    e[0] += dev[i]; if (dev[i] >= NEOLITHIC_AGRI) e[1]++;
    compDev.set(c, e);
  }
  const big = compSize.map((sz, c) => ({ c, sz })).filter((e) => e.sz >= 50).sort((a, b) => b.sz - a.sz).slice(0, 8);
  console.log(`  B land components >= 50 tiles (${compSize.filter((s) => s >= 50).length} of ${compSize.length}):`);
  let strandedTiles = 0, strandedComps = 0;
  for (const { c, sz } of big) {
    const e = compDev.get(c) || [0, 0];
    const ns = bySett.get(c) || 0;
    // LATITUDE SPAN, not a representative tile: the first tile in scan order is
    // a component's northernmost point, which reads as a position and is not one
    // (it put North America "at 84N"). The span separates a polar mass from a
    // temperate one, which is all this column has to do.
    let yMin = th, yMax = -1;
    for (let i = 0; i < N; i++) if (comp[i] === c) { const y = (i / tw) | 0; if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
    console.log(`      comp ${String(c).padStart(3)}  ${String(sz).padStart(5)} tiles  settlements ${String(ns).padStart(3)}  ` +
      `devField mean ${(e[0] / sz).toFixed(3)}  farming ${pct(e[1], sz)}   lat ${latOf(yMax).toFixed(0)}..${latOf(yMin).toFixed(0)}`);
  }
  for (let c = 0; c < compSize.length; c++) {
    if (!bySett.get(c)) { strandedComps++; strandedTiles += compSize[c]; }
  }
  console.log(`      landmasses with NO settlement: ${strandedComps} comps, ${strandedTiles} tiles (${pct(strandedTiles, landN)} of land)`);

  // ── C. the two layers head to head ────────────────────────────────────────
  // Stamp the best agriculture held by any settlement within one market horizon
  // over every land tile, then compare against what the LAND remembers.
  const held = new Float32Array(N).fill(-1);
  for (const s of setts) {
    const a = (s.knowledge && s.knowledge.agriculture) || 0;
    const sx = s.pos.x | 0, sy = s.pos.y | 0;
    for (let dy = -HORIZON; dy <= HORIZON; dy++) {
      const y = sy + dy; if (y < 0 || y >= th) continue;
      for (let dx = -HORIZON; dx <= HORIZON; dx++) {
        if (dx * dx + dy * dy > HORIZON * HORIZON) continue;
        const x = (sx + dx + tw) % tw, i = y * tw + x;
        if (elev[i] <= 0) continue;
        if (a > held[i]) held[i] = a;
      }
    }
  }
  let orphanNoOne = 0, orphanAbove = 0, coveredTiles = 0;
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0 || dev[i] <= 0) continue;
    if (held[i] < 0) orphanNoOne++;                       // technique on land with no market at all
    else { coveredTiles++; if (dev[i] > held[i] + 0.05) orphanAbove++; }
  }
  const sAgri = setts.map((s) => (s.knowledge && s.knowledge.agriculture) || 0);
  console.log(`  C the two layers:`);
  console.log(`      settlement agriculture  p10 ${quant(sAgri, 0.1).toFixed(3)}  p50 ${quant(sAgri, 0.5).toFixed(3)}  max ${quant(sAgri, 1).toFixed(3)}`);
  console.log(`      devField max ${dmax.toFixed(3)}`);
  console.log(`      ORPHANED technique — land with devField > 0 and NO settlement within ${HORIZON} tiles: ${orphanNoOne} (${pct(orphanNoOne, any)} of nonzero land)`);
  console.log(`      land whose devField EXCEEDS every settlement in horizon by >0.05: ${orphanAbove} (${pct(orphanAbove, coveredTiles)} of market-covered land)`);

  // ── D. the ratchet asymmetry ──────────────────────────────────────────────
  if (prevAgri) {
    let forgot = 0, forgotMax = 0;
    for (const s of setts) {
      const was = prevAgri.get(s.id);
      if (was === undefined) continue;
      const now = (s.knowledge && s.knowledge.agriculture) || 0;
      if (now < was - 1e-6) { forgot++; forgotMax = Math.max(forgotMax, was - now); }
    }
    let fell = 0;
    for (let i = 0; i < N; i++) if (elev[i] > 0 && dev[i] < prevDev[i] - 1e-6) fell++;
    console.log(`  D since last checkpoint: settlements that FORGOT agriculture: ${forgot}/${setts.length} (max drop ${forgotMax.toFixed(3)})`);
    console.log(`      devField tiles that FELL: ${fell}   ${fell === 0 ? "(a max-ratchet — the land cannot forget)" : "(the land forgets: T.IDEA_FIELD)"}`);
  }
  prevAgri = new Map(setts.map((s) => [s.id, (s.knowledge && s.knowledge.agriculture) || 0]));
  prevDev = Float32Array.from(dev);

  // ── E. diffusion reach ────────────────────────────────────────────────────
  const reachN = [];
  for (const s of setts) { const r = mergeReach(s); reachN.push(r ? r.size : 0); }
  const isolated = reachN.filter((n) => n === 0).length;
  console.log(`  E diffusion contact (mergeReach, road+sea): p10 ${quant(reachN, 0.1)}  p50 ${quant(reachN, 0.5)}  p90 ${quant(reachN, 0.9)}  max ${quant(reachN, 1)}`);
  console.log(`      settlements with ZERO partners (learn from nobody): ${isolated} (${pct(isolated, setts.length)})`);

  // ── F. track differentiation ──────────────────────────────────────────────
  console.log(`  F knowledge tracks across settlements (p10 / p50 / p90):`);
  for (const t of TRACKS) {
    const v = setts.map((s) => (s.knowledge && s.knowledge[t]) || 0);
    const p10 = quant(v, 0.1), p50 = quant(v, 0.5), p90 = quant(v, 0.9);
    console.log(`      ${t.padEnd(13)} ${p10.toFixed(3)} / ${p50.toFixed(3)} / ${p90.toFixed(3)}   spread ${(p90 - p10).toFixed(3)}`);
  }
}

// ── G. perf: what does ONE max-wave pass over the land list cost? ────────────
// Same shape as relaxDevWave (4-neighbour max with x-wrap, minus the climate
// toll), so it sizes "one Float32Array + one relax per idea" honestly.
function wavePerf() {
  const land = [];
  for (let i = 0; i < N; i++) if (elev[i] > 0) land.push(i);
  const li = Int32Array.from(land);
  const a = Float32Array.from(world.devField || new Float32Array(N));
  const b = new Float32Array(N);
  const REPS = 50;
  const t0 = process.hrtime.bigint();
  for (let r = 0; r < REPS; r++) {
    b.set(a);
    for (let k = 0; k < li.length; k++) {
      const i = li[k], y = (i / tw) | 0, x = i - y * tw;
      let best = a[y * tw + ((x + 1) % tw)];
      const l = a[y * tw + ((x - 1 + tw) % tw)]; if (l > best) best = l;
      if (y > 0 && a[i - tw] > best) best = a[i - tw];
      if (y < th - 1 && a[i + tw] > best) best = a[i + tw];
      const v = best - 0.002; if (v > b[i]) b[i] = v;
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / REPS;
  console.log(`\n  G one max-wave pass over ${li.length} land tiles: ${ms.toFixed(3)} ms` +
    `  →  10 idea fields at every tick = ${(ms * 10).toFixed(1)} ms/tick; at a 1-in-8 cadence = ${((ms * 10) / 8).toFixed(2)} ms/tick`);
}

const CHECKS = [0, 200, 1000, 2000, 6000, 12000, 25000, 50000].filter((c) => c <= STEPS);
console.log(`probe_ideas — W=${W} (tw=${tw}) seed=${SEED} steps=${STEPS}, horizon=${HORIZON} tiles, ${landN} land tiles in ${compSize.length} components`);
let at = 0;
for (const c of CHECKS) {
  while (at < c) { stepPeopleSim(world); at++; }
  report(at);
}
wavePerf();
