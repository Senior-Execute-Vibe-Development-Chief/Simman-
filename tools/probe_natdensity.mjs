// THE NATIONLESS-CITY HYPOTHESIS (owner, 2026-08-22):
//   "the majority of cities spawn early game, nationless, and then start minting
//    nations of their own accord ... the truly nation sized nations generally come
//    out of areas with low early city density."
//
// Two claims, measured separately, on the arm the owner actually plays:
//
//  A. THE MINT — where do realms come from, and is the city-anchor branch
//     (adoptAndFound: a stateless CITY takes s.countryId = s.id) the dominant
//     source? Tallied from polity.founded's `how` (reconcilePolities registers
//     that branch as "emerged"), plus the standing stateless-city stock and the
//     birth-side split (was a new city born on CLAIMED ground or in the wild?).
//
//  B. THE SIZE LAW — for every realm ever founded, its neighbourhood AT THE
//     MOMENT OF ITS OWN BIRTH (cities within D km; unclaimed share of the land
//     within D km) joined to the territory it ends up holding. If the owner is
//     right, final area falls with birth-neighbourhood city count and rises with
//     free land — i.e. size is decided by WHO GOT THERE FIRST, not by what the
//     ground can carry.
//
// Both readings are per-realm and per-window; nothing is inferred from the
// aggregate. Spearman rank correlation (not Pearson) because area is heavy-tailed.
//
//   node tools/probe_natdensity.mjs [steps] [W] [seed] [window] [radiusKm]
//
// The live app arm (what the owner plays) must be named explicitly:
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,FOUND_DRIFT=1,\
//   ABSORB_ORG_ERA=1,TRIBUTE_UP=0.33,ENGULF=8,FEAR_REACH=1,WAR_FINISH=1,SMALL_WAR=8,\
//   RELIEF_REACH=1,EXCH_WAVE=3,TECH_USE=1,VASSAL_LEVY=0.5,DISSOLVE_CORE=1,\
//   SETT_STRIDE=3,TRADE_STRIDE=5" node tools/probe_natdensity.mjs 20000 480 8817
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 16000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const WIN = +(process.argv[5] || 250);
const RAD_KM = +(process.argv[6] || 600);

const world = buildSim({ W, H, seed: SEED });
const tw = world.tw, th = world.th, N = world.N, elev = world.elev;
let landN = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) landN++;
const KM2_PER_TILE = (510e6 * 0.29) / landN;

// great-circle-ish distance on the equirectangular grid (the convention
// probe_catchment uses): x compresses with latitude, y does not.
const latOf = (y) => ((y + 0.5) / th - 0.5) * Math.PI;   // radians, sign irrelevant (cos)
const KM_X = 40075 / tw, KM_Y = 40075 / 2 / th;
function distKm(x1, y1, x2, y2) {
  let dx = Math.abs(x1 - x2); if (dx > tw / 2) dx = tw - dx;      // the map wraps
  const latM = Math.cos(latOf((y1 + y2) / 2));
  return Math.hypot(dx * KM_X * latM, (y1 - y2) * KM_Y);
}
// tile-radius box that certainly contains RAD_KM at this latitude
const RY = Math.ceil(RAD_KM / KM_Y);

const seenPol = new Map();      // realm id -> birth record
const seenSett = new Set();
const howTally = new Map();     // how -> count
const windows = [];             // per-window aggregates
let evCursor = 0;

// city birth split: born on claimed ground vs in the wild, and what became of each.
// Every mint is born tier 2 (a CITY) and stateless (crystallize mintCityAt), so the
// NEXT adoptAndFound decides between three fates: joined the realm whose field it
// stands on, still stateless, or MINTED ITS OWN REALM. The third on CLAIMED ground
// is a speck born inside somebody's empire — the court refused it (budget/fisc) and
// the city-anchor branch handed it sovereignty.
let bornClaimed = 0, bornWild = 0;
const fate = { claimed: { own: 0, joined: 0, stateless: 0 }, wild: { own: 0, joined: 0, stateless: 0 } };
let pending = [];   // newborns awaiting fate resolution one window later
const claimedAtBirth = new Map();   // settlement id -> was its tile inside a realm's field when it minted?
// A newborn is detected at the END of the window it appeared in, by which time a
// self-founding city ALREADY owns its own tile — reading _countryOwner then would
// score every self-founder as "born inside a realm". So the claim test reads the
// field as it stood at the PREVIOUS window boundary, before this city existed.
let prevCo = null;

