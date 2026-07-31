// OBSERVE — the whole run, in one command.
//
// Purpose: make every OUTCOME of a sim run visible from one place, so debugging is
// reading rather than guessing. This session lost hours to hypotheses that a single
// number would have killed (the size loop's gain k; whether captures stick; whether a
// hegemon exists at all). Each of those needed a bespoke probe. This is the standing
// one.
//
// SELF-MAINTAINING BY DESIGN. It does not carry a hardcoded field list — a list would
// go stale the first time someone adds state. Instead it INTROSPECTS the live world:
//   * every typed array of length N is reported as a per-LAND-tile distribution,
//   * every numeric key present on settlements / countries / polity records is reported
//     as a cross-entity distribution,
//   * every Map/Set/Array on the world is reported by size,
//   * the event log is histogrammed by kind.
// Add a new field anywhere and it shows up here on the next run with no edit.
//
// USAGE
//   node tools/observe.mjs                          # summary at step 9000, ref grid
//   node tools/observe.mjs --steps=12000 --W=960    # the SHIPPED app grid
//   node tools/observe.mjs --every=3000             # trajectory, not a snapshot
//   node tools/observe.mjs --nation=top             # drill into one realm, every field
//   node tools/observe.mjs --nation=5 --json        # machine-readable
//   node tools/observe.mjs --section=war,economy    # only those sections
//
// Sections: run, fields, population, nations, shape, graph, economy, trade, roads, war,
//           culture, knowledge, events, story, collections, ages. Default: all.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { stepToYear } from "../src/sim/calendar.js";
import nodeZlib from "node:zlib";
import nodeFs from "node:fs";
import { provenance, graphOf } from "./lib/simmetrics.mjs";
import { narrate } from "../src/sim/peopleSim/events.js";
import { chronicleText } from "../src/sim/peopleSim/chronicle.js";

const arg = (k, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const W = +arg("W", 480), STEPS = +arg("steps", 9000), SEED = +arg("seed", 8817);
const EVERY = +arg("every", 0), NATION = arg("nation", null), JSON_OUT = has("json");
const ONLY = (arg("section", "") || "").split(",").filter(Boolean);
const want = (s) => !ONLY.length || ONLY.includes(s);
const SHOW_ALL = has("all");

// Per-tile arrays that are PASS WORKSPACE, not outcomes — Dijkstra cost/prev/seen
// buffers, flood queues, connected-component labels, double-buffer "next" arrays,
// stamp scratch. Listed by name rather than detected, because the distinction is
// semantic. FAIL-OPEN ON PURPOSE: anything not named here is treated as an OUTCOME
// and shown, so new state appears in this report by default instead of hiding.
const SCRATCH = new Set([
  "_fpCost", "_fpDist", "_fpG", "_fpPrev", "_fpSeen", "_compQueue",
  "_gapBD", "_gapNear", "_gapQ", "_gapFills",
  "_landComp", "_landComp8", "_landLabel", "_tileComp", "_tileCompSeen",
  "_polCross", "_polDist", "_polStamp",
  "_reachDist", "_reachPrev", "_reachSeen", "_seaDist", "_seaPrev",
  "_popNext", "_devNext", "_ctrlHoldNext", "_ctrlOwnerNext",
  "_smoothSnap", "_smoothProt", "_coreClaimed", "_hintDist",
  "_territoryCost", "_territoryTrueCost", "_tileOwnerPrev", "_wasteSeen",
]);

// ── distribution helpers ─────────────────────────────────────────────────────
const q = (a, p) => { if (!a.length) return 0; const b = a.length > 4e5 ? a : [...a].sort((x, y) => x - y); if (b !== a) return b[Math.min(b.length - 1, Math.floor(p * b.length))]; const c = [...a].sort((x, y) => x - y); return c[Math.min(c.length - 1, Math.floor(p * c.length))]; };
const stats = (a) => {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y);
  let sum = 0; for (const v of b) sum += v;
  return { n: b.length, min: b[0], p50: b[b.length >> 1], p90: b[Math.floor(b.length * 0.9)], max: b[b.length - 1], mean: sum / b.length, sum };
};
const f = (x) => !Number.isFinite(x) ? "-" : Math.abs(x) >= 1e6 ? (x / 1e6).toFixed(2) + "M"
  : Math.abs(x) >= 1e4 ? Math.round(x).toLocaleString("en-US")
  : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(4);
const line = (label, st, unit = "") => st && console.log(`    ${label.padEnd(22)} p50 ${f(st.p50).padStart(11)}  p90 ${f(st.p90).padStart(11)}  max ${f(st.max).padStart(11)}  mean ${f(st.mean).padStart(11)}  Σ ${f(st.sum).padStart(11)} ${unit}`);
const yrOf = (s) => { const y = Math.round(stepToYear(s)); return y < 0 ? `${-y}BC` : `${y}AD`; };
const H = (t) => console.log(`\n━━ ${t} ${"━".repeat(Math.max(0, 68 - t.length))}`);

