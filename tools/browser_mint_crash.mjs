// Browser mint-crash: default Earth Sim (2× / Half → tw=960, seed 8817).
// Wait for invent-jump mint-ready, Max through first cities, fail on error banner.
// Repro of the ~35088 transport frontier OOM (road short-circuit ocean flood).
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
const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let exitCode = 0;

function bannerSnippet(t) {
  if (!/internal error|worker reported an error|map view failed|Array buffer|frontier heap/i.test(t)) return null;
  return (t.match(/.{0,60}(internal error|worker reported|map view failed|Array buffer|frontier heap).{0,220}/i) || [t.slice(0, 280)])[0];
}

try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    const t = msg.text();
    if (/SimWorker|invent-jump|mint-ready|transHeap|uncaught|TypeError|Error:|DataClone|frontier heap|Array buffer/i.test(t) || msg.type() === "error") {
      logs.push(t);
      console.log("C", msg.type(), t.slice(0, 400));
    }
    if (/\[SimWorker\]/.test(t) || /DataCloneError|popField worker pool died|frontier heap exceeded|Array buffer allocation failed/i.test(t)) {
      errors.push(t);
    }
  });
  page.on("pageerror", (e) => { errors.push("page: " + e.message); console.log("PAGE", e.message); });

  await page.goto(`http://localhost:${PORT}/Simman-/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  // Default boot is already Earth Sim / 2× / Half / seed 8817 — wait for genesis gather.
  await page.waitForTimeout(5000);

  // Ensure New World panel shows defaults (don't downscale — crash is tw=960-only).
  await page.evaluate(() => {
    const byText = (re) => [...document.querySelectorAll("button")].find((b) => re.test((b.textContent || "").trim()));
    const nw = byText(/^New$|^World$|New world/i);
    if (nw) nw.click();
    const twoX = byText(/^2×$/);
    const half = byText(/^Half$/);
    if (twoX) twoX.click();
    if (half) half.click();
  });

  // Wait for invent-jump mint-ready
  const t0 = Date.now();
  let openStep = null;
  while (Date.now() - t0 < 900000) {
    const m = logs.map((l) => l.match(/mint-ready at step (\d+)/)).find(Boolean);
    if (m) { openStep = +m[1]; break; }
    const body = await page.evaluate(() => document.body.innerText || "");
    const b = bannerSnippet(body);
    if (b) { errors.push(b); break; }
    if (errors.length) break;
    await page.waitForTimeout(3000);
  }
  console.log("openStep", openStep, "err", errors.length, "elapsed_ms", Date.now() - t0);
  if (errors.length) throw new Error("error before play");
  if (openStep == null) throw new Error("timed out waiting for mint-ready");

  // Max only sets speed — must also click ▶ to play. Crash was under Max after
  // first cities / crystallize ~35040.
  const clicked = await page.evaluate(() => {
    const byText = (re) => [...document.querySelectorAll("button")].find((b) => re.test((b.textContent || "").trim()));
    const max = byText(/^Max$/);
    const play = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("▶"));
    if (max) max.click();
    if (play) play.click();
    return { max: !!max, play: !!play, playLabel: play ? (play.textContent || "").trim() : null };
  });
  console.log("pressed", clicked);
  if (!clicked.play) throw new Error("Play (▶) button not found");

  const t1 = Date.now();
  let lastCities = 0;
  let sawPastCrashStep = false;
  while (Date.now() - t1 < 600000) {
    const st = await page.evaluate(() => {
      const body = document.body.innerText || "";
      const banner = /internal error|worker reported an error|map view failed/i.test(body)
        ? (body.match(/.{0,40}(The simulation|The map view|worker reported).{0,220}/) || [body.slice(0, 260)])[0]
        : null;
      const cityM = body.match(/Cities\s+(\d+)/i) || body.match(/cities\s*[·:]\s*(\d+)/i);
      const stepM = body.match(/\bstep\s*[·:]?\s*(\d{4,6})\b/i) || body.match(/\b(\d{5})\b/);
      return {
        banner,
        cities: cityM ? +cityM[1] : null,
        step: stepM ? +stepM[1] : null,
        snippet: body.slice(0, 140).replace(/\s+/g, " "),
      };
    });
    if (st.banner) {
      console.error("BANNER", st.banner);
      errors.push(st.banner);
      break;
    }
    if (errors.length) break;
    if (st.cities != null && st.cities !== lastCities) {
      console.log("cities", lastCities, "→", st.cities, "step~", st.step, st.snippet);
      lastCities = st.cities;
    }
    // Historical crash ~35088; mint-ready was ~34575. Clear if we pass +800 post-mint or 2+ cities.
    if (st.step != null && openStep != null && st.step >= openStep + 800) {
      sawPastCrashStep = true;
      console.log("OK past mint+800 (step", st.step, ") cities", lastCities);
      break;
    }
    if (lastCities >= 2 && Date.now() - t1 > 90000) {
      console.log("OK played with cities, no error");
      break;
    }
    await page.waitForTimeout(2500);
  }
  if (errors.length) exitCode = 1;
  else if (!sawPastCrashStep && lastCities < 1) {
    console.error("no cities and did not clear mint+800 window");
    exitCode = 1;
  }
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
console.log("\nERRORS", errors);
console.log("LOGS_TAIL", logs.slice(-20));
process.exit(exitCode);
