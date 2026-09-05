import {
  MONTHS_PER_YEAR,
  MATH_NEGATIVE_ONE,
  PEOPLE_FARM_CAPACITY_PER_KM2,
  PEOPLE_FARM_TECHNIQUE_BASE,
  PEOPLE_FARM_TECHNIQUE_GAIN,
  PEOPLE_TECHNIQUE_CLIMATE_FLOOR,
  PEOPLE_WATER_ACCESS_GAIN,
  PEOPLE_WILD_STAND_SHARE,
} from "../constants";
import { CROP_PACKAGES, pkgMoistureBell, pkgTemperatureBell } from "../../ported/worldgen/cropPackages.js";
import { occurrenceTaxaOf } from "../../ported/worldgen/cropOccurrenceData.js";
import { deriveWildRange, fitWildEnvelope } from "./wildRange";
import { dpow } from "../dmath";
import type { PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The farmed capacity of package p in a cell: persons per km² the land
 * supports when farmed with p. It does not depend on how many farmers are
 * there now — the first family to arrive grows toward the same land as the
 * last. (Review, M3a: scaling it by the farmer share made every founding
 * group's advantage negative, so arrivals reverted and the wave could only
 * cross a cell by out-migrating its own reversion.) The technique regime,
 * base + gain × farmed share, is the state-keyed maturity term M2 already
 * carried: a cell where most people farm has cleared, worked land.
 */
export function packageCapacity(world: PeopleWorld, cell: number, packageIndex: number): number {
  return packageCapacityAt(world, cell, packageIndex, clamp01(world.technique[cell] ?? 0));
}

/**
 * The farmed capacity of a package at a GIVEN technique regime, so a caller
 * before the technique field exists (the stand law at initialization) can
 * ask what a first cultivator would get here.
 */
export function packageCapacityAt(world: PeopleWorld, cell: number, packageIndex: number, technique: number): number {
  const pkg = CROP_PACKAGES[packageIndex];
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  if (!pkg || packed < 0) return 0;
  if ((world._canGrow[packageIndex]?.[packed] ?? 0) === 0) return 0;
  const fertility = clamp01(world.substrate.fertility[cell] ?? 0);
  const access = world._waterAccess[cell] ?? 0;
  // The climate bell gates can-grow and (W8) grades the harvest: a
  // package's capacity in a cell scales with how well the cell suits it.
  return fertility
    * PEOPLE_FARM_CAPACITY_PER_KM2
    * (pkg.yield ?? 1)
    * (world._cropFit[packageIndex]?.[packed] ?? 0)
    * (PEOPLE_FARM_TECHNIQUE_BASE + PEOPLE_FARM_TECHNIQUE_GAIN * technique)
    * (1 + access * PEOPLE_WATER_ACCESS_GAIN)
    * (world._reliefMult[cell] ?? 0);
}

/**
 * Persons per km² a cell's wild stand of a package feeds (W8): the density
 * a dense stand held its gatherers at, graded by the stand's richness — the
 * wild-habitat bell on the cell's annual climate inside the range polygon.
 * Static; built once with the crop fields.
 */
export function standCapacity(world: PeopleWorld, cell: number, packageIndex: number): number {
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  if (packed < 0) return 0;
  return world._standCapacity[packageIndex]?.[packed] ?? 0;
}

/**
 * Build the climate, range and stand fields once at initialization (W9).
 *
 * A package's range is DERIVED, not drawn: its climate envelope is fitted to
 * the cells its wild progenitors were actually observed in (GBIF, baked to
 * `crop-occurrences.json`), on a seasonal signature that can tell winter-wet
 * country from monsoon country, and the range is the land connected to those
 * observations through cells that clear the envelope's stated floor. The
 * shape is therefore a prediction against the published range maps rather
 * than a tracing of them, and the only datum is which landmass each lineage
 * is native to.
 * The monthly test is intentionally local: a crop can be admissible in an
 * annual climate bell yet fail because the growing season is too short.
 * The native cells of each package are listed once; the hearth law accrues
 * peopled-basin years on exactly that list.
 */
export function initializeCropFields(world: PeopleWorld): void {
  const landCount = world._landCells.length;
  const bells = new Float64Array(landCount);
  const envelopes: Array<{ readonly taxon: string; readonly cells: number; readonly centre: readonly number[]; readonly tolerance: readonly number[] }> = [];
  const nativeRanges: Uint8Array[] = [];
  const nativeCells: Int32Array[] = [];
  const canGrow: Uint8Array[] = [];
  const fits: Float64Array[] = [];
  const richness: Float64Array[] = [];
  world._standBest.fill(0);
  world._standCapacityBest.fill(0);
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    const pkg = CROP_PACKAGES[packageIndex];
    // One envelope PER MEMBER of the founder set, and the package is rich
    // where its members CO-OCCUR (W10). A package's range is the union of
    // its members' ranges — the ground any of them holds — but its stand
    // richness is the members' MEAN bell, counting an absent member as
    // zero, so ground that carries one member of three is thin and ground
    // that carries all three is rich. This is the founder-package concept
    // (Zohary & Hopf: the Crescent is where the whole set occurs together)
    // and it is the correction for per-species survey effort, because an
    // intersection cannot be inflated by one over-collected member. Fitting
    // one envelope to the merged cloud instead put wheat's richest ground
    // in western Anatolia, which has wild einkorn but no wild emmer, and
    // millet's on the Kazakh steppe, which has green foxtail but no wild
    // broomcorn millet.
    const taxa = occurrenceTaxaOf(pkg.id, world.width, world.height)
      .map((taxon: { name: string; cells: Array<{ cell: number; records: number }> }) => ({
        name: taxon.name,
        cells: taxon.cells.filter((occurrence) => world.substrate.landMask[occurrence.cell] === 1),
      }))
      .filter((taxon: { cells: unknown[] }) => taxon.cells.length > 0);
    const source = new Uint8Array(landCount);
    bells.fill(taxa.length > 0 ? 1 : 0);
    const memberBells = new Float64Array(landCount);
    const memberRange = new Uint8Array(landCount);
    for (const taxon of taxa) {
      const envelope = fitWildEnvelope(world, taxon.cells);
      envelopes.push({ taxon: taxon.name, cells: envelope.cells, centre: [...envelope.centre], tolerance: [...envelope.tolerance] });
      memberRange.set(deriveWildRange(world, taxon.cells, envelope, memberBells));
      for (let packed = 0; packed < landCount; packed++) {
        // Co-occurrence is a PRODUCT, not an average: the founder set is
        // rich only where every member is present, so ground carrying one
        // member of three is not a third as good, it is no package at all.
        bells[packed] = (bells[packed] ?? 0) * (memberRange[packed] === 1 ? (memberBells[packed] ?? 0) : 0);
        if (memberRange[packed] === 1) source[packed] = 1;
      }
    }
    if (taxa.length > 1) {
      const root = 1 / taxa.length;
      for (let packed = 0; packed < landCount; packed++) {
        bells[packed] = (bells[packed] ?? 0) > 0 ? dpow(bells[packed] ?? 0, root) : 0;
      }
    }
    const native = new Uint8Array(landCount);
    const grow = new Uint8Array(landCount);
    const fit = new Float64Array(landCount);
    const stand = new Float64Array(landCount);
    const listed: number[] = [];
    for (let packed = 0; packed < landCount; packed++) {
      const cell = world._landCells[packed] ?? 0;
      native[packed] = source[packed] ?? 0;
      if (native[packed] === 1) listed.push(packed);
      let season = 0;
      let fitSum = 0;
      const access = world._waterAccess[cell] ?? 0;
      const surface = world._surfaceAccess[cell] ?? 0;
      for (let month = 0; month < MONTHS_PER_YEAR; month++) {
        const climateIndex = cell * MONTHS_PER_YEAR + month;
        const temperature = world.substrate.climate.temperature[climateIndex] ?? 0;
        const moisture = world.substrate.climate.moisture[climateIndex] ?? 0;
        const warmth = pkgTemperatureBell(pkg, temperature);
        // A month counts when it is warm enough and there is water in it:
        // the month's rain, or the water the land holds when it does not
        // rain — the floodplain, the river, the lake, the routed stream
        // (W13). Until W13 the month was admitted on rain alone, so the
        // Nile's winter, warm enough and watered, did not count toward
        // wheat's season. The year's rain is not water in a dry month, so
        // it does not admit one.
        if (temperature >= (pkg.baseTemperature ?? pkg.tOpt - pkg.tTol)
          && warmth * Math.max(pkgMoistureBell(pkg, moisture), surface) >= PEOPLE_TECHNIQUE_CLIMATE_FLOOR) {
          season++;
          // The fit (W8): the crop's warmth term times its water term, where
          // the water is met by rain or by the water the land gives access to
          // — a floodplain grows wheat in a desert.
          fitSum += warmth * Math.max(pkgMoistureBell(pkg, moisture), access);
        }
      }
      grow[packed] = season >= (pkg.seasonMinimumMonths ?? 1) ? 1 : 0;
      // Over the YEAR, not over the qualifying months (W10): a crop's yield
      // is the total favourable growing time, so eight good months feed more
      // than five. Averaging over qualifying months alone scored a short
      // Siberian summer as highly as a long Chinese one, which is what kept
      // millet's best ground on the west Siberian plain.
      fit[packed] = grow[packed] === 1 ? fitSum / MONTHS_PER_YEAR : 0;
      // Stand richness (W9): inside the derived range, where the crop can
      // grow, the fitted envelope graded by the habitat that varies at belt
      // scale — the soil and the terrain. A belt then has a core and edges
      // rather than a saturated interior, and its cells cross the
      // domestication lag over centuries rather than together (W8 finding).
      if (native[packed] === 1 && grow[packed] === 1) {
        // A stand feeds people in proportion to what it yields, and a stand
        // in a five-month season yields less than one in an eight-month
        // season. The crop's own fit carries that, so a plant present at the
        // cold margin of its range is a thin stand there — the physics that
        // separates a Levantine hillside from a Siberian one without anyone
        // saying so (W9: green foxtail's Siberian records otherwise lit
        // fifteen hearths across the taiga).
        stand[packed] = (bells[packed] ?? 0)
          * (fit[packed] ?? 0)
          * clamp01(world.substrate.fertility[cell] ?? 0)
          * (world._reliefMult[cell] ?? 0);
      }
    }
    nativeRanges.push(native);
    nativeCells.push(Int32Array.from(listed));
    canGrow.push(grow);
    fits.push(fit);
    richness.push(stand);
  }
  world._nativeRanges = nativeRanges;
  world._nativeCells = nativeCells;
  world._canGrow = canGrow;
  world._cropFit = fits;
  world._standRichness = richness;
  world._hearthYears = nativeCells.map((cells) => new Float64Array(cells.length));
  world._hearthDone = nativeCells.map((cells) => new Uint8Array(cells.length));
  const standCapacities: Float64Array[] = [];
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    const capacity = new Float64Array(landCount);
    const stand = richness[packageIndex]!;
    for (let packed = 0; packed < landCount; packed++) {
      const cell = world._landCells[packed] ?? 0;
      if ((stand[packed] ?? 0) <= 0) continue;
      // A wild stand is the crop growing on that ground without husbandry
      // (W10): a share of what the same ground yields farmed at first
      // technique, graded by the stand's richness. The flat density it
      // replaces ignored the land entirely, so a cold thin steppe fed as
      // many gatherers as a watered hillside and the hearth law could not
      // tell them apart.
      capacity[packed] = PEOPLE_WILD_STAND_SHARE
        * packageCapacityAt(world, cell, packageIndex, 0)
        * (stand[packed] ?? 0);
      if ((stand[packed] ?? 0) > (world._standBest[cell] ?? 0)) world._standBest[cell] = stand[packed] ?? 0;
      if ((capacity[packed] ?? 0) > (world._standCapacityBest[cell] ?? 0)) world._standCapacityBest[cell] = capacity[packed] ?? 0;
    }
    standCapacities.push(capacity);
  }
  world._standCapacity = standCapacities;
  world._wildEnvelopes = envelopes;
}