const world = buildSim({ W, H: W >> 1, seed: SEED });
const out = {};

function snapshot(w) {
  const { N, elev } = w;
  const land = []; for (let i = 0; i < N; i++) if (elev[i] > 0) land.push(i);
  const km2PerTile = (510e6 * 0.29) / land.length;
  const yr = Math.round(stepToYear(w.step));
  const settled = w.settlements.filter(s => s.mode === "settled");
  const co = w._countryOwner, held = new Map();
  let claimed = 0;
  if (co) for (const i of land) { const c = co[i]; if (c >= 0) { claimed++; held.set(c, (held.get(c) || 0) + 1); } }

  // ── RUN ────────────────────────────────────────────────────────────────────
  if (want("run")) {
    H("RUN");
    console.log(`    seed ${w.seed}  grid ${w.tw}x${w.th} (${land.length} land tiles, ${Math.round(km2PerTile)} km²/tile)  step ${w.step}`);
    console.log(`    displayed year ${yr < 0 ? -yr + " BC" : yr + " AD"}   civYear ${f(w._civYear)}   dt ${w._dt}`);
    console.log(`    entities ${settled.length} settled / ${w.settlements.length} total   realms ${w.countries ? w.countries.size : 0}   polity records ${w.polities ? w.polities.size : 0}`);
    // PROVENANCE — a measurement that does not say which code and which levers
    // produced it cannot be compared with another one. First line of every report.
    const pv = provenance(w);
    const lv = Object.keys(pv.levers).length ? JSON.stringify(pv.levers) : "all at defaults";
    console.log(`    commit ${pv.commit}${pv.dirtySrc ? " (src DIRTY — uncommitted changes)" : ""}   levers: ${lv}`);
    out.provenance = pv;
    out.run = { seed: w.seed, tw: w.tw, th: w.th, land: land.length, km2PerTile, step: w.step, year: yr, settled: settled.length, realms: w.countries?.size || 0 };
  }

  // ── TILE FIELDS (auto-discovered) ──────────────────────────────────────────
  if (want("fields")) {
    H("TILE FIELDS — every length-N array on the world, over LAND only");
    out.fields = {};
    const keys = Object.keys(w).filter(k => ArrayBuffer.isView(w[k]) && w[k].length === N).sort();
    const shown = [], scratchSeen = [];
    for (const k of keys) {
      const a = w[k], v = new Array(land.length);
      for (let j = 0; j < land.length; j++) v[j] = a[land[j]];
      const st = stats(v); if (!st) continue;
      out.fields[k] = st;
      if (!SHOW_ALL && SCRATCH.has(k)) { scratchSeen.push(k); continue; }
      if (st.max === 0 && st.min === 0) { scratchSeen.push(k + "(all-zero)"); continue; }
      shown.push(k); line(k, st);
    }
    console.log(`    ${shown.length} outcome fields shown of ${keys.length} discovered.`);
    if (scratchSeen.length) console.log(`    workspace/scratch (--all to include): ${scratchSeen.join(" ")}`);
  }

  // ── POPULATION ─────────────────────────────────────────────────────────────
  if (want("population")) {
    H("POPULATION");
    let pf = 0; for (const i of land) pf += w.popField ? w.popField[i] : 0;
    const census = settled.map(s => s.people || 0);
    const urban = settled.map(s => s._urbanPop || 0), rural = settled.map(s => s._ruralPop || 0);
    const cs = stats(census);
    console.log(`    Σ popField ${f(pf)}   Σ census ${f(cs?.sum)}   bridge _onePopScale ${f(w._onePopScale)}`);
    console.log(`    people per km² ${f(pf / (land.length * km2PerTile))}   urban Σ ${f(stats(urban)?.sum)}   rural Σ ${f(stats(rural)?.sum)}`);
    line("settlement census", cs);
    line("urban core", stats(urban)); line("rural belt", stats(rural));
    line("carrying capacity s._k", stats(settled.map(s => s._k || 0)));
    const top = [...settled].sort((a, b) => (b.people || 0) - (a.people || 0)).slice(0, 8);
    console.log(`    largest: ${top.map(s => `${s.name}(${Math.round(s.people)}, t${s.tier})`).join("  ")}`);
    out.population = { popField: pf, census: cs, perKm2: pf / (land.length * km2PerTile), bridge: w._onePopScale };
  }

  // ── NATIONS ────────────────────────────────────────────────────────────────
  if (want("nations")) {
    H("NATIONS");
    const rows = [];
    if (w.countries) for (const [cid, c] of w.countries) {
      if (!c.capital) continue;
      const tiles = held.get(cid) || 0;
      let gp = 0, wealth = 0; for (const m of c.members || []) { gp += m.people || 0; wealth += m.wealth || 0; }
      const p = w.polities && w.polities.get ? w.polities.get(cid) : null;
      rows.push({ id: cid, name: p?.name || `#${cid}`, seat: c.capital.name, tiles, km2: tiles * km2PerTile,
        members: (c.members || []).length, people: gp, wealth, treasury: p?.treasury || 0,
        power: w._countryPow?.get(cid) || 0, dominance: c._dominance || 1, manpower: c._manpower || 0,
        army: c._armyPro || 0, reach: c.holdReach || 0, org: c.capital.knowledge?.organization || 0,
        nomadic: !!c._nomadic, gov: p?.gov, allies: w._allies?.get(cid)?.size ?? 0,
        atWar: [...(w._warSeenAt || new Map()).keys()].filter(k => String(k).split(":").includes(String(cid))).length });
    }
    rows.sort((a, b) => b.tiles - a.tiles);
    const areas = rows.map(r => r.km2);
    console.log(`    realms ${rows.length}   claimed ${(100 * claimed / land.length).toFixed(2)}% of land   stateless settled ${settled.filter(s => s.countryId < 0).length}`);
    line("realm area (km²)", stats(areas));
    line("realm people", stats(rows.map(r => r.people)));
    line("realm wealth", stats(rows.map(r => r.wealth)));
    line("realm power", stats(rows.map(r => r.power)));
    line("dominance", stats(rows.map(r => r.dominance)));
    console.log(`    ${"name".padEnd(16)}${"seat".padEnd(14)}${"tiles".padStart(6)}${"km²".padStart(10)}${"mem".padStart(5)}${"people".padStart(9)}${"wealth".padStart(9)}${"treas".padStart(8)}${"power".padStart(8)}${"dom".padStart(6)}${"org".padStart(6)}`);
    for (const r of rows.slice(0, 14))
      console.log(`    ${String(r.name).slice(0, 15).padEnd(16)}${String(r.seat).slice(0, 13).padEnd(14)}${String(r.tiles).padStart(6)}${f(r.km2).padStart(10)}${String(r.members).padStart(5)}${f(r.people).padStart(9)}${f(r.wealth).padStart(9)}${f(r.treasury).padStart(8)}${f(r.power).padStart(8)}${r.dominance.toFixed(2).padStart(6)}${r.org.toFixed(3).padStart(6)}`);
    if (rows.length > 14) console.log(`    … ${rows.length - 14} more`);
    out.nations = rows;
  }

  // ── SHAPE — the geometry of realms, not just their size ────────────────────
  // Counts and areas say nothing about FORM, and form is what a human sees on the
  // map: "blobs all over", "a state that follows the river valley", "scattered dots
  // that never touch". Every complaint this session was a shape statement, and no
  // instrument could read one. These are the standard measures:
  //   COMPACTNESS  4πA/P² — 1.0 is a disc, ~0.2 a ragged sprawl, low = tendrils.
  //   FRAGMENTS    8-connected components; >1 means the realm is in pieces.
  //   ELONGATION   principal-axis ratio about the centroid — a Nile-shaped valley
  //                state reads high, a round blob reads ~1.
  //   SPREAD       radius of gyration from the seat, in tiles — how far rule reaches.
  //   ENCLAVES     unclaimed land fully enclosed by the realm (holes it never filled).
  //   NEIGHBOURS   distinct realms it shares a land border with (0 = an isolated dot).
  if (want("shape") || want("shapes")) {
    H("SHAPE — realm geometry");
    const tw = w.tw, th = w.th;
    const tiles = new Map();
    if (co) for (const i of land) { const c = co[i]; if (c >= 0) { let a = tiles.get(c); if (!a) tiles.set(c, a = []); a.push(i); } }
    const nb4 = (i) => { const y = (i / tw) | 0, x = i - y * tw; const o = []; o.push(y * tw + ((x + 1) % tw)); o.push(y * tw + ((x - 1 + tw) % tw)); if (y > 0) o.push(i - tw); if (y < th - 1) o.push(i + tw); return o; };
    const nb8 = (i) => { const y = (i / tw) | 0, x = i - y * tw; const o = []; for (let dy = -1; dy <= 1; dy++) { const ny = y + dy; if (ny < 0 || ny >= th) continue; for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; o.push(ny * tw + ((x + dx + tw) % tw)); } } return o; };
    const rows = [];
    for (const [cid, arr] of tiles) {
      const own = new Set(arr);
      // perimeter + neighbouring realms
      let perim = 0; const nbrs = new Set();
      for (const i of arr) for (const n of nb4(i)) {
        if (own.has(n)) continue;
        perim++;
        const o = co[n]; if (o >= 0 && o !== cid) nbrs.add(o);
      }
      // 8-connected components
      const seen = new Set(); let comps = 0, biggest = 0;
      for (const s0 of arr) {
        if (seen.has(s0)) continue;
        comps++; let sz = 0; const st = [s0]; seen.add(s0);
        while (st.length) { const i = st.pop(); sz++; for (const n of nb8(i)) if (own.has(n) && !seen.has(n)) { seen.add(n); st.push(n); } }
        if (sz > biggest) biggest = sz;
      }
      // centroid + second moments, x unwrapped against the seat to survive the torus
      const c = w.countries?.get(cid); const cap = c?.capital;
      const sx = cap ? (cap.pos.x | 0) : ((arr[0] % tw) | 0), sy = cap ? (cap.pos.y | 0) : ((arr[0] / tw) | 0);
      let mx = 0, my = 0;
      const xs = [], ys = [];
      for (const i of arr) {
        const y = (i / tw) | 0; let x = i - y * tw;
        let dx = x - sx; if (dx > tw / 2) dx -= tw; if (dx < -tw / 2) dx += tw;
        xs.push(dx); ys.push(y - sy); mx += dx; my += y - sy;
      }
      mx /= arr.length; my /= arr.length;
      let sxx = 0, syy = 0, sxy = 0, rg = 0;
      for (let j = 0; j < xs.length; j++) { const a = xs[j] - mx, b = ys[j] - my; sxx += a * a; syy += b * b; sxy += a * b; rg += xs[j] * xs[j] + ys[j] * ys[j]; }
      sxx /= arr.length; syy /= arr.length; sxy /= arr.length;
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const disc = Math.max(0, tr * tr / 4 - det);
      const l1 = tr / 2 + Math.sqrt(disc), l2 = Math.max(1e-9, tr / 2 - Math.sqrt(disc));
      // enclaves: unclaimed land whose 4-neighbours are all this realm's
      let holes = 0;
      for (const i of arr) for (const n of nb4(i)) {
        if (own.has(n) || !(elev[n] > 0) || co[n] >= 0) continue;
        if (nb4(n).every(m => own.has(m) || !(elev[m] > 0))) holes++;
      }
      rows.push({ id: cid, name: w.polities?.get(cid)?.name || `#${cid}`, tiles: arr.length,
        compact: perim > 0 ? (4 * Math.PI * arr.length) / (perim * perim) : 0,
        frags: comps, mainShare: biggest / arr.length,
        elong: Math.sqrt(l1 / l2), spread: Math.sqrt(rg / arr.length),
        holes, nbrs: nbrs.size, perim });
    }
    rows.sort((a, b) => b.tiles - a.tiles);
    line("compactness 4πA/P²", stats(rows.map(r => r.compact)));
    line("fragments per realm", stats(rows.map(r => r.frags)));
    line("main-piece share", stats(rows.map(r => r.mainShare)));
    line("elongation (axis ratio)", stats(rows.map(r => r.elong)));
    line("spread from seat", stats(rows.map(r => r.spread)));
    line("enclaved holes", stats(rows.map(r => r.holes)));
    line("neighbouring realms", stats(rows.map(r => r.nbrs)));
    const isolated = rows.filter(r => r.nbrs === 0).length;
    console.log(`    ISOLATED realms (no land border with anyone): ${isolated} of ${rows.length} (${Math.round(100 * isolated / Math.max(1, rows.length))}%)`);
    // how far apart are the seats? the "scattered dots" measure
    const seats = [];
    if (w.countries) for (const c of w.countries.values()) if (c.capital?.mode === "settled") seats.push([c.capital.pos.x | 0, c.capital.pos.y | 0]);
    const nn = [];
    for (let a = 0; a < seats.length; a++) { let best = Infinity;
      for (let b = 0; b < seats.length; b++) { if (a === b) continue; let dx = Math.abs(seats[a][0] - seats[b][0]); if (dx > tw / 2) dx = tw - dx; const dy = seats[a][1] - seats[b][1]; const d = Math.hypot(dx, dy); if (d < best) best = d; }
      if (Number.isFinite(best)) nn.push(best); }
    line("nearest-seat distance", stats(nn));
    console.log(`    ${"name".padEnd(16)}${"tiles".padStart(6)}${"compact".padStart(9)}${"frags".padStart(7)}${"main%".padStart(7)}${"elong".padStart(7)}${"spread".padStart(8)}${"holes".padStart(7)}${"nbrs".padStart(6)}`);
    for (const r of rows.slice(0, 12))
      console.log(`    ${String(r.name).slice(0, 15).padEnd(16)}${String(r.tiles).padStart(6)}${r.compact.toFixed(3).padStart(9)}${String(r.frags).padStart(7)}${(100 * r.mainShare).toFixed(0).padStart(7)}${r.elong.toFixed(2).padStart(7)}${r.spread.toFixed(1).padStart(8)}${String(r.holes).padStart(7)}${String(r.nbrs).padStart(6)}`);
    out.shape = rows;
  }

  // ── GRAPHS — the networks, as TOPOLOGY rather than as sizes ────────────────
  // Every network here used to report as one integer. `overlord bonds 16` is the
  // same number for a sixteen-wide star under one hegemon and a four-deep tribute
  // chain — different worlds. It matters most for vassalage, which the sim's own
  // chronicle showed is its PRIMARY consolidation channel (16 submissions against
  // 0 annexations over 16k steps), and which explains the standing paradox: realm
  // count rises and the map reads fragmented because a tributary is INVISIBLE on
  // the political map. blocLandPct is the honest extent of the largest power.
  if (want("graph") || want("graphs")) {
    H("NETWORKS — topology, not size");
    const g = graphOf(w, held);
    const g1 = (k, d = 2) => (g[k] === undefined ? "-" : g[k].toFixed(d));
    console.log(`    TRIBUTARY TREE   ${g1("vassal.bonds", 0)} bonds · ${g1("vassal.suzerains", 0)} suzerains · ${g1("vassal.roots", 0)} roots`);
    console.log(`      depth max ${g1("vassal.depthMax", 0)} (mean ${g1("vassal.depthMean")})   sub-vassals ${g1("vassal.subvassalPct", 1)}% of bonds   widest suzerain ${g1("vassal.branchMax", 0)} direct`);
    console.log(`      LARGEST BLOC ${g1("vassal.blocMaxRealms", 0)} realms = ${g1("vassal.blocPctRealms", 1)}% of realms, holding ${g1("vassal.blocLandPct", 1)}% of all CLAIMED LAND`);
    console.log(`      dependent realms ${g1("vassal.dependentPctRealms", 1)}% of the world`);
    console.log(`    ALLIANCES        ${g1("alliance.components", 0)} blocs · degree mean ${g1("alliance.degMean")} max ${g1("alliance.degMax", 0)} · largest ${g1("alliance.largestPct", 1)}% · unallied ${g1("alliance.unalliedPct", 1)}%`);
    console.log(`    TRADE NET        ${g1("trade.links", 0)} links over ${g1("trade.nodes", 0)} towns · degree mean ${g1("trade.degMean")} max ${g1("trade.degMax", 0)}`);
    console.log(`                     ${g1("trade.components", 0)} components, largest ${g1("trade.largestPct", 1)}% · busiest 10% of links carry ${g1("trade.top10FlowPct", 1)}% of flow`);
    console.log(`    REALM ADJACENCY  ${g1("realmnet.components", 0)} separate political worlds · largest cluster ${g1("realmnet.largestPct", 1)}% of realms`);
    console.log(`    ROADS            ${g1("road.tiles", 0)} tiles in ${g1("road.components", 0)} networks · largest ${g1("road.largestPct", 1)}% · mean ${g1("road.meanCompSize")} tiles`);
    console.log(`    LIEGE TREE       ${g1("liege.bonds", 0)} bonds · depth max ${g1("liege.depthMax", 0)} (mean ${g1("liege.depthMean")})   [settlement hierarchy inside realms]`);
    out.graph = g;
  }

  // ── ECONOMY ────────────────────────────────────────────────────────────────
  if (want("economy")) {
    H("ECONOMY");
    const GOODS = ["staple", "materials", "ore", "metal", "cloth", "wares", "luxury", "services"];
    line("settlement wealth", stats(settled.map(s => s.wealth || 0)));
    line("infrastructure", stats(settled.map(s => s.infrastructure || 0)));
    line("food stock", stats(settled.map(s => s.food || 0)));
    line("food supply/tick", stats(settled.map(s => s._foodSupply || 0)));
    line("food demand/tick", stats(settled.map(s => s._foodDemand || 0)));
    line("grain price", stats(settled.map(s => s._grainPrice || 0)));
    line("export value", stats(settled.map(s => s._exportValue || 0)));
    line("unfree share", stats(settled.map(s => s._unfreeRatio || 0)));
    for (let g = 0; g < GOODS.length; g++) {
      const pr = settled.map(s => s._gPrice?.[g] ?? 0).filter(x => x > 0);
      const st = stats(pr); if (st) console.log(`    price ${GOODS[g].padEnd(16)} p50 ${f(st.p50).padStart(11)}  p90 ${f(st.p90).padStart(11)}  max ${f(st.max).padStart(11)}`);
    }
    console.log(`    money flows logged ${w._moneyFlows?.length || 0}   ruin hoards ${w._ruinHoards?.size || 0}   slave price map ${w._slaveLastPrice?.size || 0}`);
    out.economy = { wealth: stats(settled.map(s => s.wealth || 0)), grainPrice: stats(settled.map(s => s._grainPrice || 0)) };
  }

  // ── TRADE ──────────────────────────────────────────────────────────────────
  if (want("trade")) {
    H("TRADE");
    const tp = w._tradePairs || new Map(), lm = w._linkMoney || new Map();
    line("cross-border pair flow", stats([...tp.values()]));
    line("link money (all links)", stats([...lm.values()].map(Math.abs)));
    line("realm total commerce", stats([...(w._tradeTotals || new Map()).values()]));
    line("partners per settlement", stats(settled.map(s => s._tradeReach?.size || 0)));
    const topPairs = [...tp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`    busiest borders: ${topPairs.map(([k, v]) => `${k}=${f(v)}`).join("  ")}`);
    console.log(`    sea lanes ${w._seaLanes?.length || 0}   ships ${w.ships?.length || 0}`);
    out.trade = { pairs: tp.size, links: lm.size, pairFlow: stats([...tp.values()]) };
  }

  // ── ROADS ──────────────────────────────────────────────────────────────────
  if (want("roads")) {
    H("ROADS");
    const rq = land.map(i => w.roadQuality?.[i] || 0).filter(x => x > 0);
    const rf = land.map(i => w.roadFlow?.[i] || 0).filter(x => x > 0);
    console.log(`    road tiles ${w._roadTiles?.size || 0}   flow tiles ${w._flowTiles?.size || 0}   (${((w._roadTiles?.size || 0) / land.length * 100).toFixed(2)}% of land)`);
    line("road quality (paved)", stats(rq));
    line("road flow", stats(rf));
    line("transport distance", stats(land.map(i => w.transportDist?.[i] ?? 0).filter(Number.isFinite)));
    out.roads = { roadTiles: w._roadTiles?.size || 0, quality: stats(rq) };
  }

  // ── WAR ────────────────────────────────────────────────────────────────────
  if (want("war")) {
    H("WAR");
    const cap = w._tileCapturedAt; let capturedTiles = 0;
    if (cap) for (const i of land) if (cap[i] > -Infinity) capturedTiles++;
    console.log(`    live truces ${w._truces?.size || 0}   active war pairs ${w._warBornAt?.size || 0}   fronts seen ${w._warSeenAt?.size || 0}`);
    console.log(`    tiles ever captured ${capturedTiles} (${f(capturedTiles * km2PerTile)} km²)   overlord bonds ${w._overlordOf?.size || 0}   succession claims ${w._succClaims?.size || 0}`);
    line("war exhaustion", stats([...(w._warExhaust || new Map()).values()]));
    line("war dead (per pair)", stats([...(w._warDead || new Map()).values()]));
    line("realm manpower", stats([...(w._manpower || new Map()).values()]));
    line("standing army", stats(settled.map(s => s.army || 0)));
    line("unrest", stats(settled.map(s => s.unrest || 0)));
    line("loyalty", stats(settled.map(s => s.loyalty ?? 1)));
    out.war = { truces: w._truces?.size || 0, capturedTiles, exhaustion: stats([...(w._warExhaust || new Map()).values()]) };
  }

  // ── CULTURE / FAITH / DYNASTY ──────────────────────────────────────────────
  if (want("culture")) {
    H("PEOPLES, FAITHS, DYNASTIES");
    console.log(`    cultures ${w.cultures?.size || 0}   languages ${w.languages?.size || 0}   faiths ${w.faiths?.size || 0}   dynasties ${w.dynasties?.size || 0}   persons ${w.persons?.size || 0}`);
    console.log(`    ancestry stocks ${w.ancestryCount || 0}   royal court ${w._royalCourt?.length || 0}   sitting rulers ${w._sittingRulers?.size || 0}`);
    const culShare = new Map();
    for (const s of settled) { const c = s.culMix?.[0]?.[0] ?? s.cultureId; if (c != null) culShare.set(c, (culShare.get(c) || 0) + (s.people || 0)); }
    const tops = [...culShare.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`    largest peoples by census: ${tops.map(([c, p]) => `${w.cultures?.get(c)?.name || c}=${f(p)}`).join("  ")}`);
    line("mix depth (cultures/town)", stats(settled.map(s => s.culMix?.length || 0)));
    out.culture = { cultures: w.cultures?.size || 0, faiths: w.faiths?.size || 0, dynasties: w.dynasties?.size || 0 };
  }

  // ── KNOWLEDGE / AGES ───────────────────────────────────────────────────────
  if (want("knowledge") || want("ages")) {
    H("KNOWLEDGE & AGES");
    for (const k of ["agriculture", "construction", "organization", "metallurgy", "navigation", "mobility"])
      line(k, stats(settled.map(s => s.knowledge?.[k] || 0)));
    console.log(`    era markers reached at steps: ${(w._eraAt || []).map((s2, i) => `era${i}@${s2}`).join("  ") || "none"}`);
    console.log(`    leading organization ${f(w._leadOrg)}   town bar ${f(w._townBar)}   city bar ${f(w._cityBar)}   top urban ${f(w._topUrban)}`);
    line("devField (technique)", stats(land.map(i => w.devField?.[i] || 0)));
    out.ages = { eraAt: w._eraAt || [], leadOrg: w._leadOrg };
  }

  // ── EVENTS / CHRONICLE ─────────────────────────────────────────────────────
  if (want("events")) {
    H("CHRONICLE");
    const ev = w.events || [];
    const hist = {};
    for (const e of ev) { const k = e.kind || e.type; hist[k] = (hist[k] || 0) + 1; }
    const sorted = Object.entries(hist).sort((a, b) => b[1] - a[1]);
    console.log(`    ${ev.length} events, ${sorted.length} distinct kinds, ${f(1000 * ev.length / Math.max(1, w.step))} per 1000 steps`);
    for (let i = 0; i < sorted.length; i += 4)
      console.log("    " + sorted.slice(i, i + 4).map(([k, n]) => `${k}=${n}`.padEnd(28)).join(""));
    console.log(`    most recent: ${ev.slice(-4).map(e => `[${e.step}] ${e.kind || e.type}`).join("  |  ")}`);
    out.events = hist;
  }

  // ── THE STORY THE SIM TELLS ABOUT ITSELF ───────────────────────────────────
  // The sim carries a narrative layer — events.js narrate(), chronicle.js
  // chronicleText(), historiography.js perspectiveText() — that renders its own
  // history as prose for the player. Every instrument in this repo measures STATE
  // and none of them had ever read it. A run's "gist" is not only its distributions:
  // it is which realms rose, what befell them, and in what order, which is exactly
  // what this layer already writes.
  if (want("story")) {
    H("THE CHRONICLE, AS THE SIM NARRATES IT");
    const ev = w.events || [];
    const KEY = new Set(["polity.founded", "polity.ended", "polity.shattered", "polity.restored",
      "polity.submitted", "war.began", "war.ended", "settlement.captured", "era.reached",
      "famine.struck", "plague.outbreak", "faith.founded", "faith.schism", "dynasty.extinct",
      "succession.crisis", "colony.founded", "gov.changed", "realm.monument", "wealth.milestone"]);
    const world_story = ev.filter(e => KEY.has(e.kind || e.type));
    console.log(`    ${world_story.length} narratable world events of ${ev.length}`);
    const stride = Math.max(1, Math.ceil(world_story.length / 30));
    for (let i = 0; i < world_story.length; i += stride) {
      const e = world_story[i];
      let line2 = "";
      try { line2 = narrate(w, e, -1); } catch { line2 = e.kind || e.type; }
      console.log(`    ${String(yrOf(e.step)).padStart(8)}  ${line2}`);
    }
    // …and the leading realm's own chronicle, in its own voice
    let top = null, best = -1;
    if (w.countries) for (const [cid, c] of w.countries) { if (!c.capital) continue; const t = held.get(cid) || 0; if (t > best) { best = t; top = cid; } }
    if (top != null) {
      console.log(`\n    ── the chronicle of ${w.polities?.get(top)?.name || top} (largest realm) ──`);
      try {
        // chronicleText returns one comma-joined string of "[step] sentence" entries.
        const entries = String(chronicleText(w, top)).split(/,(?=\[\d)/);
        const stride = Math.max(1, Math.ceil(entries.length / 22));
        for (let i = 0; i < entries.length; i += stride) {
          const e2 = entries[i].trim(); if (!e2) continue;
          const mm = e2.match(/^\[(\d+)\]\s*(.*)$/);
          console.log(mm ? `      ${yrOf(+mm[1]).padStart(8)}  ${mm[2]}` : `      ${e2}`);
        }
        console.log(`      (${entries.length} entries in its chronicle)`);
      } catch (e) { console.log(`      (chronicleText failed: ${e.message})`); }
    }
  }

  // ── COLLECTIONS (auto) ─────────────────────────────────────────────────────
  if (want("collections")) {
    H("COLLECTIONS — every Map/Set/Array on the world, by size");
    const rows = Object.keys(w).filter(k => w[k] instanceof Map || w[k] instanceof Set || Array.isArray(w[k]))
      .map(k => [k, w[k].size ?? w[k].length]).sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < rows.length; i += 4)
      console.log("    " + rows.slice(i, i + 4).map(([k, n]) => `${k}=${n}`.padEnd(28)).join(""));
  }

  // ── ONE NATION, EVERY FIELD ────────────────────────────────────────────────
  if (NATION) {
    // Ranked independently of whether the nations SECTION ran, so
    // `--nation=top --section=war` works.
    let pick = null;
    if (NATION === "top") {
      let best = -1;
      if (w.countries) for (const [cid, c] of w.countries) {
        if (!c.capital) continue;
        const t = held.get(cid) || 0;
        if (t > best) { best = t; pick = c; }
      }
    } else pick = w.countries?.get(+NATION) || null;
    H(`NATION DRILL-DOWN — ${pick ? (w.polities?.get(pick.id)?.name || pick.id) : NATION}`);
    if (!pick) console.log("    not found");
    else {
      const p = w.polities?.get(pick.id);
      const grp = (label, obj, skip = []) => {
        const ks = Object.keys(obj).filter(k => !skip.includes(k) && typeof obj[k] !== "function").sort();
        console.log(`\n    ── ${label} (${ks.length}) ──`);
        const parts = ks.map(k => {
          const v = obj[k];
          const sv = v == null ? "null" : ArrayBuffer.isView(v) ? `[${v.length}]` : v instanceof Map ? `Map(${v.size})`
            : Array.isArray(v) ? `[${v.length}]` : typeof v === "object" ? `{${Object.keys(v).length}}`
            : typeof v === "number" ? f(v) : String(v).slice(0, 18);
          return `${k}=${sv}`;
        });
        for (let i = 0; i < parts.length; i += 3) console.log("      " + parts.slice(i, i + 3).map(x => x.padEnd(34)).join(""));
      };
      grp("country", pick, ["capital", "members"]);
      if (p) grp("polity record", p, ["rulers", "houses"]);
      grp("capital settlement", pick.capital);
      console.log(`\n    members (${(pick.members || []).length}): ${(pick.members || []).map(m => `${m.name}(t${m.tier}, ${Math.round(m.people)}p, ${f(m.wealth)}w)`).join("  ")}`);
      const myEv = (w.events || []).filter(e => e.polity === pick.id || e.from === pick.id).slice(-10);
      console.log(`    its chronicle (last ${myEv.length}): ${myEv.map(e => `[${e.step}]${e.kind || e.type}`).join("  ")}`);
    }
  }
}

