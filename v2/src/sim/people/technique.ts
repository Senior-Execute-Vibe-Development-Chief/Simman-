import {
  EARTH_CIRCUMFERENCE_KM,
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_ADOPTION_RATE_PER_YEAR,
  PEOPLE_CAPACITY_FLOOR_PER_KM2,
  PEOPLE_FARM_CAPACITY_PER_KM2,
  PEOPLE_HEARTH_BASIN_RADIUS_KM,
  PEOPLE_HEARTH_SEED_FRACTION,
  PEOPLE_TECHNIQUE_PRESENT,
} from "../constants";
import { migrationEdgeLengths } from "../travel/cost";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
import {
  activePackageIndices,
  deriveTechniqueFromFarmers,
  foragerDensity,
  markPackageActive,
  packageCapacity,
  standCapacity,
} from "./crop";
import type { HearthState, PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The hearth a crossing cell belongs to (W8): an ignited hearth of the same
 * package within the basin radius, else none. A hearth is a region — the
 * cells of a range that cross the lag inside one basin — and how many
 * regions a belt has is a measurement, not a spacing.
 */
function hearthWithinBasin(world: PeopleWorld, candidate: number, hearths: readonly HearthState[], radius: number): HearthState | undefined {
  const candidateY = Math.floor(candidate / world.width);
  const candidateX = candidate - candidateY * world.width;
  for (const hearth of hearths) {
    const otherY = Math.floor(hearth.cell / world.width);
    const otherX = hearth.cell - otherY * world.width;
    const rawDx = Math.abs(candidateX - otherX);
    const dx = Math.min(rawDx, world.width - rawDx);
    const dy = Math.abs(candidateY - otherY);
    if (dx <= radius && dy <= radius) return hearth;
  }
  return undefined;
}

export function basinRadiusCells(world: PeopleWorld): number {
  return Math.max(
    1,
    Math.round(PEOPLE_HEARTH_BASIN_RADIUS_KM / (EARTH_CIRCUMFERENCE_KM / world.width)),
  );
}

/**
 * Summed-area table of value × cell area over the full grid, (width+1) ×
 * (height+1) so a window sum is four reads. Basins are square windows of
 * the basin radius; the table does not wrap at the dateline, and no native
 * range sits within a basin radius of it.
 */
export function fillSummedArea(world: PeopleWorld, values: ArrayLike<number>, out: Float64Array): void {
  const width = world.width;
  const stride = width + 1;
  out.fill(0, 0, stride);
  for (let y = 0; y < world.height; y++) {
    let rowSum = 0;
    const rowBase = (y + 1) * stride;
    out[rowBase] = 0;
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      rowSum += (values[cell] ?? 0) * (world.cellAreaKm2[cell] ?? 0);
      out[rowBase + x + 1] = (out[rowBase - stride + x + 1] ?? 0) + rowSum;
    }
  }
}

export function windowSum(world: PeopleWorld, table: Float64Array, cell: number, radius: number): number {
  const width = world.width;
  const stride = width + 1;
  const y = Math.floor(cell / width);
  const x = cell - y * width;
  const x0 = Math.max(0, x - radius);
  const x1 = Math.min(width - 1, x + radius) + 1;
  const y0 = Math.max(0, y - radius);
  const y1 = Math.min(world.height - 1, y + radius) + 1;
  return (table[y1 * stride + x1] ?? 0)
    - (table[y0 * stride + x1] ?? 0)
    - (table[y1 * stride + x0] ?? 0)
    + (table[y0 * stride + x0] ?? 0);
}

/**
 * Peopled-basin fill: people in the basin against the basin's STATIC forager
 * capacity — the M2 law, unchanged. Measuring against the live capacity
 * stalled every hearth the moment a neighbouring wave lifted the basin to
 * farmed capacity (M2 finding); measuring against a global density bar
 * clamped every peopled basin to "full" from the opening tick (M3a review),
 * which reduced the maturity law to the catalogue lag alone.
 */
function basinFill(world: PeopleWorld, cell: number, radius: number): number {
  const capacity = windowSum(world, world._basinCapacitySum, cell, radius);
  if (capacity <= 0) return 0;
  return clamp01(windowSum(world, world._basinPeopleSum, cell, radius) / capacity);
}

function packageIndexOf(packageId: string): number {
  for (let index = 0; index < CROP_PACKAGES.length; index++) {
    if (CROP_PACKAGES[index]?.id === packageId) return index;
  }
  return MATH_NEGATIVE_ONE;
}

