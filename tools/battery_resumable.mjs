// Chunked, container-restart-proof battery driver (backlog #12): drives
// earthFullRecord.mjs in CHUNKS, resuming from its own .world.json checkpoint
// when one exists — so a 1920-grid run that outlives any single container
// completes across sessions. State lives under bench/ (gitignored).
//
//   node tools/battery_resumable.mjs <targetSteps> <seed> <W> <chunkSteps> [name]
//   e.g. node tools/battery_resumable.mjs 21000 8817 1920 3000 resinv1920
//   SIM_TUNE passes through to the harness (e.g. SIM_TUNE="RES_INV_RIVER=1").
//
// Each invocation runs ONE chunk (target = min(done+chunk, target)) and exits;
// loop it (shell `while`, cron, or just re-run after a restart) until it prints
// BATTERY COMPLETE. The recorder's own series/checkpoint files accumulate under
// the same prefix, so the full diagnostic record survives too.
import fs from "fs";
import { spawnSync } from "node:child_process";

const [TARGET, SEED, W, CHUNK] = [2, 3, 4, 5].map((i) => parseInt(process.argv[i], 10));
const NAME = process.argv[6] || `bat_${SEED}_${W}${process.env.SIM_TUNE ? "_tuned" : ""}`;
if (!TARGET || !SEED || !W || !CHUNK) { console.error("usage: battery_resumable.mjs <steps> <seed> <W> <chunk> [name]"); process.exit(2); }
const DIR = new URL("../bench/", import.meta.url).pathname;
fs.mkdirSync(DIR, { recursive: true });
const PREFIX = DIR + NAME;
const ckpt = PREFIX + ".world.json";

let done = 0;
if (fs.existsSync(PREFIX + ".progress")) done = parseInt(fs.readFileSync(PREFIX + ".progress", "utf8"), 10) || 0;
if (done >= TARGET) { console.log("BATTERY COMPLETE at", done); process.exit(0); }
const next = Math.min(TARGET, done + CHUNK);
console.log(`[battery ${NAME}] ${done} -> ${next} of ${TARGET} (chunk ${CHUNK})${fs.existsSync(ckpt) ? " [resuming checkpoint]" : " [fresh]"}`);

const env = { ...process.env };
if (done > 0 && fs.existsSync(ckpt)) env.RESUME = ckpt;
const r = spawnSync(process.execPath, ["tools/earthFullRecord.mjs", String(next), String(SEED), String(W), PREFIX],
  { stdio: "inherit", env, cwd: new URL("..", import.meta.url).pathname });
if (r.status !== 0) { console.error("[battery] chunk failed with", r.status); process.exit(r.status || 1); }
fs.writeFileSync(PREFIX + ".progress", String(next));
console.log(next >= TARGET ? "BATTERY COMPLETE at " + next : `[battery ${NAME}] chunk done at ${next} — rerun to continue`);
