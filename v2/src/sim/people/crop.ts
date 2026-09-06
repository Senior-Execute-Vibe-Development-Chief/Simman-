import {
  MONTHS_PER_YEAR,
  MEAN_DAYS_PER_MONTH,
  MATH_NEGATIVE_ONE,
  PEOPLE_FARM_CAPACITY_PER_KM2,
  PEOPLE_FARM_TECHNIQUE_BASE,
  PEOPLE_FARM_TECHNIQUE_GAIN,
  PEOPLE_TECHNIQUE_CLIMATE_FLOOR,
  PEOPLE_WATER_ACCESS_GAIN,
  PEOPLE_WILD_STAND_SHARE,
} from "../constants";
import { CROP_PACKAGES, pkgMoistureBell, pkgTemperatureBell } from "../../ported/worldgen/cropPackages.js";
import type { CropPackage } from "../../ported/worldgen/cropPackages.js";
import { occurrenceTaxaOf } from "../../ported/worldgen/cropOccurrenceData.js";
import { deriveWildRange, fitWildEnvelope } from "./wildRange";
import { channelStripShare } from "./habitability";
import { dpow } from "../dmath";
import type { PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The cycle a package's crop occupies the ground for, as a count of the
 * climate's months and never more than the year (W17). A crop that stands in
 * the ground for longer than a year — enset, at four to eight of them — is
 * graded by the whole year, which is what a perennial actually experiences,
 * so the clamp is the mechanism rather than an exception for root crops.
 */
function cycleMonthsOf(pkg: CropPackage): number {
  return Math.min((pkg.cycleDays ?? MEAN_DAYS_PER_MONTH) / MEAN_DAYS_PER_MONTH, MONTHS_PER_YEAR);
}

/**
 * A month of the year's ring, for a run that starts late in one year and ends
 * in the next. Neither a start month nor a cycle exceeds the year, so the ring
 * closes with a single subtraction and no modulus is needed.
 */
function wrapMonth(month: number): number {
  return month >= MONTHS_PER_YEAR ? month - MONTHS_PER_YEAR : month;
}

/**
 * The best planting date (W17): the crop occupies the ground for its own
 * cycle, so of the twelve months it could start in, it takes the run that
 * grades highest. Months inside the run that the crop cannot use contribute
 * nothing — a season shorter than the cycle is a crop short of time, and its
 * harvest is short in proportion rather than absent — and a run wraps the
 * turn of the year, because a winter cereal is sown in one year and reaped in
 * the next.
 *
 * Returns the run's fit and paddy-gain sums, both weighted by the share of
 * each month the cycle covers, so that a cycle of 3.94 months counts the
 * fourth month at 0.94 and there is no cliff at a whole number of them.
 *
 * The run is chosen by the whole harvest the worked field yields — its fit
 * and its standing-water gain together — because that is what a planting
 * date is chosen for. A crop that drowns carries no gain at all (W15 keeps
 * only the positive response there), so an upland crop's date is set by fit
 * alone and is untouched by this; a wetland crop is the only kind that moves
 * its date onto the flood, which is what a paddy is. Grading the run by fit
 * alone hid the paddy from the one choice it exists to drive: rice's monthly
 * fit is the same wet or dry, so the flooded months tied with every other and
 * the gain was left outside the run.
 */
function bestCycleWindow(
  monthFit: Float64Array,
  monthGain: Float64Array,
  cycleMonths: number,
): { fit: number; gain: number } {
  const whole = Math.floor(cycleMonths);
  const part = cycleMonths - whole;
  let bestHarvest = 0;
  let bestFit = 0;
  let bestGain = 0;
  for (let start = 0; start < MONTHS_PER_YEAR; start++) {
    let fit = 0;
    let gain = 0;
    for (let offset = 0; offset < whole; offset++) {
      const month = wrapMonth(start + offset);
      fit += monthFit[month] ?? 0;
      gain += monthGain[month] ?? 0;
    }
    if (part > 0) {
      const month = wrapMonth(start + whole);
      fit += (monthFit[month] ?? 0) * part;
      gain += (monthGain[month] ?? 0) * part;
    }
    if (fit + gain > bestHarvest) {
      bestHarvest = fit + gain;
      bestFit = fit;
      bestGain = gain;
    }
  }
  return { fit: bestFit, gain: bestGain };
}

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
  // package's capacity in a cell scales with how well the cell suits it. The
  // paddy on top of it is the standing water a wetland crop GAINS by (W15) —
  // impounded, levelled and held, so it arrives with the husbandry that builds
  // it: none of it at the first cultivator's regime, all of it at the last.
  // The drowning an upland crop suffers is physiology and is already in the
  // fit, at every regime.
  return fertility
    * PEOPLE_FARM_CAPACITY_PER_KM2
    * (pkg.yield ?? 1)
    * (world._cropFit[packageIndex]?.[packed] ?? 0)
    * (1 + technique * (world._standingGain[packageIndex]?.[packed] ?? 0))
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
  const gains: Float64Array[] = [];
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
    const gain = new Float64Array(landCount);
    const stand = new Float64Array(landCount);
    // The twelve monthly grades, kept so the stand and the harvest can read
    // the same year two ways; reused across cells rather than reallocated.
    const monthFit = new Float64Array(MONTHS_PER_YEAR);
    const monthGain = new Float64Array(MONTHS_PER_YEAR);
    const listed: number[] = [];
    for (let packed = 0; packed < landCount; packed++) {
      const cell = world._landCells[packed] ?? 0;
      native[packed] = source[packed] ?? 0;
      if (native[packed] === 1) listed.push(packed);
      let season = 0;
      let fitSum = 0;
      monthFit.fill(0);
      monthGain.fill(0);
      const access = world._waterAccess[cell] ?? 0;
      const surface = world._surfaceAccess[cell] ?? 0;
      // The standing water (W14): the floodplain under the flood, and the
      // strip a stream can keep wet. The flood's presence in a month is the
      // river's discharge above its own year's mean, one mean-flow's worth
      // covering the plain (`seasonalFlowScale` is monthly flow over the
      // static annual flow, so it is read against its own twelve-month
      // mean); the stream's is the water that arrives, in the runoff's
      // units, up to the channel strip — one cell-runoff keeps about one
      // cell-area of paddy under water (Bouman et al. 2007, the order of a
      // wet year's rain). A wetland crop counts both; an upland crop is
      // hurt only by the flood it cannot drain, never by a stream beside
      // it. Rice's advantage on flooded ground is the plant's (W13 finding,
      // QUESTIONS #65), not a weight by place.
      const response = pkg.standingWaterResponse ?? 0;
      const flood = clamp01(world.substrate.floodplain[cell] ?? 0);
      const strip = channelStripShare(world, cell);
      const inflow = world._runoffInflow[cell] ?? 0;
      const flowScale = world.substrate.rivers.seasonalFlowScale;
      let flowMean = 0;
      if (flowScale) {
        for (let month = 0; month < MONTHS_PER_YEAR; month++) flowMean += flowScale[cell * MONTHS_PER_YEAR + month] ?? 0;
        flowMean /= MONTHS_PER_YEAR;
      }
      for (let month = 0; month < MONTHS_PER_YEAR; month++) {
        const climateIndex = cell * MONTHS_PER_YEAR + month;
        const temperature = world.substrate.climate.temperature[climateIndex] ?? 0;
        const moisture = world.substrate.climate.moisture[climateIndex] ?? 0;
        const warmth = pkgTemperatureBell(pkg, temperature);
        const flowRatio = flowScale && flowMean > 0 ? (flowScale[climateIndex] ?? 0) / flowMean : 1;
        const imposed = flood * clamp01(flowRatio - 1);
        const standing = response >= 0
          ? Math.min(1, imposed + Math.min(strip, inflow * flowRatio))
          : imposed;
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
          const base = warmth * Math.max(pkgMoistureBell(pkg, moisture), access);
          // The ground standing under water splits in two (W14, corrected W15).
          // What it TAKES from a crop that cannot drain it is physiology — the
          // roots suffocate whoever is farming — so it is in the fit itself, at
          // every technique regime, and it is in the wild stand too. What it
          // GIVES a wetland crop is husbandry: a paddy is water impounded,
          // levelled and held behind a bund, not a swamp. So the gain is
          // carried apart and paid out with the technique regime, and a wild
          // stand of rice in a marsh is a wild stand rather than a paddy.
          monthFit[month] = base * (1 + Math.min(0, response) * standing);
          monthGain[month] = base * Math.max(0, response) * standing;
          fitSum += monthFit[month] ?? 0;
        }
      }
      grow[packed] = season >= (pkg.seasonMinimumMonths ?? 1) ? 1 : 0;
      // THE FIT SPLITS IN TWO, because its two readers ask opposite questions
      // (W17). Both are the same twelve monthly grades, normalised differently.
      //
      // The WILD STAND is grazed, not reaped: gatherers take from it whenever
      // it is giving, so what feeds them is the total favourable growing time
      // over the YEAR, and eight good months feed more than five. That is
      // W10's finding and it stands — averaging over qualifying months alone
      // scored a short Siberian summer as highly as a long Chinese one, which
      // is what kept millet's best ground on the west Siberian plain.
      const standFit = grow[packed] === 1 ? fitSum / MONTHS_PER_YEAR : 0;
      // A HARVEST is one crop cycle. A farmer sows once and reaps once, so
      // what sets the harvest is how good the months the crop is IN THE GROUND
      // are — the months outside its cycle are not part of it, and counting
      // them rewards a long season over a good one. That is why a five-month
      // Egyptian winter, excellent while it lasts, graded below a Sudanese
      // year that is merely adequate for twelve.
      const window = bestCycleWindow(monthFit, monthGain, cycleMonthsOf(pkg));
      fit[packed] = grow[packed] === 1 ? window.fit / cycleMonthsOf(pkg) : 0;
      // The paddy relative to the fit it multiplies, so that capacity at the
      // full technique regime is exactly the fit the flooded months earn and
      // at the first cultivator's regime is exactly the unwatered one. Over
      // the same run of months as the fit, or the two would not divide out.
      gain[packed] = grow[packed] === 1 && window.fit > 0 ? window.gain / window.fit : 0;
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
          * standFit
          * clamp01(world.substrate.fertility[cell] ?? 0)
          * (world._reliefMult[cell] ?? 0);
      }
    }
    nativeRanges.push(native);
    nativeCells.push(Int32Array.from(listed));
    canGrow.push(grow);
    fits.push(fit);
    gains.push(gain);
    richness.push(stand);
  }
  world._nativeRanges = nativeRanges;
  world._nativeCells = nativeCells;
  world._canGrow = canGrow;
  world._cropFit = fits;
  world._standingGain = gains;
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
