import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { World } from "../../src/sim/world";
import { stableStringify } from "../../src/sim/world";

export interface Provenance {
  readonly git: string;
  readonly dirty: boolean;
  readonly seed: number;
  readonly grid: string;
  readonly step: number;
  readonly configDigest: string;
  readonly schedule: World["schedule"];
  /** W5/W12: the regime, the solve regime's per-pass schedule and clock, and the wake/caged steps (−1 while not yet). */
  readonly phase: World["phase"];
  readonly solveSchedule: World["solveSchedule"];
  readonly solveClock: number;
  readonly wakeStep: number;
  readonly cagedStep: number;
}

function gitValue(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function provenance(world: World): Provenance {
  const configDigest = createHash("sha256")
    .update(stableStringify(world.config))
    .digest("hex")
    .slice(0, 16);
  return {
    git: gitValue(["rev-parse", "--short", "HEAD"]),
    dirty: gitValue(["status", "--porcelain", "--", "."]).length > 0,
    seed: world.seed,
    grid: world.grid,
    step: world.step,
    configDigest,
    schedule: world.awakeSchedule,
    phase: world.phase,
    solveSchedule: world.solveSchedule,
    solveClock: world.solveClock,
    wakeStep: world.wakeStep,
    cagedStep: world.cagedStep,
  };
}

export function printProvenance(world: World): void {
  console.log(JSON.stringify({ provenance: provenance(world) }));
}
