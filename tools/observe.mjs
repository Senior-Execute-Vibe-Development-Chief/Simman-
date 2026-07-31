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
// Sections: run, fields, population, nations, economy, trade, roads, war, culture,
//           knowledge, events, ages. Default: all.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { stepToYear } from "../src/sim/calendar.js";

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

if (EVERY > 0) {
  for (let t = EVERY; t <= STEPS; t += EVERY) { stepPeopleSim(world, EVERY); console.log(`\n\n################ STEP ${t} ################`); snapshot(world); }
} else {
  stepPeopleSim(world, STEPS);
  snapshot(world);
}
if (JSON_OUT) console.log("\n<<<JSON>>>\n" + JSON.stringify(out, (k, v) => (v === Infinity ? "Inf" : v === -Infinity ? "-Inf" : v), 1));
