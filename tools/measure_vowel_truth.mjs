// Measure the HUMAN ground truth the tract is calibrated against: for every
// vowel quality the generator can emit that has a recording in the bank
// (assets/ipa-audio), decode it, isolate the longest sustained take, and
// LPC-measure F0 + F1..F3 with the same code voice.mjs measures the tract
// with (tools/lib/formants.mjs). Writes assets/ipa-audio/formants.json.
//
//   node tools/measure_vowel_truth.mjs
//
// Decoding uses headless Chromium (OfflineAudioContext) because Node ships no
// ogg/vorbis decoder; measurement happens back in Node so the numbers come
// from the shared library, not a re-implementation.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { ipaV } from "../src/sim/languagePhonetics.js";
import { IPA_CLIPS } from "../src/sim/ipaAudioManifest.js";
import { estimateF0, estimateFormants } from "./lib/formants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO = join(ROOT, "assets", "ipa-audio");
const SR = 44100, DSR = SR / 4;

// every (height, backness, round, ATR) quality with a recording
const targets = [];
for (let h = 0; h <= 2; h++) for (let b = 0; b <= 2; b++) for (const r of [0, 1]) for (const atr of [0, 1]) {
  const sym = ipaV({ h, b, r, atr, n: 0, lg: 0, ph: 0 });
  const file = IPA_CLIPS[sym];
  if (file && !targets.some(t => t.sym === sym)) targets.push({ sym, h, b, r, atr, file });
}
console.log(`${targets.length} recorded vowel qualities to measure`);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium", headless: true });
const page = await browser.newPage();
await page.goto("about:blank");

// decode + longest-take isolation + ×4 box decimation, all in-page; PCM
// returns to Node small (11 kHz mono take)
async function decodeTake(file) {
  const b64 = readFileSync(join(AUDIO, file)).toString("base64");
  return await page.evaluate(async ({ b64, SR }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ctx = new OfflineAudioContext(1, 1, SR);
    const buf = await ctx.decodeAudioData(bytes.buffer);
    const d = buf.getChannelData(0);
    // energy segmentation (10 ms windows, ≥90 ms silence splits takes)
    const win = (buf.sampleRate * 0.01) | 0, n = Math.floor(d.length / win);
    let peak = 0;
    const rms = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = i * win, e = j + win; j < e; j++) s += d[j] * d[j];
      rms[i] = Math.sqrt(s / win);
      if (rms[i] > peak) peak = rms[i];
    }
    const floor = Math.max(peak * 0.06, 0.004);
    const segs = [];
    let a = -1, lastOn = -1;
    for (let i = 0; i < n; i++) {
      if (rms[i] > floor) { if (a < 0) a = i; lastOn = i; }
      else if (a >= 0 && i - lastOn > 9) { if (lastOn - a >= 3) segs.push([a * win, (lastOn + 1) * win]); a = -1; }
    }
    if (a >= 0 && lastOn - a >= 3) segs.push([a * win, (lastOn + 1) * win]);
    if (!segs.length) segs.push([0, d.length]);
    const [s0, s1] = segs.reduce((best, s) => (s[1] - s[0] > best[1] - best[0] ? s : best));
    const m = Math.floor((s1 - s0) / 4), out = new Array(m);
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < 4; j++) s += d[s0 + i * 4 + j];
      out[i] = s / 4;
    }
    return { pcm: out, srIn: buf.sampleRate };
  }, { b64, SR });
}

const truth = {};
for (const t of targets) {
  const { pcm } = await decodeTake(t.file);
  const x = Float32Array.from(pcm);
  // three windows across the steady middle; per-formant median defends
  // against one window's spurious LPC peak
  const wins = [0.3, 0.45, 0.6].map(at => estimateFormants(x, DSR, at, 1).filter(f => f >= 180));
  const F = [0, 1, 2].map(k => {
    const vals = wins.map(w => w[k]).filter(Boolean).sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)] : null;
  }).filter(Boolean);
  const f0 = estimateF0(x, DSR);
  truth[t.sym] = { h: t.h, b: t.b, r: t.r, atr: t.atr, file: t.file, f0: Math.round(f0), F: F.map(Math.round), takeSec: +(x.length / DSR).toFixed(2) };
  console.log(`  [${t.sym}]  F0=${Math.round(f0)}  F=[${F.map(Math.round).join(" ")}]  take=${truth[t.sym].takeSec}s`);
}
await browser.close();

const out = join(AUDIO, "formants.json");
writeFileSync(out, JSON.stringify(truth, null, 1) + "\n");
console.log(`wrote ${out} (${Object.keys(truth).length} vowels)`);
