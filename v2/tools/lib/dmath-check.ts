import { datan2, dcos, dexp, dln, dpow, dsin } from "../../src/sim/dmath";
import { DMATH_GOLDENS } from "../../src/sim/dmath-goldens";

const bitsBuffer = new ArrayBuffer(8);
const bitsView = new DataView(bitsBuffer);

export function float64Bits(value: number): string {
  bitsView.setFloat64(0, value, true);
  let bits = 0n;
  for (let index = bitsView.byteLength - 1; index >= 0; index--) {
    bits = (bits << 8n) | BigInt(bitsView.getUint8(index));
  }
  return bits.toString(16).padStart(16, "0");
}

function evaluate(name: string, args: readonly number[]): number {
  if (name === "dsin") return dsin(args[0] ?? 0);
  if (name === "dcos") return dcos(args[0] ?? 0);
  if (name === "dexp") return dexp(args[0] ?? 0);
  if (name === "dln") return dln(args[0] ?? 0);
  if (name === "datan2") return datan2(args[0] ?? 0, args[1] ?? 0);
  return dpow(args[0] ?? 0, args[1] ?? 0);
}

export function checkDmathGoldens(): readonly string[] {
  const failures: string[] = [];
  for (const golden of DMATH_GOLDENS) {
    const actual = float64Bits(evaluate(golden.name, golden.args));
    if (actual !== golden.bits) {
      failures.push(`${golden.name}(${golden.args.join(",")}) expected ${golden.bits}, got ${actual}`);
    }
  }
  if (failures.length) throw new Error(`Deterministic math golden mismatch:\n${failures.join("\n")}`);
  return DMATH_GOLDENS.map((golden) => golden.bits);
}
