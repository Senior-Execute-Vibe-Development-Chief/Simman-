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
  /**
   * W14: the relative change of the monthly fit on ground standing under water — positive for a
   * wetland crop (rice 1: the paddy doubles the upland crop), negative for one that drowns
   * (−0.35, the cereal waterlogging loss).
   * W15: the two halves are not read alike. The negative half is physiology and applies at every
   * technique; the positive half is husbandry — a paddy is impounded, levelled and transplanted,
   * so it is scaled by the cultivator's technique and a wild stand gets none of it. The published
   * wet-over-dry gains behind the positive numbers are managed-flooding yields for that reason.
   */
  readonly standingWaterResponse: number;
  readonly domLagY: number;
  readonly color: readonly number[];
}

export const CROP_PACKAGES: readonly CropPackage[];
export const CROP_BY_ID: Record<string, CropPackage>;
export function pkgClimateBell(pkg: CropPackage, temperature: number, moisture: number): number;
export function pkgTemperatureBell(pkg: CropPackage, temperature: number): number;
export function pkgMoistureBell(pkg: CropPackage, moisture: number): number;
