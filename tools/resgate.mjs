// THE APP-GRID ARM — a standing gate on the blind spot that cost two sessions.
//
// Every battery in this repo runs at W=480 (sim tw=240). The APP ships W=1920 /
// simDiv 4 (sim tw=480). Three times in one week a change was validated at the
// reference grid and shipped a regression that only existed at the grid players
// actually use — and each time the difference was not one of DEGREE but of KIND:
//
//   * deffdce (the size-target re-grounding): 1.91% -> 1.73% claimed at tw=240,
//     a 10% effect. At tw=480 the median realm went 70 tiles -> 7. A 10x cut.
//   * b859db7 (SUCCESSOR_STATES): its own commit measured "0 secessions per 24k,
//     the channels are live but atom-starved" — true at tw=240, where an orphaned
//     patch is ONE settlement and the >=2-member rule lapses it. At tw=480 the
//     same real patch holds several, so it fires constantly: 15 recessions in the
//     first 2000 steps of a four-realm world.
//   * the whole 2026-07-29 "resolution collapse" investigation.
//
// Why the existing gates cannot see it: `npm run validate`'s empire checks are all
// RATIOS (largest empire's SHARE, area tail largest/median, polity count). A world
// whose realms are uniformly 10x too small passes every one of them. The missing
// measurement is ABSOLUTE REAL AREA, compared ACROSS GRIDS.
//
// WHAT THIS GATE IS. Not an invariance proof — the two grids genuinely differ
// today (a ~1.3-2.2x capacity gap from 1-D coast/river dilution, docs/
// resolution-collapse-2026-07-29.md, still open). It is a RATCHET: it records the
// cross-grid ratio the world currently achieves and fails if a change makes it
// WORSE, plus an absolute floor on the app grid so a collapse-to-anchor can never
// ship again. The bands below are a recorded gap to be CLOSED, never a target to
// tune toward — if a change improves them, re-baseline downward and say so.
//
//   node tools/resgate.mjs [steps=6000] [seed=8817]
//   npm run resgate
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 6000);
const SEED = +(process.argv[3] || 8817);

// ── The bands (see header: a recorded gap, not a target) ─────────────────────
// Measured on claude/early-game-balance-regression-wyroh3 @ 02984ec, seed 8817,
// step 6000. Floors sit ~25% below the measured value so ordinary seed-to-seed
// and refactor noise does not trip them, and a REGIME change cannot pass.
// Measured on claude/early-game-balance-regression-wyroh3 @ 02984ec, step 6000,
// on BOTH gate seeds — the cross-grid ratio has wide seed-to-seed spread, so each
// floor is set ~25% below the WORSE of the two, never below one seed alone:
//
//              seed 8817     seed 31337     floor
//   median area   0.57          1.09         0.42
//   claimed       0.59          0.82         0.44
//   pop density   0.54          1.00         0.40
//   app median    210k km²      267k km²     60k  (absolute regime floor)
//   app realms    17            11           6
//
// That spread is why this is a REGIME gate: it catches the 2-10x regressions that
// got past the reference-grid batteries, not 20% drift. Checked against the two it
// was built for — `deffdce` put the app median at 27k km² (the absolute floor fires,
// 27k < 60k) and `SUCCESSOR_STATES` cut the app median ~1.75x while leaving tw=240
// untouched, taking the ratio to ~0.33 (below 0.42). Both caught.
const BANDS = {
  medianAreaRatio: 0.42,   // app median realm area / reference
  claimedRatio:    0.44,   // app claimed% / reference
  popDensRatio:    0.40,   // app people-per-km² / reference
  appMedianKm2:    60000,  // ABSOLUTE: a one-tile realm at tw=480 is ~4,000 km²
  appRealmsMin:    6,      // the app grid must carry a real map, not two dots
};

const run = (W) => {
  const w = buildSim({ W, H: W >> 1, seed: SEED });
  stepPeopleSim(w, STEPS);
  const { N, elev } = w;
  let land = 0, pop = 0;
  for (let i = 0; i < N; i++) if (elev[i] > 0) { land++; if (w.popField) pop += w.popField[i]; }
  const km2PerTile = (510e6 * 0.29) / land;          // real km² per sim tile at this grid
  const co = w._countryOwner, held = new Map();
  let claimed = 0;
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0)) continue;
    const c = co[i]; if (c < 0) continue;
    claimed++; held.set(c, (held.get(c) || 0) + 1);
  }
  const sizes = [...held.values()].sort((a, b) => a - b);
  return {
    tw: w.tw, land,
    realms: sizes.length,
    claimedPc: 100 * claimed / land,
    medianKm2: (sizes.length ? sizes[sizes.length >> 1] : 0) * km2PerTile,
    largestKm2: (sizes[sizes.length - 1] || 0) * km2PerTile,
    popPerKm2: pop / (land * km2PerTile),
  };
};

console.log(`[resgate] seed=${SEED} steps=${STEPS} — reference grid vs the SHIPPED app grid`);
const ref = run(480);    // tw=240, where every other battery runs
const app = run(960);    // tw=480, what the app ships (mapScale 1920 / simDiv 4)

const row = (k, r, a, fmt) => console.log(`  ${k.padEnd(22)} ref ${fmt(r).padStart(12)}   app ${fmt(a).padStart(12)}   app/ref ${(a / (r || 1e-9)).toFixed(2)}`);
const km = (x) => `${Math.round(x / 1000)}k km²`;
const pc = (x) => `${x.toFixed(2)}%`;
const n = (x) => `${x}`;
console.log(`  grids: tw=${ref.tw} (${ref.land} land tiles) vs tw=${app.tw} (${app.land} land tiles)`);
row("realms", ref.realms, app.realms, n);
row("claimed land", ref.claimedPc, app.claimedPc, pc);
row("MEDIAN realm area", ref.medianKm2, app.medianKm2, km);
row("largest realm area", ref.largestKm2, app.largestKm2, km);
row("people per km²", ref.popPerKm2, app.popPerKm2, (x) => x.toFixed(4));

let fail = 0;
const check = (name, got, floor, fmt) => {
  const ok = got >= floor;
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(34)} ${fmt(got)} (floor ${fmt(floor)})`);
};
console.log("");
check("app/ref median realm area", app.medianKm2 / (ref.medianKm2 || 1e-9), BANDS.medianAreaRatio, (x) => x.toFixed(2));
check("app/ref claimed land", app.claimedPc / (ref.claimedPc || 1e-9), BANDS.claimedRatio, (x) => x.toFixed(2));
check("app/ref people per km²", app.popPerKm2 / (ref.popPerKm2 || 1e-9), BANDS.popDensRatio, (x) => x.toFixed(2));
check("app median realm ABSOLUTE", app.medianKm2, BANDS.appMedianKm2, km);
check("app realm count", app.realms, BANDS.appRealmsMin, n);

console.log(fail
  ? `\n[resgate] ${fail} FAILURE(S) — a change has widened the gap between the calibration grid and the shipped one.\n           Re-measure at BOTH grids before pushing; the reference-grid batteries cannot see this.`
  : `\n[resgate] all app-grid bands held`);
process.exit(fail ? 1 : 0);
