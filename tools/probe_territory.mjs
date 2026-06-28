// Does country territory EXPAND over time? Track claimed land %, largest empire,
// and the leading settlement's economic catchment + organisation across the run.
//   node tools/probe_territory.mjs [steps] [seed] [W] [H]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10), H = parseInt(process.argv[5] || "240", 10);
const world = buildSim({ W, H, seed: SEED });

function orgMax() {
  let m = 0, terr = 0;
  for (const s of world.settlements) { if (s.mode !== "settled") continue; const o = (s.knowledge && s.knowledge.organization) || 0; if (o > m) m = o; terr = Math.max(terr, s._terrTiles || 0); }
  return { m, terr };
}
// claimed tiles & largest empire in an owner array (target = _countryOwner,
// rendered = _countryClaim — what the app actually draws)
function tally(arr) {
  if (!arr) return { claimed: 0, largest: 0 };
  const cnt = new Map(); let claimed = 0;
  for (let i = 0; i < arr.length; i++) { const c = arr[i]; if (c < 0) continue; claimed++; cnt.set(c, (cnt.get(c) || 0) + 1); }
  let largest = 0; for (const v of cnt.values()) if (v > largest) largest = v;
  return { claimed, largest };
}
console.log('step    setts countries  TARGET(owner)        RENDERED(claim)      maxOrg maxTerr');
console.log('                          claimed% largest     claimed% largest');
const landN = (() => { let n = 0; for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) n++; return n; })();
for (let i = 1; i <= STEPS; i++) {
  stepPeopleSim(world, 1);
  if (i % 1500 === 0 || i === 200) {
    const st = peopleSimStats(world);
    const { m, terr } = orgMax();
    const tgt = tally(world._countryOwner), rnd = tally(world._countryClaim);
    console.log(`${String(i).padStart(6)}  ${String(st.settlements).padStart(4)}   ${String(st.countries).padStart(4)}     ${(100*tgt.claimed/landN).toFixed(2).padStart(6)}% ${String(tgt.largest).padStart(6)}      ${(100*rnd.claimed/landN).toFixed(2).padStart(6)}% ${String(rnd.largest).padStart(6)}   ${m.toFixed(3)} ${String(terr).padStart(5)}`);
  }
}
