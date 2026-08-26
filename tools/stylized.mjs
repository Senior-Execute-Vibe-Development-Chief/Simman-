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
import { T } from "../src/sim/peopleSim/tuning.js";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { TECHS, techState } from "../src/sim/peopleSim/tech.js";
import { TIER_CORE } from "../src/sim/peopleSim/settlement.js";

const SEED = +(process.argv[2] || 8817);
// Default horizon 21000 (was 15000): the chronology repacing (SCI_COMPOUND flip)
// moved the world's development milestones to later TICK counts — at 15k the
// repaced world is mid-Bronze, so era-dependent facts were being judged in a
// world that hadn't reached them. This is world-state reasoning, not a time
// gate — the suite judges the same HISTORY, which now takes more ticks to
// happen. (A 2026-07 note here claimed "23-33 cities at 21k": that count
// predates the cities-only register and the honest-domain corrections — the
// 2026-08 re-baseline measured 17-22 cities >10k urban core on the canon
// seeds, the right order for the late-Bronze world 21k now reaches.)
const STEPS = +(process.argv[3] || 21000);
const W = +(process.argv[4] || 480), H = W >> 1;

// Multi-seed mode: STYLIZED_SEEDS="8817,4242,777" runs the whole suite once
// per seed (child processes) and FAILS only if a majority of seeds fail —
// bands stop being implicitly fitted to one world. Single-seed remains the
// CI default (cost); the deep manual run uses three.
if (process.env.STYLIZED_SEEDS && !process.env._STYLIZED_CHILD) {
  const { spawnSync } = await import("node:child_process");
  const seeds = process.env.STYLIZED_SEEDS.split(",").map(Number).filter(Number.isFinite);
  let fails = 0;
  for (const sd of seeds) {
    console.log(`\n────────── seed ${sd} ──────────`);
    const r = spawnSync(process.execPath, [process.argv[1], String(sd), String(STEPS), String(W)],
      { stdio: "inherit", env: { ...process.env, _STYLIZED_CHILD: "1" } });
    if (r.status !== 0) fails++;
  }
  console.log(`\n[stylized] multi-seed: ${seeds.length - fails}/${seeds.length} seeds passed`);
  process.exit(fails * 2 > seeds.length ? 1 : 0);
}

let hard = 0, soft = 0;
// STYLIZED_DUMP=1 prints each contested gate's UNDERLYING DISTRIBUTION so a
// re-baselining decision can be made from the data rather than the verdict
// (2026-08 re-baselining wave). Zero effect on normal runs.
const DUMP = !!process.env.STYLIZED_DUMP;
function score(name, value, ok, hardFail = false, detail = "") {
  const tag = ok ? "ok  " : hardFail ? "FAIL" : "warn";
  if (!ok) { if (hardFail) hard++; else soft++; }
  console.log(`  ${tag}  ${name}: ${value}${detail ? `   (${detail})` : ""}`);
}

