import assert from "node:assert/strict";
import { checkDmathGoldens } from "./lib/dmath-check";
import { collect } from "./lib/collect";
import { printProvenance, provenance, type Provenance } from "./lib/provenance";
import { M0_DEFAULT_SEED, M0_DETERMINISM_TICKS } from "../src/sim/constants";
import { loadWorld, serializeWorld } from "../src/sim/persist";
import { runRoutingBatteries } from "../src/sim/travel/battery";
import { hashWorld, runSteps, stepWorld, type GridPreset, World } from "../src/sim/world";
import { ensurePeopleWasm } from "../src/sim/peopleKernel";
import { buildSubstrate } from "../src/sim/substrate";
import { stepFromYear } from "../src/sim/horizon";
import { HORIZON_END_YEAR } from "../src/sim/constants";
import type { PeopleWorld } from "../src/sim/people/types";

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

/**
 * The solve regime (W5) at dev: two worlds solve to the wake and hash
 * identically; a save taken while solving and one taken after the wake
 * both reload byte-identically and continue identically; the ledger
 * asserts every solve step as it does every tick.
 */
function solveRegimeRun(): Record<string, unknown> {
  const substrate = buildSubstrate(SEED, { preset: "earth_sim" }, "dev");
  const config = { preset: "earth_sim", peopleKernel: "wasm", peopleWorkers: 1 };
  const first = new World({ seed: SEED, grid: "dev", config, substrate });
  const second = new World({ seed: SEED, grid: "dev", config, substrate });
  assert.equal(first.phase, "solve");
  const horizon = stepFromYear(HORIZON_END_YEAR);
  const solvingSave = (() => {
    runSteps(first, 4);
    runSteps(second, 4);
    return serializeWorld(first);
  })();
  const solvingLoaded = loadWorld(solvingSave, substrate);
  assert.equal(solvingLoaded.phase, "solve");
  assert.equal(serializeWorld(solvingLoaded), solvingSave, "a solve-phase save is not byte-identical");
  while (first.phase === "solve" && first.step < horizon) stepWorld(first);
  while (second.phase === "solve" && second.step < horizon) stepWorld(second);
  while (solvingLoaded.phase === "solve" && solvingLoaded.step < horizon) stepWorld(solvingLoaded);
  assert.equal(hashWorld(first), hashWorld(second), "solve regime determinism failed");
  assert.equal(hashWorld(solvingLoaded), hashWorld(first), "a loaded solve-phase world diverged");
  assert.equal(first.phase, "awake", "the dev world did not wake inside the horizon");
  const awakeSave = serializeWorld(first);
  const awakeLoaded = loadWorld(awakeSave, substrate);
  assert.equal(awakeLoaded.phase, "awake");
  assert.equal(serializeWorld(awakeLoaded), awakeSave, "an awake save is not byte-identical");
  runSteps(first, CONTINUE_TICKS);
  runSteps(awakeLoaded, CONTINUE_TICKS);
  assert.equal(hashWorld(awakeLoaded), hashWorld(first), "continuation across the wake diverged");
  const result = {
    wakeStep: first.wakeStep,
    cagedStep: first.cagedStep,
    solveStride: first.solveStride,
    solveSteps: first.wakeStep / first.solveStride,
    hash: hashWorld(first),
  };
  for (const target of [first, second, solvingLoaded, awakeLoaded]) (target as PeopleWorld)._wasmPeopleKernel?.dispose();
  return result;
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
  const solve = solveRegimeRun();
  console.log(JSON.stringify({
    smoke: "ok",
    dmathGoldens: dmathGoldens.length,
    routing,
    solve,
    grids: results.map(({ grid, hash, provenance: stamp }) => ({ grid, hash, provenance: stamp })),
  }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
