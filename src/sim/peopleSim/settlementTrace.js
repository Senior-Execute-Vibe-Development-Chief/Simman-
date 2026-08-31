// ── Settlement trace — exact JSON snapshots of one city every N ticks ──
// The inspect card's "Record" button drives this from the sim worker so the
// copy is the LIVE settlement object, not the trimmed UI mirror.

import { stepToYear } from "../calendar.js";

export const TRACE_MAX_SAMPLES = 600;
const MAX_DEPTH = 8;
const MAX_ARR = 400;

/** JSON-safe clone of a settlement's own data. Other settlements/countries become id refs. */
export function snapshotSettlement(s, seen) {
  return jsonSafe(s, seen || new WeakSet(), 0, s);
}

export function traceEnvelope(world, rec) {
  const s = world && world._byId ? world._byId.get(rec.id) : null;
  return {
    schema: "simman.settlementTrace.v1",
    seed: world && world.seed,
    tw: world && world.tw,
    th: world && world.th,
    step: world && world.step,
    year: world ? stepToYear(world.step) : null,
    settlementId: rec.id,
    name: (s && s.name) || rec.name || null,
    every: rec.every,
    samples: rec.samples,
  };
}

export function makeTrace(id, every, name) {
  const n = Math.max(1, every | 0);
  return { id, every: n, name: name || "", samples: [], nextAt: -1, recording: true };
}

export function sampleTrace(world, rec) {
  if (!world || !rec || !rec.recording) return false;
  if (rec.nextAt >= 0 && world.step < rec.nextAt) return false;
  const s = world._byId ? world._byId.get(rec.id) : world.settlements && world.settlements.find(x => x.id === rec.id);
  rec.nextAt = world.step + rec.every;
  rec.samples.push({
    step: world.step,
    year: stepToYear(world.step),
    present: !!(s),
    s: s ? snapshotSettlement(s) : null,
  });
  if (rec.samples.length > TRACE_MAX_SAMPLES) rec.samples.splice(0, rec.samples.length - TRACE_MAX_SAMPLES);
  if (s && s.name) rec.name = s.name;
  return true;
}

export function traceStatus(rec) {
  if (!rec) return { recording: false, id: -1, n: 0, every: 10, name: "", max: TRACE_MAX_SAMPLES };
  return {
    recording: !!rec.recording,
    id: rec.id,
    n: rec.samples.length,
    every: rec.every,
    name: rec.name || "",
    max: TRACE_MAX_SAMPLES,
  };
}

function jsonSafe(v, seen, depth, root) {
  if (v == null) return v;
  const t = typeof v;
  if (t === "number") return Number.isFinite(v) ? v : null;
  if (t === "boolean" || t === "string") return v;
  if (t === "bigint") return v.toString();
  if (t !== "object") return undefined;
  if (depth > MAX_DEPTH) return { _truncated: true };
  if (seen.has(v)) return { _cycle: true };
  if (ArrayBuffer.isView(v)) {
    const n = Math.min(v.length, MAX_ARR);
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = v[i];
    return v.length > n ? { _typed: n, length: v.length, head: a } : a;
  }
  if (v instanceof Map) {
    seen.add(v);
    const out = [];
    let i = 0;
    for (const [k, val] of v) {
      if (i++ >= MAX_ARR) break;
      out.push([jsonSafe(k, seen, depth + 1, root), jsonSafe(val, seen, depth + 1, root)]);
    }
    return { _map: out, size: v.size };
  }
  if (v instanceof Set) {
    const out = [];
    let i = 0;
    for (const x of v) {
      if (i++ >= MAX_ARR) break;
      out.push(jsonSafe(x, seen, depth + 1, root));
    }
    return { _set: out, size: v.size };
  }
  if (v !== root && v.kind === "settlement" && v.id != null) return { _settlement: v.id };
  if (v !== root && v.members && v.id != null && (v.capital || v.capitalId != null)) return { _country: v.id };

  seen.add(v);
  if (Array.isArray(v)) {
    const n = Math.min(v.length, MAX_ARR);
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = jsonSafe(v[i], seen, depth + 1, root);
    return v.length > n ? { _list: a, length: v.length } : a;
  }
  const o = {};
  for (const k of Object.keys(v)) {
    const x = jsonSafe(v[k], seen, depth + 1, root);
    if (x !== undefined) o[k] = x;
  }
  return o;
}
