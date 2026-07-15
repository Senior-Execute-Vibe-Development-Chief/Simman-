// ── Voice Lab (diagnostic) — UI/logic appended after the inlined vocalTract ──
// This file is concatenated after the VERBATIM src/sim/vocalTract.js by
// tools/build_voicelab.mjs, in the same module scope — so renderScore,
// scorePlan, scoreClause and DSP below are the REAL engine's, not a copy.
// The whole point: hear/see the actual engine in isolation, and prove whether
// the muffle/artifacts live in the synthesis or in the Lab's playback path.

const DSP_DEFAULTS = { ...DSP };
const S = {
  radiate: true, radAmt: 0.97, normalize: true,
  lp: false, lpHz: 8000, presence: 0,
  pitch: 105, seed: 12345, lastX: null, lastName: "",
};

// ── phonetic-plan builders (same shapes tools/voice.mjs feeds the engine) ──
const V = (h, b, r, e = {}) => ({ h, b, r, n: 0, lg: 0, ph: 0, atr: 0, ...e });
const C = (p, m, l = 0, s = 0) => ({ p, m, l, s });
const vowelPlan = (v) => ({ syls: [{ on: [], nu: [{ ...v, lg: 1 }], co: [], tone: null }], stress: 0, tone: 0, pitchAccent: false });
const cvPlan = (c, v) => ({ syls: [{ on: [c], nu: [v], co: [], tone: null }], stress: 0, tone: 0, pitchAccent: false });
const word = (syls) => ({ syls: syls.map((s) => ({ tone: null, co: [], ...s })), stress: 0, tone: 0, pitchAccent: false });

const VOWELS = [
  ["i", vowelPlan(V(0, 0, 0))], ["e", vowelPlan(V(1, 0, 0))], ["æ", vowelPlan(V(2, 0, 0))], ["a", vowelPlan(V(2, 1, 0))],
  ["ə", vowelPlan(V(1, 1, 0))], ["ɔ", vowelPlan(V(2, 1, 1))], ["o", vowelPlan(V(1, 2, 1))], ["u", vowelPlan(V(0, 2, 1))], ["ɯ", vowelPlan(V(0, 2, 0))],
];
const WORDS = [
  ["mala", word([{ on: [C(0, 1, 1)], nu: [V(2, 1, 0)] }, { on: [C(1, 4, 1)], nu: [V(2, 1, 0)] }])],
  ["kitanu", word([{ on: [C(4, 0, 0)], nu: [V(0, 0, 0)] }, { on: [C(1, 0, 0)], nu: [V(2, 1, 0)] }, { on: [C(1, 1, 1)], nu: [V(0, 2, 1)] }])],
  ["nipaba", word([{ on: [C(1, 1, 1)], nu: [V(0, 0, 0)] }, { on: [C(0, 0, 0)], nu: [V(2, 1, 0)] }, { on: [C(0, 0, 1)], nu: [V(2, 1, 0)] }])],
  ["wani", word([{ on: [C(0, 6, 1)], nu: [V(2, 1, 0)] }, { on: [C(1, 1, 1)], nu: [V(0, 0, 0)] }])],
  ["unna", word([{ on: [], nu: [V(0, 2, 1)] }, { on: [C(1, 1, 1)], nu: [V(2, 1, 0)] }])],
  ["ibi", word([{ on: [], nu: [V(0, 0, 0)] }, { on: [C(0, 0, 1)], nu: [V(0, 0, 0)] }])],
  ["sila", word([{ on: [C(1, 2, 0)], nu: [V(0, 0, 0)] }, { on: [C(1, 4, 1)], nu: [V(2, 1, 0)] }])],
];
const CLAUSE = { groups: [[WORDS[2][1], WORDS[3][1]]], contour: "fall" };

