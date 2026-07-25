// Windowed scorer for the RES_INV_RIVER 1920 battery (backlog #11/#12): reads
// the resumable batteries' series + checkpoint artifacts under bench/ and
// prints the lever's off-vs-on verdict per seed over the mature window —
// median realm count, top-realm size (members fine-grained; tiles at the
// deep checkpoints), claimed-% of land, population, settlements.
//   node tools/score_resinv.mjs [windowStart=16000] [prefix=resinv1920] [seeds=8817,31337]
// Arms are <prefix>_{off,on}_<seed>.* as launched by battery_resumable.mjs.
import fs from "fs";

const WIN = parseInt(process.argv[2] || "16000", 10);
const PREFIX = process.argv[3] || "resinv1920";
const SEEDS = (process.argv[4] || "8817,31337").split(",");
const DIR = new URL("../bench/", import.meta.url).pathname;

const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const fmt = (x, d = 0) => Number.isFinite(x) ? x.toFixed(d) : "—";

function armStats(name) {
  const sf = DIR + name + ".series.jsonl", cf = DIR + name + ".json";
  if (!fs.existsSync(sf)) return null;
  const rows = fs.readFileSync(sf, "utf8").split("\n").filter(Boolean).map(JSON.parse).filter(r => r.step >= WIN);
  const st = {
    n: rows.length,
    lastStep: rows.length ? rows[rows.length - 1].step : 0,
    countries: med(rows.map(r => r.countries)),
    top1: med(rows.map(r => +(r.top5Members || "0").split(",")[0])),
    landPct: med(rows.filter(r => r.landPct != null).map(r => r.landPct)),
    pop: med(rows.map(r => r.pop)),
    setts: med(rows.map(r => r.setts)),
    urbanPct: med(rows.map(r => r.urbanPct)),
    ckpts: [],
  };
  if (fs.existsSync(cf)) {
    const rec = JSON.parse(fs.readFileSync(cf, "utf8"));
    for (const c of rec.checkpoints || []) if (c.step >= WIN) {
      const top = (c.rows && c.rows[0]) || {};
      st.ckpts.push({ step: c.step, countries: c.countries, topTiles: top.tiles || 0, topName: top.name || "?" });
    }
  }
  return st;
}

for (const seed of SEEDS) {
  console.log(`\n────────── seed ${seed} · window ≥${WIN} ──────────`);
  const off = armStats(`${PREFIX}_off_${seed}`), on = armStats(`${PREFIX}_on_${seed}`);
  for (const [label, s] of [["off", off], ["on ", on]]) {
    if (!s) { console.log(`  ${label}: no artifacts yet`); continue; }
    console.log(`  ${label}: ${s.n} rows to step ${s.lastStep} · realms ${fmt(s.countries)} · top1 ${fmt(s.top1)} members · claimed ${fmt(s.landPct, 1)}% · pop ${fmt(s.pop)} · setts ${fmt(s.setts)} · urban ${fmt(s.urbanPct, 1)}%`);
    for (const c of s.ckpts) console.log(`       ckpt ${c.step}: ${c.countries} realms · top "${c.topName}" ${c.topTiles} tiles`);
  }
  if (off && on && off.n && on.n) {
    const rat = (k, d = 2) => fmt(on[k] / off[k], d);
    console.log(`  on/off: realms ×${rat("countries")} · top1 ×${rat("top1")} · claimed ×${rat("landPct")} · pop ×${rat("pop")} · setts ×${rat("setts")}`);
  }
}
