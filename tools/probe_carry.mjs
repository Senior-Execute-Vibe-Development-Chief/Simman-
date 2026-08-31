// Capacity diagnosis: food, people, leftover countryside vs mint bars.
// Compares the shipped live arm to mint-stack-off (pre-v57 packing).
//   node tools/probe_carry.mjs [steps=24000] [seed=8817] [W=480]
import { buildSim, SIM_TUNE_OVERRIDES } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { applyTuning, resetTuning, T, rNormPop } from "../src/sim/peopleSim/tuning.js";
import { labelSiteLedger, cityBasinOkAt, residualBasinMass, URBAN_SHARE_REF } from "../src/sim/peopleSim/crystallize.js";
import { TIER_CORE } from "../src/sim/peopleSim/settlement.js";
import { POP_SCALE } from "../src/sim/units.js";

const STEPS = +(process.argv[2] || 24000);
const SEED = +(process.argv[3] || 8817);
const W = +(process.argv[4] || 480), H = W >> 1;
const EVERY = 4000;

const LIVE = {
  DAWN_LIVE: 1, STATE_RECORDS: 1, LAND_KNOW: 1, PEER_SEATS: 1, FOUND_DRIFT: 1,
  ABSORB_ORG_ERA: 1, WAR_FINISH: 1, SETT_STRIDE: 3, TRADE_STRIDE: 5, CORE_LOCAL: 1,
};

const ARMS = [
  ["live", LIVE],
  ["live_mint_off", { ...LIVE, MINT_RESIDUAL: 0, MINT_REACH: 0, SEED_EXCLUSIVE: 0 }],
  ["live_tilecoin_off", { ...LIVE, TILE_MONEY: 0, LAND_SURPLUS: 0, COMPEL: 0 }],
];

function q(a, f) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(f * s.length))];
}

function snap(world) {
  const pf = world.popField, cap = world.capField, elev = world.elev, to = world._territoryOwner;
  const N = world.N, scale = world._onePopScale || 0;
  let field = 0, capSum = 0, unmarketed = 0, marketed = 0, landTiles = 0, peopled = 0;
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) continue;
    landTiles++;
    field += pf[i];
    capSum += cap[i];
    if (pf[i] > 0) peopled++;
    if (to && to[i] >= 0) marketed += pf[i];
    else unmarketed += pf[i];
  }
  const settled = world.settlements.filter(s => s.mode === "settled");
  let urban = 0, rural = 0, landFood = 0, supply = 0, demand = 0, coreNeed = 0, store = 0;
  const cores = [];
  for (const s of settled) {
    urban += s._urbanPop || 0;
    rural += s._ruralPop || 0;
    landFood += s._landFood || 0;
    supply += s._foodSupply || 0;
    demand += s._foodDemand || 0;
    coreNeed += s._coreNeed || 0;
    store += s.food || 0;
    cores.push(s._urbanPop || 0);
  }
  const census = urban + rural;
  const bridge = scale > 0 ? scale : 0.002;
  const barCensus = TIER_CORE[2] / URBAN_SHARE_REF; // 200
  const leftoverCities = (unmarketed * bridge) / barCensus;
  const rn = rNormPop(world);
  const rReach = Math.max(1, Math.round(5 * rn)); // newborn TERRITORY_BASE
  const rDisk = Math.max(1, Math.round(10 * rn));
  let sites = 0, ok = 0, residualPass = 0, reachPass = 0;
  try {
    const L = labelSiteLedger(world);
    sites = L.sites.length;
    for (const st of L.sites) {
      if (cityBasinOkAt(world, st.x, st.y)) ok++;
      if (residualBasinMass(world, st.x, st.y, rDisk) * bridge >= barCensus) residualPass++;
      if (residualBasinMass(world, st.x, st.y, rReach) * bridge >= barCensus) reachPass++;
    }
  } catch { /* ledger may not exist pre-dawn */ }
  let founded = 0, dissolved = 0, abandoned = 0;
  for (const e of world.events || []) {
    if (e.type === "settlement.founded") founded++;
    else if (e.type === "settlement.dissolved") dissolved++;
    else if (e.type === "settlement.abandoned") abandoned++;
  }
  return {
    n: settled.length,
    peopleM: (census * POP_SCALE) / 1e6,
    urbanM: (urban * POP_SCALE) / 1e6,
    fieldM: (field * bridge * POP_SCALE) / 1e6,
    occ: capSum > 0 ? field / capSum : 0,
    peopledPct: landTiles ? 100 * peopled / landTiles : 0,
    leftover: leftoverCities,
    unmarketedFrac: field > 0 ? unmarketed / field : 0,
    landFood, supply, demand, coreNeed, store,
    foodCover: demand > 0 ? supply / demand : 0,
    coreCover: coreNeed > 0 ? supply / coreNeed : 0,
    urbanPct: census > 0 ? 100 * urban / census : 0,
    coreP50: q(cores, 0.5),
    sites, ok, residualPass, reachPass,
    founded, dissolved, abandoned,
    scale,
  };
}

console.log(`\n=== CARRY / MINT SLACK  W=${W} seed=${SEED} steps=${STEPS} ===`);
console.log(`  city basin bar = ${TIER_CORE[2] / URBAN_SHARE_REF} census (~${(TIER_CORE[2] / URBAN_SHARE_REF) * POP_SCALE / 1000}k people)\n`);

for (const [label, overrides] of ARMS) {
  resetTuning();
  applyTuning({ ...SIM_TUNE_OVERRIDES, ...overrides });
  console.log(`--- ${label}  MINT_RESIDUAL=${T.MINT_RESIDUAL} MINT_REACH=${T.MINT_REACH} TILE_MONEY=${T.TILE_MONEY} LAND_SURPLUS=${T.LAND_SURPLUS} ---`);
  const world = buildSim({ W, H, seed: SEED });
  for (let s = 1; s <= STEPS; s++) {
    stepPeopleSim(world, 1);
    if (s % EVERY === 0 || s === STEPS) {
      const x = snap(world);
      console.log(
        `  @${String(s).padStart(5)}  n=${String(x.n).padStart(3)}  people=${x.peopleM.toFixed(1)}M  field=${x.fieldM.toFixed(1)}M` +
        `  occ=${(100 * x.occ).toFixed(1)}%  peopledLand=${x.peopledPct.toFixed(1)}%  urban=${x.urbanPct.toFixed(1)}%` +
        `  leftoverCities=${x.leftover.toFixed(1)}  unmkt=${(100 * x.unmarketedFrac).toFixed(0)}%` +
        `  foodCover=${x.foodCover.toFixed(2)}  coreCover=${x.coreCover.toFixed(2)}  store=${x.store.toFixed(0)}` +
        `  sites ok/resid/reach/all=${x.ok}/${x.residualPass}/${x.reachPass}/${x.sites}` +
        `  found/diss/ab=${x.founded}/${x.dissolved}/${x.abandoned}  coreP50=${x.coreP50.toFixed(1)}  bridge=${x.scale.toExponential(2)}`
      );
    }
  }
  console.log("");
}