function canGrowAt(world: PeopleWorld, packageIndex: number, cell: number): boolean {
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  return packed >= 0 && (world._canGrow[packageIndex]?.[packed] ?? 0) !== 0;
}

function seedHearth(world: PeopleWorld, hearth: HearthState, cell: number): void {
  const packageIndex = packageIndexOf(hearth.packageId);
  if (packageIndex < 0) return;
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  const farmers = world.farmers[hearth.packageId];
  if (packed < 0 || !farmers || !canGrowAt(world, packageIndex, cell)) return;
  const people = Math.max(0, world.people[cell] ?? 0);
  const current = Math.max(0, farmers[packed] ?? 0);
  const available = foragerDensity(world, cell);
  const amount = Math.min(available, Math.max(0, people * PEOPLE_HEARTH_SEED_FRACTION - current));
  farmers[packed] = current + amount;
  world._farmerTotal[packed] += amount;
  markPackageActive(world, packageIndex);
}

/**
 * The rate at which a native cell's people domesticate the stand they live
 * on. Four factors, each a share, and no constant of its own:
 *
 * - the basin's FILL — people against the basin's forager capacity (M2's
 *   peopled-basin law): domestication is the work of a crowded basin;
 * - the stand's SHARE of the living its gatherers could otherwise have from
 *   the land (W8), so a belt has a core and edges. Fishing is not the
 *   alternative to a stand but its companion (the Natufian gazelle, the
 *   Yangtze fish), so it is not in the denominator;
 * - the SITE QUALITY (W10, `initializeHearthSiteQuality`): what the stand
 *   already feeds here times what farming it would add, as a share of the
 *   crop's best ground anywhere. Both factors are ABSOLUTE densities: every
 *   relative form rewards poor land, measurably so — dividing the payoff by
 *   the forager yield put the Levant 1,300 years late behind an Anatolian
 *   plateau hearth, and a stand priced as a share of the terrestrial living
 *   kept hearths on the west Siberian plain. Where a crop only just beats
 *   foraging the clock effectively never finishes, so a marginal edge of a
 *   range never mints a hearth without anything naming a place;
 * - the PRE-EMPTION, forager yield over the living the cell now has (W7): a
 *   cell farming has reached lives on a capacity many times the forager
 *   yield and its clock all but stops, so arrival pre-empts invention.
 */
export function hearthAccrualRate(world: PeopleWorld, cell: number, fill: number, packageIndex: number): number {
  const forager = world._foragerCapacity[cell] ?? 0;
  if (forager <= 0) return 0;
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  if (packed < 0) return 0;
  const site = world._hearthSiteQuality[packageIndex]?.[packed] ?? 0;
  if (site <= 0) return 0;
  const living = Math.max(PEOPLE_CAPACITY_FLOOR_PER_KM2, world.capField[cell] ?? 0);
  return fill * site * Math.min(1, forager / living);
}

/**
 * Hearths condense. Every cell of a package's native range where the crop
 * can grow accrues years at `hearthAccrualRate`; the first cells to reach
 * the package's domestication lag ignite, and a cell within the separation
 * bar of an ignited hearth of the same package is the same hearth. No
 * search window, no score, no pin: which range ignites first, and where on
 * it, is the population history of that range. The range itself is data:
 * the dense-stand habitat of the wild progenitor (`crop-ranges.json`, W7),
 * not the crop's whole climate envelope.
 */
