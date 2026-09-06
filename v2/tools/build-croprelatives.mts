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
 * Each taxon is read under a GBIF USAGE KEY, not a name: a name query is
 * answered with the ACCEPTED usage, which for a wild subspecies can be the
 * crop itself (`readUsageOf`, W16).
 *
 * Output: data/reality/crop-occurrences.json — occurrence cells deduplicated
 * to a coarse grid, per package, with taxa, counts, the usage each was read
 * under, and the fetch date.
 * Run manually when the catalogue changes; CI never fetches.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GRID_DEGREES = 0.25;
const PAGE = 300;
/**
 * Every matching record is read (W11). Capping the read at a few thousand
 * takes whatever datasets GBIF returns first, and that order is
 * geographically lumpy: green foxtail's Asian records are 3,214 Chinese of
 * 14,589, but only 23 of the first 300 — enough on its own to centre
 * millet's fitted envelope on Russia.
 */
const MAX_RECORDS = 200_000;
/**
 * Collection effort is measured on a coarser grid than abundance: it varies
 * smoothly with who surveys where, and one query per quarter-degree cell
 * would be tens of thousands of requests.
 */
const BACKGROUND_DEGREES = 1;
/**
 * A cell with almost no botany in it cannot say how common anything is
 * there: five records of a species against five of its whole family is
 * noise, not abundance. Such cells still seed the range as observations,
 * they just carry no weight in the envelope fit.
 */
const MIN_BACKGROUND_RECORDS = 50;

interface Taxon { readonly name: string; readonly continents: readonly string[]; }
interface PackageRelatives { readonly packageId: string; readonly note: string; readonly taxa: readonly Taxon[]; }

