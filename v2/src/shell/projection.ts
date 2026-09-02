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
 *
 * Shape distortion in a pseudocylindrical projection grows with distance
 * from the central meridian, so the centre is movable: dragging at zoom 1
 * spins the world about its polar axis and whatever is studied sits where
 * shapes are near-true (owner request 2026-09-02).
 */

export type ProjectionName = "equal-earth" | "plate-carree";

/** A projection maps (λ, φ) in radians, λ relative to the central meridian, to unit map coordinates. */
export interface Projection {
  readonly name: ProjectionName;
  /** Half-extents of the unit map: x ∈ [−halfWidth, halfWidth], y ∈ [−halfHeight, halfHeight]. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  project(lon: number, lat: number): [number, number];
  /** Unit map → (λ, φ), or undefined off the globe. */
  unproject(x: number, y: number): [number, number] | undefined;
}

// Equal Earth polynomial coefficients and the θ→φ scale.
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
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

export const EQUAL_EARTH: Projection = {
  name: "equal-earth",
  halfWidth: Math.PI / (M * A1),
  halfHeight: equalEarthY(Math.asin(M)),
  project(lon, lat) {
    const theta = Math.asin(M * Math.sin(lat));
    return [lon * Math.cos(theta) / (M * equalEarthDy(theta)), equalEarthY(theta)];
  },
  unproject(x, y) {
    if (Math.abs(y) > this.halfHeight) return undefined;
    let theta = y;
    for (let iteration = 0; iteration < NEWTON_ITERATIONS; iteration++) {
      const delta = (equalEarthY(theta) - y) / equalEarthDy(theta);
      theta -= delta;
      if (Math.abs(delta) < NEWTON_EPSILON) break;
    }
    const sinLat = Math.sin(theta) / M;
    if (Math.abs(sinLat) > 1) return undefined;
    const lon = M * x * equalEarthDy(theta) / Math.cos(theta);
    if (Math.abs(lon) > Math.PI) return undefined;
    return [lon, Math.asin(sinLat)];
  },
};

export const PLATE_CARREE: Projection = {
  name: "plate-carree",
  halfWidth: Math.PI,
  halfHeight: Math.PI / 2,
  project(lon, lat) {
    return [lon, lat];
  },
  unproject(x, y) {
    if (Math.abs(x) > Math.PI || Math.abs(y) > Math.PI / 2) return undefined;
    return [x, y];
  },
};

export const PROJECTIONS: Record<ProjectionName, Projection> = {
  "equal-earth": EQUAL_EARTH,
  "plate-carree": PLATE_CARREE,
};

function wrapLongitude(lon: number): number {
  let result = lon;
  while (result > Math.PI) result -= 2 * Math.PI;
  while (result < -Math.PI) result += 2 * Math.PI;
  return result;
}

/** A projection instantiated for one grid and one central meridian. */
export interface ProjectionTable {
  readonly projection: Projection;
  readonly centralMeridian: number; // radians, east positive
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly width: number;
  readonly height: number;
  /** Source cell index per output pixel, or −1 off the globe. */
  readonly cellOf: Int32Array;
  /** (λ, φ) absolute, radians → output pixel coordinates. */
  lonLatToPixel(lon: number, lat: number): [number, number];
  /** Fractional sim-grid coordinates → output pixel coordinates. */
  gridToPixel(x: number, y: number): [number, number];
  /** Output pixel → (λ, φ) absolute, or undefined off the globe. */
  pixelToLonLat(px: number, py: number): [number, number] | undefined;
}

export function projectedSize(projection: Projection, gridWidth: number): { width: number; height: number } {
  return {
    width: gridWidth,
    height: Math.round(gridWidth * projection.halfHeight / projection.halfWidth),
  };
}

