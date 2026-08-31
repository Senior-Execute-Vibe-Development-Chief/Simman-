import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { printProvenance, provenance } from "./lib/provenance";
import { buildSubstrate } from "../src/sim/substrate";
import { createTravelEngine, TravelEngine } from "../src/sim/travel/engine";
import { runSteps, type GridPreset, World } from "../src/sim/world";

const BENCH_TICKS = 100;

interface BenchRow {
  readonly grid: GridPreset;
  readonly substrateMilliseconds: number;
  readonly routingInitializeMilliseconds: number;
  readonly customizeMilliseconds: number;
  readonly queryMilliseconds: number;
  readonly distanceMapMilliseconds: number;
  readonly provenance: ReturnType<typeof provenance>;
}

async function benchmark(grid: GridPreset): Promise<BenchRow> {
  const world = new World({ seed: 42042, grid, config: { preset: "earth_sim" } });
  printProvenance(world);
  const substrateStart = performance.now();
  const substrate = buildSubstrate(world.seed, { preset: "earth_sim" }, grid);
  const substrateMilliseconds = performance.now() - substrateStart;

  const routingStart = performance.now();
  const engine = await createTravelEngine(substrate);
  const routingInitializeMilliseconds = performance.now() - routingStart;

  const metric = TravelEngine.defaultMetric(0);
  const customizeStart = performance.now();
  engine.customize(metric);
  const customizeMilliseconds = performance.now() - customizeStart;

  let start = 0;
  let goal = substrate.N - 1;
  while (start < substrate.N && !substrate.landMask[start]) start++;
  while (goal >= 0 && !substrate.landMask[goal]) goal--;
  const queryStart = performance.now();
  engine.query(start, goal, metric);
  const queryMilliseconds = performance.now() - queryStart;

  const distanceMapStart = performance.now();
  engine.distanceMap([start], metric);
  const distanceMapMilliseconds = performance.now() - distanceMapStart;

  runSteps(world, BENCH_TICKS);
  return {
    grid,
    substrateMilliseconds,
    routingInitializeMilliseconds,
    customizeMilliseconds,
    queryMilliseconds,
    distanceMapMilliseconds,
    provenance: provenance(world),
  };
}

const rows = [await benchmark("dev"), await benchmark("target")];
if (process.argv.includes("--check")) {
  const baselines = JSON.parse(
    readFileSync(new URL("../bench-baselines.json", import.meta.url), "utf8"),
  ) as Readonly<Record<string, Record<string, number>>>;
  const phases = [
    "substrateMilliseconds",
    "routingInitializeMilliseconds",
    "customizeMilliseconds",
    "queryMilliseconds",
    "distanceMapMilliseconds",
  ] as const;
  for (const row of rows) {
    const baseline = baselines[row.grid];
    if (!baseline) throw new Error(`No benchmark baseline for ${row.grid}.`);
    for (const phase of phases) {
      const limit = (baseline[phase] ?? 0) * 1.2;
      if (row[phase] > limit) {
        throw new Error(`${row.grid} ${phase} regressed: ${row[phase]} > ${limit}.`);
      }
    }
  }
}
console.log(JSON.stringify({
  bench: rows,
  format: "milliseconds",
  placeholderTickSamples: BENCH_TICKS,
}));
