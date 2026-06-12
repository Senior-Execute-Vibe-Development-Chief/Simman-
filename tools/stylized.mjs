// ── Stylized-facts validation: does the emergent history look like history? ──
//
// Runs a world and scores it against quantitative regularities real history
// exhibits, so "accuracy" is a measurement, not a vibe:
//
//   1. ZIPF — city sizes follow a rank-size power law (log-log slope ≈ −1)
//   2. EMPIRE TAIL — polity sizes are heavy-tailed (a few great powers,
//      many small states), not uniform
//   3. LIFESPANS — states die; fallen-polity lifetimes have a real median
//      and a heavy tail (no instant churn, no immortal map-painters)
//   4. WAR — wars happen at a sane rate, and a visible share correlate
//      with succession crises (human causes, not pure geometry)
//   5. DIFFUSION — technology lags with distance from the cradles
//      (negative correlation between organization and cradle distance)
//   6. URBANIZATION — a minority of population lives in cities
//   7. CONTINUITY — civilization survives: population grows, settlements
//      persist, money stays finite
//
// Usage:  node tools/stylized.mjs [seed] [steps] [W]
//         npm run validate
// Exits non-zero only on hard failures (degenerate world); soft misses warn.

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

const SEED = +(process.argv[2] || 8817);
const STEPS = +(process.argv[3] || 15000);
const W = +(process.argv[4] || 480), H = W >> 1;

let hard = 0, soft = 0;
function score(name, value, ok, hardFail = false, detail = "") {
  const tag = ok ? "ok  " : hardFail ? "FAIL" : "warn";
  if (!ok) { if (hardFail) hard++; else soft++; }
  console.log(`  ${tag}  ${name}: ${value}${detail ? `   (${detail})` : ""}`);
}

console.log(`[stylized] seed ${SEED} · ${W}x${H} · ${STEPS} steps`);
const world = buildSim({ W, H, seed: SEED });
const t0 = performance.now();
stepPeopleSim(world, STEPS);
console.log(`[stylized] simulated in ${((performance.now() - t0) / 1000).toFixed(0)}s\n`);

const setts = world.settlements.filter(s => s.mode === "settled");
const st = peopleSimStats(world);

// ── 1. Zipf: rank-size slope of city populations ──
{
  const sizes = setts.map(s => s.people).filter(p => p > 50).sort((a, b) => b - a);
  const n = Math.min(sizes.length, 80);
  if (n >= 15) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.log(i + 1), y = Math.log(sizes[i]);
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    score("Zipf rank-size slope", slope.toFixed(2), slope < -0.5 && slope > -1.6, false, `${n} cities; real-world ≈ −1`);
  } else {
    score("Zipf rank-size slope", "n/a", false, false, `only ${sizes.length} cities > 50 people`);
  }
}

// ── 2. Empire size tail ──
{
  const sizes = [];
  const perC = new Map();
  for (const s of setts) if (s.countryId >= 0) perC.set(s.countryId, (perC.get(s.countryId) || 0) + 1);
  for (const v of perC.values()) sizes.push(v);
  sizes.sort((a, b) => b - a);
  if (sizes.length >= 5) {
    const med = sizes[sizes.length >> 1];
    const ratio = sizes[0] / Math.max(1, med);
    score("empire tail (largest/median members)", ratio.toFixed(1), ratio >= 2.5, false, `${sizes.length} polities, largest ${sizes[0]}, median ${med}`);
  } else score("empire tail", "n/a", false, false, `${sizes.length} polities`);
}

// ── 3. Polity lifespans ──
{
  const lifes = [];
  if (world.polities) for (const p of world.polities.values()) {
    if (p.endedStep >= 0) lifes.push(p.endedStep - p.foundedStep);
  }
  lifes.sort((a, b) => a - b);
  if (lifes.length >= 8) {
    const med = lifes[lifes.length >> 1], max = lifes[lifes.length - 1];
    score("fallen-polity lifespan median", `${med} steps`, med >= 300 && med <= STEPS / 2, false, `${lifes.length} fallen, max ${max}`);
    score("lifespan heavy tail (max/median)", (max / Math.max(1, med)).toFixed(1), max / Math.max(1, med) >= 3);
  } else score("polity lifespans", "n/a", false, false, `${lifes.length} fallen polities`);
}

// ── 4. Wars: rate + human causes ──
{
  const wars = (world.events || []).filter(e => e.type === "war.began");
  const per1k = wars.length / (STEPS / 1000);
  const crisis = wars.filter(w => w.crisis).length;
  const faith = wars.filter(w => w.faithClash).length;
  score("wars per 1000 steps", per1k.toFixed(1), per1k > 1 && per1k < 400);
  score("wars amid succession crises", `${crisis}/${wars.length}`, wars.length === 0 || crisis / Math.max(1, wars.length) > 0.02, false, "human causes visible");
  console.log(`        (${faith} across state-faith lines)`);
}

// ── 5. Tech diffusion gradient from the cradles ──
{
  const cradles = [];
  if (world.cultures) for (const c of world.cultures.values()) {
    if (c.parentCultureId < 0) {
      const o = world._byId && world._byId.get(c.originSettlementId);
      if (o) cradles.push(o.pos);
    }
  }
  if (cradles.length && setts.length > 20) {
    const xs = [], ys = [];
    for (const s of setts) {
      let d = Infinity;
      for (const cp of cradles) {
        let dx = Math.abs(s.pos.x - cp.x); if (dx > world.tw / 2) dx = world.tw - dx;
        const dd = Math.sqrt(dx * dx + (s.pos.y - cp.y) ** 2);
        if (dd < d) d = dd;
      }
      xs.push(d); ys.push((s.knowledge && s.knowledge.organization) || 0);
    }
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx2 += (xs[i] - mx) ** 2; dy2 += (ys[i] - my) ** 2; }
    const r = num / Math.sqrt(dx2 * dy2 || 1);
    score("tech ~ cradle-distance correlation", r.toFixed(2), r < -0.1, false, "knowledge should decay outward");
  } else score("tech diffusion gradient", "n/a", false, false, "no cradle origins resolvable");
}

// ── 6. Urbanization ──
{
  let urban = 0, total = 0;
  for (const s of setts) { total += s.people; if ((s.tier | 0) >= 2) urban += s.people; }
  const pct = total > 0 ? (urban / total) * 100 : 0;
  score("urbanization", pct.toFixed(1) + "%", pct >= 2 && pct <= 65, false, "pre-modern history: a minority in cities");
}

// ── 7. Continuity (hard gates) ──
{
  score("civilization alive", `${st.settlements} settlements, pop ${st.totalPeople}`, st.settlements >= 20 && st.totalPeople > 500, true);
  score("wealth finite", String(st.totalWealth), Number.isFinite(st.totalWealth) && st.totalWealth >= 0, true);
  score("polities exist", String(st.countries), st.countries >= 3, true);
  const culN = world.cultures ? world.cultures.size : 0;
  const faithN = world.faiths ? world.faiths.size : 0;
  const dynN = world.dynasties ? world.dynasties.size : 0;
  console.log(`        (registries: ${culN} cultures · ${faithN} faiths · ${dynN} dynasties · ${world.persons ? world.persons.size : 0} persons · ${(world.events || []).length} events)`);
}

console.log(hard ? `\n[stylized] ${hard} HARD failure(s), ${soft} soft warning(s)` : `\n[stylized] all hard gates passed · ${soft} soft warning(s)`);
process.exit(hard ? 1 : 0);
