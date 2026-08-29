#!/usr/bin/env node
// Overnight W=960 (tw=480) measurement battery — SEQUENTIAL only (OOM if parallel).
// Logs to docs/runs/<date>/overnight-960-<stamp>/.
//
//   node tools/battery_960_overnight.mjs
//   node tools/battery_960_overnight.mjs --quick   # 12k steps, skip stylized

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const QUICK = process.argv.includes("--quick");
const STEPS = QUICK ? "12000" : "28000";
const STYL_STEPS = QUICK ? "12000" : "24000";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const runDir = join(ROOT, "docs", "runs", new Date().toISOString().slice(0, 10), `overnight-960-${stamp}`);
mkdirSync(runDir, { recursive: true });

const manifest = {
  startedAt: new Date().toISOString(),
  grid: "W=960 tw=480 (Half / shipped simDiv 2)",
  steps: STEPS,
  quick: QUICK,
  jobs: [],
};

function runJob(name, cmd, env = {}) {
  const logPath = join(runDir, `${name}.log`);
  const start = Date.now();
  console.log(`\n[battery960] ── ${name} ──`);
  console.log(`[battery960] log → ${logPath}`);
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const body = (r.stdout || "") + (r.stderr || "");
  writeFileSync(logPath, body);
  const ok = r.status === 0;
  manifest.jobs.push({ name, ok, elapsedSec: +elapsed, log: logPath, exit: r.status });
  appendFileSync(join(runDir, "battery.log"), `\n=== ${name} exit=${r.status} ${elapsed}s ===\n${body}\n`);
  if (!ok) console.error(`[battery960] FAILED ${name} exit=${r.status}`);
  else console.log(`[battery960] ok ${name} (${elapsed}s)`);
  return ok;
}

console.log(`[battery960] run dir: ${runDir}`);
console.log(`[battery960] steps=${STEPS} quick=${QUICK}`);

// 1 — tile money checkpoints (v52 defaults, TILE_MONEY ON)
runJob("tilemoney_8817", ["node", "tools/probe_tilemoney_measure.mjs", STEPS, "8817", "960"]);
runJob("tilemoney_31337", ["node", "tools/probe_tilemoney_measure.mjs", STEPS, "31337", "960"]);

// 2 — legacy grain ledger A/B at same horizon
runJob("tilemoney_8817_off", ["node", "tools/probe_tilemoney_measure.mjs", STEPS, "8817", "960"], {
  SIM_TUNE: "TILE_MONEY=0",
});

// 3 — fooddiag live (emergent vs ratchet, sequential arms inside)
runJob("fooddiag_live_8817", ["node", "tools/probe_fooddiag.mjs", "--live", "8817"]);
if (!QUICK) {
  runJob("fooddiag_live_31337", ["node", "tools/probe_fooddiag.mjs", "--live", "31337"]);
}

// 4 — political map shape at shipped grid (W=1920 → tw=960)
runJob("shape_1920_8817", ["node", "tools/probe_shape.mjs", STEPS, "1920", "8817", "4000"]);

// 5 — resgate at longer horizon (realm-count fail at 6k)
const resgateSteps = QUICK ? "12000" : "24000";
runJob("resgate_" + resgateSteps, ["node", "tools/resgate.mjs", resgateSteps, "8817"]);

// 6 — stylized facts at 960 (single seed — multi-seed is 3× cost)
if (!QUICK) {
  runJob("stylized_960_8817", ["node", "tools/stylized.mjs", "8817", STYL_STEPS, "960"]);
  runJob("stylized_960_31337", ["node", "tools/stylized.mjs", "31337", STYL_STEPS, "960"]);
}

manifest.finishedAt = new Date().toISOString();
manifest.failures = manifest.jobs.filter(j => !j.ok).map(j => j.name);
writeFileSync(join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log("\n[battery960] ── DONE ──");
console.log(`[battery960] manifest: ${join(runDir, "manifest.json")}`);
if (manifest.failures.length) {
  console.error(`[battery960] failures: ${manifest.failures.join(", ")}`);
  process.exit(1);
}
