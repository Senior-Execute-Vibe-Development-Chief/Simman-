/* V2 W27 — THE SNOWPACK
 *
 * Owner, on the terrain lens's white: "Our snow coverage per season seems a
 * bit strong? … Do we need different levels of snow?" The white was the
 * month's mean temperature below freezing — real cold, not real snow: a cold
 * desert whitened and a snowy mild coast did not. Snow is a STATE: what fell
 * as snow and has not yet melted. So it is one, built from the two monthly
 * fields the substrate already holds, temperature and rain.
 *
 * Rule (a physical statement, no place in it):
 *   A month's daily mean temperatures spread about its mean (σ =
 *   SNOW_DAILY_TEMPERATURE_SPREAD_C, the positive-degree-day model's). The
 *   share of the month's precipitation that falls as snow is the share of
 *   days under SNOW_RAIN_THRESHOLD_C; the melt the month can take is its
 *   positive degree-days at a melt factor that follows the SUN — the energy
 *   that melts snow is mostly radiation, so a warm day at the winter
 *   solstice melts a third of what the same day melts at the summer one
 *   (SNOW_MELT_FACTOR_MIN_MM to SNOW_MELT_FACTOR_MAX_MM on a sine between
 *   the solstices, the NWS SNOW-17 rule; the southern hemisphere's sun
 *   peaks six months on). The month here is the sun's height, not the clock.
 *   A monthly mean is the middle of its month: the air warms or cools
 *   THROUGH the month toward the next one, so the month is walked in
 *   SNOW_STEPS_PER_MONTH steps with the temperature and the sun read at each
 *   — October's last week is colder than its mean and keeps the snow its
 *   first week would lose; April's last week is warmer and takes it.
 *   The pack carries step to step: fall in, melt out, never below zero.
 *   Within a cell the peak pack is not one depth but a spread of them
 *   (lognormal, CV = SNOW_SUBGRID_CV: drifts and hollows, lee and windward),
 *   and melt takes the same depth off all of them, so as a cell melts the
 *   thin places go bare first and the cell is white in patches long before
 *   its mean pack is gone — the depletion curve every land model carries.
 *   Fresh snow lies on everything alike, so an accumulating cell is white
 *   wherever its pack clears the bar.
 *   Cycled over the climate's year until it repeats (a seasonal pack melts
 *   out and is periodic within a cycle or two); a pack still growing after
 *   SNOW_SPINUP_MAX_YEARS is PERENNIAL — an ice cap, a firn field: the
 *   year's snow outlasts the year's warmth.
 *
 * Nothing here reads the calendar: the pack is a function of the monthly
 * climate, and every month of the cycle is derived from the one before it.
 * It is built once with the substrate, like the walks (W26), not persisted.
 */
import {
  DEGC_PER_TEMPERATURE_UNIT,
  MATH_HALF,
  MATH_PI,
  MEAN_DAYS_PER_MONTH,
  MM_PER_CM,
  MONTHS_PER_YEAR,
  RIVER_FREEZING_TEMPERATURE,
  SNOW_DAILY_TEMPERATURE_SPREAD_C,
  SNOW_DEPLETION_BISECTIONS,
  SNOW_DEPLETION_QUANTILE_SPAN,
  SNOW_DEPLETION_STEPS,
  SNOW_FOOTPRINT_MAX_CM,
  SNOW_MELT_FACTOR_MAX_MM,
  SNOW_MELT_FACTOR_MIN_MM,
  SNOW_PACK_DENSITY_KG_M3,
  SNOW_PACK_MAX_MM,
  SNOW_PERIODIC_MM,
  SNOW_RAIN_THRESHOLD_C,
  SNOW_SPINUP_MAX_YEARS,
  SNOW_STEPS_PER_MONTH,
  SNOW_STEP_COST_PER_CM,
  SNOW_SUBGRID_CV,
  SUMMER_SOLSTICE_MONTH,
  WATER_DENSITY_KG_M3,
} from "./constants";
import { dcos, dexp, dln, dnormalCdf, dnormalPdf } from "./dmath";

