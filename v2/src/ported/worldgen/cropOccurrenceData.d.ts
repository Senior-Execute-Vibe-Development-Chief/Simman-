export function occurrenceCellsOf(packageId: string, width: number, height: number): Array<{ cell: number; records: number }>;
export function occurrenceProvenance(packageId: string): { taxa: unknown[]; cells: number } | undefined;
export const CROP_OCCURRENCE_SOURCE: string;
export const CROP_OCCURRENCE_CITATION: string;