const RELATIVES: readonly PackageRelatives[] = [
  // A package's founder set: the wild progenitors of the crops that DEFINE
  // it, not every wild relative in it. GBIF record density tracks botanical
  // survey effort rather than plant abundance, and a widespread relative with
  // tens of thousands of records once dragged the fitted envelope to wherever
  // botanists work — measured: Setaria viridis (14,589 Asian records, heavily
  // Russian) put millet's envelope in Siberia and lit hearths there, and
  // Hordeum spontaneum (9,503, Morocco to Tibet) put wheat's in north China.
  // Both of those were measured against ONE envelope fitted to the merged
  // cloud of a package's members; W10 gave each member its own envelope and
  // W11 divided out the collection effort cell by cell, so breadth alone no
  // longer moves anything (W16 returns barley on that ground). What a
  // package must still not carry is a taxon that is not the progenitor:
  // broomcorn millet's feral escape, whose ancestor botany does not know.
  //
  // The second contamination is the crop's OWN SPREAD (W12). A modern
  // occurrence map of a cultivated plant, or of a weed of cultivation, is a
  // map of where farming took it — using it to decide where farming BEGAN is
  // circular. GBIF's occurrence `establishmentMeans` cannot screen this out
  // (populated on 379 of 19,550 taro records), so the screen is WCVP's native
  // ranges, read per taxon: measured, taro is introduced to New Guinea, while
  // green foxtail really is native across temperate Eurasia and wild enset
  // really is native from Ethiopia to South Africa — those two ranges are
  // honest and their hearths are the model's problem, not the data's.
  // Wild barley is back (W16). It was excluded because its range, spanning
  // Morocco to Tibet, put wheat's fitted envelope in north China — measured,
  // and measured when ONE envelope was fitted to the merged cloud of every
  // member. W10 gave each member its own envelope and made the package rich
  // only where they CO-OCCUR, so a widespread member can no longer drag the
  // fit anywhere; it can only restrict the intersection, which is the
  // founder-set claim itself (Zohary & Hopf: the Crescent is where the whole
  // set occurs together, and it is barley that most of the Crescent's early
  // sites are threshing). Read on ASIA, as its two co-members are.
  { packageId: "wheat", note: "wild emmer, wild einkorn and wild barley, three of the eight founders (Zohary, Hopf & Weiss 2012)", taxa: [
    { name: "Triticum dicoccoides", continents: ["ASIA"] },
    { name: "Triticum boeoticum", continents: ["ASIA"] },
    { name: "Hordeum spontaneum", continents: ["ASIA"] },
  ] },
  // This package's taxon was written `Oryza nivara`, the annual form, and
  // that is not what was read (W16). GBIF treats nivara as a synonym of
  // `Oryza rufipogon` and answers a NAME query with the accepted usage, so
  // every bake since W9 read the rufipogon complex — 7,094 records where the
  // synonym's own usage carries 3,839. The datum is the right one (japonica
  // was domesticated from the perennial rufipogon of the Yangtze, indica
  // from the annual form of the Ganges plain; Fuller 2011), and the label
  // now says so instead of claiming the narrower taxon.
  { packageId: "rice", note: "the wild rice complex Oryza rufipogon sensu lato, the annual nivara form included as GBIF treats it; progenitor of both japonica and indica (Fuller 2011)", taxa: [
    { name: "Oryza rufipogon", continents: ["ASIA"] },
  ] },
  { packageId: "maize", note: "Balsas teosinte (Matsuoka et al. 2002)", taxa: [
    { name: "Zea mays subsp. parviglumis", continents: ["NORTH_AMERICA"] },
  ] },
  { packageId: "sorghum", note: "wild sorghum and wild pearl millet (Harlan 1971)", taxa: [
    { name: "Sorghum arundinaceum", continents: ["AFRICA"] },
    { name: "Cenchrus violaceus", continents: ["AFRICA"] },
  ] },
  // Green foxtail only. `Panicum miliaceum subsp. ruderale` was here and is
  // removed: it is a FERAL ESCAPE of the crop, not a wild progenitor —
  // broomcorn millet's wild ancestor is unknown to botany (Zohary, Hopf &
  // Weiss 2012) — and its records are Russian weeds of cultivation, with
  // 100 % of their corrected weight north of 50 N. Counting them as
  // evidence of the ancestor's range is the same error as counting European
  // sunflowers, and it forced the founder-set intersection into Siberia
  // however well green foxtail's own weight was corrected: green foxtail's
  // corrected centre is 101.6 E, 41.7 N, which is north China.
  { packageId: "millet", note: "green foxtail, the wild ancestor of foxtail millet (Zhao 2011); broomcorn millet's wild ancestor is unknown to botany", taxa: [
    { name: "Setaria viridis", continents: ["ASIA"] },
  ] },
  // Wild manioc is the case that forced the read to be pinned to a usage key
  // (W16, `readUsageOf`): GBIF treats `Manihot esculenta subsp.
  // flabellifolia` as a synonym of `Manihot esculenta` — CASSAVA — so the
  // query that asked for the wild subspecies was answered with 23,587
  // records of the crop, where the subspecies itself carries 1,448. Every
  // bake from W9 to W15 fitted this package to the modern cassava planting
  // map, which is precisely the circularity the native-range screen exists
  // to remove, arriving by a door the screen does not watch.
  { packageId: "tubers", note: "wild manioc (Olsen & Schaal 1999); wild sweet potato is excluded, its range reaching Mexico", taxa: [
    { name: "Manihot esculenta subsp. flabellifolia", continents: ["SOUTH_AMERICA"] },
  ] },
  { packageId: "highland-roots", note: "enset (Harlan 1969); wild teff is excluded, being pan-African", taxa: [
    { name: "Ensete ventricosum", continents: ["AFRICA"] },
  ] },
  // Kuk's complex is yam, banana, taro and sugarcane (Denham et al. 2003).
  // The package was taro alone, and that was measurably the wrong taxon: WCVP
  // lists Colocasia esculenta as native to mainland South and Southeast Asia
  // and INTRODUCED to 109 regions, New Guinea among them — so its Oceanian
  // occurrences are the places people CARRIED it, and the sim lit hearths on
  // them (Queensland, Fiji, New Caledonia, the Bismarcks) while Kuk itself,
  // where the plant is not native, never lit.
  //
  // Greater yam ALONE, though wild sugarcane (Saccharum robustum) is native
  // to New Guinea and nowhere else and was the tighter signal. Adding it
  // made the package dead: stand richness is the members' CO-OCCURRENCE, a
  // product zeroed wherever any member is out of range, and sugarcane's 27
  // Oceanian records derive a range so small that the intersection was empty
  // — measured, the nine Kuk-area cells came out canGrow=1 with climate fit
  // 0.50-0.92 and richness EXACTLY 0. That rule is right for a founder set
  // that must be gathered together (emmer with einkorn); yam and sugarcane
  // are independent crops of one complex, so requiring both is a claim the
  // archaeology does not make.
  { packageId: "new-guinea-roots", note: "greater yam, native to New Guinea (Denham et al. 2003; WCVP native ranges); wild taro is excluded, introduced to New Guinea and native to mainland Asia", taxa: [
    { name: "Dioscorea alata", continents: ["OCEANIA"] },
  ] },
  // Wild sunflower was TRIED here and reverted, and the exclusion now rests
  // on what that measured rather than on breadth (W16). Smith 2006 names
  // four founders of the Eastern Agricultural Complex and this package
  // carries three; the fourth was kept out for "spanning the continent",
  // which is the argument W10 and W11 retired, so it was added and baked.
  // `Helianthus annuus` reads clean — 33,805 NORTH_AMERICA records, of
  // which the WCVP screen keeps the 8,086 inside its seven native regions
  // — and it KILLS the package: stand richness is the members' product, and
  // the screened wild sunflower spans lon −124..−96.5, the Plains and the
  // Southwest, where the Ozark gourd spans −96.5..−83.75. Their occurrence
  // cells overlap in EXACTLY ZERO cells; the four-way intersection is empty
  // and the package's best wild stand goes 0.4429 to 0.0000, taking the
  // eastern-woodlands hearth site with it (quality 1.0000 to 0.0000).
  // So this is the sugarcane ruling, not the barley one: the Complex's
  // founders were domesticated independently in ranges that touch at a
  // meridian, and requiring all four together is a claim the archaeology
  // does not make.
  { packageId: "eastern-seeds", note: "marsh elder, chenopod and Ozark gourd, three of the Eastern Agricultural Complex's four founders (Smith 2006); wild sunflower is excluded, its native range disjoint from the gourd's", taxa: [
    { name: "Iva annua", continents: ["NORTH_AMERICA"] },
    { name: "Chenopodium berlandieri", continents: ["NORTH_AMERICA"] },
    { name: "Cucurbita pepo subsp. ozarkana", continents: ["NORTH_AMERICA"] },
  ] },
];

