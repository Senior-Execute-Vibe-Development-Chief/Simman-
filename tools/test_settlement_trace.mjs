import { snapshotSettlement, sampleTrace, makeTrace, TRACE_MAX_SAMPLES } from "../src/sim/peopleSim/settlementTrace.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[settlement-trace]");

{
  const parent = { kind: "settlement", id: 2, name: "other" };
  const reach = new Set([2, 9, 11]);
  const s = {
    kind: "settlement",
    id: 1,
    name: "Ur",
    people: 4422.5,
    wealth: 0,
    food: 80,
    _scarcity: 1.25,
    _foodParent: parent,
    _tradeReach: reach,
    knowledge: { agriculture: 0.5 },
    _cycleSelf: null,
  };
  s._cycleSelf = s;
  const snap = snapshotSettlement(s);
  check("keeps numbers", snap.people === 4422.5 && snap._scarcity === 1.25);
  check("peer settlement is an id ref", snap._foodParent && snap._foodParent._settlement === 2);
  check("Set becomes _set", snap._tradeReach && snap._tradeReach.size === 3 && snap._tradeReach._set.includes(9));
  check("cycle does not explode", snap._cycleSelf && snap._cycleSelf._cycle === true);
  JSON.stringify(snap);
  check("JSON.stringify succeeds", true);
}

{
  const s = { id: 7, name: "Kish", people: 10, mode: "settled" };
  const world = { step: 100, seed: 1, tw: 240, th: 120, _byId: new Map([[7, s]]) };
  const rec = makeTrace(7, 10, "Kish");
  check("first sample fires immediately", sampleTrace(world, rec) === true && rec.samples.length === 1);
  world.step = 105;
  check("inside the interval is skipped", sampleTrace(world, rec) === false && rec.samples.length === 1);
  world.step = 110;
  check("next interval samples", sampleTrace(world, rec) === true && rec.samples.length === 2);
  rec.recording = false;
  world.step = 120;
  check("stopped rec does not sample", sampleTrace(world, rec) === false && rec.samples.length === 2);
  check("sample carries year and exact people", rec.samples[0].year != null && rec.samples[0].s.people === 10);
}

{
  const s = { id: 1, name: "cap" };
  const world = { step: 0, seed: 1, tw: 8, th: 8, _byId: new Map([[1, s]]) };
  const rec = makeTrace(1, 1, "cap");
  for (let i = 0; i < TRACE_MAX_SAMPLES + 25; i++) {
    world.step = i;
    sampleTrace(world, rec);
  }
  check("ring buffer caps at TRACE_MAX_SAMPLES", rec.samples.length === TRACE_MAX_SAMPLES);
}

if (failures) { console.error(`\n[settlement-trace] ${failures} failed`); process.exit(1); }
console.log("\n[settlement-trace] all checks passed");
