/* V2 W23 — WHICH CELLS ARE LAND, read off the 1-arc-minute measurements.
 *
 * The coarse elevation byte's land bit is a height-weighted vote over a
 * 6-arc-minute raster; the cover plane (landCoverData.js) says how much of the
 * cell is land by the fine source, and the crossing table (crossingData.js)
 * says whether the land in a cell is JOINED to the land in each neighbour.
 * The bit stands except where the fine measurement contradicts it:
 *   - a cell the byte calls LAND whose land is under half the cell AND joins
 *     no neighbour's land is water — an islet, or the water the coarse grid
 *     sealed and landed (the Azov). Land that joins a neighbour's is a shore
 *     of the body it belongs to, however little of the cell it fills (the
 *     Cyclades, a fjord coast, an island astride a cell edge), and stays;
 *   - a cell the byte calls SEA that is at least half land by the cover is
 *     land — a dry floor below the datum, a delta the byte rounded away. A
 *     sea cell holding a sliver of joined shore stays sea: that is the water
 *     a coast is sailed on, and the sliver is charged as cover (W19a).
 *
 * The result is a BYTE on the coarse bake's own scale, so a cell whose two
 * readings agree keeps its elevation to the bit: a cell turning water takes
 * the shelf byte (the shallowest sea the raster has), a cell turning land the
 * minimum land byte (what the coarse bake gives polders). No place is named.
 */
import { CROSSING_DIRECTIONS, CROSSING_LAND_LINK } from "./crossingData.js";

/** The coarse bake's first land byte; below it the raster is sea. */
export const FIRST_LAND_BYTE = 3;
/** The shallowest sea byte, one below the first land byte. */
export const SHELF_BYTE = FIRST_LAND_BYTE - 1;
/** The cover share at and above which a cell is land on its own. */
export const COVER_LAND_SHARE = 0.5;

// The four stored directions per cell (E, SE, S, SW) and, for the other four,
// the neighbour whose stored entry is this cell's edge: W is the west
// neighbour's E, NW is the north-west neighbour's SE, N the north's S, NE the
// north-east's SW.
const OWN = [[1, 0, 0], [1, 1, 1], [0, 1, 2], [-1, 1, 3]];
const MIRROR = [[-1, 0, 0], [-1, -1, 1], [0, -1, 2], [1, -1, 3]];

/** Whether the land in cell (x, y) is joined by ground to any neighbour's. */
export function hasGroundLink(crossings, W, H, x, y) {
  const own = (y * W + x) * CROSSING_DIRECTIONS;
  for (let d = 0; d < OWN.length; d++) {
    const ny = y + OWN[d][1];
    if (ny < 0 || ny >= H) continue;
    if (crossings[own + OWN[d][2]] & CROSSING_LAND_LINK) return true;
  }
  for (let d = 0; d < MIRROR.length; d++) {
    const ny = y + MIRROR[d][1];
    if (ny < 0 || ny >= H) continue;
    const nx = (x + MIRROR[d][0] + W) % W;
    if (crossings[(ny * W + nx) * CROSSING_DIRECTIONS + MIRROR[d][2]] & CROSSING_LAND_LINK) return true;
  }
  return false;
}

/** The height byte the cell is read at: `he` unchanged where the readings
 * agree, the shelf byte for a cell turning water, the first land byte for a
 * cell turning land. */
export function coverByte(he, landFraction, groundLink) {
  const mostlyLand = landFraction >= COVER_LAND_SHARE;
  if (he >= FIRST_LAND_BYTE) return mostlyLand || groundLink ? he : SHELF_BYTE;
  return mostlyLand ? FIRST_LAND_BYTE : he;
}
