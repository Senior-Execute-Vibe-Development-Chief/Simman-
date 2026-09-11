export const CROSSING_LAND_LINK: number;
export const CROSSING_WIDTH_MASK: number;
export const CROSSING_DIRECTIONS: number;
export const CROSSING_GRIDS: Readonly<Record<string, string>>;
export function decodeCrossings(width: number, height: number): Uint8Array | null;
