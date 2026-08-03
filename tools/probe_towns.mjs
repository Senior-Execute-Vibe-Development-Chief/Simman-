// ARE THE EARLY "TOWNS" TOWNS? — the wilderness-town complaint, measured.
//
// Owner, looking at the running sim: "there is still dozens of 'towns' spawning
// very early game in wilderness, with no nation attached."
//
// The label comes from updateTier, whose bars are PERCENTILES OF `s.people` with
// absolute floors (60 town / 240 city). But under T.ONE_POP `s.people` is the
// settlement's CATCHMENT census — the urban core PLUS the countryside it works
// (popField.js deriveOnePop; see src/sim/units.js). The city itself is
// `s._urbanPop`. So the tier ladder may be ranking settlements by how peopled
// their COUNTRYSIDE is, and calling a hamlet in a fertile basin a "town".
//
// This probe puts the two side by side at the steps the complaint is about:
//
//   • for every settlement: tier, catchment census, urban core, rural belt
//   • the urban SHARE — _urbanPop / people. If the early "towns" have a core
//     that is a few percent of their census, they are villages wearing a town
//     label and the ladder is measuring the wrong quantity.
//   • split by wilderness (countryId < 0) vs in a realm, since the complaint is
//     specifically about the nationless ones
//   • what a core-based ladder would say instead, at the same floors
//
//   node tools/probe_towns.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { POP_SCALE } from "../src/sim/units.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "6000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);
const TIER_NAME = ["farming region", "town", "city", "metropolis"];

const world = buildSim({ W, H: W / 2, seed: SEED });

const q = (arr, f) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(f * a.length))];
};
const ppl = (census) => {
  const p = census * POP_SCALE;
  return p >= 1e6 ? (p / 1e6).toFixed(2) + "M" : p >= 1e3 ? (p / 1e3).toFixed(0) + "k" : p.toFixed(0);
};

function report() {
  const setts = world.settlements.filter((s) => s.mode === "settled");
  const byTier = [[], [], [], []];
  for (const s of setts) byTier[Math.max(0, Math.min(3, s.tier | 0))].push(s);
  const wild = setts.filter((s) => s.countryId < 0);
  const held = setts.filter((s) => s.countryId >= 0);

  console.log(`\n=== step ${world.step}   settlements ${setts.length}   realms ${world.countries ? world.countries.size : 0} ===`);
  console.log(`  tiers: ` + byTier.map((a, t) => `${TIER_NAME[t]}=${a.length}`).join("  ") +
    `   |  nationless ${wild.length} (${((100 * wild.length) / Math.max(1, setts.length)).toFixed(0)}%)`);

  const line = (label, arr) => {
    if (!arr.length) { console.log(`  ${label.padEnd(22)} (none)`); return; }
    const cen = arr.map((s) => s.people || 0);
    const urb = arr.map((s) => s._urbanPop || 0);
    const shr = arr.map((s) => (s.people > 0 ? (s._urbanPop || 0) / s.people : 0));
    console.log(`  ${label.padEnd(22)} n=${String(arr.length).padEnd(4)}` +
      ` catchment p50 ${ppl(q(cen, 0.5)).padStart(6)}` +
      `  URBAN CORE p50 ${ppl(q(urb, 0.5)).padStart(6)} (p90 ${ppl(q(urb, 0.9))})` +
      `  core share p50 ${(100 * q(shr, 0.5)).toFixed(1)}%`);
  };
  line("all settled", setts);
  line("nationless", wild);
  line("in a realm", held);
  for (let t = 1; t <= 3; t++) if (byTier[t].length) line(`labelled ${TIER_NAME[t]}`, byTier[t]);

  // What would a ladder read off the URBAN CORE say, at the same floors the
  // census ladder uses (60 town / 240 city, or the P50/P85 percentile if higher)?
  const cores = setts.map((s) => s._urbanPop || 0).sort((a, b) => a - b);
  const pAt = (f) => (cores.length ? cores[Math.min(cores.length - 1, Math.floor(f * cores.length))] : 0);
  const townBar = Math.max(60, pAt(0.5)), cityBar = Math.max(240, pAt(0.85));
  let wouldTown = 0, wouldCity = 0;
  for (const s of setts) {
    const u = s._urbanPop || 0;
    if (u >= cityBar) wouldCity++; else if (u >= townBar) wouldTown++;
  }
  console.log(`  if the ladder read the CORE instead of the catchment (same floors 60/240):` +
    `  towns ${wouldTown}  cities ${wouldCity}  below-town ${setts.length - wouldTown - wouldCity}`);
}

console.log(`# probe_towns  W=${W} seed=${SEED}  ONE_POP=${T.ONE_POP} DISSOLVE_FARMS=${T.DISSOLVE_FARMS} URBAN_AGGLOM=${T.URBAN_AGGLOM}`);
console.log(`# tier bars read s.people (the CATCHMENT census); s._urbanPop is the city itself`);
const CHECKS = [500, 1000, 2000, 4000, 6000, 12000].filter((c) => c <= STEPS);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (CHECKS.includes(world.step)) report();
}