function neighbourhoodAt(sx, sy) {
  const co = world._countryOwner;
  let nCity = 0, nStateless = 0, realms = new Set();
  for (const o of world.settlements) {
    if (o.mode !== "settled") continue;
    const ox = o.pos.x | 0, oy = o.pos.y | 0;
    if (Math.abs(oy - sy) > RY) continue;
    if (ox === sx && oy === sy) continue;
    if (distKm(sx, sy, ox, oy) > RAD_KM) continue;
    nCity++;
    if (o.countryId < 0) nStateless++; else realms.add(o.countryId);
  }
  // unclaimed share of the LAND inside the same disk
  let land = 0, free = 0;
  for (let dy = -RY; dy <= RY; dy++) {
    const y = sy + dy; if (y < 0 || y >= th) continue;
    const latM = Math.max(0.05, Math.cos(latOf(y)));
    const rx = Math.ceil(RAD_KM / (KM_X * latM));
    for (let dx = -rx; dx <= rx; dx++) {
      const x = ((sx + dx) % tw + tw) % tw;
      const ti = y * tw + x;
      if (elev[ti] <= 0) continue;
      if (distKm(sx, sy, x, y) > RAD_KM) continue;
      land++;
      if (!co || co[ti] < 0) free++;
    }
  }
  return { nCity, nStateless, nRealms: realms.size, land, freeShare: land ? free / land : 1 };
}

function seatOf(id, p) {
  const s = world._byId && world._byId.get(p.capitalId);
  if (s && s.pos) return { x: s.pos.x | 0, y: s.pos.y | 0, kind: "seat" };
  const ls = world._landSeats && world._landSeats.get(id);
  if (ls) return { x: (ls.ti % tw) | 0, y: (ls.ti / tw) | 0, kind: "land" };
  return null;
}

for (let done = 0; done < STEPS; done += WIN) {
  const n = Math.min(WIN, STEPS - done);
  stepPeopleSim(world, n);

  // ── founding channels, from the live event stream (the log compacts, so
  //    drain it every window rather than reading it once at the end)
  const evs = world.events || [];
  for (let i = evCursor; i < evs.length; i++) {
    const e = evs[i];
    if (e && e.type === "polity.founded") howTally.set(e.how || "?", (howTally.get(e.how || "?") || 0) + 1);
  }
  evCursor = evs.length;

  // ── resolve the previous window's newborns: what did adoptAndFound do with them?
  for (const b of pending) {
    const s = world._byId && world._byId.get(b.id);
    const bucket = b.claimed ? fate.claimed : fate.wild;
    if (!s || s.mode !== "settled") continue;                 // died before it was decided
    if (s.countryId < 0) bucket.stateless++;
    else if (s.countryId === s.id) bucket.own++;
    else bucket.joined++;
  }
  pending = [];

  // ── new cities: claimed ground or wild?
  for (const s of world.settlements) {
    if (s.mode !== "settled" || seenSett.has(s.id)) continue;
    seenSett.add(s.id);
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    const claimed = !!(prevCo && prevCo[ti] >= 0);
    if (claimed) bornClaimed++; else bornWild++;
    claimedAtBirth.set(s.id, claimed);
    pending.push({ id: s.id, claimed });
  }

  // ── new realms: stamp the birth neighbourhood NOW, before anything moves
  for (const [id, p] of (world.polities || new Map())) {
    if (seenPol.has(id)) continue;
    const at = seatOf(id, p);
    if (!at) { seenPol.set(id, null); continue; }
    const nb = neighbourhoodAt(at.x, at.y);
    seenPol.set(id, {
      id, born: p.foundedStep | 0, x: at.x, y: at.y, seatKind: at.kind,
      insideRealm: !!claimedAtBirth.get(p.capitalId),
      ...nb,
    });
  }

  // snapshot the political field for the NEXT window's birth test
  if (world._countryOwner) { if (!prevCo || prevCo.length !== world._countryOwner.length) prevCo = world._countryOwner.slice(); else prevCo.set(world._countryOwner); }

  // ── standing stock
  let settled = 0, stateless = 0, cities = 0, statelessCities = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    settled++;
    if (s.countryId < 0) stateless++;
    if ((s.tier | 0) >= 2) { cities++; if (s.countryId < 0) statelessCities++; }
  }
  const live = new Set();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) live.add(s.countryId);
  windows.push({ step: world.step, settled, stateless, cities, statelessCities, realms: live.size });
}

