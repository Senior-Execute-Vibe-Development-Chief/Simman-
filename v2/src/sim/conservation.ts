import { CONSERVATION_EPSILON } from "./constants";

export interface BalanceSheet {
  opening: number;
  closing: number;
  observedDelta: number;
  sources: Record<string, number>;
  sinks: Record<string, number>;
  unexplained: number;
  tolerance: number;
  sourceChannel: string;
  sinkChannel: string;
}

type NumericField = { readonly length: number; readonly [index: number]: number };

function sumField(field: NumericField): number {
  let total = 0;
  for (let index = 0; index < field.length; index++) total += field[index] ?? 0;
  return total;
}

function totalChannels(channels: Record<string, number>): number {
  let total = 0;
  for (const key in channels) total += channels[key] ?? 0;
  return total;
}

/**
 * A small balance-sheet engine. M0's placeholder field is deliberately
 * non-physical, but every write still has a named source or sink so the
 * conservation wiring is exercised before real matter is introduced.
 */
export class ConservationLedger {
  private readonly sheets = new Map<string, BalanceSheet>();

  beginPass(quantity: string, field: NumericField, sourceChannel: string, sinkChannel: string): void {
    const previous = this.sheets.get(quantity);
    const sheet = previous ?? {
      opening: 0,
      closing: 0,
      observedDelta: 0,
      sources: {},
      sinks: {},
      unexplained: 0,
      tolerance: 0,
      sourceChannel,
      sinkChannel,
    };
    sheet.sourceChannel = sourceChannel;
    sheet.sinkChannel = sinkChannel;
    sheet.opening = sumField(field);
    sheet.closing = sheet.opening;
    sheet.observedDelta = 0;
    for (const key in sheet.sources) sheet.sources[key] = 0;
    for (const key in sheet.sinks) sheet.sinks[key] = 0;
    sheet.sources[sourceChannel] = 0;
    sheet.sinks[sinkChannel] = 0;
    sheet.unexplained = 0;
    sheet.tolerance = CONSERVATION_EPSILON * Math.max(1, field.length);
    this.sheets.set(quantity, sheet);
  }

  endPass(
    quantity: string,
    field: NumericField,
    sourceAmount: number,
    sinkAmount: number,
  ): void {
    const sheet = this.sheets.get(quantity);
    if (!sheet) throw new Error(`No balance sheet started for ${quantity}.`);
    if (!Number.isFinite(sourceAmount) || !Number.isFinite(sinkAmount)) {
      throw new Error(`Non-finite ${quantity} pass accounting.`);
    }
    sheet.sources[sheet.sourceChannel] = sourceAmount;
    sheet.sinks[sheet.sinkChannel] = sinkAmount;
    sheet.closing = sumField(field);
    const actualDelta = sheet.closing - sheet.opening;
    const accountedDelta = totalChannels(sheet.sources) - totalChannels(sheet.sinks);
    sheet.observedDelta = actualDelta;
    sheet.unexplained = actualDelta - accountedDelta;
    if (Math.abs(sheet.unexplained) > sheet.tolerance) {
      throw new Error(`Unexplained ${quantity} flux: ${sheet.unexplained}.`);
    }
  }

  assertAll(): void {
    for (const [quantity, sheet] of this.sheets) {
      if (Math.abs(sheet.unexplained) > sheet.tolerance) {
        throw new Error(`Unexplained ${quantity} flux: ${sheet.unexplained}.`);
      }
    }
  }

  snapshot(): Record<string, BalanceSheet> {
    const result: Record<string, BalanceSheet> = {};
    for (const [quantity, sheet] of this.sheets) {
      result[quantity] = {
        opening: sheet.opening,
        closing: sheet.closing,
        observedDelta: sheet.observedDelta,
        sources: { ...sheet.sources },
        sinks: { ...sheet.sinks },
        unexplained: sheet.unexplained,
        tolerance: sheet.tolerance,
        sourceChannel: sheet.sourceChannel,
        sinkChannel: sheet.sinkChannel,
      };
    }
    return result;
  }
}