/** Build the per-pixel sampling table once per (projection, grid, centre). */
export function buildProjectionTable(
  projection: Projection,
  gridWidth: number,
  gridHeight: number,
  centralMeridianDegrees = 0,
): ProjectionTable {
  const centralMeridian = (centralMeridianDegrees / DEGREES_PER_HALF_TURN) * Math.PI;
  const { width, height } = projectedSize(projection, gridWidth);
  const cellOf = new Int32Array(width * height).fill(-1);
  const pixelToLonLat = (px: number, py: number): [number, number] | undefined => {
    const x = (px / width) * 2 * projection.halfWidth - projection.halfWidth;
    const y = projection.halfHeight - (py / height) * 2 * projection.halfHeight;
    const relative = projection.unproject(x, y);
    if (!relative) return undefined;
    return [wrapLongitude(relative[0] + centralMeridian), relative[1]];
  };
  const lonLatToPixel = (lon: number, lat: number): [number, number] => {
    const [x, y] = projection.project(wrapLongitude(lon - centralMeridian), lat);
    return [
      ((x + projection.halfWidth) / (2 * projection.halfWidth)) * width,
      ((projection.halfHeight - y) / (2 * projection.halfHeight)) * height,
    ];
  };
  const gridToPixel = (x: number, y: number): [number, number] => lonLatToPixel(
    (x / gridWidth) * 2 * Math.PI - Math.PI,
    Math.PI / 2 - (y / gridHeight) * Math.PI,
  );
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const lonLat = pixelToLonLat(px + 0.5, py + 0.5);
      if (!lonLat) continue;
      const gx = ((lonLat[0] + Math.PI) / (2 * Math.PI)) * gridWidth;
      const gy = ((Math.PI / 2 - lonLat[1]) / Math.PI) * gridHeight;
      const x = Math.min(gridWidth - 1, Math.max(0, Math.floor(gx)));
      const y = Math.min(gridHeight - 1, Math.max(0, Math.floor(gy)));
      cellOf[py * width + px] = y * gridWidth + x;
    }
  }
  return {
    projection,
    centralMeridian,
    gridWidth,
    gridHeight,
    width,
    height,
    cellOf,
    lonLatToPixel,
    gridToPixel,
    pixelToLonLat,
  };
}

/** Outline of the globe (the seam meridian, both sides) as output-pixel points, clockwise from the north pole. */
export function globeOutline(table: ProjectionTable, samples = 90): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const east = table.centralMeridian + Math.PI;
  const west = table.centralMeridian - Math.PI;
  for (let index = 0; index <= samples; index++) {
    points.push(table.lonLatToPixel(east - 1e-9, Math.PI / 2 - (index / samples) * Math.PI));
  }
  for (let index = samples; index >= 0; index--) {
    points.push(table.lonLatToPixel(west + 1e-9, Math.PI / 2 - (index / samples) * Math.PI));
  }
  return points;
}

/** Graticule lines every `stepDegrees` of absolute longitude/latitude, as output-pixel polylines; meridians break at the seam. */
export function graticule(
  table: ProjectionTable,
  stepDegrees = 30,
  samples = 60,
): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = [];
  const step = (stepDegrees / DEGREES_PER_HALF_TURN) * Math.PI;
  for (let lon = -Math.PI + step; lon < Math.PI - step / 2; lon += step) {
    const line: Array<[number, number]> = [];
    for (let index = 0; index <= samples; index++) {
      line.push(table.lonLatToPixel(lon, Math.PI / 2 - (index / samples) * Math.PI));
    }
    lines.push(line);
  }
  for (let lat = -Math.PI / 2 + step; lat < Math.PI / 2 - step / 2; lat += step) {
    // A parallel is drawn from the western seam to the eastern seam so it
    // never jumps across the map when the centre is not 0°.
    const line: Array<[number, number]> = [];
    for (let index = 0; index <= samples; index++) {
      const lon = table.centralMeridian - Math.PI + 1e-9 + (index / samples) * (2 * Math.PI - 2e-9);
      line.push(table.lonLatToPixel(lon, lat));
    }
    lines.push(line);
  }
  return lines;
}
