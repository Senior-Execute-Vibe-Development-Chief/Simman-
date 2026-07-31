// Successor-states probe (Tier-B1, docs/design-successor-states.md): measure the
// shed→successor and restoration-from-memory economy on a live run.
//   (a) the shed — tiles released per territory pass (steps 3+6, _fpRel), split by
//       popField occupancy, and settlements standing on released ground;
//   (b) settlement lapses (countryId >= 0 -> -1) vs settlement.lapsed events —
//       the witnessability gap (design acceptance: lapse-diff − events = 0);
//   (c) polity birth/death flows by channel (founded/ended/seceded/restored/
//       receded/shattered) + fragmentRealm successor counts per shatter;
//   (d) homeland-memory stock: wilderness tiles remembering an ENDED polity
//       (restoration fuel) + the people living on that remembering ground;
//   (e) per frontier founding, the memory content of its nucleation basin
//       (foundings that could have been restorations — the Muudduu/Paik gates);
//   (f) restoration correctness: id-reuse (name continuity, prior chronicle) and
//       ping-pong (re-death of restored ids); successor lifespans;
//   (g) micro-swarm guard: 1-member realms and realms < 30 owned tiles per
//       checkpoint (the CITY_TIER history's tripwire).
// A/B: SIM_SUCCESSORS=0 reproduces the pre-mechanism baseline byte-for-byte.
// Usage: node tools/probe_successors.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { getCulture } from "../src/sim/peopleSim/cultures.js";
import { T, rNormPop } from "../src/sim/peopleSim/tuning.js";
import { malariaSignal } from "../src/sim/peopleSim/habitability.js";

const STEPS = +(process.argv[2] || 12000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H, seed: SEED });
const tw = world.tw, th = world.th, N = world.N;
const terrIvl = Math.max(T.TERRITORY_INTERVAL, Math.round(T.TERRITORY_INTERVAL * rNormPop(world)));
const resScale = tw / 240;
const nucRi = Math.round(9 * resScale);   // NUCLEATE_R basin at this grid
console.log(`grid ${tw}x${th} seed ${SEED} terrIvl ${terrIvl} steps ${STEPS} SUCCESSOR_STATES=${process.env.SIM_SUCCESSORS ?? T.SUCCESSOR_STATES}`);

const prevCid = new Map();          // settlement id -> countryId last tick
let lapses = 0, lapsePopSum = 0, transfers = 0;
let lastEvLen = 0;
const shedStats = { passes: 0, relTiles: 0, relPeopled: 0, relPeople: 0, settOnRel: 0, passesWithSett: 0 };
const foundBasin = [];              // per frontier founding: memory content of the basin
const fragSizes = new Map();        // "step:from" -> successor count
const restoredLog = [];             // {step, id, name} per polity.restored
const secededLog = [];              // {step, id, from, how} per polity.seceded
const recededLog = [];              // {step, id, n, tiles, people} per polity.receded

function tallyPass() {
  const rel = world._fpRel; if (!rel) return;
  const pf = world.popField;
  let n = 0, peopled = 0, people = 0;
  for (let ti = 0; ti < N; ti++) {
    if (rel[ti] < 0) continue;
    n++;
    const p = pf ? pf[ti] : 0;
    if (p > 1) { peopled++; people += p; }
  }
  let onRel = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (rel[ti] >= 0) onRel++;
  }
  shedStats.passes++;
  shedStats.relTiles += n; shedStats.relPeopled += peopled; shedStats.relPeople += people;
  shedStats.settOnRel += onRel; if (onRel > 0) shedStats.passesWithSett++;
}

