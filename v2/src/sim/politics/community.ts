import {
  CAGE_KNEE_FREE_SHARE,
  COMMUNITY_BAR_PERSONS,
  COMMUNITY_RADIUS_KM,
  CONSERVATION_EPSILON,
  DEG_TO_RAD,
  EARTH_CIRCUMFERENCE_KM,
  EARTH_HALF_DEGREES,
  EARTH_MERIDIONAL_KM,
  FOOD_RATION_TONNES_PER_PERSON_YEAR,
  MATH_HALF,
  MATH_NEGATIVE_ONE,
  PEOPLE_FARMED_MARKER_SHARE,
  TRAVEL_HALF,
} from "../constants";
import { dcos } from "../dmath";
import type { World } from "../world";
import { basinRadiusCells, fillSummedArea, windowSum } from "../people/technique";
import { asPeopleWorld } from "../people/types";
import type { Community } from "./types";

function cellMass(world: World, cell: number): number {
  return Math.max(0, world.people[cell] ?? 0) * Math.max(0, world.cellAreaKm2[cell] ?? 0);
}

function isFarmed(world: World, cell: number): boolean {
  return (world.technique[cell] ?? 0) >= PEOPLE_FARMED_MARKER_SHARE;
}

function eastWestKm(world: World, row: number): number {
  const area = world.cellAreaKm2[row * world.width] ?? 0;
  if (area > 0) return area / (EARTH_MERIDIONAL_KM / world.height);
  const latitude = (
    EARTH_HALF_DEGREES * TRAVEL_HALF
      - ((row + TRAVEL_HALF) / world.height) * EARTH_HALF_DEGREES
  ) * DEG_TO_RAD;
  return EARTH_CIRCUMFERENCE_KM / world.width * Math.max(0, dcos(latitude));
}

/** Great-circle-ish chord between two cell centres on the grid. */
export function distanceKm(world: World, a: number, b: number): number {
  const width = world.width;
  const ay = Math.floor(a / width);
  const by = Math.floor(b / width);
  const ax = a - ay * width;
  const bx = b - by * width;
  const rawDx = Math.abs(ax - bx);
  const dx = Math.min(rawDx, width - rawDx);
  const dy = Math.abs(ay - by);
  const northSouth = EARTH_MERIDIONAL_KM / world.height;
  const eastWest = (eastWestKm(world, ay) + eastWestKm(world, by)) * MATH_HALF;
  return Math.sqrt((dx * eastWest) * (dx * eastWest) + (dy * northSouth) * (dy * northSouth));
}

/**
 * Basin free share at a seat — the same room the wake reads (P24):
 * capacity minus people, windowed at the hearth-law radius.
 */
export function communityExit(worldInput: World, seat: number): number {
  const world = asPeopleWorld(worldInput);
  const free = world._basinFree;
  const room = world._basinRoom;
  free.fill(0);
  room.fill(0);
  for (let packed = 0; packed < world._landCells.length; packed++) {
    const cell = world._landCells[packed] ?? 0;
    const total = Math.max(0, world.capField[cell] ?? 0);
    if (total <= 0) continue;
    room[cell] = total;
    free[cell] = Math.max(0, total - Math.max(0, world.people[cell] ?? 0));
  }
  fillSummedArea(world, free, world._basinFreeSum);
  fillSummedArea(world, room, world._basinRoomSum);
  const radius = basinRadiusCells(world);
  const total = windowSum(world, world._basinRoomSum, seat, radius);
  if (total <= 0) return 1;
  return windowSum(world, world._basinFreeSum, seat, radius) / total;
}

function storeTonnes(world: World, members: readonly number[]): number {
  let tonnes = 0;
  for (const cell of members) {
    tonnes += Math.max(0, world.store[cell] ?? 0) * Math.max(0, world.cellAreaKm2[cell] ?? 0);
  }
  return tonnes;
}

/**
 * Rebuild the community register from the people field. Seat ids are cell
 * indices (stable). Prior unrest is carried across when the seat survives.
 */
