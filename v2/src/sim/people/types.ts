import type { Substrate } from "../substrate";
import type { World } from "../world";
import type { PeopleKernelRuntime } from "../peopleKernel";
import type { PeopleBand } from "./bands";

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
  /** Authoritative per-package farmer masses, in persons/km² over land order. */
  farmers: Record<string, Float64Array>;
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
  _farmersNext: Record<string, Float64Array>;
  _farmersMigration: Record<string, Float64Array>;
  _farmerTotal: Float64Array;
  _farmerTotalNext: Float64Array;
  _farmerMigrationTotal: Float64Array;
  /** Package activity bitset, maintained from farmer labels for hot-pass pruning. */
  _activePackage: Uint8Array;
  _migrationOut: Float64Array;
  _migrationWeight: Float64Array;
  _migrationPopulation: Float64Array;
  _migrationReceived: Float64Array;
  _birthsByBand: Float64Array;
  _deathsByBand: Float64Array;
  _migrationByBand: Float64Array;
  _migrationReceivedByBand: Float64Array;
  _landCells: Int32Array;
  _packedOf: Int32Array;
  _peopleBands: readonly PeopleBand[];
  _annualTemperature: Float64Array;
  _annualMoisture: Float64Array;
  _techniqueSuitability: Float64Array;
  /** Per-package annual climate/season admissibility, packed to land. */
  _canGrow: readonly Uint8Array[];
  /** Per-package native wild-progenitor ranges, packed to land. */
  _nativeRanges: readonly Uint8Array[];
  /** Per-package list of packed native cells; the hearth law accrues on exactly these. */
  _nativeCells: readonly Int32Array[];
  /** Peopled-basin years accrued per native cell per package (state: saved and hashed). */
  _hearthYears: readonly Float64Array[];
  /** Summed-area tables (width+1)×(height+1) of forager capacity × area (static) and people × area (per pass). */
  _basinCapacitySum: Float64Array;
  _basinPeopleSum: Float64Array;
  /** Per-cell mobile mass (foragers + farmers × mobility ratio) and farmer share frozen for the month's flow. */
  _migrationMobile: Float64Array;
  _migrationFarmerShare: Float64Array;
  /** Per source slot conductance × pair spare (source phase), per source out ÷ weight, per source cohort fractions. */
  _pairWeight: Float64Array;
  _migrationRatio: Float64Array;
  _childrenFraction: Float64Array;
  _workingFraction: Float64Array;
  _eldersFraction: Float64Array;
  /** Dominant farmer package index, derived for lenses and capacity diagnostics. */
  _dominantPackage: Uint8Array;
  /** Static peopling mask (ancestry extent) — hoisted from two array reads per call. */
  _peopledMask: Uint8Array;
  /** Per-row horizontal / constant vertical 4-neighbor edge lengths, technique's exact expression. */
  _techniqueEdgeH: Float64Array;
  _techniqueEdgeV: number;
  /** Per-row horizontal / constant vertical edge lengths, migration's exact expression. */
  _migrationEdgeH: Float64Array;
  _migrationEdgeV: number;
  /** Eight-neighbour source/target LUT, row-major packed land order. */
  _neighborTargets: Int32Array;
  _neighborDistanceKm: Float64Array;
  _neighborMode: Uint8Array;
  /** Per-cell foot days/km for the tick's month (migration conductance numerator). */
  _migrationDaysPerKm: Float64Array;
  /** Lazy per-month days/km caches — climate is periodic, so 12 fills total. */
  _migrationDaysPerKmByMonth: Array<Float64Array | undefined>;
  /** Static water-access and relief multipliers (annual land properties). */
  _waterAccess: Float64Array;
  _reliefMult: Float64Array;
  /** Static per-cell forager capacity and disease burden (annual-climate properties). */
  _foragerCapacity: Float64Array;
  _diseaseBurden: Float64Array;
  /** Per-row migration share for the tick (area is a row property). */
  _migrationShareRow: Float64Array;
  /** Optional wasm owner of the authoritative fields; absent means TS oracle. */
  _wasmPeopleKernel?: PeopleKernelRuntime;
}

export function asPeopleWorld(world: World): PeopleWorld {
  if (!world.substrate) throw new Error("People simulation requires an immutable substrate.");
  return world as PeopleWorld;
}
