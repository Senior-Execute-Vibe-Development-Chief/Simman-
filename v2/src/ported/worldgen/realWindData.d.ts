export function provideRealWindData(data: unknown): void;
export function isRealWindAvailable(): boolean;
export function sampleRealWind(
  x: number,
  y: number,
  width: number,
  height: number,
  month?: number,
): { u: number; v: number };
export function sampleMonthlyWind(
  width: number,
  height: number,
): { u: Float32Array; v: Float32Array } | null;
export function fillRealWind(
  width: number,
  height: number,
  windX: Float32Array,
  windY: Float32Array,
  month?: number,
  scale?: number,
): void;
