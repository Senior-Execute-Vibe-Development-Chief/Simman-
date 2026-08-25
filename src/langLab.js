// ── Simman Language Lab ───────────────────────────────────────────────────
// A standalone playground for the language system (docs/language-
// comprehensive-spec.md). Dependency-free vanilla DOM — deliberately outside
// the React app so it can be served as /langlab.html in dev or bundled into
// a single self-contained page, without touching the world sim at all.

/* global __BUILD__ */
// __BUILD__ is a build-time constant injected by esbuild's --define at bundle
// time (the short commit hash on the footer); it is absent in raw source and
// under `npm run dev`, which is why every read is typeof-guarded. Declared
// here so ESLint's no-undef doesn't flag the injected identifier.

import { foundLanguage, branchLanguage, driftLanguage, borrowFrom, langWord, langWordForm, langPlaceNameEx, langPersonName, langDynastyName, langRealmName, wordOf, glossOf, etymologyOf, colexPartner, nativeStemOf, loanOf, colorTermsOf, kinshipOf, dialectsOf, cultureOf } from "./sim/language.js";
import { buildInventory, romanizeC, romanizeV, renderWord } from "./sim/languagePhonology.js";
import { phoneticPlan, ipaOf, ipaC, ipaV, TONE_SHAPES } from "./sim/languagePhonetics.js";
import { scorePlan as tractScorePlan, scoreClause as tractScoreClause, renderScore as tractRender } from "./sim/vocalTract.js";
import { scriptOf, glyphInventory, writeWord, writeForm, writeName, silentLetterSample, numeralGlyphs, adoptScriptFrom, SCRIPT_NAME, HAND_NAME, registerOf, highRegister, registerWords } from "./sim/languageScript.js";
import { foundHistory, stepHistory, ancestryOf } from "./sim/languageHistory.js";
import { IPA_CLIPS, IPA_CLIP_CREDIT } from "./sim/ipaAudioManifest.js";
import { applyReference, REF_KINDS } from "./sim/languageRefs.js";
import { CONCEPTS } from "./sim/languageLexicon.js";
import { gramOf, closedOf, numeral, numeralConceptWord, inflectNoun, inflectVerb, paradigmShape, affixEtymologies, renderClause, resolveTam, intensive,
  alignmentOf, voicesOf, voiceEtymologies, tamShape, evidentialSystem, classInventory, concordMarkers, agreementTargets, inflectAdj,
  classifiersOf, classifierEtymologies, numeralPhrase, inflectPossessed, possessionType, comparative, tvPronouns,
  renderClauseTree, clauseLinkersOf, synchronicPhonology, predicationOf, motionTypologyOf, polysynthesisOf, infoStructureOf } from "./sim/languageGrammar.js";
import { STONE, KING, RIVER, HOUSE, WOLF, MOTHER, HAND, MOUNTAIN, SHIP, FOOT, VERBS, HORSE, TOWN, BLACK, SEE, GO, TAKE, EAT, SLEEP, QUEEN, BREAD, SWORD, GREAT, OLD, GRAIN,
  RUN, ENTER, MIND, HEART, HEAD, LANGUAGE_C, TONGUE, BARK, SKIN, FISH, WATER, GOD, WINE,
  RULER, BUILDER, WARRIOR, SEER, SPEAKER, RULEV, BUILDV, FIGHTV, SAY,
  SEA, LAKE, TREE, WOOD, FOREST, HILL, EARTH, LAND, SUN, MOON, DAY, MONTH } from "./sim/languageLexicon.js";

// ── state ────────────────────────────────────────────────────────────────
let world, lineage, donor;
const S = {
  seed: 8817, preset: "random", divergence: 0.5, search: "", voice: "tract", noun: STONE, verb: VERBS[2],
  sent: { type: "plain", s: "p:1sg", v: SEE, tam: "pst", o: "n:" + RIVER, neg: false, q: false, loc: "none", mood: "decl", pred: "adj" },
  hist: { seed: 9917, eras: 14, english: true, russian: true, mandarin: true, random: 3 },
};
let HIST = null;                                      // the running areal history (module state)

function reset() {
  world = { seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 };
  const l = foundLanguage(world, { seed: S.seed >>> 0 });
  if (S.preset !== "random") applyReference(l, S.preset);
  lineage = [l];
  donor = null;
}
const active = () => lineage[lineage.length - 1];

// display inventory = the rolled/pinned chart UNIONED with what history
// actually minted — sound change creates segments the roll never listed
// (a fresh reader caught q-words beside a q-less chart)
function displayInv(l) {
  const rolled = buildInventory(l.famSeed, l.prof);
  const cons = (l.pin && l.pin.cons ? l.pin.cons : rolled.cons).slice();
  const vows = (l.pin && l.pin.vows ? l.pin.vows : rolled.vows).slice();
  for (const b of l.xph || []) cons.push(b);
  const sp = synchronicPhonology(l);
  const ck = new Set(cons.map(b => `${b.p},${b.m},${b.l},${b.s}`));
  for (const b of sp.cons) if (!ck.has(`${b.p},${b.m},${b.l},${b.s}`)) cons.push(b);
  const vk = new Set(vows.map(b => `${b.h},${b.b},${b.r},${b.atr || 0}`));
  for (const b of sp.vows) if (!vk.has(`${b.h},${b.b},${b.r},${b.atr || 0}`)) vows.push(b);
  return { cons, vows };
}

// syllable-structure label from the OBSERVED surfaces, not the proto roll —
// two sound changes can grow codas on a rolled strict-CV tongue, and the
// label must describe the language as it stands
function sylLabel(l) {
  const sp = synchronicPhonology(l);
  if (sp.maxOn >= 3 || sp.maxCo >= 3) return "heavy clusters";
  if (sp.maxOn === 2 || sp.maxCo === 2) return "clustered";
  if (sp.maxCo === 1) return sp.nasalOnlyCodas ? "CV(N) — nasal codas only" : "CV(C)";
  return "strict CV";
}

// ── the vocalizer: a tiny formant synthesizer over phonetic plans ─────────
// A sketch of the sound, not a native speaker — but the structure is real:
// every segment's acoustics derive from the SAME feature bundles the
// phonology stores, the tone contours are the plan's own melody indices
// (parity with the written marks by construction), and stress falls where
// the profile says. Dependency-free Web Audio; playback only — nothing here
// persists, so the engine stays pure and deterministic.
let PLANS = [];                                     // per-render plan registry (data-p indices)
let CLAUSES = [];                                   // per-render clause registry (data-cp indices)
const regPlan = (p) => PLANS.push(p) - 1;
const regClause = (groups, contour) => CLAUSES.push({ groups, contour }) - 1;
let AC = null, NOISE = null;
function ac() {
  if (!AC) {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    const n = AC.sampleRate;
    NOISE = AC.createBuffer(1, n, AC.sampleRate);   // 1s of noise, reused by every burst
    const d = NOISE.getChannelData(0);
    let x = 22222;                                  // seeded LCG — no Math.random anywhere
    for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) >>> 0; d[i] = (x / 2147483648 - 1) * 0.5; }
  }
  if (AC.state === "suspended") AC.resume();
  return AC;
}

// ── the recorded-phone bank (the third voice) ─────────────────────────────
// Human citation recordings of the base phones, one file per IPA symbol
// (assets/ipa-audio/, openly licensed — see CREDITS-ipa-audio.md). These are
// PHONEME clips only: isolated citation phones do not concatenate into words,
// so word playback always stays with the synthesizers. A phone without its
// own recording plays its nearest recorded base phone (strip length/phonation/
// nasality, then click accompaniments, then secondary articulation, then
// voicelessness/dentality) — and if nothing matches, the synth speaks instead.
const HAS_CLIPS = Object.keys(IPA_CLIPS).length > 0;
// the standalone single-file build inlines the audio as data URIs on
// window.__IPA_AUDIO__; the dev server just fetches the assets directory
const IPA_AUDIO_BASE = (typeof window !== "undefined" && window.__IPA_AUDIO_BASE__) || "assets/ipa-audio/";
const CLIPS = new Map();                            // file → AudioBuffer | null (a miss stays a miss)
function clipCandidates(sym) {
  const out = [];
  const push = (s) => { if (s && !out.includes(s)) out.push(s); };
  push(sym);
  // nasal ̃ · length ː · breathy ̤ · creaky ̰ · −ATR ̙ · mid-centralized ̽
  let s = sym.replace(/[̃ː̤̰̙̽]/g, "");
  push(s);
  push(s = s.replace(/^[ɡŋ]͡/, ""));           // click accompaniment ɡ͡ / ŋ͡
  push(s = s.replace(/[ʲʷᵐⁿᵑ]|ʰ$|ʼ$/g, ""));        // ʲ ʷ ᵐ ⁿ ᵑ, final ʰ ʼ
  push(s = s.replace(/[̥̊̈]/g, "")); // voiceless rings ̥ ̊, centralized ̈
  push(s.replace(/̪/g, ""));                   // dental bridge ̪ → alveolar
  return out;
}
async function loadClip(sym) {
  for (const cand of clipCandidates(sym)) {
    const file = IPA_CLIPS[cand];
    if (!file) continue;
    if (CLIPS.has(file)) { const b = CLIPS.get(file); if (b) return b; continue; }
    try {
      // inlined bank (standalone file / hosted Artifact): decode the data URI
      // ourselves — fetch() of data: URLs is blocked under a strict CSP
      const inline = typeof window !== "undefined" && window.__IPA_AUDIO__ && window.__IPA_AUDIO__[file];
      let bytes;
      if (inline) {
        const bin = atob(inline.slice(inline.indexOf(",") + 1));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        const res = await fetch(IPA_AUDIO_BASE + file);
        if (!res.ok) throw new Error(String(res.status));
        bytes = new Uint8Array(await res.arrayBuffer());
      }
      const buf = await ac().decodeAudioData(bytes.buffer);
      CLIPS.set(file, buf);
      return buf;
    } catch { CLIPS.set(file, null); }
  }
  return null;
}
function playClipOr(sym, fallbackPlan) {
  loadClip(sym).then(buf => {
    if (!buf) { if (fallbackPlan) speakPlanTract(fallbackPlan); return; }
    const ctx = ac();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    window.__lastClipPlayed = sym;             // headless-check breadcrumb
  });
}
// the glottal source: a Rosenberg glottal-flow pulse's DERIVATIVE (the actual
// acoustic source at the folds) as a PeriodicWave, replacing the buzzy
// sawtooth. Same harmonic richness (it still excites every formant) but the
// natural pulse shape drops the sawtooth's harsh edge — the single highest-
// leverage de-buzz for a source-filter synth. Cached per context (+ a breathier
// wave, more spectral tilt, for breathy phonation).
let GLOTTAL_WAVE = null, GLOTTAL_WAVE_BREATHY = null;
function glottalWave(ctx, breathy) {
  if (breathy && GLOTTAL_WAVE_BREATHY) return GLOTTAL_WAVE_BREATHY;
  if (!breathy && GLOTTAL_WAVE) return GLOTTAL_WAVE;
  const M = 2048, K = 40;
  const Tp = breathy ? 0.44 : 0.38, Te = breathy ? 0.72 : 0.60;   // open-phase timing (breathy = longer)
  const flow = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const t = i / M;
    flow[i] = t < Tp ? 0.5 * (1 - Math.cos(Math.PI * t / Tp))
      : t < Te ? Math.cos(Math.PI * (t - Tp) / (2 * (Te - Tp))) : 0;
  }
  const deriv = new Float32Array(M);                              // flow derivative = the source
  for (let i = 0; i < M; i++) deriv[i] = flow[i] - flow[(i - 1 + M) % M];
  const real = new Float32Array(K + 1), imag = new Float32Array(K + 1);
  for (let k = 1; k <= K; k++) {                                  // one-period DFT → harmonic coefficients
    let re = 0, im = 0;
    for (let i = 0; i < M; i++) { const a = 2 * Math.PI * k * i / M; re += deriv[i] * Math.cos(a); im -= deriv[i] * Math.sin(a); }
    real[k] = 2 * re / M; imag[k] = 2 * im / M;
  }
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  if (breathy) GLOTTAL_WAVE_BREATHY = wave; else GLOTTAL_WAVE = wave;
  return wave;
}
const VOWEL_F = (v) => {
  const F1 = [300, 480, 720][v.h] || 480;
  let F2 = v.b === 0 ? 2150 - v.h * 150 : v.b === 1 ? 1400 : 950 + v.h * 100;
  if (v.r) F2 -= v.b === 0 ? 300 : 100; else if (v.b === 2) F2 += 350;
  return [F1, F2, v.r ? 2500 : 2700];
};
const GLIDE_V = { 0: { h: 0, b: 2, r: 1 }, 3: { h: 0, b: 0, r: 0 }, 4: { h: 0, b: 2, r: 0 } };   // w→u, j→i, ɰ→ɯ
const BURST_F = [700, 4000, 2600, 3300, 1600, 1100, 900, 1400, 3800];    // stop burst centre, by place
const FRIC_F = [1400, 5200, 3400, 4200, 1900, 1300, 1000, 1100, 1300];   // frication centre, by place
const NASAL_F2 = [1100, 1450, 1700, 2000, 2300, 1250, 1300, 1300, 1450]; // murmur colour, by place
const SIB = (p) => p >= 1 && p <= 3;
const F0 = 118;

