// Lap 0 of the claim-size wave (docs/atlas-gap-2026-08-14.md): the late-belt
// wave's Third-Rule verdict measured belt MEDIAN claims at 0.18-0.49M km2 at
// BOTH grids — 10x history's ~0.03M median polity — with realm COUNTS
// history-shaped, so claim size IS the 2x world balloon. The live target law
// (countryTerritory.js, SIZE_BY_POP path) is
//     target = popCap + march
//       popCap = govPop · spanTechMul / bindDens   (people-funded extent)
//       march  = 150 · logistics² · r2             (flat add-on, population-blind)
// Two suspects, decomposed here per realm via the SIM_TARGET_DIAG stash:
//   A. the MARCH — a ~0.15-0.7M km2 allowance every realm collects once
//      logistics diffuses, regardless of whether it has people to march;
//   B. popCap INFLATION — k = density·spanTech/bindDens grows past 1 with
//      development, so each settled tile buys k tiles of thin frontier.
// Attribution: marchShare at the median cohort vs at the top; the count of
// march-funded realms (march > popCap); popCap/held at the median (k proxy).
//   SIM_TARGET_DIAG=1 SIM_TUNE="DAWN_LIVE=1" node tools/probe_claimsize.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 30000), W = +(process.argv[3] || 960), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
const EVERY = 5000;
for (let s = 1; s <= STEPS; s++) { stepPeopleSim(world, 1); if (s % EVERY === 0) report(s); }

function fmt(d, tiles, km2, r2) {
  const ms = d.t > 0 ? Math.round(100 * d.march / d.t) : 0;
  // densRef: the realm's average density over its claim, in bindDens units
  // (field people per REFERENCE tile) — comparable directly to RURAL_BIND_DENS.
  const densRef = tiles > 0 ? Math.round((d.govPop || 0) / tiles * r2) : 0;
  return `claim=${(tiles * km2 / 1e6).toFixed(2)}M t=${d.t} popCap=${d.popCap} march=${d.march} (${ms}%) ` +
    `heldLoad=${Math.round(d.held)} densRef=${densRef} logi=${d.logi.toFixed(2)}`;
}

function report(step) {
  const co = world._countryOwner, elev = world.elev, N = world.N;
  const r2 = (world.tw / 240) ** 2, pf = world.popField, worked = world._fpWorked;
  let landN = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) landN++;
  const km2 = (510e6 * 0.29) / landN;
  const tilesOf = new Map();
  for (let i = 0; i < N; i++) if (co[i] >= 0) tilesOf.set(co[i], (tilesOf.get(co[i]) || 0) + 1);
  // The bindDens re-derivation's raw measurements (claim-size wave lap 2):
  // pfTot (the demographic scale), worked/claimed tile counts (the WORKED
  // MULTIPLE — historical states held ~6-8x their worked land at 1500), and
  // absolute densities in bindDens units (field people per REFERENCE tile).
  let pfTot = 0, wN = 0, cN = 0, pfW = 0, pfC = 0;
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0)) continue;
    const p = pf ? pf[i] : 0;
    pfTot += p;
    if (worked && worked[i]) { wN++; pfW += p; }
    if (co[i] >= 0) { cN++; pfC += p; }
  }
  console.log(`[claimland] step ${step} pfTot=${(pfTot / 1e6).toFixed(2)}M workedTiles=${wN} (${(wN * km2 / 1e6).toFixed(1)}M km2) claimedTiles=${cN} (${(cN * km2 / 1e6).toFixed(1)}M km2) workedMultiple=${wN > 0 ? (cN / wN).toFixed(1) : "-"} densWorkedRef=${wN > 0 ? Math.round(pfW / wN * r2) : 0} densClaimedRef=${cN > 0 ? Math.round(pfC / cN * r2) : 0} densLandRef=${Math.round(pfTot / landN * r2)}`);
  const diag = world._targetDiag || new Map();
  // realms ranked by claimed tiles; keep only those with a live diag row
  const rows = [...tilesOf.entries()]
    .map(([cid, n]) => ({ cid, n, d: diag.get(cid) }))
    .sort((a, b) => b.n - a.n);
  const withD = rows.filter(r => r.d);
  const nAll = rows.length;
  const med = rows[(nAll / 2) | 0];
  console.log(`[claimsize] step ${step} realms=${nAll} diag=${withD.length} medianClaim=${med ? (med.n * km2 / 1e6).toFixed(2) : "-"}M km2`);
  if (!withD.length) return;
  // median cohort: middle 30% band by claimed tiles (of realms with diag)
  const lo = Math.floor(withD.length * 0.35), hi = Math.max(lo + 1, Math.ceil(withD.length * 0.65));
  const band = withD.slice(lo, hi);
  const agg = { t: 0, popCap: 0, march: 0, held: 0, logi: 0, spanTech: 0, govPop: 0, n: 0, tiles: 0 };
  for (const r of band) { agg.t += r.d.t; agg.popCap += r.d.popCap; agg.march += r.d.march; agg.held += r.d.held; agg.logi += r.d.logi; agg.spanTech += r.d.spanTech; agg.govPop += r.d.govPop || 0; agg.tiles += r.n; agg.n++; }
  const mMean = { t: agg.t / agg.n, popCap: agg.popCap / agg.n, march: agg.march / agg.n, held: agg.held / agg.n, logi: agg.logi / agg.n, spanTech: agg.spanTech / agg.n, govPop: agg.govPop / agg.n };
  console.log(`  medianCohort(n=${agg.n}): ${fmt(mMean, agg.tiles / agg.n, km2, r2)} kProxy(popCap/held)=${mMean.held > 0 ? (mMean.popCap / mMean.held).toFixed(2) : "-"}`);
  for (const r of withD.slice(0, 3)) console.log(`  top#${r.cid}: ${fmt(r.d, r.n, km2, r2)}`);
  let sumT = 0, sumM = 0, marchFunded = 0;
  for (const r of withD) { sumT += r.d.t; sumM += r.d.march; if (r.d.march > r.d.popCap) marchFunded++; }
  console.log(`  aggregate: sumMarch/sumT=${sumT > 0 ? Math.round(100 * sumM / sumT) : 0}% marchFunded(march>popCap)=${marchFunded}/${withD.length}`);
}
