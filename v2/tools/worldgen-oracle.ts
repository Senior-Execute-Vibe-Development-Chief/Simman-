import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MONTHS_PER_YEAR } from "../src/sim/constants";
import { buildSubstrate, type Substrate } from "../src/sim/substrate";
import { dimensionsFor, type GridPreset, World } from "../src/sim/world";
import { printProvenance } from "./lib/provenance";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const SEED = 42042;

// The M1 earth-data deviation (QUESTIONS.md #19): v2 regenerated EARTH_ELEV
// from real ETOPO1 (the inherited raster drowned every low coastal plain), so
// v1's baked raster no longer matches v2's. This oracle verifies the ALGORITHM
// port, so the v1 side must run on the SAME data: its sim tree is copied and
// earthData.js swapped for v2's before the comparison run. The swap is sound
// because v2's earthData.js is v1's module with only the data string replaced
// — decode/sample code identical.
function patchedV1SimDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "v1-sim-oracle-"));
  cpSync(join(repoRoot, "src", "sim"), dir, { recursive: true });
  copyFileSync(
    fileURLToPath(new URL("../src/ported/worldgen/earthData.js", import.meta.url)),
    join(dir, "earthData.js"),
  );
  // The v2 strait table gained the Marmara chain (QUESTIONS.md #21 — without
  // it the Black Sea is a closed lake and the Danube reads terminal); carve
  // rows mutate elevation, which the earth arm asserts byte-exact, so the v1
  // copy runs with the same table.
  const worldgenPath = join(dir, "worldgen.js");
  const worldgenSource = readFileSync(worldgenPath, "utf8");
  const gibraltarRow = "{ lat: 35.95, lon: -5.4, dLon: 1.2, dLat: 0.5 },   // Gibraltar — Mediterranean ↔ Atlantic";
  assert.ok(worldgenSource.includes(gibraltarRow), "v1 strait table changed shape — update the oracle patch");
  writeFileSync(worldgenPath, worldgenSource.replace(
    gibraltarRow,
    `${gibraltarRow}\n  { lat: 40.6, lon: 27.6, dLon: 1.7, dLat: 0.3 },    // Dardanelles + Marmara + Bosporus — Black Sea ↔ Aegean`,
  ));
  return dir;
}
const v1SimDir = patchedV1SimDir();
const SAMPLE_COUNT = 1024;
// Tolerance for fields downstream of a dmath swap. These are Float32 fields
// produced by ITERATIVE solvers, so a handful of f64-intermediate ULP
// differences accumulate to ~1e-7 absolute (measured: annualMoisture max
// |Δ| 1.8e-7 at target). With the scale floor below this bar bounds the
// absolute error at 5e-7 on small-valued cells and 5e-4 relative on
// full-scale ones — far below any consumer threshold, while a genuinely
// broken function (the M1 datan2 bug was order 0.4) still fails by orders
// of magnitude.
const SWAPPED_FIELD_TOLERANCE = 5e-4;
// Error metric floor: relative error above this scale, absolute below it —
// a desert cell holding 1e-9 moisture must not turn a 1e-7 absolute
// difference into a "huge" relative one (M1 review).
const FIELD_SCALE_FLOOR = 1e-3;
const EXACT_FIELDS = new Set([
  "elevation",
  "relief",
  "coast",
  "floodplain",
  "riverMagnitude",
  "riverDirection",
  "lake",
]);
// Fields the M1 port deliberately changed (km-converted radii, the v2
// baseEdgeCost boundary) — reported but not asserted. annualMoisture is NOT
// exempt: it is dmath-swapped, so the tolerance assert below must stay live
// (M1 review: listing it here silently killed that assert).
const CLEANUP_FIELDS = new Set([
  "soil",
  "wildCropSuitability",
  "crossingCost",
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

function sourceOracle(grid: GridPreset, preset = "earth_sim"): OracleOutput {
  const dimensions = dimensionsFor(grid);
  const source = `
    import { buildWorld } from ${JSON.stringify(pathToFileURL(join(v1SimDir, "pipeline.js")).href)};
    import { classifyBiome } from ${JSON.stringify(pathToFileURL(join(v1SimDir, "biomeClass.js")).href)};
    const { w, ter } = buildWorld({ W: ${dimensions.width}, H: ${dimensions.height}, seed: ${SEED}, preset: ${JSON.stringify(preset)}, realWind: false });
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
    maxRelativeError = Math.max(error / Math.max(Math.abs(expected.sample[index] ?? 0), FIELD_SCALE_FLOOR), maxRelativeError);
  }
  const status = maxSampleError === 0
    ? "exact"
    : maxRelativeError <= SWAPPED_FIELD_TOLERANCE ? "within-dmath" : "mismatch";
  return { name, maxSampleError, maxRelativeError, status };
}

// Earth presets take river GEOMETRY from baked HydroSHEDS data (QUESTIONS.md
// #21), so every river-derived field deviates from v1 BY DESIGN on earth_sim:
// reported, never asserted. The riverGen ALGORITHM stays verified by the
// procedural arm below, where no baked data applies and these fields must
// still match v1 exactly.
const DATA_DEVIATION_FIELDS = new Set([
  "riverDirection",
  "riverMagnitude",
  "riverFlow",
  "floodplain",
  "lake",
]);

function compareRun(
  grid: GridPreset,
  preset: string,
  dataDeviation: ReadonlySet<string>,
  rawRivers = false,
): ReturnType<typeof compareField>[] {
  const substrate = buildSubstrate(SEED, { preset, realWind: false, rawRivers }, grid);
  const actual = substrateFields(substrate);
  const expected = sourceOracle(grid, preset).fields;
  const rows = Object.entries(actual).map(([name, values]) => {
    const expectedField = expected[name];
    assert.ok(expectedField, `oracle omitted ${name}`);
    const row = compareField(name, summarize(values), expectedField);
    if (dataDeviation.has(name)) return { ...row, status: "data-deviation" as never };
    if (CLEANUP_FIELDS.has(name)) return { ...row, status: "accepted-cleanup" as const };
    return row;
  });
  const exactMismatches = rows.filter((row) => row.status === "mismatch" && EXACT_FIELDS.has(row.name));
  assert.equal(exactMismatches.length, 0,
    `${grid}/${preset} untouched substrate fields diverged: ${exactMismatches.map((row) => `${row.name}(${row.maxSampleError})`).join(", ")}`);
  const dmathMismatches = rows.filter((row) =>
    row.status === "mismatch" && (row.name === "annualTemperature" || row.name === "annualMoisture" || row.name === "riverFlow"));
  assert.equal(dmathMismatches.length, 0, `${grid}/${preset} dmath-swapped substrate fields exceeded tolerance: ${dmathMismatches.map((row) => row.name).join(", ")}`);
  return rows;
}

async function main(): Promise<void> {
  const reports: Record<string, unknown> = {};
  // Algorithm-fidelity arm: the earth preset with the baked river geometry
  // DISABLED — elevation is data-exact and the river path is v1-verbatim on
  // both sides, so riverGen (directions, accumulation, magnitudes, lakes,
  // floodplain) must reproduce v1 EXACTLY. (A procedural preset cannot serve
  // here: its elevation runs through dmath-swapped noise and diverges from
  // v1 by design.)
  reports["dev-rawRivers"] = compareRun("dev", "earth_sim", new Set(), true);
  for (const grid of ["dev", "target"] as const) {
    printProvenance(new World({ seed: SEED, grid, config: { preset: "earth_sim", oracle: true } }));
    reports[grid] = compareRun(grid, "earth_sim", DATA_DEVIATION_FIELDS);
  }
  console.log(JSON.stringify({ oracle: "ok", seed: SEED, grids: reports }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
