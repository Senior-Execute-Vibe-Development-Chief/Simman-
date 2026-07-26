// Headless-browser gate for the popField pool's BROWSER leg
// (docs/popfield-parallel.md §6): boots the vite dev server (which now sends
// the COOP/COEP headers), opens test-popfield.html in the preinstalled
// chromium via playwright-core, and requires: crossOriginIsolated === true,
// the pool genuinely engaged (nested workers, not the fallback), and the
// lever-0 vs lever-4 hashes identical IN THE BROWSER.
//   node tools/browser_popfield_check.mjs
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const PORT = 5199;
const URL_ = `http://localhost:${PORT}/test-popfield.html`;
const EXE = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "pipe" });
let srvOut = "";
server.stdout.on("data", (d) => (srvOut += d));
server.stderr.on("data", (d) => (srvOut += d));
const kill = () => { try { server.kill("SIGTERM"); } catch { /* ignore */ } };
process.on("exit", kill);

// wait for the dev server
const t0 = Date.now();
for (;;) {
  try { const r = await fetch(`http://localhost:${PORT}/Simman-/`); if (r.ok || r.status === 404) break; } catch { /* not up yet */ }
  if (Date.now() - t0 > 60000) { console.error("vite dev server did not come up:\n" + srvOut.slice(-2000)); process.exit(1); }
  await new Promise((r) => setTimeout(r, 300));
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text(), "@", JSON.stringify(m.location())); });
  page.on("pageerror", (e) => console.error("[pageerror]", String(e)));
  page.on("response", (r) => { if (r.status() >= 400) console.error("[http", r.status() + "]", r.url()); });
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  // Module scripts may execute after domcontentloaded from the driver's point
  // of view — wait for the page to have stamped the flag, don't race it.
  await page.waitForFunction(() => typeof window.__isolated !== "undefined", null, { timeout: 30000 });
  const isolated = await page.evaluate(() => window.__isolated);
  console.log(`[browser] crossOriginIsolated=${isolated}`);
  if (!isolated) { console.error("page is NOT cross-origin isolated — COOP/COEP headers missing"); process.exit(1); }
  await page.waitForFunction(() => document.title === "DONE" || document.title === "FAIL", null, { timeout: 480000, polling: 1000 });
  const res = await page.evaluate(() => window.__result);
  console.log("[browser]", JSON.stringify(res));
  if (!res || !res.ok) { console.error("browser identity check FAILED"); process.exit(1); }
  console.log(`✓ browser leg: pool engaged (${res.bands} bands, nested workers), hashes identical (${res.h0}) in ${res.secs}s`);
} finally {
  await browser.close();
  kill();
}