/**
 * A disk cache, so a bake interrupted by GBIF's weather resumes instead of
 * starting over. A full read of every progenitor is thousands of requests,
 * GBIF answers 503 under load, and without this one bad minute at the end
 * throws away an hour — which it did.
 */
const CACHE_DIR = process.env.CROPREL_CACHE ?? ".croprelatives-cache";
mkdirSync(CACHE_DIR, { recursive: true });
function cachePath(name: string): string {
  return join(CACHE_DIR, `${createHash("sha1").update(name).digest("hex")}.json`);
}
function cacheGet<T>(name: string): T | undefined {
  const path = cachePath(name);
  if (!existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return undefined; }
}
function cacheSet(name: string, value: unknown): void {
  try { writeFileSync(cachePath(name), JSON.stringify(value)); } catch { /* a cache miss is not a failure */ }
}

async function fetchJson(url: string, attempts = 8): Promise<any> {
  let last = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = String(error).split("\n")[0] ?? "network";
    }
    // 503 and proxy resets are the normal weather here, not a reason to
    // throw away the read: back off up to a minute and keep trying.
    await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, 1000 * 2 ** attempt)));
  }
  throw new Error(`GBIF request failed after ${attempts} attempts (${last}): ${url}`);
}

const familyKeys = new Map<string, number>();
async function familyKeyOf(name: string): Promise<number> {
  const cached = familyKeys.get(name);
  if (cached !== undefined) return cached;
  const match = await fetchJson(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`);
  const key = typeof match.familyKey === "number" ? match.familyKey : 0;
  familyKeys.set(name, key);
  return key;
}

/** Name parts, rank markers dropped: WCVP and the GBIF backbone both write "Zea mays parviglumis". */
function nameParts(name: string): number {
  return name.replace(/\b(subsp\.|var\.|f\.|ssp\.)\s*/g, "").replace(/\s+/g, " ").trim().split(" ").length;
}

/** True where the accepted name is COARSER than the one asked for — fewer parts, so a rank up. */
function coarser(named: string, accepted: string): boolean {
  return nameParts(accepted) < nameParts(named);
}

interface Usage { readonly key: number; readonly name: string; readonly matched: number; readonly status: string; }

/**
 * WHICH TAXON IS ACTUALLY READ (W16). GBIF answers a `scientificName` query
 * with the ACCEPTED usage of that name, and for a wild progenitor the
 * accepted usage is sometimes the crop: `Manihot esculenta subsp.
 * flabellifolia` is a synonym of `Manihot esculenta`, so the query that
 * asked for wild manioc was answered with 23,587 records of CASSAVA where
 * the subspecies itself carries 1,448 — the modern planting map, read as
 * the wild range, which is the circularity the native-range screen exists to
 * remove. So the read is pinned to a usage key, and a synonym is followed
 * only where following does not move UP the rank ladder: the same rule the
 * WCVP screen already applies to distributions, for the same reason — an
 * infraspecific name exists to separate the wild form from the crop, and
 * resolving it to the species throws that distinction away.
 *
 * Where following is safe it is also right, and the rule keeps it: wild
 * einkorn's `Triticum boeoticum` is accepted as `T. monococcum subsp.
 * aegilopoides` and reads 2,963 records against the synonym's own 216, and
 * the Ozark gourd's `Cucurbita pepo subsp. ozarkana` is accepted as `C.
 * melopepo var. ozarkana`, 152 against 76. Both stay whole.
 */
const usages = new Map<string, Usage>();
async function readUsageOf(name: string): Promise<Usage> {
  const cached = usages.get(name);
  if (cached) return cached;
  const match = await fetchJson(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(name)}`);
  const matched = typeof match.usageKey === "number" ? match.usageKey : 0;
  const named = typeof match.canonicalName === "string" ? match.canonicalName : name;
  const status = typeof match.status === "string" ? match.status : "UNKNOWN";
  let key = matched;
  let read = named;
  if (status === "SYNONYM" && typeof match.acceptedUsageKey === "number") {
    const accepted = await fetchJson(`https://api.gbif.org/v1/species/${match.acceptedUsageKey}`);
    const acceptedName = typeof accepted?.canonicalName === "string" ? accepted.canonicalName : "";
    if (acceptedName !== "" && !coarser(named, acceptedName)) {
      key = match.acceptedUsageKey;
      read = acceptedName;
    }
  }
  if (key <= 0) throw new Error(`GBIF has no usage for ${name}`);
  const usage: Usage = { key, name: read, matched, status };
  usages.set(name, usage);
  return usage;
}

