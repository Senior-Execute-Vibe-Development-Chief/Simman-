// DOES THE CRADLE-SCORING ERROR ACTUALLY BIND? (2026-08-23)
//
// Two levers failed today because I read a mechanism, confirmed it was real, and
// built for it WITHOUT first checking whether it binds at the density that ships.
// The contagion was real and saturated; the submission bar was real and the
// population was inflow-limited. Both levers were correct and irrelevant.
//
// So before the irrigation wave gets built, this asks the question that should
// have come first. `owner-review-2026-08-21.md` item 2 argues that southern
// Mesopotamia scores as mediocre RAIN-FED farmland (wheat suit 0.67, hearth score
// 4.0-4.3 against the Nile's 6.4-7.2), so the model cannot see why Sumer is Sumer;
// irrigation is the named missing mechanism. That is a plausible story. It is not
// yet a measured cause.
//
// The chain from farmland to statehood has five links, and irrigation acts on the
// FIRST TWO ONLY:
//
//   1. capField   — what the ground can feed          <- irrigation acts here
//   2. popField   — the people it actually carries    <- and here, downstream
//   3. ledger org — the tallies bar, URBAN_ORG 0.28
//   4. first city
//   5. first state — RECORDS_ORG 0.35
//
// So the test is a DECOMPOSITION, not a comparison of end states:
//
//   * if Mesopotamia's lag lives in links 1-2 — thin capacity, a basin that fills
//     late — then fertility IS the binding constraint and irrigation would move it.
//   * if its capacity and people are fine by the time the Nile is stating, and the
//     lag is in links 3-5, then irrigation cannot help and the constraint is the
//     organisation/pressure machinery. Building the wave would be the third
//     correct-and-irrelevant lever of the day.
//
// Reports per cradle region, per window: capacity, people, the fill ratio
// (people/capacity — is the basin SATURATED or still filling?), the best ledger
// org, and the steps at which the first city and first state arrive.
//
//   node tools/probe_cradlelag.mjs [steps] [W] [seed] [window]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { ensureLandKnow } from "../src/sim/peopleSim/landKnow.js";

const STEPS = +(process.argv[2] || 24000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const WIN = +(process.argv[5] || 2000);

const world = buildSim({ W, H, seed: SEED });
const tw = world.tw, th = world.th, N = world.N, elev = world.elev;
const lonOf = (x) => (x / tw) * 360 - 180;
const latOf = (y) => 90 - (y / th) * 180;

// The four canonical cradles, plus two controls the sim currently URBANISES HARD
// and history did not (the inversion measured in wherecities480).
const R = [
  { k: "Nile",        lon: [26, 34], lat: [16, 32] },
  { k: "Mesopotamia", lon: [40, 50], lat: [29, 38] },
  { k: "Indus",       lon: [66, 78], lat: [22, 34] },
  { k: "YellowRiver", lon: [104, 122], lat: [30, 42] },
  { k: "~Sahel",      lon: [-18, 40], lat: [8, 18] },
  { k: "~AfrSouth",   lon: [10, 42], lat: [-35, 5] },
];
const tiles = R.map(() => []);
for (let ti = 0; ti < N; ti++) {
  if (!(elev[ti] > 0)) continue;
  const y = (ti / tw) | 0, x = ti - y * tw, lo = lonOf(x), la = latOf(y);
  for (let i = 0; i < R.length; i++) {
    const r = R[i];
    if (lo >= r.lon[0] && lo <= r.lon[1] && la >= r.lat[0] && la <= r.lat[1]) { tiles[i].push(ti); break; }
  }
}

const firstCity = R.map(() => -1), firstState = R.map(() => -1);
const rows = [];
for (let done = 0; done < STEPS; done += WIN) {
  stepPeopleSim(world, Math.min(WIN, STEPS - done));
  const pf = world.popField, cf = world.capField;
  const lk = ensureLandKnow(world);
  const snap = [];
  for (let i = 0; i < R.length; i++) {
    let cap = 0, pop = 0;
    for (const ti of tiles[i]) { cap += cf ? cf[ti] : 0; pop += pf ? pf[ti] : 0; }
    let bestOrg = 0;
    if (lk) for (const rec of lk.values()) {
      const y = (rec.ti / tw) | 0, x = rec.ti - y * tw, lo = lonOf(x), la = latOf(y);
      if (lo >= R[i].lon[0] && lo <= R[i].lon[1] && la >= R[i].lat[0] && la <= R[i].lat[1])
        bestOrg = Math.max(bestOrg, rec.k.organization || 0);
    }
    snap.push({ cap, pop, fill: cap > 0 ? pop / cap : 0, org: bestOrg });
  }
  // first city / first state per region
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const x = s.pos.x | 0, y = s.pos.y | 0, lo = lonOf(x), la = latOf(y);
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!(lo >= r.lon[0] && lo <= r.lon[1] && la >= r.lat[0] && la <= r.lat[1])) continue;
      if ((s.tier | 0) >= 2 && firstCity[i] < 0) firstCity[i] = world.step;
      if (s.countryId >= 0 && firstState[i] < 0) firstState[i] = world.step;
      break;
    }
  }
  rows.push({ step: world.step, snap });
}

console.log(`\n=== THE CRADLE LAG, DECOMPOSED  ${W}x${H} (tw=${tw})  seed ${SEED} ===`);
console.log(`\n  Does the lag live in CAPACITY (irrigation's link) or in ORGANISATION (not)?\n`);
for (let i = 0; i < R.length; i++) {
  console.log(`  ${R[i].k}${R[i].k.startsWith("~") ? "  (control: history says ~0 cities here)" : ""}`);
  console.log(`     step   capacity      people   fill%    best ledger org`);
  for (const r of rows) {
    const s = r.snap[i];
    if (s.cap <= 0 && s.pop <= 0) continue;
    console.log(`   ${String(r.step).padStart(6)}  ${s.cap.toFixed(0).padStart(9)}  ${s.pop.toFixed(0).padStart(10)}  ${(100 * s.fill).toFixed(0).padStart(5)}%  ${s.org.toFixed(3).padStart(15)}`);
  }
  console.log(`     first city: ${firstCity[i] < 0 ? "never" : "step " + firstCity[i]}   first flag: ${firstState[i] < 0 ? "never" : "step " + firstState[i]}`);
  console.log("");
}
console.log(`  READ IT THIS WAY:`);
console.log(`   · fill% near 100 means the basin is SATURATED — its people are capped by what`);
console.log(`     the ground can feed, and raising capacity (irrigation) would raise them.`);
console.log(`   · fill% well under 100 means the basin is still FILLING — capacity is not the`);
console.log(`     binding constraint, and irrigation would hand it headroom it is not using.`);
console.log(`   · a cradle whose org lags while its fill is low is held by the ORGANISATION`);
console.log(`     machinery, not by its farmland, and irrigation would be a third correct-and-`);
console.log(`     irrelevant lever.`);
console.log("");
