import { FIELD_LIST, type FieldDefinition, type NumericField } from "./fields";
import { BASE64_CHUNK_SIZE } from "./constants";
import { SAVE_VERSION_W3 } from "./constants";
import { type GridPreset, World } from "./world";
import type { HearthState } from "./people/types";
import { sameSchedule, type PassSchedule } from "./scheduler";
import { deriveCapacity } from "./people/capacity";
import { asPeopleWorld } from "./people/types";

export const SAVE_VERSION = SAVE_VERSION_W3;

export interface SerializedField {
  readonly length: number;
  readonly encoding: "base64-float64-le";
  readonly data: string;
}

export interface SaveEnvelope {
  readonly version: number;
  readonly seed: number;
  readonly grid: GridPreset;
  readonly step: number;
  readonly calendarMonth: number;
  readonly schedule: readonly PassSchedule[];
  readonly config: Record<string, string | number | boolean>;
  readonly fields: Record<string, SerializedField>;
  readonly people: {
    readonly initialized: boolean;
    readonly hearths: readonly HearthState[];
  };
}

function base64FromField(field: NumericField): string {
  const bytes = new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
  let binary = "";
  const chunkSize = BASE64_CHUNK_SIZE;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize);
    for (let index = offset; index < end; index++) binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return globalThis.btoa(binary);
}

function fieldFromBase64(
  serialized: SerializedField,
  definition: FieldDefinition,
): NumericField {
  if (serialized.encoding !== "base64-float64-le") {
    throw new Error(`Unsupported encoding for field ${definition.name}.`);
  }
  const binary = globalThis.atob(serialized.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (bytes.byteLength % Float64Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error(`Invalid byte length for field ${definition.name}.`);
  }
  const field = new Float64Array(bytes.buffer);
  if (field.length !== serialized.length) {
    throw new Error(`Invalid length for field ${definition.name}.`);
  }
  return field;
}

export function saveWorld(world: World): SaveEnvelope {
  const fields: Record<string, SerializedField> = {};
  for (const { definition, field } of fieldEntries(world)) {
    fields[definition.name] = {
      length: field.length,
      encoding: "base64-float64-le",
      data: base64FromField(field),
    };
  }
  return {
    version: SAVE_VERSION,
    seed: world.seed,
    grid: world.grid,
    step: world.step,
    calendarMonth: world.calendarMonth,
    schedule: world.schedule,
    config: { ...world.config },
    fields,
    people: {
      initialized: world.peopleInitialized,
      hearths: world.hearths.map((hearth) => ({ ...hearth })),
    },
  };
}

export function serializeWorld(world: World): string {
  return JSON.stringify(saveWorld(world));
}

export function loadWorld(input: string | SaveEnvelope, substrate?: import("./substrate").Substrate): World {
  const data = typeof input === "string" ? JSON.parse(input) as SaveEnvelope : input;
  if (!data || data.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${data?.version}.`);
  }
  const world = new World({
    seed: data.seed,
    grid: data.grid,
    config: data.config,
    substrate,
  });
  if (!Array.isArray(data.schedule) || !sameSchedule(world.schedule, data.schedule)) {
    throw new Error("Save schedule does not match the world schedule.");
  }
  world.step = data.step;
  world.calendarMonth = data.calendarMonth;
  for (const definition of FIELD_LIST) {
    const serialized = data.fields[definition.name];
    if (!serialized) throw new Error(`Missing declared field ${definition.name}.`);
    const field = fieldFromBase64(serialized, definition);
    const current = (world as unknown as Record<string, unknown>)[definition.name];
    if (current instanceof Float64Array && current.length === field.length) {
      current.set(field);
    } else {
      (world as unknown as Record<string, unknown>)[definition.name] = field;
    }
  }
  world.peopleInitialized = data.people.initialized;
  world.hearths = data.people.hearths.map((hearth) => ({ ...hearth }));
  // Capacity is derived scratch. Annual cadence means a loaded world can
  // run many migration-only months before the next capacity firing, so
  // re-derive from the restored technique rather than keeping the seed.
  if (world.substrate && world.peopleInitialized) deriveCapacity(asPeopleWorld(world));
  return world;
}

function fieldEntries(world: World): Array<{ definition: FieldDefinition; field: NumericField }> {
  const entries: Array<{ definition: FieldDefinition; field: NumericField }> = [];
  for (const definition of FIELD_LIST) {
    const field = (world as unknown as Record<string, unknown>)[definition.name];
    if (!(field instanceof Float64Array)) {
      throw new Error(`Field ${definition.name} is missing or has the wrong type.`);
    }
    entries.push({ definition, field });
  }
  return entries;
}
