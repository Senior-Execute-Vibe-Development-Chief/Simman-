// Score the moisture solver against OBSERVED precipitation.
//
//   node tools/probe_precip_truth.mjs [W]
//
// Loads data/global_precip.json (NCEP/NCAR 1991-2020 monthly climatology, built by
// tools/convert_precip_data.py) and compares it, land pixel by land pixel, with the
// model's moisture field. This is validation only — nothing in src/ reads the data.
//
// The model's `moisture` is a 0-1 index, not mm, so absolute error is meaningless.
// What IS meaningful, and what this reports:
//   * SPEARMAN rank correlation — does the model order the world's wet and dry places
//     correctly? That is the question the biome map actually depends on.
//   * The worst-ranked outliers — where the model disagrees most with observation,
//     which is the to-do list.
//   * DRY-SEASON LENGTH — the model now computes dryFrac from three seasonal solves;
//     observed monthly data gives the truth directly (a month under 60mm is the Koppen
//     dry-month threshold), so this scores the mechanism that decides savanna vs forest.
import { readFileSync } from "node:fs";
import { generateWorld } from "../src/sim/worldgen.js";

const W = +(process.argv[2] || 1920), H = W >> 1;
const P = JSON.parse(readFileSync(new URL("../data/global_precip.json", import.meta.url)));

// bilinear sample of the Gaussian grid (lat descends N->S, lon 0..360)
const LAT = P.lat, LON = P.lon, NLAT = LAT.length, NLON = LON.length;
function sampleMonth(m, la, lo) {
  lo = ((lo % 360) + 360) % 360;
  let j = 0; while (j < NLAT - 2 && LAT[j + 1] > la) j++;
  const t = (LAT[j] - la) / (LAT[j] - LAT[j + 1] || 1);
  const di = lo / (360 / NLON), i0 = Math.floor(di) % NLON, i1 = (i0 + 1) % NLON, u = di - Math.floor(di);
  const g = P.months[m];
  const a = g[j][i0], b = g[j][i1], c = g[j + 1][i0], d = g[j + 1][i1];
  if (a == null || b == null || c == null || d == null) return null;
  return (a * (1 - u) + b * u) * (1 - t) + (c * (1 - u) + d * u) * t;
}
function observed(la, lo) {
  let ann = 0, dryMonths = 0;
  for (let m = 0; m < 12; m++) {
    const v = sampleMonth(m, la, lo);
    if (v == null) return null;
    ann += v * 30.4;                       // mm/day -> mm/month
    if (v * 30.4 < 60) dryMonths++;        // Koppen dry-month threshold
  }
  return { ann, dryFrac: dryMonths / 12 };
}

console.error(`[gen] ${W}x${H} ...`);
const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, false, {});

// Sample on a coarse grid — the observation is 1.9° native, so finer adds nothing.
const STEP = Math.max(1, Math.round(W / 360));
const pts = [];
for (let y = 0; y < H; y += STEP) {
  const la = 90 - (y + 0.5) / H * 180;
  if (Math.abs(la) > 82) continue;                       // reanalysis is poor over the caps
  for (let x = 0; x < W; x += STEP) {
    const i = y * W + x;
    if (w.elevation[i] <= 0) continue;
    const lo = (x + 0.5) / W * 360 - 180;
    const o = observed(la, lo);
    if (!o) continue;
    pts.push({ la, lo, m: w.moisture[i], d: w.dryFrac ? w.dryFrac[i] : 0, obs: o.ann, obsDry: o.dryFrac });
  }
}
console.log(`\n${pts.length.toLocaleString()} land points scored against NCEP observation\n`);

function spearman(a, b) {
  const rank = v => { const s = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length);
    for (let k = 0; k < s.length;) { let e = k; while (e < s.length && s[e][0] === s[k][0]) e++;
      const avg = (k + e - 1) / 2; for (let z = k; z < e; z++) r[s[z][1]] = avg; k = e; } return r; };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((p, q) => p + q, 0) / n, mb = rb.reduce((p, q) => p + q, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = ra[i] - ma, y = rb[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
}

const rho = spearman(pts.map(p => p.m), pts.map(p => p.obs));
console.log(`ANNUAL WETNESS — Spearman rank correlation model vs observed:  ${rho.toFixed(3)}`);
console.log(`  (1.0 = the model orders every place correctly; 0 = no relationship)`);

const withDry = pts.filter(p => p.d > 0 || p.obsDry > 0);
if (withDry.length > 50) {
  const rd = spearman(withDry.map(p => p.d), withDry.map(p => p.obsDry));
  console.log(`\nDRY-SEASON LENGTH — Spearman, model dryFrac vs observed dry months: ${rd.toFixed(3)}`);
  let se = 0; for (const p of withDry) se += Math.abs(p.d - p.obsDry);
  console.log(`  mean |error| in fraction-of-year-dry: ${(se / withDry.length).toFixed(3)}`);
}

// ── worst disagreements, by rank gap ──
const rankOf = arr => { const s = arr.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(arr.length);
  s.forEach(([, i], k) => r[i] = k / (arr.length - 1)); return r; };
const rm = rankOf(pts.map(p => p.m)), ro = rankOf(pts.map(p => p.obs));
pts.forEach((p, i) => { p.gap = rm[i] - ro[i]; });

const show = (title, list) => {
  console.log(`\n${title}`);
  console.log('    lat    lon   model m   observed mm/yr   rank gap');
  for (const p of list) console.log(`  ${p.la.toFixed(0).padStart(5)} ${p.lo.toFixed(0).padStart(6)}    ${p.m.toFixed(3)}      ${p.obs.toFixed(0).padStart(6)}        ${(p.gap >= 0 ? '+' : '') + p.gap.toFixed(2)}`);
};
const sorted = [...pts].sort((a, b) => a.gap - b.gap);
show('MODEL FAR TOO DRY  (observation says wet, model says dry)', sorted.slice(0, 15));
show('MODEL FAR TOO WET  (observation says dry, model says wet)', sorted.slice(-15).reverse());

// ── named regions, so the numbers are legible ──
const REG = [['Yunnan/SW China',98,107,22,29],['Sichuan',103,107,28,32],['Mid-Yangtze',108,118,27,32],
  ['E China',112,120,27,33],['Ganges',75,88,24,29],['Sahara',-5,25,20,28],['Sahel',-10,25,12,16],
  ['Congo',15,28,-4,4],['Amazon',-70,-52,-8,2],['E Africa',32,40,-4,4],['Llanos',-70,-63,4,9],
  ['Cerrado',-55,-45,-18,-10],['Taklamakan',78,88,37,41],['Gobi',100,110,42,46],['W Siberia',60,90,55,65]];
console.log('\nBY REGION — model moisture vs observed rainfall');
console.log('  region            model m   obs mm/yr   model dryFrac   obs dryFrac');
for (const [n, a, b, c, d] of REG) {
  const sel = pts.filter(p => p.lo >= a && p.lo <= b && p.la >= c && p.la <= d);
  if (!sel.length) continue;
  const av = f => sel.reduce((s, p) => s + p[f], 0) / sel.length;
  console.log(`  ${n.padEnd(16)}  ${av('m').toFixed(3)}     ${av('obs').toFixed(0).padStart(5)}         ${av('d').toFixed(2)}          ${av('obsDry').toFixed(2)}`);
}
