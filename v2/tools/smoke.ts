import assert from "node:assert/strict";
import { checkDmathGoldens } from "./lib/dmath-check";
import { collect } from "./lib/collect";
import { printProvenance, provenance, type Provenance } from "./lib/provenance";
import { M0_DEFAULT_SEED, M0_DETERMINISM_TICKS } from "../src/sim/constants";
import { loadWorld, serializeWorld } from "../src/sim/persist";
import { runRoutingBatteries } from "../src/sim/travel/battery";
import { hashWorld, runSteps, type GridPreset, World } from "../src/sim/world";
import { ensurePeopleWasm } from "../src/sim/peopleKernel";

const SEED = M0_DEFAULT_SEED;
const TICKS = M0_DETERMINISM_TICKS;
const SAVE_TICKS = 250;
const CONTINUE_TICKS = 100;

interface GridSmokeResult {
  readonly grid: GridPreset;
  readonly hash: string;
  readonly metrics: Record<string, number>;
  readonly provenance: Provenance;
}

function deterministicRun(grid: GridPreset): { hash: string; world: World } {
  const first = new World({ seed: SEED, grid });
  const second = new World({ seed: SEED, grid });
  printProvenance(first);
  runSteps(first, TICKS);
  runSteps(second, TICKS);
  assert.equal(hashWorld(first), hashWorld(second), `determinism failed on ${grid}`);
  return { hash: hashWorld(first), world: first };
}

function saveLoadRun(grid: GridPreset): void {
  const uninterrupted = new World({ seed: SEED, grid });
  runSteps(uninterrupted, SAVE_TICKS);
  const snapshot = serializeWorld(uninterrupted);
  const resumed = loadWorld(snapshot);
  assert.equal(hashWorld(resumed), hashWorld(uninterrupted), `save hash failed on ${grid}`);
  assert.equal(serializeWorld(resumed), snapshot, `save byte identity failed on ${grid}`);
  runSteps(uninterrupted, CONTINUE_TICKS);
  runSteps(resumed, CONTINUE_TICKS);
  assert.equal(hashWorld(resumed), hashWorld(uninterrupted), `continuation failed on ${grid}`);
}

async function main(): Promise<void> {
  if (!await ensurePeopleWasm()) throw new Error("People WASM failed to initialize.");
  const dmathGoldens = checkDmathGoldens();
  const routing = await runRoutingBatteries();
  assert.ok(routing.every((result) => result.queries >= 72), "routing battery is incomplete");

  const results: GridSmokeResult[] = [];
  for (const grid of ["dev", "target"] as const) {
    const deterministic = deterministicRun(grid);
    saveLoadRun(grid);
    const metrics = collect(deterministic.world);
    assert.equal(metrics["field.people.n"], deterministic.world.N, `collector missed ${grid} people field`);
    assert.equal(metrics["field.technique.n"], deterministic.world.N, `collector missed ${grid} technique field`);
    assert.equal(metrics["world.step"], TICKS, `collector missed ${grid} step`);
    results.push({
      grid,
      hash: deterministic.hash,
      metrics,
      provenance: provenance(deterministic.world),
    });
  }
  console.log(JSON.stringify({
    smoke: "ok",
    dmathGoldens: dmathGoldens.length,
    routing,
    grids: results.map(({ grid, hash, provenance: stamp }) => ({ grid, hash, provenance: stamp })),
  }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
