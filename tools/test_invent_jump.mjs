// Mint-ready foresight smoke: under DAWN_LIVE × INVENT_JUMP, genesis opens
// with farming invented, a site at mint-ready (no city yet), and world.step
// past the invent→gather wait. First play crystallize should mint.

import { buildSim } from "./_harness.mjs";
import { applyTuning, resetTuning, T } from "../src/sim/peopleSim/tuning.js";
import { maybeCrystallize } from "../src/sim/peopleSim/crystallize.js";
import { SAVE_VERSION } from "../src/sim/persist.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log(`[invent-jump] SAVE_VERSION=${SAVE_VERSION} defaults INVENT_JUMP=${T.INVENT_JUMP} DAWN_LIVE=${T.DAWN_LIVE}`);

// Harness pins DAWN_LIVE=0 / LAND_KNOW=0; force the live-dawn + jump arm.
// LAND_KNOW stays off here so the mint bar is the core census alone (faster
// smoke); the app arm with LAND_KNOW on uses the same hold-mint path.
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
check(`mint-ready jump advanced step (${world.step})`, world.step > 2000, `step=${world.step}`);
check("farming seeds present", !!(world._hearthSeeds && world._hearthSeeds.length), `seeds=${world._hearthSeeds?.length || 0}`);
check("mint-ready flag set", !!world._dawnMintReady, `_dawnMintReady=${world._dawnMintReady}`);
check("no settlements yet (mint held for play)", world.settlements.filter(s => s.mode === "settled").length === 0,
  `settled=${world.settlements.filter(s => s.mode === "settled").length}`);
check(`genesis wall-clock sane (${ms.toFixed(0)}ms)`, ms < 300_000, `${ms.toFixed(0)}ms`);

// First live crystallize should mint the waiting site.
const before = world.settlements.filter(s => s.mode === "settled").length;
maybeCrystallize(world);
// Site mint only fires on SITE_CITY_IVL — nudge onto cadence if needed.
if (world.settlements.filter(s => s.mode === "settled").length === before) {
  const ivl = 25;
  const bump = (ivl - (world.step % ivl)) % ivl;
  for (let i = 0; i < bump; i++) {
    world.step++;
    maybeCrystallize(world);
  }
  if (world.settlements.filter(s => s.mode === "settled").length === before) {
    world.step++;
    maybeCrystallize(world);
  }
}
const after = world.settlements.filter(s => s.mode === "settled").length;
check(`first play crystallize mints a city (${after})`, after > before, `before=${before} after=${after}`);

const armed = world._armedHearths ? world._armedHearths.length : 0;
console.log(`  info  armed remaining=${armed} seeds=${world._hearthSeeds?.length || 0} step=${world.step} genesisMs=${ms.toFixed(0)}`);

if (failures) {
  console.error(`[invent-jump] ${failures} failure(s)`);
  process.exit(1);
}
console.log(`[invent-jump] ALL OK in ${(performance.now() - t0).toFixed(0)}ms`);
