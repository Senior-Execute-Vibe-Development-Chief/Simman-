export function provideRealWindData(data: unknown): void;
export function isRealWindAvailable(): boolean;
export function fillRealWind(
  width: number,
  height: number,
  windX: Float32Array,
  windY: Float32Array,
  month?: number,
  scale?: number,
): void;
