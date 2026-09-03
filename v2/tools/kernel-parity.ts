import assert from "node:assert/strict";
import { buildSubstrate } from "../src/sim/substrate";
import { DMATH_GOLDENS } from "../src/sim/dmath-goldens";
import { ensurePeopleWasm, resizePeoplePool, wasmDpowValue } from "../src/sim/peopleKernel";
import type { PeopleWorld } from "../src/sim/people/types";
import { hashWorld, runSteps, type GridPreset, World } from "../src/sim/world";
import { float64Bits } from "./lib/dmath-check";
import { CROP_PACKAGES } from "../src/ported/worldgen/cropPackages.js";

const PEOPLE_FIELDS = [
  "people",
  "technique",
  "children",
  "working",
  "elders",
  "capField",
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
  "_migrationReceived",
  "_farmerTotal",
  "_farmerTotalNext",
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
    if (name.startsWith("_")) {
      assert.equal(
        right.length,
        (candidate as PeopleWorld)._landCells.length,
        `${grid} WASM ${name} was not land-packed at ${step}`,
      );
      assert.equal(
        left.length,
        (reference as PeopleWorld)._landCells.length,
        `${grid} TS ${name} was not land-packed at ${step}`,
      );
    } else {
      assert.equal(left.length, (reference as PeopleWorld).N, `${grid} TS ${name} lost full-grid view`);
      assert.equal(right.length, (candidate as PeopleWorld).N, `${grid} WASM ${name} lost full-grid view`);
    }
    assert.deepEqual(bytes(right), bytes(left), `${grid} ${name} diverged at tick ${step}`);
  }
  for (const pkg of CROP_PACKAGES) {
    for (const name of ["farmers", "_farmersNext"] as const) {
      const left = (reference as PeopleWorld)[name === "farmers" ? "farmers" : "_farmersNext"][pkg.id];
      const right = (candidate as PeopleWorld)[name === "farmers" ? "farmers" : "_farmersNext"][pkg.id];
      assert.ok(left instanceof Float64Array, `${grid} TS ${name}.${pkg.id} missing at ${step}`);
      assert.ok(right instanceof Float64Array, `${grid} WASM ${name}.${pkg.id} missing at ${step}`);
      assert.deepEqual(bytes(right), bytes(left), `${grid} ${name}.${pkg.id} diverged at tick ${step}`);
    }
  }
  assert.deepEqual(
    Buffer.from((candidate as PeopleWorld)._peopledMask),
    Buffer.from((reference as PeopleWorld)._peopledMask),
    `${grid} peopled mask diverged at tick ${step}`,
  );
  // Every field is compared byte for byte above; the world hash (config,
  // schedule, hearths, accrual) is compared once per pair at the end.
}

// Every native range ignites on the first conversion pass, so the farmer
// arrays, the mobility split and the pair spare are exercised from tick 1.
// Without this the harness's horizon ends centuries before the first hearth
// and the farmer paths of both kernels go uncompared (review, M3a).
const PRIMED_HEARTH_YEARS = 1e6;

function makeWorld(
  grid: GridPreset,
  substrate: ReturnType<typeof buildSubstrate>,
  config: Record<string, string | number | boolean>,
): World {
  const world = new World({ seed: 42042, grid, config: { preset: "earth_sim", ...config }, substrate });
  for (const years of (world as PeopleWorld)._hearthYears) years.fill(PRIMED_HEARTH_YEARS);
  return world;
}

async function runParity(grid: GridPreset, steps: number): Promise<void> {
  const substrate = buildSubstrate(42042, { preset: "earth_sim" }, grid);
  const reference = makeWorld(grid, substrate, { peopleKernel: "ts" });
  const wasm = makeWorld(grid, substrate, { peopleKernel: "wasm", peopleWorkers: 1 });
  assert.ok((wasm as PeopleWorld)._wasmPeopleKernel, `${grid} did not select the WASM kernel`);
  assert.equal((wasm as PeopleWorld)._wasmPeopleKernel?.usesThreads, false);
  comparePeopleState(reference, wasm, grid, 0);
  for (let step = 1; step <= steps; step++) {
    runSteps(reference, 1);
    runSteps(wasm, 1);
    comparePeopleState(reference, wasm, grid, step);
  }
  const serialHash = hashWorld(wasm);
  assert.equal(serialHash, hashWorld(reference), `${grid} serial hash diverged after ${steps} ticks`);
  (wasm as PeopleWorld)._wasmPeopleKernel?.dispose();

  const threadedReference = makeWorld(grid, substrate, { peopleKernel: "ts" });
  assert.ok(await resizePeoplePool(1), `${grid} could not start a 1-worker pool`);
  const threadedOne = makeWorld(grid, substrate, {
    peopleKernel: "wasm",
    peopleWorkers: 1,
    peopleThreads: true,
  });
  const threadedKernel = (threadedOne as PeopleWorld)._wasmPeopleKernel;
  assert.ok(threadedKernel?.usesThreads, `${grid} 1-worker threaded path did not use the worker pool`);
  assert.equal(threadedKernel.workerCount, 1);
  comparePeopleState(threadedReference, threadedOne, grid, 0);
  for (let step = 1; step <= steps; step++) {
    runSteps(threadedReference, 1);
    runSteps(threadedOne, 1);
    comparePeopleState(threadedReference, threadedOne, grid, step);
  }
  assert.equal(
    hashWorld(threadedOne),
    hashWorld(threadedReference),
    `${grid} 1-worker hash diverged after ${steps} ticks`,
  );
  (threadedOne as PeopleWorld)._wasmPeopleKernel?.dispose();

  const hashes: Record<number, string> = { 1: serialHash };
  for (const workerCount of [2, 8]) {
    assert.ok(await resizePeoplePool(workerCount), `${grid} could not start a ${workerCount}-worker pool`);
    const workerWorld = makeWorld(grid, substrate, {
      peopleKernel: "wasm",
      peopleWorkers: workerCount,
    });
    assert.equal((workerWorld as PeopleWorld)._wasmPeopleKernel?.workerCount, workerCount);
    assert.ok(
      (workerWorld as PeopleWorld)._wasmPeopleKernel?.usesThreads,
      `${grid} ${workerCount}-worker path did not use the worker pool`,
    );
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
  await runParity("dev", 240);
  await runParity("target", 24);
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

