export const PASS_CLIMB_M_PER_BYTE: number;
export const PASS_CLIMB_DIRECTIONS: number;
export const PASS_CLIMB_GRIDS: Readonly<Record<string, string>>;
export function decodePassClimb(width: number, height: number): Uint8Array | null;
