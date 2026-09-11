export const FIRST_LAND_BYTE: number;
export const SHELF_BYTE: number;
export const COVER_LAND_SHARE: number;
export function hasGroundLink(crossings: Uint8Array, W: number, H: number, x: number, y: number): boolean;
export function coverByte(he: number, landFraction: number, groundLink: boolean): number;
