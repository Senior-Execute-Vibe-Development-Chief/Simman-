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
  /** The world step the hearth ignited at (the event log's first entries). */
  readonly ignitedStep: number;
  /** Cells of the range that crossed the lag inside this hearth's basin (W8: a hearth is a region, its count a measurement). */
  regionCells: number;
}

export interface PeopleWorld extends World {
  readonly substrate: Substrate;
  peopleInitialized: boolean;
  hearths: HearthState[];
  /** Authoritative per-package farmer masses, in persons/km² over land order. */
  farmers: Record<string, Float64Array>;
  capField: Float64Array;
  /** The built land capital (W28), full grid, 0..1: the share of a cell's improvable ground improved. Authoritative state (saved, hashed); the wasm kernel owns it. */
  works: Float64Array;
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
  /** Per-package climate fit (the crop bell over its growing months, 0..1), packed to land (W8). Carries the drowning a crop that cannot drain suffers, never the paddy a wetland crop gains (W15). */
  _cropFit: readonly Float64Array[];
  /** Per-package paddy gain relative to that fit, packed to land (W15): the standing water a wetland crop gains by is impounded, so capacity pays it out with the technique regime. Zero for every crop that only drowns. */
  _standingGain: readonly Float64Array[];
  /** Per-package fitted wild envelope (W9 provenance: the occurrence count and the seasonal centre and tolerance). */
  _wildEnvelopes: ReadonlyArray<{ readonly cells: number; readonly centre: readonly number[]; readonly tolerance: readonly number[] }>;
  /** Per-package domestication site quality (0..1 of the crop's best ground), packed to land (W10, static). */
  _hearthSiteQuality: readonly Float64Array[];
  /** Per-package wild-stand richness (0..1) and the persons/km² the stand feeds, packed to land (W8, static). */
  _standRichness: readonly Float64Array[];
  _standCapacity: readonly Float64Array[];
  /** Per cell: the richest stand's richness and capacity (W8, static; the lens and the forager capacity read these). */
  _standBest: Float64Array;
  _standCapacityBest: Float64Array;
  /** Per-package native wild-progenitor ranges, packed to land. */
  _nativeRanges: readonly Uint8Array[];
  /** Per-package list of packed native cells; the hearth law accrues on exactly these. */
  _nativeCells: readonly Int32Array[];
  /** Peopled-basin years accrued per native cell per package (state: saved and hashed). */
  _hearthYears: readonly Float64Array[];
  /** Per native cell per package: the cell has ignited, joined a hearth, or can never (W8; rebuilt on load from the years). */
  _hearthDone: readonly Uint8Array[];
  /** Summed-area tables (width+1)×(height+1) of forager capacity × area (static) and people × area (per pass). */
  _basinCapacitySum: Float64Array;
  _basinPeopleSum: Float64Array;
  /** Wake trigger scratch: per-cell farmer room and free room, their summed-area tables, the best active yield per cell. */
  _basinRoom: Float64Array;
  _basinFree: Float64Array;
  _basinRoomSum: Float64Array;
  _basinFreeSum: Float64Array;
  _bestYield: Float64Array;
  _bestYieldDigest: string;
  /** Rendering state for the timeline (never saved or hashed): first farmed step and package per land cell. */
  _arrivalStep: Int32Array;
  _arrivalPackage: Uint8Array;
  /** Two flows (W6): per source the farmers' outflow, their weight sum and ratio (the foragers' are `_migrationOut`, `_migrationWeight`, `_migrationRatio`). */
  _migrationOutFarmers: Float64Array;
  _migrationFarmerWeight: Float64Array;
  _migrationFarmerRatio: Float64Array;
  /** Per-row farmer hop share for the firing (the forager share is `_migrationShareRow`). */
  _migrationFarmerShareRow: Float64Array;
  /** Per cell: whether foragers, and whether the farmers of any active package, could enter it this firing. */
  _roomForagers: Uint8Array;
  _roomFarmers: Uint8Array;
  /** Per-band farmer outflow and per-group received sums (the forager out is `_migrationByBand`). */
  _migrationFarmerByBand: Float64Array;
  _migrationFarmerReceivedByBand: Float64Array;
  /** Per source slot, two weights (forager, farmer) = conductance × room, written in the source phase and read back through the reverse slot; per source out ÷ weight; per source cohort fractions. */
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
  /** Per-slot climb of a land step, elevation units (W24); 0 on a hop. */
  _neighborAscent: Float64Array;
  /** Per-cell foot days/km for the tick's month (migration conductance numerator). */
  _migrationDaysPerKm: Float64Array;
  /** Lazy per-month days/km caches — climate is periodic, so 12 fills total. */
  _migrationDaysPerKmByMonth: Array<Float64Array | undefined>;
  /** Static water-access and relief multipliers (annual land properties). */
  _waterAccess: Float64Array;
  /** The water each cell takes from what drains onto it (W13, P17): the routed-runoff term of its water access. */
  _runoffAccess: Float64Array;
  /** The water that arrives at each cell from upstream (W14), in the worldgen runoff's units — one unit is a cell's area under one moisture-unit of water; the stream the paddy counts. */
  _runoffInflow: Float64Array;
  /** The land's own water, rain aside (W13): the routed stream, floodplain, river and lake terms of water access — what waters a month it does not rain. */
  _surfaceAccess: Float64Array;
  _reliefMult: Float64Array;
  /** The improvable share of each cell (W28, static): the ground water can be led onto — the surface access — plus what a wet climate improves by drainage and levelling alone. */
  _irrigable: Float64Array;
  /** The yield-variance map (W29, static): the coefficient of variation of each cell's annual harvest, from the rain margin, the season's shape, the winter and the surface-water share. */
  _yieldCv: Float64Array;
  /** The last harvest year's yield multiple per land cell (W29, packed scratch for the lens): 0 where nobody farms, the years passing over an unfarmed cell unread. */
  _yearMul: Float64Array;
  /** The harvest rows (W30, static): each land cell's read of the year as weights over the weather grid, CSR by packed index (`_harvestRowStart` holds land + 1 offsets) — its own sky and its catchment's, blended by the harvest's exposure to each and normalised to unit variance under the smoothing, so the CV map keeps its meaning at every cell. Built once from the substrate; both kernels sum the same row in the same order. */
  _harvestRowStart: Int32Array;
  _harvestRowCell: Int32Array;
  _harvestRowWeight: Float64Array;
  /** Per-band famine deaths of the last harvest firing (W29, oracle scratch), persons. */
  _harvestDeathsByBand: Float64Array;
  /** Static per-cell forager capacity and disease burden (annual-climate properties). */
  _foragerCapacity: Float64Array;
  /** The terrestrial part of the forager capacity (W8): the living a stand's gatherers weigh their stand against. */
  _foragerTerrestrial: Float64Array;
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
