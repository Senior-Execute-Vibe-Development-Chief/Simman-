// ── C1 v4 genesis-layer instrument: THE HEARTH FIELD (T.MULTI_HEARTH) ──
//
// docs/design-c-hearth-field.md validation arm 3 — the BLOCKING arm, and the
// one the design says it would fail itself on. Under MULTI_HEARTH the number of
// agricultural origins becomes load-bearing for planetary label supply, so it
// must be a GEOGRAPHIC count (an absolute real separation over an absolute
// score field), not grid texture. Measured on the shipped constant it was NOT:
// CRADLE_MIN_SEP = 60 was read in RAW TILES, giving 2 hearths at 240 and 6 at
// 480 with the scorer running — the number of times a planet invented farming
// would have tracked the render resolution. The lever reads it × rNormPop.
//
// This probe measures cradle seeding ONLY (t = 0, no stepping), so it is cheap
// and isolates the genesis layer from every downstream mechanism.
//
// Channels per world:
//   • hearth count, and how it splits pinned (EARTH_HEARTH_SITES) vs scored
//   • hearth positions in FRACTIONAL map coordinates (grid-independent), so
//     counts at different resolutions can be co-located
//   • the 8-neighbour LAND COMPONENT each hearth sits on, with that
//     component's land-tile share — the "does farming have an origin on more
//     than one landmass" channel, which is what devField's land-only wave
//     makes decisive
//   • position match against a reference grid at CRADLE_MIN_SEP/2 real tiles
//
// Bars (design arm 3): hearth count within ±20% at 480↔960, position match
// ≥80% at CRADLE_MIN_SEP/2. Falsification: if the count still tracks the grid
// after the unit fix, the genesis layer is grid-textured — reject the design.
//
//   node tools/probe_hearthsupply.mjs [seeds] [grids]
//   node tools/probe_hearthsupply.mjs 8817,4242 240,480,960
// Arms are selected by SIM_TUNE as usual; with no SIM_TUNE the probe runs the
// full matrix itself (shipped pins-only / lever ON / pins-removed diagnostic).
import { buildSim } from "./_harness.mjs";
import { T, rNormPop } from "../src/sim/peopleSim/tuning.js";

const SEEDS = (process.argv[2] || "8817,4242").split(",").map(Number);
const GRIDS = (process.argv[3] || "240,480,960").split(",").map(Number);
const CRADLE_MIN_SEP = 60;   // mirrors state.js — instrument only, never fed back

// 8-neighbour land components (roads.js landComp8's definition, re-derived here
// so the probe never mutates the world's caches).
function landComp8(world) {
  const { N, tw, th, elev } = world;
  const lc = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  for (let seed = 0; seed < N; seed++) {
    if (lc[seed] >= 0 || elev[seed] <= 0) continue;
    let top = 0;
    stack[top++] = seed; lc[seed] = seed;
    while (top > 0) {
      const ti = stack[--top];
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const yu = ty - 1, yd = ty + 1;
      const ns = [ty * tw + xm, ty * tw + xp,
        yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
        yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
        yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1];
      for (let k = 0; k < 8; k++) {
        const ni = ns[k];
        if (ni < 0 || elev[ni] <= 0 || lc[ni] >= 0) continue;
        lc[ni] = seed; stack[top++] = ni;
      }
    }
  }
  return lc;
}

function hearthsOf(world) {
  const lc = landComp8(world);
  const sizes = new Map();
  for (let ti = 0; ti < world.N; ti++) if (lc[ti] >= 0) sizes.set(lc[ti], (sizes.get(lc[ti]) || 0) + 1);
  let land = 0; for (const v of sizes.values()) land += v;
  // At t = 0 seedCradleVillage is the only thing that has founded anything, so
  // the settlement list IS the hearth list. (Cross-checked against the event
  // log's kind === "cradle" rows below.)
  const cradleEv = (world.events || []).filter((e) => e.kind === "cradle").length;
  if (cradleEv !== world.settlements.length) {
    console.warn(`[hearth] WARNING: ${world.settlements.length} settlements but ${cradleEv} cradle events at t=0`);
  }
  const out = [];
  for (const s of world.settlements) {
    const tx = s.pos.x | 0, ty = s.pos.y | 0, ti = ty * world.tw + tx;
    const comp = lc[ti];
    out.push({
      name: s.name, tx, ty,
      fx: (tx + 0.5) / world.tw, fy: (ty + 0.5) / world.th,
      comp, compTiles: sizes.get(comp) || 0,
      compShare: land > 0 ? (sizes.get(comp) || 0) / land : 0,
    });
  }
  return { hearths: out, land, comps: sizes.size };
}

