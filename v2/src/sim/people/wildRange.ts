import {
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_CROP_NEIGHBOR_COUNT,
  WILD_ENVELOPE_QUARTER_MONTHS,
  NORMAL_MAD_TO_SIGMA,
  WILD_ENVELOPE_SIGMA,
  WILD_ENVELOPE_TOLERANCE_FLOOR,
  WILD_RANGE_INTERPOLATION_KM,
} from "../constants";
import { dexp } from "../dmath";
import type { PeopleWorld } from "./types";

/**
 * The seasonal signature of a cell's climate: the warmth of its warmest and
 * coldest quarters and the moisture of its wettest and driest quarters (W9).
 *
 * Annual means erase the one thing that defines wild cereal country — winter
 * rain with summer drought — and so cannot tell the Levant from monsoon Asia
 * or from temperate Europe. Four seasonal axes can, and they vary far more
 * within a belt than annual means do, which is what gives a wild range a
 * core and edges rather than a saturated interior (W8 finding).
 */
export const WILD_AXES = 4;

export function seasonalSignature(world: PeopleWorld, cell: number, out: Float64Array, offset = 0): void {
  const temperature: number[] = [];
  const moisture: number[] = [];
  for (let month = 0; month < MONTHS_PER_YEAR; month++) {
    const index = cell * MONTHS_PER_YEAR + month;
    temperature.push(world.substrate.climate.temperature[index] ?? 0);
    moisture.push(world.substrate.climate.moisture[index] ?? 0);
  }
  temperature.sort((a, b) => a - b);
  moisture.sort((a, b) => a - b);
  const quarter = WILD_ENVELOPE_QUARTER_MONTHS;
  const mean = (values: readonly number[], from: number): number => {
    let total = 0;
    for (let index = from; index < from + quarter; index++) total += values[index] ?? 0;
    return total / quarter;
  };
  out[offset] = mean(temperature, MONTHS_PER_YEAR - quarter);
  out[offset + 1] = mean(temperature, 0);
  out[offset + 2] = mean(moisture, MONTHS_PER_YEAR - quarter);
  out[offset + 3] = mean(moisture, 0);
}

export interface WildEnvelope {
  readonly centre: Float64Array;
  readonly tolerance: Float64Array;
  readonly cells: number;
}

export interface WildOccurrence {
  readonly cell: number;
  readonly records: number;
}

/** The weighted median of `values` under `weights`, and then the weighted median absolute deviation. */
function weightedMedian(values: readonly number[], weights: readonly number[]): number {
  const order = values.map((value, index) => index).sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0));
  let total = 0;
  for (const weight of weights) total += weight;
  let seen = 0;
  for (const index of order) {
    seen += weights[index] ?? 0;
    if (seen >= total / 2) return values[index] ?? 0;
  }
  return values[order[order.length - 1] ?? 0] ?? 0;
}

/**
 * Fit a package's envelope to the climate where its wild progenitors were
 * observed, weighted by how many records each cell holds and measured
 * robustly (weighted median, and the median absolute deviation scaled to a
 * standard deviation by the normal constant 1.4826).
 *
 * Both choices matter and both were measured. An unweighted mean and
 * standard deviation over unique cells counts a single sporadic plant on the
 * Atlantic coast as heavily as a Karacadağ hillside carrying three hundred
 * records, and the resulting envelope admitted Iberia and Scandinavia for
 * wheat: 157 hearths, Portugal lighting before the Levant. Harlan &amp; Zohary's
 * distinction between massive stands and scattered plants is exactly the
 * distinction a record count carries.
 */
export function fitWildEnvelope(world: PeopleWorld, occurrences: readonly WildOccurrence[]): WildEnvelope {
  const centre = new Float64Array(WILD_AXES);
  const tolerance = new Float64Array(WILD_AXES);
  const signature = new Float64Array(WILD_AXES);
  const samples: number[][] = [[], [], [], []];
  const weights: number[] = [];
  for (const occurrence of occurrences) {
    if (!world.substrate.landMask[occurrence.cell]) continue;
    seasonalSignature(world, occurrence.cell, signature);
    for (let axis = 0; axis < WILD_AXES; axis++) samples[axis]!.push(signature[axis] ?? 0);
    weights.push(Math.max(1, occurrence.records));
  }
  if (weights.length === 0) return { centre, tolerance, cells: 0 };
  for (let axis = 0; axis < WILD_AXES; axis++) {
    const values = samples[axis]!;
    const median = weightedMedian(values, weights);
    const deviations = values.map((value) => Math.abs(value - median));
    const spread = weightedMedian(deviations, weights) * NORMAL_MAD_TO_SIGMA;
    centre[axis] = median;
    tolerance[axis] = Math.max(WILD_ENVELOPE_TOLERANCE_FLOOR, spread);
  }
  return { centre, tolerance, cells: weights.length };
}