console.log(`[stylized] seed ${SEED} · ${W}x${H} · ${STEPS} steps`);
const world = buildSim({ W, H, seed: SEED });
// Optional experimental-lever overrides (default runs unaffected — env unset = no-op),
// so the stylized suite can measure a lever's on-trajectory ahead of a default flip.
for (const k of ["CROSS_REALM_HEIRS", "CLAIMANT_WARS", "CLAIM_POWER_WIN", "ADOPT_ADMIN", "ADOPT_ADMIN_DELAY", "CREDIT_RATE", "CREDIT_MAX_MULT", "CAP_MODEL", "CAP_FISC", "CAP_LOG", "RES_INVARIANT_POP"]) if (process.env[k] != null) { T[k] = +process.env[k]; console.log(`[stylized]   lever ${k}=${T[k]}`); }
const t0 = performance.now();
// Step in windows, sampling the aggregates the SHAPE gates need (development
// vs population, price dispersion vs integration, culture count vs area).
// Every axis is emergent state — a slow world traces the same curves later.
const samples = [];
const SAMPLE_N = 30;
const win = Math.max(1, Math.round(STEPS / SAMPLE_N));
for (let t = 0; t < STEPS; t += win) {
  stepPeopleSim(world, Math.min(win, STEPS - t));
  let leadAgri = 0, pop = 0, area = 0, wealth = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    pop += s.people; wealth += s.wealth || 0;
    if (s.knowledge && (s.knowledge.agriculture || 0) > leadAgri) leadAgri = s.knowledge.agriculture;
  }
  const co = world._countryOwner, elev = world.elev;
  const tilesBy = new Map();   // per-realm claimed tiles → the top-3 snapshot (empire-mortality gate)
  if (co && elev) for (let i = 0; i < co.length; i++) if (elev[i] > 0 && co[i] >= 0) { area++; tilesBy.set(co[i], (tilesBy.get(co[i]) || 0) + 1); }
  const top3 = [...tilesBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
  // trade intensity + component count + price dispersion (post-baseline)
  let flow = 0;
  if (world._linkMoney) for (const v of world._linkMoney.values()) flow += Math.abs(v);
  const roots = new Set();
  if (world._networkComponents) for (const r of world._networkComponents.values()) roots.add(r);
  // Price dispersion, POPULATION-WEIGHTED by component membership. Unweighted
  // dispersion across component PRICES measures the disconnected FRAGMENTS with
  // equal voice: integration then reads as widening — merging two mid-priced
  // cores removes a central value, and newly-connected peripheries enter the
  // frame at divergent prices — even while nearly everyone comes to live in one
  // price world. The integration claim is about people's prices, so each
  // component weighs as the settlements living under it.
  let pDisp = -1;
  if (world._inflRef !== undefined && world._inflP && world._inflP.size >= 2 && world._networkComponents) {
    const w = new Map();   // component root → PEOPLE under that price (population-weighted, matching the claim above — was settlement COUNT, which let 20 villages outvote 2 cities)
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const r = world._networkComponents.has(s.id) ? world._networkComponents.get(s.id) : s.id;
      w.set(r, (w.get(r) || 0) + (s.people || 0));
    }
    let W = 0, mean = 0;
    for (const [root, p] of world._inflP) { const n = w.get(root) || 1; W += n; mean += p * n; }
    if (W > 0) {
      mean /= W;
      let mad = 0;
      for (const [root, p] of world._inflP) mad += Math.abs(p - mean) * (w.get(root) || 1);
      pDisp = mad / W;
    }
  }
  samples.push({ step: world.step, leadAgri, pop, area, wealth, flow, comps: roots.size, pDisp,
    cultures: world.cultures ? world.cultures.size : 0, top3 });
}
console.log(`[stylized] simulated in ${((performance.now() - t0) / 1000).toFixed(0)}s\n`);
const pearson = (xs, ys) => {
  const n = xs.length; if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx2 += (xs[i] - mx) ** 2; dy2 += (ys[i] - my) ** 2; }
  return num / Math.sqrt(dx2 * dy2 || 1);
};

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
  const cores = setts.map(s => (hasRural ? (s._urbanPop || 0) : s.people)).sort((a, b) => b - a);
  // RE-BASELINE (2026-08): rank CITIES at the register's OWN city bar —
  // TIER_CORE[2] (10k urban core), the sim's definition of a city — not the
  // old >50 (a METROPOLIS count: 50k). The 50k floor was calibrated before
  // the cities-only register and the honest-domain corrections; at 21k the
  // world is late-Bronze (leadAgri ≈ 0.70) and its city system measures
  // historically RIGHT at that bar (canon seeds: top city 80-122k, 12-14
  // cities >20k, 17-22 >10k — real ~1500 BCE Earth held a handful >40k and
  // ~20 >10k), while >50k metropolises are 4-5 — exactly the sparse
  // handful antiquity had. Demanding 15 of them asked a Bronze world for an
  // early-modern skyline (probe record: docs/state-birth-2026-08.md).
  const sizes = cores.filter(p => p > TIER_CORE[2]);
  if (DUMP) {
    const gt = (b) => cores.filter(p => p > b).length;
    const lead = samples.length ? samples[samples.length - 1].leadAgri : 0;
    console.log(`        [dump zipf] cores >50:${gt(50)} >20:${gt(20)} >10:${gt(10)} of ${cores.length} · top: ${cores.slice(0, 10).map(v => v.toFixed(0)).join(" ")} · leadAgri ${lead.toFixed(2)}`);
  }
  const n = Math.min(sizes.length, 80);
  if (n >= 15) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.log(i + 1 - 0.5), y = Math.log(sizes[i]);
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    // SPAN_TECH re-baseline (owner decision, 2026-07): the earned-span world's
    // antiquity concentrates LATER — small early realms flatten the 21k city
    // hierarchy (measured −0.52..−0.58 on 3 seeds at the flip) — so the soft
    // floor admits sparse-antiquity slopes; the mature −0.8..−1.2 empirical
    // band still bounds the steep side and deep-run reports.
    score("Zipf rank-size slope (urban cores, G-I)", slope.toFixed(2), slope < -0.45 && slope > -1.35, false, `${n} cities; mature empirical envelope ≈ −0.8..−1.2; earned-span antiquity shallower (owner-accepted 2026-07)`);
  } else {
    // STABILITY RE-BASELINE (2026-08-25, the harvest-years wave — the chain's
    // named revisit of churn-era soft bands): a small-but-alive register (777's
    // marginal world holds 10 cities over the bar, up from DEAD under the flat
    // lean law) cannot fit a slope — that is an ABSTENTION, not off-shape
    // history, and aliveness is the hard gates' business. A register below 8
    // (half the fit minimum) still warns: that small likely means something
    // the hard floors missed.
    score("Zipf rank-size slope", "n/a", sizes.length >= 8, false, `only ${sizes.length} cities > ${TIER_CORE[2]}k urban core${sizes.length >= 8 ? " — register real, slope unfittable" : ""}`);
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
    // ABSOLUTE realm AREA, in km² — the axis every share/ratio gate above is blind
    // to. Both are scale-free: a world whose biggest empire is Romania passes the
    // share gate (10%) and the tail gate (5×) exactly as a world whose biggest is
    // Rome. That blindness is how RURAL_BIND_DENS shipped six times too high and
    // was caught in PLAY, not here (owner report 2026-07-29; docs/design-c-
    // territory-fill.md). Reported UNSCORED: the honest target is era-dependent
    // (a Bronze hegemon ~0.5–1M km², a classical empire ~2–6M, and the run's era
    // is emergent, never a step count), so a scored band needs per-era derivation
    // — recorded as the follow-up. Printing it means the next regression is seen.
    const landTiles = (() => { let n = 0; for (let i = 0; i < co.length; i++) if (elev[i] > 0) n++; return n; })();
    const kkm2 = landTiles > 0 ? (510e6 * 0.29) / landTiles / 1000 : 0;   // ~thousand km² per land tile
    console.log(`        (realm AREA, unscored: largest ${Math.round(areas[0] * kkm2)}k km² · median ${Math.round(med * kkm2)}k km² · reference: Bronze hegemon ~0.5-1M, Rome ~5M, Han ~6.5M)`);
  } else score("empire land tail", "n/a", false, false, `${areas.length} landed polities`);
}

