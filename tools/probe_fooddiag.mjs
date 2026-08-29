// TIGHT FOOD / RATCHET DIAGNOSTIC — why full milbalance runs crash, and how to
// measure without crashing.
//
// CRASH PATTERNS (headless + cloud agent):
//   1. PARALLEL ARMS — three tw=960/32k processes ≈ 3×7–8GB RAM → OOM / container kill.
//      Always ONE arm per process; this tool spawns sequentially.
//   2. LATE WINDOW COST — MARKET_PULL re-contests every tile; cost grows with
//      register × map. The 28k–32k window at tw=960 can take 20+ minutes alone.
//   3. TRANSPORT HEAP RUNAWAY — computeTransport can spike transHeap cap past
//      500k entries when the register explodes (see chaos mil logs). Watch CRASH_RISK.
//   4. BROWSER (play link) — different disease: snapshot ArrayBuffer churn at tw=960
//      (docs/allocation-wall-2026-08-20.md). Headless probes do not reproduce that.
//
// DEFAULTS (fast, gate-aligned): W=480, 24000 steps, windows from 12k only.
//   --live  → W=960, 28000 steps (one arm ~8–15 min; never parallelize).
//   --chaos → third null arm (MINING_RATE float epsilon) for noise band.
//
//   node tools/probe_fooddiag.mjs [seed]
//   npm run fooddiag
import { spawnSync } from "node:child_process";
import { mkdirSync, createWriteStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const argv = process.argv.slice(2);
const LIVE = argv.includes("--live");
const CHAOS = argv.includes("--chaos");
const seedArg = argv.find(a => !a.startsWith("--"));
const SEED = +(seedArg || 8817);
const W = LIVE ? 960 : 480;
const STEPS = LIVE ? 28000 : 24000;

const LIVE_TUNE = [
  "DAWN_LIVE=1", "STATE_RECORDS=1", "LAND_KNOW=1", "PEER_SEATS=1",
  "FOUND_DRIFT=1", "ABSORB_ORG_ERA=1", "WAR_FINISH=1",
  "SETT_STRIDE=3", "TRADE_STRIDE=5", "CORE_LOCAL=1",
].join(",");

const ARMS = [
  { name: "emergent", tune: LIVE_TUNE },
  { name: "ratchet", tune: `${LIVE_TUNE},MARKET_PULL=0,PRICE_GROSS=0,HAUL_PAID=0,URBAN_LABOR=0` },
];
if (CHAOS) ARMS.push({ name: "chaos", tune: `${LIVE_TUNE},MINING_RATE=5.0000001` });

const runDir = join(ROOT, "docs", "runs", new Date().toISOString().slice(0, 10));
mkdirSync(runDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logs = [];

console.log(`[fooddiag] protocol: sequential arms, W=${W} steps=${STEPS} seed=${SEED}`);
console.log(`[fooddiag] arms: ${ARMS.map(a => a.name).join(", ")}`);
console.log(`[fooddiag] logs → ${runDir}/`);

for (const arm of ARMS) {
  const logPath = join(runDir, `fooddiag_${stamp}_${arm.name}.log`);
  logs.push({ ...arm, logPath });
  console.log(`\n[fooddiag] ── starting arm: ${arm.name} ──`);
  const logStream = createWriteStream(logPath);
  const r = spawnSync(process.execPath, [
    join(__dir, "probe_fooddiag_arm.mjs"), String(W), String(STEPS), String(SEED), arm.name,
  ], {
    cwd: ROOT,
    env: { ...process.env, SIM_TUNE: arm.tune, _FOODDIAG_CHILD: "1" },
    encoding: "utf8",
  });
  if (r.stdout) {
    process.stdout.write(r.stdout);
    logStream.write(r.stdout);
  }
  if (r.stderr) {
    process.stderr.write(r.stderr);
    logStream.write(r.stderr);
  }
  logStream.end();
  if (r.status !== 0) {
    console.error(`[fooddiag] ARM FAILED: ${arm.name} exit=${r.status}`);
    process.exit(r.status || 1);
  }
  console.log(`[fooddiag] arm ${arm.name} ok → ${logPath}`);
}

// Summary: parse last MACHINE line from each arm log
function lastMachine(path) {
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter(l => /\bMACHINE\s+\d/.test(l));
    return lines[lines.length - 1]?.trim() || "";
  } catch { return ""; }
}

const emergentLog = logs.find(a => a.name === "emergent")?.logPath;
const ratchetLog = logs.find(a => a.name === "ratchet")?.logPath;
console.log("\n[fooddiag] ── SUMMARY (last MACHINE row per arm) ──");
for (const { name, logPath } of logs) console.log(`  ${name}: ${lastMachine(logPath)}`);
if (emergentLog && CHAOS) {
  const chaosLog = logs.find(a => a.name === "chaos")?.logPath;
  console.log(`\n[fooddiag] optional cmp_arms (emergent vs chaos null):`);
  console.log(`  node tools/cmp_arms.mjs treated=${emergentLog} base=${chaosLog} chaos=${chaosLog}`);
}
