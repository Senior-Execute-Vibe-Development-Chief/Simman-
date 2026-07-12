// ONE_POP Zipf-tail checkpoint diagnostic (docs/one-population.md, dead end 3).
// The Zipf blocker is that great cores are chronically underfilled — generic
// 4-neighbour field diffusion fills a core to a small fraction of its (huge)
// spike capacity, so the heavy-tailed import economy never becomes population.
// Measures, per settled city core tile:
//   • spike.k (import-fed capacity, field units) — the CEILING carrier
//   • capField[ti] (terrain + spike) and popField[ti] (the concentration)
//   • fill = popField/capField — median ~0.18, does NOT reach 1 by magnitude
//   • suite-matched Zipf (urban>50) + urbanization, so the tail can be read here
//   • a DRY-RUN of the derived per-tile density spike terrainCap × φ/(1−φ),
//     which shows why it fails: φ (importShare) tops out ~0.45, terrainCap is
//     near-uniform, so the derived ceiling is ~100× too small to bind.
//   Run with ONE_POP on:  SIM_TUNE="ONE_POP=1" node tools/probe_onepop_fill.mjs [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "21000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
for (let i = 1; i <= STEPS; i++) stepPeopleSim(world, 1);

const tw = world.tw;
const scale = world._onePopScale;
const pf = world.popField, cf = world.capField, sp = world._urbanSpike;

// per-core measurements
const rows = [];
for (const s of world.settlements) {
  if (s.mode !== "settled") continue;
  const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
  if (ti < 0 || ti >= world.N) continue;
  const e = sp && sp.get(ti);
  const spikeK = e ? e.k : 0;                       // field units
  const cap = cf[ti];                                // terrain + prev spike
  const pop = pf[ti];                                // field people on core tile
  const fill = cap > 0 ? pop / cap : 0;
  rows.push({ id: s.id, people: s.people, urban: s._urbanPop || 0, spikeK, cap, pop, fill,
              imp: spikeK > 0 });
}

const importers = rows.filter(r => r.imp);
importers.sort((a, b) => b.spikeK - a.spikeK);

function stats(arr) {
  if (!arr.length) return { n: 0 };
  const a = arr.slice().sort((x, y) => x - y);
  const q = f => a[Math.min(a.length - 1, Math.max(0, Math.floor(f * (a.length - 1))))];
  return { n: a.length, min: a[0], p25: q(0.25), med: q(0.5), p75: q(0.75), p90: q(0.9), max: a[a.length - 1] };
}
const f = x => (x === undefined ? "  -  " : x.toFixed(3));
const F = x => (x === undefined ? "  -  " : x.toFixed(1));

console.log(`\nONE_POP fill diagnostic — seed ${SEED}, ${STEPS} steps, scale=${scale?.toFixed(4)}`);
console.log(`settled cities: ${rows.length}, importers (spike.k>0): ${importers.length}\n`);

const sf = stats(importers.map(r => r.fill));
console.log(`fill ratio (importers):   min ${f(sf.min)}  p25 ${f(sf.p25)}  MED ${f(sf.med)}  p75 ${f(sf.p75)}  p90 ${f(sf.p90)}  max ${f(sf.max)}`);
const sk = stats(importers.map(r => r.spikeK));
console.log(`spike.k field units:      min ${F(sk.min)}  p25 ${F(sk.p25)}  MED ${F(sk.med)}  p75 ${F(sk.p75)}  p90 ${F(sk.p90)}  max ${F(sk.max)}`);
const sc = stats(importers.map(r => r.cap));
console.log(`cap field units:          min ${F(sc.min)}  p25 ${F(sc.p25)}  MED ${F(sc.med)}  p75 ${F(sc.p75)}  p90 ${F(sc.p90)}  max ${F(sc.max)}`);
const spp = stats(importers.map(r => r.pop));
console.log(`pop (core tile):          min ${F(spp.min)}  p25 ${F(spp.p25)}  MED ${F(spp.med)}  p75 ${F(spp.p75)}  p90 ${F(spp.p90)}  max ${F(spp.max)}`);

console.log(`\ntop 20 importers by spike.k:  spikeK    cap    pop   fill   people   urban`);
for (const r of importers.slice(0, 20)) {
  console.log(`  cid ${String(r.id).padStart(4)}  ${F(r.spikeK).padStart(7)} ${F(r.cap).padStart(7)} ${F(r.pop).padStart(6)}  ${f(r.fill)}  ${F(r.people).padStart(7)} ${F(r.urban).padStart(7)}`);
}

