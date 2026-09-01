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

function sumField(field: NumericField, weights?: NumericField): number {
  let total = 0;
  for (let index = 0; index < field.length; index++) {
    const value = field[index] ?? 0;
    total += weights ? value * (weights[index] ?? 0) : value;
  }
  return total;
}

function totalChannels(channels: Record<string, number>): number {
  let total = 0;
  for (const key in channels) total += channels[key] ?? 0;
  return total;
}

/**
 * A small balance-sheet engine. A pass declares its accounting channels once,
 * then aggregates their totals while the field is updated. Weighted fields
 * (the people density) are measured in their real conserved unit.
 */
export class ConservationLedger {
  private readonly sheets = new Map<string, BalanceSheet>();
  private readonly weights = new Map<string, NumericField | undefined>();

  beginPass(
    quantity: string,
    field: NumericField,
    sourceChannel: string,
    sinkChannel: string,
    weights?: NumericField,
  ): void {
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
    sheet.opening = sumField(field, weights);
    sheet.closing = sheet.opening;
    sheet.observedDelta = 0;
    for (const key in sheet.sources) sheet.sources[key] = 0;
    for (const key in sheet.sinks) sheet.sinks[key] = 0;
    sheet.sources[sourceChannel] = 0;
    sheet.sinks[sinkChannel] = 0;
    sheet.unexplained = 0;
    sheet.tolerance = CONSERVATION_EPSILON * Math.max(1, field.length);
    this.sheets.set(quantity, sheet);
    this.weights.set(quantity, weights);
  }

  /** Add an explicitly balanced channel, such as migration in/out. */
  recordChannel(quantity: string, channel: string, sourceAmount: number, sinkAmount: number): void {
    const sheet = this.sheets.get(quantity);
    if (!sheet) throw new Error(`No balance sheet started for ${quantity}.`);
    if (!Number.isFinite(sourceAmount) || !Number.isFinite(sinkAmount)) {
      throw new Error(`Non-finite ${quantity} channel accounting.`);
    }
    sheet.sources[channel] = sourceAmount;
    sheet.sinks[channel] = sinkAmount;
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
    sheet.closing = sumField(field, this.weights.get(quantity));
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