// ── post-fx (JS, so the drawn spectrum == exactly what you hear) ──────────
function radiate(x, coef) {
  let e0 = 0; for (let i = 0; i < x.length; i++) e0 += x[i] * x[i];
  const y = new Float32Array(x.length); let xp = 0;
  for (let i = 0; i < x.length; i++) { y[i] = x[i] - coef * xp; xp = x[i]; }
  let e1 = 0; for (let i = 0; i < y.length; i++) e1 += y[i] * y[i];
  const g = Math.sqrt(e0 / (e1 || 1e-9)); for (let i = 0; i < y.length; i++) y[i] *= g;
  return y;
}
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i]; const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi; }
  return y;
}
function lowpass(x, fc, sr) {
  const w = 2 * Math.PI * fc / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * 0.707);
  const a0 = 1 + al; return biquad(x, (1 - cs) / 2 / a0, (1 - cs) / a0, (1 - cs) / 2 / a0, -2 * cs / a0, (1 - al) / a0);
}
function highshelf(x, fc, dbGain, sr) {
  const A = Math.pow(10, dbGain / 40), w = 2 * Math.PI * fc / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / 2 * Math.sqrt(2), ap = 2 * Math.sqrt(A) * al;
  const a0 = (A + 1) - (A - 1) * cs + ap;
  return biquad(x, A * ((A + 1) + (A - 1) * cs + ap) / a0, -2 * A * ((A - 1) + (A + 1) * cs) / a0, A * ((A + 1) + (A - 1) * cs - ap) / a0, 2 * ((A - 1) - (A + 1) * cs) / a0, ((A + 1) - (A - 1) * cs - ap) / a0);
}
function normalizePeak(x, target = 0.9) {
  let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  if (pk < 1e-6) return x; const g = target / pk; const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; return y;
}

// ── FFT (iterative radix-2) for the spectrum + spectrogram ────────────────
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k]; const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } } }
}
function magSpectrum(x, start, Nfft) {
  const re = new Float64Array(Nfft), im = new Float64Array(Nfft);
  for (let i = 0; i < Nfft; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (Nfft - 1)); re[i] = (x[start + i] || 0) * w; }
  fft(re, im); const m = new Float64Array(Nfft / 2); for (let i = 0; i < Nfft / 2; i++) m[i] = Math.hypot(re[i], im[i]); return m;
}

// ── render + play + draw ──────────────────────────────────────────────────
let AC = null;
function ac() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); return AC; }
function synth(plan, isClause) {
  Object.assign(DSP, DSP_DEFAULTS, engineOverrides());
  const sr = ac().sampleRate;
  const score = isClause ? scoreClause(plan.groups, plan.contour) : scorePlan(plan);
  if (S.pitch !== 105 && score.tracks.frequency) { const k = S.pitch / 105; score.tracks.frequency = score.tracks.frequency.map((p) => ({ t: p.t, v: p.v * k })); }
  let x = renderScore(score, sr, S.seed);
  if (S.radiate) x = radiate(x, S.radAmt);
  if (S.presence !== 0) x = highshelf(x, 2800, S.presence, sr);
  if (S.lp) x = lowpass(x, S.lpHz, sr);
  x = S.normalize ? normalizePeak(x, 0.92) : x;
  return { x, sr };
}
function engineOverrides() {
  return { hf: +hf.value, damp: +damp.value, glottalRefl: +grefl.value, wallLoss: +wloss.value };
}
function play(plan, name, isClause) {
  let r; try { r = synth(plan, isClause); } catch (e) { readout.textContent = "render error: " + e.message; return; }
  S.lastX = r.x; S.lastName = name;
  const buf = ac().createBuffer(1, r.x.length, r.sr); buf.getChannelData(0).set(r.x);
  const src = ac().createBufferSource(); src.buffer = buf; src.connect(ac().destination); src.start();
  draw(r.x, r.sr, name);
}
function replay() { const item = ALL[S.lastName]; if (item) play(item.plan, S.lastName, item.clause); }