/** Derive the compatibility technique cache: the farmed share of each cell. */
export function refreshTechniqueShare(world: PeopleWorld): void {
  for (const cell of world._landCells) {
    const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
    const population = Math.max(0, world.people[cell] ?? 0);
    const farmed = Math.max(0, world._farmerTotal[packed] ?? 0);
    world.technique[cell] = population > 0 ? Math.min(1, farmed / population) : 0;
  }
}

/**
 * The site quality of every cell for domesticating a package (W10), static
 * and built once the stands are in the forager capacity: how good this
 * ground is for taking the crop up, as a share of the best ground the crop
 * has anywhere. Two factors, both absolute, and no constant:
 *
 * - the STAND, the persons/km2 its wild grain already feeds here, so a belt
 *   has a core and edges and a thin stand is worth little;
 * - the PAYOFF, the persons/km2 farming it would ADD over foraging at first
 *   technique — nobody spends centuries domesticating a plant that would
 *   barely improve their living, and a marginal edge of a range is worth
 *   nobody's centuries.
 *
 * Dividing by the package's own maximum is what makes the catalogue lag
 * mean what archaeobotany measured: the duration from cultivation to a
 * farmable staple AT THE CROP'S BEST SITE. A full basin on that site
 * accrues a year per year; everywhere else is slower, in proportion to how
 * much worse the ground is. Without the normalisation each added factor
 * silently multiplied every lag (the first draft ran the Levant at 0.17
 * years per year, so a 900-year lag took 5,300).
 */
