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
 * shapes are near-true (owner request 2026-09-02). Both projections are
 * pseudocylindrical — every output row is one latitude — so recentring is
 * a pure horizontal shift of source columns: the table is built ONCE per
 * projection and the centre is applied at sampling time, which makes the
 * spin instant at any grid (owner: "make the scroll instant").
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
const SEAM_INSET = 1e-9;

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

export function wrapLongitude(lon: number): number {
  let result = lon;
  while (result > Math.PI) result -= 2 * Math.PI;
  while (result < -Math.PI) result += 2 * Math.PI;
  return result;
}

export function degreesToRadians(degrees: number): number {
  return (degrees / DEGREES_PER_HALF_TURN) * Math.PI;
}

/**
 * A projection instantiated for one grid. The central meridian is NOT
 * baked in: every accessor takes it (radians, east positive), and
 * `cellAt` applies it as a column shift snapped to whole source cells.
 */
export interface ProjectionTable {
  readonly projection: Projection;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly width: number;
  readonly height: number;
  /** Source row per output row (one latitude per row), or −1 above/below the globe. */
  readonly rowOf: Int32Array;
  /** Source column per output pixel at centre 0°, or −1 off the globe. */
  readonly columnOf: Int32Array;
  /** Whole-cell column shift for a central meridian (snapped). */
  shiftFor(centralMeridian: number): number;
  /** Source cell under an output pixel for a given column shift, or −1. */
  cellAt(px: number, py: number, shift: number): number;
  lonLatToPixel(lon: number, lat: number, centralMeridian: number): [number, number];
  gridToPixel(x: number, y: number, centralMeridian: number): [number, number];
  /** Output pixel → absolute (λ, φ) in radians, or undefined off the globe. */
  pixelToLonLat(px: number, py: number, centralMeridian: number): [number, number] | undefined;
}

export function projectedSize(projection: Projection, gridWidth: number): { width: number; height: number } {
  return {
    width: gridWidth,
    height: Math.round(gridWidth * projection.halfHeight / projection.halfWidth),
  };
}

/** Build the per-pixel sampling table once per (projection, grid). */
export function buildProjectionTable(
  projection: Projection,
  gridWidth: number,
  gridHeight: number,
): ProjectionTable {
  const { width, height } = projectedSize(projection, gridWidth);
  const rowOf = new Int32Array(height).fill(-1);
  const columnOf = new Int32Array(width * height).fill(-1);
  for (let py = 0; py < height; py++) {
    const y = projection.halfHeight - ((py + 0.5) / height) * 2 * projection.halfHeight;
    const centre = projection.unproject(0, y);
    if (!centre) continue;
    const gy = ((Math.PI / 2 - centre[1]) / Math.PI) * gridHeight;
    rowOf[py] = Math.min(gridHeight - 1, Math.max(0, Math.floor(gy)));
    for (let px = 0; px < width; px++) {
      const x = ((px + 0.5) / width) * 2 * projection.halfWidth - projection.halfWidth;
      const lonLat = projection.unproject(x, y);
      if (!lonLat) continue;
      const gx = ((lonLat[0] + Math.PI) / (2 * Math.PI)) * gridWidth;
      columnOf[py * width + px] = Math.min(gridWidth - 1, Math.max(0, Math.floor(gx)));
    }
  }
  const lonLatToPixel = (lon: number, lat: number, centralMeridian: number): [number, number] => {
    const [x, y] = projection.project(wrapLongitude(lon - centralMeridian), lat);
    return [
      ((x + projection.halfWidth) / (2 * projection.halfWidth)) * width,
      ((projection.halfHeight - y) / (2 * projection.halfHeight)) * height,
    ];
  };
  return {
    projection,
    gridWidth,
    gridHeight,
    width,
    height,
    rowOf,
    columnOf,
    shiftFor(centralMeridian) {
      const cells = Math.round((centralMeridian / (2 * Math.PI)) * gridWidth);
      return ((cells % gridWidth) + gridWidth) % gridWidth;
    },
    cellAt(px, py, shift) {
      const row = rowOf[py] ?? -1;
      const column = columnOf[py * width + px] ?? -1;
      if (row < 0 || column < 0) return -1;
      let x = column + shift;
      if (x >= gridWidth) x -= gridWidth;
      return row * gridWidth + x;
    },
    lonLatToPixel,
    gridToPixel(x, y, centralMeridian) {
      return lonLatToPixel(
        (x / gridWidth) * 2 * Math.PI - Math.PI,
        Math.PI / 2 - (y / gridHeight) * Math.PI,
        centralMeridian,
      );
    },
    pixelToLonLat(px, py, centralMeridian) {
      const x = (px / width) * 2 * projection.halfWidth - projection.halfWidth;
      const y = projection.halfHeight - (py / height) * 2 * projection.halfHeight;
      const relative = projection.unproject(x, y);
      if (!relative) return undefined;
      return [wrapLongitude(relative[0] + centralMeridian), relative[1]];
    },
  };
}

/** Outline of the globe (the seam meridian, both sides) as output-pixel points, clockwise from the north pole. */
export function globeOutline(table: ProjectionTable, centralMeridian: number, samples = 90): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const east = centralMeridian + Math.PI - SEAM_INSET;
  const west = centralMeridian - Math.PI + SEAM_INSET;
  for (let index = 0; index <= samples; index++) {
    points.push(table.lonLatToPixel(east, Math.PI / 2 - (index / samples) * Math.PI, centralMeridian));
  }
  for (let index = samples; index >= 0; index--) {
    points.push(table.lonLatToPixel(west, Math.PI / 2 - (index / samples) * Math.PI, centralMeridian));
  }
  return points;
}

/** Graticule lines every `stepDegrees` of absolute longitude/latitude, as output-pixel polylines. */
export function graticule(
  table: ProjectionTable,
  centralMeridian: number,
  stepDegrees = 30,
  samples = 60,
): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = [];
  const step = degreesToRadians(stepDegrees);
  for (let lon = -Math.PI + step; lon < Math.PI - step / 2; lon += step) {
    const line: Array<[number, number]> = [];
    for (let index = 0; index <= samples; index++) {
      line.push(table.lonLatToPixel(lon, Math.PI / 2 - (index / samples) * Math.PI, centralMeridian));
    }
    lines.push(line);
  }
  for (let lat = -Math.PI / 2 + step; lat < Math.PI / 2 - step / 2; lat += step) {
    // A parallel runs from the western seam to the eastern seam so it never
    // jumps across the map when the centre is not 0°.
    const line: Array<[number, number]> = [];
    for (let index = 0; index <= samples; index++) {
      const lon = centralMeridian - Math.PI + SEAM_INSET + (index / samples) * (2 * Math.PI - 2 * SEAM_INSET);
      line.push(table.lonLatToPixel(lon, lat, centralMeridian));
    }
    lines.push(line);
  }
  return lines;
}