// ── 2b. Empire MORTALITY — reported, deliberately NOT scored ──
// Every distributional gate above (share %, tail ratio, Zipf) passes a world whose
// top realms are IMMORTAL — a frozen leaderboard of two eternal giants has a fine
// heavy tail at every instant. The immortal-empire regression
// (docs/country-count-size-diagnosis.md) survived every validation run exactly this
// way; worse, it only freezes the leaderboard from ~step 16k, PAST this suite's 15k
// horizon. Why there is no scored gate here (measured, so the next session doesn't
// re-attempt it blind): at 15k the churn signal cannot separate a broken build
// (top-3 union 9 vs 12, same seed — noise); at 24k it separates weakly (7 vs 10)
// but every OTHER band here is calibrated at 15k and reads modern-era worlds as
// off-shape (tech gradients legitimately flatten at modernity), so simply running
// the suite longer produces false warnings. Any scalar bar fitted to those two
// runs would be outcome-fitting applied to a test. The real instrument is
// tools/probe_empires.mjs (24k-step anatomy: top-realm ages, capacity vs load,
// war/absorb acquisition flows — the frozen regime reads two realms with
// age == run length holding capacity ≫ load at every checkpoint). Here we PRINT
// the numbers so a human eye catches a freeze in any deep manual run.
{
  const back = samples.filter(s => s.step > STEPS / 2 && s.top3 && s.top3.length);
  const union = new Set();
  for (const s of back) for (const c of s.top3) union.add(c);
  let seceded = 0;
  for (const ev of world.events || []) if (ev.type === "polity.seceded") seceded++;
  console.log(`        (empire mortality, unscored: back-half top-3 union ${union.size} realms · ${seceded} secessions — deep check: node tools/probe_empires.mjs)`);
}

