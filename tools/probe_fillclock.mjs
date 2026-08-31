// THE BASIN FILL CLOCK — how fast do the cradle basins actually fill, and how
// does the org lead ride the curve? (2026-08-26, genesis lap iteration 2. The
// 40k A/B measured CAGE_FILL=1 moving writing 15000 → 17250 — direction right,
// magnitude ~+2250 of the ~+11000 needed. The implied fill ramp is ~4.5k ticks;
// real basin-packing took ~5000y ≈ 20k ticks. Two candidate mechanisms:
//   · the demographic clock — but SETT_GROWTH 0.0007/step ≈ 0.14%/y is HONEST
//     (the historical Neolithic band); if the fill is fast, the driver is the
//     field's capacity-seeking MIGRATION or a capacity that never ramps;
//   · the drive shape — Carneiro binds at land EXHAUSTION (flight impossible),
//     so the drive should be convex near saturation, not linear in fill.
// This prints fill(t)/cage(t) at the four Old-World hearth tiles + the leads,
// so the choice is measured, not guessed.)
//
//   SIM_TUNE="<live arm>,CAGE_FILL=1" node tools/probe_fillclock.mjs [steps=20000] [W=480] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { landKnowLeadK } from "../src/sim/peopleSim/landKnow.js";
import { cageAt } from "../src/sim/peopleSim/cageField.js";

const STEPS = +(process.argv[2] || 20000);
const W = +(process.argv[3] || 480), H = W >> 1, SEED = +(process.argv[4] || 8817);
const rc = await import("../src/realClimateData.js");
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
const world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });

// The four Old-World hearth pins (tw-grid coords from the pin log — stable per seed/map)
const HEARTHS = [["Nile", 138, 41], ["Mesop", 149, 38], ["Indus", 166, 41], ["Yellow", 197, 38]];
const ti = (x, y) => y * world.tw + x;

console.log(`\n=== BASIN FILL CLOCK  ${W}x${H} (tw=${world.tw})  seed ${SEED}  OBSERVED + arm  ${STEPS} steps ===`);
console.log(`  ${"step".padStart(6)}  ${HEARTHS.map(h => (h[0] + " fill/cage").padStart(16)).join("  ")}  ${"org".padStart(5)} ${"agr".padStart(5)}  cities`);

for (let done = 0; done < STEPS; done += 500) {
  stepPeopleSim(world, 500);
  const cells = HEARTHS.map(([, x, y]) => {
    const t = ti(x, y);
    const fill = world._cageFill ? world._cageFill[t] : -1;
    return `${fill >= 0 ? fill.toFixed(2) : "  — "}/${cageAt(world, t).toFixed(2)}`.padStart(16);
  });
  const lk = landKnowLeadK(world) || {};
  let org = lk.organization || 0, agr = lk.agriculture || 0, cities = 0;
  for (const s of world.settlements) if (s.mode === "settled") {
    cities++;
    if (s.knowledge) { org = Math.max(org, s.knowledge.organization || 0); agr = Math.max(agr, s.knowledge.agriculture || 0); }
  }
  console.log(`  ${String(world.step).padStart(6)}  ${cells.join("  ")}  ${org.toFixed(2).padStart(5)} ${agr.toFixed(2).padStart(5)}  ${cities}`);
}
console.log(`\nREAD: fill hitting ~0.9 within ~2-3k ticks of farming ⇒ the ramp is the`);
console.log(`problem (migration/capacity, or the drive needs Carneiro's knee — convex`);
console.log(`near saturation). A slow ramp with org still sprinting ⇒ the drive's other`);
console.log(`factors (cage, ceil) are already saturated and fill is diluted, not binding.`);