export function initializeHearthSiteQuality(world: PeopleWorld): void {
  const landCount = world._landCells.length;
  const quality: Float64Array[] = [];
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    const scores = new Float64Array(landCount);
    const cells = world._nativeCells[packageIndex];
    let best = 0;
    if (cells) {
      for (const packed of cells) {
        const cell = world._landCells[packed] ?? 0;
        const stand = world._standCapacity[packageIndex]?.[packed] ?? 0;
        if (stand <= 0) continue;
        const gain = packageCapacityAt(world, cell, packageIndex, 0) - (world._foragerCapacity[cell] ?? 0);
        if (gain <= 0) continue;
        // Both factors ABSOLUTE: the food the stand gives its gatherers, and
        // the food farming it would add. A share of either rewards poor
        // land, which is what put hearths on the Siberian steppe.
        const score = stand * gain;
        scores[packed] = score;
        if (score > best) best = score;
      }
      if (best > 0) for (let packed = 0; packed < landCount; packed++) scores[packed] = (scores[packed] ?? 0) / best;
    }
    quality.push(scores);
  }
  world._hearthSiteQuality = quality;
}

export function activePackageIndices(world: PeopleWorld): number[] {
  const result: number[] = [];
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    if (world._activePackage[packageIndex] === 1) result.push(packageIndex);
  }
  return result;
}