export interface Snowpack {
  /** Water held as snow at the END of each month, mm, cells × MONTHS_PER_YEAR. */
  readonly endMm: Uint16Array;
  /** The year's largest month-end pack, mm, per cell: what the melt season starts from. */
  readonly peakMm: Uint16Array;
  /** 1 where the pack outgrows the year — it never melts out. */
  readonly perennial: Uint8Array;
}

/** No snow anywhere: a preset with no rain in mm, or a fixture. */
export function emptySnowpack(cells: number): Snowpack {
  return {
    endMm: new Uint16Array(cells * MONTHS_PER_YEAR),
    peakMm: new Uint16Array(cells),
    perennial: new Uint8Array(cells),
  };
}

/** Degrees Celsius of a sim temperature. */
export function temperatureC(simUnits: number): number {
  return (simUnits - RIVER_FREEZING_TEMPERATURE) * DEGC_PER_TEMPERATURE_UNIT;
}

/** The mm of a month's precipitation that falls as snow: the share of its
 * days whose mean is under the rain–snow threshold. */
export function monthSnowfallMm(meanC: number, precipitationMm: number): number {
  return precipitationMm * dnormalCdf((SNOW_RAIN_THRESHOLD_C - meanC) / SNOW_DAILY_TEMPERATURE_SPREAD_C);
}

/** The melt a positive degree-day yields at this point of the year, mm of
 * water: the solar cycle between the two solstice values, peaking at the
 * hemisphere's summer solstice. `month` is a month index, 0–11, and
 * `fraction` the point within it (its middle by default). */
export function meltFactorMm(month: number, southern: boolean, fraction = MATH_HALF): number {
  const phase = ((month + fraction - SUMMER_SOLSTICE_MONTH) / MONTHS_PER_YEAR) * 2 * MATH_PI + (southern ? MATH_PI : 0);
  return SNOW_MELT_FACTOR_MIN_MM + (SNOW_MELT_FACTOR_MAX_MM - SNOW_MELT_FACTOR_MIN_MM) * (1 + dcos(phase)) * MATH_HALF;
}

/** The mm of snow a month of this warmth can melt: its positive degree-days
 * — the expectation of max(0, T) over the month's days, T normal about the
 * mean — at the melt factor of this point of the year. */
export function monthMeltPotentialMm(meanC: number, month: number, southern: boolean, fraction = MATH_HALF): number {
  const z = meanC / SNOW_DAILY_TEMPERATURE_SPREAD_C;
  const positiveDegreesPerDay = SNOW_DAILY_TEMPERATURE_SPREAD_C * dnormalPdf(z) + meanC * dnormalCdf(z);
  return meltFactorMm(month, southern, fraction) * MEAN_DAYS_PER_MONTH * Math.max(0, positiveDegreesPerDay);
}

/** The mean temperature at a point within a month, °C: the month's mean at
 * its middle, moving straight toward the neighbouring month's mean on
 * either side of it. */
export function temperatureWithinMonthC(previousC: number, thisC: number, nextC: number, fraction: number): number {
  if (fraction < MATH_HALF) return thisC + (previousC - thisC) * (MATH_HALF - fraction);
  return thisC + (nextC - thisC) * (fraction - MATH_HALF);
}

/**
 * Cycle every land cell's pack over the climate's year until it repeats or
 * is perennial. `temperature` is the monthly climate in sim units and
 * `rainMm` the month's precipitation in mm, both cells × MONTHS_PER_YEAR.
 */