function updateHearths(world: PeopleWorld, dtMonths: number): void {
  const dtYears = dtMonths / MONTHS_PER_YEAR;
  const radius = basinRadiusCells(world);
  fillSummedArea(world, world.people, world._basinPeopleSum);
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    const pkg = CROP_PACKAGES[packageIndex];
    const cells = world._nativeCells[packageIndex];
    const years = world._hearthYears[packageIndex];
    const done = world._hearthDone[packageIndex];
    const canGrow = world._canGrow[packageIndex];
    if (!pkg || !cells || !years || !done || !canGrow) continue;
    const ignited = world.hearths.filter((hearth) => hearth.ignited && hearth.packageId === pkg.id);
    for (let index = 0; index < cells.length; index++) {
      const packed = cells[index] ?? MATH_NEGATIVE_ONE;
      if (packed < 0 || canGrow[packed] !== 1 || done[index] === 1) continue;
      const cell = world._landCells[packed] ?? 0;
      let accrued = years[index] ?? 0;
      let fill = 0;
      if (accrued < pkg.domLagY) {
        fill = basinFill(world, cell, radius);
        if (fill <= 0) continue;
        accrued += hearthAccrualRate(world, cell, fill, packageIndex) * dtYears;
        years[index] = accrued;
        if (accrued < pkg.domLagY) continue;
      }
      if ((world.people[cell] ?? 0) <= 0) continue;
      // Nobody domesticates a crop that yields less than the land they
      // stand on (W8): a marginal pocket the spread never entered keeps its
      // clock, but ignites only where the package beats foraging — and the
      // capacities are static, so a pocket that fails never will.
      if (packageCapacity(world, cell, packageIndex) <= (world._foragerCapacity[cell] ?? 0)) {
        done[index] = 1;
        continue;
      }
      done[index] = 1;
      const within = hearthWithinBasin(world, cell, ignited, radius);
      if (within) {
        within.regionCells += 1;
        seedHearth(world, within, cell);
        continue;
      }
      const hearth: HearthState = {
        id: `hearth-${pkg.id}-${cell}`,
        cell,
        packageId: pkg.id,
        lagYears: pkg.domLagY,
        score: fill,
        armedYears: accrued,
        ignited: true,
        ignitedStep: world.step,
        regionCells: 1,
      };
      world.hearths.push(hearth);
      world.events.push({ step: world.step, kind: "hearth", cell, packageId: pkg.id });
      ignited.push(hearth);
      seedHearth(world, hearth, cell);
    }
  }
}

/**
 * Farming is a label carried by people. The annual conversion pass moves
 * labels only: foragers living among farmers adopt their package where it
 * out-yields foraging, and farmers whose package cannot feed them revert.
 * Contact is LOCAL — the farmer share of the cell — so a cell converts at a
 * rate, never at a distance: a neighbour-stencil contact term moves the
 * front one cell per conversion interval and its speed is the grid spacing
 * (review, M3a; the third cardinal rule). Spread is the farmers moving.
 * The advantage saturates, adv/(1+adv): a package ten times better than
 * foraging is adopted at the rate, not ten times faster than one twice as
 * good.
 */
export function convertFarmers(world: PeopleWorld, dtMonths = MONTHS_PER_YEAR): void {
  updateHearths(world, dtMonths);
  const dtYears = dtMonths / MONTHS_PER_YEAR;
  const active = activePackageIndices(world);
  if (active.length > 0) {
    const capacities = new Float64Array(CROP_PACKAGES.length);
    const presents = new Float64Array(CROP_PACKAGES.length);
    for (let packed = 0; packed < world._landCells.length; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const population = Math.max(0, world.people[cell] ?? 0);
      if (population <= 0) continue;
      const foragerCapacity = world._foragerCapacity[cell] ?? 0;
      // Adoption under pressure (W8): unpressed foragers do not farm; a full
      // cell adopts at the rate. The pressure is everyone in the cell against
      // the land's FORAGER capacity — the foragers' own living, as W6's room
      // law reads it — never the mixture, which rises the moment farmers
      // appear and would lift the pressure that made them.
      const fill = Math.min(1, population / Math.max(PEOPLE_CAPACITY_FLOOR_PER_KM2, foragerCapacity));
      let available = foragerDensity(world, cell);
      let farmedPackages = 0;
      for (const packageIndex of active) {
        const pkg = CROP_PACKAGES[packageIndex];
        const farmer = pkg ? world.farmers[pkg.id] : undefined;
        if (!farmer) continue;
        const present = Math.max(0, farmer[packed] ?? 0);
        const farmCapacity = packageCapacity(world, cell, packageIndex);
        capacities[packageIndex] = farmCapacity;
        presents[packageIndex] = present;
        if (present > 0) farmedPackages++;
        const advantage = foragerCapacity > 0
          ? (farmCapacity - foragerCapacity) / foragerCapacity
          : 0;
        if (advantage > 0) {
          if (available <= 0 || present <= 0) continue;
          const contact = Math.min(1, present / population);
          const amount = Math.min(
            available,
            available * PEOPLE_ADOPTION_RATE_PER_YEAR * dtYears * contact * (advantage / (1 + advantage)) * fill,
          );
          farmer[packed] = present + amount;
          world._farmerTotal[packed] += amount;
          available -= amount;
        } else if (advantage < 0 && present > 0) {
          const amount = Math.min(
            present,
            present * PEOPLE_ADOPTION_RATE_PER_YEAR * dtYears * Math.min(1, -advantage),
          );
          farmer[packed] = Math.max(0, present - amount);
          world._farmerTotal[packed] = Math.max(0, (world._farmerTotal[packed] ?? 0) - amount);
          available += amount;
        }
      }
      if (farmedPackages >= 2) switchPackages(world, packed, population, active, capacities, presents, dtYears);
    }
  }
  deriveTechniqueFromFarmers(world);
}

