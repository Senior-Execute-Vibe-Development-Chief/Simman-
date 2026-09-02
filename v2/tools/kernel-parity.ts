import assert from "node:assert/strict";
import { buildSubstrate } from "../src/sim/substrate";
import { DMATH_GOLDENS } from "../src/sim/dmath-goldens";
import { ensurePeopleWasm, wasmDpowValue } from "../src/sim/peopleKernel";
import type { PeopleWorld } from "../src/sim/people/types";
import { hashWorld, runSteps, type GridPreset, World } from "../src/sim/world";
import { float64Bits } from "./lib/dmath-check";

const PEOPLE_FIELDS = [
  "people",
  "technique",
  "children",
  "working",
  "elders",
] as const;

const PEOPLE_SCRATCH = [
  "_peopleNext",
  "_techniqueNext",
  "_childrenMass",
  "_workingMass",
  "_eldersMass",
  "_childrenNext",
  "_workingNext",
  "_eldersNext",
  "_migrationOut",
  "_migrationWeight",
  "_migrationPopulation",
] as const;

function bytes(value: unknown): Buffer {
  if (!(value instanceof Float64Array)) throw new Error("Parity value is not a Float64Array.");
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function comparePeopleState(reference: World, candidate: World, grid: GridPreset, step: number): void {
  for (const name of [...PEOPLE_FIELDS, ...PEOPLE_SCRATCH]) {
    const left = (reference as unknown as Record<string, unknown>)[name];
    const right = (candidate as unknown as Record<string, unknown>)[name];
    assert.ok(left instanceof Float64Array, `${grid} TS ${name} missing at ${step}`);
    assert.ok(right instanceof Float64Array, `${grid} WASM ${name} missing at ${step}`);
    assert.deepEqual(bytes(right), bytes(left), `${grid} ${name} diverged at tick ${step}`);
  }
  assert.equal(hashWorld(candidate), hashWorld(reference), `${grid} hash diverged at tick ${step}`);
}

function runParity(grid: GridPreset, steps: number): void {
  const substrate = buildSubstrate(42042, { preset: "earth_sim" }, grid);
  const reference = new World({
    seed: 42042,
    grid,
    config: { preset: "earth_sim", peopleKernel: "ts" },
    substrate,
  });
  const wasm = new World({
    seed: 42042,
    grid,
    config: { preset: "earth_sim", peopleKernel: "wasm", peopleWorkers: 1 },
    substrate,
  });
  assert.ok((wasm as PeopleWorld)._wasmPeopleKernel, `${grid} did not select the WASM kernel`);
  comparePeopleState(reference, wasm, grid, 0);
  for (let step = 1; step <= steps; step++) {
    runSteps(reference, 1);
    runSteps(wasm, 1);
    comparePeopleState(reference, wasm, grid, step);
  }
  (wasm as PeopleWorld)._wasmPeopleKernel?.dispose();

  const hashes: Record<number, string> = {};
  for (const workerCount of [1, 2, 8]) {
    const workerWorld = new World({
      seed: 42042,
      grid,
      config: { preset: "earth_sim", peopleKernel: "wasm", peopleWorkers: workerCount },
      substrate,
    });
    assert.equal((workerWorld as PeopleWorld)._wasmPeopleKernel?.workerCount, workerCount);
    runSteps(workerWorld, steps);
    hashes[workerCount] = hashWorld(workerWorld);
    (workerWorld as PeopleWorld)._wasmPeopleKernel?.dispose();
  }
  assert.equal(hashes[2], hashes[1], `${grid} 2-worker hash changed`);
  assert.equal(hashes[8], hashes[1], `${grid} 8-worker hash changed`);
}

function checkWasmDmath(): number {
  const dpowGoldens = DMATH_GOLDENS.filter((golden) => golden.name === "dpow");
  for (const golden of dpowGoldens) {
    assert.equal(
      float64Bits(wasmDpowValue(golden.args[0] ?? 0, golden.args[1] ?? 0)),
      golden.bits,
      `WASM dmath mismatch for ${golden.name}(${golden.args.join(",")})`,
    );
  }
  return dpowGoldens.length;
}

async function main(): Promise<void> {
  if (!await ensurePeopleWasm()) {
    throw new Error("People kernel parity requires a built WASM module.");
  }
  const dmathGoldens = checkWasmDmath();
  runParity("dev", 240);
  runParity("target", 24);
  console.log(JSON.stringify({
    parity: "ok",
    grids: { dev: 240, target: 24 },
    workerCounts: [1, 2, 8],
    wasmDmathGoldens: dmathGoldens,
  }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

