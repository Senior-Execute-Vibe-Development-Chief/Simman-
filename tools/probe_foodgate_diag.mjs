// URBAN_FOOD_GATE diagnosis — gate ON vs OFF + swing-year control.
//   node tools/probe_foodgate_diag.mjs [steps=24000] [seed=8817] [W=480]
import { buildSim, SIM_TUNE_OVERRIDES } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { applyTuning, resetTuning, T } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 24000);
const SEED = +(process.argv[3] || 8817);
const W = +(process.argv[4] || 480), H = W >> 1;
const EVERY = 4000;

const ARMS = [
  ["gate_ON", {}],
  ["gate_OFF", { URBAN_FOOD_GATE: 0 }],
  ["no_harvest", { HARVEST_YEARS: 0 }],
  ["gate_OFF_no_harvest", { URBAN_FOOD_GATE: 0, HARVEST_YEARS: 0 }],
];

function q(a, f) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(f * s.length))];
}

function basinMass(world, s) {
  const rn = Math.sqrt(world.tw * world.th / (480 * 240));
  const rB = Math.round(10 * rn);
  let sum = 0;
  const pf = world.popField, tw = world.tw, th = world.th;
  const tx = s.pos.x | 0, ty = s.pos.y | 0;
  for (let dy = -rB; dy <= rB; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= th) continue;
    for (let dx = -rB; dx <= rB; dx++) {
      if (dx * dx + dy * dy > rB * rB) continue;
      sum += pf[yy * tw + (((tx + dx) % tw) + tw) % tw];
    }
  }
  return sum;
}

function checkpoint(world, label, step) {
  const settled = world.settlements.filter(s => s.mode === "settled");
  let urban = 0, rural = 0, fedSum = 0, lean = 0, flowDef = 0, storeRich = 0;
  let thinBasin = 0;
  const bar = world._onePopScale > 0 ? (10 / 0.05) * 0.6 / world._onePopScale : 0;
  for (const s of settled) {
    urban += s._urbanPop || 0;
    rural += s._ruralPop || 0;
    fedSum += s._fedM ?? 1;
    if (s._harvestYearMul !== undefined && s._harvestYearMul < 0.85) lean++;
    const need = s._coreNeed || 0;
    const flow = s._foodSupply || 0;
    const store = s.food || 0;
    if (flow + store < need) flowDef++;
    if (store > need * 8 && need > 0) storeRich++;
    if (bar > 0 && basinMass(world, s) < bar) thinBasin++;
  }
  const ev = { w: 0, a: 0, d: 0, lap: 0, dissBasin: 0, dissCore: 0, fam: 0 };
  for (const e of world.events || []) {
    if (e.step > step) continue;
    if (e.type === "settlement.withered") ev.w++;
    else if (e.type === "settlement.abandoned") ev.a++;
    else if (e.type === "settlement.lapsed") ev.lap++;
    else if (e.type === "settlement.dissolved") { ev.d++; if (e.why === "basin") ev.dissBasin++; else if (e.why === "core") ev.dissCore++; }
    else if (e.type === "famine.struck") ev.fam++;
  }
  const n = settled.length;
  console.log(
    `  @${String(step).padStart(5)}  n=${String(n).padStart(3)}  urban=${(100 * urban / Math.max(1, urban + rural)).toFixed(1).padStart(5)}%` +
    `  fedM_p50=${q(settled.map(s => s._fedM ?? 1), 0.5).toFixed(2)}  lean=${lean}  flowShort=${flowDef}  storeRich=${storeRich}  thinBasin=${thinBasin}` +
    `  deaths w/a/l/d=${ev.w}/${ev.a}/${ev.lap}/${ev.d}(b${ev.dissBasin}/c${ev.dissCore})  fam=${ev.fam}`
  );
}

console.log(`\n=== URBAN_FOOD_GATE DIAGNOSIS  W=${W} seed=${SEED} steps=${STEPS} ===`);
console.log(`  SAVE_VERSION physics; harness DAWN_LIVE=0\n`);

for (const [label, overrides] of ARMS) {
  resetTuning();
  applyTuning({ ...SIM_TUNE_OVERRIDES, ...overrides });
  console.log(`--- ${label}  (URBAN_FOOD_GATE=${T.URBAN_FOOD_GATE}, HARVEST_YEARS=${T.HARVEST_YEARS}) ---`);
  const world = buildSim({ W, H, seed: SEED });
  for (let s = 1; s <= STEPS; s++) {
    stepPeopleSim(world, 1);
    if (s % EVERY === 0 || s === STEPS) checkpoint(world, label, s);
  }
  console.log("");
}
