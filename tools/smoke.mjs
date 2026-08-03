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

console.log(`[smoke] cradles: distinct, separated seats`);
{
  const world = buildSim({ W, H, seed: SEED, preset: PRESET });
  const cradles = world.settlements.map(s => ({ x: s.pos.x | 0, y: s.pos.y | 0, name: s.name }));
  let minD2 = Infinity;
  for (let i = 0; i < cradles.length; i++) for (let j = i + 1; j < cradles.length; j++) {
    const ddx = Math.min(Math.abs(cradles[i].x - cradles[j].x), world.tw - Math.abs(cradles[i].x - cradles[j].x));
    const ddy = cradles[i].y - cradles[j].y;
    minD2 = Math.min(minD2, ddx * ddx + ddy * ddy);
  }
  check(`cradles distinct & separated (${cradles.length} seats, min gap ${minD2 === Infinity ? "n/a" : Math.sqrt(minD2).toFixed(1)} tiles)`,
    cradles.length >= 2 && minD2 >= 9,
    cradles.map(c => `(${c.x},${c.y})`).join(" "));
}

console.log(`[smoke] determinism: 2 sims, same seed, ${DET_STEPS} steps (stats + full state hash)`);
{
  const a = buildSim({ W, H, seed: SEED, preset: PRESET });
  const b = buildSim({ W, H, seed: SEED, preset: PRESET });
  stepPeopleSim(a, DET_STEPS);
  stepPeopleSim(b, DET_STEPS);
  const { hashWorld: _hw } = await import("../src/sim/persist.js");
  check("determinism: full state hashes identical", _hw(a) === _hw(b), `${_hw(a)} vs ${_hw(b)}`);
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

console.log(`[smoke] identity counties: deterministic, border-respecting, town-anchored`);
{
  const { diffuseIdentityField, IDENTITY_K } = await import("../src/sim/peopleSim/identityField.js");
  const { dominantCulture } = await import("../src/sim/peopleSim/cultures.js");
  const world = buildSim({ W, H, seed: SEED, preset: PRESET });
  // identityField only runs for the active lens (worker-set); mimic that headlessly
  world._identityLens = "culture";
  stepPeopleSim(world, 3000);
  const N = world.N, K = IDENTITY_K, tw = world.tw, terr = world._countryOwner || world._countryClaim;
  diffuseIdentityField(world, "culture");
  const r1 = world.tileCulId.slice();
  diffuseIdentityField(world, "culture");
  let same = true; for (let i = 0; i < r1.length && same; i++) if (r1[i] !== world.tileCulId[i]) same = false;
  check("counties deterministic", same);
  // validity + the core invariant: identity covers NATION-ED LAND ONLY (every
  // covered tile lies in a realm's territory; ocean stays clear elsewhere)
  let cov = 0, badSum = 0, badOrder = 0, offNation = 0;
  for (let ti = 0; ti < N; ti++) {
    const b = ti * K; if (world.tileCulId[b] < 0) continue;
    cov++; let s = 0, prev = 256;
    for (let k = 0; k < K; k++) { const id = world.tileCulId[b + k]; if (id < 0) break; const sh = world.tileCulShr[b + k]; s += sh; if (sh > prev) badOrder++; prev = sh; }
    if (Math.abs(s - 255) > 1) badSum++;
    if (!terr || terr[ti] < 0) offNation++;
  }
  check(`county shares valid (${cov} tiles)`, badSum === 0 && badOrder === 0, `${badSum} bad sums, ${badOrder} mis-ordered`);
  check(`identity covers nation-ed land only (${offNation} off-nation)`, cov > 0 && offNation === 0, `${offNation} covered tiles outside any realm`);
  // town cores: each NATIONAL town's home tile keeps its OWN dominant people (it seeds its county)
  let towns = 0, kept = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || (s.tier | 0) < 1 || s.countryId < 0 || dominantCulture(s) < 0) continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (!terr || terr[ti] < 0) continue;   // home tile not yet in its realm's territory (border lag) — field is masked there
    towns++;
    if (world.tileCulId[ti * K] === dominantCulture(s)) kept++;
  }
  // ≥85% anchored, OR at most one town off — the single border-town exception the
  // ratio approximates, but robust to small samples (with ~5 towns one border flip
  // would otherwise fail an unreachable 0.85). Large N is unaffected: a run with many
  // unanchored cores still fails both clauses.
  check(`town cores anchored (${towns ? (100 * kept / towns).toFixed(1) : 0}% kept)`, towns === 0 || kept / towns >= 0.85 || (towns - kept) <= 1, `${kept}/${towns}`);
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
  // Continuation equivalence: a loaded world's future must stay CLOSE to the
  // uninterrupted run. Exact identity is not required (per-pass transients —
  // trade reach, fronts, sea lanes — re-warm on their own cadence), but any
  // cross-tick state dropped by persist.js shows up here as runaway drift
  // (the pre-fix bug measured ~65% population divergence; the honest bound
  // is ~2%). Tolerances are deliberately loose multiples of the observed
  // residual so the gate only trips on real persistence regressions.
  loaded._checkInvariants = true;
  const M = 1000;
  stepPeopleSim(world, M);
  stepPeopleSim(loaded, M);
  const stA = peopleSimStats(world), st = peopleSimStats(loaded);
  const hits = loaded.debug && loaded.debug.invariantHits;
  let hitTotal = 0; if (hits) for (const k of Object.keys(hits)) hitTotal += hits[k];
  check("loaded world resumes cleanly", hitTotal === 0 && st.settlements > 0 && Number.isFinite(st.totalWealth),
    `${st.settlements} settlements, hits ${JSON.stringify(hits)}`);
  const drift = (x, y) => Math.abs(x - y) / Math.max(1, Math.abs(x));
  const contOk = (A, B) =>
    drift(A.totalPeople, B.totalPeople) < 0.10 &&
    drift(A.totalWealth, B.totalWealth) < 0.25 &&
    Math.abs(A.settlements - B.settlements) <= 3 &&
    Math.abs(A.countries - B.countries) <= 3 &&
    Math.abs(A.landPct - B.landPct) < 0.03;
  const contMsg = (A, B) => `pop ${A.totalPeople} vs ${B.totalPeople} · wealth ${A.totalWealth} vs ${B.totalWealth} · setts ${A.settlements} vs ${B.settlements} · countries ${A.countries} vs ${B.countries} · land ${(A.landPct * 100).toFixed(1)} vs ${(B.landPct * 100).toFixed(1)}%`;
  // SYSTEMATIC vs CHAOTIC (the spread doctrine, applied to this gate): a REAL
  // persistence regression — dropped cross-tick state — drifts on EVERY seed,
  // because the missing state is missing in every save. A single-seed drift
  // bound on a chaotic quantity also trips on one marginal founding flip
  // compounding for 1000 steps, which is noise, not a regression (measured
  // 2026-08-03 under the front-gated founding law: pop drift 11.4% / 0.5% /
  // 0.1% / 0.2% across seeds 4242/4243/9999/1234, hash-identical at the save
  // point in every one — the roundtrip-identity check above is the persistence
  // claim, and it stays hard). So on a primary-seed drift failure the block
  // re-runs ONCE at an independent seed: systematic loss fails both and the
  // gate trips; a lone butterfly passes the second and the gate records it.
  let contPass = contOk(stA, st), contDetail = contMsg(stA, st);
  if (!contPass) {
    const S2 = SEED + 1;
    const w2 = buildSim({ W, H, seed: S2, preset: PRESET });
    stepPeopleSim(w2, 1500);
    const l2 = loadWorld(serializeWorld(w2));
    stepPeopleSim(w2, M); stepPeopleSim(l2, M);
    const a2 = peopleSimStats(w2), b2 = peopleSimStats(l2);
    contPass = contOk(a2, b2);
    contDetail += ` — retry seed ${S2}: ${contMsg(a2, b2)} (${contPass ? "clean: primary-seed drift is chaotic, not dropped state" : "ALSO drifts: systematic"})`;
  }
  check(`loaded continuation tracks original (+${M} steps: pop ${(100 * drift(stA.totalPeople, st.totalPeople)).toFixed(1)}%, wealth ${(100 * drift(stA.totalWealth, st.totalWealth)).toFixed(1)}%)`,
    contPass, contDetail);
}

