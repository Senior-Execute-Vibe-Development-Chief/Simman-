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
  /** Real width, km, of every land cell the strait carve OPENED — the carve's
   * own deviation from the DEM, so a consumer can charge the water that is
   * actually there instead of a cell edge (W18). Null on presets that do not
   * carve; zero on every cell the raster resolved by itself. */
  readonly straitWidthKm: Float32Array | null;
  /** The share of each cell standing above sea level, 0..1, measured on the
   * 1-arc-minute grid (W19). The land/sea bit says WHETHER there is ground
   * here; this says HOW MUCH. Null on presets that carry no cover plane. */
  readonly landFraction: Float32Array | null;
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
  readonly tFlood: Float32Array;
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
    /** Per-tile runoff the accumulation summed: moisture less evaporation plus mountain melt, tile-depth units. */
    readonly runoff: Float32Array;
    readonly riverMag: Uint8Array;
    readonly lake: Int32Array;
    readonly lakeGeometry: Uint8Array;
    readonly drainsTerminal: Int8Array;
    readonly navigableThreshold: number;
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
  readonly rawRivers?: boolean;
  readonly realWindFns?: Record<string, unknown> | null;
}): { readonly w: PortedWorld; readonly ter: PortedTerritory };
