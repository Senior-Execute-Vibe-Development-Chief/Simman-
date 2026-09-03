import { HORIZON_OPENING_YEAR, MONTHS_PER_YEAR } from "./constants";

/**
 * The world clock is months from the opening (the end of the Younger Dryas).
 * The calendar year is a read-only label derived from it (R1); these
 * conversions exist for display, provenance, and for turning a player's
 * chosen starting epoch into an initial condition.
 */
export function stepFromYear(year: number): number {
  return Math.round((year - HORIZON_OPENING_YEAR) * MONTHS_PER_YEAR);
}

export function yearFromStep(step: number): number {
  return HORIZON_OPENING_YEAR + step / MONTHS_PER_YEAR;
}

/**
 * `config.wake` is an initial condition, never a mechanism input: "auto"
 * (default) wakes the monthly kernel at the first caged basin; "never" keeps
 * the solve regime to the end of the horizon (a measurement mode); a year
 * wakes the world at that year, the player's chosen epoch. Returned as the
 * world step the wake is due at: undefined for auto, +Infinity for never.
 */
export function wakeTargetStep(config: Readonly<Record<string, string | number | boolean>>): number | undefined {
  const setting = config.wake;
  if (setting === undefined || setting === "auto") return undefined;
  if (setting === "never") return Number.POSITIVE_INFINITY;
  const year = typeof setting === "number" ? setting : Number(setting);
  if (!Number.isFinite(year)) return undefined;
  return stepFromYear(year);
}