// Diagnostic mirror of countryTerritory's restoration gates (RESTORE_MAJORITY
// 2/3, viability vs NUCLEATE_CLUSTER_POP×capMul, dead, RESTORE_KIN 1/2) so a
// founding's near-miss is attributable to a specific gate. Read-only.
function gateDiag(seat, mem) {
  if (!mem || mem.domH < 0) return "";
  const uncontested = mem.domW >= (2 / 3) * mem.remembered;
  // f2c at event time (one tick after the pass — negligible drift)
  let cenT = 0, pfT = 0;
  for (const o of world.settlements) if (o.mode === "settled") cenT += o.people || 0;
  if (world.popField) for (let ti = 0; ti < N; ti++) if (world.elev[ti] > 0) pfT += world.popField[ti];
  const f2c = cenT > 0 && pfT > 0 ? cenT / pfT : 0;
  const seatTi = (seat.pos.y | 0) * tw + (((seat.pos.x | 0) % tw) + tw) % tw;
  const fert = world.fert ? world.fert[seatTi] : 1;
  const capNorm = Math.min(1, Math.max(0, fert / 0.55));
  const moistAt = seat._climMoist ?? 0.5, tempAt = seat._climTemp ?? 0.5;
  const riverOpen = Math.min(1, (seat._riverAcc || 0) / 0.30);
  const forest = Math.max(0, Math.min(1, (moistAt - 0.38) / 0.20)) * (1 - malariaSignal(tempAt, 1)) * (1 - riverOpen);
  const ironReady = Math.min(1, ((seat.knowledge && seat.knowledge.metallurgy) || 0) / (T.LAND_CLEAR_METAL || 0.55));
  const capMul = (1 + 3.0 * (1 - capNorm)) * (1 + T.STATE_DISEASE * (seat._wetTropic || 0))
               * (1 + T.STATE_FOREST * forest * (1 - ironReady)) / (1 + T.FRAGMENT * (seat._rugged || 0));
  const viable = mem.domW * f2c >= 400 * capMul;
  const p = getPolity(world, mem.domH);
  const cid = p ? (p.cultureId ?? -1) : -1;
  let kin = -1;
  if (cid >= 0) {
    kin = 0;
    const mix = seat.culMix && seat.culMix.length ? seat.culMix
      : (seat.cultureId != null && seat.cultureId >= 0 ? [[seat.cultureId, 1]] : []);
    for (const e of mix) {
      let cul = getCulture(world, e[0]), hops = 0, desc = e[0] === cid;
      while (!desc && cul && cul.parentCultureId >= 0 && hops++ < 16) {
        if (cul.parentCultureId === cid) desc = true;
        cul = getCulture(world, cul.parentCultureId);
      }
      if (desc) kin += e[1];
    }
  }
  return ` | gates: uncontested=${uncontested} viable=${viable} (domW·f2c=${Math.round(mem.domW * f2c)} vs bar=${Math.round(400 * capMul)}) dead=${mem.domEnded} kin=${kin < 0 ? "abstain" : kin.toFixed(2)}`;
}

function basinMemory(seat) {
  const home = world._tileHomeland; if (!home) return null;
  const pf = world.popField, co = world._countryOwner;
  const sx = seat.pos.x | 0, sy = seat.pos.y | 0;
  const byH = new Map(); let tot = 0, remembered = 0;
  for (let dy = -nucRi; dy <= nucRi; dy++) {
    const yy = sy + dy; if (yy < 0 || yy >= th) continue;
    for (let dx = -nucRi; dx <= nucRi; dx++) {
      if (dx * dx + dy * dy > nucRi * nucRi) continue;
      const ti = yy * tw + (((sx + dx) % tw) + tw) % tw;
      if (!(world.elev[ti] > 0)) continue;
      const w = pf ? Math.max(pf[ti], 0.01) : 1;
      tot += w;
      const h = home[ti];
      if (h >= 0) { remembered += w; byH.set(h, (byH.get(h) || 0) + w); }
    }
  }
  let domH = -1, domW = 0;
  for (const [h, w] of byH) if (w > domW) { domH = h; domW = w; }
  const p = domH >= 0 ? getPolity(world, domH) : null;
  return { tot, remembered, domH, domW, domEnded: p ? p.endedStep >= 0 : null, wild: co ? co[(sy) * tw + sx] < 0 : null };
}