function vNoise(ctx, out, t, dur, freq, q, gain) {
  const src = ctx.createBufferSource(); src.buffer = NOISE; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + Math.min(0.012, dur / 3));
  g.gain.setValueAtTime(gain, t + Math.max(dur - 0.02, dur / 2));
  g.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t); src.stop(t + dur + 0.02);
}
// a voiced resonant segment: sawtooth source through three parallel formant
// filters; frs may be [from, to] pairs for a diphthong/glide transition
function vVoiced(ctx, out, t, dur, frs, gains, f0pts, opts = {}) {
  const osc = ctx.createOscillator(); osc.setPeriodicWave(glottalWave(ctx, !!opts.breathy));
  const n = f0pts.length;
  f0pts.forEach((k, i) => { const tt = t + (dur * i) / Math.max(1, n - 1); i === 0 ? osc.frequency.setValueAtTime(F0 * k, tt) : osc.frequency.linearRampToValueAtTime(F0 * k, tt); });
  const seg = ctx.createGain(); seg.gain.setValueAtTime(0, t);
  const peak = opts.peak ?? 1;
  seg.gain.linearRampToValueAtTime(peak, t + 0.018);
  seg.gain.setValueAtTime(peak, t + Math.max(dur - 0.03, dur / 2));
  seg.gain.linearRampToValueAtTime(0, t + dur);
  if (opts.trill) {                                  // amplitude flutter for trills
    const lfo = ctx.createOscillator(); lfo.frequency.value = opts.trill;
    const lg = ctx.createGain(); lg.gain.value = 0.45;
    lfo.connect(lg); lg.connect(seg.gain); lfo.start(t); lfo.stop(t + dur);
  }
  for (let i = 0; i < 3; i++) {
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 9;
    const fr = frs[i];
    if (Array.isArray(fr)) { f.frequency.setValueAtTime(fr[0], t); f.frequency.linearRampToValueAtTime(fr[1], t + dur); }
    else f.frequency.value = fr;
    const g = ctx.createGain(); g.gain.value = gains[i];
    osc.connect(f); f.connect(g); g.connect(seg);
  }
  if (opts.nasal) {                                  // nasal murmur branch
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 280; f.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0.5;
    osc.connect(f); f.connect(g); g.connect(seg);
  }
  seg.connect(out);
  osc.start(t); osc.stop(t + dur + 0.02);
}
// one consonant segment; returns its duration. `final` softens codas.
function consSeg(ctx, out, t, c, f0pts, final) {
  const p = Math.min(c.p, 8);
  if (c.m === 7) {                                   // CLICK (phase 4): its own burst model —
    // a nasal/voice lead where the accompaniment says so, then a sharp
    // double transient (release + rarefaction snap), centre keyed to the
    // click type: dental high hiss, alveolar sharp pop, lateral broad slush
    let dt = 0;
    const CK_F = { 8: 4200, 1: 2600, 4: 2000, 3: 3400, 0: 900 };
    const fq = CK_F[c.p] || 2600;
    if (c.l === 4) { vVoiced(ctx, out, t, 0.05, [250, NASAL_F2[Math.min(c.p, 8)], 2500], [0.9, 0.14, 0.04], f0pts, { nasal: true, peak: 0.6 }); dt += 0.05; }
    if (c.l === 1) vVoiced(ctx, out, t + dt, 0.03, [130, 300, 2500], [0.5, 0.08, 0], [1, 0.95], { peak: 0.3 });
    dt += 0.012;
    vNoise(ctx, out, t + dt, 0.012, fq, c.p === 4 ? 0.8 : 2.5, 0.85);            // the click snap
    vNoise(ctx, out, t + dt + 0.014, 0.01, fq * 0.72, 1.5, 0.35);                // rarefaction echo
    dt += 0.035;
    if (c.l === 2) { vNoise(ctx, out, t + dt, 0.05, 1600, 0.4, 0.14); dt += 0.05; }
    return dt;
  }
  if (c.m === 1) {                                   // nasal murmur
    vVoiced(ctx, out, t, 0.085, [250, NASAL_F2[p], 2500], [0.9, 0.16, 0.05], f0pts, { nasal: true, peak: 0.8 });
    return 0.085;
  }
  if (c.m === 2) {                                   // fricative
    const dur = final ? 0.13 : 0.105;
    const breathy = p >= 6;
    vNoise(ctx, out, t, dur, FRIC_F[p], breathy ? 0.35 : SIB(p) ? 3 : 0.7, SIB(p) ? 0.3 : breathy ? 0.13 : 0.17);
    if (c.l === 1) vVoiced(ctx, out, t, dur, [300, FRIC_F[p] * 0.5, 2500], [0.5, 0.15, 0.04], f0pts, { peak: 0.5 });
    return dur;
  }
  if (c.m === 4) {                                   // lateral
    vVoiced(ctx, out, t, 0.075, [360, 1150, 2600], [0.85, 0.3, 0.1], f0pts, { peak: 0.85 });
    return 0.075;
  }
  if (c.m === 5) {                                   // rhotic: trill/flap by place
    if (p === 2) { vVoiced(ctx, out, t, 0.04, [420, 1500, 1900], [0.8, 0.3, 0.12], f0pts, { peak: 0.7 }); return 0.04; }
    vVoiced(ctx, out, t, 0.09, [420, p === 5 ? 1100 : 1300, p === 5 ? 1900 : 2000], [0.85, 0.3, 0.12], f0pts, { trill: p === 5 ? 30 : 26 });
    return 0.09;
  }
  if (c.m === 6) {                                   // glide: its vowel colour
    const gv = GLIDE_V[p] || GLIDE_V[3];
    vVoiced(ctx, out, t, 0.06, p === 1 ? [430, 1300, 1650] : VOWEL_F(gv), [0.8, 0.45, 0.15], f0pts, { peak: 0.8 });
    return 0.06;
  }
  // stops & affricates: closure → burst (→ frication tail / aspiration)
  let dt = 0;
  const closure = c.m === 3 ? 0.03 : 0.045;
  if (c.l === 4) { vVoiced(ctx, out, t, 0.055, [250, NASAL_F2[p], 2500], [0.9, 0.16, 0.05], f0pts, { nasal: true, peak: 0.7 }); dt += 0.055; }   // prenasalized
  if (c.l === 1) vVoiced(ctx, out, t + dt, closure, [130, 300, 2500], [0.5, 0.08, 0], [1, 0.95], { peak: 0.35 });   // voice bar
  dt += closure;
  if (c.p !== 7) vNoise(ctx, out, t + dt, 0.018, BURST_F[p], 1.2, c.l === 3 ? 0.5 : final ? 0.18 : 0.32);   // burst (glottal stop = silence)
  dt += 0.02;
  if (c.m === 3) { vNoise(ctx, out, t + dt, 0.07, FRIC_F[p], SIB(p) ? 3 : 0.8, SIB(p) ? 0.26 : 0.15); dt += 0.07; }   // affricate tail
  if (c.l === 2) { vNoise(ctx, out, t + dt, 0.055, 1600, 0.4, 0.16); dt += 0.055; }   // aspiration
  if (c.l === 3) dt += 0.04;                          // ejective: a beat of silence
  return dt;
}
// schedule one word's plan at time t; `mod` carries the clause prosody —
// a declination scale and, on the clause's last word, a boundary tone
// (statements FALL, questions RISE — the near-universal pair)
function scheduleWord(ctx, master, plan, t, mod = {}) {
  const scale = mod.scale || 1;
  const nSyl = plan.syls.length;
  plan.syls.forEach((syl, i) => {
    // pitch: the syllable's own tone melody, or stress + declination
    let f0pts = plan.tone > 0 && syl.tone != null ? TONE_SHAPES[syl.tone].map(k => k * scale)
      : (() => { const k = (1 + (i === plan.stress ? 0.13 : 0) - 0.1 * (i / Math.max(1, nSyl))) * scale; return [k, k * 0.96]; })();
    if (mod.boundary && i === nSyl - 1) {
      f0pts = mod.boundary === "rise" ? [...f0pts, f0pts[f0pts.length - 1] * 1.35] : [...f0pts, f0pts[f0pts.length - 1] * 0.72];
    }
    const secondary = (c, after) => {                 // ʲ/ʷ: a short on-glide after the consonant
      if (!c.s) return 0;
      const gv = c.s === 1 ? GLIDE_V[3] : GLIDE_V[0];
      vVoiced(ctx, master, after, 0.035, VOWEL_F(gv), [0.7, 0.4, 0.12], f0pts, { peak: 0.6 });
      return 0.035;
    };
    // PITCH ACCENT (phase 4): the accent is pitch, not loudness — a high
    // target on the accented syllable and a fall off it (the Japanese shape)
    if (plan.pitchAccent && i === plan.stress) f0pts = f0pts.map(k => k * 1.22);
    for (const c of syl.on) { const d = consSeg(ctx, master, t, c, f0pts, false); t += d + secondary(c, t + d) + 0.004; }
    if (syl.nu.length) {                              // nucleus (diphthongs glide)
      const v0 = syl.nu[0];
      let dur = (i === plan.stress ? 0.19 : 0.15) * (v0.lg ? 1.5 : 1) * (i === nSyl - 1 ? 1.12 : 1);
      const A = VOWEL_F(v0), B = syl.nu.length > 1 ? VOWEL_F(syl.nu[1]) : null;
      const frs = B ? A.map((f, k) => [f, B[k]]) : A;
      // PHONATION (phase 4): creaky voice drops the pitch and pulses it;
      // breathy voice mixes an aspiration wash over the vowel
      const vf0 = v0.ph === 2 ? f0pts.map(k => k * 0.72) : f0pts;
      vVoiced(ctx, master, t, dur, frs, [0.9, 0.55, 0.2], vf0, { nasal: !!v0.n, trill: v0.ph === 2 ? 42 : 0, breathy: v0.ph === 1 });
      if (v0.ph === 1) vNoise(ctx, master, t, dur, 1500, 0.35, 0.12);
      t += dur + 0.004;
    }
    for (const c of syl.co) {
      // GEMINATE hold (phase 4): an identical coda+onset pair across the seam
      // is one long consonant — hold the closure instead of re-articulating
      const nx = plan.syls[i + 1];
      const gem = nx && nx.on.length && ["p", "m", "l", "s"].every(k => nx.on[0][k] === c[k]);
      const d = consSeg(ctx, master, t, c, f0pts, true); t += d + (gem ? 0.055 : 0) + 0.004;
    }
    t += 0.015;                                       // syllable seam
  });
  return t;
}
function mkMaster(ctx) {
  const master = ctx.createGain(); master.gain.value = 0.24;
  const soften = ctx.createBiquadFilter(); soften.type = "lowpass"; soften.frequency.value = 6800;
  master.connect(soften); soften.connect(ctx.destination);
  return master;
}
function speakPlanFormant(plan) {
  const ctx = ac();
  scheduleWord(ctx, mkMaster(ctx), plan, ctx.currentTime + 0.06);
}
// ── the articulatory voice: render the whole utterance offline into a buffer
// (src/sim/vocalTract.js is pure, so the identical DSP runs under Node), then
// play it. The buffer is pre-normalized, so it goes through a light gain only.
function playTractBuffer(ctx, data) {
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = 0.9;
  const soften = ctx.createBiquadFilter(); soften.type = "lowpass"; soften.frequency.value = 8000;
  src.connect(g); g.connect(soften); soften.connect(ctx.destination);
  src.start(ctx.currentTime + 0.02);
}
function speakPlanTract(plan) {
  const ctx = ac();
  playTractBuffer(ctx, tractRender(tractScorePlan(plan), ctx.sampleRate));
}
function speakClauseTract(groups, contour) {
  const ctx = ac();
  playTractBuffer(ctx, tractRender(tractScoreClause(groups, contour), ctx.sampleRate));
}
// engine dispatch: the Sound card's toggle picks the articulatory tract (the
// vocal-tract model) or the formant sketch; both read the SAME phonetic plans
function speakPlan(plan) { S.voice === "formant" ? speakPlanFormant(plan) : speakPlanTract(plan); }
// a whole sentence: word plans in sequence, grouped into intonation
// phrases (one per clause) — pitch declines across the whole utterance,
// each NON-final clause ends on a continuation rise with a comma pause
// (the near-universal spoken comma), and only the final clause carries
// the sentence's boundary tone (fall for statements/commands, rise for
// questions)
function speakClause(groups, contour = "fall") { S.voice === "formant" ? speakClauseFormant(groups, contour) : speakClauseTract(groups, contour); }
function speakClauseFormant(groups, contour = "fall") {
  const ctx = ac();
  const master = mkMaster(ctx);
  let t = ctx.currentTime + 0.06;
  const total = groups.reduce((a, g) => a + g.length, 0);
  let k = 0;
  groups.forEach((g, gi) => {
    const lastG = gi === groups.length - 1;
    g.forEach((p, i) => {
      t = scheduleWord(ctx, master, p, t, {
        scale: 1.05 - 0.12 * (k / Math.max(1, total - 1)),
        boundary: i === g.length - 1 ? (lastG ? contour : "rise") : null,
      }) + 0.08;                                      // inter-word gap
      k++;
    });
    if (!lastG) t += 0.16;                            // the comma pause
  });
}
// clause boundaries from the token stream: a CONJ opens a new intonation
// phrase (the comma sits before "and", as spoken)
function planGroups(l, tokens) {
  const groups = [[]];
  for (const t of tokens) {
    if (!t.f) continue;
    if (t.role === "CONJ" && groups[groups.length - 1].length) groups.push([]);
    groups[groups.length - 1].push(phoneticPlan(l, t.f));
  }
  return groups.filter(g => g.length);
}

