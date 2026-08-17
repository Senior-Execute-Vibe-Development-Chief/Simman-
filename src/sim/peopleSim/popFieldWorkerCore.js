// Shared band-worker run loop (docs/popfield-parallel.md §4). Platform-free:
// the node entry (popFieldWorker.js) and the browser entry
// (popFieldWorker.browser.js) both build their views and call runBandLoop —
// the loop itself imports ONLY the kernel and blocks in Atomics.wait, so it
// works identically under worker_threads and Web Workers (Atomics.wait is
// legal in any worker thread).
//
// Strict lockstep, epoch-stamped: every phase seq is run EXACTLY once; a
// duplicate wake re-stamps idempotently; a seq the worker cannot replay
// stamps POISON so the coordinator throws instead of continuing with a
// silently-skipped band. Band RANGES are read from ctrl each phase (the
// coordinator rebalances them between firings — identical results at any
// banding, so the split is pure wall-clock). Each phase's wall time is added
// to this band's hdr slot: the balancer's feedback.
import * as K from "./popFieldKernel.js";

// Spin briefly before parking: phases arrive in bursts (~5 per firing) and an
// OS wake costs ~50-150µs — burning ~tens of µs of empty loads first turns
// most parks into free pickups. Idle between firings still parks properly.
const SPIN = 12000;

// Run every kernel a few dozen times over tiny LOCAL dummy buffers before
// announcing readiness, with argument objects of the same shape as the real
// calls: each worker is its own V8 isolate, so its kernels start cold — the
// first real firings otherwise run interpreted (measured 40-65 ms/firing vs
// ~10 warm), poisoning both the tick and the balancer's feedback.
function warmKernels() {
  const tw = 8, th = 8, N = tw * th, nL = N;
  const land = new Int32Array(N); for (let i = 0; i < N; i++) land[i] = i;
  const f32 = () => { const a = new Float32Array(N); a.fill(0.5); return a; };
  const u8 = () => { const a = new Uint8Array(N); a.fill(1); return a; };
  const f64 = () => new Float64Array(N);
  const pop = f32(), nxt = f32(), cap = f32();
  const mv = f64(), ssum = f64();
  const tabs = new Float64Array(64); tabs.fill(1.5);
  const owner = new Int32Array(N); owner.fill(1);
  for (let r = 0; r < 64; r++) {
    K.capBand({ land, fert: f32(), riverMag: u8(), coast: u8(), relief: f32(), cap,
      devF: f32(), pasture: f32(), worksF: f32(), tfArr: f32(), owner, capT: tabs, gateT: tabs,
      hasRiver: true, hasCoast: true, hasRelief: true, ownerOn: true, indOn: true, tfL: 1,
      worksOn: true, worksK: 1, devOn: true, capPerFert: 10, accessDev: 1, dev: 1 }, 0, nL);
    K.growthBand({ land, pop, cap, devF: f32(), tropicB: f32(), tfArr: f32(),
      glOn: true, tfOn: true, gl: 1, rBulk: 0.03, dt: 1 }, 0, nL);
    K.migCopyBand(nxt, pop, 0, N);
    K.mig6aBand({ land, pop, cap, mv, ssum, tw, th, migShare: 0.01 }, 0, nL);
    K.mig6bBand({ land, pop, nxt, cap, mv, ssum, tw, th }, 0, nL);
    K.worksBand({ land, pop, cap, wk: f32(), irr: f32(), tfW: f32(), tfWOn: true,
      devF: f32(), devOn: true, leadAgri: 0.5, rate: 0.001, dk: 0.001 }, 0, nL);
  }
}

