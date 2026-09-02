import {
  BYTE_SHIFT,
  HASH_HEX_WIDTH,
  HASH_NUMBER_BYTES,
  HASH_RADIX,
  M0_DEFAULT_SEED,
  M0_DETERMINISM_TICKS,
  PEOPLE_BROWSER_PARITY_TICKS,
} from "./constants";
import { datan2, dcos, dexp, dln, dpow, dsin } from "./dmath";
import { DMATH_GOLDENS } from "./dmath-goldens";
import { runRoutingBatteries, type RoutingBatteryResult } from "./travel/battery";
import { buildSubstrate } from "./substrate";
import { ensurePeopleWasm } from "./peopleKernel";
import { hashWorld, runSteps, type GridPreset, World } from "./world";

export interface BrowserM1Result {
  readonly worldHashes: Readonly<Record<GridPreset, string>>;
  readonly peopleHash: string;
  readonly dmathBits: readonly string[];
  readonly routing: readonly RoutingBatteryResult[];
}

const bitsBuffer = new ArrayBuffer(HASH_NUMBER_BYTES);
const bitsView = new DataView(bitsBuffer);

function float64Bits(value: number): string {
  bitsView.setFloat64(0, value, true);
  let bits = 0n;
  for (let index = bitsView.byteLength - 1; index >= 0; index--) {
    bits = (bits << BigInt(BYTE_SHIFT)) | BigInt(bitsView.getUint8(index));
  }
  return bits.toString(HASH_RADIX).padStart(HASH_HEX_WIDTH, "0");
}

function evaluateGolden(name: string, args: readonly number[]): number {
  if (name === "dsin") return dsin(args[0] ?? 0);
  if (name === "dcos") return dcos(args[0] ?? 0);
  if (name === "dexp") return dexp(args[0] ?? 0);
  if (name === "dln") return dln(args[0] ?? 0);
  if (name === "datan2") return datan2(args[0] ?? 0, args[1] ?? 0);
  return dpow(args[0] ?? 0, args[1] ?? 0);
}

export async function runM1Checks(seed = M0_DEFAULT_SEED): Promise<BrowserM1Result> {
  if (!await ensurePeopleWasm()) throw new Error("People WASM failed to initialize.");
  const worldHashes = {} as Record<GridPreset, string>;
  for (const grid of ["dev", "target"] as const) {
    const first = new World({ seed, grid });
    const second = new World({ seed, grid });
    runSteps(first, M0_DETERMINISM_TICKS);
    runSteps(second, M0_DETERMINISM_TICKS);
    const firstHash = hashWorld(first);
    const secondHash = hashWorld(second);
    if (firstHash !== secondHash) throw new Error(`Determinism failed on ${grid}.`);
    worldHashes[grid] = firstHash;
  }
  const substrate = buildSubstrate(seed, { preset: "earth_sim" }, "dev");
  const peopleWorld = new World({
    seed,
    grid: "dev",
    config: { preset: "earth_sim", peopleKernel: "wasm" },
    substrate,
  });
  runSteps(peopleWorld, PEOPLE_BROWSER_PARITY_TICKS);
  const peopleHash = hashWorld(peopleWorld);
  const dmathBits = DMATH_GOLDENS.map((golden) => float64Bits(evaluateGolden(golden.name, golden.args)));
  const routing = await runRoutingBatteries();
  return { worldHashes, peopleHash, dmathBits, routing };
}
