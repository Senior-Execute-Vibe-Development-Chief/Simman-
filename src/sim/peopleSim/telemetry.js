// TELEMETRY — why did the thing NOT happen?
//
// Every metric this repo collects is OUTCOME state: what the world became. Outcomes
// cannot explain ABSENCES, and an absence is nearly always the question — why did no
// state form here, why did this realm not grow, why was that war never declared. The
// 2026-07-31 session answered each of those by hand-writing a probe that RE-IMPLEMENTED
// the gate logic externally (tools/probe_fillaudit.mjs replicates the whole size-target
// computation) or by adding one-off counters (armies.js WDBG). The first is fragile —
// a duplicated gate drifts from the real one and then lies — and the second does not
// generalise.
//
// This is the general layer: a pass tallies WHY it rejected each candidate, at the
// exact line that rejects it, so the funnel can never drift from the code.
//
// COST WHEN OFF: one `if (!world._tel) return;`. Nothing allocates, nothing is counted,
// and no control flow anywhere depends on a tally — a telemetry call is a pure
// side-effect on a debug map, so a run with it on produces the identical world.
//
// USE
//   telEnable(world)                       // from a probe, before stepping
//   tel(world, "nucleate", "org")          // at the line that rejects
//   telPass(world, "nucleate")             // at the line that accepts
//   telReport(world)                       // { channel: { outcome: count } }
export function telEnable(world) { return (world._tel = new Map()); }

export function tel(world, channel, outcome, n = 1) {
  const t = world._tel; if (!t) return;
  let c = t.get(channel); if (!c) t.set(channel, c = new Map());
  c.set(outcome, (c.get(outcome) || 0) + n);
}

/** Sugar for the accept branch, so every funnel has a denominator. */
export function telPass(world, channel, n = 1) { tel(world, channel, "PASSED", n); }

export function telReport(world) {
  const out = {};
  if (!world._tel) return out;
  for (const [ch, m] of world._tel) {
    out[ch] = {};
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) out[ch][k] = v;
  }
  return out;
}

export function telReset(world) { if (world._tel) world._tel.clear(); }