export function runBandLoop(d) {
  warmKernels();
  const g = d.geom;   // {N, tw, th, nLand, bands}
  const F32 = (b) => (b ? new Float32Array(b) : null);
  const b = d.bufs;
  const V = {
    land: new Int32Array(b.land),
    owner: b.owner ? new Int32Array(b.owner) : null,
    popA: F32(b.popA), popB: F32(b.popB), cap: F32(b.cap),
    // riverMag/coast are Uint8Array in the sim (riverGen/state.js) — the views
    // MUST match or every worker read is garbage. Under T.ACCESS_BAND the
    // coordinator redirects these slots to the Float32 banded-access fields
    // (popField.js ensureAccessBand) and says so via geom.accessBand: the
    // constructor MUST follow the redirect for exactly the same reason.
    fert: F32(b.fert), till0: b.till0 ? new Float32Array(b.till0) : null,
    riverMag: b.riverMag ? (g.accessBand ? new Float32Array(b.riverMag) : new Uint8Array(b.riverMag)) : null,
    coast: b.coast ? (g.accessBand ? new Float32Array(b.coast) : new Uint8Array(b.coast)) : null, relief: F32(b.relief),
    devF: F32(b.devF), pasture: F32(b.pasture), worksF: F32(b.worksF), tfArr: F32(b.tfArr),
    tropicB: F32(b.tropicB), irr: F32(b.irr),
    mv: new Float64Array(b.mv), ssum: new Float64Array(b.ssum),
    capT: new Float64Array(b.capT), gateT: new Float64Array(b.gateT),
  };
  const ctrl = new Int32Array(b.ctrl);
  const hdr = new Float64Array(b.hdr);
  const idx = d.idx;
  const mySlot = K.C_SLOT0 + (idx - 1);
  const myRange = K.bandBase(g.bands) + 4 * idx;
  const myTime = K.H_TIME0 + idx;

  // Snapshot the phase sequence BEFORE announcing readiness: a signal landing
  // between the announce and the first wait hits the not-equal fast path.
  let lastRun = Atomics.load(ctrl, K.C_SEQ);
  Atomics.store(ctrl, mySlot, lastRun);
  Atomics.add(ctrl, K.C_READY, 1);
  Atomics.notify(ctrl, K.C_READY);
  for (;;) {
    let spun = 0;
    while (Atomics.load(ctrl, K.C_SEQ) === lastRun && spun++ < SPIN) { /* spin */ }
    if (Atomics.load(ctrl, K.C_SEQ) === lastRun) Atomics.wait(ctrl, K.C_SEQ, lastRun);
    const seq = Atomics.load(ctrl, K.C_SEQ);
    if (seq === lastRun) continue;            // spurious wake — nothing new signalled
    const op = Atomics.load(ctrl, K.C_OP);
    if (op === K.OP_EXIT) break;
    if (seq !== lastRun + 1) {                // missed a phase — cannot replay it
      Atomics.store(ctrl, mySlot, K.POISON);
      Atomics.notify(ctrl, mySlot);
      break;
    }
    const t0 = performance.now();
    const parity = Atomics.load(ctrl, K.C_PARITY);
    const pop = parity ? V.popB : V.popA;
    const nxt = parity ? V.popA : V.popB;
    const lo = Atomics.load(ctrl, myRange), hi = Atomics.load(ctrl, myRange + 1);
    const rawLo = Atomics.load(ctrl, myRange + 2), rawHi = Atomics.load(ctrl, myRange + 3);
    if (op === K.OP_CAP) {
      K.capBand({
        land: V.land, fert: V.fert, riverMag: V.riverMag, coast: V.coast, relief: V.relief,
        cap: V.cap, devF: V.devF, pasture: V.pasture, worksF: V.worksF, tfArr: V.tfArr, till0: V.till0,
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
    hdr[myTime] += performance.now() - t0;   // balancer feedback (single writer per slot)
    lastRun = seq;
    Atomics.store(ctrl, mySlot, seq);   // truth: this band completed phase seq
    Atomics.add(ctrl, K.C_HINT, 1);     // hint: give the coordinator a wake address
    Atomics.notify(ctrl, K.C_HINT);
  }
}
