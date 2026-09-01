import hearthData from "../../../data/reality/hearths.json";
import {
  DEG_TO_RAD,
  EARTH_CIRCUMFERENCE_KM,
  EARTH_DEGREES,
  EARTH_HALF_DEGREES,
  EARTH_MERIDIONAL_KM,
  MATH_NEGATIVE_ONE,
  PEOPLE_HEARTH_BASIN_RADIUS_KM,
  PEOPLE_HEARTH_ELEVATION_SCALE,
  PEOPLE_HEARTH_FALLBACK_LAG_YEARS,
  PEOPLE_HEARTH_LAG_RANGE_YEARS,
  PEOPLE_HEARTH_MAX_COUNT,
  PEOPLE_HEARTH_MIN_SEPARATION_KM,
  PEOPLE_HEARTH_SCORE_REFERENCE,
  PEOPLE_HEARTH_SCORE_CIRCUMSCRIPTION_GAIN,
  PEOPLE_HEARTH_SCORE_FERTILITY_GAIN,
  PEOPLE_HEARTH_SCORE_RIVER_GAIN,
  PEOPLE_HEARTH_SCORE_SEA_PENALTY,
  PEOPLE_HEARTH_SEARCH_FRACTION,
  PEOPLE_HEARTH_SUITABILITY_FLOOR,
  PEOPLE_RIVER_ACCESS_DIVISOR,
  PEOPLE_TECHNIQUE_CLIMATE_FLOOR,
  PEOPLE_TECHNIQUE_PRESENT,
  PEOPLE_TECHNIQUE_WAVE_KMPY,
  MONTHS_PER_YEAR,
  TRAVEL_HALF,
} from "../constants";
import { dcos } from "../dmath";
import { CROP_PACKAGES, pkgClimateBell } from "../../ported/worldgen/cropPackages.js";
import type { PeopleWorld, HearthState } from "./types";

interface HearthPin {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly packageId: string;
  readonly domesticationLagYears: number;
}

interface HearthFixture {
  readonly source: string;
  readonly hearths: readonly HearthPin[];
}

const fixtures = hearthData as HearthFixture;
const NEIGHBOR_DX = [0, 0, MATH_NEGATIVE_ONE, 1] as const;
const NEIGHBOR_DY = [MATH_NEGATIVE_ONE, 1, 0, 0] as const;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function peopled(world: PeopleWorld, cell: number): boolean {
  return world._peopledMask[cell] === 1;
}

/** Per-row 4-neighbor edge lengths, edgeKm's exact arithmetic for |d|=1. */
function fillTechniqueEdgeLengths(world: PeopleWorld): void {
  const horizontal = new Float64Array(world.height);
  const northSouth = EARTH_MERIDIONAL_KM / world.height;
  for (let y = 0; y < world.height; y++) {
    // 90 - 180*f, matching travel/cost.ts row geometry: the ported edgeKm
    // used the full-circle span here, zeroing horizontal edges south of 45N.
    const eastWest = EARTH_CIRCUMFERENCE_KM / world.width
      * Math.max(0, dcos(
        (EARTH_HALF_DEGREES * TRAVEL_HALF
          - ((y + TRAVEL_HALF) / world.height) * EARTH_HALF_DEGREES) * DEG_TO_RAD,
      ));
    horizontal[y] = Math.sqrt((1 * eastWest) * (1 * eastWest) + (0 * northSouth) * (0 * northSouth));
  }
  world._techniqueEdgeH = horizontal;
  world._techniqueEdgeV = Math.sqrt((0 * 0) * (0 * 0) + (1 * northSouth) * (1 * northSouth));
}

function cellAt(world: PeopleWorld, latitude: number, longitude: number): number {
  const x = ((longitude + EARTH_HALF_DEGREES) / EARTH_DEGREES * world.width) % world.width;
  // Latitude spans 180 degrees, not 360: the original EARTH_DEGREES here put
  // every hearth pin at HALF its real latitude (the Fertile Crescent ignited
  // in Yemen, the Nile in the Sahara) — measured on the first YD->1 CE run.
  const y = Math.max(
    0,
    Math.min(world.height - 1, (EARTH_HALF_DEGREES * TRAVEL_HALF - latitude) / EARTH_HALF_DEGREES * world.height),
  );
  return Math.floor(y) * world.width + Math.floor((x + world.width) % world.width);
}