export function markPackageActive(world: PeopleWorld, packageIndex: number): void {
  if (packageIndex >= 0 && packageIndex < world._activePackage.length) {
    world._activePackage[packageIndex] = 1;
  }
}

/**
 * The dominant package of a cell: the largest farmer mass among the active
 * packages, index order breaking ties, package 0 where nobody farms. Both
 * kernels compute it with this rule wherever capacity is derived.
 */
export function dominantPackageOf(world: PeopleWorld, packed: number, active: readonly number[]): number {
  let dominant = 0;
  let dominantMass = 0;
  for (const packageIndex of active) {
    const mass = Math.max(0, world.farmers[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0);
    if (mass > dominantMass) {
      dominantMass = mass;
      dominant = packageIndex;
    }
  }
  return dominant;
}

/** The farmer total is the package sum in package order; inactive packages are zero. */
export function rebuildFarmerTotals(world: PeopleWorld): void {
  const active = activePackageIndices(world);
  for (let packed = 0; packed < world._landCells.length; packed++) {
    let total = 0;
    for (const packageIndex of active) {
      total += Math.max(0, world.farmers[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0);
    }
    world._farmerTotal[packed] = total;
  }
}

export function deriveTechniqueFromFarmers(world: PeopleWorld): void {
  const active = activePackageIndices(world);
  for (const cell of world._landCells) {
    const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
    world._dominantPackage[cell] = dominantPackageOf(world, packed, active);
  }
  rebuildFarmerTotals(world);
  refreshTechniqueShare(world);
}

export function foragerDensity(world: PeopleWorld, cell: number): number {
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  return packed >= 0
    ? Math.max(0, (world.people[cell] ?? 0) - (world._farmerTotal[packed] ?? 0))
    : Math.max(0, world.people[cell] ?? 0);
}
