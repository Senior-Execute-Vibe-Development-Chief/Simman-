// ── Political control as a FIELD (T.CONTROL_FIELD) — prototype ────────────────
//
// A radically different political map. Instead of the periodic global recompute
// (countryTerritory.js: throw away _countryOwner every ~144 ticks, rebuild it with a
// cost-Voronoi flood, then correct it with shed / connectivity / gap-fill / smooth),
// political CONTROL is a per-tile field that RELAXES one hop every tick — exactly the
// shape of the population field (popField.js), just carrying "who holds this ground and
// how strongly" instead of "how many people".
//
//   world._ctrlOwner[t]  — the nation whose control dominates tile t (-1 = wilderness).
//   world._ctrlHold[t]   — the strength of that hold, 0..~1.
//
// Every tick:
//   1. each nation PINS its capital tile at a strength P set by its power;
//   2. control PROPAGATES one hop — a tile takes the strongest control reaching it from a
//      neighbour, times a transmission factor that DECAYS with distance and is RESISTED by
//      terrain (mountains/big rivers transmit poorly; sea blocks entirely), so the field is
//      a power-weighted, terrain-following influence map;
//   3. standing control DECAYS a little, so a nation whose capital dies/weakens loses its
//      far marches as the field stops being reinforced (rise and fall, for free).
//
// The border is just argmax control. It MOVES CONTINUOUSLY as powers shift — no recompute
// tick, no bursts — and the whole correction stack disappears: disconnected land can't be
// reached by control (it fades to wilderness); a stronger neighbour's control simply pushes
// the balance-line past the midpoint (power-weighted borders); ridges and rivers are where
// two fields meet because control barely crosses them. Cheap: an O(N) 4-neighbour stencil,
// double-buffered for determinism, stride-able like popField.
//
// PROTOTYPE: runs ALONGSIDE the existing _countryOwner (does not replace it), reading the
// SAME nations/capitals/powers, so render_controlfield.mjs can show an honest A/B — old
// bubbly recompute vs new continuously-relaxing borders — on identical inputs. Lever off ⇒
// never runs (byte-identical). Water is a hard wall in v1 (no naval projection yet).

import { T } from "./tuning.js";
import { settlementPower } from "./conquest.js";

const _envNum = (k, d) => (typeof process !== "undefined" && process.env && +process.env[k]) || d;

// Reach is set by how much control survives crossing one plains tile (keep): reach in
// tiles ≈ ln(CLAIM_THRESH / P) / ln(keep). keep rises with LOGISTICS so a developed
// nation projects authority far (roads→rail→telegraph), a neolithic chiefdom barely past
// its walls — the era scaling, emergent from tech, never a clock.
const KEEP_BASE  = _envNum("SIM_CTRL_KEEP",  0.855);  // plains transmission at logistics 0
const KEEP_LOGI  = _envNum("SIM_CTRL_LOGI",  0.11);   // + this × logistics (→ ~0.965 fully modern: continental reach)
// Capital strength P. Power-weighted: a stronger realm pins a higher source, so its
// balance-line with a weaker neighbour falls PAST the midpoint (a hegemon's sphere, a
// weakling's enclave) — the size hierarchy, from power, with no dominance exponent.
const P_BASE     = _envNum("SIM_CTRL_P",      1.0);
const P_FLOOR    = 0.35;   // even the weakest realm pins at least this share of P_BASE (holds a core)
const CLAIM_THRESH = _envNum("SIM_CTRL_THRESH", 0.02);   // control below this = wilderness (the reach edge)
const SELF_DECAY = _envNum("SIM_CTRL_DECAY", 0.90);      // per-tick decay of standing control (lost sources fade over ~1/(1-x) ticks)
// Terrain resistance ENTERING a tile (multiplies keep): ranges and great rivers transmit
// poorly, so the field stalls on them and borders settle along the real geography.
const MTN_RESIST = _envNum("SIM_CTRL_MTN", 3.0);   // ×1/(1+this·max(0,elev-0.45)) on highland
const RIV_RESIST = _envNum("SIM_CTRL_RIV", 0.45);  // × (1-this) crossing a navigable river channel

