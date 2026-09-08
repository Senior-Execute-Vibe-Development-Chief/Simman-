export function classifyBiome(
  elevation: number,
  moisture: number,
  temperature: number,
  dryFraction: number,
  summerDry: number,
): number;
export const B_TUNDRA: number;
export const B_ICE: number;
export const B_TAIGA: number;
export const B_BOREAL: number;
export const B_TEMP_FOREST: number;
export const B_TEMP_RAIN: number;
export const B_TROP_RAIN: number;
export const B_SAVANNA: number;
export const B_GRASSLAND: number;
export const B_DESERT: number;
export const B_SHRUBLAND: number;
export const B_TROP_DRY: number;
export const B_ALPINE: number;
export const B_SUBTROP: number;
export const B_COLD_DESERT: number;
export const B_FLOODPLAIN: number;
export const B_MEDITERRANEAN: number;
/** Holdridge biotemperature, °C, from the sim temperature unit (t = 0.6 + °C/100), capped at 30. */
export function bioTemp(t: number): number;
/** Evaporative demand normalised to tropical PET, from the sim temperature unit: 0.13 at the pole, 1 at 30 °C biotemperature. */
export function demand(t: number): number;
