/**
 * M4 politics register: communities and the first obligation edges.
 * Communities are membership windows over the people/store fields (P23);
 * edges are recorded facts whose live strength M5 will re-derive.
 */

export interface Community {
  /** Stable id: the seat cell index. */
  readonly id: number;
  /** Seat cell (local people-mass maximum). */
  readonly seat: number;
  /** Member cell indices (full grid). */
  members: number[];
  /** People-mass Σ people×area at the last taking firing. */
  people: number;
  /** Exit = basin free share at the seat (P24 / wake inheritance). */
  exit: number;
  /** True when exit < CAGE_KNEE_FREE_SHARE. */
  exitBlocked: boolean;
  /** Appropriable surplus tonnes (store query × legibility). */
  appropriable: number;
  /** Unrest stock in [0, 1]. */
  unrest: number;
}

export type ObligationKind = "tribute";

export interface ObligationEdge {
  readonly from: number;
  readonly to: number;
  readonly kind: ObligationKind;
  /** Recorded strength; M5 re-derives live strength from books. */
  strength: number;
  readonly binding: "person";
  readonly sinceStep: number;
}
