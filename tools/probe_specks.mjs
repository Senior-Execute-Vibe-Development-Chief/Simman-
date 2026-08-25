// THE SPECKS THE OWNER SEES (2026-08-23): "far too many single realm nations, or
// micro nations inside larger nations, things like that, propagated by 1 city that
// should be part of greater realms."
//
// Two shapes, and they are NOT the same problem:
//
//   SINGLETON  — a realm of one city, anywhere. Its question is why it was ever
//                minted separately, or never joined anyone.
//   ENCLAVE    — a realm ringed by ONE other realm and touching no sea or map
//                edge: a speck inside somebody's empire. Its question is why the
//                surrounding power has not taken it.
//
// The ENCLAVE case has a third state the atlas hides. The app paints by BLOC ROOT
// (docs/consolidation-2026-08-20.md Lane 1), so a speck that is already a VASSAL of
// the realm around it draws as part of that nation and is not what the owner is
// looking at. Only an enclave that is INDEPENDENT — or a client of some third power
// — shows up as a foreign speck. So this probe splits them:
//
//   enclave, vassal OF its encloser  -> already one bloc; a paint question, not a
//                                       politics one
//   enclave, vassal of someone ELSE  -> a real anomaly: a distant power holding a
//                                       client inside a rival's body
//   enclave, INDEPENDENT             -> the thing on the screen. Why is it free?
//
// Descriptive throughout: it reports the CONDITIONS around each speck (relative
// power, distance to the encloser's seat against that realm's own hold reach) and
// the sim's OWN submit/integrate funnels beside them. It does not re-implement a
// gate — telemetry.js's header explains why a duplicated gate eventually lies.
//
//   node tools/probe_specks.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport } from "../src/sim/peopleSim/telemetry.js";
import { settlementPower } from "../src/sim/peopleSim/conquest.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);

const world = buildSim({ W, H, seed: SEED });
telEnable(world);
stepPeopleSim(world, STEPS);

const { N, tw, th, elev } = world;
let landN = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) landN++;
const KM2 = (510e6 * 0.29) / landN;
const co = world._countryOwner, countries = world.countries || new Map();
const ov = world._overlordOf || new Map();
const rootOf = (id) => { let r = id, g = 0; while (ov.has(r) && g++ < 64) r = ov.get(r); return r; };

// THE LENS MATTERS. The first version of this probe tested at REALM level and
// required a speck to touch no wilderness — and found ZERO enclaves at tw=240,
// because in a half-claimed world every realm touches wild land somewhere. But
// the owner is looking at the ATLAS, which paints by BLOC ROOT: a speck reads as
// "a micro nation inside a larger nation" when the BLOC around it differs from
// its own, whatever the wilderness does. So the ledger below is built over BLOC
// ids, and reported two ways — STRICT (no coast, no wilderness: a true hole in
// somebody's body) and PAINTED (>=90% of the FOREIGN border is one bloc, which
// is what the eye reads off the map even when wild land laps the edges).

// area, and the border ledger: how much of each realm's land border is with whom
const area = new Map(), bord = new Map(), openEdge = new Set();
for (let ti = 0; ti < N; ti++) {
  const c = co ? co[ti] : -1; if (c < 0 || !(elev[ti] > 0)) continue;
  area.set(c, (area.get(c) || 0) + 1);
  const ty = (ti / tw) | 0, tx = ti - ty * tw;
  const ns = [ty * tw + ((tx + 1) % tw), ty * tw + ((tx - 1 + tw) % tw), ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
  for (const ni of ns) {
    if (ni < 0) { openEdge.add(c); continue; }
    if (!(elev[ni] > 0)) { openEdge.add(c); continue; }        // a coast is an open border
    const nc = co[ni];
    if (nc === c) continue;
    if (nc < 0) { openEdge.add(c); continue; }                 // wilderness is an open border too
    let m = bord.get(c); if (!m) bord.set(c, m = new Map());
    m.set(nc, (m.get(nc) || 0) + 1);
  }
}

const members = new Map();
for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) members.set(s.countryId, (members.get(s.countryId) || 0) + 1);
const powOf = new Map();
for (const c of countries.values()) { let p = 0; for (const m of c.members) if (m.mode === "settled") p += settlementPower(m); powOf.set(c.id, p); }
const dist = (ax, ay, bx, by) => { let dx = Math.abs(ax - bx); if (dx > tw / 2) dx = tw - dx; return Math.hypot(dx, ay - by); };

