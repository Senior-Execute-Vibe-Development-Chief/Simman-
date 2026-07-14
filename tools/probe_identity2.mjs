// Identity Stage 2 (T.TILE_IDENTITY) functional probe: the sticky per-tile
// culture layer. Run with the lever ON and check the mechanics end-to-end:
//   1. the field initialises (owned tiles seeded from the city mirror) and the
//      countryside aggregates stamp (s._rurCulMix / _rurCulPeople);
//   2. GHOST identity: tiles that LOSE their owner keep their mix (the land
//      remembers departed peoples — the sticky property conquest relies on);
//   3. save/load: the top-2 quantised payload roundtrips (dominant slots
//      byte-equal after load, _tileIdentInit set) and the world resumes.
//   SIM_TUNE="TILE_IDENTITY=1" node tools/probe_identity2.mjs [steps] [W] [seed]
// Lever OFF this probe still runs but reports the mirror-off state (all zeros)
// — the byte-identity guard for that mode is probe_hashbase, not this.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { serializeWorld, loadWorld } from "../src/sim/persist.js";
import { IDENTITY_K, tileCulShareOf } from "../src/sim/peopleSim/identityField.js";

const STEPS = +(process.argv[2] || 6000);
const W = +(process.argv[3] || 320), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H, seed: SEED });
stepPeopleSim(world, STEPS);

const N = world.N, K = IDENTITY_K;
const idA = world.tileCulId, owner = world._territoryOwner;
let filled = 0, ghost = 0, owned = 0;
if (idA && owner) for (let ti = 0; ti < N; ti++) {
  const has = idA[ti * K] >= 0;
  if (has) filled++;
  if (owner[ti] >= 0) owned++;
  else if (has) ghost++;   // identity on unowned ground = the land remembering
}
let stamped = 0, setts = 0, sampleShare = 0;
for (const s of world.settlements) {
  if (s.mode !== "settled") continue;
  setts++;
  if (s._rurCulMix && s._rurCulMix.length) {
    stamped++;
    if (!sampleShare) {
      const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
      sampleShare = tileCulShareOf(world, ti, s._rurCulMix[0][0]);
    }
  }
}
console.log(JSON.stringify({ steps: STEPS, W, seed: SEED, init: !!world._tileIdentInit,
  tiles: { owned, filled, ghost }, provinces: { settled: setts, rurStamped: stamped }, sampleShare: +sampleShare.toFixed(3) }));

// ── save/load roundtrip ──
const json = serializeWorld(world);
const loaded = loadWorld(json);
let domMismatch = 0;
if (world._tileIdentInit) {
  const a = world.tileCulId, as = world.tileCulShr, b = loaded.tileCulId, bs = loaded.tileCulShr;
  for (let ti = 0; ti < N; ti++) {
    const x = ti * K;
    if (a[x] !== b[x] || as[x] !== bs[x] || a[x + 1] !== b[x + 1] || as[x + 1] !== bs[x + 1]) domMismatch++;
  }
}
stepPeopleSim(loaded, 500);
let loadedStamped = 0;
for (const s of loaded.settlements) if (s.mode === "settled" && s._rurCulMix) loadedStamped++;
console.log(JSON.stringify({ roundtrip: { loadedInit: !!loaded._tileIdentInit, top2Mismatch: domMismatch,
  resumed: loaded.step, rurStampedAfterResume: loadedStamped, saveKB: Math.round(json.length / 1024) } }));
