// ── popField band kernels (docs/popfield-parallel.md §4, Stage B) ────────────
// The four parallel-safe phases of stepPopField as PURE band functions over
// [lo, hi) ranges of the ascending land list: capacity, logistic growth, the
// index-ordered gather migration (6a records / 6b apply — the Stage-A form),
// and land-works build/rot. Each function writes ONLY tiles it owns (slot i /
// nxt[j] / wk[i]), reads everything else from buffers frozen for the phase —
// so a band split at ANY boundary performs the identical IEEE op sequence per
// tile, and worker count can never change a bit (the probe_popfield_par gate).
//
// This module is the SINGLE SOURCE for the physical constants these loops use
// (popField.js imports them back), and it imports NOTHING — a worker thread
// (popFieldWorker.js) loads it standalone without dragging the sim in.
//
// Every loop body is a transcription of the serial loop in popField.js
// (lever 0 keeps those originals). The pairing is guarded by the cross-lever
// identity probe — any drift between the two is a hard gate failure, not a
// quiet skew. Owner-dependent reads (s._indCap / s._indGate) arrive as dense
// per-sid tables packed by the coordinator each firing; a sid absent from the
// tables reads 0, which reproduces the serial "settlement missing → skip"
// branch exactly (0 > 1 is false; tfL·0 never writes the fade array).

// Carrying-capacity terms (shared with popField.js — see its comment blocks
// for the physical meaning of each; values are load-bearing, never touch
// without the hashbase gate).
export const RM_FULL = 4;
export const ACCESS_RIVER = 1.0;
export const ACCESS_COAST = 0.35;
export const ACCESS_DEV0 = 1.0, ACCESS_DEVK = 1.0;
export const RELIEF_PEN = 3.0;
export const DEV_BASE = 0.30, DEV_TECH = 3.0;
// Local demographic regimes (GROWTH_LOCAL).
export const R_DEV0 = 0.35;
export const R_DEVK = 1.30;
export const R_TROPIC = 0.35;
// Technology-substitutes-for-terrain fades (TERRAIN_FADE).
export const FADE_FERT = 0.5;
export const FADE_RELIEF = 0.6;
export const FADE_PUMP = 0.5;
export const FADE_MED = 3.0;
export const FADE_ACCESS = 0.5;
// Land improvement (LAND_WORKS).
export const WORKS_PRESS = 0.5;
export const WORKS_STAFF = 0.25;
export const WORKS_RATE = 0.0012;
export const WORKS_DECAY = 0.0009;

// Migration scan order — E, W, S, N. sumSpare accumulates in THIS order (float
// sums are order-sensitive); popField.js's serial scatter shares the constant.
export const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Capacity: cap[i] = f(terrain, technique, access, relief, owner industry,
 *  works). o = {land, elev:unused, fert, riverMag, coast, relief, cap, devF,
 *  pasture, worksF, tfArr, owner, capT, gateT, hasRiver, hasCoast, hasRelief,
 *  ownerOn, indOn, tfL, worksOn, worksK, devOn, capPerFert, accessDev, dev}. */
export function capBand(o, lo, hi) {
  const { land, fert, riverMag, coast, relief, cap, devF, pasture, worksF, tfArr,
          owner, capT, gateT, hasRiver, hasCoast, hasRelief, ownerOn, indOn, tfL,
          worksOn, worksK, devOn, capPerFert, accessDev, dev } = o;
  for (let li = lo; li < hi; li++) {
    const i = land[li];
    const water = hasRiver ? Math.min(1, riverMag[i] / RM_FULL) : 0;
    let access = ACCESS_RIVER * water + ACCESS_COAST * (hasCoast ? coast[i] : 0);
    let indMul = 1, fade = 0;
    if (ownerOn) {
      const sid = owner[i];
      if (sid >= 0) {
        const cv = capT[sid];
        if (indOn && cv > 1) indMul = cv;
        if (tfL > 0) { fade = tfL * gateT[sid]; if (fade > 0) tfArr[i] = fade; }
      }
    }
    const reliefMul = hasRelief ? 1 / (1 + RELIEF_PEN * relief[i] * (1 - FADE_RELIEF * fade)) : 1;
    if (fade > 0) access /= 1 + FADE_ACCESS * fade;
    const f0 = fert[i], fEff = fade > 0 ? f0 + FADE_FERT * fade * (1 - f0) : f0;
    const wkMul = worksOn ? 1 + worksK * worksF[i] : 1;
    if (devOn) {
      const a = devF[i];
      const reach = 1 + access * (ACCESS_DEV0 + ACCESS_DEVK * a);
      const crop = fEff * capPerFert * (DEV_BASE + DEV_TECH * a) * reach * reliefMul * indMul * wkMul;
      const range = pasture[i];
      cap[i] = crop > range ? crop : range;
    } else {
      const reach = 1 + access * accessDev;
      cap[i] = fEff * capPerFert * dev * reach * reliefMul * indMul * wkMul;
    }
  }
}

