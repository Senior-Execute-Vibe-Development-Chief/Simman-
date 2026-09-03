import { FIELD_LIST, type FieldDefinition, type NumericField } from "./fields";
import { BASE64_CHUNK_SIZE } from "./constants";
import { SAVE_VERSION_W8 } from "./constants";
import { CROP_PACKAGES } from "../ported/worldgen/cropPackages.js";
import { type GridPreset, World, type WorldEvent } from "./world";
import type { HearthState } from "./people/types";
import { sameSchedule, type PassSchedule, type WorldPhase } from "./scheduler";
import { deriveCapacity } from "./people/capacity";
import { asPeopleWorld } from "./people/types";
import { markPackageActive, rebuildFarmerTotals, refreshTechniqueShare } from "./people/crop";

export const SAVE_VERSION = SAVE_VERSION_W8;

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
  /** The AWAKE schedule; the solve regime's is every pass at `solveStride`. */
  readonly schedule: readonly PassSchedule[];
  readonly solveStride: number;
  /** The regime the world was saved in, and the steps it woke and was first caged at (−1 while not yet). */
  readonly phase: WorldPhase;
  readonly wakeStep: number;
  readonly cagedStep: number;
  readonly cagedCell: number;
  readonly events: readonly WorldEvent[];
  readonly config: Record<string, string | number | boolean>;
  readonly fields: Record<string, SerializedField>;
  readonly people: {
    readonly initialized: boolean;
    readonly hearths: readonly HearthState[];
    /** Only packages carrying mass are written; a missing package loads as zero. */
    readonly farmerFields: Record<string, SerializedField>;
    /** Peopled-basin years per native cell per package: hearth history. */
    readonly hearthYears?: Record<string, SerializedField>;
    readonly peopledMask: string;
    readonly dominantPackage: string;
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

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const end = Math.min(bytes.length, offset + BASE64_CHUNK_SIZE);
    for (let index = offset; index < end; index++) binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return globalThis.btoa(binary);
}

function bytesFromBase64(data: string): Uint8Array {
  const binary = globalThis.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
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
  const farmerFields: Record<string, SerializedField> = {};
  const hearthYears: Record<string, SerializedField> = {};
  let peopledMask = "";
  let dominantPackage = "";
  if (world.substrate) {
    const peopleWorld = asPeopleWorld(world);
    for (const packageId of Object.keys(peopleWorld.farmers).sort()) {
      const field = peopleWorld.farmers[packageId];
      if (!field || !field.some((value) => value > 0)) continue;
      farmerFields[packageId] = {
        length: field.length,
        encoding: "base64-float64-le",
        data: base64FromField(field),
      };
    }
    CROP_PACKAGES.forEach((pkg, index) => {
      const years = peopleWorld._hearthYears[index];
      if (!years || years.length === 0) return;
      hearthYears[pkg.id] = {
        length: years.length,
        encoding: "base64-float64-le",
        data: base64FromField(years),
      };
    });
    peopledMask = base64FromBytes(peopleWorld._peopledMask);
    dominantPackage = base64FromBytes(peopleWorld._dominantPackage);
  }
  return {
    version: SAVE_VERSION,
    seed: world.seed,
    grid: world.grid,
    step: world.step,
    calendarMonth: world.calendarMonth,
    schedule: world.awakeSchedule,
    solveStride: world.solveStride,
    phase: world.phase,
    wakeStep: world.wakeStep,
    cagedStep: world.cagedStep,
    cagedCell: world.cagedCell,
    events: world.events.map((event) => ({ ...event })),
    config: { ...world.config },
    fields,
    people: {
      initialized: world.peopleInitialized,
      hearths: world.hearths.map((hearth) => ({ ...hearth })),
      farmerFields,
      hearthYears,
      peopledMask,
      dominantPackage,
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
  if (!Array.isArray(data.schedule) || !sameSchedule(world.awakeSchedule, data.schedule)) {
    throw new Error("Save schedule does not match the world schedule.");
  }
  if (data.solveStride !== world.solveStride) {
    throw new Error("Save solve stride does not match the world's derived stride.");
  }
  world.step = data.step;
  world.calendarMonth = data.calendarMonth;
  world.phase = data.phase;
  world.wakeStep = data.wakeStep;
  world.cagedStep = data.cagedStep;
  world.cagedCell = data.cagedCell;
  world.events = (data.events ?? []).map((event) => ({ ...event }));
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
  if (world.substrate) for (const [packageId, current] of Object.entries(asPeopleWorld(world).farmers)) {
    const serialized = data.people.farmerFields?.[packageId];
    if (!serialized) {
      current.fill(0);
      continue;
    }
    const field = fieldFromBase64(serialized, {
      name: `farmers.${packageId}`,
      defaultValue: 0,
      allocate: (length) => new Float64Array(length),
    });
    if (field.length !== current.length) throw new Error(`Invalid farmer field length for ${packageId}.`);
    current.set(field);
    if (field.some((value) => value > 0)) {
      const packageIndex = Object.keys(asPeopleWorld(world).farmers).indexOf(packageId);
      markPackageActive(asPeopleWorld(world), packageIndex);
    }
  }
  if (world.substrate) {
    const peopleWorld = asPeopleWorld(world);
    CROP_PACKAGES.forEach((pkg, index) => {
      const years = peopleWorld._hearthYears[index];
      if (!years) return;
      const serialized = data.people.hearthYears?.[pkg.id];
      if (!serialized) {
        years.fill(0);
        peopleWorld._hearthDone[index]?.fill(0);
        return;
      }
      const field = fieldFromBase64(serialized, {
        name: `hearthYears.${pkg.id}`,
        defaultValue: 0,
        allocate: (length) => new Float64Array(length),
      });
      if (field.length !== years.length) throw new Error(`Invalid hearth-years length for ${pkg.id}.`);
      years.set(field);
      // A cell at or past its lag has ignited, joined, or can never (W8):
      // the capacities are static, so the flag is a function of the years.
      const done = peopleWorld._hearthDone[index];
      if (done) for (let i = 0; i < years.length; i++) done[i] = (years[i] ?? 0) >= pkg.domLagY ? 1 : 0;
    });
    const mask = bytesFromBase64(data.people.peopledMask);
    if (mask.length !== asPeopleWorld(world)._peopledMask.length) {
      throw new Error("Invalid peopled mask length.");
    }
    asPeopleWorld(world)._peopledMask.set(mask);
    const dominant = bytesFromBase64(data.people.dominantPackage);
    if (dominant.length !== asPeopleWorld(world)._dominantPackage.length) {
      throw new Error("Invalid dominant package length.");
    }
    asPeopleWorld(world)._dominantPackage.set(dominant);
    rebuildFarmerTotals(asPeopleWorld(world));
    refreshTechniqueShare(asPeopleWorld(world));
  }
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
