/* V2 M3a DATA PORT
 * source: crop-wild-relative range compilation in data/reality/crop-ranges.json.
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

/**
 * Rasterize every wild-progenitor range to a land-independent Uint8 mask.
 * Overlap is intentional: several crops can have a native range in one cell.
 */
export function sampleCropRanges(width, height) {
  const cells = width * height;
  return rangeData.ranges.map((range) => {
    const mask = new Uint8Array(cells);
    for (const box of range.boxes) {
      const [minLon, maxLon, minLat, maxLat] = box;
      const x0 = Math.max(0, Math.floor(((minLon + 180) / 360) * width) - 1);
      const x1 = Math.min(width - 1, Math.ceil(((maxLon + 180) / 360) * width) + 1);
      const y0 = Math.max(0, Math.floor(((90 - maxLat) / 180) * height) - 1);
      const y1 = Math.min(height - 1, Math.ceil(((90 - minLat) / 180) * height) + 1);
      for (let y = y0; y <= y1; y++) {
        const latitude = latitudeAt(y, height);
        if (latitude < minLat || latitude > maxLat) continue;
        for (let x = x0; x <= x1; x++) {
          const longitude = longitudeAt(x, width);
          if (longitude >= minLon && longitude <= maxLon) mask[y * width + x] = 1;
        }
      }
    }
    return mask;
  });
}

export const CROP_RANGE_SOURCE = rangeData.source;