/** Logistic growth toward capacity, in place (bulk rate; city cores are
 *  re-integrated serially by the coordinator afterwards, same as lever 0).
 *  o = {land, pop, cap, devF, tropicB, tfArr, glOn, tfOn, gl, rBulk, dt}. */
export function growthBand(o, lo, hi) {
  const { land, pop, cap, devF, tropicB, tfArr, glOn, tfOn, gl, rBulk, dt } = o;
  for (let li = lo; li < hi; li++) {
    const i = land[li];
    const k = cap[i];
    if (k <= 0) { pop[i] = 0; continue; }
    const p = pop[i];
    if (p > 0) {
      let rT = rBulk;
      if (glOn) {
        const burden = R_TROPIC * tropicB[i] / (tfOn && tfArr[i] > 0 ? 1 + FADE_MED * tfArr[i] : 1);
        const reg = (R_DEV0 + R_DEVK * devF[i]) / (1 + burden);
        rT = rBulk * (1 + gl * (reg - 1));
      }
      pop[i] = p + rT * dt * p * (1 - p / k);
    }
  }
}

/** Migration buffer prep: copy this band's RAW tile slice pop→nxt (the banded
 *  form of the serial `nxt.set(pop)` — slices partition [0, N) exactly). */
export function migCopyBand(nxt, pop, rawLo, rawHi) {
  nxt.set(pop.subarray(rawLo, rawHi), rawLo);
}

/** Migration 6a — per-source outflow records. Writes mv[i]/ssum[i] only.
 *  o = {land, pop, cap, mv, ssum, tw, th, migShare}. sumSpare accumulates in
 *  DIRS4 order; off-map rows contribute nothing (skip, not +0 — bit-equal
 *  either way for these non-negative sums, the skip mirrors the serial text). */
export function mig6aBand(o, lo, hi) {
  const { land, pop, cap, mv, ssum, tw, th, migShare } = o;
  for (let li = lo; li < hi; li++) {
    const i = land[li];
    const p = pop[i];
    if (p <= 0) { mv[i] = 0; continue; }
    const y = (i / tw) | 0, x = i - y * tw;
    let sumSpare = 0;
    for (let d = 0; d < 4; d++) {
      const ny = y + DIRS4[d][1];
      if (ny < 0 || ny >= th) continue;
      const nx = (x + DIRS4[d][0] + tw) % tw;
      const ni = ny * tw + nx;
      const s = cap[ni] - pop[ni];
      sumSpare += s > 0 ? s : 0;
    }
    if (sumSpare <= 0) { mv[i] = 0; continue; }
    mv[i] = migShare * p;
    ssum[i] = sumSpare;
  }
}

/** Migration 6b — ordered gather. Applies target j's ≤5 incident ops in
 *  ascending SOURCE-INDEX order (the serial scatter's visit order), each as
 *  its own f32 read-modify-write on nxt[j]. Wrap columns permute the order
 *  (x=0: W is the row END, after self/E; x=tw−1: E is the row START, before
 *  W/self) — hence the three column categories. Writes nxt[j] only.
 *  o = {land, pop, nxt, cap, mv, ssum, tw, th}. */