const MORPH = { iso: "isolating", agg: "agglutinative", fus: "fusional", tmpl: "templatic (root-and-pattern)" };
const TONE = ["no tone", "register tone", "contour tone"];
const HARM = { none: null, fb: "front–back harmony", round: "rounding harmony", atr: "ATR harmony (±tongue root)" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ── rendering ────────────────────────────────────────────────────────────
function chips(l) {
  const p = l.prof, inv = displayInv(l);
  // count what the READER sees: unique rendered spellings, not feature
  // bundles (ð and þ both write "th", so 23 bundles can be 21 letters)
  const nC = new Set(inv.cons.map(b => romanizeC(b, p.romTaste, p.rom))).size;
  const nV = new Set(inv.vows.map(b => romanizeV(b, p.rom))).size;
  const tonogenized = p.phonation && p.tone > 0;
  const out = [MORPH[p.morph] + (gramOf(l).poly ? " (polysynthetic)" : ""), sylLabel(l),
    tonogenized ? "tone ‹ born of registers (tonogenesis)" : TONE[p.tone], HARM[p.harmony],
    inv.cons.some(b => b.m === 7) ? "CLICKS" : null,
    p.phonation && !p.tone ? "phonation registers (breathy/creaky)" : null,
    p.pitchAccent && !p.tone ? "pitch accent" : null,
    p.sig === "gem" ? "geminates" : null,
    `${nC} consonants`, `${nV} vowels`,
    p.gendered ? "gendered names" : null,
    p.patro !== "none" ? `patronymic (${p.patro === "suf" ? "suffix" : "prefix"})` : null,
    l.rules.length ? `${l.rules.length} sound changes` : "pristine",
    l.loans.length ? `${l.loans.length} loanwords` : null,
    l.pin ? "pinned inventory" : null];
  return out.filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join("");
}

function inventoryHTML(l) {
  const inv = displayInv(l);
  const c = [...new Set(inv.cons.map(b => romanizeC(b, l.prof.romTaste, l.prof.rom)))].join(" ");
  const v = [...new Set(inv.vows.map(b => romanizeV(b, l.prof.rom)))].join(" ");
  return `<div class="inv"><span class="lbl">consonants</span> <span class="w">${esc(c)}</span></div>
          <div class="inv"><span class="lbl">vowels</span> <span class="w">${esc(v)}</span></div>`;
}

function namesHTML(l) {
  // a sample list of ten shows ten DIFFERENT places: skip exact duplicates
  // (real maps repeat a generic as Caveford/Caveton — distinct specifics on
  // a shared head — not three bare 'cave's; a fresh reader caught the
  // bare-duplicate pair)
  // names carry their written form too — the scribe sounds a name out and
  // spells it in the script's own signs (writeName inverts the language's
  // romanization, exactly what taking a name down IS)
  const sc = scriptOf(l);
  const wname = (n) => {
    if (!sc) return "";
    const g = writeName(l, n);
    return g && g.length ? ` <span class="glyphword${sc.dir === "rtl" ? " rtl" : sc.dir === "ttb" ? " ttb" : ""}">${g.map(x => glyphSVG(x, 15, { hand: sc.hand })).join("")}</span>` : "";
  };
  const topo = [];
  const seenTopo = new Set();
  for (let i = 0; i < 24 && topo.length < 10; i++) {
    const { name, gloss } = langPlaceNameEx(l, i);
    if (seenTopo.has(name)) continue;
    seenTopo.add(name);
    topo.push(`<li><span class="w">${esc(name)}</span>${wname(name)}${gloss ? ` <span class="gloss">‘${esc(gloss)}’</span>` : ` <span class="gloss lost">meaning lost</span>`}</li>`);
  }
  const men = [1, 2, 3].map(i => langPersonName(l, i, false));
  const women = [4, 5, 6].map(i => langPersonName(l, i, true));
  const dyn = men.map((m, i) => langDynastyName(l, i + 1, m));
  const realms = [1, 2, 3].map(i => langRealmName(l, i));
  return `
    <h3>Places</h3><ul class="cols">${topo.join("")}</ul>
    <h3>People</h3>
    <p><span class="lbl">men</span> ${men.map(n => `<span class="w">${esc(n)}</span>${wname(n)}`).join(", ")}
       <span class="lbl ind">women</span> ${women.map(n => `<span class="w">${esc(n)}</span>${wname(n)}`).join(", ")}</p>
    <h3>Houses &amp; realms</h3>
    <p><span class="lbl">dynasties</span> ${dyn.map(n => `<span class="w">${esc(n)}</span>`).join(", ")}
       <span class="lbl ind">realms</span> ${realms.map(n => `<span class="w">${esc(n)}</span>${wname(n)}`).join(", ")}</p>`;
}

// ── the Sound card: IPA + the vocalizer (phonemes and words you can hear) ─
function soundHTML(l) {
  const inv = displayInv(l);
  const prof = l.prof;
  const demoV = inv.vows.find(v => v.h === 2 && !v.n && !v.lg) || inv.vows[0];
  const seenC = new Set();
  const cChips = inv.cons.map(b => {
    const sym = ipaC(b);
    if (seenC.has(sym)) return "";
    seenC.add(sym);
    const idx = regPlan(phoneticPlan(l, { syls: [{ on: [{ ...b }], nu: [{ ...demoV }], co: [] }], tseed: 0 }));
    return `<button class="cell spk" data-p="${idx}" data-ipa="${esc(sym)}" title="hear it"><span class="w">${esc(romanizeC(b, prof.romTaste, prof.rom, prof.orthoStyle))}</span> <span class="gloss">${esc(sym)}</span></button>`;
  }).filter(Boolean).join(" ");
  const seenV = new Set();
  const vChips = inv.vows.map(v => {
    const sym = ipaV(v);
    if (seenV.has(sym)) return "";
    seenV.add(sym);
    const idx = regPlan(phoneticPlan(l, { syls: [{ on: [], nu: [{ ...v }], co: [] }], tseed: 0 }));
    return `<button class="cell spk" data-p="${idx}" data-ipa="${esc(sym)}" title="hear it"><span class="w">${esc(romanizeV(v, prof.rom))}</span> <span class="gloss">${esc(sym)}</span></button>`;
  }).filter(Boolean).join(" ");
  const loanSet = new Set((l.loans || []).map(x => x.c));
  const rows = [];
  const addRow = (label, surface, form) => rows.push(`<tr><td class="lbl">${esc(label)}</td><td class="w">${esc(surface)}</td><td class="gloss ipa">[${esc(ipaOf(l, form))}]</td><td><button class="spk play" data-p="${regPlan(phoneticPlan(l, form))}" title="speak">▶</button></td></tr>`);
  addRow("the language", langWord(l, 0), langWordForm(l, 0));
  for (const cid of [STONE, KING, RIVER, MOTHER, HAND, WOLF, HORSE, MOUNTAIN]) {
    if (loanSet.has(cid)) continue;                   // a loan's surface has no native plan
    const form = nativeStemOf(l, cid);
    addRow(glossOf(cid), renderWord(form, prof), form);
  }
  return `<section class="card"><h2>Sound <span class="count">— IPA &amp; a voice</span></h2>
    <p class="note">The same feature bundles the phonology stores, rendered two more ways: IPA for the linguist, and a synthesizer for the ear. Two voices are on offer: an <b>articulatory vocal tract</b> — a Kelly–Lochbaum waveguide where you set a tongue and a constriction and the formants fall out of the tube's shape, so clicks, ejectives, nasals and breathy/creaky voice all emerge from the mechanism — and the older <b>formant sketch</b> (a buzz through three resonators). Either way the clusters, codas, vowel qualities and ${prof.tone ? "tone melodies (matching the written marks exactly)" : "stress placement"} are the real ones. Click a phoneme to hear it; ▶ speaks a word. Spelling and speech may honestly disagree — the romanization drops what convention drops (initial glottal stops, collapsed digraphs); the IPA keeps it.</p>
    <p class="cells"><span class="lbl">voice</span>
      <label class="vopt"><input type="radio" name="voiceEngine" value="tract"${S.voice !== "formant" && S.voice !== "human" ? " checked" : ""}/> articulatory tract</label>
      <label class="vopt"><input type="radio" name="voiceEngine" value="formant"${S.voice === "formant" ? " checked" : ""}/> formant sketch</label>${HAS_CLIPS ? `
      <label class="vopt"><input type="radio" name="voiceEngine" value="human"${S.voice === "human" ? " checked" : ""}/> recorded phones</label>` : ""}</p>${HAS_CLIPS ? `
    <p class="note">The third voice plays a <b>human recording</b> per phoneme — real citation phones, openly licensed (${esc(IPA_CLIP_CREDIT)}). Recordings are isolated citation sounds, so they cannot be stitched into words: word and sentence playback always uses the synthesizers, and a phone without its own recording plays its nearest recorded base phone or falls back to the tract.</p>` : ""}
    <h3>Phonemes</h3>
    <p class="cells">${cChips}</p>
    <p class="cells">${vChips}</p>
    <h3>Hear the words</h3>
    <div class="scroll"><table><thead><tr><th>meaning</th><th>word</th><th>IPA</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
    <p class="note">Every native entry in the dictionary below is speakable too — click its word. Whole sentences are parked: the clause renderer hands back strings, not forms, and the vocalizer refuses to guess.</p>
  </section>`;
}

// ── the Writing card: script type, glyphs, orthographic lag ───────────────
// Glyphs arrive as stroke data (languageScript.js); this renders them as
// SVG in the script's own HAND: carved strokes take square-cut ends, the
// brush writes heavy, clay presses filled wedges, the pen loops, the round
// hand arcs. A word-level headline bar (the Devanagari look) or a cursive
// baseline (the joined-pen look) is drawn per glyph and meets its
// neighbours when the word closes its gaps.
const HAND_PEN = {
  carved: { w: 5.5, cap: "square" }, clay: { w: 3.5, cap: "butt" }, brush: { w: 9, cap: "round" },
  pen: { w: 5, cap: "round" }, round: { w: 5.5, cap: "round" },
};
function glyphSVG(g, size = 26, opts = {}) {
  const W = 100, H = 115;
  const pen = HAND_PEN[opts.hand] || HAND_PEN.pen;
  let baseT = { sx: 1, sy: 1, ox: 0, oy: 0 }, markT = null;
  // a drawable mark is {strokes, pos} (vowel diacritics, viramas, tone);
  // the inventory's standalone diacritic entries carry only a position STRING
  if (g.mark && g.mark.strokes) {
    if (g.mark.pos === "above") { baseT = { sx: 1, sy: 0.72, ox: 0, oy: 0.28 }; markT = { sx: 0.44, sy: 0.2, ox: 0.28, oy: 0.02 }; }
    else if (g.mark.pos === "below") { baseT = { sx: 1, sy: 0.72, ox: 0, oy: 0 }; markT = { sx: 0.44, sy: 0.2, ox: 0.28, oy: 0.78 }; }
    else { baseT = { sx: 0.7, sy: 1, ox: 0, oy: 0 }; markT = { sx: 0.26, sy: 0.42, ox: 0.72, oy: 0.29 }; }
  }
  const XY = (p, T) => ({ x: ((T.ox + p.x * T.sx) * 0.92 + 0.04) * W, y: ((T.oy + p.y * T.sy) * 0.9 + 0.05) * H });
  const parts = (strokes, T, bowK, sw) => strokes.map(st => {
    const P = st.pts.map(p => XY(p, T));
    if (st.kind === "loop") {
      const r = (st.r || 0.12) * W * T.sx * 0.92;
      return `<circle cx="${P[0].x.toFixed(1)}" cy="${P[0].y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="${sw}"/>`;
    }
    if (st.kind === "dot") {
      // an i'jam point — the dot that keeps worn skeletons apart (ب ت ث)
      return `<circle cx="${P[0].x.toFixed(1)}" cy="${P[0].y.toFixed(1)}" r="${(sw * 0.85).toFixed(1)}" fill="currentColor"/>`;
    }
    if (st.kind === "wedge") {
      // a pressed wedge: filled triangular head, thin drag tail
      const a = P[0], b = P[1];
      const dx = b.x - a.x, dy = b.y - a.y, ln = Math.hypot(dx, dy) || 1;
      const hx = a.x + dx / ln * 16, hy = a.y + dy / ln * 16;
      const px = -dy / ln * 7, py = dx / ln * 7;
      return `<path d="M ${(a.x + px).toFixed(1)} ${(a.y + py).toFixed(1)} L ${(a.x - px).toFixed(1)} ${(a.y - py).toFixed(1)} L ${hx.toFixed(1)} ${hy.toFixed(1)} Z" fill="currentColor"/>`
        + `<path d="M ${hx.toFixed(1)} ${hy.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="${sw}"/>`;
    }
    const swl = st.kind === "tail" ? Math.max(2, sw * 0.7) : sw;   // the final-form swash thins as it sweeps
    let d = `M ${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      if (Math.abs(st.bow) < 0.03) { d += ` L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`; continue; }
      const dx = b.x - a.x, dy = b.y - a.y, ln = Math.hypot(dx, dy) || 1;
      const cx = (a.x + b.x) / 2 - (dy / ln) * st.bow * bowK, cy = (a.y + b.y) / 2 + (dx / ln) * st.bow * bowK;
      d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${swl}" stroke-linecap="${pen.cap}" stroke-linejoin="round"/>`;
  }).join("");
  let extra = "";
  if (markT) extra += parts(g.mark.strokes, markT, 30, 5);
  // a second mark (tone stacked over a vowel diacritic, the Thai way) rides
  // higher still, in the sliver above the first
  if (g.mark2 && g.mark2.strokes) extra += parts(g.mark2.strokes, { sx: 0.3, sy: 0.12, ox: 0.35, oy: g.mark && g.mark.pos === "above" ? -0.04 : 0.02 }, 24, 4);
  if (opts.headline) extra += `<path d="M 0 ${(H * 0.1).toFixed(1)} L ${W} ${(H * 0.1).toFixed(1)}" stroke="currentColor" stroke-width="5" fill="none"/>`;
  if (opts.join) extra += opts.dir === "ttb"
    ? `<path d="M ${(W * 0.5).toFixed(1)} 0 L ${(W * 0.5).toFixed(1)} ${H}" stroke="currentColor" stroke-width="4" fill="none" opacity="0.85"/>`
    : `<path d="M 0 ${(H * 0.71).toFixed(1)} L ${W} ${(H * 0.71).toFixed(1)}" stroke="currentColor" stroke-width="4" fill="none" opacity="0.85"/>`;
  return `<svg class="glyph" viewBox="0 0 ${W} ${H}" width="${size}" height="${Math.round(size * 1.15)}" aria-hidden="true">${parts(g.strokes, baseT, 70, pen.w)}${extra}</svg>`;
}

function writingHTML(l) {
  const s = scriptOf(l);
  if (!s) return `<section class="card"><h2>Writing</h2>
    <p class="note">No written tradition yet — this tongue is young. Records consolidate only after a little history: <b>Drift</b> the language and a script will be born (logographic first, the way every primary invention was).</p></section>`;
  const dirName = { ltr: "left → right", rtl: "right → left", ttb: "top → bottom", boustro: "boustrophedon (as the ox plows)" }[s.dir];
  const chips = [SCRIPT_NAME[s.type],
    s.type === "featural" ? "designed geometry (ruler-drawn)" : HAND_NAME[s.hand],
    s.type === "logo" ? "one sign per morpheme (open set)" : `${s.glyphBudget} signs`,
    `written ${dirName}`,
    s.sep === "space" ? "words spaced" : s.sep === "dot" ? "words split by interpunct" : "scriptio continua",
    s.matres === "long" ? "matres lectionis (long vowels written)" : null,
    s.virama ? "virama kills the inherent vowel" : null,
    s.codaMode === "moraic" ? "moraic coda sign" : s.codaMode === "echo" ? "codas echo their vowel (ko-no-so)" : s.codaMode === "drop" ? "codas unwritten" : null,
    l.prof.tone ? (s.toneWritten ? "tone written (diacritics)" : "tone unwritten") : null,
    s.headline ? "headline bar joins the word" : null,
    s.join ? "cursive: letters join + final swash" : null,
    s.invented ? "invented whole (the Sejong move)" : null,
    s.borrowed && !s.invented ? "borrowed script (arrived by contact)" : null,
    s.type === "featural" ? "syllables stack into blocks" : null,
    s.lag ? `spelling frozen ${s.lag} sound change${s.lag > 1 ? "s" : ""} ago` : s.reformed ? "spelling reformed (shallow again)" : "shallow orthography (young)",
  ].filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join("");
  const story = s.invented
    ? `Invented whole at court — the Sejong move: centuries of sound change had left the old script's fit behind${s.borrowed ? " (a borrowed script that never fit this tongue)" : ""}, so the replacement draws each sound's own FEATURES. Place gives the base shape, manner modifies it, and a laryngeal series just adds a stroke — related sounds look related, and one letter covers a voicing pair the way Hangul's ㄱ covers k and g.`
    : s.borrowed && s.adoptedAt === s.born
      ? `The script ARRIVED: a neighbour's tradition adopted whole — letterforms, hand, and direction kept — and set to spelling this tongue by ear. Most scripts in history spread exactly this way (Latin, Arabic, Cyrillic each cover dozens of languages); a borrowed costume that fits badly is held in place by prestige, and escaping it usually takes an invention.`
      : s.adoptedAt > s.born
        ? `Born logographic (every primary tradition is), then re-learned and simplified — the current type won because it fits this language's own structure.`
      : s.type === "logo" && l.rules.length < 2
        ? `A newborn tradition: writing begins, as every primary invention did, with accounting-token logographs — one sign per morpheme. Its first re-learning juncture is still ahead: <b>Drift</b> the language and watch the script simplify toward whatever fits.`
        : s.type === "logo"
          ? `Still logographic: phonographic writing would collapse this language's short, homophone-heavy morphemes, so simplification never paid.`
          : `Adopted in its current form when the tradition consolidated.`;
  const handStory = s.type === "featural"
    ? "Drawn with the designer's ruler, not the scribe's wear: geometric components compose each syllable into a block — onset beside or above the vowel bar, coda beneath."
    : { carved: "The hand is carved: cuts along the grain split the wood, so no stroke runs level.",
      clay: "The hand presses wedges into clay — heads and drag-tails, the cuneiform economy.",
      brush: "The hand is a brush: heavy, boxy, stroke-ordered signs.",
      pen: "The hand is a reed pen: strokes chain and loop" + (s.join ? ", and the letters of a word join along the baseline, the last sweeping out in a final swash. Letters worn into the same skeleton are kept apart by POINTING — dots above or below, the i'jam solution that split ب ت ث" : "") + ".",
      round: "The hand is rounded: a straight cut splits the palm leaf, so every stroke arcs." }[s.hand];
  const gOpts = { hand: s.hand, headline: s.headline, join: s.join, dir: s.dir };
  const gOptsPlain = { hand: s.hand };
  const inv = glyphInventory(l, 24) || [];
  const invCells = inv.map(g => `<span class="glyphcell">${glyphSVG(g, 26, gOptsPlain)}<span class="lbl">${esc(g.label)}</span></span>`).join("");
  const wordHTML = (w) => `<span class="glyphword${s.dir === "rtl" ? " rtl" : s.dir === "ttb" ? " ttb" : ""}${s.headline || s.join ? " tight" : ""}">${w.glyphs.map(g => glyphSVG(g, 22, gOpts)).join("")}</span>`;
  const rows = [];
  for (const cid of [STONE, KING, RIVER, MOTHER, WOLF, HORSE]) {
    const w = writeWord(l, cid);
    if (!w) continue;
    rows.push(`<tr><td class="lbl">${esc(glossOf(cid))}</td>
      <td>${wordHTML(w)}</td>
      <td class="w">⟨${esc(w.translit)}⟩</td><td class="w">${esc(wordOf(l, cid))}</td>
      <td class="gloss ipa">[${esc(ipaOf(l, nativeStemOf(l, cid)))}]</td></tr>`);
  }
  // a written LINE: three words under the script's own separation habit
  const lineWords = [KING, SEE, RIVER].map(cid => writeWord(l, cid)).filter(Boolean);
  const sepHTML = s.sep === "space" ? `<span class="wsep"></span>` : s.sep === "dot" ? `<span class="wsep dot">·</span>` : "";
  const lineHTML = lineWords.length !== 3 ? ""
    : s.dir === "boustro"
      // the ox turns: the second line runs back the other way, its letters
      // MIRRORED — archaic Greek did exactly this
      ? `<p class="cells glyphline">${wordHTML(lineWords[0])}${sepHTML}${wordHTML(lineWords[1])}</p>
         <p class="cells glyphline boustroline">${wordHTML(lineWords[2])} <span class="gloss">‘king · see · river’ — the line turns as the ox plows, letters mirrored on the return</span></p>`
      : `<p class="cells glyphline${s.dir === "ttb" ? " ttb" : ""}">${lineWords.map(w => wordHTML(w)).join(sepHTML)} <span class="gloss">‘king · see · river’${s.sep === "continua" ? " — run together, as old traditions did" : ""}</span></p>`;
  // numerals: tally marks for the low digits, own signs above
  const nums = [1, 2, 3, 4, 7, 10].map(n => { const g = numeralGlyphs(l, n); return g ? `<span class="glyphcell">${g.map(x => glyphSVG(x, 26, gOptsPlain)).join("")}<span class="lbl">${n}</span></span>` : ""; }).join("");
  const silent = silentLetterSample(l, 3);
  const silentLine = silent.length
    ? `<p class="note"><b>Orthographic lag</b> — the tradition still spells the older tongue, and the fossil letters show: ${silent.map(x => `⟨${esc(x.written)}⟩ now said <span class="w">${esc(x.said)}</span>`).join(" · ")}. Drift the language further and the gap deepens; a script re-learning is the spelling reform that closes it.</p>` : "";
  return `<section class="card"><h2>Writing <span class="count">— an emergent script</span></h2>
    <div class="chips">${chips}</div>
    <p class="note">${story} ${handStory} A derived word's logograph compounds its parts in a radical slot, and a homophone is written phono-semantically — a domain radical beside the sign it sounds like, the machine that built most of the hanzi. ⟨brackets⟩ show the frozen spelling romanized; beside it, how the word is said today.</p>
    <h3>Signs</h3>
    <p class="cells glyphrow">${invCells}</p>
    <h3>Numerals</h3>
    <p class="cells glyphrow">${nums}</p>
    <h3>Written words</h3>
    <div class="scroll"><table><thead><tr><th>meaning</th><th>written</th><th>spelled</th><th>said</th><th>IPA</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
    <h3>A written line</h3>
    ${lineHTML}
    ${silentLine}</section>`;
}

// ── the grammar card: syntax dials, closed classes, counting ─────────────
const WO_NAME = { sov: "SOV", svo: "SVO", vso: "VSO", vos: "VOS", ovs: "OVS" };
function grammarHTML(l) {
  const g = gramOf(l);
  const cl = closedOf(l);
  // the case chip must match the declension table it sits above (a fresh
  // reader caught "1 case (nom–acc)" over a NOM+GEN table): name the marked
  // cases the paradigm actually shows
  const markedCases = paradigmShape(l).cases.filter(c => c.k).map(c => c.g);
  const alignName = { erg: "ergative", active: "active-stative", tripartite: "tripartite" }[g.align] || "nom–acc";
  const caseChip = !markedCases.length ? "no case"
    : markedCases.length === 1 && markedCases[0] === "GEN" ? "genitive only — no core case"
    : `${markedCases.length} marked case${markedCases.length > 1 ? "s" : ""} (${alignName})`;
  const gchips = [
    `${WO_NAME[g.wo]} order`,
    g.adpSide === "pre" ? "prepositions" : "postpositions",
    caseChip,
    g.genders ? `${g.genders} noun classes` : null,
    g.tenses > 1 ? `${g.tenses} tenses` : "tenseless",
    g.aspect ? "aspect" : null,
    g.agree !== "none" ? (g.agree === "both" ? "polypersonal agreement" : "person agreement") : null,
    g.proDrop ? "pro-drop" : null,
    g.numBase !== 10 ? `base-${g.numBase} counting` : "decimal counting",
    g.clusiv ? "inclusive/exclusive we" : null,
    g.dual ? "dual number" : null,
    g.defArt ? "definite article" : null,
    g.genN ? "genitive-first" : "noun-first genitive",
    g.redup ? `${g.redup.type} reduplication (${g.redup.fns.join("/")})` : null,
    `${g.imp} imperative`,
  ].filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join("");
  const pron = cl.prons.map(p => `<span class="cell"><span class="lbl">${esc(p.g)}</span> <span class="w">${esc(p.w)}</span></span>`).join(" ");
  const dems = cl.dems.map(d => `<span class="cell"><span class="lbl">${esc(d.g)}</span> <span class="w">${esc(d.w)}</span></span>`).join(" ");
  const qs = cl.qs.map(q => `<span class="cell"><span class="lbl">${esc(q.g)}</span> <span class="w">${esc(q.w)}</span></span>`).join(" ");
  const conj = cl.conj.map(x => `<span class="cell"><span class="lbl">${esc(x.k)}</span> <span class="w">${esc(x.w)}</span></span>`).join(" ");
  const adps = cl.adps.map(a => `<span class="cell"><span class="lbl">${esc(a.m)}</span> <span class="w">${esc(a.w)}</span>${a.src != null ? `<span class="gloss"> ‹ ‘${esc(glossOf(a.src))}’</span>` : ""}</span>`).join(" ");
  const arts = [cl.defArt ? `<span class="cell"><span class="lbl">the</span> <span class="w">${esc(cl.defArt.w)}</span><span class="gloss"> ‹ ‘${esc(cl.defArt.src)}’</span></span>` : "",
    cl.indefArt ? `<span class="cell"><span class="lbl">a</span> <span class="w">${esc(cl.indefArt.w)}</span><span class="gloss"> ‹ ‘${esc(cl.indefArt.src)}’</span></span>` : ""].join(" ");
  const nums1 = [];
  for (let n = 1; n <= 10; n++) nums1.push(`<span class="cell"><span class="lbl">${n}</span> <span class="w">${esc(numeral(l, n).text)}</span></span>`);
  const numsBig = [15, 23, 40, 87, 123].map(n => {
    const x = numeral(l, n);
    return `<li><span class="lbl">${n}</span> <span class="w">${esc(x.text)}</span> <span class="gloss">‘${esc(x.gloss)}’</span></li>`;
  }).join("");
  return `<section class="card"><h2>Grammar</h2>
    <div class="chips">${gchips}</div>
    <p class="note">Syntax dials are rolled with Greenberg's correlations at real frequencies (verb-final tongues take postpositions and suffixes; verb-first tongues take prepositions), and the little words are worn-down forms of the language's own vocabulary — the ‹ notes show what each one used to be.</p>
    <h3>Pronouns</h3><p class="cells">${pron}</p>
    <h3>Demonstratives &amp; negation</h3><p class="cells">${dems} <span class="cell"><span class="lbl">not</span> <span class="w">${esc(cl.neg.w)}</span></span> ${arts}</p>
    <h3>Question words</h3><p class="cells">${qs}</p>
    <h3>Adpositions</h3><p class="cells">${adps}</p>
    <h3>Conjunctions</h3><p class="cells">${conj}</p>
    <h3>Counting (base ${g.numBase})</h3>
    <p class="cells">${nums1.join(" ")}</p>
    <ul class="cols">${numsBig}</ul></section>`;
}

// ── the grammar frontier: the rarer-but-real typology (clusters A–G) ──────
// Each subsection is EMERGENT — it appears only when this language's dials
// rolled the feature, so a plain SVO tongue shows a short card and an
// Amazonian-shaped one a long one. Every example is rendered live.
// every example sentence is speakable whole — clause trees group into
// intonation phrases, non-final clauses rising into the comma
const clauseEx = (label, cl) => {
  const l = active();
  const btn = cl.tokens && cl.tokens.some(t => t.f)
    ? ` <button class="spk play" data-cp="${regClause(planGroups(l, cl.tokens), "fall")}" title="speak the sentence">▶</button>` : "";
  return `<p class="ensent dim">${esc(label)}${btn}</p>${interHTML(cl)}`;
};
const cellStr = (x) => esc([...x.pre.map(t => t.w), x.text, ...x.post.map(t => t.w)].join(" "));

function verbFrontierHTML(l) {
  const secs = [];

  // ── Alignment (Group F) ──
  const al = alignmentOf(l);
  const alName = { acc: "nominative–accusative", erg: "ergative–absolutive", active: "active–stative", tripartite: "tripartite" }[al.align] || al.align;
  const alChips = [alName,
    al.ergSplit === "tam" ? "split-ergative by tense/aspect" : al.ergSplit === "hier" ? "split-ergative by hierarchy" : null,
    al.activeFluid ? "fluid-S (volition flips it)" : null,
    al.invAgree ? "direct–inverse marking" : null, al.absAgree ? "absolutive agreement" : null,
  ].filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join("");
  // a split-ergative claim must be DEMONSTRATED on both sides of its split
  // (a fresh reader caught the header claiming a tense split while every
  // example sat in the past) — show the other half when a split is live
  const splitEx = al.ergSplit === "tam"
    ? clauseEx("the king sees the river (present — the accusative side of the split)", renderClause(l, { s: { n: KING, def: true }, v: { c: SEE, tam: null }, o: { n: RIVER, def: true } }))
    : al.ergSplit === "hier"
      ? clauseEx("I saw the river (a pronoun subject sits atop the hierarchy — no ERG)", renderClause(l, { s: { pron: { k: "1sg", pers: 1, num: "sg" } }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } }))
      : "";
  secs.push(`<h3>Alignment</h3><div class="chips">${alChips}</div>
    <p class="note">Which arguments get flagged. Compare the subject of the transitive clause with the intransitive — under ergativity it is the OBJECT that patterns with the lone subject.</p>
    ${clauseEx("the king saw the river", renderClause(l, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } }))}
    ${clauseEx("the wolf went", renderClause(l, { s: { n: WOLF, def: true }, v: { c: GO, tam: "pst" } }))}
    ${splitEx}`);

  // ── Voice & valency (Group B + the syntax-completion reflexive/reciprocal) ──
  const voices = voicesOf(l), vet = voiceEtymologies(l);
  const vkeys = ["caus", "pass", "antip", "appl"].filter(k => voices[k]);
  {
    const vname = { caus: "causative", pass: "passive", antip: "antipassive", appl: "applicative" };
    const vchips = vkeys.map(k => { const e = vet.find(x => x.k === k); return `<span class="chip">${vname[k]}${e && e.from ? ` ‹ ‘${esc(e.from)}’` : ""}</span>`; });
    const rEt = vet.find(x => x.k === "refl");
    vchips.push(`<span class="chip">reflexive: ${voices.refl === "verb" ? "verbal (-sja-style)" : "pronoun"}${rEt && rEt.from ? ` ‹ ‘${esc(rEt.from)}’` : ""}</span>`);
    if (voices.recpSame) vchips.push(`<span class="chip">reciprocal = reflexive</span>`);
    const exs = [];
    if (voices.caus) exs.push(clauseEx("causative — ‘the king made the wolf go’", renderClause(l, { s: { n: KING, def: true }, v: { c: GO, tam: "pst", voice: "caus" }, o: { n: WOLF, def: true } })));
    if (voices.pass) exs.push(clauseEx("passive — ‘the river was seen (by the king)’", renderClause(l, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst", voice: "pass" }, o: { n: RIVER, def: true } })));
    if (voices.antip) exs.push(clauseEx("antipassive — ‘the king saw (at the river)’", renderClause(l, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst", voice: "antip" }, o: { n: RIVER, def: true } })));
    if (voices.appl) exs.push(clauseEx("applicative — ‘the king ate the queen the bread’ (for-her, promoted)", renderClause(l, { s: { n: KING, def: true }, v: { c: EAT, tam: "pst", voice: "appl" }, o: { n: BREAD, def: true }, loc: { adp: "to", n: QUEEN, def: true } })));
    exs.push(clauseEx("reflexive — ‘the king saw himself’", renderClause(l, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst", voice: "refl" } })));
    exs.push(clauseEx("reciprocal — ‘they saw each other’", renderClause(l, { s: { pron: { k: "3pl", pers: 3, num: "pl" } }, v: { c: SEE, tam: "pst", voice: "recp" } })));
    secs.push(`<h3>Voice &amp; valency</h3><div class="chips">${vchips.join("")}</div>
      <p class="note">Re-casting who-did-what: promote or demote an argument. Each marker is a worn-down verb or noun (‘make’, ‘fall’, ‘body’) — the ‹ notes show which.</p>${exs.join("")}`);
  }

  // ── Predication, existence & possession (syntax completion) ──
  {
    const pr = predicationOf(l);
    const copName = { verb: "verbal (BE inflects)", zero: "zero — tensed (past grows BE)", pron: "pronoun copula (‹ 3sg)" };
    const possName = { have: "‘have’ (transitive)", loc: "locational (‘at the king is…’)", topic: "topic (‘the king — there is…’)", gen: "genitive (‘the king's horse exists’)", com: "comitative (‘is with…’)" };
    const chips = [
      `nominal: ${copName[pr.cop.nominal]}`,
      `adjectives: ${pr.cop.adjectival === "verb" ? "predicate like verbs" : "take the copula"}`,
      pr.cop.posture ? `location ‹ ‘${esc(pr.cop.posture.g)}’` : null,
      `existential ‹ ‘${esc(pr.exist.from)}’`,
      pr.exist.negEx === "special" ? `fused ‘there-is-no’ (${esc(pr.exist.negExW)})` : null,
      `possession: ${possName[pr.poss]}`,
      pr.svc ? `serial verbs (TAM on ${pr.svc.tam === "first" ? "the first" : "both"})` : null,
    ].filter(Boolean).map(t => `<span class="chip">${t}</span>`).join("");
    // the past-tense caption is only true where the copula is actually ZERO
    // (a tensed zero copula grows its BE); a verbal-adjective language just
    // conjugates the property word, a copular one already has an overt copula
    const pastCap = pr.cop.nominal === "zero" && pr.cop.adjectival === "cop"
      ? "‘the king was old’ (watch a zero copula grow its BE)"
      : pr.cop.adjectival === "verb" ? "‘the king was old’ (the property word takes tense directly)"
      : "‘the king was old’";
    const exs = [
      clauseEx("‘the king is old’", renderClause(l, { s: { n: KING, def: true }, pred: { adj: OLD }, v: {} })),
      clauseEx(pastCap, renderClause(l, { s: { n: KING, def: true }, pred: { adj: OLD }, v: { tam: "pst" } })),
      clauseEx("‘the king is a wolf’", renderClause(l, { s: { n: KING, def: true }, pred: { n: WOLF, def: false }, v: {} })),
      clauseEx("‘there is grain in the town’", renderClause(l, { ex: { n: GRAIN }, loc: { adp: "in", n: TOWN, def: true }, v: {} })),
      clauseEx("‘there is no grain’", renderClause(l, { ex: { n: GRAIN }, v: { neg: true } })),
      clauseEx("‘the king has a horse’", renderClause(l, { poss: { possessor: { n: KING, def: true }, possessed: { n: HORSE, def: false } }, v: {} })),
    ];
    if (pr.svc) exs.push(clauseEx("serial verbs — ‘the king took the sword (and) ate the bread’, one clause", renderClause(l, { s: { n: KING, def: true }, v: { c: TAKE, tam: "pst" }, o: { n: SWORD, def: true }, v2: { c: EAT, o: { n: BREAD, def: true } } })));
    secs.push(`<h3>Being, having, existing</h3><div class="chips">${chips}</div>
      <p class="note">How ‘X is Y’, ‘there is X’ and ‘X has Y’ are said — a verbal, pronominal or TENSED-ZERO copula; a be/have/posture existential (locative fronts, presentationally); possession as one of the five real strategies. All thin remaps of machinery the language already has.</p>${exs.join("")}`);
  }

  // ── Polysynthesis (phase 3) — the saturated verb, only where rolled ──
  const ps = polysynthesisOf(l);
  if (ps) {
    const g2 = gramOf(l);
    secs.push(`<h3>Polysynthesis</h3><div class="chips"><span class="chip">noun incorporation</span><span class="chip">polypersonal verb</span>${ps.oneWord ? `<span class="chip">one-word clauses</span>` : ""}</div>
      <p class="note">The fifth morphological type: the verb SATURATES — subject and object are both indexed on it, pronouns stay home, and a non-specific object INCORPORATES: its stem welds into the verb word, which then inflects as one long word (‘he fish-takes’ = he fishes).</p>
      ${clauseEx("‘the king took the fish’ (plain — the object stands free, cased and indexed)", renderClause(l, { s: { n: KING, def: true }, v: { c: TAKE, tam: "pst" }, o: { n: FISH, def: true } }))}
      ${clauseEx("‘the king fish-takes’ (incorporated — one verb word, detransitivized)", renderClause(l, { s: { n: KING, def: true }, v: { c: TAKE, tam: "pst" }, o: { n: FISH, incorp: true } }))}
      ${g2.proDrop ? clauseEx("‘I saw it’ — the whole clause is ONE word", renderClause(l, { s: { pron: { k: "1sg", pers: 1, num: "sg" } }, v: { c: SEE, tam: "pst" }, o: { pron: { k: "3sg", pers: 3, num: "sg" } } })) : ""}`);
  }

  // ── Information structure (item 1.8): topic & focus scrambling ──
  {
    const info = infoStructureOf(l);
    const chips = [
      `focus: ${info.focus === "front" ? "ex-situ (scrambled to the front)" : "in-situ (marked in place)"}`,
      info.scramble ? "case-licensed scrambling" : "rigid constituent order",
      info.topicMark ? `TOP ‹ ‘${esc(info.topicMark.from)}’ (${esc(info.topicMark.w)})` : null,
      info.focusMark ? `FOC ‹ ‘${esc(info.focusMark.from)}’ (${esc(info.focusMark.w)})` : null,
    ].filter(Boolean).map(t => `<span class="chip">${t}</span>`).join("");
    const plain = renderClause(l, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } });
    const topic = renderClause(l, { s: { n: KING, def: true, topic: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } });
    const focus = renderClause(l, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true, focus: true } });
    secs.push(`<h3>Information structure</h3><div class="chips">${chips}</div>
      <p class="note">Word order carries more than grammar — it marks TOPIC (what the clause is about) and FOCUS (the new, contrastive part). A topic fronts${info.topicMark ? ", taking a clitic worn from the demonstrative" : ""}; a focus ${info.focus === "front" ? "SCRAMBLES to the front" : "stays in place under a clitic worn from ‘be’"}. Which is even possible is emergent: rich case keeps a moved argument's role recoverable, so case-rich tongues reorder freely while rigid, caseless ones mark in place instead.</p>
      ${clauseEx("neutral — ‘the king saw the river’", plain)}
      ${clauseEx("topic on the subject — ‘the king, (he) saw the river’", topic)}
      ${clauseEx("focus on the object — ‘it was the RIVER the king saw’", focus)}`);
  }

  // ── Tense · aspect · mood depth (Group C′) ──
  const ts = tamShape(l), forms = [];
  const vf = (label, opts) => forms.push(`<span class="cell"><span class="lbl">${esc(label)}</span> <span class="w">${cellStr(inflectVerb(l, SEE, opts))}</span></span>`);
  if (ts.perfect) vf("perfect", { tam: "prf" });
  if (ts.progressive) vf("progressive", { tam: "prog" });
  if (ts.habitual) vf("habitual", { tam: "hab" });
  if (ts.remotePast >= 1) vf("remote past", { tam: "pstrem" });
  for (const m of ts.moods) vf({ sbjv: "subjunctive", cond: "conditional", opt: "optative", pot: "potential" }[m] || m, { tam: "pst", pers: "3", irrealisMood: m });
  if (ts.mirative) vf("mirative", { tam: "pst", mir: true });
  if (forms.length) secs.push(`<h3>Tense · aspect · mood</h3>
    <p class="note">Beyond a plain past: ${ts.tenses} tense${ts.tenses > 1 ? "s" : ""}${ts.aspect ? ", grammatical aspect" : ""}${ts.remotePast ? ", graded remoteness" : ""}. Synthetic tongues carry more of these — all on the verb ‘see’.</p>
    <p class="cells">${forms.join(" ")}</p>`);

  // ── Evidentiality (Group C) ──
  const ev = evidentialSystem(l);
  if (ev) {
    const cells = ev.forms.map(f => `<span class="cell"><span class="lbl">${esc(f.gloss)}</span> <span class="w">${f.zero ? "∅" : esc(f.w)}</span>${f.from ? `<span class="gloss"> ‹ ‘${esc(f.from)}’</span>` : ""}</span>`).join(" ");
    secs.push(`<h3>Evidentiality <span class="count">(${ev.n}-term${ev.mir ? " + mirativity" : ""})</span></h3>
      <p class="note">The verb marks HOW the speaker knows — saw it, heard it, inferred it, was told. Each exponent is a worn-down perception or speech verb; the firsthand is often ∅.</p>
      <p class="cells">${cells}</p>
      ${clauseEx("‘the king saw the river, they say’", renderClause(l, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst", ev: "rept" }, o: { n: RIVER, def: true } }))}`);
  }

  return `<section class="card"><h2>The verb <span class="count">— argument structure, tense, evidence</span></h2>${secs.join("")}</section>`;
}

function nounFrontierHTML(l) {
  const g = gramOf(l), secs = [];

  // ── Noun classes & concord (Group A) ──
  if (g.genders >= 2) {
    const inv = classInventory(l), marks = concordMarkers(l), targets = agreementTargets(l) || [];
    const classRows = inv.map(ci => {
      const m = marks[ci.cls];
      const samples = ci.sample.slice(0, 4).map(cid => esc(glossOf(cid))).join(", ");
      return `<li><span class="lbl">${esc(m.g)}</span>${m.w ? ` <span class="w">${esc(m.w)}-</span>` : ""} <span class="gloss">${samples}</span></li>`;
    }).join("");
    // adjective agreement on two heads of different classes
    const two = inv.filter(ci => ci.sample.length).slice(0, 2);
    const agr = two.map(ci => { const head = ci.sample[0]; const a = inflectAdj(l, GREAT, { cls: ci.cls }); return `<span class="cell"><span class="w">${esc(a.text)} ${esc(wordOf(l, head))}</span> <span class="gloss">‘great ${esc(glossOf(head))}’</span></span>`; }).join(" ");
    secs.push(`<h3>Noun classes <span class="count">(${g.genders}; agree on ${targets.join(", ") || "—"})</span></h3>
      <p class="note">Every noun belongs to a class, assigned by meaning (animacy, sex) with a phonological cue for the residue. Dependents then AGREE — the adjective takes the head's class, so an NP alliterates.</p>
      <ul class="cols">${classRows}</ul>
      ${agr ? `<p class="cells">${agr}</p>` : ""}`);
  }

  // ── Numeral classifiers (Group D) ──
  const clf = classifiersOf(l);
  if (clf) {
    const cells = classifierEtymologies(l).map(e => `<span class="cell"><span class="lbl">${esc(e.cls)}</span> <span class="w">${esc(e.w)}</span>${e.from ? `<span class="gloss"> ‹ ‘${esc(e.from)}’</span>` : ""}</span>`).join(" ");
    const exs = [KING, HORSE, RIVER].map(cid => clauseEx(`three ${glossOf(cid)}${cid === RIVER ? "s" : "s"}`, numeralPhrase(l, cid, 3))).join("");
    secs.push(`<h3>Numeral classifiers <span class="count">(${clf.obl ? "obligatory" : "optional"}, ${clf.order}-N)</span></h3>
      <p class="note">Counting takes a sortal classifier keyed to the noun's shape or animacy (a human one, a long-thing one…), each worn from a body/shape noun.</p>
      <p class="cells">${cells}</p>${exs}`);
  }

  // ── Nominal categories (Group E) ──
  const nsecs = [];
  if (g.possAffix) {
    const p1 = inflectPossessed(l, HAND, { pers: 1, num: "sg" }), p2 = inflectPossessed(l, HOUSE, { pers: 1, num: "sg" });
    nsecs.push(`<p class="cells"><span class="cell"><span class="lbl">possession${g.alienSplit ? " (split)" : ""}</span></span>
      <span class="cell"><span class="w">${esc(p1.text)}</span> <span class="gloss">‘my hand’ (${possessionType(l, HAND)})</span></span>
      <span class="cell"><span class="w">${esc(p2.text)}</span> <span class="gloss">‘my house’ (${possessionType(l, HOUSE)})</span></span></p>`);
  }
  const cmp = comparative(l, GREAT, KING, { degree: "cmpr" }), sup = comparative(l, GREAT, null, { degree: "sup" });
  nsecs.push(`<p class="cells"><span class="cell"><span class="lbl">comparison (${g.compar.type})</span></span>
    <span class="cell"><span class="w">${esc(cmp.text)}</span> <span class="gloss">‘greater than the king’</span></span>
    <span class="cell"><span class="w">${esc(sup.text)}</span> <span class="gloss">‘greatest’</span></span></p>`);
  if (g.tv !== "none") {
    const tv = tvPronouns(l);
    nsecs.push(`<p class="cells"><span class="cell"><span class="lbl">politeness (${tv.tv}, ‹ ${tv.source})</span></span>
      <span class="cell"><span class="lbl">familiar</span> <span class="w">${esc(tv.familiar)}</span></span>
      <span class="cell"><span class="lbl">polite</span> <span class="w">${esc(tv.polite)}</span></span>${tv.tv === "multi" ? `<span class="cell"><span class="lbl">honorific</span> <span class="w">${esc(tv.honorific)}</span></span>` : ""}</p>`);
  }
  if (g.trial || g.paucal) {
    const extra = [g.paucal ? ["paucal", "pau"] : null, g.trial ? ["trial", "tri"] : null].filter(Boolean)
      .map(([lab, num]) => `<span class="cell"><span class="lbl">${lab}</span> <span class="w">${cellStr(inflectNoun(l, STONE, { num }))}</span></span>`).join(" ");
    nsecs.push(`<p class="cells"><span class="cell"><span class="lbl">number</span></span> ${extra}</p>`);
  }
  secs.push(`<h3>Nominal categories</h3>
    <p class="note">Possession (whose?), comparison (more than), politeness (tu/vous), and number beyond the singular/plural — each built from the language's own words.</p>${nsecs.join("")}`);

  // ── Multi-clause syntax (Group G) ──
  const lk = clauseLinkersOf(l);
  const mc = [];
  mc.push(clauseEx("coordination — ‘the king went and the wolf saw the river’", renderClauseTree(l, { coord: "and", clauses: [{ s: { n: KING, def: true }, v: { c: GO, tam: "pst" } }, { s: { n: WOLF, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } }] })));
  mc.push(clauseEx("complement — ‘the king saw that the wolf went’", renderClause(l, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { comp: { s: { n: WOLF, def: true }, v: { c: GO, tam: "pst" } } } })));
  mc.push(clauseEx("relative — ‘the king who saw the river went’", renderClause(l, { s: { n: KING, def: true, rel: { role: "s", v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } } }, v: { c: GO, tam: "pst" } })));
  mc.push(clauseEx("adverbial — ‘the king went when the wolf saw the river’", renderClause(l, { s: { n: KING, def: true }, v: { c: GO, tam: "pst" }, adv: [{ sub: "when", s: { n: WOLF, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } }] })));
  if (lk.chaining) mc.push(clauseEx("clause chain (switch-reference)", renderClauseTree(l, { chain: [{ s: { n: KING, def: true }, v: { c: GO, tam: "pst" } }, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } }] })));
  const lkChips = [`complementizer ‹ ‘${esc(lk.comp.from || "opaque")}’ (${lk.comp.pos})`, `relative: ${lk.rel.strat}, ${lk.rel.pre ? "prenominal" : "postnominal"}`, lk.chaining ? "clause-chaining" : null, lk.coordFinal ? "enclitic ‘and’" : null].filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join("");
  secs.push(`<h3>Multi-clause</h3><div class="chips">${lkChips}</div>
    <p class="note">Clauses combine into a tree — coordinated, embedded as a complement, relativised onto a noun, chained. The subordinators grammaticalize from existing words (‘that’ ‹ ‘say’ or a demonstrative, ‘when’ ‹ ‘day’), and lag a word-order flip.</p>${mc.join("")}`);

  return `<section class="card"><h2>Nouns, phrases &amp; clauses <span class="count">— agreement, counting, subordination</span></h2>${secs.join("")}</section>`;
}

// ── the lexicon's shape (phase 2): colors, kinship, motion typology ───────
const BK_SWATCH = { white: "#f2f0e8", black: "#26241f", red: "#b3362e", green: "#3d7a44", yellow: "#d9a821", blue: "#33619e", brown: "#7a5230", purple: "#7a4f8f", pink: "#d98aa3", orange: "#d06f27", grey: "#8a8578" };
function lexTypologyHTML(l) {
  const secs = [];
  // Berlin–Kay colors: one swatch per basic MEANING; unsplit terms sit inside
  // their parent's word (yellow reading as red)
  const ct = colorTermsOf(l);
  const sw = ct.terms.map(t => {
    const merged = t.mergedInto >= 0;
    return `<span class="cell"><span style="display:inline-block;width:0.8em;height:0.8em;border-radius:50%;background:${BK_SWATCH[t.g] || "#999"};border:1px solid rgba(0,0,0,.25);vertical-align:-0.05em"></span> <span class="lbl">${esc(t.g)}</span> ${merged ? `<span class="gloss">= ${esc(glossOf(t.mergedInto))}</span>` : `<span class="w">${esc(t.w)}</span>`}</span>`;
  }).join(" ");
  secs.push(`<h3>Color terms <span class="count">(${ct.n} basic${ct.grue ? ", grue" : ""})</span></h3>
    <p class="note">Berlin &amp; Kay's hierarchy: color vocabularies grow in a fixed order (dark/light → red → yellow/green → blue → brown → the late terms). A term this family hasn't split yet simply IS its parent — one word covers both.</p>
    <p class="cells">${sw}</p>`);
  // kinship
  const kt = kinshipOf(l);
  const kName = { hawaiian: "generational — Hawaiian-type", iroquois: "bifurcate merging — Iroquois-type", eskimo: "lineal — Eskimo-type", sudanese: "bifurcate collateral — Sudanese-type" };
  const kCells = kt.terms.map(t => `<span class="cell"><span class="lbl">${esc(t.g)}</span> ${t.sameAs >= 0 ? `<span class="gloss">= ${esc(glossOf(t.sameAs))}</span>` : `<span class="w">${esc(t.w)}</span>`}</span>`).join(" ");
  secs.push(`<h3>Kinship <span class="count">(${esc(kName[kt.type] || kt.type)})</span></h3>
    <p class="note">Whether mother's-brother shares father's-brother's word — or father's own — is the family's SYSTEM, not a translation choice: generational merges the whole parent generation, bifurcate-merging keeps only the cross-relatives distinct, lineal has one 'uncle', bifurcate-collateral names every position.</p>
    <p class="cells">${kCells}</p>`);
  // motion typology
  const mt = motionTypologyOf(l);
  const mName = { sat: "satellite-framed — path on the adposition", verb: "verb-framed — path in the verb", equi: "equipollent — both verbs, serialized" };
  const mEx = clauseEx("‘the king ran into the town’", renderClause(l, { s: { n: KING, def: true }, v: { c: RUN, tam: "pst" }, path: { p: ENTER, n: TOWN, def: true } }));
  const eEty = etymologyOf(l, ENTER);
  secs.push(`<h3>Motion <span class="count">(${esc(mName[mt])})</span></h3>
    <p class="note">Talmy's split: where the PATH of motion lives. A satellite-framed tongue keeps the manner verb and says ‘ran in’ — its ‘enter’ is a go-compound${eEty ? ` (here ${esc(wordOf(l, ENTER))} ‹ ‘${esc(eEty.gloss)}’)` : ""}; a verb-framed one says ‘entered’ and lets the running go unsaid; a serializing one says both.</p>
    ${mEx}`);
  // affixal derivation — the agentive nominalizer (item 1.5): 'one who VERBs' =
  // a base verb + an agentive affix worn from the family's own 'person' word.
  // The SAME affix rides every agent (regular) and the base stays whole
  // (transparent), both riding the sound-change log (regular correspondence).
  const agEty = etymologyOf(l, RULER);
  if (agEty) {
    const AGENTS = [[RULER, RULEV], [BUILDER, BUILDV], [WARRIOR, FIGHTV], [SEER, SEE], [SPEAKER, SAY]];
    const hf = (l.prof.compound || "hl") === "hf";
    const ws = AGENTS.map(([a]) => wordOf(l, a));
    // the shared affix (the regular exponent), taken on the headedness edge
    const shared = (tail) => { let p = ws[0]; for (const s of ws) { let i = 0; while (i < p.length && i < s.length && (tail ? p[p.length - 1 - i] === s[s.length - 1 - i] : p[i] === s[i])) i++; p = tail ? p.slice(p.length - i) : p.slice(0, i); } return p; };
    const affix = hf ? shared(false) : shared(true);
    const emph = (w) => {
      if (affix && hf && w.startsWith(affix)) return `<u>${esc(affix)}</u>${esc(w.slice(affix.length))}`;
      if (affix && !hf && w.endsWith(affix)) return `${esc(w.slice(0, w.length - affix.length))}<u>${esc(affix)}</u>`;
      return esc(w);
    };
    const rows = AGENTS.map(([a, b], i) => `<span class="cell"><span class="gloss">${esc(glossOf(b))} →</span> <span class="w">${emph(ws[i])}</span> <span class="lbl">${esc(glossOf(a))}</span></span>`).join(" ");
    secs.push(`<h3>Derivation <span class="count">(agentive ‹ ‘${esc(glossOf(agEty.mod))}’${hf ? ", a prefix" : ""})</span></h3>
      <p class="note">‘One who VERBs’ is COINED, not memorised: a base verb takes an agentive affix worn down from this family's own word for ‘${esc(glossOf(agEty.mod))}’ (the -er / -sha / mu- machine). The same ${hf ? "prefix" : "suffix"} (<u>underlined</u>) rides every agent — that is the regularity that makes it an affix — while the base stays whole, so ‘${esc(wordOf(l, RULER))}’ still shows ‘${esc(wordOf(l, RULEV))}’ inside it. Both morphemes ride the sound-change log, so a cognate in a sister tongue corresponds sound-for-sound.</p>
      <p class="cells">${rows}</p>`);
  }
  // cultural ecology (item 1.6): the family's subsistence focus keeps its
  // salient domain lexically finer — show which of that domain's concepts stay
  // distinct (a word of their own) rather than blurring into a neighbour
  const cult = cultureOf(l);
  if (cult) {
    const DOMAIN_WORDS = { wat: [SEA, LAKE, RIVER, WATER], plt: [TREE, WOOD, FOREST, GRAIN], lnd: [MOUNTAIN, HILL, EARTH, LAND], sky: [SUN, MOON, DAY, MONTH] };
    const domName = { wat: "water", plt: "plant & grain", lnd: "land", sky: "sky" };
    const set = DOMAIN_WORDS[cult.salient] || [];
    const cells = set.map(cid => {
      const p = colexPartner(l, cid);
      return `<span class="cell"><span class="lbl">${esc(glossOf(cid))}</span> ${p >= 0 ? `<span class="gloss">= ${esc(glossOf(p))}</span>` : `<span class="w">${esc(wordOf(l, cid))}</span>`}</span>`;
    }).join(" ");
    const distinct = set.filter(cid => colexPartner(l, cid) < 0).length;
    secs.push(`<h3>Cultural ecology <span class="count">(${esc(cult.gloss)})</span></h3>
      <p class="note">A community's way of life makes its vocabulary FINER where it lives: a ${esc(cult.kind)} tongue keeps its ${domName[cult.salient]} words apart where a stranger to that domain lets them blur together (sea = lake, hill = mountain). Emergent, not scripted — colexification is simply halved in the salient domain, so ${distinct}/${set.length} of these keep a word of their own here.</p>
      <p class="cells">${cells}</p>`);
  }
  // the new colex domains, only where they fired (emergent card)
  const pairs = [[MIND, HEART, "one word for heart & mind"], [MIND, HEAD, "one word for head & mind"], [LANGUAGE_C, TONGUE, "the tongue IS the language"], [BARK, SKIN, "bark is just ‘skin’"]];
  const fired = pairs.filter(([a, b]) => wordOf(l, a) === wordOf(l, b)).map(([a, b, lab]) => `<span class="cell"><span class="w">${esc(wordOf(l, a))}</span> <span class="gloss">${esc(lab)}</span></span>`);
  if (fired.length) secs.push(`<h3>Shared words</h3><p class="cells">${fired.join(" ")}</p>`);
  return `<section class="card"><h2>The lexicon's shape <span class="count">— colors, kin, motion</span></h2>${secs.join("")}</section>`;
}

// ── diglossia + dialects (phase 5): register split + the isogloss bundle ──
const REG_WORDS = [KING, RIVER, STONE, HOUSE, WATER, MOTHER, GOD, WINE];
const DIAL_WORDS = [WATER, RIVER, STONE, KING, WOLF, HOUSE, MOTHER, HAND];
function registerDialectHTML(l) {
  const secs = [];
  // ── diglossia: the H (chronicle) vs L (street) split, only where the lag
  // has grown deep enough to support it ──
  const reg = registerOf(l);
  if (reg) {
    const hi = highRegister(l);
    const wordRows = REG_WORDS.map(cid => ({ cid, rw: registerWords(l, cid) })).filter(x => x.rw.differ).slice(0, 6)
      .map(({ cid, rw }) => `<span class="cell"><span class="lbl">${esc(glossOf(cid))}</span> <span class="w">${esc(rw.low)}</span> <span class="gloss">/ ${esc(rw.high)}${rw.loanInLow ? " (native)" : ""}</span></span>`).join(" ");
    const F = { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } };
    secs.push(`<h3>Diglossia <span class="count">(lag ${reg.lag} — a high/low split)</span></h3>
      <p class="note">Where the written form has drifted far from speech, a stable HIGH register survives: the CHRONICLE voice, the language as its spelling froze it — read with a conservative pronunciation, its old case-endings intact, its inherited words kept where the street took a loan. It is the frozen ghost the writing layer already computes, spoken.</p>
      <p class="cells"><span class="cell"><span class="lbl">street / chronicle</span></span> ${wordRows}</p>
      ${clauseEx("street voice — ‘the king saw the river’", renderClause(l, F))}
      ${clauseEx("chronicle voice — the same, read in the high register", renderClause(hi, F))}`);
  }
  // ── dialects: a chain of low-divergence lects, the isogloss bundle ──
  // scan a broad, RECOGNISABLE pool and surface the words that actually vary
  // across the chain (a given chain's isoglosses touch some words, not others
  // — so a fixed short list can miss them all); prefer the common concepts.
  const dls = dialectsOf(l, 5);
  const POOL = [...DIAL_WORDS, ...Array.from({ length: 90 }, (_, i) => i)];
  const seen = new Set(), varied = [];
  for (const cid of POOL) {
    if (seen.has(cid) || cid >= CONCEPTS.length) continue;
    seen.add(cid);
    if (new Set(dls.map(d => wordOf(d, cid))).size > 1) varied.push(cid);
    if (varied.length >= 7) break;
  }
  const shown = varied.length ? varied : DIAL_WORDS.slice(0, 6);
  const isoRows = shown.map(cid =>
    `<tr><td class="lbl">${esc(glossOf(cid))}</td>${dls.map(d => `<td class="w">${esc(wordOf(d, cid))}</td>`).join("")}</tr>`).join("");
  secs.push(`<h3>Dialect continuum <span class="count">(${dls.length} lects, one isogloss apart)</span></h3>
    <p class="note">Sub-branch variation: a chain of lects, each one sound change further than the last, so neighbours are mutually intelligible and the ends drift apart — the same word surfaces as a bundle of regular correspondences (the map a dialect atlas draws). All descend from this tongue.</p>
    <table class="paradigm"><thead><tr><th></th>${dls.map((_, i) => `<th>${i === 0 ? "standard" : "lect " + i}</th>`).join("")}</tr></thead><tbody>${isoRows}</tbody></table>`);
  return `<section class="card"><h2>Registers &amp; dialects <span class="count">— chronicle voice, street voice, the continuum</span></h2>${secs.join("")}</section>`;
}

