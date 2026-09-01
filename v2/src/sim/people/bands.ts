/**
 * The people pass uses a grid-derived partition, never a worker-derived one.
 * Every phase that writes a field is dispatched in this exact row order. The
 * phase functions only read frozen inputs, so changing the number of dispatch
 * workers cannot change a floating-point reduction or a destination write.
 */
import { PEOPLE_BAND_COUNT } from "../constants";

export interface PeopleBand {
  readonly index: number;
  readonly rowLo: number;
  readonly rowHi: number;
  readonly rawLo: number;
  readonly rawHi: number;
}

export function fixedPeopleBands(width: number, height: number): readonly PeopleBand[] {
  const bands: PeopleBand[] = [];
  for (let index = 0; index < PEOPLE_BAND_COUNT; index++) {
    const rowLo = Math.floor(index * height / PEOPLE_BAND_COUNT);
    const rowHi = Math.floor((index + 1) * height / PEOPLE_BAND_COUNT);
    bands.push({
      index,
      rowLo,
      rowHi,
      rawLo: rowLo * width,
      rawHi: rowHi * width,
    });
  }
  return bands;
}

/**
 * Shared control storage is deliberately only a dispatch/control plane. The
 * authoritative fields stay in the wasm instance and are never copied into
 * this buffer. A browser without cross-origin isolation gets the same fixed
 * serial band order without this optional coordination buffer.
 */
export interface BandControl {
  readonly workerCount: number;
  readonly shared: boolean;
  readonly storage?: SharedArrayBuffer;
  readonly claims: Int32Array;
}

export function createBandControl(workerCount = 1): BandControl {
  const count = Math.max(1, Math.floor(workerCount));
  const shared = typeof SharedArrayBuffer !== "undefined"
    && (typeof crossOriginIsolated === "undefined" || crossOriginIsolated);
  const storage = shared ? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2) : undefined;
  return {
    workerCount: count,
    shared,
    storage,
    claims: new Int32Array(storage ?? new ArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2)),
  };
}

