export interface SampleBins {
  readonly W: number;
  readonly H: number;
  readonly SRC_COLS: number;
  readonly SRC_H: number;
  readonly colFirst: Int32Array;
  readonly colLast: Int32Array;
  readonly rowFirst: Int32Array;
  readonly rowLast: Int32Array;
}
export function sampleBins(W: number, H: number, SRC_COLS: number, SRC_H: number): SampleBins;
export const WALK_DX: readonly number[];
export const WALK_DY: readonly number[];
export function edgeWindow(bins: SampleBins, x: number, y: number, d: number): {
  r0: number; r1: number; c0: number; c1: number; nx: number; ny: number;
};
