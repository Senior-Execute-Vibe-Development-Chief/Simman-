import { TRAVEL_CACHE_LIMIT, TRAVEL_MODE_COUNT } from "../constants";
import { createWasmRouter, type WasmRouter } from "../router";
import type { Substrate } from "../substrate";
import {
  buildCostField,
  northSouthKm,
  rowEastWestKm,
  type CostField,
  type TravelMetric,
  type TravelMode,
  TRAVEL_MODES,
} from "./cost";

export interface TravelRoute {
  readonly days: number;
  readonly path: readonly number[];
  /** Mode index per path entry (aligned with `path`); a transfer repeats the cell with both modes. */
  readonly modes: readonly number[];
}

function metricKey(metric: TravelMetric): string {
  const modes = [...metric.modes].sort().join(",");
  const capabilities = [...metric.capabilities].sort().join(",");
  return `${metric.month}|${modes}|${capabilities}`;
}

/**
 * Three-phase travel engine. Topology preprocessing is performed once, a
 * customized metric is cached by month/modes/capabilities, and queries only
 * touch the current WASM workspace.
 */
export class TravelEngine {
  readonly substrate: Substrate;
  private readonly router: WasmRouter;
  private readonly cache = new Map<string, CostField>();
  private activeKey = "";
  private constructor(substrate: Substrate, router: WasmRouter) {
    this.substrate = substrate;
    this.router = router;
  }

  static async create(substrate: Substrate): Promise<TravelEngine> {
    const router = await createWasmRouter(
      substrate.width,
      substrate.height,
      substrate.landMask,
      Float64Array.from(substrate.elevation),
      substrate.rivers.direction,
      northSouthKm(substrate),
      rowEastWestKm(substrate),
    );
    router.preprocess();
    return new TravelEngine(substrate, router);
  }

  private applyField(field: CostField): void {
    if (!this.router.customize(
      field.modeCostPerKm,
      field.modeMask,
      field.windU,
      field.windV,
      field.riverGradient,
      field.transferDays,
      field.slopeFactor,
      field.riverDownstreamFactor,
      field.riverUpstreamFactor,
      field.riverDownGradientLimit,
      field.riverUpGradientLimit,
      field.windGain,
      field.windRefMs,
    )) {
      throw new Error("WASM router rejected the customized metric dimensions.");
    }
  }

  customize(metric: TravelMetric): void {
    const key = metricKey(metric);
    if (key === this.activeKey) return;
    let field = this.cache.get(key);
    if (!field) {
      field = buildCostField(this.substrate, metric);
      this.applyField(field);
      this.cache.set(key, field);
      while (this.cache.size > TRAVEL_CACHE_LIMIT) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    } else {
      this.applyField(field);
    }
    this.activeKey = key;
  }

  query(start: number, goal: number, metric: TravelMetric): TravelRoute {
    this.customize(metric);
    const days = this.router.query(start, goal);
    return {
      days,
      path: Array.from(this.router.path()),
      modes: Array.from(this.router.path_modes()),
    };
  }

  distanceMap(sources: readonly number[], metric: TravelMetric): Float64Array {
    this.customize(metric);
    return this.router.distance_map(Uint32Array.from(sources));
  }

  get cachedMetricCount(): number {
    return this.cache.size;
  }

  get modeCount(): number {
    return TRAVEL_MODE_COUNT;
  }

  static defaultMetric(month = 0): TravelMetric {
    return {
      month,
      modes: [...TRAVEL_MODES] as TravelMode[],
      capabilities: ["packAnimals", "wheelsDraft", "boats", "navigation"],
    };
  }
}

export async function createTravelEngine(substrate: Substrate): Promise<TravelEngine> {
  return TravelEngine.create(substrate);
}