function landNear(world: PeopleWorld, center: number, radius: number): number {
  const substrate = world.substrate;
  if (substrate.landMask[center]) return center;
  const cy = Math.floor(center / world.width);
  const cx = center - cy * world.width;
  let best = center;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= world.height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = (cx + dx + world.width) % world.width;
      const candidate = y * world.width + x;
      if (!substrate.landMask[candidate]) continue;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function climateSuitability(world: PeopleWorld, cell: number): number {
  if (world._techniqueSuitability.length === world.N) {
    return world._techniqueSuitability[cell] ?? 0;
  }
  const temperature = world._annualTemperature[cell] ?? 0;
  const moisture = world._annualMoisture[cell] ?? 0;
  let best = 0;
  for (const pkg of CROP_PACKAGES) {
    const fit = pkgClimateBell(pkg, temperature, moisture);
    if (fit > best) best = fit;
  }
  return best;
}

function packageAt(world: PeopleWorld, cell: number): string {
  const temperature = world._annualTemperature[cell] ?? 0;
  const moisture = world._annualMoisture[cell] ?? 0;
  let bestId = CROP_PACKAGES[0]?.id ?? "wheat";
  let bestFit = 0;
  for (const pkg of CROP_PACKAGES) {
    const fit = pkgClimateBell(pkg, temperature, moisture);
    if (fit > bestFit) {
      bestFit = fit;
      bestId = pkg.id;
    }
  }
  return bestId;
}

function fillTechniqueSuitability(world: PeopleWorld): void {
  const target = world._techniqueSuitability;
  for (let cell = 0; cell < world.N; cell++) {
    const temperature = world._annualTemperature[cell] ?? 0;
    const moisture = world._annualMoisture[cell] ?? 0;
    let best = 0;
    for (const pkg of CROP_PACKAGES) {
      const fit = pkgClimateBell(pkg, temperature, moisture);
      if (fit > best) best = fit;
    }
    target[cell] = best;
  }
}

function scoreAt(world: PeopleWorld, cell: number): number {
  const substrate = world.substrate;
  const fertility = clamp01(substrate.fertility[cell] ?? 0);
  const crop = climateSuitability(world, cell);
  if (crop < PEOPLE_HEARTH_SUITABILITY_FLOOR) return 0;
  const river = clamp01(
    (substrate.rivers.magnitude[cell] ?? 0) / PEOPLE_RIVER_ACCESS_DIVISOR
    + (substrate.floodplain[cell] ?? 0),
  );
  const lowland = 1 - clamp01(
    (substrate.elevation[cell] ?? 0) / PEOPLE_HEARTH_ELEVATION_SCALE,
  );
  const enclosed = clamp01(
    1 - (substrate.coastDistanceKm[cell] ?? 0) / PEOPLE_HEARTH_BASIN_RADIUS_KM,
  );
  const seaPenalty = substrate.coast[cell]
    ? PEOPLE_HEARTH_SCORE_SEA_PENALTY * clamp01(
      1 - (substrate.coastDistanceKm[cell] ?? 0) / PEOPLE_HEARTH_BASIN_RADIUS_KM,
    )
    : 0;
  return Math.max(
    0,
    PEOPLE_HEARTH_SCORE_FERTILITY_GAIN * fertility
      + PEOPLE_HEARTH_SCORE_RIVER_GAIN * river
      + PEOPLE_HEARTH_SCORE_CIRCUMSCRIPTION_GAIN * (lowland + enclosed)
      + crop
      - seaPenalty,
  );
}

function separated(world: PeopleWorld, candidate: number, chosen: readonly number[]): boolean {
  const candidateY = Math.floor(candidate / world.width);
  const candidateX = candidate - candidateY * world.width;
  const cellKm = EARTH_CIRCUMFERENCE_KM / world.width;
  const minimum = PEOPLE_HEARTH_MIN_SEPARATION_KM / cellKm;
  for (const other of chosen) {
    const otherY = Math.floor(other / world.width);
    const otherX = other - otherY * world.width;
    const rawDx = Math.abs(candidateX - otherX);
    const dx = Math.min(rawDx, world.width - rawDx);
    const dy = candidateY - otherY;
    if (Math.sqrt(dx * dx + dy * dy) < minimum) return false;
  }
  return true;
}

function pinnedHearths(world: PeopleWorld): HearthState[] {
  if (world.substrate.preset !== "earth" && world.substrate.preset !== "earth_sim") return [];
  const search = Math.max(
    1,
    Math.round(world.width * PEOPLE_HEARTH_SEARCH_FRACTION),
  );
  const chosen: number[] = [];
  const result: HearthState[] = [];
  for (const pin of fixtures.hearths) {
    const cell = landNear(world, cellAt(world, pin.latitude, pin.longitude), search);
    if (!world.substrate.landMask[cell] || !separated(world, cell, chosen)) continue;
    chosen.push(cell);
    result.push({
      id: pin.id,
      cell,
      packageId: pin.packageId,
      lagYears: pin.domesticationLagYears,
      score: scoreAt(world, cell),
      armedYears: 0,
      ignited: false,
    });
  }
  return result;
}

function scoredHearths(world: PeopleWorld, existing: readonly HearthState[]): HearthState[] {
  const candidates: Array<{ cell: number; score: number }> = [];
  const remaining = Math.max(0, PEOPLE_HEARTH_MAX_COUNT - existing.length);
  for (let cell = 0; cell < world.N; cell++) {
    if (!world.substrate.landMask[cell] || !peopled(world, cell)) continue;
    const score = scoreAt(world, cell);
    if (score <= 0 || remaining <= 0) continue;
    if (candidates.length < remaining) {
      candidates.push({ cell, score });
      continue;
    }
    let lowest = 0;
    for (let index = 1; index < candidates.length; index++) {
      if ((candidates[index]?.score ?? 0) < (candidates[lowest]?.score ?? 0)) lowest = index;
    }
    if (score > (candidates[lowest]?.score ?? 0)) candidates[lowest] = { cell, score };
  }
  candidates.sort((left, right) => right.score - left.score || left.cell - right.cell);
  const chosen = existing.map((hearth) => hearth.cell);
  const result: HearthState[] = [];
  for (const candidate of candidates) {
    if (existing.length + result.length >= PEOPLE_HEARTH_MAX_COUNT) break;
    if (!separated(world, candidate.cell, chosen)) continue;
    chosen.push(candidate.cell);
    result.push({
      id: `scored-${candidate.cell}`,
      cell: candidate.cell,
      packageId: packageAt(world, candidate.cell),
      lagYears: PEOPLE_HEARTH_FALLBACK_LAG_YEARS
        + (1 - clamp01(candidate.score / PEOPLE_HEARTH_SCORE_REFERENCE))
        * PEOPLE_HEARTH_LAG_RANGE_YEARS,
      score: candidate.score,
      armedYears: 0,
      ignited: false,
    });
  }
  return result;
}

export function chooseHearths(world: PeopleWorld): HearthState[] {
  const pinned = pinnedHearths(world);
  return [...pinned, ...scoredHearths(world, pinned)];
}

function neighbor(world: PeopleWorld, cell: number, dx: number, dy: number): number {
  const y = Math.floor(cell / world.width);
  const x = cell - y * world.width;
  const targetY = y + dy;
  if (targetY < 0 || targetY >= world.height) return MATH_NEGATIVE_ONE;
  return targetY * world.width + ((x + dx + world.width) % world.width);
}

function spreadSuitability(world: PeopleWorld, cell: number): number {
  const fit = climateSuitability(world, cell);
  return fit < PEOPLE_TECHNIQUE_CLIMATE_FLOOR ? 0 : fit;
}

function basinFill(world: PeopleWorld, cell: number): number {
  const radius = Math.max(
    1,
    Math.round(PEOPLE_HEARTH_BASIN_RADIUS_KM / (EARTH_CIRCUMFERENCE_KM / world.width)),
  );
  const y = Math.floor(cell / world.width);
  const x = cell - y * world.width;
  let people = 0;
  let capacity = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= world.height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const xx = (x + dx + world.width) % world.width;
      const index = yy * world.width + xx;
      people += (world.people[index] ?? 0) * (world.cellAreaKm2[index] ?? 0);
      // Peopled-basin years measure fill against the STATIC forager capacity —
      // a basin full of people. Measuring against current capField stalled
      // every pin the moment a neighboring wave lifted the basin to farmed
      // capacity (fill collapsed ~10x): measured on the first YD->1 CE run,
      // the Fertile Crescent ignited ~6,000 years late for exactly this
      // reason while hearths beyond the wave's reach ignited on time.
      capacity += (world._foragerCapacity[index] ?? 0) * (world.cellAreaKm2[index] ?? 0);
    }
  }
  return capacity > 0 ? clamp01(people / capacity) : 0;
}

