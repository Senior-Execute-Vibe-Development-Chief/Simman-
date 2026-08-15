// Headless UI smoke, playwright-core variant of tools/ui_smoke.mjs for
// environments where puppeteer can't download a browser (uses the
// pre-provisioned Chromium at /opt/pw-browsers/chromium, PW_CHROMIUM to
// override). Serves the built bundle, loads it, watches for render crashes
// through world generation, then presses "2" (the Politics lens) so the
// political-map draw path — fills, bloc colors, borders, labels — actually
// executes before we call the render safe.
//   npm run build && node tools/ui_smoke_pw.mjs
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";

const EXE = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.startsWith("/Simman-/")) p = p.slice("/Simman-/".length);
  if (p === "" || p === "/" || p.endsWith("/")) p += "index.html";
  const f = "dist/" + p.replace(/^\/+/, "");
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", MIME[f.slice(f.lastIndexOf("."))] || "application/octet-stream");
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(8732, r));

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message + "\n" + (e.stack || "").split("\n").slice(0, 6).join("\n")));
page.on("console", m => { const t = m.text(); if (m.type() === "error" && !t.includes("ERR_CERT") && !t.includes("Failed to load resource")) errors.push("CONSOLE: " + t.slice(0, 500)); });
await page.goto("http://127.0.0.1:8732/Simman-/", { waitUntil: "domcontentloaded" });

let lensPressed = false;
for (let t = 0; t < 40; t++) {
  await new Promise(r => setTimeout(r, 1500));
  const state = await page.evaluate(() => {
    const root = document.getElementById("root");
    return { children: root ? root.children.length : -1, html: root ? root.innerHTML.length : 0, hasCanvas: !!document.querySelector("canvas"), bodyText: document.body.innerText.slice(0, 80) };
  });
  if (t % 6 === 0 || errors.length) console.log(`t=${t * 1.5}s root.children=${state.children} html=${state.html} canvas=${state.hasCanvas}`);
  // Once the map canvas exists, exercise the Politics lens draw path.
  if (!lensPressed && state.hasCanvas && t > 8) { await page.keyboard.press("2"); lensPressed = true; console.log("[ui] pressed '2' — Politics lens"); }
  if (errors.length) { console.log("\n── ERRORS ──"); for (const e of errors) console.log(e); break; }
  if (t === 39) console.log("final text:", state.bodyText, "| politics lens exercised:", lensPressed);
}
await page.screenshot({ path: "/tmp/ui_pw.png" });
if (errors.length) process.exitCode = 1;
await browser.close(); srv.close();
console.log(errors.length ? "[ui_smoke_pw] FAIL" : "[ui_smoke_pw] pass — screenshot /tmp/ui_pw.png");
