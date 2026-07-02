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

// ── 1. Zipf: rank-size slope of CITY (urban-core) populations ──
// Under the default province model a settlement's `people` bundles its rural
// countryside — ranking that measured provinces, not cities. Rank the urban
// cores, and fit log(size) on log(rank − 1/2): the Gabaix–Ibragimov
// correction removes the known small-sample OLS bias, so the band can be the
// actual empirical envelope of urban systems (≈ −0.8..−1.2 across countries
// and eras) with a little sampling slack, instead of a width fitted to pass.
{
  const hasRural = setts.some(s => (s._ruralPop || 0) > 0);
  const sizes = setts.map(s => (hasRural ? (s._urbanPop || 0) : s.people)).filter(p => p > 50).sort((a, b) => b - a);
  const n = Math.min(sizes.length, 80);
  if (n >= 15) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.log(i + 1 - 0.5), y = Math.log(sizes[i]);
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    score("Zipf rank-size slope (urban cores, G-I)", slope.toFixed(2), slope < -0.70 && slope > -1.35, false, `${n} cities; empirical envelope ≈ −0.8..−1.2`);
  } else {
    score("Zipf rank-size slope", "n/a", false, false, `only ${sizes.length} cities > 50 urban`);
  }
}

// ── 2. Empire size tail — measured in LAND, not member count ──
// Member count barely tracks map area under persistent territory (the old
// largest/median-members ratio passed both near-uniform maps and total
// map-painters). Score the claimed-land distribution: the largest empire's
// share of all claimed land has a historical envelope (a few percent in a
// fragmented era, up to roughly half of the settled world at a great
// hegemon's peak — Achaemenid, Mongol scale — never all of it), and the
// area tail must be genuinely heavy.
{
  const per = new Map();
  const co = world._countryOwner, elev = world.elev;
  let claimed = 0;
  if (co && elev) for (let i = 0; i < co.length; i++) {
    if (elev[i] <= 0 || co[i] < 0) continue;
    claimed++;
    per.set(co[i], (per.get(co[i]) || 0) + 1);
  }
  const areas = [...per.values()].sort((a, b) => b - a);
  if (areas.length >= 5 && claimed > 0) {
    const top1 = areas[0] / claimed;
    const med = areas[areas.length >> 1];
    score("largest empire's share of claimed land", (top1 * 100).toFixed(0) + "%", top1 >= 0.04 && top1 <= 0.55, false, `${areas.length} polities on ${claimed} tiles`);
    score("empire area tail (largest/median)", (areas[0] / Math.max(1, med)).toFixed(1), areas[0] / Math.max(1, med) >= 3);
  } else score("empire land tail", "n/a", false, false, `${areas.length} landed polities`);
}

// ── 3. Polity lifespans — censoring-aware ──
// Bounds are in mechanic-clock years (0.25 y/step), anchored to history:
// a median fallen-state lifetime of ~50–2000 years (city-states churn in
// decades; dynastic states last centuries) — NOT coupled to the argv step
// count as before (the old STEPS/2 bound loosened with the run length).
// The heavy tail counts the still-ALIVE old realms too: the Rome-shaped
// long-livers usually haven't died by the end of the run, and ignoring the
// censored sample was exactly why this gate under-read the tail.
{
  const lifes = [];
  const aliveAges = [];
  if (world.polities) for (const p of world.polities.values()) {
    if (p.endedStep >= 0) lifes.push(p.endedStep - p.foundedStep);
    else aliveAges.push(world.step - p.foundedStep);
  }
  lifes.sort((a, b) => a - b);
  if (lifes.length >= 8) {
    const med = lifes[lifes.length >> 1], max = lifes[lifes.length - 1];
    const Y = 0.25;   // dyn-clock years per step (calendar.js DYN_RATE)
    score("fallen-polity lifespan median", `${med} steps (~${Math.round(med * Y)}y)`, med * Y >= 50 && med * Y <= 2000, false, `${lifes.length} fallen`);
    const oldestAlive = aliveAges.length ? Math.max(...aliveAges) : 0;
    const tail = Math.max(max, oldestAlive) / Math.max(1, med);
    score("lifespan heavy tail incl. living (max/median)", tail.toFixed(1), tail >= 3, false, `oldest living ${oldestAlive} steps`);
  } else score("polity lifespans", "n/a", false, false, `${lifes.length} fallen polities`);
}

// ── 4. Wars: rate + human causes ──
{
  const wars = (world.events || []).filter(e => e.type === "war.began");
  const per1k = wars.length / (STEPS / 1000);
  // Normalize by how many states exist to fight: 30 wars/1000 steps is
  // peaceful for a 200-state world and hyper-belligerent for 5 states.
  // The old absolute band (1..400) could not tell those apart.
  const nPol = Math.max(1, st.countries);
  const perPolity = per1k / nPol;
  score("wars per 1000 steps per polity", perPolity.toFixed(2), perPolity > 0.05 && perPolity < 20, false, `${per1k.toFixed(1)}/1k across ${nPol} realms`);
  const crisis = wars.filter(w => w.crisis).length;
  const faith = wars.filter(w => w.faithClash).length;
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
  // With the province model (DISSOLVE), a settlement's people = urban core +
  // rural countryside, so "urban" is the sum of urban cores. Falls back to the
  // tier>=2 measure for the old farming-region model.
  const hasRural = setts.some(s => (s._ruralPop || 0) > 0);
  let urban = 0, total = 0;
  for (const s of setts) { total += s.people; urban += hasRural ? (s._urbanPop || 0) : ((s.tier | 0) >= 2 ? s.people : 0); }
  const pct = total > 0 ? (urban / total) * 100 : 0;
  // Condition the band on the run's OWN development (never on the step
  // count): agrarian eras held urban shares under ~25%; industrial societies
  // legitimately exceed the old 65% cap. A 60%-urban bronze age is exactly
  // the anachronism this suite exists to catch — the flat band passed it.
  let leadingEra = 0;
  const { techState } = await import("../src/sim/peopleSim/tech.js");
  if (world.countries) for (const c of world.countries.values()) {
    const k = c.capital && c.capital.knowledge;
    if (k) { const e = techState(k).era; if (e > leadingEra) leadingEra = e; }
  }
  const industrial = leadingEra >= 5;
  const okBand = industrial ? (pct >= 10 && pct <= 80) : (pct >= 2 && pct <= 25);
  score("urbanization vs development", pct.toFixed(1) + "%", okBand, false, industrial ? "industrial era: 10-80%" : "agrarian era: a minority in cities (2-25%)");
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

// Soft-warning BUDGET is itself a hard gate: with every shape gate soft, the
// suite could not fail on shape at all — a run could warn on all seven axes
// and still exit 0. Tolerate normal statistical wobble (2), fail beyond it.
const SOFT_BUDGET = 2;
if (soft > SOFT_BUDGET) {
  console.log(`\n[stylized] ${hard} hard failure(s) · ${soft} soft warnings EXCEEDS budget ${SOFT_BUDGET} — the emergent history is off-shape`);
  process.exit(1);
}
console.log(hard ? `\n[stylized] ${hard} HARD failure(s), ${soft} soft warning(s)` : `\n[stylized] all hard gates passed · ${soft} soft warning(s) (budget ${SOFT_BUDGET})`);
process.exit(hard ? 1 : 0);
