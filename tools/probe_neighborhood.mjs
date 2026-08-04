// THE MICROSCOPE — the minutiae of one small neighbourhood of nations, over deep time.
// The macro probes (shape/empires/diag) aggregate the planet; this one picks the
// busiest small WINDOW of the political map early on and then chronicles every realm
// that touches it at fine cadence: tiles held (in and out of the window), members,
// org, capacity vs load, vassalage, capital, and every event that strikes any of
// them (war storms, secessions, annexations, submissions, restorations) — so the
// micro-dynamics are visible: do statelets flicker? do borders oscillate? does a
// vassal get eaten? does a fallen nation come back? Who eats whom, at what pace?
//   node tools/probe_neighborhood.mjs [steps] [W] [seed] [sampleEvery]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 50000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = +(process.argv[5] || 250);
const PICK_AT = 4000;              // pick the window once the dawn has produced a map
const BOX = Math.round(15 * (W / 480));   // window side in sim tiles (~15 ref-tiles ≈ 2,000 km)

const world = buildSim({ W, H, seed: SEED });
const { tw, th, elev } = world;
let landN = 0; for (let i = 0; i < world.N; i++) if (elev[i] > 0) landN++;
const km2 = (510e6 * 0.29) / landN;

while (world.step < PICK_AT) stepPeopleSim(world, 1);

// Pick the BOX×BOX window holding the most DISTINCT realms (ties → most claimed
// tiles), scanning on a coarse lattice for speed. That is "the busiest corner of
// the early political map" — the place where small-state dynamics live.
let best = { x: 0, y: 0, n: -1, cl: 0 };
{
  const co = world._countryOwner;
  for (let y0 = 0; y0 + BOX <= th; y0 += BOX >> 2) {
    for (let x0 = 0; x0 + BOX <= tw; x0 += BOX >> 2) {
      const ids = new Set(); let cl = 0;
      for (let dy = 0; dy < BOX; dy++) for (let dx = 0; dx < BOX; dx++) {
        const ti = (y0 + dy) * tw + (x0 + dx);
        const c = co[ti];
        if (c >= 0 && elev[ti] > 0) { ids.add(c); cl++; }
      }
      if (ids.size > best.n || (ids.size === best.n && cl > best.cl)) best = { x: x0, y: y0, n: ids.size, cl };
    }
  }
}
console.log(`[neighbourhood] ${W}x${H} seed ${SEED} — window ${BOX}x${BOX} sim-tiles at (${best.x},${best.y}), ${best.n} realms at step ${PICK_AT}`);

const tracked = new Set();          // every realm id EVER seen in the window (once tracked, followed to the grave)
let evCursor = world.events ? world.events.length : 0;
const seen = new Map();             // id → last-sample summary line (print only on CHANGE to keep the log readable)

function sample() {
  const co = world._countryOwner;
  const inBox = new Map();          // id → tiles in window
  let wild = 0, land = 0;
  for (let dy = 0; dy < BOX; dy++) for (let dx = 0; dx < BOX; dx++) {
    const ti = (best.y + dy) * tw + (best.x + dx);
    if (!(elev[ti] > 0)) continue;
    land++;
    const c = co[ti];
    if (c < 0) { wild++; continue; }
    inBox.set(c, (inBox.get(c) || 0) + 1);
  }
  for (const id of inBox.keys()) tracked.add(id);
  const total = new Map();
  for (let ti = 0; ti < world.N; ti++) { const c = co[ti]; if (c >= 0 && tracked.has(c) && elev[ti] > 0) total.set(c, (total.get(c) || 0) + 1); }
  const ov = world._overlordOf;
  const rows = [];
  for (const id of [...tracked].sort((a, b) => a - b)) {
    const cc = world.countries && world.countries.get(id);
    const p = world.polities && world.polities.get(id);
    const t = total.get(id) || 0;
    if (!cc && !t) {                 // dead and landless — report the death once
      if (seen.get(id) !== "DEAD") { rows.push(`  #${id} "${(p && p.name) || "?"}" DEAD (ended ${p && p.endedStep >= 0 ? "@" + p.endedStep : "?"})`); seen.set(id, "DEAD"); }
      continue;
    }
    const cap = cc && cc.capital;
    const org = (cap && cap.knowledge && cap.knowledge.organization) || 0;
    const over = ov && ov.get(id);
    const line = `  #${id} "${(p && p.name) || "?"}" box=${inBox.get(id) || 0} tot=${t} (${Math.round(t * km2 / 1000)}k) mem=${(cc && cc.members.length) || 0} org=${org.toFixed(2)} cap/load=${cc ? `${(cc._capacity || 0).toFixed(1)}/${(cc._loadTotal || 0).toFixed(1)}` : "-"}${over != null ? ` VASSAL-of#${over}` : ""}${cc && cc._nomadic ? " NOMAD" : ""}`;
    const key = line.replace(/box=\d+/, "").replace(/cap\/load=[\d./-]+/, "");   // ignore fast-wobbling fields for change detection
    if (seen.get(id) !== key) { rows.push(line); seen.set(id, key); }
  }
  // Events since last sample touching any tracked realm.
  const evs = [];
  if (world.events) {
    for (; evCursor < world.events.length; evCursor++) {
      const ev = world.events[evCursor];
      const ids = [ev.polity, ev.from, ev.to].filter((x) => x != null && x >= 0);
      if (!ids.some((x) => tracked.has(x))) continue;
      if (!/^(polity|settlement)\./.test(ev.type || "")) continue;
      evs.push(`  ! ${ev.step}: ${ev.type} ${ev.name || ev.sName || ""}${ev.from >= 0 ? ` from#${ev.from}` : ""}${ev.to >= 0 ? ` to#${ev.to}` : ""}${ev.how ? ` (${ev.how})` : ""}`);
    }
  }
  if (rows.length || evs.length) {
    console.log(`\n-- step ${world.step}  window: ${((land - wild) / Math.max(1, land) * 100).toFixed(0)}% claimed, ${inBox.size} realms present, ${tracked.size} ever tracked`);
    for (const e of evs) console.log(e);
    for (const r of rows) console.log(r);
  }
}

sample();
const t0 = Date.now();
while (world.step < STEPS) {
  const next = Math.min(STEPS, world.step + EVERY);
  while (world.step < next) stepPeopleSim(world, 1);
  sample();
  if (world.step % 5000 === 0) console.log(`  [${((Date.now() - t0) / 60000).toFixed(0)}m at step ${world.step}]`);
}
console.log(`\n[neighbourhood] done: ${tracked.size} realms chronicled through ${STEPS} steps`);
