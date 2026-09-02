import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { MONTHS_PER_YEAR, PEOPLE_BENCH_LONG_YEARS } from "../src/sim/constants";
import { printProvenance, provenance } from "./lib/provenance";
import { buildSubstrate } from "../src/sim/substrate";
import { createTravelEngine, TravelEngine } from "../src/sim/travel/engine";
import { runSteps, type GridPreset, World } from "../src/sim/world";
import { ensurePeopleWasm, defaultPeopleWorkers } from "../src/sim/peopleKernel";
import {
  peoplePhaseMilliseconds,
  resetPeoplePhaseMilliseconds,
} from "../src/sim/people";
import type { PeopleWorld } from "../src/sim/people/types";
import os from "node:os";

const BENCH_TICKS = 10;
const CADENCE_TICKS = 12;

interface BenchRow {
  readonly grid: GridPreset;
  readonly substrateMilliseconds: number;
  readonly routingInitializeMilliseconds: number;
  readonly customizeMilliseconds: number;
  readonly queryMilliseconds: number;
  readonly distanceMapMilliseconds: number;
  readonly tickMilliseconds: number;
  readonly longRunMilliseconds?: number;
  readonly provenance: ReturnType<typeof provenance>;
}

async function benchmark(grid: GridPreset): Promise<BenchRow> {
  const stamp = new World({ seed: 42042, grid, config: { preset: "earth_sim" } });
  printProvenance(stamp);
  const substrateStart = performance.now();
  const substrate = buildSubstrate(stamp.seed, { preset: "earth_sim" }, grid);
  const substrateMilliseconds = performance.now() - substrateStart;
  const world = new World({
    seed: 42042,
    grid,
    config: { preset: "earth_sim", peopleKernel: "wasm", peopleWorkers: 1 },
    substrate,
  });

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

  const tickStart = performance.now();
  runSteps(world, BENCH_TICKS);
  const tickMilliseconds = (performance.now() - tickStart) / BENCH_TICKS;
  const longRunMilliseconds = process.env.BENCH_LONG === "1" && grid === "target"
    ? (() => {
      const start = performance.now();
      runSteps(world, PEOPLE_BENCH_LONG_YEARS * MONTHS_PER_YEAR);
      return performance.now() - start;
    })()
    : undefined;
  const result = {
    grid,
    substrateMilliseconds,
    routingInitializeMilliseconds,
    customizeMilliseconds,
    queryMilliseconds,
    distanceMapMilliseconds,
    tickMilliseconds,
    ...(longRunMilliseconds === undefined ? {} : { longRunMilliseconds }),
    provenance: provenance(world),
  };
  (world as PeopleWorld)._wasmPeopleKernel?.dispose();
  return result;
}

const TARGET_HORIZON_TICKS = 116412;

async function cadenceBench(grid: GridPreset): Promise<Record<string, unknown>> {
  const substrate = buildSubstrate(42042, { preset: "earth_sim" }, grid);
  const workers = defaultPeopleWorkers();
  const configs = [
    { name: "serial-stride1", peopleWorkers: 1, peopleGrowthStride: 1, peopleMigrationStride: 1 },
    { name: "serial-shipped", peopleWorkers: 1 },
    { name: `threads${workers}-stride1`, peopleWorkers: workers, peopleGrowthStride: 1, peopleMigrationStride: 1, peopleThreads: workers === 1 },
    { name: `threads${workers}-shipped`, peopleWorkers: workers, peopleThreads: workers === 1 },
  ] as const;
  const rows: Record<string, unknown>[] = [];
  for (const config of configs) {
    const world = new World({
      seed: 42042,
      grid,
      config: { preset: "earth_sim", peopleKernel: "wasm", ...config },
      substrate,
    });
    runSteps(world, CADENCE_TICKS);
    resetPeoplePhaseMilliseconds();
    const kernel = (world as PeopleWorld)._wasmPeopleKernel;
    const barrierBefore = kernel?.barrierMilliseconds ?? 0;
    const started = performance.now();
    runSteps(world, CADENCE_TICKS);
    const elapsed = performance.now() - started;
    const barrier = (kernel?.barrierMilliseconds ?? 0) - barrierBefore;
    const phases = { ...peoplePhaseMilliseconds };
    const workerCount = kernel?.workerCount ?? 1;
    const usesThreads = kernel?.usesThreads ?? false;
    kernel?.dispose();
    const perTick = elapsed / CADENCE_TICKS;
    rows.push({
      name: config.name,
      workers: workerCount,
      usesThreads,
      schedule: world.schedule,
      tickMilliseconds: perTick,
      barrierMilliseconds: barrier / CADENCE_TICKS,
      phases,
      projectedYdTo1CeMinutes: perTick * TARGET_HORIZON_TICKS / 60000,
    });
  }
  return {
    grid,
    cpus: os.cpus().length,
    defaultWorkers: workers,
    rows,
  };
}

if (!await ensurePeopleWasm()) throw new Error("People WASM failed to initialize.");
const rows = [await benchmark("dev"), await benchmark("target")];
const cadence = [await cadenceBench("dev"), await cadenceBench("target")];
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
    "tickMilliseconds",
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
  cadence,
  format: "milliseconds",
  peopleTickSamples: BENCH_TICKS,
  cadenceTickSamples: CADENCE_TICKS,
  ceilingMilliseconds: 15.5,
  horizonTicks: TARGET_HORIZON_TICKS,
  longRun: process.env.BENCH_LONG === "1"
    ? `target ${PEOPLE_BENCH_LONG_YEARS} years`
    : "disabled (set BENCH_LONG=1)",
}));
process.exit(0);
