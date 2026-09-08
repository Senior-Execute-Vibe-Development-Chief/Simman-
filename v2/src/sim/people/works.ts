import {
  MONTHS_PER_YEAR,
  PEOPLE_WORKS_BUILD_PER_YEAR,
  PEOPLE_WORKS_DECAY_PER_YEAR,
  PEOPLE_WORKS_PRESSURE_FLOOR,
  PEOPLE_WORKS_SKILL_FLOOR,
  PEOPLE_WORKS_STAFF_FLOOR,
} from "../constants";
import type { PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The works pass (W28): the built land capital, v1's LAND_WORKS phase ported
 * as the field kernel it is. Capacity was never a fixed property of terrain:
 * under pressure people invested labour in the land itself — canals,
 * terraces, drainage, paddy levelling — and that capital accumulated in
 * place over centuries and rotted where the hands that kept it left.
 *
 * - BUILD where the cell's people press their ceiling (fill above the
 *   Boserup threshold: intensification once extensification is exhausted),
 *   on ground water can be led onto or a climate wet enough to drain and
 *   level (`_irrigable`, static), at the skill of the people there — the
 *   farmed share, the technique state M3a carries (v1 read its development
 *   field). Purely local state: no clock, no named place.
 * - ROT where the fill is below the staffing floor, in proportion to the
 *   missing hands: a die-off or an exodus leaves a scar that must be rebuilt.
 * - EFFECT, in `packageCapacity`: the crop ×(1 + gain × works). Self-
 *   limiting — building raises the ceiling, which lowers the fill, which
 *   slows the building; the migration law then pulls people into the
 *   improved basin, which is the hotspot.
 *
 * Runs on the firing's committed people and derived capacity; the caller
 * derives the capacity again at once, so the multiplier is in the room the
 * next month's movement sees. Both kernels evaluate the same expression in
 * the same order, so the field is bit-identical between them.
 */
export function stepWorks(world: PeopleWorld, dtMonths = MONTHS_PER_YEAR): void {
  if (world._wasmPeopleKernel) {
    world._wasmPeopleKernel.buildWorks(dtMonths);
    return;
  }
  const build = PEOPLE_WORKS_BUILD_PER_YEAR * dtMonths / MONTHS_PER_YEAR;
  const decay = PEOPLE_WORKS_DECAY_PER_YEAR * dtMonths / MONTHS_PER_YEAR;
  for (let packed = 0; packed < world._landCells.length; packed++) {
    const cell = world._landCells[packed] ?? 0;
    const improvable = world._irrigable[cell] ?? 0;
    let works = world.works[cell] ?? 0;
    // Dry, unimproved ground: nothing to build or to rot.
    if (improvable <= 0 && works <= 0) continue;
    const capacity = world.capField[cell] ?? 0;
    const fill = capacity > 0 ? (world.people[cell] ?? 0) / capacity : 0;
    if (improvable > 0 && fill > PEOPLE_WORKS_PRESSURE_FLOOR) {
      const skill = world.technique[cell] ?? 0;
      if (skill > PEOPLE_WORKS_SKILL_FLOOR) works += build * (fill - PEOPLE_WORKS_PRESSURE_FLOOR) * skill * improvable;
    }
    const staffed = fill > PEOPLE_WORKS_STAFF_FLOOR ? 1 : fill / PEOPLE_WORKS_STAFF_FLOOR;
    if (staffed < 1) works -= decay * (1 - staffed) * works;
    world.works[cell] = clamp01(works);
  }
}