// ── paradigms: declension + conjugation tables ───────────────────────────
const PARA_NOUNS = [STONE, KING, RIVER, HOUSE, WOLF, MOTHER, HAND, MOUNTAIN, SHIP, FOOT];
const cellHTML = (x) => {
  const toks = [...x.pre.map(t => t.w), x.text, ...x.post.map(t => t.w)].join(" ");
  return `<td class="w${x.irr ? " irr" : ""}" title="${esc(x.gloss)}">${esc(toks)}</td>`;
};
function paradigmHTML(l) {
  const shape = paradigmShape(l);
  const nounSel = PARA_NOUNS.map(c => `<option value="${c}"${c === S.noun ? " selected" : ""}>${esc(glossOf(c))}</option>`).join("");
  const verbSel = VERBS.map(c => `<option value="${c}"${c === S.verb ? " selected" : ""}>${esc(glossOf(c))}</option>`).join("");
  // identical rows are real SYNCRETISM (one form serving two cells — a
  // Slavic-style past that IS the old perfective); annotate them instead of
  // printing silent duplicates a reader must diff by eye
  const rowStr = (cells) => cells.map(x => [...x.pre.map(z => z.w), x.text, ...x.post.map(z => z.w)].join(" ")).join("|");
  const markRows = (rows) => {
    const seen = new Map();
    return rows.map(({ lbl, cells }) => {
      const k = rowStr(cells);
      const first = seen.get(k);
      if (!first) seen.set(k, lbl);
      const lblHTML = esc(lbl) + (first ? ` <span class="gloss">= ${esc(first)} (syncretic)</span>` : "");
      return `<tr><td class="lbl">${lblHTML}</td>${cells.map(cellHTML).join("")}</tr>`;
    }).join("");
  };
  const nounRows = markRows(shape.cases.map(cs =>
    ({ lbl: cs.g || "NOM", cells: shape.nums.map(n => inflectNoun(l, S.noun, { num: n, cas: cs.k })) })));
  const persCols = shape.pers.length ? shape.pers : [[null, "sg"]];
  let verbRows = markRows(shape.tam.map(t =>
    ({ lbl: t.g || "PRS", cells: persCols.map(([p, n]) => inflectVerb(l, S.verb, { tam: t.k, pers: p, num: n })) })));
  // the imperative row (a category ~every language marks) spans the persons
  verbRows += `<tr><td class="lbl">IMP</td><td class="w" colspan="${persCols.length}" title="addressee-directed command">${
    esc((x => [...x.pre.map(t => t.w), x.text, ...x.post.map(t => t.w)].join(" "))(inflectVerb(l, S.verb, { mood: "imp" })))
  } <span class="gloss">‘${esc(glossOf(S.verb))}!’</span></td></tr>`;
  const persHead = persCols.map(([p, n]) => `<th>${p ? p + n.toUpperCase().replace("SG", "sg").replace("PL", "pl") : ""}</th>`).join("");
  const etys = affixEtymologies(l);
  // the notes describe the SURVIVING paradigm (mode: affix / fused / redup /
  // pattern) — never a birth-time form the tables no longer show
  const etyItem = (e) => {
    if (e.mode === "redup") return `<span class="lbl">${esc(e.g)}</span> <span class="gloss">by reduplication</span>`;
    if (e.mode === "pattern") return `<span class="lbl">${esc(e.g)}</span> <span class="gloss">a vowel pattern${e.w ? ` ⟨${esc(e.w)}⟩` : ""}</span>`;
    if (e.mode === "fused") return `<span class="lbl">${esc(e.g)}</span> <span class="gloss">fused into the stem${e.ex ? ` (${esc(e.ex)})` : ""}${e.from ? `, ‹ ‘${esc(e.from)}’` : ""}</span>`;
    return `<span class="w">${e.side === "pre" ? esc(e.w) + "-" : "-" + esc(e.w)}</span> <span class="lbl">${esc(e.g)}</span>${e.from ? ` <span class="gloss">‹ ‘${esc(e.from)}’</span>` : ""}${e.renewed ? ` <span class="lbl">renewed</span>` : ""}`;
  };
  const etyLine = etys.length ? `<p class="note">Every ending is a worn-down word: ${etys.map(etyItem).join(" · ")}</p>` : "";
  const isoNote = shape.iso ? `<p class="note">An isolating tongue: grammar rides on particles and word order — the words themselves never bend.${shape.redup ? " (But it still reduplicates — a process even isolating languages keep.)" : ""}</p>` : "";
  const inten = intensive(l, GREAT);
  const redupNote = shape.redup ? `<p class="note"><b>Reduplication</b> (${shape.redup.type}, for ${shape.redup.fns.join(" &amp; ")}): a copied stem${inten ? `, e.g. ‘great’ → <span class="w">${esc(inten.text)}</span> <span class="gloss">‘very great’</span>` : ""}. Watch the ${shape.redup.fns.includes("plural") ? "plural column" : ""}${shape.redup.fns.includes("plural") && shape.redup.fns.includes("aspect") ? " and " : ""}${shape.redup.fns.includes("aspect") ? "IPFV row" : ""} above.</p>` : "";
  return `<section class="card"><h2>Paradigms</h2>
    ${isoNote}
    <div class="paragrid">
    <div><h3>Declension of <select id="paraNoun">${nounSel}</select></h3>
    <div class="scroll"><table><thead><tr><th></th>${shape.nums.map(n => `<th>${n.toUpperCase()}</th>`).join("")}</tr></thead><tbody>${nounRows}</tbody></table></div></div>
    <div><h3>Conjugation of <select id="paraVerb">${verbSel}</select></h3>
    <div class="scroll"><table><thead><tr><th></th>${persHead}</tr></thead><tbody>${verbRows}</tbody></table></div></div>
    </div>
    <p class="note"><span class="irr sw"></span> irregular cells — suppletive stems, ablaut pasts, fossil fusions — cluster on the most-used verbs, the way they do in life. Hover any cell for its gloss.</p>
    ${redupNote}
    ${etyLine}</section>`;
}

