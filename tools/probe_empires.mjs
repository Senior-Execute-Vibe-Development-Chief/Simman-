// Anatomy of the great powers over a LONG run: who the top realms are, how they
// acquired their members (war capture vs peaceful absorption), whether they ever
// FALL — plus per-checkpoint counts of the birth/death flows and an optional
// political-map PNG at the final step. This is the empire-MORTALITY instrument:
// the stylized suite's distributional gates (share %, tail ratios) all pass a
// world whose top realms are immortal, and the 15k CI horizon ends before the
// frozen-leaderboard regime sets in (~step 16k+) — this probe at 24k steps is
// what actually caught it (docs/country-count-size-diagnosis.md). Healthy runs
// show the top-5 turning over between checkpoints and former giants leaving the
// board; the immortal regime showed the same two realms on top at every
// checkpoint with age == the full run length.
// COUNTER SEMANTICS under the default TILE_WAR (learned at the 960 loop-closure):
// every storm falls on the defender's CAPITAL (the adapter's home), and a capital
// fall logs `polity.shattered` (armies.js), NOT `settlement.captured` — so
// `captured=` counts non-capital city captures, which tile-war structurally
// almost never produces. captured=0 does NOT mean "war is dead": READ `shattered`
// FOR WAR REALM-KILLS (it has exactly one mechanism emitter, the capital storm).
//   node tools/probe_empires.mjs [steps] [W] [seed] [out.png]
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 24000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const OUT = process.argv[5] || "";
const world = buildSim({ W, H, seed: SEED });

const kmPerTile = 510e6 / (world.tw * world.th);
for (const ck of [8000, 12000, 16000, 20000, STEPS]) {
  if (ck > STEPS) break;
  while (world.step < ck) stepPeopleSim(world, 1);
  const co = world._countryOwner;
  const tiles = new Map(); let landN = 0, claimed = 0;
  for (let ti = 0; ti < world.N; ti++) { if (!(world.elev[ti] > 0)) continue; landN++; const c = co ? co[ti] : -1; if (c >= 0) { claimed++; tiles.set(c, (tiles.get(c) || 0) + 1); } }
  const members = new Map();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) { let a = members.get(s.countryId); if (!a) members.set(s.countryId, a = []); a.push(s); }
  // acquisition flows per realm (cumulative events)
  const gainWar = new Map(), gainAbsorb = new Map();
  let seceded = 0, ended = 0, shattered = 0;
  for (const ev of world.events || []) {
    if (ev.type === "settlement.captured" && ev.to >= 0) gainWar.set(ev.to, (gainWar.get(ev.to) || 0) + 1);
    if (ev.type === "settlement.annexed" && ev.to >= 0) gainAbsorb.set(ev.to, (gainAbsorb.get(ev.to) || 0) + 1);
    if (ev.type === "polity.seceded") seceded++;
    if (ev.type === "polity.ended") ended++;
    if (ev.type === "polity.shattered") shattered++;
  }
  const rows = [...tiles.entries()].map(([c, t]) => ({ c, t, mem: (members.get(c) || []).length })).sort((a, b) => b.t - a.t);
  console.log(`\n=== step ${ck}: realms=${rows.length} claimed=${(100 * claimed / landN).toFixed(1)}% | global flows: captured=${[...gainWar.values()].reduce((x, y) => x + y, 0)} annexed=${[...gainAbsorb.values()].reduce((x, y) => x + y, 0)} seceded=${seceded} shattered=${shattered} ended=${ended}`);
  for (const r of rows.slice(0, 5)) {
    const p = world.polities && world.polities.get(r.c);
    const mem = members.get(r.c) || [];
    const cap = mem.reduce((best, s) => ((s.knowledge?.organization || 0) > (best?.knowledge?.organization || 0) ? s : best), null);
    const age = p ? world.step - p.foundedStep : -1;
    console.log(`  #${r.c} "${p?.name || "?"}" tiles=${r.t} (${(r.t * kmPerTile / 1e6).toFixed(1)}M km2) members=${r.mem} capOrg=${(cap?.knowledge?.organization || 0).toFixed(2)} age=${age} | gained: war=${gainWar.get(r.c) || 0} absorb=${gainAbsorb.get(r.c) || 0}`);
  }
}

if (OUT) {
  const co = world._countryOwner, tw = world.tw, th = world.th;
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const png = (w, h, rgb) => { const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, "ascii"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b), 0); return Buffer.concat([l, b, c]); }; const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const st = w * 3 + 1, raw = Buffer.alloc(st * h); for (let y = 0; y < h; y++) { raw[y * st] = 0; rgb.copy(raw, y * st + 1, y * w * 3, (y + 1) * w * 3); } return Buffer.concat([sig, ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw, { level: 6 })), ch("IEND", Buffer.alloc(0))]); };
  const rgb = Buffer.alloc(tw * th * 3);
  for (let i = 0; i < tw * th; i++) {
    let r, g, b;
    if (world.elev[i] <= 0) { r = 18; g = 30; b = 62; }
    else if (co[i] < 0) { r = 92; g = 88; b = 78; }
    else { const h = ((co[i] * 137) % 360) * Math.PI / 180; r = 128 + 100 * Math.cos(h); g = 128 + 100 * Math.cos(h + 2.09); b = 128 + 100 * Math.cos(h + 4.19); }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
  }
  // border darkening
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const i = y * tw + x; if (co[i] < 0) continue; const rt = co[y * tw + ((x + 1) % tw)], dn = y < th - 1 ? co[i + tw] : co[i]; if (rt !== co[i] || dn !== co[i]) { rgb[i * 3] *= 0.4; rgb[i * 3 + 1] *= 0.4; rgb[i * 3 + 2] *= 0.4; } }
  writeFileSync(OUT, png(tw, th, rgb));
  console.log(`wrote ${OUT}`);
}
