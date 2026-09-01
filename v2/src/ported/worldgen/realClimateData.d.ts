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
): void;