/**
 * The target-group background (W11): how many records of the taxon's own
 * FAMILY were collected in the same ground, by the same kind of survey. A
 * record count is abundance multiplied by collection effort, and this is a
 * direct measure of the effort, so dividing by it leaves the abundance.
 * Standard practice for presence-only data — Phillips et al. 2009, Sample
 * selection bias and presence-only distribution models, Ecological
 * Applications 19:181-197.
 */
/** All vascular plants: the fallback target group where a taxon's own family is too thinly collected to measure effort. */
const TRACHEOPHYTA_KEY = 7707728;

async function backgroundOf(groupParam: string, continent: string, lon: number, lat: number): Promise<number> {
  const west = Math.floor(lon / BACKGROUND_DEGREES) * BACKGROUND_DEGREES;
  const south = Math.floor(lat / BACKGROUND_DEGREES) * BACKGROUND_DEGREES;
  const url = `https://api.gbif.org/v1/occurrence/search?${groupParam}&continent=${continent}`
    + `&decimalLongitude=${west},${west + BACKGROUND_DEGREES}&decimalLatitude=${south},${south + BACKGROUND_DEGREES}`
    + "&hasCoordinate=true&hasGeospatialIssue=false&limit=0";
  const cached = cacheGet<number>(url);
  if (cached !== undefined) return cached;
  const page = await fetchJson(url);
  const count = page.count ?? 0;
  cacheSet(url, count);
  return count;
}

