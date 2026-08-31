// Catch any throw from invent-jump open through first cities + a post-mint window.
// App-identical live arm (DAWN_LIVE + genesis levers + invent jump).
//   SIM_TUNE=… node tools/probe_mint_crash.mjs [W=480] [seed=8817] [afterMint=1500]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const W = +(process.argv[2] || 480);
const SEED = +(process.argv[3] || 8817);
const AFTER = +(process.argv[4] || 1500);

const live =
  "DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,WAR_FINISH=1," +
  "INVENT_JUMP=1,MARKET_PULL=1,TILE_MONEY=1,LAND_SURPLUS=1";
if (!process.env.SIM_TUNE) process.env.SIM_TUNE = live;
// Re-apply after harness already ran applyToolTuning at import — force live arm.
const { applyTuning } = await import("../src/sim/peopleSim/tuning.js");
const ov = {};
for (const kv of process.env.SIM_TUNE.split(",")) {
  const [k, v] = kv.split("=");
  if (k && v !== undefined) ov[k.trim()] = +v;
}
applyTuning(ov);

console.log(
  `mint-crash probe W=${W} seed=${SEED} after=${AFTER}` +
  ` invent=${T.INVENT_JUMP} landKnow=${T.LAND_KNOW} mkt=${T.MARKET_PULL} tileMoney=${T.TILE_MONEY}`,
);

const t0 = performance.now();
let world;
try {
  world = buildSim({
    W, H: W >> 1, seed: SEED,
    simOpts: {
      onGenesisProgress: (info) => {
        if (info.phase === "mint-ready" && info.step % 5000 < 30) {
          console.log(`  gather… step ${info.step}`);
        }
      },
    },
  });
} catch (err) {
  console.error("INIT THREW:", err && err.stack || err);
  process.exit(2);
}

const nSet = () => {
  let n = 0;
  for (const s of world.settlements) if (s.mode === "settled") n++;
  return n;
};

console.log(
  `open kind=${world._openKind} step=${world.step} cities=${nSet()} ` +
  `${(performance.now() - t0).toFixed(0)}ms`,
);

let cities = nSet();
let mintedAt = cities > 0 ? world.step : null;
let lastLog = world.step;
const hardCap = world.step + 100_000;

try {
  while (world.step < hardCap) {
    stepPeopleSim(world, 1);
    const n = nSet();
    if (n !== cities) {
      console.log(`cities ${cities}→${n} at step ${world.step} realms=${world.countries?.size || 0}`);
      if (cities === 0 && n > 0) mintedAt = world.step;
      cities = n;
    }
    if (mintedAt != null && world.step - mintedAt >= AFTER) {
      console.log(`OK through +${AFTER} post-mint; cities=${cities} step=${world.step} realms=${world.countries?.size || 0}`);
      process.exit(0);
    }
    if (world.step - lastLog >= 2500) {
      lastLog = world.step;
      console.log(`  … step ${world.step} cities=${cities} realms=${world.countries?.size || 0}`);
    }
  }
  console.error(`hit cap; cities=${cities} mintedAt=${mintedAt}`);
  process.exit(3);
} catch (err) {
  console.error("\n=== STEP THREW ===");
  console.error(`step=${world.step} cities=${cities} realms=${world.countries?.size || 0}`);
  console.error(err && err.stack || err);
  process.exit(1);
}
