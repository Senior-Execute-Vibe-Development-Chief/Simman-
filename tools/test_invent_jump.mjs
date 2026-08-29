// Invent foresight smoke: under DAWN_LIVE × INVENT_JUMP, genesis opens with
// farming already invented (hearth seeds) and world.step past the forager wait.

import { buildSim } from "./_harness.mjs";
import { applyTuning, resetTuning, T } from "../src/sim/peopleSim/tuning.js";
import { SAVE_VERSION } from "../src/sim/persist.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log(`[invent-jump] SAVE_VERSION=${SAVE_VERSION} defaults INVENT_JUMP=${T.INVENT_JUMP} DAWN_LIVE=${T.DAWN_LIVE}`);

// Harness pins DAWN_LIVE=0; force the live-dawn + jump arm for this check.
resetTuning();
applyTuning({
  POP_FIELD_WORKERS: 0,
  DAWN_LIVE: 1,
  INVENT_JUMP: 1,
  STATE_RECORDS: 0,
  LAND_KNOW: 0,
  PEER_SEATS: 0,
});

const t0 = performance.now();
const world = buildSim({ W: 480, H: 240, seed: 8817, preset: "earth_sim" });
const ms = performance.now() - t0;

check("genesis completed", !!world, "");
check(`invent-jump advanced step (${world.step})`, world.step > 500, `step=${world.step}`);
check("farming seeds present", !!(world._hearthSeeds && world._hearthSeeds.length), `seeds=${world._hearthSeeds?.length || 0}`);
check("no settlements yet (CITY_AT_BIRTH invent-only)", world.settlements.filter(s => s.mode === "settled").length === 0,
  `settled=${world.settlements.filter(s => s.mode === "settled").length}`);
check(`genesis wall-clock sane (${ms.toFixed(0)}ms)`, ms < 120_000, `${ms.toFixed(0)}ms`);

// Later hearths may remain armed (stagger) — that is expected.
const armed = world._armedHearths ? world._armedHearths.length : 0;
console.log(`  info  armed remaining=${armed} seeds=${world._hearthSeeds?.length || 0} step=${world.step}`);

if (failures) {
  console.error(`[invent-jump] ${failures} failure(s)`);
  process.exit(1);
}
console.log(`[invent-jump] ALL OK in ${(performance.now() - t0).toFixed(0)}ms`);
