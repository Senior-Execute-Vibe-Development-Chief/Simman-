// Band worker for the popField pass (docs/popfield-parallel.md §4, Stage B).
// Spawned by popFieldPool.js with a fixed band of the land list and the full
// SAB set; loops on an Atomics barrier: wait for a phase signal, run its band
// through the shared kernel, count itself done. It imports ONLY the kernel —
// no sim modules — and never touches tiles outside its band, so its existence
// cannot change a bit of the trajectory (the probe_popfield_par gate).
import { parentPort, workerData } from "node:worker_threads";
import * as K from "./popFieldKernel.js";

const d = workerData;
const g = d.geom;   // {N, tw, th, nLand}
const F32 = (b) => (b ? new Float32Array(b) : null);
const b = d.bufs;
const V = {
  land: new Int32Array(b.land),
  owner: b.owner ? new Int32Array(b.owner) : null,
  popA: F32(b.popA), popB: F32(b.popB), cap: F32(b.cap),
  // riverMag/coast are Uint8Array in the sim (riverGen/state.js) — the views
  // MUST match or every worker read is garbage.
  fert: F32(b.fert), riverMag: b.riverMag ? new Uint8Array(b.riverMag) : null,
  coast: b.coast ? new Uint8Array(b.coast) : null, relief: F32(b.relief),
  devF: F32(b.devF), pasture: F32(b.pasture), worksF: F32(b.worksF), tfArr: F32(b.tfArr),
  tropicB: F32(b.tropicB), irr: F32(b.irr),
  mv: new Float64Array(b.mv), ssum: new Float64Array(b.ssum),
  capT: new Float64Array(b.capT), gateT: new Float64Array(b.gateT),
};
const ctrl = new Int32Array(b.ctrl);
const hdr = new Float64Array(b.hdr);
const { lo, hi, rawLo, rawHi } = d.band;

// Strict lockstep, epoch-stamped. Snapshot the phase sequence BEFORE
// announcing readiness: a signal landing between the announce and our first
// wait must hit the not-equal fast path, never be missed. Every phase seq is
// run EXACTLY once: a duplicate wake re-stamps idempotently and re-loops; a
// seq we cannot replay (jumped past us — should be impossible under the
// signal/await lockstep) stamps POISON so the coordinator throws rather than
// continue with a silently-skipped band.
const mySlot = K.C_SLOT0 + (d.idx - 1);
let lastRun = Atomics.load(ctrl, K.C_SEQ);
Atomics.store(ctrl, mySlot, lastRun);
Atomics.add(ctrl, K.C_READY, 1);
Atomics.notify(ctrl, K.C_READY);
parentPort.postMessage({ ready: true });   // informational — readiness is the C_READY atomic
for (;;) {
  Atomics.wait(ctrl, K.C_SEQ, lastRun);
  const seq = Atomics.load(ctrl, K.C_SEQ);
  if (seq === lastRun) continue;            // spurious wake — nothing new signalled
  const op = Atomics.load(ctrl, K.C_OP);
  if (op === K.OP_EXIT) break;
  if (seq !== lastRun + 1) {                // missed a phase — cannot replay it
    Atomics.store(ctrl, mySlot, K.POISON);
    Atomics.notify(ctrl, mySlot);
    break;
  }
  const parity = Atomics.load(ctrl, K.C_PARITY);
  const pop = parity ? V.popB : V.popA;
  const nxt = parity ? V.popA : V.popB;
  if (op === K.OP_CAP) {
    K.capBand({
      land: V.land, fert: V.fert, riverMag: V.riverMag, coast: V.coast, relief: V.relief,
      cap: V.cap, devF: V.devF, pasture: V.pasture, worksF: V.worksF, tfArr: V.tfArr,
      owner: V.owner, capT: V.capT, gateT: V.gateT,
      hasRiver: hdr[K.H_HASRIVER] > 0, hasCoast: hdr[K.H_HASCOAST] > 0, hasRelief: hdr[K.H_HASRELIEF] > 0,
      ownerOn: hdr[K.H_OWNERON] > 0, indOn: hdr[K.H_INDON] > 0, tfL: hdr[K.H_TFL],
      worksOn: hdr[K.H_WORKSON] > 0, worksK: hdr[K.H_WORKSK], devOn: hdr[K.H_DEVON] > 0,
      capPerFert: hdr[K.H_CAPPERFERT], accessDev: hdr[K.H_ACCESSDEV], dev: hdr[K.H_DEV],
    }, lo, hi);
  } else if (op === K.OP_GROWTH) {
    K.growthBand({
      land: V.land, pop, cap: V.cap, devF: V.devF, tropicB: V.tropicB, tfArr: V.tfArr,
      glOn: hdr[K.H_GLON] > 0, tfOn: hdr[K.H_TFON] > 0, gl: hdr[K.H_GL],
      rBulk: hdr[K.H_RBULK], dt: hdr[K.H_DT],
    }, lo, hi);
  } else if (op === K.OP_MIG_A) {
    K.migCopyBand(nxt, pop, rawLo, rawHi);
    K.mig6aBand({ land: V.land, pop, cap: V.cap, mv: V.mv, ssum: V.ssum,
                  tw: g.tw, th: g.th, migShare: hdr[K.H_MIGSHARE] }, lo, hi);
  } else if (op === K.OP_MIG_B) {
    K.mig6bBand({ land: V.land, pop, nxt, cap: V.cap, mv: V.mv, ssum: V.ssum,
                  tw: g.tw, th: g.th }, lo, hi);
  } else if (op === K.OP_WORKS) {
    K.worksBand({ land: V.land, pop, cap: V.cap, wk: V.worksF, irr: V.irr,
                  tfW: V.tfArr, tfWOn: hdr[K.H_TFWON] > 0, devF: V.devF,
                  devOn: hdr[K.H_DEVON] > 0, leadAgri: hdr[K.H_LEADAGRI],
                  rate: hdr[K.H_RATE], dk: hdr[K.H_DK] }, lo, hi);
  }
  lastRun = seq;
  Atomics.store(ctrl, mySlot, seq);   // truth: this band completed phase seq
  Atomics.add(ctrl, K.C_HINT, 1);     // hint: give the coordinator a wake address
  Atomics.notify(ctrl, K.C_HINT);
}