// ── the sentence panel: semantic frames → interlinear clauses ────────────
const SENT_NOUNS = [KING, QUEEN, WOLF, MOTHER, RIVER, STONE, HORSE, SHIP];
const SENT_OBJS = [RIVER, HORSE, BREAD, SWORD, HOUSE, STONE, WOLF, GRAIN];
const PRON_EN = { "1sg": "I", "2sg": "thou", "3sg": "he", "3sgm": "he", "3sgf": "she", "1du": "we two", "2du": "you two", "1pl": "we", "1pi": "we (incl.)", "1pe": "we (excl.)", "2pl": "you", "3pl": "they" };
const EN_PAST = { go: "went", see: "saw", eat: "ate", be: "was", have: "had", come: "came", do: "did", say: "said", know: "knew", give: "gave", take: "took", make: "made", drink: "drank", sit: "sat", stand: "stood", run: "ran", fall: "fell", fight: "fought", hear: "heard", sleep: "slept" };

function frameFromState(l) {
  const st = S.sent;
  const mkArg = (code) => {
    if (code === "none") return null;
    if (code === "wh") return { wh: true };
    if (code.startsWith("p:")) {
      const k = code.slice(2);
      return { pron: { k, pers: +k[0], num: k.includes("sg") ? "sg" : k.includes("du") ? "du" : "pl" } };
    }
    return { n: +code.slice(2), def: true, adj: code.slice(2) === String(WOLF) ? BLACK : undefined };
  };
  const v = { tam: st.tam === "none" ? null : st.tam, neg: st.neg };
  const subj = mkArg(st.s) || { n: KING, def: true };
  // the nonverbal / existential / possession frame types (syntax completion)
  if (st.type === "cop") return {
    s: subj,
    pred: st.pred === "nom" ? { n: WOLF, def: false } : st.pred === "loc" ? { loc: { adp: "in", n: TOWN, def: true } } : { adj: OLD },
    v, q: st.q,
  };
  if (st.type === "ex") return {
    ex: st.o.startsWith("n:") ? { n: +st.o.slice(2) } : { n: GRAIN },
    loc: st.loc === "none" ? null : { adp: st.loc, n: TOWN, def: true },
    v, q: st.q,
  };
  if (st.type === "poss") return {
    poss: { possessor: subj, possessed: st.o.startsWith("n:") ? { n: +st.o.slice(2) } : { n: HORSE } },
    v, q: st.q,
  };
  const imp = st.mood === "imp";
  return {
    s: imp ? { pron: { k: "2sg", pers: 2, num: "sg" } } : subj,
    v: { c: st.v, tam: st.tam === "none" ? null : st.tam, neg: st.neg, mood: imp ? "imp" : null },
    o: mkArg(st.o),
    loc: st.loc === "none" ? null : { adp: st.loc, n: TOWN, def: true },
    q: imp ? false : st.q,
  };
}