for (let step = 1; step <= STEPS; step++) {
  stepPeopleSim(world, 1);
  // settlement flag diffs (cheap, per tick)
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const was = prevCid.has(s.id) ? prevCid.get(s.id) : s.countryId;
    if (was !== s.countryId) {
      if (was >= 0 && s.countryId < 0) { lapses++; lapsePopSum += s.people || 0; }
      else if (was >= 0 && s.countryId >= 0) transfers++;
    }
    prevCid.set(s.id, s.countryId);
  }
  // new events since last tick
  const evs = world.events || [];
  for (let i = lastEvLen; i < evs.length; i++) {
    const ev = evs[i];
    if (ev.type === "polity.founded" && ev.how === "frontier") {
      const seat = world._byId && world._byId.get(ev.seat);
      if (seat) { const m = basinMemory(seat); if (m) foundBasin.push({ step: ev.step, seat: ev.seatName, diag: m.domH >= 0 ? gateDiag(seat, m) : "", ...m }); }
    }
    if (ev.type === "polity.founded" && ev.how === "fragment") {
      const k = ev.step + ":" + ev.from;
      fragSizes.set(k, (fragSizes.get(k) || 0) + 1);
    }
    if (ev.type === "polity.restored") restoredLog.push({ step: ev.step, id: ev.polity, name: ev.name, from: ev.from });
    if (ev.type === "polity.seceded") secededLog.push({ step: ev.step, id: ev.polity, from: ev.from, how: ev.how });
    if (ev.type === "polity.receded") recededLog.push({ step: ev.step, id: ev.polity, n: ev.n, tiles: ev.tiles, people: ev.people });
  }
  lastEvLen = evs.length;
  if (world.step % terrIvl === 0) tallyPass();
  if (world.step % 3000 === 0) {
    // checkpoint: event tallies + memory stock + micro-swarm guard
    const tally = {};
    for (const ev of evs) {
      const k = ev.type === "polity.founded" ? "founded." + (ev.how || "?") : ev.type;
      tally[k] = (tally[k] || 0) + 1;
    }
    const home = world._tileHomeland, co = world._countryOwner, pf = world.popField;
    let memWild = 0, memWildEnded = 0, memGov = 0, peopleOnEndedMem = 0;
    const endedCache = new Map();
    if (home && co) for (let ti = 0; ti < N; ti++) {
      const h = home[ti]; if (h < 0) continue;
      if (co[ti] >= 0) { memGov++; continue; }
      memWild++;
      let e = endedCache.get(h);
      if (e === undefined) { const p = getPolity(world, h); e = p ? p.endedStep >= 0 : false; endedCache.set(h, e); }
      if (e) { memWildEnded++; peopleOnEndedMem += pf ? pf[ti] : 0; }
    }
    let stateless = 0, settled = 0;
    const memOf = new Map();
    for (const s of world.settlements) if (s.mode === "settled") {
      settled++;
      if (s.countryId < 0) stateless++;
      else memOf.set(s.countryId, (memOf.get(s.countryId) || 0) + 1);
    }
    let oneMember = 0;
    for (const n of memOf.values()) if (n === 1) oneMember++;
    const tilesOf = new Map();
    if (co) for (let ti = 0; ti < N; ti++) if (co[ti] >= 0) tilesOf.set(co[ti], (tilesOf.get(co[ti]) || 0) + 1);
    let under30 = 0, claimed = 0;
    for (const [cid, n] of tilesOf) { if (memOf.has(cid) && n < 30 * resScale * resScale) under30++; claimed += n; }
    console.log(`\n== step ${world.step}: realms=${memOf.size} settled=${settled} stateless=${stateless} 1-member=${oneMember} under30t=${under30} claimed=${claimed}`);
    console.log("   events:", JSON.stringify(tally));
    console.log(`   lapses(diff)=${lapses} lapsePop=${Math.round(lapsePopSum)} transfers=${transfers}`);
    console.log(`   shed: passes=${shedStats.passes} relTiles=${shedStats.relTiles} relPeopled(>1p)=${shedStats.relPeopled} relPeople=${Math.round(shedStats.relPeople)} settOnRel=${shedStats.settOnRel} (passes with a settlement on shed ground: ${shedStats.passesWithSett})`);
    console.log(`   memory: wildTiles=${memWild} (ended-polity: ${memWildEnded}, people on them: ${Math.round(peopleOnEndedMem)}) governedRemembering=${memGov}`);
    console.log(`   debug: recededTiles=${world.debug && world.debug.recededTiles || 0} recededPeople=${Math.round(world.debug && world.debug.recededPeople || 0)}`);
  }
}

console.log("\n== frontier foundings & their basin memory ==");
for (const f of foundBasin) {
  console.log(`  step ${f.step} ${f.seat}: basinW=${Math.round(f.tot)} rememberedW=${Math.round(f.remembered)} domH=${f.domH} domW=${Math.round(f.domW)} domEnded=${f.domEnded}${f.diag || ""}`);
}
console.log("\n== fragmentRealm successor counts (step:from -> successors) ==");
for (const [k, n] of fragSizes) console.log(`  ${k} -> ${n}`);

// Restoration correctness + ping-pong: does the reopened record carry its old
// name and prior chronicle, and does it die again (re-death rate)?
console.log("\n== restorations (id-reuse correctness + ping-pong) ==");
const evs = world.events || [];
for (const r of restoredLog) {
  const p = getPolity(world, r.id);
  let founded = null, priorEvents = 0, reDied = 0;
  for (const ev of evs) {
    if (ev.type === "polity.founded" && ev.polity === r.id && ev.step <= r.step) founded = ev;
    if (ev.step < r.step && (ev.polity === r.id || ev.from === r.id || ev.to === r.id)) priorEvents++;
    if (ev.type === "polity.ended" && ev.polity === r.id && ev.step > r.step) reDied++;
  }
  console.log(`  step ${r.step} id=${r.id} "${r.name}" channel=${r.from >= 0 ? "restoreNations(from=" + r.from + ")" : "ground/reconcile"} nameMatchesFounding=${founded ? founded.name === r.name : "n/a"} priorChronicle=${priorEvents} reDiedAfter=${reDied} aliveAtEnd=${p ? p.endedStep < 0 : "?"}`);
}
console.log("\n== seceded successors (lifespan check) ==");
for (const sec of secededLog) {
  const p = getPolity(world, sec.id);
  console.log(`  step ${sec.step} id=${sec.id} from=${sec.from}${sec.how ? " how=" + sec.how : ""} aliveAtEnd=${p ? p.endedStep < 0 : "?"}${p && p.endedStep >= 0 ? ` endedAt=${p.endedStep}` : ""}`);
}
console.log("\n== polity.receded records ==");
for (const r of recededLog) console.log(`  step ${r.step} polity=${r.id} orphans=${r.n} relTiles=${r.tiles} relPeople=${r.people}`);
