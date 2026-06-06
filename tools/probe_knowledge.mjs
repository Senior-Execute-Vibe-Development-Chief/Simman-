// Knowledge-realism diagnostic — verifies the four upgrades to the knowledge
// model (settlement.js updateKnowledge + armies.js sack):
//   1. EMERGENT SCIENCE RATE  — the tech timeline still reaches the late eras,
//      and big/fed/connected hubs lead small isolated backwaters.
//   2. CONTINENTAL-AXIS DIFFUSION — (structural; checked by build, not here).
//   3. DARK AGES — the global knowledge stock DIPS after shocks instead of only
//      ever rising; settlements regress below their personal peak.
//   4. CLIMATE SPECIALIZATION — arid river valleys lead in agriculture,
//      cold/short-season sites lag.
//   node tools/probe_knowledge.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { techState, ERAS } from "../src/peopleSim/tech.js";

const STEPS = parseInt(process.argv[2] || "20000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10), H = parseInt(process.argv[5] || "480", 10);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tCrop = new Float32Array(W * H);
function tf(t, m, e) { if (e > 0.45) return 0.01; const a = Math.min(1, Math.max(0,(t-0.57)/0.13)) * Math.min(1, 1-Math.pow(Math.max(0,t-0.88),2)*1.5); const b = Math.exp(-((m - 0.45) ** 2) / (2 * 0.22 * 0.22)); return Math.max(0.01, a * b * (1 - Math.max(0, e - 0.15) * 3)); }
const tC = new Uint8Array(W * H), tE = new Float32Array(W * H), tT = new Float32Array(W * H), tM = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; tCrop[i] = tf(w.temperature[i], w.moisture[i], w.elevation[i]); }
w.rivers = computeRivers(W, H, tE, tM, tT); w.deposits = generateResources(W, H, tE, tT, tM, tC, w, w._seed || SEED, w.rivers);
const world = initPeopleSim(w, { seed: w._seed || SEED, tCrop, tileRes: 1, deposits: w.deposits });

// Track the global knowledge STOCK over time (sum of all tracks across all
// settlements) — dark ages show as dips, not a monotone climb. Also track per
// settlement the personal peak organization, to count regressions at the end.
const peakOrg = new Map();
const stock = [];
const SAMPLE = Math.max(1, Math.floor(STEPS / 40));
let dips = 0, lastStock = 0;
for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  for (const st of world.settlements) {
    if (st.mode !== "settled" || !st.knowledge) continue;
    const o = st.knowledge.organization || 0;
    const p = peakOrg.get(st.id) || 0; if (o > p) peakOrg.set(st.id, o);
  }
  if (s % SAMPLE === 0) {
    let sum = 0;
    for (const st of world.settlements) {
      if (st.mode !== "settled" || !st.knowledge) continue;
      const k = st.knowledge;
      sum += (k.agriculture||0)+(k.construction||0)+(k.organization||0)+(k.metallurgy||0)+(k.navigation||0)+(k.mobility||0);
    }
    stock.push(sum);
    if (stock.length > 1 && sum < lastStock * 0.985) dips++;   // a >1.5% drop = a regression episode
    lastStock = sum;
  }
}

const st = peopleSimStats(world);
console.log(`step ${STEPS} ${W}x${H} seed ${SEED}: settlements=${st.settlements} V${st.villages} T${st.towns} C${st.cities} M${st.metropolises}`);

// ── 1. Era distribution (emergent science rate still climbs the ladder) ──
const eraN = [0,0,0,0,0];
const live = world.settlements.filter(s => s.mode === "settled" && s.knowledge);
for (const s of live) eraN[techState(s.knowledge).era]++;
console.log("\nERA distribution (settlements per highest era reached):");
for (let e = 0; e < ERAS.length; e++) console.log(`  ${ERAS[e].padEnd(11)} ${String(eraN[e]).padStart(4)}  ${"█".repeat(Math.round(40*eraN[e]/Math.max(1,live.length)))}`);

// Leaders vs backwaters: top vs bottom organization, and their pop/reach.
const byOrg = [...live].sort((a,b)=>(b.knowledge.organization||0)-(a.knowledge.organization||0));
const fmt = n => n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?(n/1e3).toFixed(1)+"k":String(n|0);
const desc = s => `org=${(s.knowledge.organization||0).toFixed(2)} met=${(s.knowledge.metallurgy||0).toFixed(2)} pop=${fmt(s.people)} reach=${s._tradeReach?s._tradeReach.size:0}`;
console.log(`\nLEADER   ${desc(byOrg[0])}`);
console.log(`BACKWATER ${desc(byOrg[byOrg.length-1])}`);

// ── 3. Dark ages: regressions over the run + settlements below their peak ──
let regressed = 0, lostSum = 0;
for (const s of live) {
  const pk = peakOrg.get(s.id) || 0;
  if (pk > 0.05 && (s.knowledge.organization||0) < pk * 0.85) { regressed++; lostSum += pk - (s.knowledge.organization||0); }
}
console.log(`\nDARK AGES: knowledge-stock regression episodes (>1.5% global drop): ${dips}/${stock.length} samples`);
console.log(`  settlements now >15% below their personal peak org: ${regressed}/${live.length}  (total org lost ${lostSum.toFixed(1)})`);
const spark = stock.map(v=>{const mx=Math.max(...stock);const idx=Math.min(7,Math.floor(8*v/Math.max(1,mx)));return " ▁▂▃▄▅▆▇█"[idx+1];}).join("");
console.log(`  knowledge stock over time: ${spark}`);

// ── 4. Climate specialization: agriculture by climate class ──
const cls = { aridRiver:[], cold:[], tropical:[], temperate:[] };
for (const s of live) {
  const t = s._climTemp ?? 0.5, m = s._climMoist ?? 0.5, wa = s.waterAccess || 0;
  const ag = s.knowledge.agriculture || 0;
  if (m < 0.42 && wa > 0.2) cls.aridRiver.push(ag);
  else if (t < 0.40) cls.cold.push(ag);
  else if (t > 0.80 && m > 0.55) cls.tropical.push(ag);
  else cls.temperate.push(ag);
}
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
console.log("\nCLIMATE SPECIALIZATION (mean agriculture knowledge by site type):");
console.log(`  arid river valley ${mean(cls.aridRiver).toFixed(2)}  (n=${cls.aridRiver.length})  — irrigation pioneers, expect HIGH`);
console.log(`  temperate         ${mean(cls.temperate).toFixed(2)}  (n=${cls.temperate.length})`);
console.log(`  tropical humid     ${mean(cls.tropical).toFixed(2)}  (n=${cls.tropical.length})  — expect LOWER`);
console.log(`  cold short-season  ${mean(cls.cold).toFixed(2)}  (n=${cls.cold.length})  — expect LOWEST`);

const hits = world.debug.invariantHits || {};
const nHits = Object.values(hits).reduce((a, b) => a + b, 0);
console.log(`\ninvariants: ${nHits === 0 ? "CLEAN" : JSON.stringify(hits)}`);
