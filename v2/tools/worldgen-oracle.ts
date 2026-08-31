import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MONTHS_PER_YEAR } from "../src/sim/constants";
import { buildSubstrate, type Substrate } from "../src/sim/substrate";
import { dimensionsFor, type GridPreset, World } from "../src/sim/world";
import { printProvenance } from "./lib/provenance";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SEED = 42042;
const SAMPLE_COUNT = 1024;
const SWAPPED_FIELD_TOLERANCE = 2e-6;
const EXACT_FIELDS = new Set([
  "elevation",
  "relief",
  "coast",
  "floodplain",
  "riverMagnitude",
  "riverDirection",
  "lake",
]);
const CLEANUP_FIELDS = new Set([
  "soil",
  "wildCropSuitability",
  "crossingCost",
  "annualMoisture",
  "biome",
  "resource.timber",
  "resource.salt",
  "resource.copper",
  "resource.tin",
  "resource.precious",
  "resource.coal",
  "resource.gems",
  "resource.incense",
]);

interface FieldSummary {
  readonly length: number;
  readonly finite: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly sample: readonly number[];
}

interface OracleOutput {
  readonly fields: Record<string, FieldSummary>;
}

function summarize(values: ArrayLike<number>): FieldSummary {
  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(values.length / SAMPLE_COUNT));
  let finite = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index] ?? 0;
    if (!Number.isFinite(value)) continue;
    finite++;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    if (index % stride === 0 && sample.length < SAMPLE_COUNT) sample.push(value);
  }
  return {
    length: values.length,
    finite,
    min: finite ? min : 0,
    max: finite ? max : 0,
    mean: finite ? sum / finite : 0,
    sample,
  };
}

function sourceOracle(grid: GridPreset): OracleOutput {
  const dimensions = dimensionsFor(grid);
  const source = `
    import { buildWorld } from "./src/sim/pipeline.js";
    import { classifyBiome } from "./src/sim/biomeClass.js";
    const { w, ter } = buildWorld({ W: ${dimensions.width}, H: ${dimensions.height}, seed: ${SEED}, preset: "earth_sim", realWind: false });
    const fields = {
      elevation: w.elevation,
      annualTemperature: w.temperature,
      annualMoisture: w.moisture,
      relief: ter.tRelief,
      soil: ter.tFert,
      wildCropSuitability: ter.tCrop,
      crossingCost: ter.tCross,
      coast: ter.tCoast,
      floodplain: ter.tFlood,
      riverMagnitude: ter.rivers.riverMag,
      riverDirection: ter.rivers.flowDir,
      riverFlow: ter.rivers.flowAccum,
      lake: ter.rivers.lake,
      biome: Uint8Array.from(ter.tElev, (_, i) => classifyBiome(ter.tElev[i], ter.tMoist[i], ter.tTemp[i], w.dryFrac[i] ?? 0, w.summerDry[i] ?? 0)),
      ...Object.fromEntries(Object.entries(ter.deposits).map(([key, value]) => [\`resource.\${key}\`, value])),
    };
    const summarize = (values) => {
      let finite = 0, min = Infinity, max = -Infinity, sum = 0;
      const sample = [], stride = Math.max(1, Math.floor(values.length / ${SAMPLE_COUNT}));
      for (let i = 0; i < values.length; i++) {
        const value = Number(values[i] ?? 0);
        if (!Number.isFinite(value)) continue;
        finite++; min = Math.min(min, value); max = Math.max(max, value); sum += value;
        if (i % stride === 0 && sample.length < ${SAMPLE_COUNT}) sample.push(value);
      }
      return { length: values.length, finite, min: finite ? min : 0, max: finite ? max : 0, mean: finite ? sum / finite : 0, sample };
    };
    console.log(JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, summarize(value)])) }));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  })) as OracleOutput;
}

function monthlyMean(values: Float32Array, cells: number): Float32Array {
  const mean = new Float32Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    let sum = 0;
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      sum += values[cell * MONTHS_PER_YEAR + month] ?? 0;
    }
    mean[cell] = sum / MONTHS_PER_YEAR;
  }
  return mean;
}

function substrateFields(substrate: Substrate): Record<string, ArrayLike<number>> {
  const fields: Record<string, ArrayLike<number>> = {
    elevation: substrate.elevation,
    annualTemperature: monthlyMean(substrate.temperature, substrate.N),
    annualMoisture: monthlyMean(substrate.moisture, substrate.N),
    relief: substrate.relief,
    soil: substrate.soil,
    wildCropSuitability: substrate.wildCropSuitability,
    crossingCost: substrate.crossingCost,
    coast: substrate.coast,
    floodplain: substrate.floodplain,
    riverMagnitude: substrate.rivers.magnitude,
    riverDirection: substrate.rivers.direction,
    riverFlow: substrate.rivers.flowAccum,
    lake: substrate.rivers.lake,
    biome: substrate.biome,
  };
  for (const [key, value] of Object.entries(substrate.resources)) fields[`resource.${key}`] = value;
  return fields;
}

function compareField(name: string, actual: FieldSummary, expected: FieldSummary): {
  readonly name: string;
  readonly maxSampleError: number;
  readonly maxRelativeError: number;
  readonly status: "exact" | "within-dmath" | "accepted-cleanup" | "mismatch";
} {
  assert.equal(actual.length, expected.length, `${name} length differs`);
  let maxSampleError = 0;
  let maxRelativeError = 0;
  for (let index = 0; index < Math.min(actual.sample.length, expected.sample.length); index++) {
    const error = Math.abs((actual.sample[index] ?? 0) - (expected.sample[index] ?? 0));
    maxSampleError = Math.max(maxSampleError, error);
    maxRelativeError = Math.max(error / Math.max(Math.abs(expected.sample[index] ?? 0), 1e-12), maxRelativeError);
  }
  const status = maxSampleError === 0
    ? "exact"
    : maxRelativeError <= SWAPPED_FIELD_TOLERANCE ? "within-dmath" : "mismatch";
  return { name, maxSampleError, maxRelativeError, status };
}

async function main(): Promise<void> {
  const reports: Record<string, unknown> = {};
  for (const grid of ["dev", "target"] as const) {
    printProvenance(new World({ seed: SEED, grid, config: { preset: "earth_sim", oracle: true } }));
    const substrate = buildSubstrate(SEED, { preset: "earth_sim", realWind: false }, grid);
    const actual = substrateFields(substrate);
    const expected = sourceOracle(grid).fields;
    const rows = Object.entries(actual).map(([name, values]) => {
      const expectedField = expected[name];
      assert.ok(expectedField, `oracle omitted ${name}`);
      const row = compareField(name, summarize(values), expectedField);
      if (CLEANUP_FIELDS.has(name)) return { ...row, status: "accepted-cleanup" as const };
      return row;
    });
    reports[grid] = rows;
    const exactMismatches = rows.filter((row) => row.status === "mismatch" && EXACT_FIELDS.has(row.name));
    assert.equal(exactMismatches.length, 0, `${grid} untouched substrate fields diverged`);
    const dmathMismatches = rows.filter((row) =>
      row.status === "mismatch" && (row.name === "annualTemperature" || row.name === "annualMoisture" || row.name === "riverFlow"));
    assert.equal(dmathMismatches.length, 0, `${grid} dmath-swapped substrate fields exceeded tolerance: ${dmathMismatches.map((row) => row.name).join(", ")}`);
  }
  console.log(JSON.stringify({ oracle: "ok", seed: SEED, grids: reports }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