// ── 3. Polity lifespans — censoring-aware ──
// Bounds are in mechanic-clock years (0.25 y/step), anchored to history:
// a median fallen-state lifetime of ~50–2000 years (city-states churn in
// decades; dynastic states last centuries) — NOT coupled to the argv step
// count as before (the old STEPS/2 bound loosened with the run length).
// The heavy tail counts the still-ALIVE old realms too: the Rome-shaped
// long-livers usually haven't died by the end of the run, and ignoring the
// censored sample was exactly why this gate under-read the tail.
// LIVES are reconstructed from the APPEND-ONLY event log, not a registry
// endedStep scan: a restoration RE-OPENS the record (endedStep back to −1), so
// the scan retroactively erased every death that was later undone — in a
// restoration-rich regime the gate starved below its own sample minimum and
// read n/a while realms demonstrably fell (long-run report W2). Each life is a
// birth (polity.founded / polity.restored / polity.seceded — secession logs
// seceded INSTEAD of founded for its silently-registered state) closed by the
// next polity.ended: a fall-then-restoration counts as one COMPLETED fall,
// and the restored realm's current life is censored at its restoration, not
// its ancient founding. Bands unchanged — only the input series is honest now.
{
  const lifes = [];
  const aliveAges = [];
  {
    const openBirth = new Map();   // polity id → birth step of the currently-open life
    for (const ev of world.events || []) {
      if (ev.type === "polity.founded" || ev.type === "polity.restored" || ev.type === "polity.seceded") {
        if (!openBirth.has(ev.polity)) openBirth.set(ev.polity, ev.step);
      } else if (ev.type === "polity.ended") {
        let b = openBirth.get(ev.polity);
        if (b === undefined) {   // silently-registered record (no birth event): fall back to its registry foundedStep
          const p = world.polities && world.polities.get(ev.polity);
          b = p ? p.foundedStep : ev.step;
        }
        lifes.push(ev.step - b);
        openBirth.delete(ev.polity);
      }
    }
    // The censored sample: every still-living realm's CURRENT life age.
    if (world.polities) for (const p of world.polities.values()) {
      if (p.endedStep < 0) aliveAges.push(world.step - (openBirth.get(p.id) ?? p.foundedStep));
    }
  }
  lifes.sort((a, b) => a - b);
  if (DUMP && lifes.length) {
    const q = (p) => lifes[Math.min(lifes.length - 1, Math.floor(p * lifes.length))];
    aliveAges.sort((a, b) => a - b);
    const aq = aliveAges.length ? aliveAges[aliveAges.length >> 1] : 0;
    console.log(`        [dump lifespan] fallen ${lifes.length} · p10/25/50/75/90: ${q(0.1)}/${q(0.25)}/${q(0.5)}/${q(0.75)}/${q(0.9)} steps · <100: ${lifes.filter(l => l < 100).length} · ≥1000: ${lifes.filter(l => l >= 1000).length} · alive n ${aliveAges.length} p50 ${aq} max ${aliveAges.length ? aliveAges[aliveAges.length - 1] : 0}`);
  }
  // Scoring minimum 5 (was 8): against a 40×-wide band a small-sample median is
  // still meaningful, and a LOW-CHURN world is the same censoring class the tail
  // check below already treats as neutral — capitulation (vassalage preserving
  // beaten courts) legitimately halves polity deaths, and that longevity must not
  // read as "off-shape" when the deaths that DID happen have historical lifetimes.
  // Below 5 the n/a still warns: a near-deathless map remains suspicious.
  if (lifes.length >= 5) {
    const med = lifes[lifes.length >> 1], max = lifes[lifes.length - 1];
    const Y = 0.25;   // dyn-clock years per step (calendar.js DYN_RATE)
    // RE-BASELINE (2026-08): score the WHOLE state population, not the fallen
    // alone. The fallen register is bimodal (canon seeds: p25 = 13 steps —
    // failed secessions/revolts recorded as polities — against living realms
    // whose median age is 8,300+ steps), and a fallen-only median measures
    // the revolt mode: historical fallen-state datasets exclude failed
    // revolts, so the old bar compared unlike registers. Include the living
    // as right-censored lifetimes (their CURRENT age understates their true
    // span — conservative, the standard survival-analysis posture). The
    // 2000y ceiling still catches an immortal-map-painter world (its union
    // median rides to the run length). The churn mode is printed unscored:
    // it is the standing successor-churn mechanism item, not this claim.
    const allLives = lifes.concat(aliveAges).sort((a, b) => a - b);
    const medAll = allLives[allLives.length >> 1];
    score("state lifespan median (incl. living, censored)", `${medAll} steps (~${Math.round(medAll * Y)}y)`, medAll * Y >= 50 && medAll * Y <= 2000, false, `${lifes.length} fallen + ${aliveAges.length} living`);
    console.log(`        (fallen-only median ${med} steps ~${Math.round(med * Y)}y; ${lifes.filter(l => l < 100).length}/${lifes.length} fallen within 100 steps — the revolt-churn mode, mechanism item)`);
    const oldestAlive = aliveAges.length ? Math.max(...aliveAges) : 0;
    const tail = Math.max(max, oldestAlive) / Math.max(1, med);
    // RIGHT-CENSORING: no lifespan can exceed the run itself, so when the median
    // fallen lifespan is high the max/median ratio is bounded below the pass line
    // for ANY true tail shape (a realm alive since step 0 still couldn't reach 3×).
    // Long-lived realms are an improvement, not a shape failure — score n/a when
    // the horizon cannot express the statistic, instead of warning on the ceiling.
    if (world.step / Math.max(1, med) < 3)
      score("lifespan heavy tail", "n/a", true, false, `horizon-censored: median ${med} vs run ${world.step} — tail unobservable`);
    else
      score("lifespan heavy tail incl. living (max/median)", tail.toFixed(1), tail >= 3, false, `oldest living ${oldestAlive} steps`);
  } else {
    // STABILITY RE-BASELINE (2026-08-25): the "below 5 still warns" rule
    // encoded a churn-era suspicion — an n/a once hid a broken death RECORD
    // while realms demonstrably fell (the W2 scar above). The distinguisher is
    // whether the record is live: ≥1 fallen polity proves deaths are recorded,
    // and a stable world thereafter is the achievement, not the anomaly (the
    // per-basin lean law's whole point). ZERO fallen keeps the warning — a
    // truly deathless map is either a broken record or genuinely suspicious.
    score("polity lifespans", "n/a", lifes.length >= 1, false, `${lifes.length} fallen polities${lifes.length >= 1 ? " — record live, sample too small to score" : ""}`);
  }
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
// "Cradles" = the OLDEST root cultures — the genesis hearths where civilization
// actually started — not every parentless culture: frontier ethnogenesis mints
// 25-29 scattered roots whose nearest-distance field is flat noise and drowned
// the real gradient (measured: r vs ALL roots wanders −0.28..+0.45 by seed; vs
// the oldest three it reads −0.42..−0.68 on every canon seed at 21k). Map-
// agnostic: on any world the earliest roots are the first civilizations.
{
  const roots = [];
  if (world.cultures) for (const c of world.cultures.values()) {
    if (c.parentCultureId < 0) {
      const o = world._byId && world._byId.get(c.originSettlementId);
      if (o) roots.push({ pos: o.pos, born: c.foundedStep ?? 0 });
    }
  }
  roots.sort((a, b) => a.born - b.born);
  // RE-BASELINE (2026-08): the cradles are the DAWN COHORT — every root
  // culture born at the world's first founding step — not "the oldest 3".
  // The mature harness seats ~10 hearths and their init cultures all carry
  // foundedStep 0, so "oldest 3" was three ARBITRARY members (map-insertion
  // order) of a 10-source knowledge system: seed 4242 read r = +0.76
  // "inverted" because its leading region sat at one of the seven unsampled
  // hearths (~d50-60 from the sampled three). Distance-to-nearest must see
  // every source knowledge actually flows from. Later ethnogenesis roots
  // stay excluded — including them was measured as flat noise (2026-07 note
  // above).
  const dawnBorn = roots.length ? roots[0].born : 0;
  const cradles = roots.filter((r) => r.born === dawnBorn).map((r) => r.pos);
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
    if (DUMP) {
      const idx = ys.map((v, i) => i).sort((a, b) => ys[b] - ys[a]).slice(0, 8);
      console.log(`        [dump cradle] cradles: ${roots.slice(0, 3).map(rr => `(${rr.pos.x | 0},${rr.pos.y | 0})@${rr.born}`).join(" ")} · top org: ${idx.map(i => `${ys[i].toFixed(2)}@d${xs[i].toFixed(0)}`).join(" ")}`);
      const ord = xs.map((v, i) => i).sort((a, b) => xs[a] - xs[b]);
      const third = Math.max(1, Math.floor(n / 3));
      const mo = (ii) => ii.reduce((a, i) => a + ys[i], 0) / ii.length;
      console.log(`        [dump cradle] n ${n} · near-third mean org ${mo(ord.slice(0, third)).toFixed(2)} · far-third ${mo(ord.slice(-third)).toFixed(2)}`);
    }
    // SPAN_TECH re-baseline (owner decision, 2026-07): with the span earned,
    // early tech leadership is DISTRIBUTED (many small realms, diffusion fast
    // relative to realm size), so the outward-decay gradient is weak at 21k
    // (measured −0.05..+0.12 at the flip); the gate now flags only a clearly
    // INVERTED gradient (frontier leading the cradles).
    score("tech ~ cradle-distance correlation", r.toFixed(2), r < 0.2, false, "knowledge should not lead OUTWARD (earned-span re-baseline 2026-07)");
  } else {
    // STABILITY RE-BASELINE (2026-08-25): "no cradle origins resolvable"
    // usually means the dawn cohort's origin SETTLEMENTS have died (their ids
    // no longer resolve) on a small harsh world — history, not a recording
    // pathology. The distinguisher: root CULTURES existing at all proves the
    // dawn happened; zero root cultures keeps the warning (genesis never ran).
    let roots0 = 0;
    if (world.cultures) for (const c of world.cultures.values()) if (c.parentCultureId < 0) roots0++;
    score("tech diffusion gradient", "n/a", roots0 > 0, false, `no cradle origins resolvable (${roots0} root cultures${roots0 > 0 ? " — origins died; dawn demonstrably ran" : ""})`);
  }
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

// ── 7. Population tracks development (D47) ──
{
  const xs = samples.map(s => s.leadAgri), ys = samples.map(s => Math.log(Math.max(1, s.pop)));
  const r = pearson(xs, ys);
  // growth accelerates with development: mean per-window growth in the top
  // third of the run's own development range vs the bottom third
  const lo = [], hi = [];
  const aMin = Math.min(...xs), aMax = Math.max(...xs), span = Math.max(1e-6, aMax - aMin);
  for (let i = 1; i < samples.length; i++) {
    const g = Math.log(Math.max(1, samples[i].pop)) - Math.log(Math.max(1, samples[i - 1].pop));
    const band = (xs[i] - aMin) / span;
    if (band < 0.33) lo.push(g); else if (band > 0.67) hi.push(g);
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y) / a.length : 0);
  score("population ~ development (monotone)", r.toFixed(2), r > 0.7, false, "log-pop vs leading agriculture");
  // The acceleration claim is about the MODERN escape from the Malthusian ceiling
  // (mechanized farming / the green revolution) — a chapter a run may simply not
  // reach at this grid/horizon (validate runs top out ~Medieval; the modern-ag
  // techs never unlock). Scoring it there compared the world-FILLING boom (compound
  // growth off three tiny cradles — the bottom development band) against the filled
  // pre-modern plateau, and "failed" every run for lacking a regime it never
  // entered. Gate on the WORLD STATE: score only when someone has actually
  // discovered modern agriculture; otherwise the chapter is absent, not off-shape.
  if (lo.length >= 3 && hi.length >= 3) {
    const modIdx = TECHS.findIndex((t) => t.id === "mechanized_farm"), grIdx = TECHS.findIndex((t) => t.id === "green_revolution");
    let modernAg = false;
    for (const s of world.settlements) {
      if (s.mode !== "settled" || !s.knowledge) continue;
      const have = techState(s.knowledge).have;
      if (have[modIdx] || have[grIdx]) { modernAg = true; break; }
    }
    if (!modernAg)
      score("growth accelerates with development", "n/a", true, false, "pre-industrial run: modern agriculture never discovered — the accelerating chapter is absent");
    else
      score("growth accelerates with development", `${(mean(hi) * 100).toFixed(1)}% vs ${(mean(lo) * 100).toFixed(1)}%/window`, mean(hi) >= mean(lo) * 0.8, false, "Malthusian flat → developed growth");
  }
}

