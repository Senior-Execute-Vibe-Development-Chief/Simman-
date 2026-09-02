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
import { hashWorld, runSteps, World } from "../src/sim/world";
import { ensurePeopleWasm } from "../src/sim/peopleKernel";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
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
  const peopleWorld = new World({ seed: 99, grid: "dev", substrate });
  const opening = populationTotal(peopleWorld);
  runSteps(peopleWorld, 24);
  const techniqueBefore = Float64Array.from(peopleWorld.technique);
  for (const hearth of peopleWorld.hearths) hearth.lagYears = 0;
  runSteps(peopleWorld, 1);
  assert.ok(peopleWorld.hearths.some((hearth) => hearth.ignited), "hearths never ignite");
  for (let cell = 0; cell < peopleWorld.N; cell++) {
    assert.ok(
      peopleWorld.technique[cell] >= (techniqueBefore[cell] ?? 0),
      "technique wave is not a ratchet",
    );
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

  console.log(JSON.stringify({ tests: "ok", rng: "v1-byte-compatible", dmath: "golden", saveLoad: "byte-identical", routing: "ok" }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