function bandBalance(x, sr) {
  const N = 8192, start = Math.floor(x.length * 0.42), m = magSpectrum(x, start, N);
  const ed = [0, 500, 1500, 2500, 4000, 8000], E = new Array(5).fill(0);
  for (let i = 0; i < N / 2; i++) { const f = i * sr / N, p = m[i] * m[i]; for (let b = 0; b < 5; b++) if (f >= ed[b] && f < ed[b + 1]) E[b] += p; }
  const tot = E.reduce((s, e) => s + e, 0) || 1e-12; return E.map((e) => 10 * Math.log10(e / tot + 1e-12));
}

// spectrum canvas: log-freq x, dB y, with the formant-band guides
function drawSpectrum(x, sr) {
  const c = spec, ctx = c.getContext("2d"), W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#0b0f16"; ctx.fillRect(0, 0, W, H);
  const N = 8192, start = Math.floor(x.length * 0.42), m = magSpectrum(x, start, N);
  let mx = 0; for (let i = 1; i < N / 2; i++) mx = Math.max(mx, m[i]);
  const fmin = 80, fmax = 12000, lx = (f) => (Math.log10(f / fmin) / Math.log10(fmax / fmin)) * W;
  ctx.strokeStyle = "#1d2635"; ctx.fillStyle = "#5b6b82"; ctx.font = "10px ui-monospace,monospace";
  for (const f of [100, 500, 1000, 2000, 4000, 8000]) { const px = lx(f); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); ctx.fillText(f >= 1000 ? f / 1000 + "k" : f, px + 2, H - 3); }
  // shade the 1.5-3k "presence/F2" band that carries vowel identity
  ctx.fillStyle = "rgba(90,150,255,0.08)"; ctx.fillRect(lx(1500), 0, lx(3000) - lx(1500), H);
  ctx.fillStyle = "#6fa8ff"; ctx.fillText("F2/presence", lx(1500) + 3, 12);
  ctx.beginPath(); ctx.strokeStyle = "#65d6a0"; ctx.lineWidth = 1.5;
  for (let i = 1; i < N / 2; i++) { const f = i * sr / N; if (f < fmin || f > fmax) continue; const db = 20 * Math.log10(m[i] / mx + 1e-9); const py = H - (Math.max(-80, db) + 80) / 80 * H; const px = lx(f); i === 1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
  ctx.stroke();
}
// spectrogram canvas: time x, freq y (0-8k), magnitude as heat
function drawSpectrogram(x, sr) {
  const c = sgram, ctx = c.getContext("2d"), W = c.width, H = c.height;
  ctx.fillStyle = "#0b0f16"; ctx.fillRect(0, 0, W, H);
  const Nf = 1024, hop = Math.max(1, Math.floor((x.length - Nf) / W)), fmax = 8000, kmax = Math.floor(fmax / (sr / Nf));
  const img = ctx.createImageData(W, H);
  for (let col = 0; col < W; col++) {
    const st = col * hop; if (st + Nf >= x.length) break;
    const m = magSpectrum(x, st, Nf);
    for (let row = 0; row < H; row++) {
      const k = Math.floor((1 - row / H) * kmax); const v = m[k] || 0;
      const db = 20 * Math.log10(v + 1e-6); const t = Math.max(0, Math.min(1, (db + 70) / 70));
      const idx = (row * W + col) * 4; // simple magma-ish ramp
      img.data[idx] = 255 * Math.min(1, t * 1.6); img.data[idx + 1] = 255 * Math.max(0, t * t * 1.2 - 0.1); img.data[idx + 2] = 255 * Math.max(0, 0.3 * t + t * t * t); img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
function draw(x, sr, name) {
  drawSpectrum(x, sr); drawSpectrogram(x, sr);
  const bb = bandBalance(x, sr).map((d) => d.toFixed(0));
  let pk = 0, rms = 0; for (let i = 0; i < x.length; i++) { pk = Math.max(pk, Math.abs(x[i])); rms += x[i] * x[i]; } rms = Math.sqrt(rms / x.length);
  readout.innerHTML = `<b>${name}</b> &nbsp; peak ${pk.toFixed(2)} · rms ${rms.toFixed(3)} &nbsp;|&nbsp; band energy (dB): ` +
    `0–500 <b>${bb[0]}</b> · .5–1.5k <b>${bb[1]}</b> · <span style="color:#6fa8ff">1.5–2.5k <b>${bb[2]}</b></span> · 2.5–4k <b>${bb[3]}</b> · 4–8k <b>${bb[4]}</b>` +
    `<br><span class="hint">The 1.5–2.5k band (blue) is where vowel identity lives. If it sits far below the low bands, the vowel reads muffled/centralized — that's the geometry, and no engine slider here moves it much.</span>`;
}

// ── build the DOM ──────────────────────────────────────────────────────────
const ALL = {};
function el(tag, attrs, kids) { const e = document.createElement(tag); for (const k in (attrs || {})) k === "text" ? (e.textContent = attrs[k]) : e.setAttribute(k, attrs[k]); (kids || []).forEach((c) => e.appendChild(c)); return e; }
const app = document.getElementById("app");
function h(t) { const e = document.createElement("div"); e.innerHTML = t; return e.firstChild; }
function section(title, sub) { const s = el("div", { class: "card" }); s.appendChild(h(`<h2>${title}${sub ? ` <span class="sub">${sub}</span>` : ""}</h2>`)); return s; }
function playRow(items, isClause) { const row = el("div", { class: "row" }); items.forEach(([label, plan]) => { ALL[label] = { plan, clause: isClause }; const b = el("button", { class: "pill", text: label }); b.onclick = () => play(plan, label, isClause); row.appendChild(b); }); return row; }

app.appendChild(h(`<div class="head"><h1>Voice Lab <span class="tag">diagnostic</span></h1>
<p>Runs the <b>verbatim <code>src/sim/vocalTract.js</code></b> engine in your browser and renders each sound offline — the same DSP the Lab and the published gen use. So if it's muffled here, the synthesis is the cause, not the bundle. Toggle the fix (lip radiation) and the "artifact confound" (the 8&nbsp;kHz playback low-pass the Lab adds) to hear the difference. Pick a sound; watch the spectrum.</p></div>`));

const cSounds = section("Sounds");
cSounds.appendChild(h(`<div class="lbl">sustained vowels</div>`));
cSounds.appendChild(playRow(VOWELS, false));
cSounds.appendChild(h(`<div class="lbl">words</div>`));
cSounds.appendChild(playRow(WORDS, false));
cSounds.appendChild(h(`<div class="lbl">clause (prosody)</div>`));
cSounds.appendChild(playRow([["nipaba wani", CLAUSE]], true));
app.appendChild(cSounds);

const cFix = section("Fix &amp; playback", "post-render, re-plays instantly");
function toggle(label, key, hint) { const id = "t_" + key; const wrap = el("label", { class: "ctl" }); const cb = el("input", { type: "checkbox", id }); if (S[key]) cb.setAttribute("checked", ""); cb.onchange = () => { S[key] = cb.checked; if (S.lastName) replay(); }; wrap.appendChild(cb); wrap.appendChild(h(`<span>${label} <span class="hint">${hint || ""}</span></span>`)); return wrap; }
function slider(label, key, min, max, step, fmt, live) { const wrap = el("div", { class: "ctl" }); const out = el("span", { class: "val" }); const r = el("input", { type: "range", min, max, step, value: S[key] }); const upd = () => { S[key] = +r.value; out.textContent = (fmt ? fmt(+r.value) : r.value); }; r.oninput = () => { upd(); }; r.onchange = () => { if (live && S.lastName) replay(); }; upd(); wrap.appendChild(h(`<span>${label}</span>`)); wrap.appendChild(r); wrap.appendChild(out); return wrap; }
cFix.appendChild(toggle("Lip radiation (the fix)", "radiate", "+6 dB/oct — un-muffles the tilt"));
cFix.appendChild(slider("· radiation amount", "radAmt", 0.90, 1.0, 0.005, (v) => v.toFixed(3), true));
cFix.appendChild(slider("Presence shelf @2.8k (dB)", "presence", -6, 12, 1, (v) => (v > 0 ? "+" : "") + v, true));
cFix.appendChild(toggle("Peak-normalize", "normalize", "even out per-sound loudness"));
cFix.appendChild(toggle("Playback low-pass (artifact confound)", "lp", "the Lab adds this on output"));
cFix.appendChild(slider("· low-pass cutoff (Hz)", "lpHz", 3000, 12000, 250, (v) => v + "", true));
app.appendChild(cFix);

const cEng = section("Engine", "re-renders — prove these don't fix the muffle");
const hf = el("input", { type: "range", min: 0.80, max: 1.0, step: 0.005, value: DSP.hf });
const damp = el("input", { type: "range", min: 0.990, max: 0.9998, step: 0.0002, value: DSP.damp });
const grefl = el("input", { type: "range", min: 0.80, max: 0.99, step: 0.005, value: DSP.glottalRefl });
const wloss = el("input", { type: "range", min: 0, max: 2, step: 0.05, value: DSP.wallLoss });
const pitch = el("input", { type: "range", min: 70, max: 160, step: 1, value: S.pitch });
function engRow(label, r, key) { const wrap = el("div", { class: "ctl" }); const out = el("span", { class: "val" }); const upd = () => { out.textContent = r.value; if (key) S[key] = +r.value; }; r.oninput = upd; r.onchange = () => { if (S.lastName) replay(); }; upd(); wrap.appendChild(h(`<span>${label}</span>`)); wrap.appendChild(r); wrap.appendChild(out); return wrap; }
cEng.appendChild(engRow("HF loss (DSP.hf)", hf));
cEng.appendChild(engRow("damp (DSP.damp)", damp));
cEng.appendChild(engRow("glottal reflection", grefl));
cEng.appendChild(engRow("wall loss", wloss));
cEng.appendChild(engRow("pitch F0 (Hz)", pitch, "pitch"));
const reset = el("button", { class: "pill ghost", text: "reset engine" }); reset.onclick = () => { hf.value = DSP_DEFAULTS.hf; damp.value = DSP_DEFAULTS.damp; grefl.value = DSP_DEFAULTS.glottalRefl; wloss.value = DSP_DEFAULTS.wallLoss; pitch.value = 105; S.pitch = 105;[hf, damp, grefl, wloss, pitch].forEach((r) => r.dispatchEvent(new Event("input"))); if (S.lastName) replay(); };
cEng.appendChild(reset);
app.appendChild(cEng);

const cAna = section("Analysis", "of the last sound played");
cAna.appendChild(h(`<div class="canvas-wrap"><div class="clabel">spectrum (log-freq)</div></div>`));
const spec = el("canvas", { id: "spec", width: 720, height: 200 }); cAna.querySelector(".canvas-wrap").appendChild(spec);
cAna.appendChild(h(`<div class="canvas-wrap"><div class="clabel">spectrogram (time → freq 0–8k)</div></div>`));
const sgram = el("canvas", { id: "sgram", width: 720, height: 200 }); cAna.querySelectorAll(".canvas-wrap")[1].appendChild(sgram);
const readout = el("div", { class: "readout" }); readout.textContent = "play a sound →";
cAna.appendChild(readout);
app.appendChild(cAna);

app.appendChild(h(`<div class="foot"><b>What to listen/look for.</b> (1) Vowel ladder with radiation ON vs OFF — off = all the same dull hum; on = distinct. (2) The blue F2 band on the spectrum — for <code>i/e</code> it should stand tall; here it sags (the muffle). (3) Sweep HF-loss / damp / glottal-reflection — the F2 band barely moves: the muffle is the vowel <i>geometry</i> (<code>vowelPosture</code>), not the losses. (4) Turn on the 8&nbsp;kHz playback low-pass — that's what the Lab adds; note it only makes things duller, so the artifact isn't hiding brightness that exists.</div>`));

// expose a headless hook so the build can smoke-test render without audio
window.__voicelab = { synth, VOWELS, WORDS, S };
