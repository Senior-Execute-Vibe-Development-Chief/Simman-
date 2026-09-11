export const PASS_MIN_PROMINENCE_M: number;
export const PASS_MIN_CLIMB_M: number;
export const PASS_APPROACH_KM: number;
export const PASS_RECORD_BYTES: number;
export const PASS_SOURCE_COLS: number;
export const PASS_SOURCE_ROWS: number;
export const PASS_COUNT: number;
export const PASS_DATA: string;
export function decodePasses(): {
  count: number;
  column: Uint16Array;
  row: Uint16Array;
  altitude: Int16Array;
  prominence: Uint16Array;
  climb: Uint16Array;
};
