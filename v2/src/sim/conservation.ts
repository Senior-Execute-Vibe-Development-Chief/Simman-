import { CONSERVATION_EPSILON } from "./constants";

export interface BalanceSheet {
  opening: number;
  closing: number;
  observedDelta: number;
  sources: Record<string, number>;
  sinks: Record<string, number>;
  unexplained: number;
}

type NumericField = { readonly length: number; readonly [index: number]: number };
type MutableNumericField = { readonly length: number; [index: number]: number };

function sumField(field: NumericField): number {
  let total = 0;
  for (let index = 0; index < field.length; index++) total += field[index] ?? 0;
  return total;
}

function totalChannels(channels: Record<string, number>): number {
  let total = 0;
  for (const value of Object.values(channels)) total += value;
  return total;
}

/**
 * A small balance-sheet engine. M0's placeholder field is deliberately
 * non-physical, but every write still has a named source or sink so the
 * conservation wiring is exercised before real matter is introduced.
 */
export class ConservationLedger {
  private readonly sheets = new Map<string, BalanceSheet>();

  begin(quantity: string, field: NumericField): void {
    const previous = this.sheets.get(quantity);
    const sheet = previous ?? {
      opening: 0,
      closing: 0,
      observedDelta: 0,
      sources: {},
      sinks: {},
      unexplained: 0,
    };
    sheet.opening = sumField(field);
    sheet.closing = sheet.opening;
    sheet.observedDelta = 0;
    sheet.sources = {};
    sheet.sinks = {};
    sheet.unexplained = 0;
    this.sheets.set(quantity, sheet);
  }

  write(
    quantity: string,
    field: MutableNumericField,
    index: number,
    next: number,
    source: string,
    sink: string,
  ): void {
    const sheet = this.sheets.get(quantity);
    if (!sheet) throw new Error(`No balance sheet started for ${quantity}.`);
    if (!Number.isFinite(next)) throw new Error(`Non-finite write to ${quantity}.`);
    const previous = field[index] ?? 0;
    const delta = next - previous;
    field[index] = next;
    sheet.observedDelta += delta;
    if (delta >= 0) {
      sheet.sources[source] = (sheet.sources[source] ?? 0) + delta;
    } else {
      sheet.sinks[sink] = (sheet.sinks[sink] ?? 0) - delta;
    }
  }

  end(quantity: string, field: NumericField): BalanceSheet {
    const sheet = this.sheets.get(quantity);
    if (!sheet) throw new Error(`No balance sheet started for ${quantity}.`);
    sheet.closing = sumField(field);
    const actualDelta = sheet.closing - sheet.opening;
    const accountedDelta = totalChannels(sheet.sources) - totalChannels(sheet.sinks);
    sheet.unexplained = actualDelta - accountedDelta;
    if (Math.abs(sheet.unexplained) > CONSERVATION_EPSILON) {
      throw new Error(`Unexplained ${quantity} flux: ${sheet.unexplained}.`);
    }
    return sheet;
  }

  assertAll(): void {
    for (const [quantity, sheet] of this.sheets) {
      if (Math.abs(sheet.unexplained) > CONSERVATION_EPSILON) {
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
      };
    }
    return result;
  }
}
