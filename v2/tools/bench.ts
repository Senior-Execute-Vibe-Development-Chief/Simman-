import { performance } from "node:perf_hooks";
import { printProvenance, provenance } from "./lib/provenance";
import { runSteps, type GridPreset, World } from "../src/sim/world";

const BENCH_TICKS = 100;

interface BenchRow {
  readonly grid: GridPreset;
  readonly ticks: number;
  readonly milliseconds: number;
  readonly millisecondsPerTick: number;
  readonly provenance: ReturnType<typeof provenance>;
}

function benchmark(grid: GridPreset): BenchRow {
  const world = new World({ seed: 42042, grid });
  printProvenance(world);
  const start = performance.now();
  runSteps(world, BENCH_TICKS);
  const milliseconds = performance.now() - start;
  return {
    grid,
    ticks: BENCH_TICKS,
    milliseconds,
    millisecondsPerTick: milliseconds / BENCH_TICKS,
    provenance: provenance(world),
  };
}

console.log(JSON.stringify({
  bench: [benchmark("dev"), benchmark("target")],
  format: "milliseconds-per-tick",
}));