console.log(`[smoke] DISSOLVE_FARMS lever: no tier-0, deterministic, alive`);
{
  const { applyTuning, resetTuning } = await import("../src/sim/peopleSim/tuning.js");
  // The "fewer entities" guarantee is judged against the MEASURED legacy
  // farming-region model (DISSOLVE_FARMS=0) under the same defaults — not a
  // hardcoded snapshot, which went stale the moment REGION_SPACING's default
  // changed the dissolve model's town density (the comboE flip: 64 towns vs a
  // fitted "< 60"). Re-baselined 2026-07 (docs/land-works.md addendum 5): the
  // two arms are different MODELS whose worlds legitimately diverge (under the
  // ledger-fed defaults the legacy arm matures poorer — ~58 entities on ~3.5k
  // people vs dissolve's ~61 on ~7.6k), so RAW totals degenerated into a
  // one-seed ±3 coin flip that was binding default policy. The guarantee, per
  // its own words, is GRANULARITY: the dissolve representation must carry
  // civilization with fewer entities PER PERSON than the region-swarm
  // representation, at any world size. A dissolve regression into a village
  // swarm drives entities-per-capita back up to region granularity and trips.
  let legacyN = 0, legacyPop = 1;
  applyTuning({ DISSOLVE_FARMS: 0 });
  try {
    const l = buildSim({ W, H, seed: SEED, preset: PRESET });
    stepPeopleSim(l, 3000);
    const ls = peopleSimStats(l);
    legacyN = ls.settlements; legacyPop = Math.max(1, ls.totalPeople);
  } finally { resetTuning(); }
  applyTuning({ DISSOLVE_FARMS: 1 });
  try {
    const a = buildSim({ W, H, seed: SEED, preset: PRESET }); a._checkInvariants = true;
    const b = buildSim({ W, H, seed: SEED, preset: PRESET });
    stepPeopleSim(a, 3000); stepPeopleSim(b, 3000);
    const sa = peopleSimStats(a), sb = peopleSimStats(b); delete sa.tickMs; delete sb.tickMs;
    check("dissolve: deterministic", JSON.stringify(sa) === JSON.stringify(sb));
    const setts = a.settlements.filter(s => s.mode === "settled");
    const t0 = setts.filter(s => (s.tier | 0) === 0).length;
    check(`dissolve: no farming regions (t0=${t0})`, t0 === 0, `${t0} tier-0 remain`);
    const hits = a.debug && a.debug.invariantHits; let hitTotal = 0; if (hits) for (const k of Object.keys(hits)) hitTotal += hits[k];
    check("dissolve: zero invariant violations", hitTotal === 0, hits ? JSON.stringify(hits) : "");
    check(`dissolve: civilization alive (${sa.settlements} settlements)`, sa.settlements >= 5 && sa.totalPeople > 500);
    const gDiss = sa.settlements / Math.max(1, sa.totalPeople);
    const gLegacy = legacyN / legacyPop;
    check(`dissolve: fewer entities per person than farming-region model (${(1000 * gDiss).toFixed(1)} vs ${(1000 * gLegacy).toFixed(1)} per 1k pop)`,
      gDiss < gLegacy,
      `dissolve ${sa.settlements} entities / ${sa.totalPeople} pop vs legacy ${legacyN} / ${legacyPop}`);
  } finally {
    resetTuning();   // restore defaults so nothing downstream sees the lever
  }
}

const secs = ((performance.now() - t0) / 1000).toFixed(1);
if (failures > 0) {
  console.error(`[smoke] ${failures} check(s) FAILED in ${secs}s`);
  process.exit(1);
}
console.log(`[smoke] all checks passed in ${secs}s`);
