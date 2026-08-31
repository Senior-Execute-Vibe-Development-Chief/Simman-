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
  };
}

export function printProvenance(world: World): void {
  console.log(JSON.stringify({ provenance: provenance(world) }));
}