export function condenseCommunities(world: World): Community[] {
  const priorUnrest = new Map<number, number>();
  for (const community of world.communities) {
    priorUnrest.set(community.id, community.unrest);
  }

  const land = (world as unknown as { _landCells?: Int32Array })._landCells;
  if (!land || land.length === 0) {
    world.communities = [];
    world._communityOwner = new Int32Array(world.N).fill(MATH_NEGATIVE_ONE);
    return world.communities;
  }

  const mass = new Float64Array(world.N);
  const candidates: number[] = [];
  for (let packed = 0; packed < land.length; packed++) {
    const cell = land[packed] ?? 0;
    if (!isFarmed(world, cell)) continue;
    const m = cellMass(world, cell);
    if (m <= 0) continue;
    mass[cell] = m;
    candidates.push(cell);
  }

  // Every farmed cell above the bar is a seat candidate. Membership is
  // nearest-seat within the day's-walk radius (ties → lower seat id). A
  // candidate that ends with mass below the bar after assignment dissolves.
  // Local-max-only minting collapsed adjacent mid-latitude cells into one
  // seat once the radius reached a neighbour (~37 km here vs 50 km bar).
  const seats = candidates
    .filter((cell) => (mass[cell] ?? 0) >= COMMUNITY_BAR_PERSONS)
    .sort((a, b) => a - b);

  const owner = new Int32Array(world.N).fill(MATH_NEGATIVE_ONE);
  const membersBySeat = new Map<number, number[]>();
  for (const seat of seats) membersBySeat.set(seat, []);

  for (const cell of candidates) {
    let bestSeat = MATH_NEGATIVE_ONE;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const seat of seats) {
      const dist = distanceKm(world, cell, seat);
      if (dist > COMMUNITY_RADIUS_KM) continue;
      if (dist < bestDist || (dist === bestDist && seat < bestSeat)) {
        bestDist = dist;
        bestSeat = seat;
      }
    }
    if (bestSeat < 0) continue;
    owner[cell] = bestSeat;
    membersBySeat.get(bestSeat)!.push(cell);
  }

  const communities: Community[] = [];
  for (const seat of seats) {
    const members = membersBySeat.get(seat) ?? [];
    let people = 0;
    for (const cell of members) people += mass[cell] ?? 0;
    if (people < COMMUNITY_BAR_PERSONS) continue;
    const exit = communityExit(world, seat);
    const tonnes = storeTonnes(world, members);
    const legibility = isFarmed(world, seat) ? 1 : 0;
    communities.push({
      id: seat,
      seat,
      members,
      people,
      exit,
      exitBlocked: exit < CAGE_KNEE_FREE_SHARE,
      appropriable: tonnes * legibility,
      unrest: Math.max(0, Math.min(1, priorUnrest.get(seat) ?? 0)),
    });
  }

  world.communities = communities;
  world._communityOwner = owner;
  return communities;
}

/** Remit tonnes from member stores into the winner seat, pro-rata by cell store mass. */
export function remitStore(
  world: World,
  fromMembers: readonly number[],
  toSeat: number,
  tonnes: number,
): number {
  if (tonnes <= 0) return 0;
  let available = 0;
  const cellTonnes: { cell: number; tonnes: number }[] = [];
  for (const cell of fromMembers) {
    const t = Math.max(0, world.store[cell] ?? 0) * Math.max(0, world.cellAreaKm2[cell] ?? 0);
    if (t <= 0) continue;
    cellTonnes.push({ cell, tonnes: t });
    available += t;
  }
  if (available <= 0) return 0;
  const take = Math.min(tonnes, available);
  for (const row of cellTonnes) {
    const share = take * (row.tonnes / available);
    const area = Math.max(CONSERVATION_EPSILON, world.cellAreaKm2[row.cell] ?? 0);
    world.store[row.cell] = Math.max(0, (world.store[row.cell] ?? 0) - share / area);
  }
  const toArea = Math.max(CONSERVATION_EPSILON, world.cellAreaKm2[toSeat] ?? 0);
  world.store[toSeat] = (world.store[toSeat] ?? 0) + take / toArea;
  return take;
}

export function hasAppropriableTarget(community: Community): boolean {
  return community.appropriable >= FOOD_RATION_TONNES_PER_PERSON_YEAR;
}