async function occurrencesOf(taxon: Taxon, usage: Usage): Promise<{ points: Array<[number, number, string]>; total: number }> {
  const points: Array<[number, number, string]> = [];
  let total = 0;
  for (const continent of taxon.continents) {
    const base = `https://api.gbif.org/v1/occurrence/search?taxonKey=${usage.key}`
      + `&continent=${continent}&hasCoordinate=true&hasGeospatialIssue=false&limit=${PAGE}`;
    const head = await fetchJson(`${base}&offset=0`);
    total += head.count ?? 0;
    let offset = 0;
    let page = head;
    // GBIF caps offset at 100,000; nothing here approaches it.
    while (offset < Math.min(head.count ?? 0, MAX_RECORDS)) {
      for (const record of page.results ?? []) {
        const lat = record.decimalLatitude;
        const lon = record.decimalLongitude;
        if (typeof lat === "number" && typeof lon === "number") points.push([lon, lat, continent]);
      }
      if (page.endOfRecords) break;
      offset += PAGE;
      if (offset >= Math.min(head.count ?? 0, MAX_RECORDS)) break;
      page = await fetchJson(`${base}&offset=${offset}`);
    }
  }
  return { points, total };
}

/**
 * The NATIVE-RANGE SCREEN (W12). A modern occurrence map of a cultivated
 * plant, or of a weed of cultivation, is a map of where farming CARRIED it;
 * using it to decide where farming BEGAN is circular. Measured: wild taro is
 * native to mainland South and Southeast Asia and introduced to 109 regions,
 * New Guinea among them, so the sim lit taro hearths in Queensland, Fiji and
 * New Caledonia — the places people took it — while Kuk never lit.
 *
 * GBIF's per-record `establishmentMeans` cannot screen this: it is populated
 * on 379 of taro's 19,550 records. The authority that can is the World
 * Checklist of Vascular Plants, which states native versus introduced range
 * per taxon over the WGSRPD level-3 regions, and is published as a GBIF
 * checklist dataset. So: take WCVP's native regions for the taxon, take
 * their polygons from the WGSRPD, and drop every occurrence outside them.
 *
 * Where WCVP carries no distribution for a taxon the screen does not apply
 * and the read is unchanged — the tool says so per taxon rather than
 * silently passing everything.
 */
const WCVP_DATASET = "f382f0ce-323a-4091-bb9f-add557f3a9a2";
const WGSRPD_LEVEL3 = "https://raw.githubusercontent.com/tdwg/wgsrpd/master/geojson/level3.geojson";

interface Ring { readonly points: readonly (readonly [number, number])[]; }
interface Poly { readonly outer: Ring; readonly holes: readonly Ring[]; readonly west: number; readonly east: number; readonly south: number; readonly north: number; }

let level3: Map<string, Poly[]> | undefined;
async function regionPolygons(): Promise<Map<string, Poly[]>> {
  if (level3) return level3;
  let geo = cacheGet<any>(WGSRPD_LEVEL3);
  if (!geo) { geo = await fetchJson(WGSRPD_LEVEL3); cacheSet(WGSRPD_LEVEL3, geo); }
  const map = new Map<string, Poly[]>();
  const ringOf = (coords: any[]): Ring => ({ points: coords.map((c: any[]) => [Number(c[0]), Number(c[1])] as const) });
  const polyOf = (rings: any[]): Poly => {
    const outer = ringOf(rings[0] ?? []);
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const [lon, lat] of outer.points) {
      if (lon < west) west = lon; if (lon > east) east = lon;
      if (lat < south) south = lat; if (lat > north) north = lat;
    }
    return { outer, holes: rings.slice(1).map(ringOf), west, east, south, north };
  };
  for (const feature of geo.features ?? []) {
    const name = feature?.properties?.LEVEL3_NAM;
    if (typeof name !== "string") continue;
    const g = feature.geometry;
    const polys: Poly[] = g?.type === "MultiPolygon"
      ? (g.coordinates ?? []).map((rings: any[]) => polyOf(rings))
      : g?.type === "Polygon" ? [polyOf(g.coordinates ?? [])] : [];
    map.set(name, [...(map.get(name) ?? []), ...polys]);
  }
  level3 = map;
  return map;
}

