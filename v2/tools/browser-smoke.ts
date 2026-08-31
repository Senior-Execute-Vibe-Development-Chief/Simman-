import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, type BrowserType } from "@playwright/test";
import { runM0Checks, type BrowserM0Result } from "../src/sim/browserSmoke";
import { printProvenance } from "./lib/provenance";
import { World } from "../src/sim/world";

const SEED = 42042;
const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${BASE_URL}/`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite server did not start.");
}

function startServer(): ChildProcess {
  const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
  return spawn(process.execPath, [vite, "--host", HOST, "--port", String(PORT)], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    stdio: "ignore",
  });
}

async function browserResult(type: BrowserType): Promise<BrowserM0Result> {
  const browser = await type.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    return await page.evaluate(async (seed) => {
      const entry = "/src/sim/browserSmoke.ts";
      const module = await import(entry);
      return module.runM0Checks(seed);
    }, SEED);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  printProvenance(new World({ seed: SEED, grid: "dev" }));
  const nodeResult = await runM0Checks(SEED);
  const server = startServer();
  try {
    await waitForServer();
    const engines: ReadonlyArray<readonly [string, BrowserType]> = [
      ["Chromium", chromium],
      ["Firefox", firefox],
      ["WebKit", webkit],
    ];
    for (const [name, type] of engines) {
      const result = await browserResult(type);
      assert.deepEqual(result, nodeResult, `${name} diverged from Node`);
      console.log(JSON.stringify({ engine: name, status: "identical" }));
    }
    console.log(JSON.stringify({
      browser: "ok",
      engines: engines.map(([name]) => name),
      worldHashes: nodeResult.worldHashes,
      dmathGoldens: nodeResult.dmathBits.length,
      wasmDistances: nodeResult.wasmDistances,
    }));
  } finally {
    server.kill();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