// ── the same ledger at BLOC level: what the atlas actually draws ──────────────
const blocArea = new Map(), blocBord = new Map(), blocOpen = new Set(), blocWild = new Set();
for (let ti = 0; ti < N; ti++) {
  const c = co ? co[ti] : -1; if (c < 0 || !(elev[ti] > 0)) continue;
  const b = rootOf(c);
  blocArea.set(b, (blocArea.get(b) || 0) + 1);
  const ty = (ti / tw) | 0, tx = ti - ty * tw;
  const ns = [ty * tw + ((tx + 1) % tw), ty * tw + ((tx - 1 + tw) % tw), ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
  for (const ni of ns) {
    if (ni < 0 || !(elev[ni] > 0)) { blocOpen.add(b); continue; }
    const nc = co[ni];
    if (nc < 0) { blocWild.add(b); continue; }
    const nb = rootOf(nc);
    if (nb === b) continue;
    let m = blocBord.get(b); if (!m) blocBord.set(b, m = new Map());
    m.set(nb, (m.get(nb) || 0) + 1);
  }
}
const blocRealms = new Map();
for (const cid of area.keys()) { const b = rootOf(cid); blocRealms.set(b, (blocRealms.get(b) || 0) + 1); }
const blocSpecks = [];
for (const [b, a] of blocArea) {
  const m = blocBord.get(b); if (!m || !m.size) continue;
  let tot = 0, best = 0, bestId = -1;
  for (const [nb, v] of m) { tot += v; if (v > best) { best = v; bestId = nb; } }
  if (!(tot > 0) || best < tot * 0.90) continue;
  blocSpecks.push({ b, km2: a * KM2, realms: blocRealms.get(b) || 0, encloser: bestId,
    encKm2: (blocArea.get(bestId) || 0) * KM2, strict: !blocOpen.has(b) && !blocWild.has(b) });
}
// Bloc POWER — the quantity the submission gate actually tests (conquest.js `eff`:
// a suzerain's own power plus its dependencies'). The area ratio above is NOT this
// and must never be quoted for it: a speck can be eight times smaller in km2 and
// nowhere near five times weaker.
const blocPow = new Map();
for (const [cid] of area) { const b = rootOf(cid); blocPow.set(b, (blocPow.get(b) || 0) + (powOf.get(cid) || 0)); }
for (const r of blocSpecks) {
  r.pow = blocPow.get(r.b) || 0;
  r.encPow = blocPow.get(r.encloser) || 0;
  r.powRatio = r.encPow / Math.max(1e-9, r.pow);
}

const rows = [];
for (const [cid, a] of area) {
  const c = countries.get(cid); if (!c) continue;
  const m = bord.get(cid);
  let encloser = -1, share = 0;
  if (m && m.size && !openEdge.has(cid)) {
    let tot = 0, best = 0, bestId = -1;
    for (const [nc, v] of m) { tot += v; if (v > best) { best = v; bestId = nc; } }
    if (tot > 0 && best >= tot * 0.90) { encloser = bestId; share = best / tot; }
  }
  const over = ov.get(cid);
  rows.push({
    cid, km2: a * KM2, mem: members.get(cid) || 0,
    encloser, share,
    over: over == null ? -1 : over,
    sameBlocAsEncloser: encloser >= 0 && rootOf(cid) === rootOf(encloser),
    pow: powOf.get(cid) || 0,
  });
}

const live = rows.length;
const singles = rows.filter(r => r.mem === 1);
const enc = rows.filter(r => r.encloser >= 0);
const encVassalOfEncloser = enc.filter(r => r.over >= 0 && rootOf(r.over) === rootOf(r.encloser));
const encVassalOfOther = enc.filter(r => r.over >= 0 && rootOf(r.over) !== rootOf(r.encloser));
const encFree = enc.filter(r => r.over < 0);

console.log(`\n=== THE SPECKS  ${W}x${H} (tw=${tw})  seed ${SEED}  step ${world.step} ===`);
console.log(`\n  living realms with territory: ${live}`);
console.log(`    SINGLETONS (one city):            ${singles.length}  (${(100 * singles.length / live).toFixed(0)}%)   median ${(singles.length ? [...singles].sort((a, b) => a.km2 - b.km2)[singles.length >> 1].km2 / 1e3 : 0).toFixed(0)}k km2`);
console.log(`    ENCLAVES (>=90% ringed by one realm, no coast, no wilderness):  ${enc.length}  (${(100 * enc.length / live).toFixed(0)}%)`);
console.log(`       of which vassal OF its encloser  ${encVassalOfEncloser.length}  <- already one bloc; the atlas paints these as the same nation`);
console.log(`       of which vassal of someone ELSE  ${encVassalOfOther.length}  <- a distant power's client inside a rival's body`);
console.log(`       of which INDEPENDENT             ${encFree.length}  <- the foreign specks on the screen`);
console.log(`    singleton AND independent enclave:  ${encFree.filter(r => r.mem === 1).length}`);

if (encFree.length) {
  const withCtx = encFree.map(r => {
    const E = countries.get(r.encloser), S = countries.get(r.cid);
    const d = E && E.capital && S && S.capital ? dist(E.capital.pos.x, E.capital.pos.y, S.capital.pos.x, S.capital.pos.y) : -1;
    const reach = E ? Math.max(1, E.holdReach || E.range || 0) : 1;
    return { ...r, ratio: (powOf.get(r.encloser) || 0) / Math.max(1, r.pow), d, reach, dOverReach: d >= 0 ? d / reach : -1 };
  }).sort((a, b) => b.ratio - a.ratio);
  const q = (arr, f) => { const b = [...arr].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(f * b.length))] : 0; };
  console.log(`\n  the INDEPENDENT enclaves, described (not gate-tested):`);
  console.log(`    encloser/speck power ratio   p50 ${q(withCtx.map(r => r.ratio), .5).toFixed(1)}x   p90 ${q(withCtx.map(r => r.ratio), .9).toFixed(1)}x`);
  console.log(`    distance to encloser's seat / that realm's own hold reach   p50 ${q(withCtx.map(r => r.dOverReach), .5).toFixed(2)}   p90 ${q(withCtx.map(r => r.dOverReach), .9).toFixed(2)}`);
  console.log(`    (direct rule needs <= 1.00; vassalage is allowed out to SUBMIT_REACH = 1.50)`);
  console.log(`    beyond 1.00 (cannot be a province): ${withCtx.filter(r => r.dOverReach > 1).length} of ${withCtx.length}`);
  console.log(`    beyond 1.50 (cannot even be overawed): ${withCtx.filter(r => r.dOverReach > 1.5).length} of ${withCtx.length}`);
  console.log(`\n    the 12 most lopsided (encloser is this many times the speck's power):`);
  console.log(`      ratio    speck km2   mem   d/reach   speck                    inside`);
  for (const r of withCtx.slice(0, 12)) {
    const p = world.polities && world.polities.get(r.cid), pe = world.polities && world.polities.get(r.encloser);
    console.log(`      ${r.ratio.toFixed(1).padStart(6)}x  ${(r.km2 / 1e3).toFixed(0).padStart(9)}k  ${String(r.mem).padStart(4)}   ${r.dOverReach.toFixed(2).padStart(7)}   ${((p && p.name) || "?").padEnd(24)} ${(pe && pe.name) || "?"}`);
  }
}