function buildSources(world) {
  // nation → { ti: capital tile, P, keep }. Power + logistics from the political capital
  // (the same seat the rest of the sim uses); anchored to the median so P is a relative
  // size, not a fitted absolute (self-calibrating, like _refCapPower).
  const out = new Map();
  if (!world.countries) return out;
  const tw = world.tw, elev = world.elev;
  const pows = [];
  const raw = [];
  for (const [cid, c] of world.countries) {
    const cap = c.capital;
    if (!cap || cap.mode !== "settled") continue;
    const ti = (cap.pos.y | 0) * tw + (((cap.pos.x | 0) % tw) + tw) % tw;
    if (elev[ti] <= 0) continue;
    const pow = Math.max(1e-6, (c._capacity || 0) > 0 ? c._capacity : settlementPower(cap));
    const logi = (cap._techEff ? cap._techEff.logisticsLevel : 0) || ((cap.knowledge && cap.knowledge.construction) || 0) ** 2;
    raw.push({ cid, ti, pow, logi }); pows.push(pow);
  }
  if (!raw.length) return out;
  pows.sort((a, b) => a - b);
  const med = Math.max(1e-6, pows[pows.length >> 1]);
  for (const r of raw) {
    // P: relative power, compressed so the strong dominate their marches without erasing
    // the weak (P_FLOOR..~2·P_BASE), scaled to P_BASE at the median.
    const rel = r.pow / med;
    const P = P_BASE * Math.max(P_FLOOR, Math.min(2.2, 0.55 + 0.45 * Math.sqrt(rel)));
    const keep = Math.min(0.985, KEEP_BASE + KEEP_LOGI * Math.max(0, Math.min(1, r.logi)));
    out.set(r.cid, { ti: r.ti, P, keep });
  }
  return out;
}

export function stepControlField(world, sub = 1) {
  const N = world.N, tw = world.tw, th = world.th;
  const { elev, riverMag } = world;
  let owner = world._ctrlOwner, hold = world._ctrlHold;
  if (!owner || owner.length !== N) {
    owner = world._ctrlOwner = new Int32Array(N).fill(-1);
    hold = world._ctrlHold = new Float32Array(N);
    world._ctrlOwnerNext = new Int32Array(N);
    world._ctrlHoldNext = new Float32Array(N);
    world._ctrlKeepOf = new Float32Array(N);
  }
  const sources = buildSources(world);
  const alive = new Set(sources.keys());

  // Per-tile transmission of the tile's OWNER (its nation's keep × the terrain resistance
  // ENTERING this tile). Precomputed once per tick so the hot neighbour loop is a read.
  const keepOf = world._ctrlKeepOf;
  const keepByCid = new Map(); for (const [cid, s] of sources) keepByCid.set(cid, s.keep);
  for (let t = 0; t < N; t++) {
    if (elev[t] <= 0) { keepOf[t] = 0; continue; }
    let terr = 1;
    if (elev[t] > 0.45) terr /= (1 + MTN_RESIST * (elev[t] - 0.45));
    if (riverMag && riverMag[t] >= 3) terr *= (1 - RIV_RESIST);
    const o = owner[t];
    const kb = o >= 0 ? (keepByCid.get(o) || KEEP_BASE) : KEEP_BASE;
    keepOf[t] = kb * terr;
  }

  const no = world._ctrlOwnerNext, nh = world._ctrlHoldNext;
  // Start from decayed standing control (owner dead ⇒ drop to wilderness at once).
  for (let t = 0; t < N; t++) {
    if (elev[t] <= 0) { no[t] = -1; nh[t] = 0; continue; }
    const o = owner[t];
    if (o >= 0 && alive.has(o)) { no[t] = o; nh[t] = hold[t] * SELF_DECAY; }
    else { no[t] = -1; nh[t] = 0; }
  }
  // Propagate one hop: a tile takes the strongest control reaching it from a 4-neighbour,
  // times that neighbour's transmission (keepOf at the SOURCE side of the edge). Reads OLD
  // hold[] so the sweep is synchronous/deterministic.
  for (let t = 0; t < N; t++) {
    if (elev[t] <= 0) continue;
    const ty = (t / tw) | 0, tx = t - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? t - tw : -1, ty < th - 1 ? t + tw : -1];
    let bh = nh[t], bo = no[t];
    for (let k = 0; k < 4; k++) {
      const nn = ns[k]; if (nn < 0 || elev[nn] <= 0) continue;
      const o = owner[nn]; if (o < 0 || !alive.has(o)) continue;
      const inc = hold[nn] * keepOf[nn];   // control leaving nn toward t (nn's nation reach × terrain at nn)
      if (inc > bh) { bh = inc; bo = o; }
    }
    nh[t] = bh; no[t] = bo;
  }
  // Pin sources: each capital tile is held at full P by its nation (overrides).
  for (const [cid, s] of sources) { if (s.P > nh[s.ti]) { nh[s.ti] = s.P; } no[s.ti] = cid; }
  // Threshold: control too weak to matter is open wilderness.
  for (let t = 0; t < N; t++) { if (nh[t] < CLAIM_THRESH) { no[t] = -1; nh[t] = 0; } }

  world._ctrlOwner = no; world._ctrlHold = nh;
  world._ctrlOwnerNext = owner; world._ctrlHoldNext = hold;
}