// a plain-English echo of the frame (UI text only — the gloss is the truth)
function englishOf(frame, l) {
  const npEn = (a) => !a ? "" : a.wh ? "what" : a.pron ? (PRON_EN[a.pron.k] || "they")
    : "the " + (a.adj != null ? glossOf(a.adj) + " " : "") + glossOf(a.n);
  // the nonverbal frame types (syntax completion)
  const persOf = (a) => !a || !a.pron ? "3sg" : a.pron.pers + (a.pron.num === "sg" ? "sg" : "pl");
  if (frame.pred) {
    const fv = frame.v || {}, pk = persOf(frame.s);
    const be = resolveTam(l, fv.tam) ? (pk === "1sg" || pk === "3sg" ? "was" : "were") : pk === "1sg" ? "am" : pk === "3sg" ? "is" : "are";
    const p = frame.pred.adj != null ? glossOf(frame.pred.adj) : frame.pred.loc ? frame.pred.loc.adp + " the " + glossOf(frame.pred.loc.n) : "a " + glossOf(frame.pred.n);
    return npEn(frame.s) + " " + be + (fv.neg ? " not" : "") + " " + p + (frame.q ? "?" : "");
  }
  if (frame.ex) {
    const fv = frame.v || {};
    let out = "there " + (resolveTam(l, fv.tam) ? "was" : "is") + (fv.neg ? " no" : "") + " " + glossOf(frame.ex.n);
    if (frame.loc) out += " " + frame.loc.adp + " the " + glossOf(frame.loc.n);
    return out + (frame.q ? "?" : "");
  }
  if (frame.poss) {
    const fv = frame.v || {}, pk = persOf(frame.poss.possessor);
    const has = resolveTam(l, fv.tam) ? "had" : pk === "3sg" ? "has" : "have";
    return npEn(frame.poss.possessor) + " " + has + (fv.neg ? " no" : " a") + " " + glossOf(frame.poss.possessed.n) + (frame.q ? "?" : "");
  }
  const vG = glossOf(frame.v.c);
  // imperative: "(Don't) VERB (the object)!" — no subject, no tense
  if (frame.v.mood === "imp") {
    let out = (frame.v.neg ? "Don't " : "") + vG + (frame.o ? " " + npEn(frame.o) : "");
    return out.charAt(0).toUpperCase() + out.slice(1) + "!";
  }
  const tam = resolveTam(l, frame.v.tam);
  let v;
  if (frame.v.neg) v = (tam === "pst" || tam === "pfv" ? "did not " : tam === "fut" ? "will not " : "does not ") + vG;
  else if (tam === "pst" || tam === "pfv") v = EN_PAST[vG] || vG + "ed";
  else if (tam === "fut") v = "will " + vG;
  else if (tam === "ipfv") v = "keeps " + vG + "ing";
  else v = vG + "s";
  if (frame.s && frame.s.pron && ["1sg", "1pl", "1pi", "1pe", "2sg", "2pl", "3pl"].includes(frame.s.pron.k) && !frame.v.neg && !tam) v = vG;
  let out = [npEn(frame.s), v, npEn(frame.o)].filter(Boolean).join(" ");
  if (frame.loc) out += " " + frame.loc.adp + " the " + glossOf(frame.loc.n);
  if (frame.q || (frame.o && frame.o.wh)) out += "?";
  return out;
}

function interHTML(clause) {
  const l = active();
  return `<div class="inter">${clause.tokens.map(t => {
    const idx = t.f ? regPlan(phoneticPlan(l, t.f)) : -1;
    return `<span class="tok${t.f ? " spkt" : ""}"${t.f ? ` data-p="${idx}" title="click to hear"` : ""}><span class="w">${esc(t.w)}</span><span class="tg">${esc(t.g)}</span></span>`;
  }).join("")}</div>`;
}

function sentenceHTML(l) {
  const cl = closedOf(l);
  const shape = paradigmShape(l);
  const st = S.sent;
  const sOpts = [...cl.prons.map(p => [`p:${p.k}`, PRON_EN[p.k] || p.g]), ...SENT_NOUNS.map(c => [`n:${c}`, "the " + glossOf(c)])];
  const oOpts = [["none", "—"], ["wh", "what?"], ...SENT_OBJS.map(c => [`n:${c}`, "the " + glossOf(c)])];
  const tamOpts = [["none", "present"], ...shape.tam.filter(t => t.k).map(t => [t.k, { pst: "past", fut: "future", pfv: "perfective", ipfv: "imperfective" }[t.k] || t.k])];
  const locOpts = [["none", "—"], ["in", "in the town"], ["at", "at the town"], ["under", "under the town"]];
  const moodOpts = [["decl", "statement"], ["imp", "command (imperative)"]];
  const typeOpts = [["plain", "event (verb)"], ["cop", "description (X is Y)"], ["ex", "existential (there is X)"], ["poss", "possession (X has Y)"]];
  const predOpts = [["adj", "old"], ["nom", "a wolf"], ["loc", "in the town"]];
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, lab]) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(lab)}</option>`).join("")}</select>`;
  const frame = frameFromState(l);
  const clause = renderClause(l, frame);
  const imp = st.mood === "imp" && st.type === "plain";
  const ty = st.type;
  const canned = [
    { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } },
    { s: { pron: { k: "1sg", pers: 1, num: "sg" } }, v: { c: GO, tam: "pst", neg: true } },
    { s: { pron: { k: "2sg", pers: 2, num: "sg" } }, v: { c: TAKE, tam: "pst" }, o: { n: HORSE, def: true }, q: true },
    { s: { pron: { k: "3sgf", pers: 3, num: "sg" } }, v: { c: EAT, tam: "pst" }, o: { wh: true } },
    { s: { n: WOLF, def: true, adj: BLACK }, v: { c: SLEEP, tam: null }, loc: { adp: "in", n: TOWN, def: true } },
    { s: { n: MOTHER, def: true }, pred: { adj: OLD }, v: {} },
    { ex: { n: GRAIN }, loc: { adp: "in", n: TOWN, def: true }, v: {} },
    { poss: { possessor: { pron: { k: "1sg", pers: 1, num: "sg" } }, possessed: { n: HORSE } }, v: {} },
    { v: { c: GO, mood: "imp" } },
    { v: { c: TAKE, mood: "imp", neg: true }, o: { n: HORSE, def: true } },
  ];
  return `<section class="card"><h2>Sentences</h2>
    <p class="note">A semantic frame — who did what to whom, when — rendered through the language's own grammar: arguments take their cases, the verb agrees and carries tense, everything lands where the word-order dials put it, and the interlinear gloss beneath shows the machinery. This is the shape of a chronicle entry.</p>
    <div class="controls sent">
      <label>Type ${sel("sentTy", typeOpts, ty)}</label>
      <label${ty !== "plain" ? ' class="off"' : ""}>Mood ${sel("sentM", moodOpts, st.mood)}</label>
      <label${imp || ty === "ex" ? ' class="off"' : ""}>${ty === "poss" ? "Owner" : "Subject"} ${sel("sentS", sOpts, imp ? "p:2sg" : st.s)}</label>
      ${ty === "cop" ? `<label>Predicate ${sel("sentP", predOpts, st.pred)}</label>` : ty === "plain" ? `<label>Verb ${sel("sentV", VERBS.map(c => [c, glossOf(c)]), st.v)}</label>` : ""}
      <label${imp ? ' class="off"' : ""}>Tense ${sel("sentT", tamOpts, imp ? "none" : st.tam)}</label>
      <label${ty === "cop" ? ' class="off"' : ""}>${ty === "ex" ? "Thing" : ty === "poss" ? "Owned" : "Object"} ${sel("sentO", ty === "plain" ? oOpts : oOpts.filter(([v]) => String(v).startsWith("n:")), st.o)}</label>
      <label${imp || ty === "cop" || ty === "poss" ? ' class="off"' : ""}>Place ${sel("sentL", locOpts, imp ? "none" : st.loc)}</label>
      <label><input type="checkbox" id="sentNeg"${st.neg ? " checked" : ""}/> ${imp ? "prohibitive (don't!)" : "negated"}</label>
      <label${imp ? ' class="off"' : ""}><input type="checkbox" id="sentQ"${st.q && !imp ? " checked" : ""}/> question</label>
    </div>
    <p class="ensent">“${esc(englishOf(frame, l))}”${(() => {
      // the whole clause, spoken: one intonation phrase — statements and
      // commands FALL, questions RISE (the near-universal boundary tones)
      if (!clause.tokens.every(t => t.f)) return "";
      const contour = frame.q || (frame.o && frame.o.wh) ? "rise" : "fall";
      return ` <button class="spk play" data-cp="${regClause(planGroups(l, clause.tokens), contour)}" title="speak the sentence">▶</button>`;
    })()}</p>
    ${interHTML(clause)}
    ${(() => {
      // …and written, in the language's own script (its separation habit,
      // its direction) — STEMS keep their frozen spelling, inflection is
      // spelled by ear: the ⟨knight⟩+⟨-s⟩ economy of real traditions
      const sc = scriptOf(l);
      if (!sc || !clause.tokens.every(t => t.f)) return "";
      const words = clause.tokens.map(t => `<span class="glyphword${sc.dir === "rtl" ? " rtl" : sc.dir === "ttb" ? " ttb" : ""}${sc.headline || sc.join ? " tight" : ""}">${(writeForm(l, t.f, t.c ?? null) || []).map(g => glyphSVG(g, 20, { hand: sc.hand, headline: sc.headline, join: sc.join, dir: sc.dir })).join("")}</span>`);
      const sep = sc.sep === "space" ? `<span class="wsep"></span>` : sc.sep === "dot" ? `<span class="wsep dot">·</span>` : "";
      return `<p class="cells glyphline${sc.dir === "ttb" ? " ttb" : ""}">${words.join(sep)} <span class="gloss">— in its own hand${sc.sep === "continua" ? ", run together" : ""}</span></p>`;
    })()}
    <h3>More of the tongue</h3>
    ${canned.map(f => `<p class="ensent dim">“${esc(englishOf(f, l))}”</p>` + interHTML(renderClause(l, f))).join("")}
  </section>`;
}