// Zipf on urban pop (city size proxy the suite uses)
function zipf(sizes) {
  const a = sizes.filter(x => x > 0).sort((x, y) => y - x);
  if (a.length < 5) return NaN;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    const lx = Math.log(i + 1), ly = Math.log(a[i]);
    sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; n++;
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
// Suite-matched Zipf: urban cores > 50 census units (stylized.mjs §1)
function zipfSuite(sizes) {
  const a = sizes.filter(x => x > 50).sort((x, y) => y - x);
  if (a.length < 5) return { slope: NaN, n: a.length };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    const lx = Math.log(i + 1), ly = Math.log(a[i]);
    sx += lx; sy += ly; sxx += lx * lx; sxy += lx * ly; n++;
  }
  return { slope: (n * sxy - sx * sy) / (n * sxx - sx * sx), n };
}
const zs = zipfSuite(rows.map(r => r.urban));
// urbanization (suite §): urban cores / total people
let urbTot = 0, tot = 0;
for (const r of rows) { tot += r.people; urbTot += r.urban; }
const urbPct = tot > 0 ? (urbTot / tot) * 100 : 0;
console.log(`\nZipf slope (urban pop, all>0): ${zipf(rows.map(r => r.urban)).toFixed(3)}   (people): ${zipf(rows.map(r => r.people)).toFixed(3)}`);
console.log(`SUITE Zipf (urban>50): ${zs.slope.toFixed(3)} over ${zs.n} cities   [gate -1.35..-0.70]   urbanization ${urbPct.toFixed(1)}%   [agrarian 2-25%]`);
const K = process.env.SIM_TUNE || "";
console.log(`\nSWEEP  K=[${K}]  medFill=${sf.med?.toFixed(3)}  suiteZipf=${zs.slope.toFixed(3)}(${zs.n})  urb%=${urbPct.toFixed(1)}  cities=${rows.length}  importers=${importers.length}`);

// ── Dry-run of the DERIVED per-tile import-density spike ──
// spike = terrainCap[core] × φ/(1−φ), φ = importShare. Heavy tail from the
// nonlinear import term; each ceiling terrain-scaled so it stays fillable.
// Computed here from the live world (first-order — does not capture the
// coupled feedback, but tells us: is φ safe? is the derived ceiling heavy-
// tailed and in the same order as the pop the tile can actually reach?)
const phis = [], derived = [];
for (const s of world.settlements) {
  if (s.mode !== "settled") continue;
  const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
  if (ti < 0 || ti >= world.N) continue;
  const e = sp && sp.get(ti);
  const terrain = Math.max(0, cf[ti] - (e ? e.k : 0));   // cap minus applied spike
  const phi = Math.max(0, Math.min(1,
    ((s._foodNet !== undefined ? s._foodNet : 0) - (s._landFood || 0)) / Math.max(1e-9, s._foodSupply || 0)));
  if (phi > 0) {
    phis.push(phi);
    const mult = phi / Math.max(1e-6, 1 - phi);
    derived.push({ id: s.id, phi, terrain, spike: terrain * mult, pop: pf[ti] });
  }
}
const sp_phi = stats(phis);
console.log(`\nDERIVED spike dry-run — φ=importShare over ${phis.length} importers:`);
console.log(`  φ:            min ${f(sp_phi.min)}  p25 ${f(sp_phi.p25)}  MED ${f(sp_phi.med)}  p75 ${f(sp_phi.p75)}  p90 ${f(sp_phi.p90)}  max ${f(sp_phi.max)}`);
const sd = stats(derived.map(d => d.spike));
const stc = stats(derived.map(d => d.terrain));
console.log(`  terrainCap:   min ${F(stc.min)}  p25 ${F(stc.p25)}  MED ${F(stc.med)}  p75 ${F(stc.p75)}  p90 ${F(stc.p90)}  max ${F(stc.max)}`);
console.log(`  derivedSpike: min ${F(sd.min)}  p25 ${F(sd.p25)}  MED ${F(sd.med)}  p75 ${F(sd.p75)}  p90 ${F(sd.p90)}  max ${F(sd.max)}   (pop reachable ~${F(spp.med)} median)`);
console.log(`  derivedSpike/pop ratio at median: ${(sd.med / Math.max(1, spp.med)).toFixed(2)}  (want ~1 to bind)`);
derived.sort((a, b) => b.spike - a.spike);
console.log(`  top 8 derived:  id / φ / terrain / spike / corePop`);
for (const d of derived.slice(0, 8)) console.log(`    ${String(d.id).padStart(4)}  φ${f(d.phi)}  t${F(d.terrain).padStart(7)}  s${F(d.spike).padStart(8)}  p${F(d.pop).padStart(7)}`);
