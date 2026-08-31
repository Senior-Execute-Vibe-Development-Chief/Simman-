// THE LIVE-ARM GATE — the second arm of the stylized battery, run on the world
// the app actually ships. Work-plan item 2 (docs/food-work-plan-2026-08-27.md
// §2); evidence in docs/food-system-design-2026-08-27.md §6.1-§6.2.
//
// THE PROBLEM IT EXISTS FOR. tools/_harness.mjs pins a set of levers OFF so the
// standing gates measure mature-regime facts at fixed horizons instead of
// measuring the Neolithic — a defensible choice, made for good reasons, and
// documented at length in applyToolTuning(). But it has a cost nobody was
// paying attention to: the pinned world and the shipped world are not the same
// world. Measured at tw=480/32k on identical settings, the gate configuration
// produces ~20 realms and the shipped configuration produces 541 — a factor of
// ~25 in the political register. A green stylized battery is therefore evidence
// about the GATE world, and the gate world is not the game.
//
// It cost real work in one week. CORE_LOCAL's first kill-shot ran with
// LAND_KNOW pinned 0, so the edited line never executed and both arms came back
// byte-identical — a null result that meant "wrong regime", not "no effect",
// and was caught only because the hashes matched. SEED_EXCLUSIVE was refuted on
// the harness arm, so its verdict stands on the wrong world even if it stands.
// npm run validate is a LITERAL no-op for CORE_LOCAL: 38 of 39 settlements
// identical, because coreR = 0 at the reference grid AND LAND_KNOW is pinned.
//
// WHAT THIS IS NOT. Not a replacement for npm run validate — that battery's
// bands were calibrated on the pinned regime and stay there. This is a SECOND
// arm, so that "the gates are green" can mean something about the shipped game.
//
// HOW IT DERIVES THE LIVE ARM. From the code, never from a copied string. It
// snapshots tuningDefaults() (the shipped values, which applyTuning never
// mutates — it only writes T), then imports the harness, whose applyToolTuning()
// mutates T into the gate regime, and diffs the two. So the day someone flips a
// default or adds a pin, this gate follows automatically instead of quietly
// measuring last month's shipped world. Today the diff is 18 of 19 pins.
//
//   node tools/livegate.mjs [seed] [steps] [W]
//   npm run livegate
import { spawnSync } from "node:child_process";
import { T, tuningDefaults } from "../src/sim/peopleSim/tuning.js";

// Snapshot BEFORE the harness runs. DEFAULTS is never written by applyTuning
// (tuning.js:999-1008 assigns to T only), so this is the shipped world's values.
const SHIPPED = tuningDefaults();
// The parent's own SIM_TUNE must not contaminate the derivation — the pins are
// what we want, not whatever the caller was experimenting with. The child gets
// the derived arm explicitly, plus any caller SIM_TUNE appended last so a
// one-off override still wins where it is deliberate.
const CALLER_TUNE = process.env.SIM_TUNE || "";
delete process.env.SIM_TUNE;
await import("./_harness.mjs");   // applyToolTuning() mutates T into the gate regime
const HARNESS = { ...T };

const SEED = process.argv[2] || "8817";
// HORIZON. Under the v49 genesis clock (CAGE_FILL + EPOCH_YD) the live dawn
// spends its first ~23k steps in the Neolithic — villages, no states — so a
// battery run at validate's 24k horizon would measure a pre-political planet
// and report "0 polities" as a shape failure. That is not a bug in the world;
// it is the Younger-Dryas anchor doing exactly what it was built to do. The
// political map exists from ~24k and is still expanding hard at 32k.
// GRID. The reference grid (W=480, tw=240) cannot carry this measurement: at
// tw=240 coreR = 0 and a real orphaned patch is one settlement, which is the
// regime where SUCCESSOR_STATES and CORE_LOCAL both measured nothing. W=960
// (tw=480) is resgate's standing cross-grid proxy and the coarsest grid where
// the small-state tier exists at all.
const STEPS = process.argv[3] || "32000";
const W = process.argv[4] || "960";

const diverged = [];
for (const k of Object.keys(HARNESS)) {
  if (SHIPPED[k] !== undefined && SHIPPED[k] !== HARNESS[k]) diverged.push(k);
}
diverged.sort();

console.log("[livegate] THE GATE REGIME vs THE SHIPPED REGIME");
console.log("[livegate] " + "lever".padEnd(22) + "gate".padStart(9) + "shipped".padStart(10));
for (const k of diverged) console.log("[livegate] " + k.padEnd(22) + String(HARNESS[k]).padStart(9) + String(SHIPPED[k]).padStart(10));
console.log(`[livegate] ${diverged.length} of ${Object.keys(HARNESS).length} levers pinned away from what the app ships.`);
if (!diverged.length) {
  console.log("[livegate] NOTHING DIVERGES — the harness no longer pins anything the app ships differently.");
  console.log("[livegate] This gate is redundant in that case, and npm run validate already measures the live world.");
  process.exit(0);
}

const LIVE = diverged.map(k => `${k}=${SHIPPED[k]}`).join(",");
const TUNE = CALLER_TUNE ? `${LIVE},${CALLER_TUNE}` : LIVE;
console.log(`\n[livegate] SIM_TUNE="${TUNE}"`);
console.log(`[livegate] running the stylized battery on the LIVE arm: seed ${SEED} · W=${W} · ${STEPS} steps\n`);

const r = spawnSync(process.execPath, ["tools/stylized.mjs", SEED, STEPS, W], {
  encoding: "utf8", env: { ...process.env, SIM_TUNE: TUNE }, maxBuffer: 1 << 28,
});
const out = (r.stdout || "") + (r.stderr || "");
process.stdout.write(out);

// THE ARMING CHECK, APPLIED TO THE GATE ITSELF. The whole reason this file
// exists is that a run can silently execute a different regime than the one it
// claims. So do not take it on faith that the child received the arm: the
// harness echoes its parsed overrides, and if that line does not carry the
// levers this gate derived, the run measured the wrong world and is worthless.
const echoed = out.match(/\[SIM_TUNE\]\s*(\{.*\})/);
let armed = false;
if (echoed) {
  try {
    const got = JSON.parse(echoed[1]);
    armed = diverged.every(k => got[k] === SHIPPED[k]);
  } catch { /* unparsable echo — treat as unarmed */ }
}
if (!armed) {
  console.log(`\n[livegate] ARMING FAILED — the child did not echo the derived live arm.`);
  console.log(`[livegate] Whatever it printed above is about some other world. Not a result.`);
  process.exit(2);
}
console.log(`\n[livegate] armed: the child ran all ${diverged.length} shipped values.`);
console.log(r.status ? `[livegate] LIVE ARM FAILED (stylized exit ${r.status})` : `[livegate] LIVE ARM PASSED`);
process.exit(r.status || 0);
