export interface PortedWorld {
  readonly width: number;
  readonly height: number;
  readonly elevation: Float32Array;
  readonly moisture: Float32Array;
  readonly temperature: Float32Array;
  readonly dryFrac: Float32Array;
  readonly summerDry: Float32Array;
  readonly coastal: Uint8Array;
  readonly swamp: Uint8Array;
  readonly tAmp: Float32Array;
  readonly warmRainFrac: Float32Array;
  readonly preset: string;
  readonly _seed: number;
  readonly rivers?: unknown;
  readonly deposits?: Record<string, Float32Array>;
}

export interface PortedTerritory {
  readonly tw: number;
  readonly th: number;
  readonly tElev: Float32Array;
  readonly tTemp: Float32Array;
  readonly tMoist: Float32Array;
  readonly tCoast: Uint8Array;
  readonly tDiff: Float32Array;
  readonly tFert: Float32Array;
  readonly tCrop: Float32Array;
  readonly tCross: Float32Array;
  readonly tFlood: Uint8Array;
  readonly tRelief: Float32Array;
  readonly tAncestry: Int16Array;
  readonly tArrival: Float32Array;
  readonly ancestryCount: number;
  readonly ancHue: Float32Array;
  readonly ancLight: Float32Array;
  readonly ancOriginFx: number;
  readonly ancOriginFy: number;
  readonly deposits: Record<string, Float32Array>;
  readonly rivers: {
    readonly flowDir: Uint8Array;
    readonly flowAccum: Float32Array;
    readonly riverMag: Uint8Array;
    readonly lake: Int32Array;
  };
}

export function buildWorld(options: {
  readonly W: number;
  readonly H: number;
  readonly seed: number;
  readonly preset: string;
  readonly oceanLevel?: number;
  readonly tecParams?: Record<string, unknown>;
  readonly realWind?: boolean;
  readonly realWindFns?: Record<string, unknown> | null;
}): { readonly w: PortedWorld; readonly ter: PortedTerritory };