// ── what the ATLAS shows: specks inside a painted nation ─────────────────────
{
  const strict = blocSpecks.filter(r => r.strict);
  const inBigger = blocSpecks.filter(r => r.encKm2 > r.km2);
  console.log(`\n  AT BLOC LEVEL — what the atlas paints (${blocArea.size} painted nations):`);
  console.log(`    blocs >=90% ringed by ONE other bloc:        ${blocSpecks.length}  (${(100 * blocSpecks.length / Math.max(1, blocArea.size)).toFixed(0)}% of painted nations)`);
  console.log(`       of those, STRICT holes (no coast, no wild): ${strict.length}`);
  console.log(`       of those, inside a BIGGER bloc:             ${inBigger.length}   <- "a micro nation inside a larger nation"`);
  if (inBigger.length) {
    const sorted = [...inBigger].sort((a, b) => (b.encKm2 / Math.max(1, b.km2)) - (a.encKm2 / Math.max(1, a.km2)));
    const sz = [...inBigger].map(r => r.km2).sort((a, b) => a - b);
    console.log(`       their size p50 ${(sz[sz.length >> 1] / 1e3).toFixed(0)}k km2 · realms-per-speck p50 ${[...inBigger].map(r => r.realms).sort((a, b) => a - b)[inBigger.length >> 1]}`);
    const pr = [...inBigger].map(r => r.powRatio).sort((a, b) => a - b);
    const pq = (f) => pr[Math.min(pr.length - 1, Math.floor(f * pr.length))];
    console.log(`\n       AGAINST THE GATE THAT KEEPS THEM FREE — submit's SUBMIT_RATIO = 5.0x`);
    console.log(`       (conquest.js: the encloser's BLOC power must be >= 5x the speck's before`);
    console.log(`        resistance counts as hopeless; CONQUEST_CASCADE lowers it with a live`);
    console.log(`        conquest streak, floored at parity, but a peaceful hegemon pays the full 5x)`);
    console.log(`       encloser/speck POWER ratio   p10 ${pq(.1).toFixed(1)}x   p50 ${pq(.5).toFixed(1)}x   p90 ${pq(.9).toFixed(1)}x`);
    console.log(`       ALREADY past 5x (the bar is not what holds these): ${inBigger.filter(r => r.powRatio >= 5).length} of ${inBigger.length}`);
    console.log(`       under 5x (the bar IS what holds these):            ${inBigger.filter(r => r.powRatio < 5).length} of ${inBigger.length}`);
    console.log(`\n       the 12 most lopsided:`);
    console.log(`         speck km2   realms   bloc around it    AREAx   POWERx  vs 5x   speck`);
    for (const r of sorted.slice(0, 12)) {
      const p = world.polities && world.polities.get(r.b), pe = world.polities && world.polities.get(r.encloser);
      console.log(`         ${(r.km2 / 1e3).toFixed(0).padStart(9)}k  ${String(r.realms).padStart(6)}   ${(r.encKm2 / 1e6).toFixed(2).padStart(14)}M   ${(r.encKm2 / Math.max(1, r.km2)).toFixed(0).padStart(5)}x   ${r.powRatio.toFixed(1).padStart(6)}x  ${(r.powRatio >= 5 ? "PAST" : "under").padStart(5)}   ${((p && p.name) || "?")}  in  ${(pe && pe.name) || "?"}`);
    }
  }
}

const f = telReport(world);
for (const ch of ["submit", "integrate"]) {
  const t = f[ch]; if (!t) continue;
  const c = t.CANDIDATE || 0;
  console.log(`\n  ${ch} funnel (whole run, the sim's own tally) — ${c} candidates, ${t.PASSED || 0} passed (${c ? (100 * (t.PASSED || 0) / c).toFixed(1) : 0}%)`);
  for (const [k, v] of Object.entries(t)) if (k !== "CANDIDATE" && k !== "PASSED") console.log(`     ${k.padEnd(30)} ${String(v).padStart(7)}  (${c ? (100 * v / c).toFixed(0) : 0}%)`);
}
console.log("");