export function mig6bBand(o, lo, hi) {
  const { land, pop, nxt, cap, mv, ssum, tw, th } = o;
  for (let li = lo; li < hi; li++) {
    const j = land[li];
    const y = (j / tw) | 0, x = j - y * tw;
    const sj = cap[j] - pop[j];
    const recv = sj > 0;
    if (y > 0) { const n = j - tw, m = mv[n]; if (m > 0 && recv) nxt[j] += m * (sj / ssum[n]); }
    if (x > 0 && x < tw - 1) {           // interior column: W < self < E
      const w = j - 1, e = j + 1;
      { const m = mv[w]; if (m > 0 && recv) nxt[j] += m * (sj / ssum[w]); }
      { const m = mv[j]; if (m > 0) nxt[j] -= m; }
      { const m = mv[e]; if (m > 0 && recv) nxt[j] += m * (sj / ssum[e]); }
    } else if (x === 0) {                // seam west wraps to row end: self < E < W
      const e = j + 1, w = j + tw - 1;
      { const m = mv[j]; if (m > 0) nxt[j] -= m; }
      { const m = mv[e]; if (m > 0 && recv) nxt[j] += m * (sj / ssum[e]); }
      { const m = mv[w]; if (m > 0 && recv) nxt[j] += m * (sj / ssum[w]); }
    } else {                             // x === tw−1, east wraps to row start: E < W < self
      const e = j - tw + 1, w = j - 1;
      { const m = mv[e]; if (m > 0 && recv) nxt[j] += m * (sj / ssum[e]); }
      { const m = mv[w]; if (m > 0 && recv) nxt[j] += m * (sj / ssum[w]); }
      { const m = mv[j]; if (m > 0) nxt[j] -= m; }
    }
    if (y < th - 1) { const s2 = j + tw, m = mv[s2]; if (m > 0 && recv) nxt[j] += m * (sj / ssum[s2]); }
  }
}

/** Land works build/rot on this firing's FINAL pop/cap. Writes wk[i] only.
 *  o = {land, pop, cap, wk, irr, tfW, tfWOn, devF, devOn, leadAgri, rate, dk}. */
export function worksBand(o, lo, hi) {
  const { land, pop, cap, wk, irr, tfW, tfWOn, devF, devOn, leadAgri, rate, dk } = o;
  for (let li = lo; li < hi; li++) {
    const i = land[li];
    let a = irr[i];
    if (tfWOn && tfW[i] > 0) { a += FADE_PUMP * tfW[i]; if (a > 1) a = 1; }
    let w = wk[i];
    if (a <= 0 && w <= 0) continue;
    const k = cap[i];
    const press = k > 0 ? pop[i] / k : 0;
    if (a > 0 && press > WORKS_PRESS) {
      const skill = devOn ? devF[i] : leadAgri;
      if (skill > 0.05) w += rate * (press - WORKS_PRESS) * skill * a;
    }
    const staffed = press > WORKS_STAFF ? 1 : press / WORKS_STAFF;
    if (staffed < 1) w -= dk * (1 - staffed) * w;
    wk[i] = w < 0 ? 0 : w > 1 ? 1 : w;
  }
}

// Phase opcodes shared by the pool coordinator and popFieldWorker.js.
export const OP_CAP = 1, OP_GROWTH = 2, OP_MIG_A = 3, OP_MIG_B = 4, OP_WORKS = 5, OP_EXIT = 99;
// ctrl (Int32Array) slots.
// ctrl (Int32Array) slots. The barrier uses PER-WORKER EPOCH STAMPS, not a
// shared counter: worker k stamps ctrl[C_SLOT0+k] = seq after running phase
// seq. Duplicate wakes re-stamp the same value (idempotent — a counter would
// overshoot), stale threads stamp old epochs (ignored), and a worker that
// observes a seq jump it cannot replay stamps POISON so the coordinator
// fails LOUDLY instead of computing with a silently-skipped band.
export const C_SEQ = 0, C_OP = 1, C_PARITY = 2, C_READY = 3, C_HINT = 4, C_SLOT0 = 5;
// C_HINT is a WAKE HINT only — workers bump+notify it so the coordinator has
// an address to park on; the epoch slots stay the sole source of truth, so
// hint anomalies (overshoot, stale bumps) can never affect correctness.
export const POISON = -0x7fffffff;
// hdr (Float64Array) slots — the per-phase scalar bus (flags ride as 0/1).
export const H_CAPPERFERT = 0, H_ACCESSDEV = 1, H_DEV = 2, H_TFL = 3, H_INDON = 4,
             H_WORKSON = 5, H_WORKSK = 6, H_DEVON = 7, H_OWNERON = 8,
             H_RBULK = 9, H_GL = 10, H_GLON = 11, H_DT = 12, H_TFON = 13,
             H_MIGSHARE = 14, H_RATE = 15, H_DK = 16, H_LEADAGRI = 17, H_TFWON = 18,
             H_HASRIVER = 19, H_HASCOAST = 20, H_HASRELIEF = 21;
export const HDR_LEN = 24;