export function buildSnowpack(
  temperature: Float32Array,
  rainMm: Float32Array,
  landMask: Uint8Array,
  width: number,
  height: number,
): Snowpack {
  const cells = width * height;
  const snow = emptySnowpack(cells);
  const steps = MONTHS_PER_YEAR * SNOW_STEPS_PER_MONTH;
  const fall = new Float64Array(steps);
  const melt = new Float64Array(steps);
  const previous = new Float64Array(MONTHS_PER_YEAR);
  const current = new Float64Array(MONTHS_PER_YEAR);
  for (let cell = 0; cell < cells; cell++) {
    if (!landMask[cell]) continue;
    const southern = Math.floor(cell / width) * 2 >= height;
    const base = cell * MONTHS_PER_YEAR;
    let anySnow = false;
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      const before = month === 0 ? MONTHS_PER_YEAR - 1 : month - 1;
      const after = month === MONTHS_PER_YEAR - 1 ? 0 : month + 1;
      const previousC = temperatureC(temperature[base + before] ?? 0);
      const thisC = temperatureC(temperature[base + month] ?? 0);
      const nextC = temperatureC(temperature[base + after] ?? 0);
      const stepRainMm = Math.max(0, rainMm[base + month] ?? 0) / SNOW_STEPS_PER_MONTH;
      for (let k = 0; k < SNOW_STEPS_PER_MONTH; k++) {
        const fraction = (k + MATH_HALF) / SNOW_STEPS_PER_MONTH;
        const meanC = temperatureWithinMonthC(previousC, thisC, nextC, fraction);
        const step = month * SNOW_STEPS_PER_MONTH + k;
        fall[step] = monthSnowfallMm(meanC, stepRainMm);
        melt[step] = monthMeltPotentialMm(meanC, month, southern, fraction) / SNOW_STEPS_PER_MONTH;
        if (fall[step]! > 0) anySnow = true;
      }
    }
    if (!anySnow) continue;
    previous.fill(0);
    let pack = 0;
    let periodic = false;
    let growing = false;
    for (let year = 0; year < SNOW_SPINUP_MAX_YEARS && !periodic; year++) {
      let largestChange = 0;
      for (let month = 0; month < MONTHS_PER_YEAR; month++) {
        for (let k = 0; k < SNOW_STEPS_PER_MONTH; k++) {
          const step = month * SNOW_STEPS_PER_MONTH + k;
          pack = Math.max(0, pack + fall[step]! - melt[step]!);
        }
        current[month] = pack;
        largestChange = Math.max(largestChange, Math.abs(pack - previous[month]!));
      }
      periodic = largestChange < SNOW_PERIODIC_MM;
      growing = current[MONTHS_PER_YEAR - 1]! > previous[MONTHS_PER_YEAR - 1]!;
      previous.set(current);
    }
    if (!periodic && growing) snow.perennial[cell] = 1;
    let peak = 0;
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      const stored = Math.min(SNOW_PACK_MAX_MM, Math.round(current[month]!));
      snow.endMm[cell * MONTHS_PER_YEAR + month] = stored;
      peak = Math.max(peak, stored);
    }
    snow.peakMm[cell] = peak;
  }
  return snow;
}

/** The month's mean pack, mm of water: the mean of what the cell held
 * entering the month and leaving it. `month` is a month index, 0–11. */
export function snowMeanMm(snow: Snowpack, cell: number, month: number): number {
  const base = cell * MONTHS_PER_YEAR;
  const before = month === 0 ? MONTHS_PER_YEAR - 1 : month - 1;
  return ((snow.endMm[base + before] ?? 0) + (snow.endMm[base + month] ?? 0)) * MATH_HALF;
}

let depletionTable: Float64Array | null = null;

/** The covered share of a cell as a function of the share r of its peak
 * pack that remains, solved once: with the peak lognormal about its mean
 * (σ² = ln(1 + CV²)) and melt taking the same depth everywhere, the
 * remaining mean share when the melt has reached the quantile t is
 * r(t) = Φ(t + σ) − exp(−σt − σ²/2)·Φ(t), and the share still under snow
 * is Φ(t). Bisected per table entry. */