// Fraction of `a`'s hearths that have a partner in `b` within CRADLE_MIN_SEP/2
// REFERENCE tiles, compared in fractional map coordinates so the two grids are
// commensurable.
function positionMatch(a, b, refTw) {
  if (!a.length) return 0;
  const tol = (CRADLE_MIN_SEP / 2) / refTw;   // in fractional-width units
  let hit = 0;
  for (const h of a) {
    for (const g of b) {
      let dx = Math.abs(h.fx - g.fx); if (dx > 0.5) dx = 1 - dx;
      const dy = (h.fy - g.fy) * 0.5;   // fy spans half the x range on an equirect grid
      if (Math.sqrt(dx * dx + dy * dy) <= tol) { hit++; break; }
    }
  }
  return hit / a.length;
}

const ARMS = process.env.SIM_TUNE
  ? [{ tag: "SIM_TUNE", set: {} }]
  : [
      { tag: "shipped (pins exclusive)", set: { MULTI_HEARTH: 0, EARTH_HEARTHS: 1 } },
      { tag: "MULTI_HEARTH=1 (pins + scorer)", set: { MULTI_HEARTH: 1, EARTH_HEARTHS: 1 } },
      { tag: "diagnostic: pins REMOVED, raw-tile sep", set: { MULTI_HEARTH: 0, EARTH_HEARTHS: 0 } },
      { tag: "diagnostic: pins REMOVED, real-distance sep", set: { MULTI_HEARTH: 1, EARTH_HEARTHS: 0 } },
    ];

const results = [];
for (const arm of ARMS) {
  for (const k in arm.set) T[k] = arm.set[k];
  for (const seed of SEEDS) {
    const byGrid = new Map();
    for (const W of GRIDS) {
      const world = buildSim({ W, H: W >> 1, seed });
      const m = hearthsOf(world);
      byGrid.set(W, { ...m, tw: world.tw, rn: rNormPop(world) });
      const compStr = m.hearths.map((h) => `c${h.comp}(${h.compTiles})`).join(" ");
      const uniq = new Set(m.hearths.map((h) => h.comp));
      console.log(
        `[hearth] ${arm.tag.padEnd(38)} seed=${seed} W=${String(W).padStart(4)} tw=${String(world.tw).padStart(4)} rn=${rNormPop(world).toFixed(2)}  ` +
        `hearths=${String(m.hearths.length).padStart(2)} on ${uniq.size} land component(s) of ${m.comps}  [${compStr}]`);
      for (const h of m.hearths) {
        console.log(`         ${h.name.padEnd(14)} tile(${String(h.tx).padStart(4)},${String(h.ty).padStart(3)}) frac(${h.fx.toFixed(3)},${h.fy.toFixed(3)}) comp ${String(h.comp).padStart(7)} ${String(h.compTiles).padStart(5)} tiles (${(100 * h.compShare).toFixed(1)}% of land)`);
      }
      results.push({ arm: arm.tag, seed, W, n: m.hearths.length, comps: new Set(m.hearths.map((h) => h.comp)).size });
    }
    // Cross-grid invariance for this arm/seed.
    for (let i = 1; i < GRIDS.length; i++) {
      const lo = byGrid.get(GRIDS[i - 1]), hi = byGrid.get(GRIDS[i]);
      if (!lo || !hi) continue;
      const dN = lo.hearths.length ? (hi.hearths.length / lo.hearths.length - 1) * 100 : NaN;
      const pm = positionMatch(hi.hearths, lo.hearths, 240);
      console.log(`[hearth] ${arm.tag.padEnd(38)} seed=${seed} ${GRIDS[i - 1]}↔${GRIDS[i]}: count ${lo.hearths.length}→${hi.hearths.length} (${dN >= 0 ? "+" : ""}${dN.toFixed(0)}%)  position match ${(100 * pm).toFixed(0)}%  [bar ±20% / ≥80%]`);
    }
  }
}

console.log("\n[hearth] SUMMARY (count by arm × seed × grid; comps = distinct land components carrying a hearth)");
for (const arm of new Set(results.map((r) => r.arm))) {
  for (const seed of SEEDS) {
    const rs = results.filter((r) => r.arm === arm && r.seed === seed);
    console.log(`  ${arm.padEnd(38)} seed=${seed}  ` + rs.map((r) => `${r.W}: ${r.n} (${r.comps} comp)`).join("   "));
  }
}