/**
 * Farmers switch to a better crop (W8): the law foragers use, between
 * packages. For farmers of A in a cell where B is also farmed and out-yields
 * A, A's farmers take up B at the adoption rate × their contact with B (B's
 * share of the cell) × the saturated relative advantage; several better
 * packages each take their share in proportion. Labels move, people are
 * conserved, and the farmer total is unchanged.
 *
 * Rice takes the south a few centuries after it ARRIVES — measured at the
 * shipped grid (the W15 arm), where south China farms rice at 1 CE. The dev
 * grid still shows millet there, and that is the arrival race, not this
 * switch: at 167 km cells millet's own hearth on the lower Yangtze beats
 * rice's nearest ignition to the ground, and no rice farmer ever reaches the
 * cell for the switch to act on. Where rice does arrive the ranking is not
 * close (rice 0.665 against millet 0.580 in the south-China box), so a
 * failure here is a question about who got there first.
 */
function switchPackages(
  world: PeopleWorld,
  packed: number,
  population: number,
  active: readonly number[],
  capacities: Float64Array,
  presents: Float64Array,
  dtYears: number,
): void {
  const gains = new Float64Array(CROP_PACKAGES.length);
  for (const from of active) {
    const present = presents[from] ?? 0;
    if (present <= 0) continue;
    const own = capacities[from] ?? 0;
    let total = 0;
    gains.fill(0);
    for (const to of active) {
      if (to === from) continue;
      const other = presents[to] ?? 0;
      const better = capacities[to] ?? 0;
      if (other <= 0 || better <= own || own <= 0) continue;
      const advantage = (better - own) / own;
      const gain = Math.min(1, other / population) * (advantage / (1 + advantage));
      gains[to] = gain;
      total += gain;
    }
    if (total <= 0) continue;
    const moved = Math.min(present, present * PEOPLE_ADOPTION_RATE_PER_YEAR * dtYears * total);
    const fromFarmers = world.farmers[CROP_PACKAGES[from]?.id ?? ""];
    if (!fromFarmers) continue;
    fromFarmers[packed] = Math.max(0, (fromFarmers[packed] ?? 0) - moved);
    for (const to of active) {
      const gain = gains[to] ?? 0;
      if (gain <= 0) continue;
      const toFarmers = world.farmers[CROP_PACKAGES[to]?.id ?? ""];
      if (!toFarmers) continue;
      toFarmers[packed] = (toFarmers[packed] ?? 0) + moved * (gain / total);
    }
  }
}

export function prepareTechnique(world: PeopleWorld): void {
  if (world._canGrow.length !== CROP_PACKAGES.length) {
    throw new Error("Crop fields were not initialized before the people pass.");
  }
  const lengths = migrationEdgeLengths(world.substrate);
  world._techniqueEdgeH = lengths.horizontal;
  world._techniqueEdgeV = lengths.vertical;
  fillSummedArea(world, world._foragerCapacity, world._basinCapacitySum);
}

export function initializeTechnique(world: PeopleWorld): void {
  world.technique.fill(0);
  world._techniqueNext.fill(0);
  deriveTechniqueFromFarmers(world);
  world.hearths = [];
  for (const years of world._hearthYears) years.fill(0);
  for (const done of world._hearthDone) done.fill(0);
}

/**
 * Compatibility wrapper: technique is the farmed share, kept current by the
 * commit epilogue after every growth/migration month, so the scheduled
 * pass only reports coverage (a second derivation here cost a full pass
 * over every package per year for no change in state).
 */
export function stepTechnique(world: PeopleWorld, dtMonths = MONTHS_PER_YEAR): number {
  void dtMonths;
  let covered = 0;
  for (const cell of world._landCells) {
    if ((world.technique[cell] ?? 0) >= PEOPLE_TECHNIQUE_PRESENT) covered++;
  }
  return world._landCells.length > 0 ? covered / world._landCells.length : 0;
}
