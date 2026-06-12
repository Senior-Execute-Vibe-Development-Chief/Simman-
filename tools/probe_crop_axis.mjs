// Verify the crop-package axis wiring (T.CROP_AXIS). Runs the earth sim with the
// toggle OFF then ON to the same step, and reports settlements / population /
// crop ownership so we can see (a) OFF is unchanged and (b) ON spreads crops
// from the cradles by climate band.  node tools/probe_crop_axis.mjs [step] [seed]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { cropSuitability } from "../src/sim/cropGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { applyTuning, resetTuning } from "../src/sim/peopleSim/tuning.js";
import { pkgSuitAt } from "../src/sim/peopleSim/agriculture.js";
import { CROP_PACKAGES, CROP_BY_ID } from "../src/sim/cropPackages.js";

// The crop that actually SETS a settlement's ceiling = best suit×storability at
// its tile among the crops it owns (what cropCeil uses). Cleaner than crops[0].
function ceilingCrop(world, s) {
  if (!s.crops || !s.crops.length) return null;
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  let best = null, bestV = 0;
  for (const id of s.crops) { const pkg = CROP_BY_ID[id]; if (!pkg) continue; const v = pkgSuitAt(world, ti, pkg) * pkg.storability; if (v > bestV) { bestV = v; best = id; } }
  return best;
}

const STEP = +(process.argv[2] || "8000");
const SEED = +(process.argv[3] || "8817");
const W = 480, H = 240;

function build() {
  const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
  const TW = W, TH = H, N = TW * TH;
  const tElev = new Float32Array(N), tTemp = new Float32Array(N), tMoist = new Float32Array(N), tCoast = new Uint8Array(N), tCrop = new Float32Array(N);
  for (let i = 0; i < N; i++) { tElev[i] = w.elevation[i]; tTemp[i] = w.temperature[i]; tMoist[i] = w.moisture[i]; tCoast[i] = w.coastal[i] || 0; }
  const rivers = computeRivers(TW, TH, tElev, tMoist, tTemp); w.rivers = rivers;
  const rmag = rivers && rivers.riverMag ? rivers.riverMag : null;
  for (let i = 0; i < N; i++) tCrop[i] = cropSuitability(tTemp[i], tMoist[i], tElev[i], tCoast[i], rmag ? rmag[i] : 0);
  const deposits = generateResources(TW, TH, tElev, tTemp, tMoist, tCoast, w, SEED, rivers); w.deposits = deposits;
  return initPeopleSim(w, { seed: SEED, tCrop, tileRes: 1, deposits });
}

function run(label, cropAxis) {
  resetTuning(); applyTuning({ CROP_AXIS: cropAxis });
  const world = build();
  // cradles seeded with crops?
  const cradles = world.settlements.filter(s => /cradle/.test(s.name));
  for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);
  const st = peopleSimStats(world);
  // crop ownership + forager share + dominant crop by latitude band
  const own = {}; for (const c of CROP_PACKAGES) own[c.id] = 0;
  let foragers = 0, farmers = 0, gateSum = 0, gateN = 0;
  const bands = ["polar(>60)", "temperate(35-60)", "subtrop(20-35)", "tropic(<20)"];
  const bandCrop = bands.map(() => ({}));
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const lat = Math.abs((s.pos.y / world.th) * 2 - 1) * 90;
    const bi = lat > 60 ? 0 : lat > 35 ? 1 : lat > 20 ? 2 : 3;
    if (s.crops && s.crops.length) { farmers++; for (const id of s.crops) own[id]++; const dom = ceilingCrop(world, s); if (dom) bandCrop[bi][dom] = (bandCrop[bi][dom] || 0) + 1; }
    else foragers++;
    if (s._agriGate != null) { gateSum += s._agriGate; gateN++; }
  }
  console.log(`\n══ ${label} (CROP_AXIS=${cropAxis}) @ step ${STEP} ══`);
  console.log(`settlements ${st.settlements}  pop ${st.totalPeople}  countries ${st.countries}  (villages ${st.villages} towns ${st.towns} cities ${st.cities} metro ${st.metropolises})`);
  console.log(`cradles seeded: ${cradles.map(c => `${c.name}[${(c.crops||[]).join(',')||'—'}]`).join('  ')}`);
  if (cropAxis > 0) {
    console.log(`farmers ${farmers}  foragers(no suitable crop) ${foragers}  mean agriGate ${(gateSum/Math.max(1,gateN)).toFixed(3)}`);
    console.log(`crop ownership (settlements holding each): ${CROP_PACKAGES.map(c => `${c.id} ${own[c.id]}`).join('  ')}`);
    console.log(`dominant crop by latitude band:`);
    bands.forEach((b, i) => { const e = Object.entries(bandCrop[i]).sort((a, c) => c[1] - a[1]); console.log(`   ${b.padEnd(18)} ${e.map(([k, v]) => `${k}:${v}`).join('  ') || '—'}`); });
  }
  return st;
}

console.log(`[probe] earth_sim ${W}x${H} seed=${SEED} → step ${STEP}`);
const off = run("OFF (current model)", 0);
const on = run("ON (crop-package axis)", 1);
console.log(`\n══ delta ══  pop ${on.totalPeople - off.totalPeople >= 0 ? "+" : ""}${on.totalPeople - off.totalPeople}  settlements ${on.settlements - off.settlements >= 0 ? "+" : ""}${on.settlements - off.settlements}  (ON vs OFF)`);
