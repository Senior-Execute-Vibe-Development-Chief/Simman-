export function provideRealClimateData(precipitation: unknown, airTemperature: unknown): void;
export function isRealClimateAvailable(): boolean;
export function sampleMonthlyClimate(
  width: number,
  height: number,
): { tempC: Float32Array; precipRatio: Float32Array } | null;
export function fillRealClimate(
  width: number,
  height: number,
  elevation: Float32Array,
  moisture: Float32Array,
  temperature: Float32Array,
  dryFraction: Float32Array,
  summerDry: Float32Array,
  temperatureAmplitude: Float32Array,
  warmRainFraction: Float32Array,
  options?: { orographicRain?: boolean },
): boolean;
/** W14 (P18): the half-width in map cells of the footprint the coarse rain is redistributed within — the widest odd box inside one table cell; 0 at the reference grid, 4 at the 1800-wide target grid, 2 at the app's 960-wide Half grid. */
export function orographicFootprintRadius(width: number): number;
/** W14 (P18): each land pixel's share of its footprint's rain, a land-mean-of-one weight exp(g·Δz); one everywhere at radius 0 and on the sea. */
export function orographicShare(
  width: number,
  height: number,
  elevation: Float32Array,
  radius: number,
  share?: Float32Array,
): Float32Array;
