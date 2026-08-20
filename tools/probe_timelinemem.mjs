// The 26.6k allocation crash (owner report 2026-08-20, build d64a7ba): the
// worker died growing a 16KB heap — total-exhaustion, so the question is what
// RETAINS. The world graph is walked by probe_memgrowth; this measures the
// OTHER worker-retained structure headless probes never see: the scrubber
// timeline (timelineStore.js), fed at the worker's real cadence (a frame
// every CAPTURE_IVL steps). Reports retained frame bytes + frame counts at
// checkpoints, and the byte RATE per 1k steps so tw=960 can be projected.
//
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1" node tools/probe_timelinemem.mjs [W=480] [steps=30000] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { makeTimeline, captureFrame, CAPTURE_IVL } from "../src/sim/timelineStore.js";

const W = +(process.argv[2] || 480), STEPS = +(process.argv[3] || 30000), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
const tl = makeTimeline();

const CKPT = 3000;
let lastBytes = 0;
for (let done = 0; done < STEPS; ) {
  stepPeopleSim(world, CAPTURE_IVL);
  done += CAPTURE_IVL;
  captureFrame(tl, world);
  if (done % CKPT === 0) {
    const mu = process.memoryUsage();
    const nC = world.countries ? world.countries.size : 0;
    console.log(
      `step ${String(world.step).padStart(6)} | frames ${String(tl.frames.length).padStart(5)} | tlBytes ${(tl.bytes / 1e6).toFixed(1).padStart(7)}MB | +${((tl.bytes - lastBytes) / 1e6).toFixed(2)}MB/${CKPT} | realms ${nC} | rss ${(mu.rss / 1e6).toFixed(0)}MB`
    );
    lastBytes = tl.bytes;
  }
}