/** The envelope's value at a cell: the product of its per-axis bells, 0..1. */
export function wildEnvelopeBell(world: PeopleWorld, cell: number, envelope: WildEnvelope, scratch: Float64Array): number {
  if (envelope.cells === 0) return 0;
  seasonalSignature(world, cell, scratch);
  let bell = 1;
  for (let axis = 0; axis < WILD_AXES; axis++) {
    const delta = ((scratch[axis] ?? 0) - (envelope.centre[axis] ?? 0)) / (envelope.tolerance[axis] ?? 1);
    bell *= dexp(-0.5 * delta * delta);
  }
  return bell;
}

/**
 * The floor a cell's envelope value must clear to hold the plant: the value
 * of the bell at `WILD_ENVELOPE_SIGMA` standard deviations on one axis. A
 * statistical convention, stated rather than fitted — the range's extent is
 * then a prediction, checked against the published maps.
 */
export function wildRangeFloor(): number {
  return dexp(-0.5 * WILD_ENVELOPE_SIGMA * WILD_ENVELOPE_SIGMA);
}

/**
 * The range: the land within the interpolation distance of an observed
 * occurrence whose envelope value clears the floor (W9).
 *
 * The observations ARE the range; the envelope only trims the unsuitable
 * ground between records and the distance only fills the gaps a sparse
 * record set leaves. An unbounded fill was measured first and is wrong in
 * kind: suitable ground is continuous across Eurasia, so wheat leaked from
 * Iberia to China and lit 157 hearths, Portugal before the Levant. A plant's
 * real limits are its dispersal history, which no climate field carries —
 * which is exactly why the occurrences are the datum.
 */
export function deriveWildRange(
  world: PeopleWorld,
  occurrences: readonly WildOccurrence[],
  envelope: WildEnvelope,
  bells: Float64Array,
): Uint8Array {
  const landCount = world._landCells.length;
  const range = new Uint8Array(landCount);
  if (envelope.cells === 0) return range;
  const floor = wildRangeFloor();
  const scratch = new Float64Array(WILD_AXES);
  for (let packed = 0; packed < landCount; packed++) {
    bells[packed] = wildEnvelopeBell(world, world._landCells[packed] ?? 0, envelope, scratch);
  }
  const queue: number[] = [];
  const reached = new Float64Array(landCount);
  reached.fill(Number.POSITIVE_INFINITY);
  for (const occurrence of occurrences) {
    const packed = world._packedOf[occurrence.cell] ?? MATH_NEGATIVE_ONE;
    // An occurrence is an observation: the plant is there whatever the
    // envelope says of it, and it seeds the interpolation.
    if (packed < 0 || range[packed] === 1) continue;
    range[packed] = 1;
    reached[packed] = 0;
    queue.push(packed);
  }
  for (let head = 0; head < queue.length; head++) {
    const packed = queue[head] ?? 0;
    const travelled = reached[packed] ?? 0;
    for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
      const slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
      const target = world._neighborTargets[slot] ?? MATH_NEGATIVE_ONE;
      if (target < 0) continue;
      const targetPacked = world._packedOf[target] ?? MATH_NEGATIVE_ONE;
      if (targetPacked < 0) continue;
      const distance = travelled + (world._neighborDistanceKm[slot] ?? 0);
      if (distance > WILD_RANGE_INTERPOLATION_KM || distance >= (reached[targetPacked] ?? 0)) continue;
      if ((bells[targetPacked] ?? 0) < floor) continue;
      reached[targetPacked] = distance;
      range[targetPacked] = 1;
      queue.push(targetPacked);
    }
  }
  return range;
}
