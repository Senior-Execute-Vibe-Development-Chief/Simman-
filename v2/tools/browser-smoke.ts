import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, type BrowserType } from "@playwright/test";
import { runM1Checks, type BrowserM1Result } from "../src/sim/browserSmoke";
import { printProvenance } from "./lib/provenance";
import { World } from "../src/sim/world";

const SEED = 42042;
const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;
/** The dev-grid world builds its substrate and creates the worker inside this. */
const SHELL_BOOT_TIMEOUT_MS = 60_000;

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

async function browserResult(type: BrowserType): Promise<BrowserM1Result> {
  const browser = await type.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // The shell must boot on the page Vite builds and Pages serves: the root
    // index. A top-level throw there (a control the script requires that the
    // markup lacks) used to pass this smoke, which only ran the kernel checks
    // below on a page it never watched.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
    assert.equal(isolated, true, `${type.name} did not receive COOP/COEP isolation headers`);
    await page.waitForFunction(
      () => (document.querySelector("#status")?.textContent ?? "").startsWith("Worker "),
      undefined,
      { timeout: SHELL_BOOT_TIMEOUT_MS },
    );
    const status = await page.evaluate(() => document.querySelector("#status")?.textContent ?? "");
    assert.deepEqual(pageErrors, [], `${type.name}: the shell threw while booting`);
    assert.ok(status.startsWith("Worker ready"), `${type.name}: the shell did not reach a ready worker: ${status}`);
    return await page.evaluate(async (seed) => {
      const entry = "/src/sim/browserSmoke.ts";
      const module = await import(entry);
      return module.runM1Checks(seed);
    }, SEED);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  printProvenance(new World({ seed: SEED, grid: "dev" }));
  const nodeResult = await runM1Checks(SEED);
  const server = startServer();
  try {
    await waitForServer();
    // BROWSER_SMOKE_BROWSERS=chromium keeps the per-commit job to one engine;
    // the full matrix runs in the long workflow.
    const wanted = (process.env.BROWSER_SMOKE_BROWSERS ?? "chromium,firefox,webkit")
      .toLowerCase().split(",").map((name) => name.trim());
    const engines: ReadonlyArray<readonly [string, BrowserType]> = ([
      ["Chromium", chromium],
      ["Firefox", firefox],
      ["WebKit", webkit],
    ] as const).filter(([name]) => wanted.includes(name.toLowerCase()));
    assert.ok(engines.length > 0, "BROWSER_SMOKE_BROWSERS names no known engine");
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
      routing: nodeResult.routing,
    }));
  } finally {
    server.kill();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
