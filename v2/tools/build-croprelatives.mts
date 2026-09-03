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
const MAX_RECORDS = 2000;

interface Taxon { readonly name: string; readonly continents: readonly string[]; }
interface PackageRelatives { readonly packageId: string; readonly note: string; readonly taxa: readonly Taxon[]; }

const RELATIVES: readonly PackageRelatives[] = [
  // One or two taxa per package: the wild progenitor of the crop that DEFINES
  // the package, not every wild relative in it. GBIF record density tracks
  // botanical survey effort rather than plant abundance, so a widespread
  // relative with tens of thousands of records drags the fitted envelope to
  // wherever botanists work — measured: Setaria viridis (14,589 Asian records,
  // heavily Russian) put millet's envelope in Siberia and lit hearths there,
  // and Hordeum spontaneum (9,503, Morocco to Tibet) put wheat's in north
  // China. The founder crop's own progenitor is the tightest honest choice.
  { packageId: "wheat", note: "wild emmer and wild einkorn, the founders (Zohary, Hopf & Weiss 2012); wild barley is excluded, its range spanning Morocco to Tibet", taxa: [
    { name: "Triticum dicoccoides", continents: ["ASIA"] },
    { name: "Triticum boeoticum", continents: ["ASIA"] },
  ] },
  { packageId: "rice", note: "annual wild rice, the northern-margin form Fuller 2011 identifies as the progenitor", taxa: [
    { name: "Oryza nivara", continents: ["ASIA"] },
  ] },
  { packageId: "maize", note: "Balsas teosinte (Matsuoka et al. 2002)", taxa: [
    { name: "Zea mays subsp. parviglumis", continents: ["NORTH_AMERICA"] },
  ] },
  { packageId: "sorghum", note: "wild sorghum and wild pearl millet (Harlan 1971)", taxa: [
    { name: "Sorghum arundinaceum", continents: ["AFRICA"] },
    { name: "Cenchrus violaceus", continents: ["AFRICA"] },
  ] },
  { packageId: "millet", note: "wild broomcorn millet and green foxtail, the two founders of the north Chinese package (Zhao 2011; Lu et al. 2009)", taxa: [
    { name: "Panicum miliaceum subsp. ruderale", continents: ["ASIA"] },
    { name: "Setaria viridis", continents: ["ASIA"] },
  ] },
  { packageId: "tubers", note: "wild manioc (Olsen & Schaal 1999); wild sweet potato is excluded, its range reaching Mexico", taxa: [
    { name: "Manihot esculenta subsp. flabellifolia", continents: ["SOUTH_AMERICA"] },
  ] },
  { packageId: "highland-roots", note: "enset (Harlan 1969); wild teff is excluded, being pan-African", taxa: [
    { name: "Ensete ventricosum", continents: ["AFRICA"] },
  ] },
  { packageId: "new-guinea-roots", note: "wild taro on its own landmass (Denham et al. 2003)", taxa: [
    { name: "Colocasia esculenta", continents: ["OCEANIA"] },
  ] },
  { packageId: "eastern-seeds", note: "marsh elder, chenopod and Ozark gourd, the Eastern Agricultural Complex's own founders (Smith 2006); wild sunflower is excluded, spanning the continent", taxa: [
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
  const taxa: unknown[] = [];
  for (const taxon of entry.taxa) {
    const { points, total } = await occurrencesOf(taxon);
    // Cells are kept PER TAXON (W10). A package is a founder SET and it is
    // rich where its members CO-OCCUR: western Anatolia has wild einkorn but
    // not wild emmer, the south-eastern arc has einkorn, emmer and barley
    // together; green foxtail runs across Siberia, wild broomcorn millet
    // does not. Merging the taxa into one cloud threw that intersection
    // away and left the fitted envelope tracking whichever member had been
    // collected most — the survey-effort bias that put wheat's richest
    // ground in western Anatolia and millet's on the Kazakh steppe.
    const cells = new Map<string, [number, number, number]>();
    // Each taxon carries the same total weight, whatever its record count.
    // Sampling effort differs by orders of magnitude between a surveyed weed
    // and a rare progenitor (green foxtail 14,589 records against wild
    // broomcorn millet's 384), and unnormalised counts let the surveyed one
    // decide where the package's envelope sits.
    const perRecord = points.length > 0 ? 1 / points.length : 0;
    for (const [lon, lat] of points) {
      const key = `${Math.round(lon / GRID_DEGREES)}:${Math.round(lat / GRID_DEGREES)}`;
      const existing = cells.get(key);
      if (existing) existing[2] += perRecord;
      else {
        cells.set(key, [
          Math.round((Math.round(lon / GRID_DEGREES) * GRID_DEGREES) * 1000) / 1000,
          Math.round((Math.round(lat / GRID_DEGREES) * GRID_DEGREES) * 1000) / 1000,
          perRecord,
        ]);
      }
    }
    taxa.push({
      name: taxon.name,
      continents: taxon.continents,
      records: total,
      sampled: points.length,
      cells: [...cells.values()]
        .map(([lon, lat, weight]) => [lon, lat, Math.round(weight * 1e6) / 1e6] as [number, number, number])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    });
    console.error(`${entry.packageId} ${taxon.name}: ${total} records, ${points.length} sampled, ${cells.size} cells`);
  }
  packages.push({ packageId: entry.packageId, note: entry.note, taxa });
}

writeFileSync("data/reality/crop-occurrences.json", `${JSON.stringify({
  source: "Each cell is [longitude, latitude, weight]: the weight is the share of its taxon's records that fall in the cell, so every taxon of a package counts equally however well surveyed it is, and it measures how COMMON the plant is there, which is what separates Harlan's massive stands from sporadic occurrences and is what the envelope is fitted against. GBIF occurrence records of each package's WILD progenitors, restricted to the continents the lineage is native to (GBIF's own continent field; the modern spread of a domesticate is thereby excluded — sunflower alone has 44,705 European records). Coordinates are deduplicated to a 0.25-degree grid; the counts are the full matching totals, the sampled figures what this bake read. Cells are listed PER TAXON: the simulation fits an envelope to each member separately, and a package's stand richness is where its members CO-OCCUR — both the founder-package concept and the correction for per-species survey effort, since an intersection cannot be inflated by one over-collected member. No range is drawn.",
  citation: "GBIF.org occurrence search API, api.gbif.org/v1/occurrence/search. Individual dataset citations resolve through each record's datasetKey.",
  fetched: new Date().toISOString().slice(0, 10),
  gridDegrees: GRID_DEGREES,
  packages,
}, null, 1)}\n`);
console.error("wrote data/reality/crop-occurrences.json");