const COGNATE_SET = (() => {
  const want = ["water", "river", "king", "stone", "mother", "god", "fire", "sun", "hand", "wolf"];
  return CONCEPTS.map((c, i) => ({ i, g: c.g })).filter(x => want.includes(x.g)).map(x => x.i);
})();

function cognatesHTML() {
  if (lineage.length < 2 && !donor) return "";
  const cols = [...lineage];
  // cognate cells are speakable — HEAR the regular correspondence, not just
  // read it (loans shadow the native form and stay silent)
  let rows = COGNATE_SET.map(cid =>
    `<tr><td class="lbl">${esc(glossOf(cid))}</td>${cols.map(l => {
      const lr = (l.loans || []).some(x => x.c === cid) ? loanOf(l, cid) : null;
      if (lr) return lr.f ? `<td class="w spkw" data-p="${regPlan(phoneticPlan(l, lr.f))}" title="click to hear (borrowed)">${esc(wordOf(l, cid))}</td>` : `<td class="w">${esc(wordOf(l, cid))}</td>`;
      return `<td class="w spkw" data-p="${regPlan(phoneticPlan(l, nativeStemOf(l, cid)))}" title="click to hear">${esc(wordOf(l, cid))}</td>`;
    }).join("")}</tr>`).join("");
  // M5: cognate CONJUGATIONS — the same paradigm cell down the family,
  // built from shared sources at shared birth points, diverged by sound law
  const cellTok = (x) => [...x.pre.map(t => t.w), x.text, ...x.post.map(t => t.w)].join(" ");
  const infRow = (label, cell) =>
    `<tr><td class="lbl">${esc(label)}</td>${cols.map(l => { const x = cell(l); return `<td class="w${x.irr ? " irr" : ""}" title="${esc(x.gloss)}">${esc(cellTok(x))}</td>`; }).join("")}</tr>`;
  rows += infRow("stones (PL)", (l) => inflectNoun(l, STONE, { num: "pl" }));
  rows += infRow("went (go+PST/PFV)", (l) => {
    const shape = paradigmShape(l);
    const marked = shape.tam.find(t => t.k === "pst") || shape.tam.find(t => t.k === "pfv") || shape.tam[0];
    return inflectVerb(l, VERBS[2], { tam: marked.k, pers: shape.pers.length ? "3" : null, num: "sg" });
  });
  const heads = cols.map((l, i) => `<th>${i === 0 ? "root" : "daughter " + i}<div class="sub">${esc(langWord(l, 0))} · ${l.rules.length} changes</div></th>`).join("");
  return `<section class="card"><h2>Cognates down the family</h2>
    <p class="note">One family root, replayed through each tongue's own chain of sound changes — the correspondences are regular, like real sister languages. The last two rows are inflected: cognate <em>conjugations</em>, because affix sources and birth points are family property too.</p>
    <div class="scroll"><table><thead><tr><th></th>${heads}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ── coined abstractions: the intentional-derivation showcase ─────────────
const ABSTRACT_SHOW = (() => {
  const want = ["king", "queen", "god", "spirit", "holy", "priest", "law", "oath",
    "throne", "crown", "tax", "council", "victory", "army", "guard", "noble"];
  return want.map(g => CONCEPTS.findIndex(c => c.g === g)).filter(i => i >= 0);
})();
function derivationsHTML(l) {
  const loanSet = new Set((l.loans || []).map(x => x.c));
  const items = ABSTRACT_SHOW.map(cid => {
    const ety = etymologyOf(l, cid);
    const w = wordOf(l, cid);
    // a loan shadows the native coinage (etymologyOf is null under a loan), so
    // the word is BORROWED, not an opaque native root — say so
    const tail = ety ? `<span class="gloss">‹ ‘${esc(ety.gloss)}’</span>`
      : loanSet.has(cid) ? `<span class="gloss lost">borrowed</span>`
        : `<span class="gloss lost">opaque root</span>`;
    return `<li><span class="lbl">${esc(glossOf(cid))}</span> <span class="w">${esc(w)}</span> ${tail}</li>`;
  }).join("");
  const nDerived = ABSTRACT_SHOW.filter(cid => etymologyOf(l, cid)).length;
  return `<section class="card"><h2>Coined abstractions <span class="count">(${nDerived}/${ABSTRACT_SHOW.length} derived on purpose)</span></h2>
    <p class="note">Abstract words needn't be opaque roots: most tongues <em>build</em> them out of concrete ones, along a curated table of plausible pathways rolled once per family — <span class="w">king</span> from “great man”, <span class="w">god</span> from “sky father”, <span class="w">law</span> from “old saying”, <span class="w">victory</span> from “war's end”. The etymology is recoverable and drifts with the rest of the language (branch a daughter and watch it shift); a different family coins the same idea from different parts, and some keep an opaque root. Same machine that gives ‘ford’ its ‘water’.</p>
    <ul class="cols">${items}</ul></section>`;
}

function loansHTML(l) {
  if (!l.loans.length) return "";
  const seen = new Set();
  const items = [];
  const sc = scriptOf(l);
  for (let i = l.loans.length - 1; i >= 0; i--) {
    const { c, w, f } = l.loans[i];
    if (seen.has(c)) continue;
    seen.add(c);
    // a loan speaks with the form it was borrowed with, and writes in the
    // borrower's own script (spelled as heard, foreign sounds adapted)
    const wCell = f ? `<span class="w spkw" data-p="${regPlan(phoneticPlan(l, f))}" title="click to hear">${esc(w)}</span>` : `<span class="w">${esc(w)}</span>`;
    const ww = sc ? writeWord(l, c) : null;
    const glyphs = ww && ww.glyphs ? ` <span class="glyphword${sc.dir === "rtl" ? " rtl" : sc.dir === "ttb" ? " ttb" : ""}">${ww.glyphs.map(g => glyphSVG(g, 16, { hand: sc.hand })).join("")}</span>` : "";
    items.push(`<li><span class="lbl">${esc(glossOf(c))}</span> ${wCell}${glyphs} <span class="gloss">borrowed</span> <span class="w dim">${esc(renderNative(l, c))}</span> <span class="gloss lost">native, displaced</span></li>`);
  }
  return `<h3>Loan stratum</h3><ul class="cols">${items.join("")}</ul>`;
}
// what the native word WOULD be (loans shadow it) — peek by cloning sans loans
function renderNative(l, cid) {
  const ghost = { ...l, loans: [], xph: l.xph || [] };
  return wordOf(ghost, cid);
}

function dictionaryHTML(l) {
  const byWord = new Map();
  // numeral concepts show their COUNTING form (base-5 'six' is 'five-one',
  // not a separate root) so the dictionary agrees with the Grammar card
  const rows = CONCEPTS.map((c, cid) => { const numW = numeralConceptWord(l, cid); return { cid, g: c.g, d: c.d, w: numW || wordOf(l, cid), num: !!numW }; });
  for (const r of rows) byWord.set(r.w, (byWord.get(r.w) || 0) + 1);
  const loanSet = new Set((l.loans || []).map(x => x.c));
  // words that two concepts share ON PURPOSE (colexification, tree=wood) vs by
  // accident (an unrepaired homophone) — label them differently
  const colexWords = new Set();
  CONCEPTS.forEach((c, cid) => { if (colexPartner(l, cid) >= 0) colexWords.add(wordOf(l, cid)); });
  const q = S.search.trim().toLowerCase();
  const body = rows
    .filter(r => !q || r.g.includes(q) || r.w.toLowerCase().includes(q))
    .map(r => {
      const notes = [];
      if (loanSet.has(r.cid)) notes.push("loan");
      if (byWord.get(r.w) > 1) notes.push(colexWords.has(r.w) ? "shared word" : "homophone");
      const ety = etymologyOf(l, r.cid);
      const from = ety ? `‹ ‘${esc(ety.gloss)}’` : "";
      // every entry speaks: natives from their stem, loans from the form
      // they were borrowed with (by ear — the record keeps what was heard);
      // only compound counting forms stay silent (no single internal form)
      const loanRec = loanSet.has(r.cid) ? loanOf(l, r.cid) : null;
      const form = r.num ? null : loanRec ? (loanRec.f || null) : nativeStemOf(l, r.cid);
      const wCell = form
        ? `<td class="w spkw" data-p="${regPlan(phoneticPlan(l, form))}" title="click to hear">${esc(r.w)}</td>`
        : `<td class="w">${esc(r.w)}</td>`;
      return `<tr><td>${esc(r.g)}</td>${wCell}<td class="gloss ipa">${form ? esc("[" + ipaOf(l, form) + "]") : ""}</td><td class="gloss">${from}</td><td class="lbl">${esc(r.d)}</td><td class="gloss">${notes.join(" · ")}</td></tr>`;
    }).join("");
  return `<section class="card"><h2>Dictionary <span class="count">(${rows.length} concepts, virtual)</span></h2>
    <p class="note">Every entry is computed on demand from the language's seed and history — nothing is stored. The <span class="gloss">‹ etymology</span> column shows words this family built from other concepts (ford ‹ ‘water river’, king ‹ ‘great man’). “Shared word” = two concepts this family colexifies on purpose (one word for tree&nbsp;and&nbsp;wood); “homophone” = an accidental sound-alike; “loan” = a word taken from a contact language, shadowing the native form. Click a word to hear it.</p>
    <input id="dictSearch" type="search" placeholder="Search meaning or word…" value="${esc(S.search)}" />
    <div class="scroll tall"><table><thead><tr><th>meaning</th><th>word</th><th>IPA</th><th>etymology</th><th>domain</th><th>notes</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

// ── the History card: an areal simulation over the same public APIs the
// world sim will drive — spawn a cast, watch it breed/evolve/spread/die ──
function historyHTML() {
  const h = S.hist;
  const controls = `<div class="controls sent">
      <label>Seed <input id="histSeed" type="number" value="${h.seed}" style="width:6.5rem"/></label>
      <label>Eras <input id="histEras" type="number" min="4" max="40" value="${h.eras}" style="width:4rem"/></label>
      <label><input type="checkbox" id="histEng"${h.english ? " checked" : ""}/> English-shaped</label>
      <label><input type="checkbox" id="histRus"${h.russian ? " checked" : ""}/> Russian-shaped</label>
      <label><input type="checkbox" id="histMan"${h.mandarin ? " checked" : ""}/> Mandarin-shaped</label>
      <label>Random roots <select id="histRand">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${h.random === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <button id="histRun">Run history</button>
      ${HIST ? `<button id="histStep">+1 era</button>` : ""}
    </div>`;
  if (!HIST) return `<section class="card"><h2>History <span class="count">— an areal simulation</span></h2>
    <p class="note">Spawn a cast of tongues — pinned reference shapes beside random typological rolls — and let the dynamics run: communities grow and split (<b>breed</b>), sound change accumulates (<b>evolve</b>), prestige pushes words and whole scripts downhill from bigger neighbours (<b>spread</b>), and a starved tongue dies into its neighbour. Every event fires from population state, never from the clock — the same four verbs the world sim will drive with its real cultures. Inspect any survivor below to open it in the Lab.</p>
    ${controls}</section>`;
  // lanes: depth-first from the roots so daughters sit beside their parents
  const kids = new Map();
  HIST.lineages.forEach(L => { if (L.parent !== null) { if (!kids.has(L.parent)) kids.set(L.parent, []); kids.get(L.parent).push(L); } });
  const order = [];
  const visit = (L) => { order.push(L); (kids.get(L.id) || []).forEach(visit); };
  HIST.lineages.filter(L => L.parent === null).forEach(visit);
  const lane = new Map(order.map((L, i) => [L.id, i]));
  const exW = 34, rowH = 26, padL = 10, padT = 14, labW = 130;
  const X = (era) => padL + era * exW;
  const Y = (id) => padT + lane.get(id) * rowH;
  const W = X(HIST.era) + labW, Hgt = padT + order.length * rowH + 22;
  const hue = (L) => `hsl(${L.lang.hue | 0} 55% 45%)`;
  let svg = "";
  for (const L of order) {
    const x0 = X(L.bornEra), x1 = X(L.deadEra ?? HIST.era), y = Y(L.id);
    if (L.parent !== null) svg += `<path d="M ${x0} ${Y(L.parent)} L ${x0} ${y}" stroke="${hue(L)}" stroke-width="1.6" fill="none" opacity="0.7"/>`;
    svg += `<path d="M ${x0} ${y} L ${x1} ${y}" stroke="${hue(L)}" stroke-width="${L.deadEra ? 2 : 3}" fill="none"${L.deadEra ? ` opacity="0.55"` : ""}/>`;
    svg += L.deadEra
      ? `<text x="${x1 + 3}" y="${y + 4}" font-size="11" fill="${hue(L)}" opacity="0.8">✕</text>`
      : `<text x="${x1 + 6}" y="${y + 4}" font-size="11" fill="${hue(L)}">${esc(langWord(L.lang, 0))}${L.parent === null && L.kind !== "random" ? " · " + esc(L.kind) : ""}</text>`;
  }
  const byId = new Map(HIST.lineages.map(L => [L.id, L]));
  for (const e of HIST.events) {
    if (e.type === "borrow") svg += `<circle cx="${X(e.era)}" cy="${Y(e.id)}" r="2.6" fill="${hue(byId.get(e.from))}" opacity="0.75"><title>borrows from ${esc(langWord(byId.get(e.from).lang, 0))}</title></circle>`;
    if (e.type === "adopt") svg += `<rect x="${X(e.era) - 3.5}" y="${Y(e.id) - 3.5}" width="7" height="7" fill="${hue(byId.get(e.from))}"><title>adopts the script of ${esc(langWord(byId.get(e.from).lang, 0))}</title></rect>`;
  }
  for (let er = 0; er <= HIST.era; er += 2) svg += `<text x="${X(er)}" y="${Hgt - 6}" font-size="9" fill="currentColor" opacity="0.45" text-anchor="middle">${er}</text>`;
  const nameOf = (id) => langWord(byId.get(id).lang, 0);
  const feed = HIST.events.filter(e => e.type !== "drift" && e.type !== "spawn").slice(-12).reverse().map(e =>
    `<li><span class="lbl">era ${e.era}</span> ${e.type === "branch" ? `<span class="w">${esc(nameOf(e.id))}</span> splits from <span class="w">${esc(nameOf(e.from))}</span>`
      : e.type === "borrow" ? `<span class="w">${esc(nameOf(e.id))}</span> borrows from <span class="w">${esc(nameOf(e.from))}</span> <span class="gloss">(prestige flows downhill)</span>`
      : e.type === "adopt" ? `<span class="w">${esc(nameOf(e.id))}</span> adopts the script of <span class="w">${esc(nameOf(e.from))}</span>`
      : `<span class="w">${esc(nameOf(e.id))}</span> dies, absorbed into <span class="w">${esc(nameOf(e.into))}</span>`}</li>`).join("");
  const liv = HIST.lineages.filter(L => L.deadEra === null).sort((a, b) => b.pop - a.pop);
  const totPop = liv.reduce((a, L) => a + L.pop, 0);
  const rows = liv.map(L => {
    const sc = scriptOf(L.lang);
    return `<tr><td class="w">${esc(langWord(L.lang, 0))}</td><td class="lbl">${esc(L.kind)}</td>
      <td>${esc(MORPH[L.lang.prof.morph])}</td>
      <td>${esc(SCRIPT_NAME[sc.type].split(" ")[0])}${sc.borrowed ? " (borrowed)" : sc.invented ? " (invented)" : ""}</td>
      <td>${Math.round(100 * L.pop / totPop)}%</td><td>${L.lang.rules.length}</td><td>${L.lang.loans.length}</td>
      <td><button class="spk" data-inspect="${L.id}">inspect</button></td></tr>`;
  }).join("");
  return `<section class="card"><h2>History <span class="count">— ${HIST.era} eras · ${HIST.lineages.length} tongues, ${liv.length} living</span></h2>
    <p class="note">Every event fires from population state, never the clock: a community past cohesion <b>splits</b>, prestige pushes words (•) and whole scripts (▪) downhill from bigger neighbours, a starved tongue <b>dies</b> (✕) into its neighbour — and every living tongue keeps drifting. The reference shapes hold their pinned costumes; everything else is free. <b>Inspect</b> a survivor to open it (and its ancestors) in the Lab below.</p>
    ${controls}
    <div class="scroll"><svg viewBox="0 0 ${W} ${Hgt}" width="${W}" height="${Hgt}" style="max-width:none">${svg}</svg></div>
    <h3>Chronicle</h3><ul class="cols">${feed}</ul>
    <h3>Living tongues</h3>
    <div class="scroll"><table><thead><tr><th>tongue</th><th>root</th><th>morphology</th><th>script</th><th>share</th><th>changes</th><th>loans</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function render() {
  const l = active();
  PLANS = []; CLAUSES = [];                          // registries are per-render; data-p/-cp indices point here
  document.getElementById("app").innerHTML = `
  <header>
    <h1>Simman <em>Language Lab</em></h1>
    <p class="tag">Roll a tongue, listen to it drift, branch its daughters, watch it borrow. Same engine the world sim names its history with.</p>
  </header>
  <section class="controls card">
    <label>Shape
      <select id="preset">
        <option value="random"${S.preset === "random" ? " selected" : ""}>Random (typological roll)</option>
        ${REF_KINDS.map(k => `<option value="${k}"${S.preset === k ? " selected" : ""}>${k[0].toUpperCase() + k.slice(1)}-shaped (pinned sounds)</option>`).join("")}
      </select>
    </label>
    <label>Seed <input id="seed" type="number" value="${S.seed}" /></label>
    <button id="reroll">New language</button>
    <span class="divider"></span>
    <button id="drift" title="Apply one sound change to every native word">Drift (sound change)</button>
    <label class="slider">Divergence <input id="div" type="range" min="0.2" max="1" step="0.1" value="${S.divergence}" /></label>
    <button id="branch" title="Found a daughter language, drifted by the divergence distance">Branch a daughter</button>
    <button id="borrow" title="Contact with a foreign tongue: borrow a sound and a prestige word">Borrow from a neighbour</button>
    <button id="adopt" title="A neighbour's script arrives: keep its letterforms whole, spell this tongue by ear — the way most scripts actually spread">Adopt a script</button>
  </section>
  ${historyHTML()}
  <section class="card">
    <h2>Specimen: <span class="w big">${esc(langWord(l, 0))}</span>${lineage.length > 1 ? `<span class="count"> — daughter ${lineage.length - 1} of the family</span>` : ""}</h2>
    <div class="chips">${chips(l)}</div>
    ${inventoryHTML(l)}
    ${namesHTML(l)}
    ${loansHTML(l)}
  </section>
  ${soundHTML(l)}
  ${writingHTML(l)}
  ${grammarHTML(l)}
  ${verbFrontierHTML(l)}
  ${nounFrontierHTML(l)}
  ${lexTypologyHTML(l)}
  ${registerDialectHTML(l)}
  ${sentenceHTML(l)}
  ${paradigmHTML(l)}
  ${cognatesHTML()}
  ${derivationsHTML(l)}
  ${dictionaryHTML(l)}
  <footer>Deterministic: the same seed and history always speak the same words. · <span class="gloss">glosses in ochre are meanings</span> · build ${typeof __BUILD__ !== "undefined" ? __BUILD__ : "dev"}</footer>`;

  document.getElementById("reroll").onclick = () => { S.seed = Number(document.getElementById("seed").value) || 1; S.preset = document.getElementById("preset").value; reset(); render(); };
  document.getElementById("paraNoun").onchange = (e) => { S.noun = Number(e.target.value); render(); };
  document.getElementById("paraVerb").onchange = (e) => { S.verb = Number(e.target.value); render(); };
  document.getElementById("sentTy").onchange = (e) => { S.sent.type = e.target.value; if (S.sent.type !== "plain" && !S.sent.o.startsWith("n:")) S.sent.o = "n:" + (S.sent.type === "ex" ? GRAIN : HORSE); render(); };
  document.getElementById("sentM").onchange = (e) => { S.sent.mood = e.target.value; render(); };
  document.getElementById("sentS").onchange = (e) => { S.sent.s = e.target.value; render(); };
  const sentV = document.getElementById("sentV");
  if (sentV) sentV.onchange = (e) => { S.sent.v = Number(e.target.value); render(); };
  const sentP = document.getElementById("sentP");
  if (sentP) sentP.onchange = (e) => { S.sent.pred = e.target.value; render(); };
  document.getElementById("sentT").onchange = (e) => { S.sent.tam = e.target.value; render(); };
  document.getElementById("sentO").onchange = (e) => { S.sent.o = e.target.value; render(); };
  document.getElementById("sentL").onchange = (e) => { S.sent.loc = e.target.value; render(); };
  document.getElementById("sentNeg").onchange = (e) => { S.sent.neg = e.target.checked; render(); };
  document.getElementById("sentQ").onchange = (e) => { S.sent.q = e.target.checked; render(); };
  document.getElementById("preset").onchange = (e) => { S.preset = e.target.value; reset(); render(); };
  document.getElementById("drift").onclick = () => { driftLanguage(world, active()); render(); };
  document.getElementById("div").oninput = (e) => { S.divergence = Number(e.target.value); };
  document.getElementById("branch").onclick = () => { world.step += 500; lineage.push(branchLanguage(world, active(), S.divergence)); render(); };
  document.getElementById("borrow").onclick = () => {
    if (!donor) donor = foundLanguage(world, { seed: (S.seed * 2654435761 + 7) >>> 0 });
    borrowFrom(world, active(), donor); render();
  };
  document.getElementById("adopt").onclick = () => {
    if (!donor) {
      donor = foundLanguage(world, { seed: (S.seed * 2654435761 + 7) >>> 0 });
      for (let i = 0; i < 6; i++) driftLanguage(world, donor);   // a mature neighbouring tradition
    }
    adoptScriptFrom(active(), donor); render();
  };
  // ── history controls ──
  const hv = (id) => document.getElementById(id);
  const readHist = () => {
    S.hist.seed = Number(hv("histSeed").value) >>> 0;
    S.hist.eras = Math.max(4, Math.min(40, Number(hv("histEras").value) || 14));
    S.hist.english = hv("histEng").checked; S.hist.russian = hv("histRus").checked; S.hist.mandarin = hv("histMan").checked;
    S.hist.random = Number(hv("histRand").value);
  };
  hv("histRun").onclick = () => {
    readHist();
    const roots = [];
    if (S.hist.english) roots.push("english");
    if (S.hist.russian) roots.push("russian");
    if (S.hist.mandarin) roots.push("mandarin");
    for (let i = 0; i < S.hist.random; i++) roots.push("random");
    if (!roots.length) roots.push("random");
    HIST = foundHistory(S.hist.seed, roots);
    for (let i = 0; i < S.hist.eras; i++) stepHistory(HIST);
    render();
  };
  if (hv("histStep")) hv("histStep").onclick = () => { readHist(); stepHistory(HIST); render(); };
  // voice engine toggle: read at play time, so no re-render needed
  document.querySelectorAll('input[name="voiceEngine"]').forEach(r => { r.onchange = (e) => { S.voice = e.target.value; }; });
  const ds = document.getElementById("dictSearch");
  ds.oninput = (e) => {
    S.search = e.target.value;
    const scrollTop = ds.closest("section").querySelector(".scroll").scrollTop;
    const focused = document.activeElement === ds;
    render();
    if (focused) { const el = document.getElementById("dictSearch"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    document.querySelectorAll(".scroll.tall").forEach(x => x.scrollTop = scrollTop);
  };
}

const CSS = `
:root{
  --paper:#f6f5f1; --ink:#20241f; --muted:#6d7268; --line:#d9d7cf;
  --card:#fdfcf9; --accent:#2e6e5e; --accent-ink:#fff; --gloss:#9a6b1f; --chipbg:#ecefe9;
}
@media (prefers-color-scheme: dark){:root{
  --paper:#161915; --ink:#e7e5dc; --muted:#9aa094; --line:#33382f;
  --card:#1d211c; --accent:#66b398; --accent-ink:#10241c; --gloss:#d4a24a; --chipbg:#242a23;
}}
:root[data-theme="dark"]{
  --paper:#161915; --ink:#e7e5dc; --muted:#9aa094; --line:#33382f;
  --card:#1d211c; --accent:#66b398; --accent-ink:#10241c; --gloss:#d4a24a; --chipbg:#242a23;
}
:root[data-theme="light"]{
  --paper:#f6f5f1; --ink:#20241f; --muted:#6d7268; --line:#d9d7cf;
  --card:#fdfcf9; --accent:#2e6e5e; --accent-ink:#fff; --gloss:#9a6b1f; --chipbg:#ecefe9;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:16px/1.55 "Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif;}
#app{max-width:60rem;margin:0 auto;padding:1.5rem 1.25rem 4rem;display:flex;flex-direction:column;gap:1.1rem}
header h1{font-size:1.9rem;margin:0;letter-spacing:.01em;text-wrap:balance}
header h1 em{color:var(--accent);font-style:italic}
.tag{color:var(--muted);margin:.3rem 0 0;max-width:46rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1rem 1.2rem}
h2{font-size:1.15rem;margin:.1rem 0 .6rem}
h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:1rem 0 .3rem}
.count{font-size:.85rem;color:var(--muted);font-weight:normal}
.w{font-family:ui-monospace,"SF Mono","Cascadia Code",Consolas,Menlo,monospace;font-size:.92em}
.w.big{font-size:1.05em;color:var(--accent)}
.w.dim{opacity:.55}
.gloss{color:var(--gloss);font-style:italic}
.gloss.lost{opacity:.6}
.lbl{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.lbl.ind{margin-left:1rem}
.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.7rem}
.chip{background:var(--chipbg);border-radius:999px;padding:.12rem .6rem;font-size:.78rem;color:var(--ink)}
.inv{margin:.15rem 0}
.inv .w{margin-left:.4rem}
ul.cols{columns:2;gap:2rem;margin:.2rem 0;padding-left:1.1rem}
ul.cols li{margin:.12rem 0;break-inside:avoid}
.cells{margin:.2rem 0;line-height:2}
.cell{white-space:nowrap;background:var(--chipbg);border-radius:4px;padding:.1rem .45rem;margin-right:.2rem}
.paragrid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
@media (max-width:720px){.paragrid{grid-template-columns:1fr}}
td.irr{color:var(--gloss)}
.irr.sw{display:inline-block;width:.7em;height:.7em;background:var(--gloss);border-radius:2px;vertical-align:baseline}
.paragrid h3 select{font-size:.95rem;text-transform:none;letter-spacing:0}
.controls.sent{margin:.4rem 0 .8rem}
.controls.sent label{gap:.3rem}
.controls.sent label.off{opacity:.4}
.ensent{color:var(--muted);font-style:italic;margin:.6rem 0 .15rem}
.ensent.dim{margin-top:1rem}
.inter{display:flex;flex-wrap:wrap;gap:.15rem .9rem;align-items:flex-start;margin:.15rem 0 .4rem}
.tok{display:inline-flex;flex-direction:column;align-items:flex-start}
.tok .w{font-size:1.02em}
.tok .tg{font-size:.68rem;color:var(--gloss);letter-spacing:.02em;margin-top:.05rem}
.tok.spkt{cursor:pointer}
.tok.spkt:hover .w{color:var(--accent)}
.controls{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:center}
.controls label{display:flex;align-items:center;gap:.4rem;font-size:.85rem;color:var(--muted)}
.controls .divider{flex-basis:100%;height:0}
select,input[type=number],input[type=search]{font:inherit;color:var(--ink);background:var(--paper);
  border:1px solid var(--line);border-radius:4px;padding:.3rem .5rem}
input[type=number]{width:7.5rem}
input[type=search]{width:100%;max-width:22rem;margin:.2rem 0 .6rem}
button{font:inherit;font-size:.9rem;background:var(--accent);color:var(--accent-ink);
  border:none;border-radius:4px;padding:.42rem .9rem;cursor:pointer}
button:hover{filter:brightness(1.08)}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.spk{background:var(--chipbg);color:var(--ink);border:1px solid var(--line);padding:.08rem .45rem;font-size:.85rem;cursor:pointer}
button.spk:hover{filter:none;border-color:var(--accent);color:var(--accent)}
button.spk.play{border-radius:999px;line-height:1.2;font-size:.72rem;color:var(--accent)}
td.spkw{cursor:pointer}
td.spkw:hover{color:var(--accent)}
label.vopt{display:inline-flex;align-items:center;gap:.3rem;background:var(--chipbg);border-radius:999px;padding:.1rem .6rem;margin-right:.3rem;font-size:.82rem;cursor:pointer}
label.vopt input{accent-color:var(--accent);cursor:pointer}
.ipa{font-size:.78rem;white-space:nowrap;font-style:normal}
.glyph{color:var(--ink);display:block}
.glyphcell{display:inline-flex;flex-direction:column;align-items:center;gap:.05rem;background:var(--chipbg);border-radius:4px;padding:.3rem .45rem .15rem;margin:0 .2rem .25rem 0}
.glyphrow{line-height:1}
.glyphword{display:inline-flex;gap:3px;align-items:flex-start}
.glyphword.rtl{flex-direction:row-reverse}
.glyphword.ttb{flex-direction:column}
.glyphword.tight{gap:0}
.glyphline{display:flex;flex-wrap:wrap;align-items:center;gap:.15rem}
.boustroline .glyphword svg{transform:scaleX(-1)}
.glyphline.ttb{flex-direction:column;align-items:flex-start}
.wsep{display:inline-block;width:.7rem}
.wsep.dot{width:auto;padding:0 .25rem;color:var(--muted)}
.slider input{accent-color:var(--accent)}
.note{color:var(--muted);font-size:.85rem;margin:.1rem 0 .6rem;max-width:46rem}
.scroll{overflow-x:auto}
.scroll.tall{max-height:24rem;overflow-y:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:.3rem .7rem .3rem 0;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
th .sub{font-family:ui-monospace,Consolas,monospace;text-transform:none;letter-spacing:0;font-weight:normal;margin-top:.15rem}
footer{color:var(--muted);font-size:.8rem;border-top:1px solid var(--line);padding-top:.8rem}
@media (max-width:640px){ul.cols{columns:1}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

export function mount() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  if (!document.getElementById("app")) {
    const div = document.createElement("div");
    div.id = "app";
    document.body.appendChild(div);
  }
  // one delegated listener survives every re-render: anything carrying a
  // data-p index speaks its registered phonetic plan (a click is the user
  // gesture the AudioContext needs)
  document.getElementById("app").addEventListener("click", (e) => {
    const cp = e.target.closest("[data-cp]");
    if (cp) { const c = CLAUSES[+cp.dataset.cp]; if (c) speakClause(c.groups, c.contour); return; }
    const el = e.target.closest("[data-p]");
    if (el) {
      const p = PLANS[+el.dataset.p];
      if (!p) return;
      // recorded-phones voice: phoneme chips (they carry their IPA) play the
      // human clip, with the chip's own CV plan as the synth fallback; words
      // have no recording to play and stay with the tract
      if (S.voice === "human" && el.dataset.ipa) playClipOr(el.dataset.ipa, p);
      else speakPlan(p);
      return;
    }
    // inspect a tongue from the History card: it becomes the Lab's
    // specimen, with its ancestor chain as the family (cognates light up)
    const ins = e.target.closest("[data-inspect]");
    if (ins && HIST) {
      const chain = ancestryOf(HIST, Number(ins.dataset.inspect));
      if (chain.length) {
        world = HIST.world;
        lineage = chain.map(x => x.lang);
        donor = null;
        render();
        const spec = [...document.querySelectorAll("section.card h2")].find(h => h.textContent.startsWith("Specimen"));
        if (spec) spec.scrollIntoView({ behavior: "smooth" });
      }
    }
  });
  reset();
  render();
}

if (typeof document !== "undefined") mount();
