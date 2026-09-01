/* SCRATCH PROBE — delete before commit. */
import { buildSubstrate } from "./src/sim/substrate";
import { hashWorld, runSteps, World } from "./src/sim/world";
const substrate = buildSubstrate(42042, { preset: "earth_sim" }, "dev");
const world = new World({ seed: 42042, grid: "dev", config: { preset: "earth_sim" }, substrate });
const t0 = performance.now();
runSteps(world, 120);
const ms = (performance.now() - t0) / 120;
console.log("dev hash after 120 ticks:", hashWorld(world), "ms/tick:", ms.toFixed(2));
const substrateT = buildSubstrate(42042, { preset: "earth_sim" }, "target");
const worldT = new World({ seed: 42042, grid: "target", config: { preset: "earth_sim" }, substrate: substrateT });
const t1 = performance.now();
runSteps(worldT, 10);
console.log("target hash after 10 ticks:", hashWorld(worldT), "ms/tick:", ((performance.now() - t1) / 10).toFixed(1));
