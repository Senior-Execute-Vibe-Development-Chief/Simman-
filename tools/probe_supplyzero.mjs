// Detect supply/tick → 0 while local harvest still flows.
//   node tools/probe_supplyzero.mjs [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "./../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 12000);
const SEED = +(process.argv[3] || 8817);

const world = buildSim({ W: 480, H: 240, seed: SEED });
const stats = {
  zeroSupplyLand: 0,
  zeroSupplyLandBug: 0,
  zeroSupplyNet: 0,
  zeroSupplyNetNotBesieged: 0,
  cliffDrop: 0,
  urbanHalvedOnZeroSupply: 0,
};
const examples = [];
const prev = new Map();
const prevUrb = new Map();

for (let t = 0; t < STEPS; t++) {
  stepPeopleSim(world, 1);
  const terrTick = world.step === 1 || world.step % T.TERRITORY_INTERVAL === 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const supply = s._foodSupply || 0;
    const land = s._landFood || 0;
    const net = s._foodNet;
    const ps = prev.get(s.id) || 0;

    if (supply <= 1e-6 && land > 0.2) {
      stats.zeroSupplyLand++;
      if (!s._besiegedNow && (net === undefined || (net || 0) <= 1e-6)) stats.zeroSupplyLandBug++;
      if (examples.length < 12 && !s._besiegedNow && net !== undefined && (net || 0) <= 1e-6) {
        examples.push({
          step: world.step, id: s.id, land: +land.toFixed(3), net: net == null ? null : +net.toFixed(3),
          demand: +(s._foodDemand || 0).toFixed(3), terr: +(s._terrFertSum || 0).toFixed(2),
          terrTick, tier: s.tier, besieged: !!s._besiegedNow,
        });
      }
    }
    if (supply <= 1e-6 && (net || 0) > 0.1) stats.zeroSupplyNet++;
    if (supply <= 1e-6 && (net || 0) > 0.1 && !s._besiegedNow) {
      stats.zeroSupplyNetNotBesieged++;
      if (examples.length < 12) {
        examples.push({
          kind: "net>0 supply=0", step: world.step, id: s.id,
          land: +land.toFixed(3), net: +net.toFixed(3), supply, besieged: !!s._besiegedNow,
          besiegedAt: s._besiegedAt,
        });
      }
    }
    if (ps > 1 && supply <= 1e-6) stats.cliffDrop++;
    const urb = s._urbanPop || 0;
    const pu = prevUrb.get(s.id) || 0;
    if (pu > 20 && urb < pu * 0.5 && supply <= 1e-6) {
      stats.urbanHalvedOnZeroSupply++;
      if (examples.length < 12) {
        examples.push({
          kind: "urban-halved", step: world.step, id: s.id,
          urb: +urb.toFixed(1), was: +pu.toFixed(1), land: +land.toFixed(3),
          supply, k: +(s._k || 0).toFixed(1), besieged: !!s._besiegedNow,
        });
      }
    }
    prev.set(s.id, supply);
    prevUrb.set(s.id, urb);
  }
}

console.log(`seed=${SEED} steps=${STEPS} settlements~${world.settlements.length}`);
console.log("stats", stats);
console.log("examples", examples);
