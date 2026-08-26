// THE ERA-SKEW DECOMPOSITION — why do the material tracks (metallurgy,
// navigation, agriculture) run 1-2 eras behind the org/construction-driven
// era label? (2026-08-26, the owner's stuck-techs report; techverge census:
// nothing permanently stuck, galleys/iron/crop-rotation just arrive one to
// two eras late. Era = max era of ANY discovered tech (tech.js), so a fast
// org/construction chain drags the label while the material branches crawl.)
//
// Per checkpoint, across the settled register (obs regime, live arm):
//   · per-track knowledge p50/p90/MAX vs the stuck gates
//   · the ERA distribution (per-settlement techEff.era p90/max)
//   · the DEARNESS census — gp[STAPLE]/gp[METAL]/gp[MATERIALS] p50/p90:
//     the induced-innovation engine (needAgri/needMetal/needSea = 1 +
//     INDUCED_INNOV·max(0, gp−1)) runs on price dearness, and this week's
//     economy waves (v45-v48) deliberately RELIEVED scarcity — if dearness
//     collapsed to ≤1 planet-wide, necessity stopped mothering invention.
//   · the hooked multipliers (world._kDbg → s._dbgSciMul/_dbgNeed*/_dbgFleet)
//     p50/p90, plus _hegF (stagnation) — which throttle is actually closed.
//   · the metallurgy frontier rows (top-3): k, cap, needMetal, sciMul.
//
//   SIM_TUNE="<live arm>" node tools/probe_eraskew.mjs [steps=30000] [W=480] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { G_STAPLE, G_MATERIALS, G_METAL } from "../src/sim/peopleSim/goods.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 480), H = W >> 1, SEED = +(process.argv[4] || 8817);
const rc = await import("../src/realClimateData.js");
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
const world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });
world._kDbg = true;

const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
const TR = ["organization", "construction", "metallurgy", "navigation", "agriculture", "mobility"];
console.log(`\n=== ERA SKEW  ${W}x${H} (tw=${world.tw})  seed ${SEED}  OBSERVED + arm  ${STEPS} steps ===`);
console.log(`  gates: galleys nav 0.58 (era1) · iron_working met 0.70 (era2) · crop_rotation agr 0.72 (era2)\n`);

for (let done = 0; done < STEPS; done += 3000) {
  stepPeopleSim(world, 3000);
  const k = {}; for (const t of TR) k[t] = [];
  const pStaple = [], pMetal = [], pMat = [];
  const sci = [], nAgri = [], nMet = [], hegs = [];
  // PORT-scoped fleet/needSea (the first run's flaw: p50 over ALL settlements
  // is dominated by inland zeros) + the sea-lane carrying census.
  const fleetsP = [], nSeaP = [];
  let n = 0, ports = 0, portsWithLanes = 0, portsCarrying = 0;
  const metRows = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s.knowledge) continue;
    n++;
    for (const t of TR) k[t].push(s.knowledge[t] || 0);
    if (s._gPrice) { pStaple.push(s._gPrice[G_STAPLE] || 0); pMetal.push(s._gPrice[G_METAL] || 0); pMat.push(s._gPrice[G_MATERIALS] || 0); }
    if (s._dbgSciMul !== undefined) sci.push(s._dbgSciMul);
    if (s._dbgNeedAgri !== undefined) nAgri.push(s._dbgNeedAgri);
    if (s._dbgNeedMetal !== undefined) nMet.push(s._dbgNeedMetal);
    if (s._dbgFleet !== undefined) {   // hooked inside the wa>0 branch — ports only by construction
      ports++;
      fleetsP.push(s._dbgFleet);
      if (s._dbgNeedSea !== undefined) nSeaP.push(s._dbgNeedSea);
      if (s._seaReach && s._seaReach.size > 0) portsWithLanes++;
      if ((s._seaShare || 0) > 0.01) portsCarrying++;
    }
    hegs.push(s._hegF || 0);
    metRows.push({ m: s.knowledge.metallurgy || 0, cap: s._metalCap ?? -1, need: s._dbgNeedMetal, sci: s._dbgSciMul, name: s.name });
  }
  metRows.sort((a, b) => b.m - a.m);
  console.log(`step ${String(world.step).padStart(6)}  n ${n} · ports(wa>0) ${ports} · with-sea-lanes ${portsWithLanes} · carrying(seaShare>.01) ${portsCarrying}`);
  console.log(`   tracks p50|p90|max  ${TR.map(t => `${t.slice(0, 3)} ${q(k[t], .5).toFixed(2)}|${q(k[t], .9).toFixed(2)}|${(k[t].length ? Math.max(...k[t]) : 0).toFixed(2)}`).join("  ")}`);
  console.log(`   dearness p50/p90  staple ${q(pStaple, .5).toFixed(2)}/${q(pStaple, .9).toFixed(2)} · metal ${q(pMetal, .5).toFixed(2)}/${q(pMetal, .9).toFixed(2)} · materials ${q(pMat, .5).toFixed(2)}/${q(pMat, .9).toFixed(2)}   (need = 1 + II·max(0, p − 1): p ≤ 1 ⇒ the engine idles)`);
  console.log(`   throttles p50/p90  sciMul ${q(sci, .5).toFixed(2)}/${q(sci, .9).toFixed(2)} · needAgri ${q(nAgri, .5).toFixed(2)}/${q(nAgri, .9).toFixed(2)} · needMetal ${q(nMet, .5).toFixed(2)}/${q(nMet, .9).toFixed(2)} · PORTS: needSea ${q(nSeaP, .5).toFixed(2)}/${q(nSeaP, .9).toFixed(2)} · fleet ${q(fleetsP, .5).toFixed(2)}/${q(fleetsP, .9).toFixed(2)} · hegF ${q(hegs, .5).toFixed(2)}/${q(hegs, .9).toFixed(2)}`);
  const top = metRows.slice(0, 3).map(r => `${(r.name || "?").slice(0, 10)} m${r.m.toFixed(2)} cap${r.cap.toFixed(2)} need${r.need !== undefined ? r.need.toFixed(2) : "-"} sci${r.sci !== undefined ? r.sci.toFixed(2) : "-"}`).join(" · ");
  if (top) console.log(`   met frontier: ${top}`);
  console.log("");
}
console.log(`READ: dearness ≤ 1 everywhere ⇒ the induced-innovation engine idles (the`);
console.log(`economy waves relieved the scarcity the learning law fed on). sciMul low +`);
console.log(`hegF high ⇒ stagnation; fleet ≈ 1 at ports ⇒ sea practice never engaged.`);
