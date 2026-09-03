export interface CropPackage {
  readonly id: string;
  readonly name: string;
  readonly tOpt: number;
  readonly tTol: number;
  readonly tTolEarly?: number;
  readonly mOpt: number;
  readonly mTol: number;
  readonly baseTemperature: number;
  readonly seasonMinimumMonths: number;
  readonly storability: number;
  readonly yield: number;
  readonly domLagY: number;
  /** Wild-habitat envelope (W8): where the progenitor forms dense stands, on the annual climate indices. */
  readonly tOptWild: number;
  readonly tTolWild: number;
  readonly mOptWild: number;
  readonly mTolWild: number;
  readonly color: readonly number[];
}

export const CROP_PACKAGES: readonly CropPackage[];
export const CROP_BY_ID: Record<string, CropPackage>;
export function pkgClimateBell(pkg: CropPackage, temperature: number, moisture: number): number;
export function pkgWildBell(pkg: CropPackage, temperature: number, moisture: number): number;
export function pkgTemperatureBell(pkg: CropPackage, temperature: number): number;
export function pkgMoistureBell(pkg: CropPackage, moisture: number): number;
