import init, { Router } from "../wasm/router/router.js";

let initialized: Promise<void> | undefined;

async function initializeRouter(): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    const wasmUrl = new URL("../wasm/router/router_bg.wasm", import.meta.url);
    if (typeof window === "undefined") {
      const fs = await import("node:fs/promises");
      await init({ module_or_path: await fs.readFile(wasmUrl) });
    } else {
      await init({ module_or_path: wasmUrl });
    }
  })();
  return initialized;
}

export type WasmRouter = Router;

export async function createWasmRouter(
  width: number,
  height: number,
  landMask: Uint8Array,
  elevation: Float64Array,
  riverDirection: Uint8Array,
  northSouthKm: number,
  rowEastWestKm: Float64Array,
): Promise<WasmRouter> {
  await initializeRouter();
  return new Router(width, height, landMask, elevation, riverDirection, northSouthKm, rowEastWestKm);
}