function depletion(): Float64Array {
  if (depletionTable) return depletionTable;
  const sigma = Math.sqrt(dln(1 + SNOW_SUBGRID_CV * SNOW_SUBGRID_CV));
  const table = new Float64Array(SNOW_DEPLETION_STEPS + 1);
  for (let step = 0; step <= SNOW_DEPLETION_STEPS; step++) {
    const remaining = step / SNOW_DEPLETION_STEPS;
    let low = -SNOW_DEPLETION_QUANTILE_SPAN;
    let high = SNOW_DEPLETION_QUANTILE_SPAN;
    for (let k = 0; k < SNOW_DEPLETION_BISECTIONS; k++) {
      const t = (low + high) * MATH_HALF;
      const share = dnormalCdf(t + sigma) - dexp(-sigma * t - sigma * sigma * MATH_HALF) * dnormalCdf(t);
      if (share < remaining) low = t;
      else high = t;
    }
    table[step] = dnormalCdf((low + high) * MATH_HALF);
  }
  table[0] = 0;
  table[SNOW_DEPLETION_STEPS] = 1;
  depletionTable = table;
  return table;
}

/** The share of a cell under snow when `packMm` of a `peakMm` season
 * remains, to a chart that counts a pack above `barMm`. */
export function snowCoveredArea(peakMm: number, packMm: number, barMm: number): number {
  if (packMm < barMm || packMm <= 0 || peakMm <= 0) return 0;
  const remaining = Math.min(1, packMm / peakMm);
  return depletion()[Math.round(remaining * SNOW_DEPLETION_STEPS)] ?? 0;
}

/** The share of the month a cell stands snow-covered to a chart that
 * counts a pack above `barMm`, the pack moving linearly between the month's
 * two ends. Accumulating, fresh snow covers the cell wherever the pack
 * clears the bar, so a cell that whitens mid-month counts for the part of
 * the month it was white; melting, the cell goes bare in patches along the
 * depletion curve, integrated over the month. */
export function snowCoverShare(snow: Snowpack, cell: number, month: number, barMm: number): number {
  const base = cell * MONTHS_PER_YEAR;
  const before = month === 0 ? MONTHS_PER_YEAR - 1 : month - 1;
  const start = snow.endMm[base + before] ?? 0;
  const end = snow.endMm[base + month] ?? 0;
  if (end >= start) {
    const startCovered = start >= barMm;
    const endCovered = end >= barMm;
    if (startCovered && endCovered) return 1;
    if (!endCovered) return 0;
    return (end - barMm) / (end - start);
  }
  const peak = snow.peakMm[cell] ?? 0;
  const atStart = snowCoveredArea(peak, start, barMm);
  const atEnd = snowCoveredArea(peak, end, barMm);
  const atMiddle = snowCoveredArea(peak, (start + end) * MATH_HALF, barMm);
  return ((atStart + atEnd) * MATH_HALF + atMiddle) * MATH_HALF;
}

/** The share of a cell under snow at mid-month: all of it while the pack
 * grows, the depletion curve's share while it melts. */
export function snowCoveredAreaMid(snow: Snowpack, cell: number, month: number): number {
  const base = cell * MONTHS_PER_YEAR;
  const before = month === 0 ? MONTHS_PER_YEAR - 1 : month - 1;
  const start = snow.endMm[base + before] ?? 0;
  const end = snow.endMm[base + month] ?? 0;
  const mean = (start + end) * MATH_HALF;
  if (mean <= 0) return 0;
  if (end >= start) return 1;
  return snowCoveredArea(snow.peakMm[cell] ?? 0, mean, 0);
}

/** Settled depth, cm, of a pack holding this much water. */
export function snowDepthCm(waterMm: number): number {
  return (waterMm * WATER_DENSITY_KG_M3) / SNOW_PACK_DENSITY_KG_M3 / MM_PER_CM;
}

/** How much longer a land step takes through this month's snow: the
 * footprint-depth term of the walking-energy terrain coefficient, the
 * footprint sinking the settled depth up to the deepest the coefficient was
 * measured over. One where no snow lies. */
export function snowStepFactor(snow: Snowpack, cell: number, month: number): number {
  const depth = snowDepthCm(snowMeanMm(snow, cell, month));
  return 1 + SNOW_STEP_COST_PER_CM * Math.min(depth, SNOW_FOOTPRINT_MAX_CM);
}
