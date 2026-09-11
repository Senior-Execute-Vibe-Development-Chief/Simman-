/**
 * Does a candidate quantity SEPARATE the real centres of domestication from
 * the places that never domesticated? (W12)
 *
 * The two-sided test. Earth's ten cited centres really did domesticate their
 * crops, so on an accurate Earth map a correct hearth score must pass every
 * one of them; the places the sim lights wrongly really did not, so it must
 * reject every one of those. A quantity that cannot do both is not the
 * missing term, and no threshold on it will ever be the fix.
 *
 * Run this BEFORE building a mechanism, not after. Three mechanisms were
 * built and reverted for want of it (QUESTIONS #44, #46): the answer is
 * static, costs no simulation, and takes seconds at either grid.
 *
 *   npx tsx tools/hearth-separation.ts [dev|target]
 *
 * Measured so far, at BOTH grids: stand capacity, farming gain and a
 * lean-season index all FAIL the test, and fail inverted — the Fertile
 * Crescent, the Yangtze and the Sahel score below every false positive.
 */
import hearthCentres from "../data/reality/hearths.json";
import { CROP_PACKAGES } from "../src/ported/worldgen/cropPackages.js";
import { buildSubstrate } from "../src/sim/substrate";
import { packageCapacityAt } from "../src/sim/people/crop";
import type { PeopleWorld } from "../src/sim/people/types";
import { World, type GridPreset } from "../src/sim/world";
import { ensurePeopleWasm } from "../src/sim/peopleKernel";
import { MONTHS_PER_YEAR } from "../src/sim/constants";

if (!await ensurePeopleWasm()) throw new Error("wasm");
const grid = (process.argv[2] ?? "dev") as GridPreset;
const substrate = buildSubstrate(42042, { preset: "earth_sim" }, grid);
const w = new World({ seed: 42042, grid, config: { preset: "earth_sim", horizon: "YD-to-1CE", peopleKernel: "wasm" }, substrate }) as unknown as PeopleWorld;
const ll = (c: number) => { const y = Math.floor(c / w.width); const x = c - y * w.width; return { lat: 90 - ((y + 0.5) / w.height) * 180, lon: ((x + 0.5) / w.width) * 360 - 180 }; };

// Absolute quantities per cell, no per-package normalisation anywhere.
interface Row { stand: number; gain: number; forager: number; lean: number; fit: number; alt: number; lat: number; lon: number; }

// A generic month-by-month plant-growth proxy: warmth times water, neither
// tuned to any outcome. LEAN = 1 - (leanest month / mean month): 0 where the
// land feeds you the same all year, ->1 where it feeds you in one short pulse.
function leanOf(cell: number): number {
  let sum = 0; let min = Infinity;
  for (let m = 0; m < MONTHS_PER_YEAR; m++) {
    const i = cell * MONTHS_PER_YEAR + m;
    const t = w.substrate.climate.temperature[i] ?? 0;
    const q = w.substrate.climate.moisture[i] ?? 0;
    const warmth = Math.max(0, Math.min(1, t / 20));
    const water = Math.max(0, Math.min(1, q));
    const v = warmth * water;
    sum += v; if (v < min) min = v;
  }
  const mean = sum / MONTHS_PER_YEAR;
  return mean > 0 ? 1 - min / mean : 1;
}
function best(p: number, lat0: number, lon0: number, r: number): Row | null {
  const nat = w._nativeCells[p]; const sc = w._standCapacity[p];
  if (!nat || !sc) return null;
  let out: Row | null = null;
  for (const packed of Array.from(nat as ArrayLike<number>)) {
    const cell = w._landCells[packed] ?? 0;
    const a = ll(cell);
    const dLon = Math.abs(((a.lon - lon0 + 540) % 360) - 180);
    if (dLon > r || Math.abs(a.lat - lat0) > r) continue;
    const stand = Number(sc[packed] ?? 0);
    const forager = w._foragerCapacity[cell] ?? 0;
    const gain = packageCapacityAt(w, cell, p, 0) - forager;
    const fit = Number(w._cropFit?.[p]?.[packed] ?? 0);
    // ALT: everything there is to eat here that ISN'T this crop — fish, game,
    // other plants. The "affluent forager" axis. Domestication should want a
    // good crop AND poor alternatives; the model currently ties the two.
    const alt = Math.max(0, forager - stand);
    if (!out || stand > out.stand) out = { stand, gain, forager, lean: leanOf(cell), fit, alt, lat: a.lat, lon: a.lon };
  }
  return out;
}
const idx = (id: string) => CROP_PACKAGES.findIndex((k) => k.id === id);

/** Every cell of a package inside a box, not just the best — the bar has to admit and reject cells. */
function rowsIn(p: number, lat0: number, lon0: number, r: number): Row[] {
  const nat = w._nativeCells[p]; const sc = w._standCapacity[p];
  if (!nat || !sc) return [];
  const out: Row[] = [];
  for (const packed of Array.from(nat as ArrayLike<number>)) {
    const cell = w._landCells[packed] ?? 0;
    const a = ll(cell);
    const dLon = Math.abs(((a.lon - lon0 + 540) % 360) - 180);
    if (dLon > r || Math.abs(a.lat - lat0) > r) continue;
    const stand = Number(sc[packed] ?? 0);
    if (stand <= 0) continue;
    const forager = w._foragerCapacity[cell] ?? 0;
    const gain = packageCapacityAt(w, cell, p, 0) - forager;
    if (gain <= 0) continue;
    const fit = Number(w._cropFit?.[p]?.[packed] ?? 0);
    const alt = Math.max(0, forager - stand);
    out.push({ stand, gain, forager, lean: leanOf(cell), fit, alt, lat: a.lat, lon: a.lon });
  }
  return out;
}