// ── 8. Prices: bounded level, integration reduces dispersion (D48) ──
{
  const post = samples.filter(s => s.pDisp >= 0);
  if (post.length >= 5 && world._inflRaw && world._inflRaw.size) {
    // Read the UNCAPPED raw indicator (_inflRaw, band 0.2..20), NOT the sim-facing
    // _inflP: inflation.js clamps _inflP to [0.4,3.0], so a [0.4,3.0] band on it IS
    // that clamp — the gate could never fail (a hyperinflating world pegs every
    // component at 3.0 and still passes). raw = M/T ÷ the emergent baseline, so a
    // healthy closed-money world sits near 1; weight by the PEOPLE living under each
    // component's prices. The band trips only on genuine runaway (toward the 20x cap
    // or collapse toward 0.2), not on the historically-real Spanish-silver drift.
    let num = 0, den = 0;
    for (const s of setts) {
      const root = world._networkComponents && world._networkComponents.has(s.id) ? world._networkComponents.get(s.id) : s.id;
      const r = world._inflRaw.get(root); if (r == null) continue;
      num += r * (s.people || 0); den += s.people || 0;
    }
    const meanP = den > 0 ? num / den : 1;
    const capMean = (() => { const v = [...world._inflP.values()]; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 1; })();
    const pegged = [...world._inflP.values()].filter(p => p >= 2.99).length;
    score("price level bounded", meanP.toFixed(2), meanP >= 0.35 && meanP <= 8, false, `people-weighted raw M/T÷baseline (sim-clamped mean ${capMean.toFixed(2)}, ${pegged} components pegged at cap)`);
    // DETRENDED: raw levels confound the integration effect with the development
    // trend — components fall over the run while staggered MONETIZATION widens
    // cross-region dispersion (entrepôts monetize centuries before the periphery;
    // the three-speed price world is historically right, see docs W6-E), so the
    // level-Pearson reads strongly negative on every healthy run. The mechanism
    // claim is about CHANGES: when the network actually knits (components drop),
    // dispersion should not systematically widen in that same window. First
    // differences remove the shared epoch trend and test exactly that.
    const dC = [], dP = [];
    for (let i = 1; i < post.length; i++) { dC.push(post[i].comps - post[i - 1].comps); dP.push(post[i].pDisp - post[i - 1].pDisp); }
    // The CLAIM is directional and about DROP windows only: "when the network
    // knits, dispersion must not systematically widen." The old score (Pearson
    // over ALL window diffs, bar −0.2) also judged component-RISE windows — a
    // frontier city founding a NEW trade node during the healthy narrowing
    // trend read as anti-integration and sign-flipped the whole score at the
    // small n this late-locking baseline leaves. Measured 2026-08-06 (seed
    // 8817): dispersion narrowing monotonically 0.162→0.119 — the exact shape
    // this gate exists to demand — while the Pearson read −0.40 on five diff
    // points; the pre-granary world "passed" only because its baseline locked
    // one window later and the n≥5 arming check silently skipped the gate.
    // tools/probe_market.mjs prints this series with the drivers alongside.
    // So score the sentence itself: over knit windows (dC<0), the mean
    // dispersion change must not exceed the series' own per-window noise
    // scale (median |dP| — self-normalizing, no fitted constant): "knitting
    // widens spread more than a typical window moves" is the failure.
    const knit = dP.filter((_, i) => dC[i] < 0);
    const absSorted = dP.map(Math.abs).sort((a, b) => a - b);
    const noise = absSorted.length ? absSorted[absSorted.length >> 1] : 0;
    const r = pearson(dC, dP);
    if (knit.length) {
      const widen = knit.reduce((a, b) => a + b, 0) / knit.length;
      score("market integration narrows prices (Δ)", `${widen >= 0 ? "+" : ""}${widen.toFixed(4)} over ${knit.length} knit window(s)`,
        widen <= noise, false,
        `mean dispersion Δ where components drop, vs noise floor ${noise.toFixed(4)} = median |Δ| (Pearson ${r.toFixed(2)}, unscored — probe_market.mjs)`);
    } else score("market integration narrows prices (Δ)", "n/a", true, false,
      `no component-drop window in the sampled span (Pearson ${r.toFixed(2)}, unscored)`);
  } else score("price gates", "n/a", true, false, "baseline not locked long enough");
}

