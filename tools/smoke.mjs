// CI smoke test (`npm test`): builds a world through the app-identical
// harness pipeline, then checks three things —
//   1. worldgen sanity: land fraction, value ranges, rivers, deposits
//   2. determinism: two sims from the same seed match stat-for-stat
//   3. a multi-thousand-step run with the sim's invariant checker enabled
//      finishes with zero violations and a living, growing civilization
// Exits non-zero with a labelled message on the first failure.

import { buildWorld, buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";

const W = 320, H = 160, SEED = 4242, PRESET = "earth_sim";
const DET_STEPS = 600;      // determinism comparison window
const RUN_STEPS = 4000;     // invariant-checked long run

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) { console.log(`  ok   ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const t0 = performance.now();
console.log(`[smoke] worldgen ${W}x${H} seed ${SEED} preset ${PRESET}`);
const { w, rivers, tCrop, deposits } = buildWorld({ W, H, seed: SEED, preset: PRESET });

{
  const N = W * H;
  let land = 0, badElev = 0, badClim = 0, crop = 0;
  for (let i = 0; i < N; i++) {
    const e = w.elevation[i];
    if (!Number.isFinite(e)) badElev++;
    if (e > 0) land++;
    const t = w.temperature[i], m = w.moisture[i];
    if (!Number.isFinite(t) || !Number.isFinite(m) || t < -0.5 || t > 1.5 || m < 0 || m > 1.001) badClim++;
    if (tCrop[i] > 0.4) crop++;
  }
  const landFrac = land / N;
  check("elevation finite", badElev === 0, `${badElev} bad`);
  check("climate in range", badClim === 0, `${badClim} bad`);
  check(`land fraction sane (${landFrac.toFixed(3)})`, landFrac > 0.15 && landFrac < 0.55);
  check("good cropland exists", crop > N * 0.01, `${crop} tiles`);
  let riverTiles = 0;
  for (let i = 0; i < N; i++) if (rivers.riverMag[i] >= 2) riverTiles++;
  check("rivers formed", riverTiles > 50, `${riverTiles} tributary+ tiles`);
  let oreT = 0;
  for (const k of ["iron", "copper", "timber"]) {
    const d = deposits[k];
    if (d) for (let i = 0; i < N; i++) if (d[i] > 0) oreT++;
  }
  check("deposits placed", oreT > 30, `${oreT} iron/copper/timber tiles`);
}

console.log(`[smoke] determinism: 2 sims, same seed, ${DET_STEPS} steps`);
{
  const a = buildSim({ W, H, seed: SEED, preset: PRESET });
  const b = buildSim({ W, H, seed: SEED, preset: PRESET });
  stepPeopleSim(a, DET_STEPS);
  stepPeopleSim(b, DET_STEPS);
  const sa = peopleSimStats(a), sb = peopleSimStats(b);
  delete sa.tickMs; delete sb.tickMs;   // wall-clock, legitimately differs
  const ja = JSON.stringify(sa), jb = JSON.stringify(sb);
  check("same seed → same history", ja === jb, `\n    a: ${ja}\n    b: ${jb}`);
}

console.log(`[smoke] invariant run: ${RUN_STEPS} steps with checks on`);
{
  const world = buildSim({ W, H, seed: SEED, preset: PRESET });
  world._checkInvariants = true;
  const p0 = peopleSimStats(world).totalPeople;
  stepPeopleSim(world, RUN_STEPS);
  const st = peopleSimStats(world);
  const hits = world.debug && world.debug.invariantHits;
  let hitTotal = 0;
  if (hits) for (const k of Object.keys(hits)) hitTotal += hits[k];
  check("zero invariant violations", hitTotal === 0, hits ? JSON.stringify(hits) : "");
  check(`civilization alive (${st.settlements} settlements)`, st.settlements >= 5);
  check(`population grew (${p0} → ${st.totalPeople})`, st.totalPeople > p0);
  check("wealth finite & non-negative", Number.isFinite(st.totalWealth) && st.totalWealth >= 0, String(st.totalWealth));
  console.log(`  info step ${st.step} · ${st.settlements} settlements · pop ${st.totalPeople} · wealth ${st.totalWealth} · ${st.countries} countries · claimed ${(st.landPct * 100).toFixed(1)}% of land`);
}

const secs = ((performance.now() - t0) / 1000).toFixed(1);
if (failures > 0) {
  console.error(`[smoke] ${failures} check(s) FAILED in ${secs}s`);
  process.exit(1);
}
console.log(`[smoke] all checks passed in ${secs}s`);
