import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDmathGoldens } from "./lib/dmath-check";
import { collect } from "./lib/collect";
import { dijkstraTestGraph } from "../src/sim/router";
import { entityRng, hash32, mkRng, passRng } from "../src/ported/rng";
import { loadWorld, serializeWorld } from "../src/sim/persist";
import { hashWorld, runSteps, World } from "../src/sim/world";

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

async function main(): Promise<void> {
  assert.deepEqual(tsRngVectors(), v1RngVectors(), "RNG port diverged from v1 oracle");
  assert.equal(checkDmathGoldens().length, 21);
  assert.deepEqual(await dijkstraTestGraph(), [0, 2, 3, 4, 6]);

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
  assert.equal(metrics["field.noise.n"], world.N);
  assert.equal(metrics["field.noise.sum.n"], undefined);

  console.log(JSON.stringify({ tests: "ok", rng: "v1-byte-compatible", dmath: "golden", saveLoad: "byte-identical", wasm: "ok" }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
