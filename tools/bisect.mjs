// BISECT — run the exhaustive metric collector across a COMMIT RANGE.
//
// Replaces the other thing hand-rolled in the 2026-07-31 session: creating git
// worktrees by hand, copying a probe into each, running them one at a time and
// comparing by eye. That is how the size-target regression was eventually found — it
// worked, but it took two sessions and three wrong attributions, because each manual
// pass measured only the two or three numbers someone thought to print.
//
// Here every commit in the range is measured on the SAME exhaustive metric map, so the
// jump is found by the tool rather than guessed at. The metric that broke does not have
// to be known in advance — `--auto` ranks every metric by how sharply it steps.
//
//   node tools/bisect.mjs --range=dc4e0e9..19bd402 --metric=realm.areaKm2.p50
//   node tools/bisect.mjs --range=dc4e0e9..HEAD --auto --steps=6000 --W=960
//   node tools/bisect.mjs --commits=b859db7,deffdce,de97888 --metric=realm.claimedPct
//
// NOTE --W=960 is the SHIPPED app grid (see the THIRD CARDINAL RULE). The 2026-07-28
// regression was a 10% effect at the default reference grid and 10x at the app grid;
// bisecting at the reference alone would have cleared the guilty commit.
import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const RANGE = arg("range", ""), COMMITS = arg("commits", "");
const METRIC = arg("metric", "realm.areaKm2.p50");
const STEPS = +arg("steps", 6000), W = +arg("W", 480), SEED = +arg("seed", 8817);
const AUTO = has("auto"), TOP = +arg("top", 20);

let shas = [];
if (COMMITS) shas = COMMITS.split(",").map(s => s.trim()).filter(Boolean);
else if (RANGE) shas = execSync(`git log --format=%h --reverse ${RANGE}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
else { console.error("usage: node tools/bisect.mjs --range=<a>..<b> | --commits=a,b,c  [--metric=<name> | --auto]"); process.exit(2); }
if (shas.length < 2) { console.error("[bisect] need at least two commits"); process.exit(2); }

const subj = (s) => execSync(`git log -1 --format="%ad %s" --date=format:'%m-%d %H:%M' ${s}`, { encoding: "utf8" }).trim().slice(0, 76);
const wt = mkdtempSync(join(tmpdir(), "simbisect-"));
const RUNNER = `
import { buildSim } from "./tools/_harness.mjs";
import { stepPeopleSim } from "./src/sim/peopleSim/index.js";
import { collect } from "./tools/lib/simmetrics.mjs";
const w = buildSim({ W: ${W}, H: ${W >> 1}, seed: ${SEED} });
stepPeopleSim(w, ${STEPS});
process.stdout.write("<<<M>>>" + JSON.stringify(collect(w)));
`;

console.log(`[bisect] ${shas.length} commits · metric ${AUTO ? "AUTO (all)" : METRIC} · steps=${STEPS} W=${W} (tw=${W >> 1}) seed=${SEED}`);
execSync(`git worktree add -q --detach ${wt} ${shas[0]}`, { stdio: "pipe" });
const results = [];
try {
  for (const sha of shas) {
    try {
      execSync(`git -C ${wt} checkout -q --detach ${sha}`, { stdio: "pipe" });
      // The COLLECTOR is always the current one — only src/ varies. Otherwise each
      // commit would be measured by its own contemporary probe and nothing would be
      // comparable, which is exactly the trap the manual bisects fell into.
      mkdirSync(join(wt, "tools", "lib"), { recursive: true });
      copyFileSync("tools/lib/simmetrics.mjs", join(wt, "tools", "lib", "simmetrics.mjs"));
      writeFileSync(join(wt, "_bisect_run.mjs"), RUNNER);
      const raw = execSync(`node _bisect_run.mjs`, { cwd: wt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SIM_TUNE: "" } });
      const m = JSON.parse(raw.slice(raw.indexOf("<<<M>>>") + 7));
      results.push({ sha, m });
      console.log(`  ${sha}  ${AUTO ? "" : (m[METRIC] ?? 0).toFixed(2).padStart(14) + "  "}${subj(sha)}`);
    } catch (e) {
      results.push({ sha, m: null });
      console.log(`  ${sha}  ${"FAILED".padStart(14)}  ${subj(sha)}   (${String(e.message).split("\n")[0].slice(0, 60)})`);
    }
  }
} finally {
  try { execSync(`git worktree remove --force ${wt}`, { stdio: "pipe" }); } catch { rmSync(wt, { recursive: true, force: true }); }
}

const ok = results.filter(r => r.m);
if (ok.length < 2) { console.log("[bisect] too few successful runs to compare"); process.exit(1); }

const effect = (a, b) => (Math.abs(a) + Math.abs(b)) > 0 ? Math.abs(b - a) / (Math.abs(a) + Math.abs(b)) : 0;

if (!AUTO) {
  console.log(`\n  step changes in ${METRIC}:`);
  for (let i = 1; i < ok.length; i++) {
    const a = ok[i - 1].m[METRIC] ?? 0, b = ok[i].m[METRIC] ?? 0;
    const rel = a === 0 ? (b === 0 ? 0 : Infinity) : (b - a) / Math.abs(a) * 100;
    const flag = effect(a, b) >= 0.2 ? "  ◄── LARGEST-CLASS STEP" : "";
    console.log(`    ${ok[i - 1].sha} → ${ok[i].sha}   ${a.toFixed(2).padStart(12)} → ${b.toFixed(2).padStart(12)}   ${(rel === Infinity ? "new" : rel.toFixed(1) + "%").padStart(9)}${flag}`);
  }
} else {
  // Which metric steps hardest, and at which commit? The regression finds itself.
  const keys = [...new Set(ok.flatMap(r => Object.keys(r.m)))];
  const rows = [];
  for (const k of keys) {
    let best = 0, at = -1;
    for (let i = 1; i < ok.length; i++) {
      const e = effect(ok[i - 1].m[k] ?? 0, ok[i].m[k] ?? 0);
      if (e > best) { best = e; at = i; }
    }
    if (at > 0) rows.push({ k, best, at, a: ok[at - 1].m[k] ?? 0, b: ok[at].m[k] ?? 0 });
  }
  rows.sort((x, y) => y.best - x.best);
  console.log(`\n  SHARPEST STEP PER METRIC (top ${TOP} of ${rows.length})`);
  console.log(`  ${"metric".padEnd(34)}${"before".padStart(12)}${"after".padStart(12)}  at commit`);
  for (const r of rows.slice(0, TOP))
    console.log(`  ${r.k.padEnd(34)}${r.a.toFixed(2).padStart(12)}${r.b.toFixed(2).padStart(12)}  ${ok[r.at - 1].sha}→${ok[r.at].sha}  ${subj(ok[r.at].sha).slice(0, 46)}`);
  // which commit is responsible for the most sharp steps?
  const tally = new Map();
  for (const r of rows.slice(0, Math.max(30, Math.floor(rows.length * 0.1)))) tally.set(r.at, (tally.get(r.at) || 0) + 1);
  const worst = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (worst) console.log(`\n[bisect] most sharp steps land at ${ok[worst[0] - 1].sha} → ${ok[worst[0]].sha}  (${worst[1]} of the top movers)\n         ${subj(ok[worst[0]].sha)}`);
}
