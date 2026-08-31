import init, { dijkstra_test_graph } from "../wasm/router.js";

let initialized: Promise<void> | undefined;

async function initializeRouter(): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    const wasmUrl = new URL("../wasm/router_bg.wasm", import.meta.url);
    if (typeof window === "undefined") {
      const fs = await import("node:fs/promises");
      await init({ module_or_path: await fs.readFile(wasmUrl) });
    } else {
      await init({ module_or_path: wasmUrl });
    }
  })();
  return initialized;
}

export async function dijkstraTestGraph(): Promise<readonly number[]> {
  await initializeRouter();
  return Array.from(dijkstra_test_graph());
}