// ── 9. Trade intensity rises with transport tech (D49) ──
{
  const navMob = [];
  for (const s of setts) if (s.knowledge) navMob.push((s.knowledge.navigation || 0) + (s.knowledge.mobility || 0));
  navMob.sort((a, b) => a - b);
  const medT = navMob.length ? navMob[navMob.length >> 1] : 0;
  const last = samples[samples.length - 1];
  const intensity = last.wealth > 0 ? (last.flow * 1000) / last.wealth : 0;
  const band = medT >= 0.8 ? [2, 400] : [0.05, 150];
  score("trade intensity vs transport", intensity.toFixed(1), intensity >= band[0] && intensity <= band[1], false,
    `flow×1000/wealth; median nav+mob ${medT.toFixed(2)} → band ${band[0]}-${band[1]}`);
}

// ── 10. War deadliness is heavy-tailed (D50, Richardson) ──
{
  const ended = (world.events || []).filter(e => e.type === "war.ended" && e.dead > 0).map(e => e.dead).sort((a, b) => b - a);
  if (DUMP && ended.length) {
    const medD = ended[ended.length >> 1];
    const t3 = ended.slice(0, 3);
    console.log(`        [dump war] n ${ended.length} · top: ${ended.slice(0, 8).map(d => d.toFixed(0)).join(" ")} · med ${medD.toFixed(0)} · top3mean/med ${(t3.reduce((a, b) => a + b, 0) / t3.length / Math.max(1, medD)).toFixed(1)}`);
  }
  if (ended.length >= 8) {
    const med = ended[ended.length >> 1];
    const share = ended[0] / ended.reduce((a, b) => a + b);
    // (Bar kept at ≥5 through the 2026-08 re-baseline: even passing canon
    // seeds read 6.5-10.2 where Richardson's record runs 10-40× — the tail
    // is genuinely thin-ish everywhere, a REAL mechanism pointer (no
    // great-war cascades: coalitions, alliance chains), not a stale bar.
    // top3mean/med rides in the detail so the knife-edge single-draw
    // nature of max/median stays visible next to the verdict.)
    const t3m = ended.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, ended.length);
    score("war deadliness tail (largest/median)", (ended[0] / Math.max(1, med)).toFixed(1), ended[0] / Math.max(1, med) >= 5, false, `${ended.length} wars reckoned; top3mean/med ${(t3m / Math.max(1, med)).toFixed(1)}`);
    // The greatest war's SHARE of all war dead is count-sensitive — with n wars
    // from the same heavy tail, the maximum's share falls as n grows, and the
    // post-treaty-reform world reckons 44-144 wars where the 10% floor was
    // calibrated on ~20-40 (measured: shares 4-11% while the ratio above reads
    // 8.6-39.7 — the tail is emphatically heavy). One fact, one scored statistic:
    // the count-invariant ratio above. The share stays as context.
    console.log(`        (greatest war's share of all war dead: ${(share * 100).toFixed(0)}% across ${ended.length} wars — count-sensitive, unscored)`);
  } else score("war deadliness", "n/a", true, false, `${ended.length} reckoned wars (need 8)`);
}

