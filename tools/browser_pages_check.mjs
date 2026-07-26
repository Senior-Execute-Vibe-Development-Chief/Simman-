// GitHub-Pages-deployment gate for cross-origin isolation
// (docs/popfield-parallel.md §5): serves the BUILT dist/ exactly like Pages —
// a dumb static server sending NO isolation headers — and requires a real
// Chromium to become crossOriginIsolated anyway, via the vendored
// coi-serviceworker shim (register → one automatic reload → headers
// synthesized). This is the proof that the PUBLISHED site can hand the sim
// SharedArrayBuffer, which is everything the worker pool needs from hosting.
//   npm run build && node tools/browser_pages_check.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const PORT = 5299;
const DIST = new URL("../dist/", import.meta.url).pathname;
const EXE = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";
if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("dist/index.html missing — run `npm run build` first"); process.exit(2); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  // Pages layout: the site lives under /Simman-/ (the vite base).
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (!p.startsWith("/Simman-/")) { res.writeHead(404); res.end(); return; }
  p = p.slice("/Simman-/".length) || "index.html";
  if (p.endsWith("/") || p === "") p += "index.html";
  const file = path.join(DIST, p);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  // NO COOP/COEP here — that is the point. Correct MIME though: service
  // worker registration refuses non-JS content types.
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: EXE, headless: true });
let ok = false;
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/Simman-/`, { waitUntil: "domcontentloaded" });
  // The shim registers, then reloads the page once; poll across the
  // navigation until the reloaded document reports isolation.
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    try {
      const st = await page.evaluate(() => ({
        iso: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
        sab: typeof SharedArrayBuffer !== "undefined",
        sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      }));
      if (st.iso && st.sab) { console.log(`✓ Pages-style hosting: crossOriginIsolated=true, SharedArrayBuffer available (service worker controlling: ${st.sw})`); ok = true; break; }
    } catch { /* mid-reload — retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ok) console.error("✗ page never became cross-origin isolated on the headerless server — the shim did not take");
} finally {
  await browser.close();
  server.close();
}
process.exit(ok ? 0 : 1);
