// THE GENESIS CHRONOLOGY SCORECARD — when does each milestone fire, and where
// would it land on a Younger-Dryas-anchored calendar? (2026-08-26, the genesis
// lap. Owner: "farming is INVENTED at about 3000bc and civilization appears
// shortly after — the OPPOSITE of real life." The real chain: Holocene onset
// (end of the Younger Dryas, ~9700 BCE) → farming within centuries-to-two-
// millennia → SIX THOUSAND YEARS of villages → cities/writing ~3300-3200 BCE.
// The sim's display epoch (−5250, calendar.js) was fitted to the OLD 3-seed
// solver table; in the live-dawn obs regime farming lands ~3250 BC on screen
// and cities follow ~1.3× the farming span later, vs history's 8×.)
//
// Milestones = the tech tree's own gates crossed by the world's LEADING
// knowledge (max over land-ledger records and settled courts), plus first
// city / first state. Fine cadence (250 ticks). Each is reported in steps and
// in display years under BOTH epochs: the current linear clock (−5250,
// 0.25y/tick) and the proposed YD anchor (−9700, 0.25y/tick), against the
// real date. A linear clock cannot land all milestones while the Neolithic
// is compressed — the SPAN table at the end is the physics target.
//
//   SIM_TUNE="<live arm [+ablation]>" node tools/probe_genesis.mjs [steps=22000] [W=480] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { landKnowLeadK } from "../src/sim/peopleSim/landKnow.js";

const STEPS = +(process.argv[2] || 22000);
const W = +(process.argv[3] || 480), H = W >> 1, SEED = +(process.argv[4] || 8817);
const rc = await import("../src/realClimateData.js");
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
const world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });

// milestone: [label, track, gate, real BCE date (negative year)]
const MILESTONES = [
  ["farming (agr .15)",        "agriculture",  0.15, -9000],
  ["pottery (con .18)",        "construction", 0.18, -6900],
  ["tallies/towns (org .28)",  "organization", 0.28, -3700],
  ["writing/states (org .35)", "organization", 0.35, -3200],
  ["bronze (met .35)",         "metallurgy",   0.35, -3200],
  ["sailing (nav .30)",        "navigation",   0.30, -5500],
  ["galleys (nav .58)",        "navigation",   0.58, -1500],
  ["iron (met .70)",           "metallurgy",   0.70, -1200],
];
const crossed = new Map();   // label → step
let firstCity = -1, firstState = -1;

const leadOf = (track) => {
  let v = 0;
  const lk = landKnowLeadK(world);
  if (lk && lk[track] > v) v = lk[track];
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s.knowledge) continue;
    if ((s.knowledge[track] || 0) > v) v = s.knowledge[track] || 0;
  }
  return v;
};

for (let done = 0; done < STEPS; done += 250) {
  stepPeopleSim(world, 250);
  for (const [label, track, gate] of MILESTONES) {
    if (!crossed.has(label) && leadOf(track) >= gate) crossed.set(label, world.step);
  }
  if (firstCity < 0) { for (const s of world.settlements) if (s.mode === "settled") { firstCity = world.step; break; } }
  if (firstState < 0 && world.countries && world.countries.size > 0) firstState = world.step;
}

const yr = (step, start) => { const y = Math.round(start + step * 0.25); return y < 0 ? `${-y} BC` : `${y} AD`; };
console.log(`\n=== GENESIS CHRONOLOGY  ${W}x${H} (tw=${world.tw})  seed ${SEED}  OBSERVED + arm  ${STEPS} steps ===`);
console.log(`  ${"milestone".padEnd(26)} ${"step".padStart(6)}  ${"disp(−5250)".padStart(11)}  ${"YD(−9700)".padStart(10)}  ${"real".padStart(8)}`);
for (const [label, , , real] of MILESTONES) {
  const st = crossed.get(label);
  console.log(`  ${label.padEnd(26)} ${st !== undefined ? String(st).padStart(6) : "     —"}  ${st !== undefined ? yr(st, -5250).padStart(11) : "          —"}  ${st !== undefined ? yr(st, -9700).padStart(10) : "         —"}  ${(-real + " BC").padStart(8)}`);
}
console.log(`  ${"first CITY".padEnd(26)} ${firstCity >= 0 ? String(firstCity).padStart(6) : "     —"}  ${firstCity >= 0 ? yr(firstCity, -5250).padStart(11) : "          —"}  ${firstCity >= 0 ? yr(firstCity, -9700).padStart(10) : "         —"}  ${"3200 BC".padStart(8)}`);
console.log(`  ${"first STATE".padEnd(26)} ${firstState >= 0 ? String(firstState).padStart(6) : "     —"}  ${firstState >= 0 ? yr(firstState, -5250).padStart(11) : "          —"}  ${firstState >= 0 ? yr(firstState, -9700).padStart(10) : "         —"}  ${"3100 BC".padStart(8)}`);
const f = crossed.get("farming (agr .15)"), w = crossed.get("writing/states (org .35)");
if (f !== undefined && w !== undefined) {
  console.log(`\n  SPANS  t0→farming ${f} ticks (${(f * 0.25).toFixed(0)}y)  farming→writing ${w - f} ticks (${((w - f) * 0.25).toFixed(0)}y)  — real: ~700-2000y and ~5800y (ratio ~3-8)`);
  console.log(`  sim ratio ${( (w - f) / Math.max(1, f)).toFixed(2)} — the Neolithic-stretch target is the farming→writing span reaching ~4-6x t0→farming`);
}