// ── 11. Culture count scales sublinearly with settled area (D51) ──
{
  const grow = samples.filter(s => s.area > 0 && s.cultures > 1);
  if (grow.length >= 8) {
    const slope = (() => {
      const xs = grow.map(s => Math.log(s.area)), ys = grow.map(s => Math.log(s.cultures));
      const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
      return den > 0 ? num / den : 0;
    })();
    // Band tightened 1.3 → 1.05: the old upper bound admitted k∈[1,1.3) — superlinear,
    // contradicting the "k<1" claim it prints. Measured slope 0.53–0.83 across the three
    // canon seeds (21k), so 1.05 enforces sublinearity with margin. (Caveat: this fits a
    // TEMPORAL accumulation as area fills, a proxy for the cross-sectional area law; the
    // band change fixes the superlinear-admittance, not that deeper proxy nuance.)
    score("culture count ~ area^k, k<1", slope.toFixed(2), slope > 0 && slope < 1.05, false, "diversity grows with territory, sublinearly (k<1)");
  } else score("culture scaling", "n/a", true, false, "not enough growth samples");
}

// ── 12. Settlements cluster on water (D52) ──
// The FACT is siting: pre-modern settlement hugged rivers and coasts. The old
// NN-distance CV instrument kept losing discriminative power — the founding
// spacing floor mechanically regularizes nearest-neighbour distances, so its
// line has been recalibrated with every spacing change (0.45 → 0.40 → measured
// 0.29-0.44 now, STRADDLING its own uniform reference ~0.3; a metric whose
// pass-band must chase the mechanics measures the mechanics, not the fact).
// Score the siting DIRECTLY against a spatial null: the share of settlements
// with water access vs the share of LAND TILES that are river/coast. Uniform-
// random siting = enrichment 1.0; measured worlds sit at 1.70 ± 0.02 across all
// canon seeds AND horizons (100% of settlements on water vs a 58-59% null), so
// 1.3 separates cleanly. The CV stays printed as unscored context.
{
  const pts = setts.map(s => s.pos);
  if (pts.length >= 25) {
    const dists = [];
    for (const a of pts) {
      let best = Infinity;
      for (const b of pts) {
        if (a === b) continue;
        let dx = Math.abs(a.x - b.x); if (dx > world.tw / 2) dx = world.tw - dx;
        const d = dx * dx + (a.y - b.y) ** 2;
        if (d < best) best = d;
      }
      dists.push(Math.sqrt(best));
    }
    const mean = dists.reduce((a, b) => a + b) / dists.length;
    const sd = Math.sqrt(dists.reduce((a, b) => a + (b - mean) ** 2, 0) / dists.length);
    const cv = sd / Math.max(1e-6, mean);
    const onWater = setts.filter(s => (s.waterAccess || 0) > 0.05).length;
    let landT = 0, waterT = 0;
    const { tw, th, elev, riverMag } = world;
    for (let ti = 0; ti < tw * th; ti++) {
      if (elev[ti] <= 0) continue;
      landT++;
      let coast = false;
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const ns = [ty * tw + (tx === 0 ? tw - 1 : tx - 1), ty * tw + (tx === tw - 1 ? 0 : tx + 1), ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      for (const ni of ns) if (ni >= 0 && elev[ni] <= 0) { coast = true; break; }
      if (coast || (riverMag && riverMag[ti] >= 1)) waterT++;
    }
    const enrich = (onWater / setts.length) / Math.max(1e-6, waterT / Math.max(1, landT));
    // SAME-FOOTPRINT null (this is the SCORED statistic): the numerator
    // (s.waterAccess) detects water over a 3×3 (computeWaterAccess), so the
    // denominator base-rate must use the SAME detector over every land tile. The
    // old per-tile base-rate was too low and inflated enrichment above 1.0 even for
    // random siting (raw `enrich` reads ~1.70; the honest value is ~1.36, stable
    // across all three canon seeds). A world with NO water preference reads ~1.0
    // under this null; real pre-modern siting reads well above it.
    let sfWater = 0;
    { const coast = world.coast;
      for (let ti = 0; ti < tw * th; ti++) {
        if (elev[ti] <= 0) continue;
        const ty = (ti / tw) | 0, tx = ti - ty * tw;
        let coastBit = 0, bestMag = 0;
        for (let dy = -1; dy <= 1; dy++) { const ny = ty + dy; if (ny < 0 || ny >= th) continue;
          for (let dx = -1; dx <= 1; dx++) { const nx = ((tx + dx) % tw + tw) % tw; const ni = ny * tw + nx;
            if (coast && coast[ni]) coastBit = 1; const m = riverMag ? (riverMag[ni] || 0) : 0; if (m > bestMag) bestMag = m; } }
        if (Math.min(1, coastBit * 0.5 + bestMag * 0.2) > 0.05) sfWater++;
      }
    }
    const enrichSF = (onWater / setts.length) / Math.max(1e-6, sfWater / Math.max(1, landT));
    // Bar 1.15: measured 1.36–1.37 across all three canon seeds (real clustering),
    // with headroom above the ~1.0 a no-preference world would read. Was `enrich >=
    // 1.3` on the footprint-inflated raw metric, which sat below plausible random-
    // siting enrichment — a world with no water preference could pass it.
    score("settlements cluster on water (same-footprint enrichment)", enrichSF.toFixed(2), enrichSF >= 1.15, false,
      `${(onWater / setts.length * 100).toFixed(0)}% on water vs same-footprint null ${(sfWater / Math.max(1, landT) * 100).toFixed(0)}% (raw per-tile null gave ${enrich.toFixed(2)}; NN-CV ${cv.toFixed(2)})`);
  } else score("clustering", "n/a", true, false, "too few settlements");
}

// ── 12b. Food composition ──
// The R5 blind spot: world fish share regressed 6% → 84-92% across default flips
// with every gate green, because nothing watched food composition
// (docs/user-report-diagnosis-2026-07-28.md §2). Real agrarian worlds drew a
// small minority of calories from the water. TIER-B BAND: ≤40% — the recorded
// tier-a-fixes trigger, fired with the Tier-B food wave (land-food maturity via
// works×indCap + fisher labor + depletable stocks,
// docs/design-food-economy-wave.md): land food now matures through the mid-run
// instead of stranding the world on the sea, and the fishery's own labor cost
// and stock depletion bound the catch, so the pre-Tier-B honest-immature high
// tail (up to ~50% on slow-developing seeds, which the interim ≤60% bar
// tolerated) is no longer an excuse the gate must extend. Measured on the wave
// (480×240 seed 8817): 2.1% at 12k, 4.5% at this 21k horizon — vs 68.4% at 12k
// and 45.8% at 21k before the per-fisher catch was re-anchored (fish now GROWS
// with real fishing-port populations, bounded by labor and stocks, instead of
// arriving as a flat windfall — FISH_PER_CAP is the dominant dial and its desc
// carries the sweep). The broken phantom-fish class this gate exists to catch
// reads 84%+.
{
  let fishSum = 0, supplySum = 0, majFishPop = 0, popSum = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const f = s._fishYield || 0, sup = s._foodSupply || 0;
    fishSum += f; supplySum += sup;
    popSum += s.people || 0;
    if (sup > 0 && f / sup > 0.5) majFishPop += s.people || 0;
  }
  const share = supplySum > 0 ? fishSum / supplySum : 0;
  score("fish share of food supply", `${(share * 100).toFixed(1)}%`, share <= 0.40, false,
    `${(majFishPop / Math.max(1, popSum) * 100).toFixed(0)}% of population lives majority-fish [soft bar ≤40% Tier-B]`);
}

// ── 13. Continuity (hard gates) ──
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
