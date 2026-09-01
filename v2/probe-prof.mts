/* SCRATCH PROBE — delete before commit. */
import { buildSubstrate } from "./src/sim/substrate";
import { World } from "./src/sim/world";
import { asPeopleWorld } from "./src/sim/people";
import { deriveCapacity } from "./src/sim/people/capacity";
import { grow } from "./src/sim/people/growth";
import { migrate } from "./src/sim/people/migration";
import { stepTechnique } from "./src/sim/people/technique";
const substrate = buildSubstrate(42042, { preset: "earth_sim" }, "target");
const world = asPeopleWorld(new World({ seed: 42042, grid: "target", config: { preset: "earth_sim" }, substrate }));
const phases: Record<string, number> = { technique: 0, capacity: 0, grow: 0, migrate: 0, ledger: 0 };
for (let tick = 0; tick < 5; tick++) {
  let t = performance.now();
  world.ledger.beginPass("people", world.people, "births", "deaths", world.cellAreaKm2);
  phases.ledger += performance.now() - t;
  t = performance.now(); stepTechnique(world); phases.technique += performance.now() - t;
  t = performance.now(); deriveCapacity(world); phases.capacity += performance.now() - t;
  t = performance.now(); const g = grow(world); phases.grow += performance.now() - t;
  t = performance.now(); const m = migrate(world, tick % 12); phases.migrate += performance.now() - t;
  world.people.set(world._peopleNext);
  world.ledger.recordChannel("people", "migration", m, m);
  world.ledger.endPass("people", world.people, g.births, g.deaths);
}
for (const [k, v] of Object.entries(phases)) console.log(k, (v / 5).toFixed(1), "ms/tick");