// ── final territory ─────────────────────────────────────────────────────────
const co = world._countryOwner;
const tiles = new Map();
for (let ti = 0; ti < N; ti++) { const c = co ? co[ti] : -1; if (c >= 0 && elev[ti] > 0) tiles.set(c, (tiles.get(c) || 0) + 1); }
const rootOf = (id) => {
  const ov = world._overlordOf; let r = id, guard = 0;
  while (ov && ov.has(r) && guard++ < 64) r = ov.get(r);
  return r;
};
const blocTiles = new Map();
for (const [c, t] of tiles) { const r = rootOf(c); blocTiles.set(r, (blocTiles.get(r) || 0) + t); }
const members = new Map();
for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) members.set(s.countryId, (members.get(s.countryId) || 0) + 1);

const rows = [];
for (const rec of seenPol.values()) {
  if (!rec) continue;
  const p = world.polities.get(rec.id);
  const alive = !!p && p.endedStep < 0 && tiles.has(rec.id);
  rows.push({
    ...rec, alive,
    km2: (tiles.get(rec.id) || 0) * KM2_PER_TILE,
    blocKm2: (blocTiles.get(rootOf(rec.id)) || 0) * KM2_PER_TILE,
    mem: members.get(rec.id) || 0,
    lived: (p ? (p.endedStep < 0 ? world.step : p.endedStep) : rec.born) - rec.born,
  });
}

