import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDmathGoldens } from "./lib/dmath-check";
import { collect } from "./lib/collect";
import { entityRng, hash32, mkRng, passRng } from "../src/ported/rng";
import { loadWorld, serializeWorld } from "../src/sim/persist";
import { populationTotal } from "../src/sim/people";
import { runRoutingBatteries } from "../src/sim/travel/battery";
import type { Substrate } from "../src/sim/substrate";
import type { PeopleWorld } from "../src/sim/people/types";
import { hashWorld, runSteps, World } from "../src/sim/world";
import { ensurePeopleWasm } from "../src/sim/peopleKernel";
import { passDtMonths, passFires, resolveSchedule } from "../src/sim/scheduler";
import { PEOPLE_GROWTH_STRIDE_MONTHS } from "../src/sim/constants";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const PRIMED_HEARTH_YEARS = 1e6;
const rngInputs = {
  seed: 123456789,
  system: "golden.system",
  step: 37,
  entity: 9001,
};

function v1RngVectors(): unknown {
  const script = `
    import { hash32, mkRng, passRng, entityRng } from "./src/sim/peopleSim/rng.js";
    const input = ${JSON.stringify(rngInputs)};
    const stream = (rng) => [rng(), rng(), rng(), rng()];
    console.log(JSON.stringify({
      hash: hash32(input.seed, input.system, input.step),
      raw: stream(mkRng(input.seed)),
      pass: stream(passRng({ seed: input.seed, step: input.step }, input.system)),
      entity: stream(entityRng({ seed: input.seed }, input.system, input.entity)),
    }));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
  }));
}

function tsRngVectors(): unknown {
  const stream = (rng: ReturnType<typeof mkRng>) => [rng(), rng(), rng(), rng()];
  return {
    hash: hash32(rngInputs.seed, rngInputs.system, rngInputs.step),
    raw: stream(mkRng(rngInputs.seed)),
    pass: stream(passRng(rngInputs.seed, rngInputs.system, rngInputs.step)),
    entity: stream(entityRng(rngInputs.seed, rngInputs.system, rngInputs.entity)),
  };
}

function peopleFixture(): Substrate {
  const width = 240;
  const height = 120;
  const cells = width * height;
  const monthly = cells * 12;
  const temperature = new Float32Array(monthly);
  const moisture = new Float32Array(monthly);
  temperature.fill(0.72);
  moisture.fill(0.5);
  const landMask = new Uint8Array(cells);
  landMask.fill(1);
  const ancestry = new Int16Array(cells);
  const arrival = new Float32Array(cells);
  ancestry.fill(0);
  return {
    seed: 0,
    grid: "dev",
    width,
    height,
    N: cells,
    preset: "people-fixture",
    elevation: new Float32Array(cells),
    landMask,
    climate: { temperature, moisture },
    wind: { u: new Float32Array(monthly), v: new Float32Array(monthly) },
    temperature,
    moisture,
    rivers: {
      magnitude: new Uint8Array(cells),
      direction: new Uint8Array(cells).fill(255),
      flowAccum: new Float32Array(cells),
      lake: new Int32Array(cells).fill(-1),
    },
    ancestry: {
      lineage: ancestry,
      arrival,
      count: 1,
      hue: new Float32Array(1),
      light: new Float32Array(1),
      originFx: 0,
      originFy: 0,
    },
    floodplain: new Float32Array(cells),
    biome: new Uint8Array(cells),
    soil: new Float32Array(cells),
    fertility: new Float32Array(cells).fill(0.5),
    wildCropSuitability: new Float32Array(cells).fill(0.5),
    crossingCost: new Float32Array(cells),
    resources: {},
    relief: new Float32Array(cells),
    coast: new Uint8Array(cells),
    coastDistanceKm: new Float32Array(cells),
  };
}

async function main(): Promise<void> {
  if (!await ensurePeopleWasm()) throw new Error("People WASM failed to initialize.");
  assert.deepEqual(tsRngVectors(), v1RngVectors(), "RNG port diverged from v1 oracle");
  assert.equal(checkDmathGoldens().length, 26);
  const routing = await runRoutingBatteries();
  assert.ok(routing.every((result) => result.queries >= 72));

  const world = new World({
    seed: 77,
    grid: "dev",
    config: { scenario: "save-round-trip", marker: 1 },
  });
  runSteps(world, 17);
  const saved = serializeWorld(world);
  const loaded = loadWorld(saved);
  assert.equal(hashWorld(loaded), hashWorld(world));
  assert.equal(serializeWorld(loaded), saved);
  runSteps(world, 31);
  runSteps(loaded, 31);
  assert.equal(hashWorld(loaded), hashWorld(world));

  const extra = world as unknown as Record<string, unknown>;
  extra.extraState = { numericLeaf: 12 };
  const metrics = collect(world);
  assert.equal(metrics["world.extraState.numericLeaf"], 12);
  assert.equal(metrics["field.people.n"], world.N);
  assert.equal(metrics["field.technique.n"], world.N);
  assert.equal(metrics["field.people.sum.n"], undefined);

  const substrate = peopleFixture();
  const peopleWorld = new World({
    seed: 99,
    grid: "dev",
    config: { peopleKernel: "wasm", peopleWorkers: 1 },
    substrate,
  });
  const opening = populationTotal(peopleWorld);
  const packedWorld = peopleWorld as PeopleWorld;
  for (const name of [
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
  ]) {
    assert.equal(
      (packedWorld as unknown as Record<string, Float64Array>)[name]?.length,
      packedWorld._landCells.length,
      `${name} must be land-packed`,
    );
  }
  for (const name of ["people", "technique", "children", "working", "elders", "capField"]) {
    assert.equal(
      (packedWorld as unknown as Record<string, Float64Array>)[name]?.length,
      packedWorld.N,
      `${name} must retain its full-grid view`,
    );
  }
  for (const band of packedWorld._peopleBands) {
    const first = packedWorld._landCells[band.rawLo];
    const last = packedWorld._landCells[band.rawHi - 1];
    if (first !== undefined) assert.ok(first >= band.rowLo * packedWorld.width);
    if (last !== undefined) assert.ok(last < band.rowHi * packedWorld.width);
  }
  runSteps(peopleWorld, 24);
  assert.equal(peopleWorld.hearths.length, 0, "a hearth ignited before its range accrued its lag");
  // Prime every native cell's peopled-basin years past its lag: the next
  // conversion pass must ignite, seed farmers, and derive technique as the
  // farmed share of each cell.
  for (const years of packedWorld._hearthYears) years.fill(PRIMED_HEARTH_YEARS);
  runSteps(peopleWorld, 12);
  assert.ok(peopleWorld.hearths.some((hearth) => hearth.ignited), "hearths never ignite");
  let farmed = 0;
  for (const field of Object.values(packedWorld.farmers)) for (const value of field) farmed += value;
  assert.ok(farmed > 0, "ignition seeded no farmers");
  for (const cell of packedWorld._landCells) {
    const packed = packedWorld._packedOf[cell] ?? -1;
    const population = peopleWorld.people[cell] ?? 0;
    const expected = population > 0
      ? Math.min(1, Math.max(0, packedWorld._farmerTotal[packed] ?? 0) / population)
      : 0;
    assert.equal(peopleWorld.technique[cell], expected, "technique is not the farmed share");
  }
  const peopleSave = serializeWorld(peopleWorld);
  const peopleLoaded = loadWorld(peopleSave, substrate);
  assert.ok(opening > 0, "people initial condition is empty");
  assert.equal(serializeWorld(peopleLoaded), peopleSave);
  runSteps(peopleWorld, 12);
  runSteps(peopleLoaded, 12);
  assert.equal(hashWorld(peopleLoaded), hashWorld(peopleWorld), "people continuation diverged");
  const peopleBalance = peopleWorld.ledger.snapshot().people;
  assert.ok(peopleBalance, "people conservation sheet missing");
  assert.equal(peopleBalance?.sources.migration, peopleBalance?.sinks.migration);

  for (const stride of [1, 3, 12]) {
    for (const phase of [0, 1, stride - 1]) {
      const hits: number[] = [];
      for (let step = 0; step < stride * 4; step++) {
        if (passFires({ step }, { stride, phase })) hits.push(step);
      }
      assert.equal(hits[0], ((phase % stride) + stride) % stride);
      assert.ok(hits.every((step) => ((step - phase) % stride + stride) % stride === 0));
      assert.equal(hits.length, 4);
      assert.equal(passDtMonths({ stride }), stride);
    }
  }
  // v1 SETT_STRIDE lcm scar: a slower rhythm is a second pass, never step%N
  // inside an already-strided pass. stride 12 fires January; a 24-month
  // companion is its own schedule row, not `fires && step % 24`.
  const annual: number[] = [];
  const biennial: number[] = [];
  for (let step = 0; step < 48; step++) {
    if (passFires({ step }, { stride: 12, phase: 0 })) annual.push(step);
    if (passFires({ step }, { stride: 24, phase: 0 })) biennial.push(step);
  }
  assert.deepEqual(annual, [0, 12, 24, 36]);
  assert.deepEqual(biennial, [0, 24]);
  assert.ok(annual.every((step) => step % 12 === 0));
  assert.ok(!annual.filter((step) => step % 24 !== 0).every((step) => biennial.includes(step)));

  const devWorld = new World({ seed: 1, grid: "dev" });
  const targetWorld = new World({ seed: 1, grid: "target" });
  const named = (world: World, name: string) => resolveSchedule(world).find((row) => row.name === name);
  assert.equal(named(devWorld, "people.growth")?.stride, PEOPLE_GROWTH_STRIDE_MONTHS);
  assert.equal(named(targetWorld, "people.growth")?.stride, PEOPLE_GROWTH_STRIDE_MONTHS);
  // Unpeopled poles are excluded from derivation; a world with every row
  // treated as peopled (no substrate mask) must pick 1, matching target.
  assert.equal(named(targetWorld, "people.migration")?.stride, 1);
  assert.equal(named(devWorld, "people.migration")?.stride, 1);
  const forced = new World({
    seed: 1,
    grid: "target",
    config: { peopleGrowthStride: 12, peopleMigrationStride: 12 },
  });
  assert.equal(named(forced, "people.migration")?.stride, 12);

  console.log(JSON.stringify({
    tests: "ok",
    rng: "v1-byte-compatible",
    dmath: "golden",
    saveLoad: "byte-identical",
    routing: "ok",
    scheduler: "ok",
  }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
