import {
  EXTRACT_FLOOR,
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_NEIGHBOR_DX,
  PEOPLE_NEIGHBOR_DY,
  PLUNDER_SHARE,
  TAKING_RAID_RATE_PER_YEAR,
} from "../constants";
import { dexp } from "../dmath";
import { hash32, mkRng } from "../../ported/rng";
import { passDtMonths, passFires, TAKING_PASS, type PassSchedule } from "../scheduler";
import type { World } from "../world";
import {
  condenseCommunities,
  hasAppropriableTarget,
  remitStore,
} from "./community";
import type { Community, ObligationEdge } from "./types";

const TAKING_STREAM = "taking";

function wrapX(world: World, x: number): number {
  const width = world.width;
  return ((x % width) + width) % width;
}

function neighborCell(world: World, cell: number, direction: number): number {
  const width = world.width;
  const y = Math.floor(cell / width);
  const x = cell - y * width;
  const nx = wrapX(world, x + (PEOPLE_NEIGHBOR_DX[direction] ?? 0));
  const ny = y + (PEOPLE_NEIGHBOR_DY[direction] ?? 0);
  if (ny < 0 || ny >= world.height) return MATH_NEGATIVE_ONE;
  return ny * width + nx;
}

/** Undirected neighbour pairs of community seats that share a member-edge. */
function adjacentPairs(world: World, byId: Map<number, Community>): [number, number][] {
  const owner = world._communityOwner;
  const seen = new Set<string>();
  const pairs: [number, number][] = [];
  for (const community of world.communities) {
    for (const cell of community.members) {
      for (let direction = 0; direction < PEOPLE_NEIGHBOR_DX.length; direction++) {
        const other = neighborCell(world, cell, direction);
        if (other < 0) continue;
        const otherSeat = owner[other] ?? MATH_NEGATIVE_ONE;
        if (otherSeat < 0 || otherSeat === community.id) continue;
        if (!byId.has(otherSeat)) continue;
        const a = Math.min(community.id, otherSeat);
        const b = Math.max(community.id, otherSeat);
        const key = `${a}:${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([a, b]);
      }
    }
  }
  pairs.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  return pairs;
}

function pruneEdges(world: World, byId: Map<number, Community>): void {
  world.obligationEdges = world.obligationEdges.filter((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return false;
    if (edge.kind === "tribute" && !from.exitBlocked) return false;
    return true;
  });
}

function upsertTribute(world: World, from: number, to: number): void {
  const existing = world.obligationEdges.find(
    (edge) => edge.kind === "tribute" && edge.from === from && edge.to === to,
  );
  if (existing) {
    existing.strength = EXTRACT_FLOOR;
    return;
  }
  const edge: ObligationEdge = {
    from,
    to,
    kind: "tribute",
    strength: EXTRACT_FLOOR,
    binding: "person",
    sinceStep: world.step,
  };
  world.obligationEdges.push(edge);
  world.events.push({ step: world.step, kind: "tribute", cell: from });
}

function yearIndex(world: World): number {
  return Math.floor(world.step / MONTHS_PER_YEAR);
}

/**
 * One firing of the taking pass (awake only): condense communities, prune
 * edges whose exit opened, then hazard-rate raids on adjacent pairs.
 */
export function stepTaking(world: World, dtMonths: number): void {
  if (world.phase !== "awake") return;
  if (!world.substrate) return;

  const communities = condenseCommunities(world);
  const byId = new Map<number, Community>();
  for (const community of communities) byId.set(community.id, community);
  pruneEdges(world, byId);

  if (communities.length < 2) return;

  const dtYears = dtMonths / MONTHS_PER_YEAR;
  const pairs = adjacentPairs(world, byId);
  for (const [aId, bId] of pairs) {
    const a = byId.get(aId);
    const b = byId.get(bId);
    if (!a || !b) continue;

    const rng = mkRng(hash32(world.seed, TAKING_STREAM, yearIndex(world), aId, bId));
    const probability = 1 - dexp(-TAKING_RAID_RATE_PER_YEAR * dtYears);
    if (rng() >= probability) continue;

    const winner = a.people > b.people || (a.people === b.people && a.id < b.id) ? a : b;
    const loser = winner.id === a.id ? b : a;
    if (!hasAppropriableTarget(loser)) continue;

    if (loser.exitBlocked) {
      const taken = remitStore(
        world,
        loser.members,
        winner.seat,
        EXTRACT_FLOOR * loser.appropriable,
      );
      if (taken > 0) {
        upsertTribute(world, loser.id, winner.id);
        loser.unrest = Math.max(0, Math.min(1, loser.unrest + EXTRACT_FLOOR * (1 - loser.exit)));
        loser.appropriable = Math.max(0, loser.appropriable - taken);
      }
    } else {
      const taken = remitStore(
        world,
        loser.members,
        winner.seat,
        PLUNDER_SHARE * loser.appropriable,
      );
      if (taken > 0) {
        world.events.push({ step: world.step, kind: "plunder", cell: loser.seat });
        loser.appropriable = Math.max(0, loser.appropriable - taken);
      }
    }
  }
}

/** Fire the taking pass when its awake schedule row is due. */
export function maybeStepTaking(world: World): boolean {
  if (world.phase !== "awake") return false;
  const schedule = world.awakeSchedule.find((row) => row.name === TAKING_PASS) as
    | PassSchedule
    | undefined;
  if (!schedule || !passFires(world, schedule)) return false;
  const started = performance.now();
  stepTaking(world, passDtMonths(schedule));
  world.debug.peoplePasses[TAKING_PASS] =
    (world.debug.peoplePasses[TAKING_PASS] ?? 0) + 1;
  world.debug.politicsTakingMs = (world.debug.politicsTakingMs ?? 0) + (performance.now() - started);
  return true;
}
