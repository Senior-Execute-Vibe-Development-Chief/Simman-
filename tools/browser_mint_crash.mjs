// Browser mint-crash v2: open at 0.5×/Quarter, Play through first cities, catch error banner / [SimWorker].
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const PORT = 5302;
const DIST = new URL("../dist/", import.meta.url).pathname;
const EXE = process.env.PW_CHROMIUM || "/usr/local/bin/google-chrome";
if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("need dist"); process.exit(2); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (!p.startsWith("/Simman-/")) { res.writeHead(404); res.end(); return; }
  p = p.slice("/Simman-/".length) || "index.html";
  if (p.endsWith("/") || p === "") p += "index.html";
  const file = path.join(DIST, p);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const errors = [];
const logs = [];
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
let exitCode = 0;

try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (/SimWorker|invent-jump|mint-ready|uncaught|TypeError|Error:|DataClone/i.test(t) || msg.type() === "error") {
      logs.push(t);
      console.log("C", msg.type(), t.slice(0, 350));
    }
    if (/\[SimWorker\]/.test(t) || /DataCloneError|popField worker pool died/i.test(t)) errors.push(t);
  });
  page.on("pageerror", (e) => { errors.push("page: " + e.message); console.log("PAGE", e.message); });

  await page.goto(`http://localhost:${PORT}/Simman-/`, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Wait for first boot world enough to show New World controls.
  await page.waitForTimeout(8000);

  // Open New World if needed, set 0.5× + Quarter, regenerate.
  const clicked = await page.evaluate(() => {
    const byText = (re) => [...document.querySelectorAll("button")].find((b) => re.test((b.textContent || "").trim()));
    // Try open "New" / world panel
    const nw = byText(/^New$|^World$|New world/i);
    if (nw) nw.click();
    const half = byText(/^0\.5×$/);
    const quarter = byText(/^Quarter$/);
    if (half) half.click();
    // Quarter button itself regenerates
    if (quarter) { quarter.click(); return { half: !!half, quarter: true }; }
    return { half: !!half, quarter: false };
  });
  console.log("scale clicks", clicked);

  // Wait for invent-jump mint-ready (or invent open)
  const t0 = Date.now();
  let openStep = null;
  while (Date.now() - t0 < 420000) {
    const hit = logs.find((l) => /mint-ready at step (\d+)/.test(l) || /invent-jump: farming at step/.test(l) && /mint-ready/.test(l));
    const m = logs.map((l) => l.match(/mint-ready at step (\d+)/)).find(Boolean);
    if (m) { openStep = +m[1]; break; }
    const banner = await page.evaluate(() => {
      const t = document.body.innerText || "";
      if (/internal error|worker reported an error|map view failed/.test(t)) return t.match(/.{0,80}(internal error|worker reported|map view failed).{0,200}/)?.[0] || "banner";
      return null;
    });
    if (banner) { errors.push(banner); break; }
    await page.waitForTimeout(2000);
  }
  console.log("openStep", openStep, "err", errors.length);
  if (errors.length) throw new Error("error before play");

  // PLAY
  await page.evaluate(() => {
    const play = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("▶"));
    if (play) play.click();
  });
  console.log("pressed play");

  // Watch step advance via console invent / settlements, and banner
  const t1 = Date.now();
  let lastCities = 0;
  while (Date.now() - t1 < 240000) {
    const st = await page.evaluate(() => {
      const body = document.body.innerText || "";
      const banner = /internal error|worker reported an error|map view failed/.test(body)
        ? (body.match(/.{0,40}(The simulation|The map view|worker reported).{0,220}/) || [body.slice(0, 260)])[0]
        : null;
      // HUD often shows year + step somewhere — also count "Cities" style stats
      const cityM = body.match(/Cities\s+(\d+)/i) || body.match(/cities\s*[·:]\s*(\d+)/i);
      const stepM = body.match(/\b(\d{4,6})\b(?=\s*(BCE|CE|BC|AD)?)/g);
      return { banner, cities: cityM ? +cityM[1] : null, snippet: body.slice(0, 120).replace(/\s+/g, " ") };
    });
    if (st.banner) {
      console.error("BANNER", st.banner);
      errors.push(st.banner);
      break;
    }
    if (st.cities != null && st.cities !== lastCities) {
      console.log("cities", lastCities, "→", st.cities, st.snippet);
      lastCities = st.cities;
    }
    if (errors.length) break;
    // Success: saw several cities and no error for a while after first city
    if (lastCities >= 2 && Date.now() - t1 > 60000) { console.log("OK played with cities, no error"); break; }
    await page.waitForTimeout(2500);
  }
  if (errors.length) exitCode = 1;
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
console.log("\nERRORS", errors);
console.log("LOGS_TAIL", logs.slice(-15));
process.exit(exitCode);
