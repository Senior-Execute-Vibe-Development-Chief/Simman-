// ═══════════════════════════════════════════════════════════════════════════════
// SYNTHESIS — Formant-based speech synthesis with LF glottal model
// ═══════════════════════════════════════════════════════════════════════════════

import { SG } from "./phonology.js";

// Vowel formant targets [F1, F2, F3] from features — based on Peterson & Barney data
function vFmt(seg) {
  const h = seg.binary.high, l = seg.binary.low, b = seg.binary.back, r = seg.binary.round;
  if (h && !b) return [270, 2300, 3000];
  if (h && !b && !r) return [270, 2300, 3000];
  if (h && b && r) return [300, 750, 2200];
  if (l && !b) return [660, 1700, 2400];
  if (l && b) return [730, 1100, 2450];
  if (!h && !l && !b && !r) return [530, 1850, 2500];
  if (!h && !l && b && r) return [570, 850, 2350];
  if (!h && !l && !b) return [490, 1700, 2500];
  if (!h && !l && b) return [500, 1000, 2300];
  return [500, 1500, 2500];
}

function nFmt(place) {
  const f2 = { 0: 1000, 3: 1500, 6: 1900, 7: 1100 };
  return [250, f2[place] || 1300, 2700];
}

function lFmt(seg) {
  if (seg.binary.lateral) return [350, 1200, 2600];
  if (seg.binary.high && !seg.binary.back) return [280, 2100, 2900];
  if (seg.binary.high && seg.binary.back) return [310, 750, 2500];
  return [330, 1300, 1600];
}

function fricF(place) { return [800, 1100, 5500, 5800, 3800, 3200, 2800, 1400, 800, 500, 400][place] || 2000; }
function burstF(place) { return [600, 900, 3200, 3800, 4000, 3500, 3000, 1200, 700, 500, 350][place] || 1500; }

// Improved 2nd-order resonator with state carry for smooth transitions
function resonatorSample(x, fc, bw, sr, state) {
  const r = Math.exp(-Math.PI * bw / sr);
  const theta = 2 * Math.PI * fc / sr;
  const a1 = -2 * r * Math.cos(theta);
  const a2 = r * r;
  const g = (1 - r) * 0.5;
  const y = g * x - a1 * state.y1 - a2 * state.y2;
  state.y2 = state.y1;
  state.y1 = y;
  return y;
}

// LF model glottal pulse — more natural than Rosenberg
function lfPulse(phase, Rd) {
  const tp = 0.4;
  const te = 0.58 + Rd * 0.06;
  if (phase < tp) {
    const t = phase / tp;
    return 0.5 * (1 - Math.cos(Math.PI * t));
  } else if (phase < te) {
    const t = (phase - tp) / (te - tp);
    return Math.cos(Math.PI * 0.5 * t);
  } else {
    const t = (phase - te) / (1 - te);
    return -0.3 * Math.exp(-5 * t);
  }
}

let audioCtx = null;

