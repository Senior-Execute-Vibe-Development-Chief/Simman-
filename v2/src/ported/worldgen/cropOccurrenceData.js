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

function cellsOf(rows, width, height) {
  const counts = new Map();
  for (const [lon, lat, records] of rows) {
    const x = Math.min(width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)));
    const cell = y * width + x;
    counts.set(cell, (counts.get(cell) ?? 0) + (records ?? 1));
  }
  return [...counts.entries()].map(([cell, records]) => ({ cell, records }));
}

/**
 * The grid cells each of a package's progenitors was observed in, ONE ENTRY
 * PER TAXON, with that taxon's record weight in each cell: how common the
 * plant is there. The weight is what the envelope is fitted with, so the fit
 * follows Harlan's massive stands rather than the mean of every sporadic
 * outlier, and each taxon's weights are normalised so a surveyed weed cannot
 * outvote a rare progenitor.
 *
 * A package is kept as its MEMBERS rather than one merged cloud (W10): it is
 * a founder set, and it is rich where its members co-occur.
 */
export function occurrenceTaxaOf(packageId, width, height) {
  const entry = byPackage.get(packageId);
  if (!entry) return [];
  return entry.taxa
    .filter((taxon) => Array.isArray(taxon.cells) && taxon.cells.length > 0)
    .map((taxon) => ({ name: taxon.name, cells: cellsOf(taxon.cells, width, height) }));
}

/** Every observation of a package's progenitors, the members merged: the range's seed set. */
export function occurrenceCellsOf(packageId, width, height) {
  const merged = new Map();
  for (const taxon of occurrenceTaxaOf(packageId, width, height)) {
    for (const { cell, records } of taxon.cells) merged.set(cell, (merged.get(cell) ?? 0) + records);
  }
  return [...merged.entries()].map(([cell, records]) => ({ cell, records }));
}

export function occurrenceProvenance(packageId) {
  const entry = byPackage.get(packageId);
  if (!entry) return undefined;
  return {
    taxa: entry.taxa.map(({ name, continents, records, sampled, cells }) => ({ name, continents, records, sampled, cells: cells?.length ?? 0 })),
    cells: entry.taxa.reduce((total, taxon) => total + (taxon.cells?.length ?? 0), 0),
  };
}

export const CROP_OCCURRENCE_SOURCE = occurrenceData.source;
export const CROP_OCCURRENCE_CITATION = occurrenceData.citation;
