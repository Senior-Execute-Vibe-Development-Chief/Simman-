/**
 * Map projections for the shell. Display only: the simulation grid stays
 * latitude-longitude (every dataset arrives on it and every cell already
 * carries its true area), and a projection is a lookup table from output
 * pixels back to source cells. Nothing here touches world state or hashes.
 *
 * Equal Earth (Šavrič, Patterson, Jenny 2018): equal-area, so Greenland
 * draws at its true size (an equirectangular screen paints it ~2.3× too
 * large by tile count while the sim computes its area correctly — owner
 * play-report 2026-09-02). Plate carrée is kept for checking data
 * alignment, since that is the grid the data is on.
 */

export type ProjectionName = "equal-earth" | "plate-carree";

export interface Projection {
  readonly name: ProjectionName;
  /** Output raster size for a given source grid. */
  size(width: number, height: number): { width: number; height: number };
  /** Source grid coordinates (fractional cells) → output pixel coordinates. */
  forward(x: number, y: number, width: number, height: number): [number, number];
  /** Output pixel → source grid coordinates, or undefined off the globe. */
  inverse(px: number, py: number, width: number, height: number): [number, number] | undefined;
}

// Equal Earth polynomial coefficients and the θ→φ scale.
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const EE_HALF_WIDTH = Math.PI / (M * A1); // x at (λ=π, φ=0)
const NEWTON_ITERATIONS = 12;
const NEWTON_EPSILON = 1e-11;
const DEGREES_PER_HALF_TURN = 180;

function equalEarthY(theta: number): number {
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
}

function equalEarthDy(theta: number): number {
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
}

const EE_HALF_HEIGHT = equalEarthY(Math.asin(M)); // y at the pole

function gridToLonLat(x: number, y: number, width: number, height: number): [number, number] {
  const lon = (x / width) * 2 * Math.PI - Math.PI;
  const lat = Math.PI / 2 - (y / height) * Math.PI;
  return [lon, lat];
}

function lonLatToGrid(lon: number, lat: number, width: number, height: number): [number, number] {
  return [((lon + Math.PI) / (2 * Math.PI)) * width, ((Math.PI / 2 - lat) / Math.PI) * height];
}

export const EQUAL_EARTH: Projection = {
  name: "equal-earth",
  size(width) {
    return { width, height: Math.round(width * EE_HALF_HEIGHT / EE_HALF_WIDTH) };
  },
  forward(x, y, width, height) {
    const [lon, lat] = gridToLonLat(x, y, width, height);
    const theta = Math.asin(M * Math.sin(lat));
    const ex = lon * Math.cos(theta) / (M * equalEarthDy(theta));
    const ey = equalEarthY(theta);
    const out = this.size(width, height);
    return [
      ((ex + EE_HALF_WIDTH) / (2 * EE_HALF_WIDTH)) * out.width,
      ((EE_HALF_HEIGHT - ey) / (2 * EE_HALF_HEIGHT)) * out.height,
    ];
  },
  inverse(px, py, width, height) {
    const out = this.size(width, height);
    const ex = (px / out.width) * 2 * EE_HALF_WIDTH - EE_HALF_WIDTH;
    const ey = EE_HALF_HEIGHT - (py / out.height) * 2 * EE_HALF_HEIGHT;
    if (Math.abs(ey) > EE_HALF_HEIGHT) return undefined;
    let theta = ey;
    for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration++) {
      const delta = (equalEarthY(theta) - ey) / equalEarthDy(theta);
      theta -= delta;
      if (Math.abs(delta) < NEWTON_EPSILON) break;
    }
    const sinLat = Math.sin(theta) / M;
    if (Math.abs(sinLat) > 1) return undefined;
    const lon = M * ex * equalEarthDy(theta) / Math.cos(theta);
    if (Math.abs(lon) > Math.PI) return undefined;
    return lonLatToGrid(lon, Math.asin(sinLat), width, height);
  },
};

export const PLATE_CARREE: Projection = {
  name: "plate-carree",
  size(width, height) {
    return { width, height };
  },
  forward(x, y) {
    return [x, y];
  },
  inverse(px, py, width, height) {
    if (px < 0 || py < 0 || px >= width || py >= height) return undefined;
    return [px, py];
  },
};

export const PROJECTIONS: Record<ProjectionName, Projection> = {
  "equal-earth": EQUAL_EARTH,
  "plate-carree": PLATE_CARREE,
};

export interface ProjectionTable {
  readonly projection: Projection;
  readonly width: number;
  readonly height: number;
  /** Source cell index per output pixel, or −1 off the globe. */
  readonly cellOf: Int32Array;
}

/** Build the per-pixel sampling table once per (projection, grid). */
export function buildProjectionTable(
  projection: Projection,
  gridWidth: number,
  gridHeight: number,
): ProjectionTable {
  const { width, height } = projection.size(gridWidth, gridHeight);
  const cellOf = new Int32Array(width * height).fill(-1);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const source = projection.inverse(px + 0.5, py + 0.5, gridWidth, gridHeight);
      if (!source) continue;
      const x = Math.min(gridWidth - 1, Math.max(0, Math.floor(source[0])));
      const y = Math.min(gridHeight - 1, Math.max(0, Math.floor(source[1])));
      cellOf[py * width + px] = y * gridWidth + x;
    }
  }
  return { projection, width, height, cellOf };
}

/** Outline of the globe (the ±180° meridians) as output-pixel points, north pole first, clockwise. */
export function globeOutline(
  projection: Projection,
  gridWidth: number,
  gridHeight: number,
  samples = 90,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let index = 0; index <= samples; index++) {
    points.push(projection.forward(gridWidth, (index / samples) * gridHeight, gridWidth, gridHeight));
  }
  for (let index = samples; index >= 0; index--) {
    points.push(projection.forward(0, (index / samples) * gridHeight, gridWidth, gridHeight));
  }
  return points;
}

/** Graticule lines every `stepDegrees`, each as output-pixel polylines. */
export function graticule(
  projection: Projection,
  gridWidth: number,
  gridHeight: number,
  stepDegrees = 30,
  samples = 60,
): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = [];
  const lonStep = (stepDegrees / (2 * DEGREES_PER_HALF_TURN)) * gridWidth;
  const latStep = (stepDegrees / DEGREES_PER_HALF_TURN) * gridHeight;
  for (let x = lonStep; x < gridWidth - lonStep / 2; x += lonStep) {
    const line: Array<[number, number]> = [];
    for (let index = 0; index <= samples; index++) {
      line.push(projection.forward(x, (index / samples) * gridHeight, gridWidth, gridHeight));
    }
    lines.push(line);
  }
  for (let y = latStep; y < gridHeight - latStep / 2; y += latStep) {
    const line: Array<[number, number]> = [];
    for (let index = 0; index <= samples; index++) {
      line.push(projection.forward((index / samples) * gridWidth, y, gridWidth, gridHeight));
    }
    lines.push(line);
  }
  return lines;
}
