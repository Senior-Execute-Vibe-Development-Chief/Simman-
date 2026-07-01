// SESSION REVIEW: run one world and watch every system we changed this session.
//   1. Balance of power      — does a hegemon self-limit when neighbours coalesce?
//   2. Emergent dominance     — is dominance bounded by institutional tech, not a flat cap?
//   3. Conserved field army   — do multi-front realms split their army / besieged ones stall?
//   4. Local-saturation colonisation
//   5. Colonial dependencies  — self-governing colonies bound to an overlord
//   6. Bidirectional economy  — investment out, tribute home
//   7. Naval reach decay      — protection/support/independence by distance × naval tech
//   node tools/probe_session.mjs [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { settlementPower } from "../src/sim/peopleSim/conquest.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });

const terrByCountry = () => {
  const cnt = new Map(); const co = world._countryOwner;
  if (co) for (let i = 0; i < co.length; i++) { const c = co[i]; if (c >= 0) cnt.set(c, (cnt.get(c) || 0) + 1); }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]);
};
const blocPow = (cc) => { const c = world.countries && world.countries.get(cc); if (!c || !c.members) return 0; let p = 0; for (const m of c.members) if (m.mode === "settled" && m.countryId === cc) p += settlementPower(m); return p; };

console.log(`SESSION REVIEW · seed ${SEED} · ${STEPS} steps\n`);
console.log('step  | setts cntry dep | #1terr #2terr | balΣ blocMax | domMax | warMF | depBound');
let maxMultiFront = 0;
for (let i = 1; i <= STEPS; i++) {
  stepPeopleSim(world, 1);
  // track peak multi-front war commitment across the run
  if (world.countries) for (const c of world.countries.values()) if ((c._offFronts || 0) >= 2) maxMultiFront = Math.max(maxMultiFront, c._offFronts);
  if (i % 2500 !== 0 && i !== 500) continue;
  const st = peopleSimStats(world);
  const terr = terrByCountry();
  const t1 = terr[0] ? terr[0][1] : 0, t2 = terr[1] ? terr[1][1] : 0;
  // balance of power
  const at = world._allianceTarget, bloc = world._blocMight, pow = world._countryPow;
  let balancing = 0; if (at) for (const v of at.values()) if (v >= 0) balancing++;
  let blocMax = 0; if (bloc && pow) for (const [h, b] of bloc) { const r = b / Math.max(1, pow.get(h) || 1); if (r > blocMax) blocMax = r; }
  // dominance
  let domMax = 0; if (world.countries) for (const c of world.countries.values()) { const d = c._dominance || 1; if (d > domMax) domMax = d; }
  // dependencies
  let depBound = 0; if (world.polities) for (const p of world.polities.values()) if (p.endedStep < 0 && p._overlord != null) depBound++;
  let curMF = 0; if (world.countries) for (const c of world.countries.values()) if ((c._offFronts || 0) >= 2) curMF++;
  console.log(`${String(i).padStart(5)} | ${String(st.settlements).padStart(4)}  ${String(st.countries).padStart(4)}  ${String(depBound).padStart(3)} | ${String(t1).padStart(6)} ${String(t2).padStart(6)} | ${String(balancing).padStart(3)}  ${blocMax.toFixed(2).padStart(5)} | ${domMax.toFixed(1).padStart(5)} | ${String(curMF).padStart(4)}  | ${depBound}`);
}

// ── End-of-run summary across all systems ──
const ev = world.events || [];
const count = (t) => ev.filter(e => e.type === t).length;
const terr = terrByCountry();
console.log(`\n── OUTCOMES ─────────────────────────────────────────────`);

// 1+2: empire tail & dominance
const mem = []; if (world.countries) for (const c of world.countries.values()) { const m = c.members ? c.members.filter(s => s.mode === "settled" && s.countryId === c.id).length : 0; if (m > 0) mem.push(m); }
mem.sort((a, b) => b - a); const memMed = mem.length ? mem[mem.length >> 1] : 1;
console.log(`1. Balance of power : top realm ${terr[0] ? terr[0][1] : 0} tiles vs #2 ${terr[1] ? terr[1][1] : 0} (ratio ${terr[1] ? (terr[0][1]/terr[1][1]).toFixed(1) : "—"}×); peak multi-front war = ${maxMultiFront} fronts`);
console.log(`2. Empire tail      : largest ${mem[0]} members / median ${memMed} = ${(mem[0]/memMed).toFixed(1)}× ; peak dominance reached`);

// 3: conserved army — sample a snapshot of besieged-while-attacking realms
let pinned = 0; if (world.countries) for (const c of world.countries.values()) if ((c._defLoad || 0) >= 1 && (c._offFronts || 0) >= 1 && (c._mainOffMul || 0) < 0.2) pinned++;
console.log(`3. Conserved army   : realms currently attacking while their own heartland is besieged, offence collapsed (<0.2): ${pinned}`);

// 4: colony spread on secondary continents
const { tw, th, elev, N } = world;
const cont = new Int32Array(N).fill(-1); let nc = 0; const csize = []; const stack = [];
for (let i = 0; i < N; i++) { if (elev[i] <= 0 || cont[i] >= 0) continue; const id = nc++; let sz = 0; stack.length = 0; stack.push(i); cont[i] = id;
  while (stack.length) { const p = stack.pop(); sz++; const y = (p / tw) | 0, x = p - y * tw; const nb = [y*tw+((x+1)%tw), y*tw+((x-1+tw)%tw), y>0?p-tw:-1, y<th-1?p+tw:-1]; for (const q of nb) if (q >= 0 && elev[q] > 0 && cont[q] < 0) { cont[q] = id; stack.push(q); } } csize[id] = sz; }
const setts = new Array(nc).fill(0);
for (const s of world.settlements) { if (s.mode !== "settled") continue; const c = cont[(s.pos.y|0)*tw+(s.pos.x|0)]; if (c >= 0) setts[c]++; }
const order = [...Array(nc).keys()].filter(c => csize[c] >= 20).sort((a, b) => csize[b] - csize[a]);
let secondary = 0; order.forEach((c, idx) => { if (idx >= 3) secondary += setts[c]; });
console.log(`4. Colonisation     : ${secondary} settlements on secondary (colony-descended) continents`);

// 5+6+7: dependencies, economy, reach
let bound = 0, reachLo = 1, reachHi = 0; const reach = world._overlordReach;
if (world.polities) for (const p of world.polities.values()) if (p.endedStep < 0 && p._overlord != null) bound++;
if (reach) for (const r of reach.values()) { if (r < reachLo) reachLo = r; if (r > reachHi) reachHi = r; }
console.log(`5. Dependencies     : ${count("colony.founded")} founded, ${bound} currently bound, ${count("colony.independent")} gained independence`);
console.log(`6. Colonial economy : (investment out while young, tribute home when mature — see IN_AID/IN_TRIBUTE ticker)`);
console.log(`7. Naval reach      : current dependency reach factor spans ${reach && reach.size ? reachLo.toFixed(2)+"–"+reachHi.toFixed(2) : "n/a"} (1=offshore, →0=ocean away)`);
console.log(`\nworld: ${world.settlements.filter(s=>s.mode==="settled").length} settlements, pop ${(world._popTotal/1e3|0)}k, ${[...world.countries.values()].length} countries`);
