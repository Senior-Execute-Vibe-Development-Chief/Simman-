import { FIELD_LIST } from "../../src/sim/fields";
import type { World } from "../../src/sim/world";

/**
 * Only instrumentation machinery is excluded. This list intentionally fails
 * open: anything new not named here is measured by the generic walker.
 */
export const WORLD_SCRATCH = new Set<string>(["ledger"]);

const isNumeric = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function distribution(prefix: string, values: Iterable<number>, output: Record<string, number>): void {
  const finite = Array.from(values).filter(isNumeric).sort((a, b) => a - b);
  const count = finite.length;
  output[`${prefix}.n`] = count;
  if (count === 0) {
    output[`${prefix}.p50`] = 0;
    output[`${prefix}.p90`] = 0;
    output[`${prefix}.max`] = 0;
    output[`${prefix}.mean`] = 0;
    output[`${prefix}.sum`] = 0;
    return;
  }
  let sum = 0;
  for (const value of finite) sum += value;
  output[`${prefix}.p50`] = finite[Math.min(count - 1, Math.floor(0.5 * count))] ?? 0;
  output[`${prefix}.p90`] = finite[Math.min(count - 1, Math.floor(0.9 * count))] ?? 0;
  output[`${prefix}.max`] = finite[count - 1] ?? 0;
  output[`${prefix}.mean`] = sum / count;
  output[`${prefix}.sum`] = sum;
}

function isTypedArray(value: object): value is Float64Array | Float32Array | Int32Array | Uint32Array {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function walk(
  value: unknown,
  path: string,
  output: Record<string, number>,
  seen: WeakSet<object>,
): void {
  if (isNumeric(value)) {
    output[path] = value;
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (isTypedArray(value)) {
    distribution(path, value, output);
    return;
  }
  if (value instanceof Map || value instanceof Set) {
    output[`${path}.size`] = value.size;
    return;
  }
  if (Array.isArray(value)) {
    if (value.every((entry) => isNumeric(entry))) {
      distribution(path, value, output);
    } else {
      output[`${path}.length`] = value.length;
      value.forEach((entry, index) => walk(entry, `${path}.${index}`, output, seen));
    }
    return;
  }
  for (const key of Object.keys(value).sort()) {
    walk((value as Record<string, unknown>)[key], `${path}.${key}`, output, seen);
  }
}

/** Exhaustive flat numeric metric map for every world state leaf. */
export function collect(world: World): Record<string, number> {
  const output: Record<string, number> = {};
  const seen = new WeakSet<object>();
  for (const definition of FIELD_LIST) {
    const field = (world as unknown as Record<string, unknown>)[definition.name];
    distribution(`field.${definition.name}`, field as Iterable<number>, output);
  }
  for (const key of Object.keys(world).sort()) {
    if (WORLD_SCRATCH.has(key) || FIELD_LIST.some((definition) => definition.name === key)) continue;
    walk((world as unknown as Record<string, unknown>)[key], `world.${key}`, output, seen);
  }
  return output;
}