// ── statistics ──────────────────────────────────────────────────────────────
const q = (a, f) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };
function spearman(xs, ys) {
  const n = xs.length; if (n < 8) return NaN;
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < n;) { let j = i; while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = rx[i] - mx, b = ry[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

const M = (x) => (x / 1e6).toFixed(3) + "M";
console.log(`\n=== NATIONLESS CITIES / DENSITY-vs-SIZE  ${W}x${H} (tw=${tw})  seed ${SEED}  ${STEPS} steps  r=${RAD_KM}km ===`);

console.log(`\n-- A. the mint --------------------------------------------------------`);
console.log(`  polity.founded by channel (cumulative, whole run):`);
for (const [how, c] of [...howTally].sort((a, b) => b[1] - a[1])) console.log(`     ${String(how).padEnd(14)} ${String(c).padStart(6)}`);
console.log(`  city births: on CLAIMED ground ${bornClaimed}   in the WILD ${bornWild}   (wild share ${(100 * bornWild / Math.max(1, bornClaimed + bornWild)).toFixed(0)}%)`);
const pct = (a, b) => `${a} (${(100 * a / Math.max(1, b)).toFixed(0)}%)`;
{
  const c = fate.claimed, w = fate.wild;
  const cT = c.own + c.joined + c.stateless, wT = w.own + w.joined + w.stateless;
  console.log(`  what adoptAndFound did with each newborn city (every mint is born tier 2 and stateless):`);
  console.log(`     born INSIDE a realm's field  (n=${cT}):  joined it ${pct(c.joined, cT)}   MINTED ITS OWN REALM ${pct(c.own, cT)}   left stateless ${pct(c.stateless, cT)}`);
  console.log(`     born in the WILD             (n=${wT}):  joined a realm ${pct(w.joined, wT)}   MINTED ITS OWN REALM ${pct(w.own, wT)}   left stateless ${pct(w.stateless, wT)}`);
}
console.log(`\n  step      entities  stateless   cities(t>=2)  stateless-cities  realms`);
const every = Math.max(1, Math.round(windows.length / 16));
for (let i = 0; i < windows.length; i++) {
  if (i % every && i !== windows.length - 1) continue;
  const w = windows[i];
  console.log(`  ${String(w.step).padStart(6)}   ${String(w.settled).padStart(8)}  ${String(w.stateless).padStart(6)} (${String(Math.round(100 * w.stateless / Math.max(1, w.settled))).padStart(3)}%)  ${String(w.cities).padStart(8)}      ${String(w.statelessCities).padStart(8)} (${String(Math.round(100 * w.statelessCities / Math.max(1, w.cities))).padStart(3)}%)  ${String(w.realms).padStart(6)}`);
}

console.log(`\n-- B. the size law ----------------------------------------------------`);
const live = rows.filter(r => r.alive && r.km2 > 0);
console.log(`  realms ever founded: ${rows.length}   alive with territory at ${STEPS}: ${live.length}`);
if (live.length >= 8) {
  const nC = live.map(r => r.nCity), fr = live.map(r => r.freeShare), ar = live.map(r => r.km2), bl = live.map(r => r.blocKm2);
  console.log(`  Spearman(birth-neighbourhood CITY COUNT , final area)  = ${spearman(nC, ar).toFixed(3)}`);
  console.log(`  Spearman(birth-neighbourhood FREE-LAND share, final area) = ${spearman(fr, ar).toFixed(3)}`);
  console.log(`  Spearman(birth CITY COUNT , final BLOC area)          = ${spearman(nC, bl).toFixed(3)}`);
  console.log(`  Spearman(birth step        , final area)              = ${spearman(live.map(r => r.born), ar).toFixed(3)}`);

  const bins = [...live].sort((a, b) => a.nCity - b.nCity);
  const nq = 4, per = Math.ceil(bins.length / nq);
  console.log(`\n  by birth-neighbourhood city count (quartiles):`);
  console.log(`    bin  n     cities@birth   free-land@birth   final km2 p50 / p90      bloc km2 p50 / p90   members p50`);
  for (let i = 0; i < nq; i++) {
    const b = bins.slice(i * per, (i + 1) * per); if (!b.length) continue;
    console.log(`    Q${i + 1}   ${String(b.length).padStart(4)}  ${String(q(b.map(r => r.nCity), .5)).padStart(6)}        ${(100 * q(b.map(r => r.freeShare), .5)).toFixed(0).padStart(6)}%          ${M(q(b.map(r => r.km2), .5)).padStart(8)} / ${M(q(b.map(r => r.km2), .9)).padStart(8)}   ${M(q(b.map(r => r.blocKm2), .5)).padStart(8)} / ${M(q(b.map(r => r.blocKm2), .9)).padStart(8)}   ${String(q(b.map(r => r.mem), .5)).padStart(4)}`);
  }

  const fbins = [...live].sort((a, b) => a.freeShare - b.freeShare);
  console.log(`\n  by free-land share at birth (quartiles):`);
  console.log(`    bin  n     free-land@birth  cities@birth   final km2 p50 / p90      members p50`);
  for (let i = 0; i < nq; i++) {
    const b = fbins.slice(i * per, (i + 1) * per); if (!b.length) continue;
    console.log(`    Q${i + 1}   ${String(b.length).padStart(4)}   ${(100 * q(b.map(r => r.freeShare), .5)).toFixed(0).padStart(6)}%         ${String(q(b.map(r => r.nCity), .5)).padStart(6)}        ${M(q(b.map(r => r.km2), .5)).padStart(8)} / ${M(q(b.map(r => r.km2), .9)).padStart(8)}   ${String(q(b.map(r => r.mem), .5)).padStart(4)}`);
  }

  const top = [...live].sort((a, b) => b.km2 - a.km2).slice(0, 15);
  const med = { nCity: q(live.map(r => r.nCity), .5), free: q(live.map(r => r.freeShare), .5) };
  console.log(`\n  the 15 LARGEST realms — what their birth neighbourhood looked like`);
  console.log(`  (world median at founding: ${med.nCity} cities, ${(100 * med.free).toFixed(0)}% free land)`);
  console.log(`    born    km2       bloc km2   mem   cities@birth  stateless@birth  free-land@birth  name`);
  for (const r of top) {
    const p = world.polities.get(r.id);
    console.log(`    ${String(r.born).padStart(6)}  ${M(r.km2).padStart(8)}  ${M(r.blocKm2).padStart(8)}  ${String(r.mem).padStart(4)}   ${String(r.nCity).padStart(6)}        ${String(r.nStateless).padStart(6)}         ${(100 * r.freeShare).toFixed(0).padStart(6)}%        ${(p && p.name) || "?"}`);
  }
  // ── the confound: birth STEP and birth NEIGHBOURHOOD are collinear (the
  //    cradles found into an empty world). Stratify by founding era so the
  //    density term is read WITHIN a cohort that founded at the same time.
  const byBorn = [...live].sort((a, b) => a.born - b.born);
  const T3 = Math.ceil(byBorn.length / 3);
  console.log(`\n  stratified — within each founding cohort, does a crowded birth still mean a small realm?`);
  console.log(`    cohort (by birth step)      n    sparse half: cities@birth p50 -> km2 p50    crowded half: cities@birth p50 -> km2 p50`);
  for (let i = 0; i < 3; i++) {
    const coh = byBorn.slice(i * T3, (i + 1) * T3); if (coh.length < 4) continue;
    const byDen = [...coh].sort((a, b) => a.nCity - b.nCity);
    const lo = byDen.slice(0, Math.floor(byDen.length / 2)), hi = byDen.slice(Math.floor(byDen.length / 2));
    const lab = `steps ${coh[0].born}-${coh[coh.length - 1].born}`;
    console.log(`    ${lab.padEnd(26)} ${String(coh.length).padStart(4)}    ${String(q(lo.map(r => r.nCity), .5)).padStart(6)} -> ${M(q(lo.map(r => r.km2), .5)).padStart(8)}                        ${String(q(hi.map(r => r.nCity), .5)).padStart(6)} -> ${M(q(hi.map(r => r.km2), .5)).padStart(8)}`);
  }

  const inside = live.filter(r => r.insideRealm);
  console.log(`\n  realms alive at ${STEPS} whose SEAT CITY minted inside another realm's field: ${inside.length} of ${live.length} (${(100 * inside.length / live.length).toFixed(0)}%)`);
  if (inside.length) console.log(`    their area p50 ${M(q(inside.map(r => r.km2), .5))} km2   members p50 ${q(inside.map(r => r.mem), .5)}   born p50 step ${q(inside.map(r => r.born), .5)}`);
  const tiny = live.filter(r => r.km2 < 100e3);
  console.log(`\n  the confetti (< 100k km2): ${tiny.length} of ${live.length} realms (${(100 * tiny.length / live.length).toFixed(0)}%)`);
  console.log(`    born p50 ${q(tiny.map(r => r.born), .5)}   cities@birth p50 ${q(tiny.map(r => r.nCity), .5)}   free-land@birth p50 ${(100 * q(tiny.map(r => r.freeShare), .5)).toFixed(0)}%   members p50 ${q(tiny.map(r => r.mem), .5)}`);
  const big = live.filter(r => r.km2 >= 500e3);
  if (big.length) console.log(`    (>= 500k km2): ${big.length} realms — born p50 ${q(big.map(r => r.born), .5)}  cities@birth p50 ${q(big.map(r => r.nCity), .5)}  free-land@birth p50 ${(100 * q(big.map(r => r.freeShare), .5)).toFixed(0)}%`);
}
console.log("");

// per-realm rows, for any analysis this probe did not anticipate
try {
  const fs = await import("node:fs");
  const out = `docs/runs/2026-08-22/natdensity_${W}_${SEED}_${STEPS}.csv`;
  const head = "id,born,x,y,seatKind,insideRealm,alive,nCity,nStateless,nRealms,freeShare,km2,blocKm2,members,lived\n";
  const body = rows.map(r => [r.id, r.born, r.x, r.y, r.seatKind, r.insideRealm ? 1 : 0, r.alive ? 1 : 0, r.nCity, r.nStateless, r.nRealms, r.freeShare.toFixed(4), Math.round(r.km2), Math.round(r.blocKm2), r.mem, r.lived].join(",")).join("\n");
  fs.writeFileSync(out, head + body + "\n");
  console.log(`  per-realm rows -> ${out}\n`);
} catch (e) { console.log("  (csv dump failed: " + e.message + ")"); }
