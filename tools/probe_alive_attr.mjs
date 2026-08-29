// Alive-debt attribution at W=960 — one clean process per arm (SIM_TUNE).
// Parent: node tools/probe_alive_attr.mjs [steps] [seed]
// Child:  ALIVE_ATTR_CHILD=1 SIM_TUNE=... node tools/probe_alive_attr.mjs [steps] [seed] [armName]
import { spawnSync } from "node:child_process";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 24000);
const SEED = +(process.argv[3] || 8817);
// Default W=1920 → tw=960 = app "Half" (map 1920 / simDiv 2). Override: ALIVE_ATTR_W=960 → tw=480.
const W = +(process.env.ALIVE_ATTR_W || 1920), H = W >> 1;
const EVERY = 4000;

const LIVE = "DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,FOUND_DRIFT=1,ABSORB_ORG_ERA=1,WAR_FINISH=1,SETT_STRIDE=3,TRADE_STRIDE=5";

const ARMS_ALL = [
  ["harness_current", ""],
  ["harness_pre_v58", "COURT_SPHERE=0,ENGULF_BAR=0,ABSORB_PEER=0,CITY_STORE=0,TRUCE_TRADE_OWN=0"],
  ["harness_pre_v57", "COURT_SPHERE=0,ENGULF_BAR=0,ABSORB_PEER=0,CITY_STORE=0,TRUCE_TRADE_OWN=0,MINT_RESIDUAL=0,MINT_REACH=0,SEED_EXCLUSIVE=0,CITY_HOLD=0,CATCH_GRACE=0,ARID_SECURE=0"],
  ["harness_pre_v55", "COURT_SPHERE=0,ENGULF_BAR=0,ABSORB_PEER=0,CITY_STORE=0,TRUCE_TRADE_OWN=0,MINT_RESIDUAL=0,MINT_REACH=0,SEED_EXCLUSIVE=0,CITY_HOLD=0,CATCH_GRACE=0,ARID_SECURE=0,CORE_LOCAL=0,AGGLOM_LOCAL=0,STAMP_RETIRE=0,VIABLE_UNITS=0,DISSOLVE_CORE=1"],
  ["harness_city_store_off", "CITY_STORE=0"],
  ["harness_mint_bars_off", "MINT_RESIDUAL=0,MINT_REACH=0,CITY_STORE=0"],
  ["harness_v55_only_off", "CORE_LOCAL=0,AGGLOM_LOCAL=0,STAMP_RETIRE=0,VIABLE_UNITS=0,DISSOLVE_CORE=1"],
  ["live_current", LIVE],
  ["live_pre_v57", LIVE + ",MINT_RESIDUAL=0,MINT_REACH=0,SEED_EXCLUSIVE=0,CITY_HOLD=0,CATCH_GRACE=0,ARID_SECURE=0,COURT_SPHERE=0,ENGULF_BAR=0,ABSORB_PEER=0,CITY_STORE=0,TRUCE_TRADE_OWN=0"],
  ["live_pre_v55", LIVE + ",MINT_RESIDUAL=0,MINT_REACH=0,SEED_EXCLUSIVE=0,CITY_HOLD=0,CATCH_GRACE=0,ARID_SECURE=0,COURT_SPHERE=0,ENGULF_BAR=0,ABSORB_PEER=0,CITY_STORE=0,TRUCE_TRADE_OWN=0,CORE_LOCAL=0,AGGLOM_LOCAL=0,STAMP_RETIRE=0,VIABLE_UNITS=0,DISSOLVE_CORE=1"],
];
const only = (process.env.ALIVE_ATTR_ARMS || "").split(",").map(s => s.trim()).filter(Boolean);
const ARMS = only.length ? ARMS_ALL.filter(([n]) => only.includes(n)) : ARMS_ALL;
function snap(world) {
  let setts = 0, cities = 0, pop = 0, urban = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    setts++;
    pop += s.people || 0;
    urban += s._urbanPop || 0;
    if ((s._urbanPop || 0) >= 8) cities++;
  }
  let realms = 0;
  if (world._countryOwner) {
    const seen = new Set();
    for (let i = 0; i < world.N; i++) {
      const c = world._countryOwner[i];
      if (c >= 0) seen.add(c);
    }
    realms = seen.size;
  }
  return { setts, cities, realms, pop: Math.round(pop), urban: Math.round(urban) };
}

if (process.env.ALIVE_ATTR_CHILD) {
  const arm = process.argv[4] || "child";
  const world = buildSim({ W, H, seed: SEED });
  console.log(`MACHINE\tarm\t${arm}\ttw\t${world.tw}\tstart_setts\t${world.settlements.length}`);
  for (let t = 0; t < STEPS; ) {
    const dt = Math.min(EVERY, STEPS - t);
    stepPeopleSim(world, dt);
    t += dt;
    const s = snap(world);
    console.log(`MACHINE\t${arm}\t${world.step}\t${s.setts}\t${s.cities}\t${s.realms}\t${s.pop}\t${s.urban}`);
  }
  process.exit(0);
}

console.log(`[alive-attr] parent W=${W} steps=${STEPS} seed=${SEED} arms=${ARMS.length}`);
const summary = [];
for (const [name, tune] of ARMS) {
  const t0 = Date.now();
  const env = { ...process.env, ALIVE_ATTR_CHILD: "1", SIM_TUNE: tune };
  const r = spawnSync(process.execPath, [process.argv[1], String(STEPS), String(SEED), name], {
    env, encoding: "utf8", maxBuffer: 20e6,
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.status !== 0) {
    console.error(`[alive-attr] FAIL ${name} status=${r.status}\n${r.stderr?.slice(-500)}`);
    summary.push({ name, sec, err: true });
    continue;
  }
  const lines = (r.stdout || "").split("\n").filter(l => l.startsWith("MACHINE\t"));
  for (const l of lines) console.log(l);
  const last = lines.filter(l => l.startsWith(`MACHINE\t${name}\t`)).pop();
  if (last) {
    const [, , step, setts, cities, realms, pop, urban] = last.split("\t");
    summary.push({ name, sec, step, setts, cities, realms, pop, urban });
    console.log(`[alive-attr] ${name} done ${sec}s final setts=${setts} realms=${realms}\n`);
  } else {
    summary.push({ name, sec, err: true });
  }
}

console.log("\n═══ SUMMARY @ final ═══");
console.log("arm".padEnd(28) + ["setts", "cities", "realms", "pop", "urban", "sec"].map(h => h.padStart(8)).join(""));
for (const r of summary) {
  if (r.err) { console.log(r.name.padEnd(28) + "ERROR"); continue; }
  console.log(r.name.padEnd(28) + [r.setts, r.cities, r.realms, r.pop, r.urban, r.sec].map(x => String(x).padStart(8)).join(""));
}
console.log(`\n[alive-attr] grid W=${W} tw=${W / 2} (app Half = W=1920 tw=960).`);
console.log("Prior mistaken panel was W=960 tw=480. Overnight stylized_960 was also tw=480.");
