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
interface Row { stand: number; gain: number; forager: number; lean: number; fit: number; lat: number; lon: number; }

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
    if (!out || stand > out.stand) out = { stand, gain, forager, lean: leanOf(cell), fit, lat: a.lat, lon: a.lon };
  }
  return out;
}
const idx = (id: string) => CROP_PACKAGES.findIndex((k) => k.id === id);
console.log(`grid=${grid}  ${w.width}x${w.height}`);
console.log("\n=== REAL CENTRES (these DID domesticate; a correct bar must pass every one) ===");
console.log("centre                   package            stand    gain   forager  LEAN   FIT    where");
for (const c of hearthCentres.centres as any[]) {
  const p = idx(c.packageId); if (p < 0) continue;
  const r = c.radiusDegrees ?? (hearthCentres as any).radiusDegrees;
  const b = best(p, c.latitude, c.longitude, r);
  console.log(`${c.id.padEnd(24)} ${c.packageId.padEnd(18)} ${b ? `${b.stand.toFixed(4)}  ${b.gain.toFixed(4)}  ${b.forager.toFixed(3)}  ${b.lean.toFixed(3)}  ${b.fit.toFixed(3)}  ${b.lat.toFixed(1)}N ${b.lon.toFixed(1)}E` : "NO NATIVE CELL"}`);
}
console.log("\n=== FALSE HEARTHS (these did NOT; a correct bar must reject every one) ===");
const FALSE: Array<[string, string, number, number]> = [
  ["millet", "Kazakh steppe", 45.8, 77.3], ["millet", "N Kazakhstan", 50.3, 68.3],
  ["millet", "Korea", 36.8, 129.8], ["millet", "Caucasus", 44.3, 38.2],
  ["rice", "Bengal", 23.3, 89.3], ["rice", "Andhra", 16.9, 81.9],
  ["tubers", "Venezuela", 8.3, -62.2], ["tubers", "NE Brazil", -9.7, -35.2],
  ["highland-roots", "Congo", -6.7, 15.7], ["highland-roots", "Kenya", -0.7, 35.3],
  ["highland-roots", "Angola", -12.7, 17.3], ["new-guinea-roots", "New Ireland", -3.1, 151.7],
];
console.log("package            where              stand    gain   forager  LEAN   FIT");
for (const [pid, name, lat, lon] of FALSE) {
  const p = idx(pid); if (p < 0) continue;
  const b = best(p, lat, lon, 1.5);
  console.log(`${pid.padEnd(18)} ${name.padEnd(16)} ${b ? `${b.stand.toFixed(4)}  ${b.gain.toFixed(4)}  ${b.forager.toFixed(3)}  ${b.lean.toFixed(3)}  ${b.fit.toFixed(3)}` : "no native cell"}`);
}