/** Ray casting, outer ring minus holes. */
function inRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  const pts = ring.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!, b = pts[j]!;
    if ((a[1] > lat) !== (b[1] > lat)
      && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function inPolys(polys: readonly Poly[], lon: number, lat: number): boolean {
  for (const poly of polys) {
    if (lon < poly.west || lon > poly.east || lat < poly.south || lat > poly.north) continue;
    if (!inRing(poly.outer, lon, lat)) continue;
    if (poly.holes.some((hole) => inRing(hole, lon, lat))) continue;
    return true;
  }
  return false;
}

/** WCVP's native regions for a taxon, or undefined where it carries none. */
async function nativeRegionsOf(name: string): Promise<string[] | undefined> {
  const key = `wcvp-native:${name}`;
  const cached = cacheGet<{ regions: string[] | null }>(key);
  if (cached) return cached.regions ?? undefined;
  // WCVP writes canonical names without the rank marker, so the catalogue's
  // "Zea mays subsp. parviglumis" is its "Zea mays parviglumis".
  const canonical = name.replace(/\b(subsp\.|var\.|f\.|ssp\.)\s*/g, "").replace(/\s+/g, " ").trim();
  const search = await fetchJson(
    `https://api.gbif.org/v1/species/search?datasetKey=${WCVP_DATASET}&q=${encodeURIComponent(name)}&limit=20`);
  const same = (a: unknown): boolean =>
    typeof a === "string" && a.toLowerCase() === canonical.toLowerCase();
  let hit = (search.results ?? []).find((r: any) => same(r?.canonicalName));
  // Distributions hang off the ACCEPTED name, so a synonym carries none.
  // Follow it — but never UP a rank: a wild subspecies whose accepted name is
  // the crop species would import the crop's range, which is the very
  // circularity this screen exists to remove.
  if (hit && hit.taxonomicStatus === "SYNONYM" && hit.acceptedKey) {
    const accepted = await fetchJson(`https://api.gbif.org/v1/species/${hit.acceptedKey}`);
    const acceptedCanonical = typeof accepted?.canonicalName === "string" ? accepted.canonicalName : "";
    if (acceptedCanonical !== "" && !coarser(canonical, acceptedCanonical)) hit = accepted;
  }
  let regions: string[] | null = null;
  if (hit?.key) {
    const dist = await fetchJson(`https://api.gbif.org/v1/species/${hit.key}/distributions?limit=400`);
    const native = new Set<string>();
    let sawAny = false;
    for (const row of dist.results ?? []) {
      if (typeof row?.locality !== "string") continue;
      sawAny = true;
      // WCVP marks introduced explicitly and leaves native unmarked.
      if (row.establishmentMeans === null || row.establishmentMeans === undefined) native.add(row.locality);
    }
    if (sawAny && native.size > 0) regions = [...native];
  }
  cacheSet(key, { regions });
  return regions ?? undefined;
}

/** Drop occurrences outside the taxon's native regions; returns all points where WCVP is silent. */
async function screenToNative(taxon: Taxon, points: Array<[number, number, string]>): Promise<{ kept: Array<[number, number, string]>; note: string }> {
  const regions = await nativeRegionsOf(taxon.name);
  if (!regions) return { kept: points, note: "no WCVP native range; unscreened" };
  const all = await regionPolygons();
  const polys: Poly[] = [];
  const missing: string[] = [];
  for (const region of regions) {
    const found = all.get(region);
    if (found && found.length > 0) polys.push(...found); else missing.push(region);
  }
  if (polys.length === 0) return { kept: points, note: `WCVP regions matched no WGSRPD polygon; unscreened` };
  const kept = points.filter(([lon, lat]) => inPolys(polys, lon, lat));
  const note = `native to ${regions.length} region(s), ${kept.length}/${points.length} records inside`
    + (missing.length > 0 ? `; ${missing.length} region name(s) unmatched` : "");
  return { kept, note };
}

const packages: unknown[] = [];
for (const entry of RELATIVES) {
  const taxa: unknown[] = [];
  for (const taxon of entry.taxa) {
    const usage = await readUsageOf(taxon.name);
    const readKey = `points:usage${usage.key}:${taxon.continents.join(",")}`;
    let read = cacheGet<{ points: Array<[number, number, string]>; total: number }>(readKey);
    if (!read) {
      read = await occurrencesOf(taxon, usage);
      cacheSet(readKey, read);
    }
    const screened = await screenToNative(taxon, read.points);
    const points = screened.kept;
    const total = read.total;
    console.log(`  ${taxon.name}: read as ${usage.name} (usage ${usage.key}, ${usage.status}); ${screened.note}`);
    // Cells are kept PER TAXON (W10). A package is a founder SET and it is
    // rich where its members CO-OCCUR: western Anatolia has wild einkorn but
    // not wild emmer, the south-eastern arc has einkorn, emmer and barley
    // together; green foxtail runs across Siberia, wild broomcorn millet
    // does not. Merging the taxa into one cloud threw that intersection
    // away and left the fitted envelope tracking whichever member had been
    // collected most — the survey-effort bias that put wheat's richest
    // ground in western Anatolia and millet's on the Kazakh steppe.
    const cells = new Map<string, { lon: number; lat: number; records: number; continent: string }>();
    for (const [lon, lat, continent] of points) {
      const key = `${Math.round(lon / GRID_DEGREES)}:${Math.round(lat / GRID_DEGREES)}`;
      const existing = cells.get(key);
      if (existing) existing.records += 1;
      else {
        cells.set(key, {
          lon: Math.round((Math.round(lon / GRID_DEGREES) * GRID_DEGREES) * 1000) / 1000,
          lat: Math.round((Math.round(lat / GRID_DEGREES) * GRID_DEGREES) * 1000) / 1000,
          records: 1,
          continent,
        });
      }
    }
    // Divide out the looking (W11). A cell's record count is abundance TIMES
    // collection effort; the family's own record count in the same ground is
    // that effort, so the ratio is what we actually want to know — how
    // common the plant is there. Uncorrected, a well-botanised region wins
    // for being well botanised: on the four cells that decide where millet
    // is domesticated, the raw counts put the Kazakh steppe and Omsk beside
    // the loess, and the corrected shares put north China above both.
    const familyKey = await familyKeyOf(taxon.name);
    // The target group has to be collected densely enough to measure effort
    // at all. A big family does that (the grasses); a small one does not —
    // enset's family left 1 of its 121 cells measurable — so where the
    // family cannot answer for most of a taxon's ground, the group widens to
    // all vascular plants. The choice is made ONCE PER TAXON, so every
    // cell's ratio carries the same denominator.
    const cellKey = (cell: { continent: string; lon: number; lat: number }) =>
      `${cell.continent}:${Math.floor(cell.lon / BACKGROUND_DEGREES)}:${Math.floor(cell.lat / BACKGROUND_DEGREES)}`;
    const measure = async (groupParam: string): Promise<Map<string, number>> => {
      const counts = new Map<string, number>();
      for (const cell of cells.values()) {
        const key = cellKey(cell);
        if (counts.has(key)) continue;
        counts.set(key, await backgroundOf(groupParam, cell.continent, cell.lon, cell.lat));
      }
      return counts;
    };
    let group = familyKey > 0 ? `familyKey=${familyKey}` : `phylumKey=${TRACHEOPHYTA_KEY}`;
    let backgrounds = await measure(group);
    const measurable = [...cells.values()]
      .filter((cell) => (backgrounds.get(cellKey(cell)) ?? 0) >= MIN_BACKGROUND_RECORDS).length;
    if (measurable * 2 < cells.size) {
      group = `phylumKey=${TRACHEOPHYTA_KEY}`;
      backgrounds = await measure(group);
    }
    let corrected = 0;
    for (const cell of cells.values()) {
      const background = backgrounds.get(cellKey(cell)) ?? 0;
      if (background >= MIN_BACKGROUND_RECORDS) corrected += cell.records / background;
    }
    // Each taxon then carries the same total weight, whatever its record
    // count: sampling effort differs by orders of magnitude between a
    // surveyed weed and a rare progenitor (green foxtail 14,589 records
    // against wild broomcorn millet's 384), and unnormalised weights let the
    // surveyed one decide where the package's envelope sits.
    const scale = corrected > 0 ? 1 / corrected : 0;
    const rows = [...cells.values()].map((cell) => {
      const background = backgrounds.get(cellKey(cell)) ?? 0;
      // A cell with too little botany in it keeps its place as an
      // observation — the plant IS there — but carries no weight in the fit.
      const weight = background >= MIN_BACKGROUND_RECORDS ? (cell.records / background) * scale : 0;
      return [cell.lon, cell.lat, Math.round(weight * 1e8) / 1e8] as [number, number, number];
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    taxa.push({
      name: taxon.name,
      // What GBIF was actually asked for. A name is not a taxon: `usageKey`
      // is the usage the records were read under and `read` is its canonical
      // name, so a bake that silently followed a synonym into the crop is
      // visible in the file rather than only in the counts (W16).
      usageKey: usage.key,
      read: usage.name,
      matchedStatus: usage.status,
      continents: taxon.continents,
      records: total,
      sampled: points.length,
      targetGroup: group,
      backgroundCells: backgrounds.size,
      weightedCells: rows.filter((row) => row[2] > 0).length,
      cells: rows,
    });
    console.error(`${entry.packageId} ${taxon.name}: ${total} records, ${points.length} read, ${cells.size} cells,`
      + ` ${backgrounds.size} background cells (${group}), ${rows.filter((row) => row[2] > 0).length} weighted`);
  }
  packages.push({ packageId: entry.packageId, note: entry.note, taxa });
}

writeFileSync("data/reality/crop-occurrences.json", `${JSON.stringify({
  source: "Each cell is [longitude, latitude, weight]: the weight is the taxon's record count in the cell DIVIDED BY the records of its whole family in the same ground (the target-group background, Phillips et al. 2009), normalised so every taxon of a package counts equally however well surveyed it is. A raw count is abundance times collection effort; the family's count is that effort, so the ratio so every taxon of a package counts equally however well surveyed it is, and it measures how COMMON the plant is there, which is what separates Harlan's massive stands from sporadic occurrences and is what the envelope is fitted against. GBIF occurrence records of each package's WILD progenitors, restricted to the continents the lineage is native to (GBIF's own continent field; the modern spread of a domesticate is thereby excluded — sunflower alone has 44,705 European records). Each taxon is read under the GBIF USAGE KEY recorded beside it as `usageKey`/`read`, never by name: a name query is answered with the ACCEPTED usage of that name, and for a wild subspecies that can be the crop — `Manihot esculenta subsp. flabellifolia` resolves to `Manihot esculenta`, cassava, and answered with 23,587 records of the modern planting map where the subspecies itself carries 1,448. A synonym is followed only where following does not move up the rank ladder. Coordinates are deduplicated to a 0.25-degree grid; the counts are the full matching totals, the sampled figures what this bake read. Cells are listed PER TAXON: the simulation fits an envelope to each member separately, and a package's stand richness is where its members CO-OCCUR — both the founder-package concept and the correction for per-species survey effort, since an intersection cannot be inflated by one over-collected member. No range is drawn.",
  citation: "GBIF.org occurrence search API, api.gbif.org/v1/occurrence/search. Individual dataset citations resolve through each record's datasetKey.",
  fetched: new Date().toISOString().slice(0, 10),
  gridDegrees: GRID_DEGREES,
  packages,
}, null, 1)}\n`);
console.error("wrote data/reality/crop-occurrences.json");