export function initializeTechnique(world: PeopleWorld): void {
  if (world._techniqueSuitability.length !== world.N) {
    world._techniqueSuitability = new Float64Array(world.N);
  }
  fillTechniqueEdgeLengths(world);
  fillTechniqueSuitability(world);
  world.technique.fill(0);
  world._techniqueNext.fill(0);
  world.hearths = chooseHearths(world);
}

export function stepTechnique(world: PeopleWorld): number {
  const technique = world.technique;
  const next = world._techniqueNext;
  next.set(technique);
  for (const hearth of world.hearths) {
    if (hearth.ignited) {
      technique[hearth.cell] = 1;
      next[hearth.cell] = 1;
      continue;
    }
    hearth.armedYears += basinFill(world, hearth.cell) / MONTHS_PER_YEAR;
    if (hearth.armedYears >= hearth.lagYears) {
      hearth.ignited = true;
      technique[hearth.cell] = 1;
      next[hearth.cell] = 1;
    }
  }
  if (world._techniqueEdgeH === undefined || world._techniqueEdgeH.length !== world.height) {
    fillTechniqueEdgeLengths(world);
  }
  for (const cell of world._landCells) {
    if (!peopled(world, cell)) continue;
    const cellY = Math.floor(cell / world.width);
    const current = technique[cell] ?? 0;
    let candidate = Math.max(current, next[cell] ?? 0);
    for (let direction = 0; direction < NEIGHBOR_DX.length; direction++) {
      const source = neighbor(
        world,
        cell,
        NEIGHBOR_DX[direction] ?? 0,
        NEIGHBOR_DY[direction] ?? 0,
      );
      if (source < 0 || !world.substrate.landMask[source]) continue;
      const sourceTechnique = technique[source] ?? 0;
      if (sourceTechnique <= current) continue;
      const distance = (NEIGHBOR_DY[direction] ?? 0) === 0
        ? world._techniqueEdgeH[Math.floor(source / world.width)] ?? 0
        : world._techniqueEdgeV;
      const progress = Math.min(
        1,
        PEOPLE_TECHNIQUE_WAVE_KMPY / MONTHS_PER_YEAR / Math.max(1, distance),
      );
      const fit = spreadSuitability(world, cell);
      const reached = current + (sourceTechnique - current) * progress * fit;
      if (reached > candidate) candidate = reached;
    }
    next[cell] = Math.max(current, Math.min(1, candidate));
  }
  technique.set(next);
  let covered = 0;
  let land = 0;
  for (let cell = 0; cell < world.N; cell++) {
    if (!world.substrate.landMask[cell]) continue;
    land++;
    if ((technique[cell] ?? 0) >= PEOPLE_TECHNIQUE_PRESENT) covered++;
  }
  return land > 0 ? covered / land : 0;
}

