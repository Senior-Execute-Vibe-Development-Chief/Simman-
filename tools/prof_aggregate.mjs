// Aggregate a V8 .cpuprofile by function SELF time — and, the part the naive
// name-only rollup loses, attribute a chosen function's cost to its CALLERS:
// each distinct call path is a distinct node in the profile tree, so grouping a
// function's nodes by nearest NAMED ancestor answers "who is really calling
// this?" directly (the question that spawned the roads.js findPath mystery —
// roadmap W6-G item 4).
//
//   node tools/prof_aggregate.mjs bench/win.cpuprofile [topN=30]
//   node tools/prof_aggregate.mjs bench/win.cpuprofile --callers=findPath
import fs from "fs";

const PATH = process.argv[2];
if (!PATH) { console.error("usage: prof_aggregate.mjs <file.cpuprofile> [topN] [--callers=fnName]"); process.exit(2); }
let topN = 30, callersOf = null;
for (const a of process.argv.slice(3)) {
  if (a.startsWith("--callers=")) callersOf = a.slice(10);
  else if (/^\d+$/.test(a)) topN = +a;
}

const prof = JSON.parse(fs.readFileSync(PATH, "utf8"));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parentOf = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parentOf.set(c, n.id);

// Self µs per node: timeDeltas[i] is attributed to samples[i].
const selfUs = new Map();
const { samples, timeDeltas } = prof;
let totalUs = 0;
for (let i = 0; i < samples.length; i++) {
  const d = timeDeltas[i];
  if (!(d > 0)) continue;
  totalUs += d;
  selfUs.set(samples[i], (selfUs.get(samples[i]) || 0) + d);
}

// Subtree (self+descendants) µs per node, iterative post-order.
const subUs = new Map();
{
  const stack = [[prof.nodes[0].id, 0]];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const n = byId.get(top[0]);
    const kids = n.children || [];
    if (top[1] < kids.length) { stack.push([kids[top[1]++], 0]); continue; }
    stack.pop();
    let s = selfUs.get(n.id) || 0;
    for (const c of kids) s += subUs.get(c) || 0;
    subUs.set(n.id, s);
  }
}

const short = (u) => (u || "").split("/").slice(-1)[0];
const label = (n) => `${n.callFrame.functionName || "(anonymous)"} ${short(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`;
const ms = (us) => (us / 1000).toFixed(1).padStart(9);
const pct = (us) => ((100 * us) / totalUs).toFixed(1).padStart(5);

if (callersOf) {
  // Group every node of the target function by its nearest NAMED ancestor.
  const groups = new Map();   // caller label -> {self, sub, nodes}
  let fnSelf = 0, fnSub = 0, found = 0;
  for (const n of prof.nodes) {
    if (n.callFrame.functionName !== callersOf) continue;
    found++;
    const s = selfUs.get(n.id) || 0, t = subUs.get(n.id) || 0;
    fnSelf += s; fnSub += t;
    let p = parentOf.get(n.id), anc = null;
    while (p !== undefined) {
      const pn = byId.get(p);
      if (pn.callFrame.functionName && pn.callFrame.functionName !== callersOf) { anc = pn; break; }
      p = parentOf.get(p);
    }
    const k = anc ? label(anc) : "(root)";
    const g = groups.get(k) || { self: 0, sub: 0, nodes: 0 };
    g.self += s; g.sub += t; g.nodes++;
    groups.set(k, g);
  }
  console.log(`[callers] ${callersOf}: ${found} tree nodes, self ${ms(fnSelf)}ms, self+desc ${ms(fnSub)}ms (profile total ${ms(totalUs)}ms)`);
  console.log(`   self(ms)  s+desc(ms)  nodes  nearest named ancestor`);
  for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].sub - a[1].sub)) {
    console.log(`  ${ms(g.self)} ${ms(g.sub).padStart(11)}  ${String(g.nodes).padStart(5)}  ${k}`);
  }
} else {
  const agg = new Map();   // label -> {self, sub} (sub summed over nodes; a fn's nodes never nest for non-recursive fns)
  for (const n of prof.nodes) {
    const s = selfUs.get(n.id) || 0;
    if (!s && !(n.children || []).length) continue;
    const k = label(n);
    const g = agg.get(k) || { self: 0 };
    g.self += s;
    agg.set(k, g);
  }
  console.log(`[self-time] total ${ms(totalUs)}ms — top ${topN}`);
  console.log(`   self(ms)     %  function`);
  for (const [k, g] of [...agg.entries()].sort((a, b) => b[1].self - a[1].self).slice(0, topN)) {
    console.log(`  ${ms(g.self)} ${pct(g.self)}  ${k}`);
  }
}
