/**
 * Bake the wild progenitors' observed distributions (W9).
 *
 * The one irreducible fact about a crop package is WHERE ITS WILD ANCESTOR
 * LIVES — biogeographic history older than the simulation, derivable from
 * no climate field. This tool fetches that fact from GBIF as georeferenced
 * occurrence records of the named wild taxa, restricted to the landmass the
 * lineage is native to (GBIF's own continent field: sunflower has 44,705
 * European records, every one of them modern). The sim then FITS each
 * package's climate envelope to those occurrences and DERIVES the range;
 * no shape is ever drawn.
 *
 * Output: data/reality/crop-occurrences.json — occurrence cells deduplicated
 * to a coarse grid, per package, with taxa, counts and the fetch date.
 * Run manually when the catalogue changes; CI never fetches.
 */
import { writeFileSync } from "node:fs";

const GRID_DEGREES = 0.25;
const PAGE = 300;
const MAX_RECORDS = 6000;

interface Taxon { readonly name: string; readonly continents: readonly string[]; }
interface PackageRelatives { readonly packageId: string; readonly note: string; readonly taxa: readonly Taxon[]; }

const RELATIVES: readonly PackageRelatives[] = [
  { packageId: "wheat", note: "wild emmer, wild einkorn and wild barley (Zohary, Hopf & Weiss 2012)", taxa: [
    { name: "Triticum dicoccoides", continents: ["ASIA"] },
    { name: "Triticum boeoticum", continents: ["ASIA", "EUROPE"] },
    { name: "Hordeum spontaneum", continents: ["ASIA"] },
  ] },
  { packageId: "rice", note: "wild and annual wild rice (Fuller 2011)", taxa: [
    { name: "Oryza rufipogon", continents: ["ASIA"] },
    { name: "Oryza nivara", continents: ["ASIA"] },
  ] },
  { packageId: "maize", note: "Balsas teosinte (Matsuoka et al. 2002)", taxa: [
    { name: "Zea mays subsp. parviglumis", continents: ["NORTH_AMERICA"] },
  ] },
  { packageId: "sorghum", note: "wild sorghum and wild pearl millet (Harlan 1971)", taxa: [
    { name: "Sorghum arundinaceum", continents: ["AFRICA"] },
    { name: "Cenchrus violaceus", continents: ["AFRICA"] },
  ] },
  { packageId: "millet", note: "green foxtail and wild broomcorn millet (Zhao 2011)", taxa: [
    { name: "Setaria viridis", continents: ["ASIA"] },
    { name: "Panicum miliaceum subsp. ruderale", continents: ["ASIA"] },
  ] },
  { packageId: "tubers", note: "wild manioc and wild sweet potato (Olsen & Schaal 1999)", taxa: [
    { name: "Manihot esculenta subsp. flabellifolia", continents: ["SOUTH_AMERICA"] },
    { name: "Ipomoea trifida", continents: ["SOUTH_AMERICA", "NORTH_AMERICA"] },
  ] },
  { packageId: "highland-roots", note: "enset and wild teff (Harlan 1969; D'Andrea 2008)", taxa: [
    { name: "Ensete ventricosum", continents: ["AFRICA"] },
    { name: "Eragrostis pilosa", continents: ["AFRICA"] },
  ] },
  { packageId: "new-guinea-roots", note: "wild taro and wild banana (Denham et al. 2003)", taxa: [
    { name: "Colocasia esculenta", continents: ["OCEANIA"] },
    { name: "Musa acuminata", continents: ["ASIA", "OCEANIA"] },
  ] },
  { packageId: "eastern-seeds", note: "the Eastern Agricultural Complex's wild ancestors (Smith 2006)", taxa: [
    { name: "Helianthus annuus", continents: ["NORTH_AMERICA"] },
    { name: "Iva annua", continents: ["NORTH_AMERICA"] },
    { name: "Chenopodium berlandieri", continents: ["NORTH_AMERICA"] },
    { name: "Cucurbita pepo subsp. ozarkana", continents: ["NORTH_AMERICA"] },
  ] },
];

async function fetchJson(url: string, attempts = 5): Promise<any> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // the proxy resets under load; back off and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw new Error(`GBIF request failed after ${attempts} attempts: ${url}`);
}

async function occurrencesOf(taxon: Taxon): Promise<{ points: Array<[number, number]>; total: number }> {
  const points: Array<[number, number]> = [];
  let total = 0;
  for (const continent of taxon.continents) {
    const base = `https://api.gbif.org/v1/occurrence/search?scientificName=${encodeURIComponent(taxon.name)}`
      + `&continent=${continent}&hasCoordinate=true&hasGeospatialIssue=false&limit=${PAGE}`;
    const head = await fetchJson(`${base}&offset=0`);
    total += head.count ?? 0;
    let offset = 0;
    let page = head;
    while (offset < Math.min(head.count ?? 0, MAX_RECORDS)) {
      for (const record of page.results ?? []) {
        const lat = record.decimalLatitude;
        const lon = record.decimalLongitude;
        if (typeof lat === "number" && typeof lon === "number") points.push([lon, lat]);
      }
      if (page.endOfRecords) break;
      offset += PAGE;
      if (offset >= Math.min(head.count ?? 0, MAX_RECORDS)) break;
      page = await fetchJson(`${base}&offset=${offset}`);
    }
  }
  return { points, total };
}

const packages: unknown[] = [];
for (const entry of RELATIVES) {
  const cells = new Map<string, [number, number]>();
  const taxa: unknown[] = [];
  for (const taxon of entry.taxa) {
    const { points, total } = await occurrencesOf(taxon);
    for (const [lon, lat] of points) {
      const key = `${Math.round(lon / GRID_DEGREES)}:${Math.round(lat / GRID_DEGREES)}`;
      if (!cells.has(key)) {
        cells.set(key, [
          Math.round((Math.round(lon / GRID_DEGREES) * GRID_DEGREES) * 1000) / 1000,
          Math.round((Math.round(lat / GRID_DEGREES) * GRID_DEGREES) * 1000) / 1000,
        ]);
      }
    }
    taxa.push({ name: taxon.name, continents: taxon.continents, records: total, sampled: points.length });
    console.error(`${entry.packageId} ${taxon.name}: ${total} records, ${points.length} sampled`);
  }
  packages.push({
    packageId: entry.packageId,
    note: entry.note,
    taxa,
    cells: [...cells.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  });
}

writeFileSync("data/reality/crop-occurrences.json", `${JSON.stringify({
  source: "GBIF occurrence records of each package's WILD progenitors, restricted to the continents the lineage is native to (GBIF's own continent field; the modern spread of a domesticate is thereby excluded — sunflower alone has 44,705 European records). Coordinates are deduplicated to a 0.25-degree grid; the counts are the full matching totals, the sampled figures what this bake read. The simulation fits each package's climate envelope to these cells and derives its range; no range is drawn.",
  citation: "GBIF.org occurrence search API, api.gbif.org/v1/occurrence/search. Individual dataset citations resolve through each record's datasetKey.",
  fetched: new Date().toISOString().slice(0, 10),
  gridDegrees: GRID_DEGREES,
  packages,
}, null, 1)}\n`);
console.error("wrote data/reality/crop-occurrences.json");
