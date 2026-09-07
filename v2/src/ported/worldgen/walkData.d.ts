export const WALK_DETOUR_UNIT: number;
export const WALK_VERTICAL_UNIT_M: number;
export const WALK_DIRECTIONS: number;
export const WALK_SOURCE_COLS: number;
export const WALK_SOURCE_ROWS: number;
export const WALK_GRIDS: Readonly<Record<string, { readonly tables: string; readonly waypoints: string }>>;
export function decodeWalks(width: number, height: number): { detour: Uint8Array; up: Uint16Array; down: Uint16Array } | null;
export function decodeWaypoints(width: number, height: number): Map<number, Uint8Array> | null;
