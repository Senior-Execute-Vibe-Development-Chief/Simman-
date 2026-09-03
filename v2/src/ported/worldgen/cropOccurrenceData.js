/* V2 W9 DATA PORT
 * source: data/reality/crop-occurrences.json — GBIF occurrence records of each
 * package's WILD progenitors on the continents their lineages are native to,
 * deduplicated to a quarter-degree grid by tools/build-croprelatives.mts.
 * These are OBSERVATIONS of the plant. The range itself is derived from them
 * (src/sim/people/wildRange.ts); nothing here is a drawn shape.
 */
import occurrenceData from "../../../data/reality/crop-occurrences.json" with { type: "json" };

const byPackage = new Map();
for (const entry of occurrenceData.packages) byPackage.set(entry.packageId, entry);

/**
 * The grid cells a package's progenitors were observed in, with the record
 * count in each: how COMMON the plant is there. The count is the weight the
 * envelope is fitted with, so the fit follows Harlan's massive stands rather
 * than being dragged to the mean of every sporadic outlier.
 */
export function occurrenceCellsOf(packageId, width, height) {
  const entry = byPackage.get(packageId);
  if (!entry) return [];
  const counts = new Map();
  for (const [lon, lat, records] of entry.cells) {
    const x = Math.min(width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)));
    const cell = y * width + x;
    counts.set(cell, (counts.get(cell) ?? 0) + (records ?? 1));
  }
  return [...counts.entries()].map(([cell, records]) => ({ cell, records }));
}

export function occurrenceProvenance(packageId) {
  const entry = byPackage.get(packageId);
  return entry ? { taxa: entry.taxa, cells: entry.cells.length } : undefined;
}

export const CROP_OCCURRENCE_SOURCE = occurrenceData.source;
export const CROP_OCCURRENCE_CITATION = occurrenceData.citation;
