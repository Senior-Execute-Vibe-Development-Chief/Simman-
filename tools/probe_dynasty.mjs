// Dump governance distribution + a sample ruling family tree.
//   node tools/probe_dynasty.mjs [step] [seed]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { cropSuitability } from "../src/sim/cropGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { getDynastyTree } from "../src/sim/peopleSim/dynasties.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { realmName } from "../src/sim/peopleSim/chronicle.js";

const STEP = +(process.argv[2] || "12000");
const SEED = +(process.argv[3] || "8817");
const W = 480, H = 240, N = W * H;
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tE = new Float32Array(N), tT = new Float32Array(N), tM = new Float32Array(N), tC = new Uint8Array(N), tCrop = new Float32Array(N);
for (let i = 0; i < N; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; }
const rivers = computeRivers(W, H, tE, tM, tT); w.rivers = rivers;
for (let i = 0; i < N; i++) tCrop[i] = cropSuitability(tT[i], tM[i], tE[i], tC[i], rivers.riverMag ? rivers.riverMag[i] : 0);
w.deposits = generateResources(W, H, tE, tT, tM, tC, w, SEED, rivers);
const world = initPeopleSim(w, { seed: SEED, tCrop, tileRes: 1, deposits: w.deposits });
for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);
console.log(`[stats]`, peopleSimStats(world));
console.log(`[persons] ${world.persons ? world.persons.size : 0} · [dynasties] ${world.dynasties ? world.dynasties.size : 0}`);

const realms = [...world.countries.values()].sort((a, b) => (b.members?.length || 0) - (a.members?.length || 0));
const govCount = {};
let women = 0, total = 0;
for (const c of realms) {
  const t = getDynastyTree(world, c.id);
  if (!t) continue;
  govCount[t.gov] = (govCount[t.gov] || 0) + 1;
  const r = t.nodes.find(n => n.isRuler);
  if (r) { total++; if (r.female) women++; }
}
console.log(`\n[governance] ${JSON.stringify(govCount)} · female rulers ${women}/${total}`);

console.log(`\n────── sample family trees (top 2 realms) ──────`);
for (const c of realms.slice(0, 2)) {
  const t = getDynastyTree(world, c.id);
  if (!t) continue;
  console.log(`\n═══ ${realmName(world, c.id)} — ${t.govLabel} · house ${t.houseName} · law: ${t.lawLabel} ═══`);
  console.log(`    ruler: ${t.rulerTitle || ""} (${t.nodes.length} tracked kin)`);
  // print as generational outline rooted at members with no tracked parent
  const byId = new Map(t.nodes.map(n => [n.id, n]));
  const kids = new Map(); for (const n of t.nodes) if (n.parentId >= 0) (kids.get(n.parentId) || kids.set(n.parentId, []).get(n.parentId)).push(n.id);
  const roots = t.nodes.filter(n => n.parentId < 0).map(n => n.id);
  const seen = new Set();
  const line = (id, d) => {
    if (seen.has(id)) return; seen.add(id);
    const n = byId.get(id);
    const tags = [n.female ? "♀" : "♂", n.isRuler ? `★${n.title}` : "", n.bastard ? "bastard" : "", n.foreign ? "(married in)" : ""].filter(Boolean).join(" ");
    const life = n.diedY >= 0 ? `${n.bornY}–${n.diedY}` : `b.${n.bornY}, age ${n.age}`;
    const reign = n.reignFrom >= 0 ? ` reigned ${n.reignFrom}–${n.reignTo >= 0 ? n.reignTo : "now"}` : "";
    const nm = n.name + (n.epithet ? ` ${n.epithet}` : "");
    const ch = !n.foreign && n.trait ? ` {${n.trait}}` : "";
    console.log(`    ${"  ".repeat(d)}• ${nm} ${tags} [${life}]${reign}${ch}`);
    for (const k of (kids.get(id) || [])) line(k, d + 1);
  };
  for (const r of roots) line(r, 0);
  // the full roll of sovereigns (all houses / forms of rule)
  console.log(`    ── succession roll (${t.roll.length}) ──`);
  let lg = null;
  for (const e of t.roll) {
    if (e.gov !== lg) { console.log(`      « ${e.gov} »`); lg = e.gov; }
    console.log(`      ${e.fromY}–${e.toY >= 0 ? e.toY : "now"}  ${e.title || ""} ${e.name}${e.epithet ? " " + e.epithet : ""}  [${e.house || "—"}]${e.current ? "  ←reigning" : ""}`);
  }
}
