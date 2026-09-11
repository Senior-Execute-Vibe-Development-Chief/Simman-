/**
 * Shell-facing M4 politics overlay: seats, tribute edges, recent taking events.
 * Derived from the live register — never authoritative state.
 */
import {
  POLITICS_OVERLAY_MAX_RECENT,
  POLITICS_OVERLAY_MAX_SEATS,
  POLITICS_OVERLAY_MAX_TRIBUTE,
} from "../constants";
import type { World } from "../world";

export interface PoliticsSeatView {
  readonly id: number;
  readonly seat: number;
  readonly exitBlocked: boolean;
  readonly unrest: number;
}

export interface PoliticsTributeView {
  readonly from: number;
  readonly to: number;
  readonly strength: number;
}

export interface PoliticsEventView {
  readonly step: number;
  readonly kind: "tribute" | "plunder";
  readonly cell: number;
}

export interface PoliticsSnapshot {
  readonly seats: readonly PoliticsSeatView[];
  readonly tribute: readonly PoliticsTributeView[];
  readonly recent: readonly PoliticsEventView[];
}

/** Compact politics view for the Earth observatory (and harnesses). */
export function politicsSnapshot(world: World): PoliticsSnapshot {
  const seats: PoliticsSeatView[] = [];
  for (let i = 0; i < world.communities.length && seats.length < POLITICS_OVERLAY_MAX_SEATS; i++) {
    const community = world.communities[i]!;
    seats.push({
      id: community.id,
      seat: community.seat,
      exitBlocked: community.exitBlocked,
      unrest: community.unrest,
    });
  }
  const tribute: PoliticsTributeView[] = [];
  for (let i = 0; i < world.obligationEdges.length && tribute.length < POLITICS_OVERLAY_MAX_TRIBUTE; i++) {
    const edge = world.obligationEdges[i]!;
    if (edge.kind !== "tribute") continue;
    tribute.push({ from: edge.from, to: edge.to, strength: edge.strength });
  }
  const recent: PoliticsEventView[] = [];
  for (let i = world.events.length - 1; i >= 0 && recent.length < POLITICS_OVERLAY_MAX_RECENT; i--) {
    const event = world.events[i]!;
    if (event.kind !== "tribute" && event.kind !== "plunder") continue;
    recent.push({ step: event.step, kind: event.kind, cell: event.cell });
  }
  recent.reverse();
  return { seats, tribute, recent };
}