export async function speakIPA(ipaStr, rate = 1, vp = null) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const sr = audioCtx.sampleRate;

  const basePitch = vp?.pitch || (105 + Math.random() * 55);
  const Rd = vp?.Rd || (1.5 + Math.random() * 0.8);
  const rhythm = vp?.rhythm || "mixed";
  const tempo = (vp?.tempo || 1.0) * rate;
  const pitchRange = vp?.pitchRange || 0.15;
  const doReduction = vp?.reduction || false;

  // Parse segments
  const parsed = [];
  let idx = 0;
  while (idx < ipaStr.length) {
    const ch = ipaStr[idx];
    if (ch === " ") { parsed.push({ type: "pause" }); idx++; continue; }
    if (ch === ".") { parsed.push({ type: "sylbreak" }); idx++; continue; }
    if (idx + 1 < ipaStr.length) {
      const di = ipaStr.slice(idx, idx + 2);
      if (SG[di]) { parsed.push({ type: "seg", data: SG[di] }); idx += 2; continue; }
    }
    if (SG[ch]) parsed.push({ type: "seg", data: SG[ch] });
    idx++;
  }

  // Assign durations with rhythm class and natural timing
  const segInfo = [];
  let sylIdx = 0;
  for (const p of parsed) {
    if (p.type === "pause") { segInfo.push({ ...p, dur: 0.13 / tempo }); continue; }
    if (p.type === "sylbreak") { segInfo.push({ ...p, dur: 0.015 / tempo }); sylIdx++; continue; }
    const s = p.data;
    const stressed = sylIdx === 0;
    let stressMul;
    if (rhythm === "syllable" || rhythm === "mora") {
      stressMul = stressed ? 1.05 : 1.0;
    } else {
      stressMul = stressed ? 1.35 : 0.8;
    }
    let dur;
    if (s.binary.syllabic) dur = 0.095 * stressMul / tempo;
    else if (s.binary.nasal) dur = 0.06 * stressMul / tempo;
    else if (!s.binary.continuant && s.binary.consonantal && !s.binary.sonorant) dur = 0.065 / tempo;
    else if (s.binary.continuant && s.binary.consonantal) dur = 0.06 / tempo;
    else dur = 0.05 * stressMul / tempo;
    if (rhythm === "mora" && s.binary.syllabic) dur *= 1.1;
    segInfo.push({ ...p, dur, stressed, sylIdx, reduce: doReduction && !stressed && s.binary.syllabic });
    if (s.binary.syllabic) sylIdx++;
  }

  const totalDur = segInfo.reduce((a, b) => a + b.dur, 0) + 0.15;
  const totalSamples = Math.ceil(totalDur * sr);
  const output = new Float32Array(totalSamples);

  const totalSegs = segInfo.filter(s => s.type === "seg").length;

  function getF0(segIndex, totalCount) {
    const pos = segIndex / Math.max(totalCount, 1);
    let f0 = basePitch * (1 + pitchRange * 0.3 - pitchRange * pos);
    const info = segInfo[segIndex];
    if (info && info.stressed) f0 *= (1 + pitchRange * 0.5);
    if (pos > 0.85) f0 *= (1 - (pos - 0.85) * pitchRange * 8);
    return Math.max(60, f0);
  }

  const fStates = [{ y1: 0, y2: 0 }, { y1: 0, y2: 0 }, { y1: 0, y2: 0 }];
  const nState = { y1: 0, y2: 0 };

  let t = 0.03;
  let segCount = 0;
  let glottalPhase = 0;
  let prevFormants = [500, 1500, 2500];

  for (let si = 0; si < segInfo.length; si++) {
    const info = segInfo[si];
    const dur = info.dur;
    const startSample = Math.floor(t * sr);
    const numSamples = Math.ceil(dur * sr);
    if (numSamples <= 0 || startSample + numSamples > totalSamples) { t += dur; continue; }
    if (info.type === "pause" || info.type === "sylbreak") {
      if (info.type === "pause") {
        fStates.forEach(st => { st.y1 *= 0.1; st.y2 *= 0.1; });
        glottalPhase = 0;
      }
      t += dur;
      continue;
    }

    const s = info.data;
    const isVow = !!s.binary.syllabic;
    const isNas = !!s.binary.nasal;
    const isVoiced = !!s.binary.voice || isVow || isNas;
    const isFric = !!s.binary.continuant && !!s.binary.consonantal;
    const isStop = !!s.binary.consonantal && !s.binary.continuant && !s.binary.sonorant;
    const isLiqGli = (!!s.binary.sonorant && !s.binary.syllabic && !s.binary.nasal) ||
                     (!!s.binary.sonorant && !s.binary.consonantal && !s.binary.syllabic);

    let targetF;
    if (isVow) {
      targetF = vFmt(s);
      if (info.reduce) {
        const schwaF = [500, 1500, 2500];
        targetF = targetF.map((f, i) => f + (schwaF[i] - f) * 0.5);
      }
    }
    else if (isNas) targetF = nFmt(s.place);
    else if (isLiqGli) targetF = lFmt(s);
    else targetF = prevFormants;

    let nextF = targetF;
    for (let ni = si + 1; ni < segInfo.length; ni++) {
      if (segInfo[ni].type === "seg") {
        const ns = segInfo[ni].data;
        if (ns.binary.syllabic) nextF = vFmt(ns);
        else if (ns.binary.nasal) nextF = nFmt(ns.place);
        else if (ns.binary.sonorant) nextF = lFmt(ns);
        break;
      }
    }

    const f0 = getF0(si, segInfo.length);

    if (isVow || isNas || isLiqGli) {
      const vol = isVow ? 0.35 : isNas ? 0.22 : 0.2;
      const bws = isNas ? [70, 90, 140] : [90, 110, 150];

      for (let i = 0; i < numSamples; i++) {
        const pos = i / numSamples;
        const sampleIdx = startSample + i;
        if (sampleIdx >= totalSamples) break;

        const easeIn = Math.min(1, pos * 4);
        const easeOut = Math.min(1, (1 - pos) * 4);
        const curF = [0, 1, 2].map(fi =>
          prevFormants[fi] + (targetF[fi] - prevFormants[fi]) * easeIn * 0.7 +
          (nextF[fi] - targetF[fi]) * (1 - easeOut) * 0.3
        );

        const jitter = 1 + (Math.random() - 0.5) * 0.015;
        const period = sr / (f0 * (1 - pos * 0.04) * jitter);
        glottalPhase += 1;
        const ph = (glottalPhase % period) / period;
        let source = lfPulse(ph, Rd) * 0.5;
        source *= 1 + (Math.random() - 0.5) * 0.06;
        const aspiration = (Math.random() * 2 - 1) * 0.015;
        source += aspiration;

        let sample = 0;
        const gains = isNas ? [0.6, 0.3, 0.1] : [1.0, 0.6, 0.2];
        for (let fi = 0; fi < 3; fi++) {
          sample += resonatorSample(source, curF[fi], bws[fi], sr, fStates[fi]) * gains[fi];
        }

        if (isNas) {
          sample += resonatorSample(source, 250, 50, sr, nState) * 0.5;
          sample *= 0.7;
        }

        let env = 1;
        const attackS = 0.012 * sr, releaseS = 0.015 * sr;
        if (i < attackS) env = i / attackS;
        if (i > numSamples - releaseS) env = (numSamples - i) / releaseS;

        output[sampleIdx] += sample * vol * env;
      }

      prevFormants = targetF;

    } else if (isStop) {
      const closureN = Math.floor(numSamples * 0.4);
      const burstN = Math.floor(numSamples * 0.25);
      const aspN = numSamples - closureN - burstN;

      if (isVoiced) {
        for (let i = 0; i < closureN; i++) {
          const sampleIdx = startSample + i;
          if (sampleIdx >= totalSamples) break;
          glottalPhase += 1;
          const period = sr / (f0 * 0.92);
          const ph = (glottalPhase % period) / period;
          let src = lfPulse(ph, Rd + 0.5) * 0.15;
          const filtered = resonatorSample(src, 150, 50, sr, fStates[0]) * 0.3;
          const env = Math.min(i / (0.005 * sr), 1) * Math.min((closureN - i) / (0.005 * sr), 1);
          output[sampleIdx] += filtered * env;
        }
      }

      for (let i = 0; i < burstN; i++) {
        const sampleIdx = startSample + closureN + i;
        if (sampleIdx >= totalSamples) break;
        const noise = (Math.random() * 2 - 1);
        const bf = burstF(s.place);
        const env = Math.exp(-i / (burstN * 0.3));
        const filtered = resonatorSample(noise, bf, 500, sr, nState);
        output[sampleIdx] += filtered * 0.2 * env;
      }

      if (!isVoiced && aspN > 0) {
        for (let i = 0; i < aspN; i++) {
          const sampleIdx = startSample + closureN + burstN + i;
          if (sampleIdx >= totalSamples) break;
          const noise = (Math.random() * 2 - 1);
          const env = Math.exp(-i / (aspN * 0.5));
          output[sampleIdx] += noise * 0.035 * env;
        }
      }

    } else if (isFric) {
      const fc = fricF(s.place);
      const fricState = { y1: 0, y2: 0 };
      const voiceState = { y1: 0, y2: 0 };

      for (let i = 0; i < numSamples; i++) {
        const sampleIdx = startSample + i;
        if (sampleIdx >= totalSamples) break;
        const noise = (Math.random() * 2 - 1);
        const bw = s.binary.strident ? 500 : 1200;
        const filtered = resonatorSample(noise, fc, bw, sr, fricState);
        const vol = s.binary.strident ? 0.14 : 0.07;

        let env = 1;
        const att = 0.01 * sr, rel = 0.012 * sr;
        if (i < att) env = i / att;
        if (i > numSamples - rel) env = (numSamples - i) / rel;

        let sample = filtered * vol * env;

        if (isVoiced) {
          glottalPhase += 1;
          const period = sr / f0;
          const ph = (glottalPhase % period) / period;
          const vsrc = lfPulse(ph, Rd) * 0.12;
          sample += resonatorSample(vsrc, 250, 70, sr, voiceState) * env;
        }

        output[sampleIdx] += sample;
      }

    } else {
      for (let i = 0; i < numSamples; i++) {
        const sampleIdx = startSample + i;
        if (sampleIdx >= totalSamples) break;
        const env = Math.min(i / (0.008 * sr), 1) * Math.min((numSamples - i) / (0.01 * sr), 1);
        output[sampleIdx] += (Math.random() * 2 - 1) * 0.025 * env;
      }
    }

    segCount++;
    t += dur;
  }

  // Gentle low-pass
  let lpState = 0;
  const lpAlpha = 0.85;
  for (let i = 0; i < totalSamples; i++) {
    lpState = lpAlpha * lpState + (1 - lpAlpha) * output[i];
    output[i] = lpState;
  }

  // Normalize
  let peak = 0;
  for (let i = 0; i < totalSamples; i++) peak = Math.max(peak, Math.abs(output[i]));
  if (peak > 0.001) { const g = 0.75 / peak; for (let i = 0; i < totalSamples; i++) output[i] *= g; }

  // Play
  const buf = audioCtx.createBuffer(1, totalSamples, sr);
  buf.getChannelData(0).set(output);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start();

  return totalDur;
}
