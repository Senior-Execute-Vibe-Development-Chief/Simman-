// CI smoke test (`npm test`): builds a world through the app-identical
// harness pipeline, then checks three things —
//   1. worldgen sanity: land fraction, value ranges, rivers, deposits
//   2. determinism: two sims from the same seed match stat-for-stat
//   3. a multi-thousand-step run with the sim's invariant checker enabled
//      finishes with zero violations and a living, growing civilization
// Exits non-zero with a labelled message on the first failure.

import { buildWorld, buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

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

console.log(`[smoke] identity field: per-tile mirror tracks the entities`);
{
  const { mirrorIdentityField, auditIdentityField } = await import("../src/sim/peopleSim/identityField.js");
  const world = buildSim({ W, H, seed: SEED, preset: PRESET });
  stepPeopleSim(world, 3000);
  mirrorIdentityField(world);                 // exact comparison at a known point
  const rep = auditIdentityField(world);
  check(`field covers owned land (${rep.checked} tiles)`, rep.checked > 100, `${rep.checked} checked`);
  check("field culture matches entities", rep.mismatches.culture === 0, `${rep.mismatches.culture} mismatched`);
  check("field faith matches entities", rep.mismatches.faith === 0, `${rep.mismatches.faith} mismatched`);
  check("field language matches entities", rep.mismatches.language === 0, `${rep.mismatches.language} mismatched`);
}

console.log(`[smoke] identity diffusion: deterministic, anchored, spreads`);
{
  const { mirrorIdentityField, diffuseIdentityField, IDENTITY_K } = await import("../src/sim/peopleSim/identityField.js");
  const { dominantCulture } = await import("../src/sim/peopleSim/cultures.js");
  const world = buildSim({ W, H, seed: SEED, preset: PRESET });
  stepPeopleSim(world, 3000);
  const N = world.N, K = IDENTITY_K, owner = world._territoryOwner, byId = world._byId;
  // coverage of the pure mirror (owned land only)
  mirrorIdentityField(world);
  let mirrorCov = 0; for (let ti = 0; ti < N; ti++) if (world.tileCulId[ti * K] >= 0) mirrorCov++;
  diffuseIdentityField(world, "culture");
  const r1 = world.tileCulId.slice();   // result of run 1
  // determinism: re-mirror + re-diffuse must reproduce byte-for-byte
  mirrorIdentityField(world);
  diffuseIdentityField(world, "culture");
  let same = true; for (let i = 0; i < r1.length && same; i++) if (r1[i] !== world.tileCulId[i]) same = false;
  check("diffusion deterministic", same);
  // validity: every covered tile's shares sum to 255 (dominant-first)
  let cov = 0, badSum = 0, badOrder = 0;
  for (let ti = 0; ti < N; ti++) {
    const b = ti * K; if (world.tileCulId[b] < 0) continue;
    cov++; let s = 0, prev = 256;
    for (let k = 0; k < K; k++) { const id = world.tileCulId[b + k]; if (id < 0) break; const sh = world.tileCulShr[b + k]; s += sh; if (sh > prev) badOrder++; prev = sh; }
    if (Math.abs(s - 255) > 1) badSum++;
  }
  check(`diffusion shares valid (${cov} tiles)`, badSum === 0 && badOrder === 0, `${badSum} bad sums, ${badOrder} mis-ordered`);
  check(`diffusion spreads beyond catchments (${mirrorCov}→${cov})`, cov >= mirrorCov, `mirror ${mirrorCov}, diffused ${cov}`);
  // anchor: owned tiles overwhelmingly keep their settlement's dominant people
  let owned = 0, kept = 0;
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti]; if (oid < 0) continue; const st = byId.get(oid); if (!st || st.mode !== "settled") continue;
    owned++; if (world.tileCulId[ti * K] === dominantCulture(st)) kept++;
  }
  check(`diffusion anchors owned cores (${owned ? (100 * kept / owned).toFixed(1) : 0}% kept)`, owned === 0 || kept / owned >= 0.85, `${kept}/${owned}`);
}

console.log(`[smoke] save/load: roundtrip identity + functional resume`);
{
  const { serializeWorld, loadWorld, hashWorld } = await import("../src/sim/persist.js");
  const world = buildSim({ W, H, seed: SEED, preset: PRESET });
  stepPeopleSim(world, 1500);
  const h0 = hashWorld(world);
  const json = serializeWorld(world);
  const loaded = loadWorld(json);
  const h1 = hashWorld(loaded);
  check("loaded state hashes identical", h0 === h1, `${h0} vs ${h1}`);
  check(`save size sane (${(json.length / 1024).toFixed(0)}KB)`, json.length < 30e6);
  loaded._checkInvariants = true;
  stepPeopleSim(loaded, 500);
  const st = peopleSimStats(loaded);
  const hits = loaded.debug && loaded.debug.invariantHits;
  let hitTotal = 0; if (hits) for (const k of Object.keys(hits)) hitTotal += hits[k];
  check("loaded world resumes cleanly", hitTotal === 0 && st.settlements > 0 && Number.isFinite(st.totalWealth),
    `${st.settlements} settlements, hits ${JSON.stringify(hits)}`);
}

const secs = ((performance.now() - t0) / 1000).toFixed(1);
if (failures > 0) {
  console.error(`[smoke] ${failures} check(s) FAILED in ${secs}s`);
  process.exit(1);
}
console.log(`[smoke] all checks passed in ${secs}s`);