/** Places the sim lights that never domesticated anything. */
const FALSE: Array<[string, string, number, number]> = [
  ["millet", "Kazakh steppe", 45.8, 77.3], ["millet", "N Kazakhstan", 50.3, 68.3],
  ["millet", "Korea", 36.8, 129.8], ["millet", "Caucasus", 44.3, 38.2],
  ["rice", "Bengal", 23.3, 89.3], ["rice", "Andhra", 16.9, 81.9],
  ["tubers", "Venezuela", 8.3, -62.2], ["tubers", "NE Brazil", -9.7, -35.2],
  ["highland-roots", "Congo", -6.7, 15.7], ["highland-roots", "Kenya", -0.7, 35.3],
  ["highland-roots", "Angola", -12.7, 17.3], ["new-guinea-roots", "New Ireland", -3.1, 151.7],
];

const cited = new Map<string, Row[]>();
const wrong = new Map<string, Row[]>();
for (const c of hearthCentres.centres as any[]) {
  const p = idx(c.packageId); if (p < 0) continue;
  const r = c.radiusDegrees ?? (hearthCentres as any).radiusDegrees;
  const rows = rowsIn(p, c.latitude, c.longitude, r);
  if (rows.length > 0) cited.set(c.packageId, [...(cited.get(c.packageId) ?? []), ...rows]);
}
for (const [pid, , lat, lon] of FALSE) {
  const p = idx(pid); if (p < 0) continue;
  const rows = rowsIn(p, lat, lon, 1.5);
  if (rows.length > 0) wrong.set(pid, [...(wrong.get(pid) ?? []), ...rows]);
}

/**
 * A candidate score SEPARATES a package when a threshold exists that admits
 * its real centre and rejects every false hearth of the same crop: the best
 * cited cell must outscore the best false one. Compared WITHIN crop only —
 * a wheat number beside a manioc number means nothing (QUESTIONS #48).
 */
const CANDIDATES: Array<[string, (r: Row) => number]> = [
  ["stand x gain (current)", (r) => r.stand * r.gain],
  ["share x gain", (r) => (r.forager > 0 ? r.stand / r.forager : 0) * r.gain],
  ["stand x gain / alt", (r) => (r.alt > 0 ? (r.stand * r.gain) / r.alt : 0)],
  ["gain / alt", (r) => (r.alt > 0 ? r.gain / r.alt : 0)],
  ["stand / alt", (r) => (r.alt > 0 ? r.stand / r.alt : 0)],
  ["stand x gain x lean", (r) => r.stand * r.gain * r.lean],
  ["stand x gain / (alt x fit)", (r) => (r.alt > 0 && r.fit > 0 ? (r.stand * r.gain) / (r.alt * r.fit) : 0)],
  // Composites: gain/alt is the only term that SEPARATES (it answers "is
  // farming worth it against the fallback"), stand is the only one that keeps
  // hearths TIGHT (it answers "is the belt dense here"). Give them separate
  // jobs rather than one product and see whether both properties survive.
  ["stand x gain^2 / alt", (r) => (r.alt > 0 ? (r.stand * r.gain * r.gain) / r.alt : 0)],
  ["stand x (gain/alt)^2", (r) => (r.alt > 0 ? r.stand * (r.gain / r.alt) ** 2 : 0)],
  ["sqrt(stand) x gain / alt", (r) => (r.alt > 0 ? Math.sqrt(r.stand) * r.gain / r.alt : 0)],
  ["stand^0.25 x gain / alt", (r) => (r.alt > 0 ? r.stand ** 0.25 * r.gain / r.alt : 0)],
];

console.log(`grid=${grid}  ${w.width}x${w.height}`);
console.log(`\nPackages with a false hearth to reject: ${[...wrong.keys()].join(", ")}`);
console.log("\ncandidate score              separates  cells>bar  detail");
for (const [name, f] of CANDIDATES) {
  const verdicts: string[] = [];
  let passed = 0; let total = 0; let above = 0;
  for (const [pid, bad] of wrong) {
    const good = cited.get(pid);
    if (!good || good.length === 0) continue;
    total++;
    const bestGood = Math.max(...good.map(f));
    const bestBad = Math.max(...bad.map(f));
    const ok = bestGood > bestBad;
    if (ok) passed++;
    verdicts.push(`${pid} ${ok ? "PASS" : "fail"}`);
    // SPREAD, the measurement #44 lacked: with the bar set at the lowest
    // level that rejects every known false hearth of this crop, how many
    // cells of the whole package still clear it? Each is a hearth waiting to
    // light, so a score can separate perfectly and still flood the map.
    const p = idx(pid);
    const nat = w._nativeCells[p];
    if (nat) for (const packed of Array.from(nat as ArrayLike<number>)) {
      const cell = w._landCells[packed] ?? 0;
      const stand = Number(w._standCapacity[p]?.[packed] ?? 0);
      if (stand <= 0) continue;
      const forager = w._foragerCapacity[cell] ?? 0;
      const gain = packageCapacityAt(w, cell, p, 0) - forager;
      if (gain <= 0) continue;
      const row: Row = { stand, gain, forager, lean: leanOf(cell), fit: Number(w._cropFit?.[p]?.[packed] ?? 0), alt: Math.max(0, forager - stand), lat: 0, lon: 0 };
      if (f(row) > bestBad) above++;
    }
  }
  console.log(`${name.padEnd(28)} ${String(passed)}/${String(total)}   ${String(above).padStart(6)}    ${verdicts.join(", ")}`);
}
