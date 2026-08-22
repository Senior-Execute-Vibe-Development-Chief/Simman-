// Lap 0 of the field-concentration wave (docs/atlas-gap-2026-08-14.md): the
// claim-size wave convicted the FIELD's flatness — 28% of people on the worked
// 9% of land where history put ~80% on ~10% (the Nile: 95% on 3%), mid-belts
// within 30% of cradle-core density where history's cradles ran 10-30x their
// periphery. A correct sizing law fed a flat field makes every state ~5x too
// big. This measures WHERE the flatness lives, with one discriminator:
//   - pop-Lorenz ≈ cap-Lorenz (both flat)  → CAPACITY is flat (agronomy /
//     worldgen: the river premium is x2-3 where history's irrigated alluvium
//     ran x10-50) — logistic growth pins pop to cap, so pop can never beat cap.
//   - cap concentrated, pop flat           → growth/migration smear.
// Also prints the static FERT field's Lorenz (worldgen's share of the answer)
// and top-decile/median density ratios (history: 10-30x).
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_fieldconc.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 45000), W = +(process.argv[3] || 480), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
const EVERY = 5000;
for (let s = 1; s <= STEPS; s++) { stepPeopleSim(world, 1); if (s % EVERY === 0) report(s); }

function lorenz(vals) {
  // vals: array of per-tile values (land only). Returns shares held by the
  // top 1/5/10/20% of tiles, plus top-decile-mean / median ratio.
  const a = vals.filter(v => v > 0).sort((p, q) => q - p);
  const n = a.length;
  if (!n) return null;
  let tot = 0; for (const v of a) tot += v;
  const share = (f) => {
    const k = Math.max(1, Math.round(n * f));
    let s = 0; for (let i = 0; i < k; i++) s += a[i];
    return 100 * s / tot;
  };
  const med = a[(n / 2) | 0];
  const k10 = Math.max(1, Math.round(n * 0.1));
  let s10 = 0; for (let i = 0; i < k10; i++) s10 += a[i];
  return { n, p1: share(0.01), p5: share(0.05), p10: share(0.10), p20: share(0.20), decMedRatio: med > 0 ? (s10 / k10) / med : Infinity };
}

function fmtL(name, L) {
  if (!L) return `${name}: empty`;
  return `${name}: top1%=${L.p1.toFixed(0)}% top5%=${L.p5.toFixed(0)}% top10%=${L.p10.toFixed(0)}% top20%=${L.p20.toFixed(0)}% dec/med=${L.decMedRatio === Infinity ? "inf" : L.decMedRatio.toFixed(1)}x (n=${L.n})`;
}

function report(step) {
  const { elev, popField: pf, capField: cap, N } = world;
  const fert = world.fert;
  const pops = [], caps = [], ferts = [], popsSettled = [];
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0)) continue;
    pops.push(pf ? pf[i] : 0);
    caps.push(cap ? cap[i] : 0);
    ferts.push(fert ? fert[i] : 0);
    if (pf && pf[i] > 1) popsSettled.push(pf[i]);
  }
  // pop-on-cap correlation proxy: share of pop sitting on the top-10%-by-CAP tiles
  let popOnTopCap = null;
  if (pf && cap) {
    const idx = [...caps.keys()].sort((a, b) => caps[b] - caps[a]);
    const k = Math.max(1, Math.round(idx.length * 0.1));
    let pTop = 0, pTot = 0;
    for (let j = 0; j < idx.length; j++) pTot += pops[idx[j]];
    for (let j = 0; j < k; j++) pTop += pops[idx[j]];
    popOnTopCap = pTot > 0 ? 100 * pTop / pTot : 0;
  }
  console.log(`[fieldconc] step ${step}`);
  console.log(`  ${fmtL("pop ", lorenz(pops))}`);
  console.log(`  ${fmtL("cap ", lorenz(caps))}`);
  console.log(`  ${fmtL("fert", lorenz(ferts))}`);
  if (popsSettled.length) console.log(`  ${fmtL("pop|settled", lorenz(popsSettled))}`);
  if (popOnTopCap !== null) console.log(`  popOnTop10%CapLand=${popOnTopCap.toFixed(0)}%  (history anchor: ~80% of people on ~10% of land; Nile 95% on 3%)`);
}
