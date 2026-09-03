/* V2 M3a DATA PORT (W8: polygons)
 * source: the dense-stand habitat polygons in data/reality/crop-ranges.json.
 * The range descriptors are rasterized once per substrate, at the substrate's
 * own grid, and then treated as immutable data by the people pass.
 */
import rangeData from "../../../data/reality/crop-ranges.json" with { type: "json" };

function latitudeAt(y, height) {
  return 90 - ((y + 0.5) / height) * 180;
}

function longitudeAt(x, width) {
  return ((x + 0.5) / width) * 360 - 180;
}

/** Even-odd point-in-polygon on a [lon, lat] ring. */
function insideRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Rasterize every wild-progenitor range to a land-independent Uint8 mask.
 * Overlap is intentional: several crops can have a native range in one cell.
 * A range carries polygons (W8) or, as a fallback, boxes (W7).
 */
export function sampleCropRanges(width, height) {
  const cells = width * height;
  return rangeData.ranges.map((range) => {
    const mask = new Uint8Array(cells);
    const rings = range.polygons ?? (range.boxes ?? []).map(([minLon, maxLon, minLat, maxLat]) => (
      [[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat]]
    ));
    for (const ring of rings) {
      let minLon = Infinity; let maxLon = -Infinity; let minLat = Infinity; let maxLat = -Infinity;
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
      const x0 = Math.max(0, Math.floor(((minLon + 180) / 360) * width) - 1);
      const x1 = Math.min(width - 1, Math.ceil(((maxLon + 180) / 360) * width) + 1);
      const y0 = Math.max(0, Math.floor(((90 - maxLat) / 180) * height) - 1);
      const y1 = Math.min(height - 1, Math.ceil(((90 - minLat) / 180) * height) + 1);
      for (let y = y0; y <= y1; y++) {
        const latitude = latitudeAt(y, height);
        for (let x = x0; x <= x1; x++) {
          if (insideRing(ring, longitudeAt(x, width), latitude)) mask[y * width + x] = 1;
        }
      }
    }
    return mask;
  });
}

export const CROP_RANGE_SOURCE = rangeData.source;
