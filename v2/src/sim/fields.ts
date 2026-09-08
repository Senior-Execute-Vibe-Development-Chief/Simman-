export type NumericField = Float64Array;

export interface FieldDefinition {
  readonly name: string;
  readonly defaultValue: number;
  readonly allocate: (length: number) => NumericField;
}

/**
 * The sole declaration of dynamic typed-array fields. Allocation, persistence,
 * hashing, and collection all consume this list so a new field cannot be
 * silently omitted from one of those operations.
 */
export const FIELD_LIST: readonly FieldDefinition[] = [
  {
    name: "people",
    defaultValue: 0,
    allocate: (length) => new Float64Array(length),
  },
  {
    name: "technique",
    defaultValue: 0,
    allocate: (length) => new Float64Array(length),
  },
  {
    name: "children",
    defaultValue: 0,
    allocate: (length) => new Float64Array(length),
  },
  {
    name: "working",
    defaultValue: 0,
    allocate: (length) => new Float64Array(length),
  },
  {
    name: "elders",
    defaultValue: 0,
    allocate: (length) => new Float64Array(length),
  },
  {
    // The built land capital (W28): the share of a cell's improvable ground
    // improved, 0..1. State — built by pressure, rotting unstaffed.
    name: "works",
    defaultValue: 0,
    allocate: (length) => new Float64Array(length),
  },
  {
    // The famine years (W29): the tally of bottom-decile harvests that
    // failed by more than a third while the cell's farmers lived through
    // them. A count of things that have happened: it never falls.
    name: "famineYears",
    defaultValue: 0,
    allocate: (length) => new Float64Array(length),
  },
  {
    // The farmed years (W30): the years a cell's farmers have stood
    // through, counted by the harvest pass on the same cells and years as
    // the famine tally, so a famine frequency is the one over the other. A
    // count of things that have happened: it never falls.
    name: "farmedYears",
    defaultValue: 0,
    allocate: (length) => new Float64Array(length),
  },
];

export type FieldHost = Record<string, unknown>;

export function allocateFields(world: FieldHost, length: number): void {
  for (const definition of FIELD_LIST) {
    world[definition.name] = definition.allocate(length);
  }
}

export function fieldEntries(
  world: FieldHost,
): Array<{ readonly definition: FieldDefinition; readonly field: NumericField }> {
  const entries: Array<{ readonly definition: FieldDefinition; readonly field: NumericField }> = [];
  for (const definition of FIELD_LIST) {
    const field = world[definition.name];
    if (!(field instanceof Float64Array)) {
      throw new Error(`Field ${definition.name} is missing or has the wrong type.`);
    }
    entries.push({ definition, field });
  }
  return entries;
}