// ── THE MAP, AS AN IMAGE ─────────────────────────────────────────────────────
// Numbers describe shape; they do not SHOW it. Every diagnosis this session that
// beat the probes came from someone looking at the map. `--png=out.png` writes the
// political map (and `--png-layer=pop|dev|terrain` the others) so it can be opened —
// or read directly by an agent that can see images. Minimal PNG encoder, no deps.
function writePng(w, file, layer) {
  const zlib = nodeZlib, fs = nodeFs;
  const { tw, th, elev } = w, SC = 3, OW = tw * SC, OH = th * SC;
  const rgb = Buffer.alloc(OW * OH * 3);
  const hsl = (h, s, l) => { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2; const hh = h / 60; let r, g, b; if (hh < 1)[r, g, b] = [c, x, 0]; else if (hh < 2)[r, g, b] = [x, c, 0]; else if (hh < 3)[r, g, b] = [0, c, x]; else if (hh < 4)[r, g, b] = [0, x, c]; else if (hh < 5)[r, g, b] = [x, 0, c]; else[r, g, b] = [c, 0, x]; return [(r + m) * 255 | 0, (g + m) * 255 | 0, (b + m) * 255 | 0]; };
  const co = w._countryOwner, pf = w.popField, dv = w.devField;
  let pmax = 0; if (pf) for (let i = 0; i < w.N; i++) if (elev[i] > 0 && pf[i] > pmax) pmax = pf[i];
  const colOf = (i) => {
    if (elev[i] <= 0) return [16, 30, 60];
    if (layer === "pop") { const t = pf ? Math.min(1, Math.log1p(pf[i]) / Math.log1p(pmax || 1)) : 0; return [20 + 235 * t | 0, 20 + 120 * t | 0, 40]; }
    if (layer === "dev") { const t = dv ? Math.min(1, dv[i]) : 0; return [30 + 200 * t | 0, 60 + 150 * t | 0, 40 + 60 * t | 0]; }
    if (layer === "terrain") { const f2 = w.fert ? w.fert[i] : 0; return [90 + 120 * f2 | 0, 110 + 130 * f2 | 0, 70]; }
    // `--png-layer=control` draws what the PLAYER sees (the control field), not the
    // authoritative map. They differ by ~1.45x in claimed tiles at the shipped grid.
    const src = layer === "control" && w._ctrlOwner ? w._ctrlOwner : co;
    const c = src ? src[i] : -1;
    if (c < 0) return [140, 132, 116];
    return hsl(((c * 61) % 360 + 360) % 360, 0.65, 0.5);
  };
  for (let ti = 0; ti < w.N; ti++) {
    const y = (ti / tw) | 0, x = ti - y * tw, col = colOf(ti);
    for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++) {
      const o = ((y * SC + dy) * OW + (x * SC + dx)) * 3;
      rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
    }
  }
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, "ascii"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b), 0); return Buffer.concat([l, b, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(OW, 0); ih.writeUInt32BE(OH, 4); ih[8] = 8; ih[9] = 2;
  const st = OW * 3 + 1, raw = Buffer.alloc(st * OH);
  for (let y = 0; y < OH; y++) { raw[y * st] = 0; rgb.copy(raw, y * st + 1, y * OW * 3, (y + 1) * OW * 3); }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw, { level: 6 })), ch("IEND", Buffer.alloc(0))]));
  console.log(`\n    [map] ${layer || "political"} → ${file}  (${OW}x${OH})`);
}

if (EVERY > 0) {
  for (let t = EVERY; t <= STEPS; t += EVERY) { stepPeopleSim(world, EVERY); console.log(`\n\n################ STEP ${t} ################`); snapshot(world); }
} else {
  stepPeopleSim(world, STEPS);
  snapshot(world);
}
const PNG = arg("png", null);
if (PNG) writePng(world, PNG, arg("png-layer", null));
if (JSON_OUT) console.log("\n<<<JSON>>>\n" + JSON.stringify(out, (k, v) => (v === Infinity ? "Inf" : v === -Infinity ? "-Inf" : v), 1));
