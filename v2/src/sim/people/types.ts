import type { Substrate } from "../substrate";
import type { World } from "../world";

export interface HearthState {
  readonly id: string;
  readonly cell: number;
  readonly packageId: string;
  lagYears: number;
  readonly score: number;
  armedYears: number;
  ignited: boolean;
}

export interface PeopleWorld extends World {
  readonly substrate: Substrate;
  peopleInitialized: boolean;
  hearths: HearthState[];
  capField: Float64Array;
  cellAreaKm2: Float64Array;
  _peopleNext: Float64Array;
  _techniqueNext: Float64Array;
  _childrenMass: Float64Array;
  _workingMass: Float64Array;
  _eldersMass: Float64Array;
  _childrenNext: Float64Array;
  _workingNext: Float64Array;
  _eldersNext: Float64Array;
  _migrationOut: Float64Array;
  _migrationWeight: Float64Array;
  _migrationPopulation: Float64Array;
  _landCells: Int32Array;
  _annualTemperature: Float64Array;
  _annualMoisture: Float64Array;
  _techniqueSuitability: Float64Array;
  /** Static peopling mask (ancestry extent) — hoisted from two array reads per call. */
  _peopledMask: Uint8Array;
  /** Per-row horizontal / constant vertical 4-neighbor edge lengths, technique's exact expression. */
  _techniqueEdgeH: Float64Array;
  _techniqueEdgeV: number;
  /** Per-row horizontal / constant vertical edge lengths, migration's exact expression. */
  _migrationEdgeH: Float64Array;
  _migrationEdgeV: number;
  /** Per-cell foot days/km for the tick's month (migration conductance numerator). */
  _migrationDaysPerKm: Float64Array;
  /** Static per-cell forager capacity and disease burden (annual-climate properties). */
  _foragerCapacity: Float64Array;
  _diseaseBurden: Float64Array;
  /** Per-row migration share for the tick (area is a row property). */
  _migrationShareRow: Float64Array;
}

export function asPeopleWorld(world: World): PeopleWorld {
  if (!world.substrate) throw new Error("People simulation requires an immutable substrate.");
  return world as PeopleWorld;
}
