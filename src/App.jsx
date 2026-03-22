import { useState, useMemo, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// IMPROVED FORMANT SPEECH SYNTHESIZER
// ═══════════════════════════════════════════════════════════════════════════════

// Vowel formant targets [F1, F2, F3] from features — based on Peterson & Barney data
function vFmt(seg) {
const h=seg.binary.high, l=seg.binary.low, b=seg.binary.back, r=seg.binary.round;
if(h&&!b) return [270,2300,3000]; // i
if(h&&!b&&!r) return [270,2300,3000]; // i
if(h&&b&&r) return [300,750,2200]; // u
if(l&&!b) return [660,1700,2400]; // a
if(l&&b) return [730,1100,2450]; // ɑ
if(!h&&!l&&!b&&!r) return [530,1850,2500]; // ɛ/e
if(!h&&!l&&b&&r) return [570,850,2350]; // ɔ/o
if(!h&&!l&&!b) return [490,1700,2500]; // mid front
if(!h&&!l&&b) return [500,1000,2300]; // mid back
return [500,1500,2500]; // schwa
}

function nFmt(place) {
const f2={0:1000,3:1500,6:1900,7:1100};
return [250, f2[place]||1300, 2700];
}

function lFmt(seg) {
if(seg.binary.lateral) return [350,1200,2600]; // l
if(seg.binary.high&&!seg.binary.back) return [280,2100,2900]; // j
if(seg.binary.high&&seg.binary.back) return [310,750,2500]; // w
return [330,1300,1600]; // r (retroflex-ish F3 drop)
}

function fricF(place) { return [800,1100,5500,5800,3800,3200,2800,1400,800,500,400][place]||2000; }
function burstF(place) { return [600,900,3200,3800,4000,3500,3000,1200,700,500,350][place]||1500; }

// Improved 2nd-order resonator with state carry for smooth transitions
function resonatorSample(x, fc, bw, sr, state) {
const r = Math.exp(-Math.PI * bw / sr);
const theta = 2 * Math.PI * fc / sr;
const a1 = -2 * r * Math.cos(theta);
const a2 = r * r;
const g = (1 - r) * 0.5; // rough gain normalization
const y = g * x - a1 * state.y1 - a2 * state.y2;
state.y2 = state.y1;
state.y1 = y;
return y;
}

// LF model glottal pulse — more natural than Rosenberg
function lfPulse(phase, Rd) {
// Simplified LF: Rd controls voice quality (1=pressed, 2.7=breathy)
const tp = 0.4; // peak time
const te = 0.58 + Rd * 0.06; // closure time
if (phase < tp) {
const t = phase / tp;
return 0.5 * (1 - Math.cos(Math.PI * t));
} else if (phase < te) {
const t = (phase - tp) / (te - tp);
return Math.cos(Math.PI * 0.5 * t);
} else {
const t = (phase - te) / (1 - te);
return -0.3 * Math.exp(-5 * t); // return phase
}
}

let audioCtx = null;

async function speakIPA(ipaStr, rate = 1, vp = null) {
if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
if (audioCtx.state === "suspended") await audioCtx.resume();
const sr = audioCtx.sampleRate;

// Voice parameters with defaults
const basePitch = vp?.pitch || (105 + Math.random() * 55);
const Rd = vp?.Rd || (1.5 + Math.random() * 0.8);
const rhythm = vp?.rhythm || "mixed"; // "stress" | "syllable" | "mora" | "mixed"
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
const stressed = sylIdx === 0; // first syllable stressed
let stressMul;
if (rhythm === "syllable" || rhythm === "mora") {
// Syllable-timed: equal syllable durations
stressMul = stressed ? 1.05 : 1.0;
} else {
// Stress-timed: big contrast between stressed and unstressed
stressMul = stressed ? 1.35 : 0.8;
}
let dur;
if (s.binary.syllabic) dur = 0.095 * stressMul / tempo;
else if (s.binary.nasal) dur = 0.06 * stressMul / tempo;
else if (!s.binary.continuant && s.binary.consonantal && !s.binary.sonorant) dur = 0.065 / tempo;
else if (s.binary.continuant && s.binary.consonantal) dur = 0.06 / tempo;
else dur = 0.05 * stressMul / tempo;
// Mora-timed: codas add a mora of duration
if (rhythm === "mora" && s.binary.syllabic) dur *= 1.1;
segInfo.push({ ...p, dur, stressed, sylIdx, reduce: doReduction && !stressed && s.binary.syllabic });
if (s.binary.syllabic) sylIdx++;
}

const totalDur = segInfo.reduce((a, b) => a + b.dur, 0) + 0.15;
const totalSamples = Math.ceil(totalDur * sr);
const output = new Float32Array(totalSamples);

// Sentence-level intonation
const totalSegs = segInfo.filter(s => s.type === "seg").length;

function getF0(segIndex, totalCount) {
const pos = segIndex / Math.max(totalCount, 1);
// Declination scaled by language's pitch range
let f0 = basePitch * (1 + pitchRange * 0.3 - pitchRange * pos);
// Stressed syllables get a rise proportional to pitch range
const info = segInfo[segIndex];
if (info && info.stressed) f0 *= (1 + pitchRange * 0.5);
// Final drop
if (pos > 0.85) f0 *= (1 - (pos - 0.85) * pitchRange * 8);
return Math.max(60, f0);
}

// Formant state for continuity between segments
const fStates = [{y1:0,y2:0},{y1:0,y2:0},{y1:0,y2:0}];
const nState = {y1:0,y2:0}; // for anti-formant

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
// Reset formant states gently on word boundaries
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

// Get target formants for this segment
let targetF;
if (isVow) {
  targetF = vFmt(s);
  // Vowel reduction: unstressed vowels centralize toward schwa in stress-timed languages
  if (info.reduce) {
    const schwaF = [500, 1500, 2500];
    targetF = targetF.map((f, i) => f + (schwaF[i] - f) * 0.5);
  }
}
else if (isNas) targetF = nFmt(s.place);
else if (isLiqGli) targetF = lFmt(s);
else targetF = prevFormants; // consonants inherit neighboring formants

// Get next segment's formants for coarticulation
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
  // Voiced sounds: glottal source through interpolating formants
  const vol = isVow ? 0.35 : isNas ? 0.22 : 0.2;
  const bws = isNas ? [70, 90, 140] : [90, 110, 150];

  for (let i = 0; i < numSamples; i++) {
    const pos = i / numSamples;
    const sampleIdx = startSample + i;
    if (sampleIdx >= totalSamples) break;

    // Interpolate formants: ease in from previous, ease out toward next
    const easeIn = Math.min(1, pos * 4); // first 25%
    const easeOut = Math.min(1, (1 - pos) * 4); // last 25%
    const blend = easeIn * easeOut; // in the middle = 1
    const curF = [0, 1, 2].map(fi =>
      prevFormants[fi] + (targetF[fi] - prevFormants[fi]) * easeIn * 0.7 +
      (nextF[fi] - targetF[fi]) * (1 - easeOut) * 0.3
    );

    // Glottal pulse with jitter
    const jitter = 1 + (Math.random() - 0.5) * 0.015;
    const period = sr / (f0 * (1 - pos * 0.04) * jitter); // slight f0 decline within segment
    glottalPhase += 1;
    const ph = (glottalPhase % period) / period;
    let source = lfPulse(ph, Rd) * 0.5;

    // Add shimmer (amplitude variation)
    source *= 1 + (Math.random() - 0.5) * 0.06;

    // Aspiration noise mixed in
    const aspiration = (Math.random() * 2 - 1) * 0.015;
    source += aspiration;

    // Apply formants
    let sample = 0;
    const gains = isNas ? [0.6, 0.3, 0.1] : [1.0, 0.6, 0.2];
    for (let fi = 0; fi < 3; fi++) {
      sample += resonatorSample(source, curF[fi], bws[fi], sr, fStates[fi]) * gains[fi];
    }

    // Nasal: add low-frequency nasal resonance and anti-formant dip
    if (isNas) {
      sample += resonatorSample(source, 250, 50, sr, nState) * 0.5;
      // Simulated anti-formant by subtracting energy around nasal zero
      sample *= 0.7;
    }

    // Envelope
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

  // Voiced closure: low buzz
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

  // Burst: filtered noise at place frequency
  for (let i = 0; i < burstN; i++) {
    const sampleIdx = startSample + closureN + i;
    if (sampleIdx >= totalSamples) break;
    const noise = (Math.random() * 2 - 1);
    const bf = burstF(s.place);
    // Use a simple one-pole for burst shape
    const env = Math.exp(-i / (burstN * 0.3));
    const filtered = resonatorSample(noise, bf, 500, sr, nState);
    output[sampleIdx] += filtered * 0.2 * env;
  }

  // Aspiration tail (voiceless only)
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
  const fricState = {y1:0,y2:0};
  const voiceState = {y1:0,y2:0};

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
  // h / unknown: gentle breathy noise
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

// Gentle low-pass to remove harshness (simple 1-pole)
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
const BF=["syllabic","consonantal","sonorant","voice","spreadGlottis","constrictedGlottis","nasal","lateral","continuant","strident","delayedRelease","high","low","back","round","atr"];
function fb(b,p){const m={};BF.forEach((f,i)=>{m[f]=b[i]||0;});return{binary:m,place:p};}
const SG={
"p":fb([0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0],0),"b":fb([0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0],0),
"t":fb([0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0],3),"d":fb([0,1,0,1,0,0,0,0,0,0,0,0,0,0,0,0],3),
"k":fb([0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0],7),"g":fb([0,1,0,1,0,0,0,0,0,0,0,0,0,1,0,0],7),
"q":fb([0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0],8),"ʔ":fb([0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,0],10),
"m":fb([0,1,1,1,0,0,1,0,0,0,0,0,0,0,0,0],0),"n":fb([0,1,1,1,0,0,1,0,0,0,0,0,0,0,0,0],3),
"ɲ":fb([0,1,1,1,0,0,1,0,0,0,0,1,0,0,0,0],6),"ŋ":fb([0,1,1,1,0,0,1,0,0,0,0,0,0,1,0,0],7),
"f":fb([0,1,0,0,0,0,0,0,1,1,0,0,0,0,0,0],1),"v":fb([0,1,0,1,0,0,0,0,1,1,0,0,0,0,0,0],1),
"s":fb([0,1,0,0,0,0,0,0,1,1,0,0,0,0,0,0],3),"z":fb([0,1,0,1,0,0,0,0,1,1,0,0,0,0,0,0],3),
"ʃ":fb([0,1,0,0,0,0,0,0,1,1,0,1,0,0,0,0],4),"x":fb([0,1,0,0,0,0,0,0,1,0,0,0,0,1,0,0],7),
"h":fb([0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0],10),
"l":fb([0,1,1,1,0,0,0,1,1,0,0,0,0,0,0,0],3),"r":fb([0,1,1,1,0,0,0,0,1,0,0,0,0,0,0,0],3),
"j":fb([0,0,1,1,0,0,0,0,1,0,0,1,0,0,0,0],6),"w":fb([0,0,1,1,0,0,0,0,1,0,0,1,0,1,1,0],7),
"i":fb([1,0,1,1,0,0,0,0,1,0,0,1,0,0,0,1],6),"e":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,0,0,1],6),
"ɛ":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,0,0,0],6),"a":fb([1,0,1,1,0,0,0,0,1,0,0,0,1,1,0,0],6),
"ə":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,0,0,0],6),
"u":fb([1,0,1,1,0,0,0,0,1,0,0,1,0,1,1,1],7),"o":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,1,1,1],7),
"ɔ":fb([1,0,1,1,0,0,0,0,1,0,0,0,0,1,1,0],7),
};
function clone(s){return{binary:{...s.binary},place:s.place};}
function isV(s){return!!s.binary.syllabic;}function isC(s){return!s.binary.syllabic;}
function isObs(s){return!!s.binary.consonantal&&!s.binary.sonorant;}
function isNas(s){return!!s.binary.nasal;}function isSon(s){return!!s.binary.sonorant;}
function son(s){if(isV(s))return s.binary.low?5:(s.binary.high?3:4);if(isNas(s))return 2;if(isSon(s)&&!isNas(s))return 2.5;if(s.binary.continuant&&isObs(s))return 1;return 0;}
function segL(s){for(const[i,d]of Object.entries(SG)){let m=true;for(const f of BF)if((d.binary[f]||0)!==(s.binary[f]||0)){m=false;break;}if(m&&d.place===s.place)return i;}return"?";}

function syllabify(segs){
if(!segs.length)return[];const syls=[];let i=0;
while(i<segs.length){const sy={onset:[],nucleus:[],coda:[],stress:"none"};
while(i<segs.length&&isC(segs[i])){sy.onset.push(segs[i]);i++;}
while(i<segs.length&&isV(segs[i])){sy.nucleus.push(segs[i]);i++;}
if(!sy.nucleus.length&&sy.onset.length){syls.push({onset:[],nucleus:[sy.onset.pop()],coda:[],stress:"none"});if(sy.onset.length){const p=syls[syls.length-1];p.onset=sy.onset.concat(p.onset);}continue;}
const cs=i;while(i<segs.length&&isC(segs[i]))i++;
if(i<segs.length&&isV(segs[i])){const cd=segs.slice(cs,i);if(cd.length){const k=Math.max(0,cd.length-1);sy.coda=cd.slice(0,k);i=cs+k;}}else sy.coda=segs.slice(cs,i);
sy.stress=syls.length===0?"primary":"none";syls.push(sy);}return syls;}
function flat(syls){return syls.flatMap(s=>[...s.onset,...s.nucleus,...s.coda]);}
function sylIPA(syls){return syls.map(s=>[...s.onset,...s.nucleus,...s.coda].map(segL).join("")).join(".");}

const CON=[
{name:"*CODA",type:"M",fn:(u,sf)=>sf.reduce((c,s)=>c+s.coda.length,0),dw:2},
{name:"*CxOn",type:"M",fn:(u,sf)=>sf.reduce((c,s)=>c+Math.max(0,s.onset.length-1),0),dw:3},
{name:"*CxCd",type:"M",fn:(u,sf)=>sf.reduce((c,s)=>c+Math.max(0,s.coda.length-1),0),dw:3},
{name:"ONSET",type:"M",fn:(u,sf)=>sf.reduce((c,s)=>c+(s.onset.length===0?1:0),0),dw:2},
{name:"*VdOb",type:"M",fn:(u,sf)=>flat(sf).reduce((c,x)=>c+(isObs(x)&&x.binary.voice?1:0),0),dw:.5},
{name:"AGRv",type:"M",fn:(u,sf)=>{const g=flat(sf);let v=0;for(let i=0;i<g.length-1;i++)if(isObs(g[i])&&isObs(g[i+1])&&!!g[i].binary.voice!==!!g[i+1].binary.voice)v++;return v;},dw:2},
{name:"AGRp",type:"M",fn:(u,sf)=>{const g=flat(sf);let v=0;for(let i=0;i<g.length-1;i++)if(isNas(g[i])&&isC(g[i+1])&&!isNas(g[i+1])&&g[i].place!==g[i+1].place)v++;return v;},dw:3},
{name:"SSP",type:"M",fn:(u,sf)=>{let v=0;for(const s of sf){for(let i=0;i<s.onset.length-1;i++)if(son(s.onset[i])>=son(s.onset[i+1]))v++;for(let i=0;i<s.coda.length-1;i++)if(son(s.coda[i])<=son(s.coda[i+1]))v++;}return v;},dw:4},
{name:"*VdCd",type:"M",fn:(u,sf)=>{let v=0;for(const s of sf)for(const x of s.coda)if(isObs(x)&&x.binary.voice)v++;return v;},dw:1},
{name:"MAX",type:"F",fn:(u,sf)=>Math.max(0,u.length-flat(sf).length),dw:5},
{name:"DEP",type:"F",fn:(u,sf)=>Math.max(0,flat(sf).length-u.length),dw:4},
{name:"IDv",type:"F",fn:(u,sf)=>{const ss=flat(sf);let v=0;for(let i=0;i<Math.min(u.length,ss.length);i++)if(!!u[i].binary.voice!==!!ss[i].binary.voice)v++;return v;},dw:3},
{name:"IDp",type:"F",fn:(u,sf)=>{const ss=flat(sf);let v=0;for(let i=0;i<Math.min(u.length,ss.length);i++)if(u[i].place!==ss[i].place)v++;return v;},dw:4},
{name:"IDn",type:"F",fn:(u,sf)=>{const ss=flat(sf);let v=0;for(let i=0;i<Math.min(u.length,ss.length);i++)if(!!u[i].binary.nasal!==!!ss[i].binary.nasal)v++;return v;},dw:3},
{name:"IDm",type:"F",fn:(u,sf)=>{const ss=flat(sf);let v=0;for(let i=0;i<Math.min(u.length,ss.length);i++)if(!!u[i].binary.continuant!==!!ss[i].binary.continuant)v++;return v;},dw:4},
];

function parseIPA(str){const segs=[];let i=0;while(i<str.length){if(i+1<str.length){const d=str.slice(i,i+2);if(SG[d]){segs.push(clone(SG[d]));i+=2;continue;}}if(SG[str[i]])segs.push(clone(SG[str[i]]));i++;}return segs;}

function gen(uf){
const cs=new Map();
const add=(segs,desc)=>{const sy=syllabify(segs);const k=sylIPA(sy);if(!cs.has(k))cs.set(k,{sy,desc,ipa:k});};
add([...uf],"faithful");
for(let i=0;i<uf.length;i++){const s=uf.filter((_,j)=>j!==i);if(s.length)add(s,"del");}
const schwa=clone(SG["ə"]);
for(let i=0;i<=uf.length;i++)add([...uf.slice(0,i),clone(schwa),...uf.slice(i)],"ins ə");
for(let i=0;i<uf.length;i++){if(isC(uf[i])){const s=uf.map((x,j)=>j===i?(()=>{const c=clone(x);c.binary.voice=!c.binary.voice;return c;})():clone(x));add(s,"±voi");}}
for(let i=0;i<uf.length-1;i++){
if(isNas(uf[i])&&isC(uf[i+1])){const s=uf.map((x,j)=>{if(j===i){const c=clone(x);c.place=uf[i+1].place;return c;}return clone(x);});add(s,"assim");}
if(isObs(uf[i])&&isObs(uf[i+1])){
const s1=uf.map((x,j)=>{if(j===i+1){const c=clone(x);c.binary.voice=uf[i].binary.voice;return c;}return clone(x);});add(s1,"voi→");
const s2=uf.map((x,j)=>{if(j===i){const c=clone(x);c.binary.voice=uf[i+1].binary.voice;return c;}return clone(x);});add(s2,"voi←");}
const sw=[...uf.map(clone)];const tmp=sw[i];sw[i]=sw[i+1];sw[i+1]=tmp;add(sw,"swap");}
return Array.from(cs.values());}

function evalUF(uf,w){
const cands=gen(uf);
const rows=cands.map(c=>{const vi={};let h=0;CON.forEach(con=>{const v=con.fn(uf,c.sy);vi[con.name]=v;h-=(w[con.name]??con.dw)*v;});return{...c,vi,h};});
rows.sort((a,b)=>b.h-a.h);return rows;}
function qe(ipa,w){const uf=parseIPA(ipa);if(!uf.length)return ipa;const t=evalUF(uf,w);return t[0]?.ipa||ipa;}

// ═══════════════════════════════════════════════════════════════════════════════
// ROMANIZATION + ENGLISH TRANSLATION
// ═══════════════════════════════════════════════════════════════════════════════
const ROMAN_MAP={"p":"p","b":"b","t":"t","d":"d","k":"k","g":"g","q":"q","ʔ":"'",
"m":"m","n":"n","ɲ":"ny","ŋ":"ng","f":"f","v":"v","s":"s","z":"z","ʃ":"sh",
"x":"kh","h":"h","l":"l","r":"r","j":"y","w":"w",
"i":"ee","e":"ay","ɛ":"eh","a":"a","ə":"u","u":"oo","o":"oh","ɔ":"aw",".":""};
function romanize(ipa){let o="",i=0;while(i<ipa.length){if(i+1<ipa.length){const d=ipa.slice(i,i+2);if(ROMAN_MAP[d]!==undefined){o+=ROMAN_MAP[d];i+=2;continue;}}o+=ROMAN_MAP[ipa[i]]!==undefined?ROMAN_MAP[ipa[i]]:ipa[i];i++;}return o.replace(/([aeiou])\1{2,}/gi,(_,c)=>c+c);}
function romanizeWord(sf){return romanize(sf.replace(/./g,""));}

const IRREG_PAST={"see":"saw","eat":"ate","run":"ran","give":"gave","take":"took","sleep":"slept","sing":"sang","make":"made","fall":"fell","grow":"grew","fly":"flew","swim":"swam","break":"broke","hold":"held","throw":"threw","burn":"burnt","drink":"drank","know":"knew","cut":"cut","find":"found","dig":"dug","hide":"hid"};
function englishTranslation(subj,verb,obj,adj,tense,subjPl,objPl,useDet){
const art=useDet?"the ":"";
const adjS=adj?adj.meaning+" ":"";
const sn=subjPl?(subj.meaning==="fish"||subj.meaning==="deer"?subj.meaning:subj.meaning+"s"):subj.meaning;
const on=objPl?(obj.meaning==="fish"||obj.meaning==="deer"?obj.meaning:obj.meaning+"s"):obj.meaning;
const sNP=art+adjS+sn;
const oNP=(subjPl?"the ":"a ")+on;
let vb=verb.meaning;
if(tense==="FUT")vb="will "+verb.meaning;
else if(tense==="PST")vb=IRREG_PAST[verb.meaning]||(verb.meaning.endsWith("e")?verb.meaning+"d":verb.meaning+"ed");
else if(!subjPl)vb=verb.meaning.endsWith("s")||verb.meaning.endsWith("sh")?verb.meaning+"es":verb.meaning+"s";
return sNP.charAt(0).toUpperCase()+sNP.slice(1)+" "+vb+" "+oNP+".";}

// ═══════════════════════════════════════════════════════════════════════════════
// LANGUAGE GENERATION WITH FLAVOR PRESETS
// ═══════════════════════════════════════════════════════════════════════════════
const C_STOPS=["p","b","t","d","k","g"];
const C_NASAL=["m","n","ŋ"];
const C_FRIC=["f","v","s","z","ʃ","x","h"];
const C_LIQ=["l","r"];
const C_GLIDE=["j","w"];
const ALL_V=["a","e","i","o","u","ɛ","ɔ"];

const MEANINGS={"N":["man","woman","child","baby","boy","girl","father","mother","brother","sister","son","daughter","husband","wife","uncle","aunt","cousin","grandfather","grandmother","friend","enemy","stranger","neighbor","king","queen","prince","princess","lord","lady","chief","elder","warrior","soldier","guard","knight","priest","monk","healer","teacher","student","merchant","farmer","hunter","fisher","baker","smith","weaver","potter","sailor","captain","slave","servant","master","thief","judge","leader","hero","fool","beggar","body","head","face","eye","ear","nose","mouth","lip","tongue","tooth","jaw","chin","cheek","forehead","neck","throat","shoulder","arm","elbow","wrist","hand","finger","thumb","nail","chest","breast","stomach","belly","back","spine","hip","leg","knee","ankle","foot","toe","heel","bone","skull","rib","skin","hair","beard","blood","heart","lung","liver","brain","muscle","vein","wound","scar","animal","dog","cat","horse","cow","bull","ox","pig","sheep","goat","deer","elk","wolf","fox","bear","lion","tiger","leopard","elephant","monkey","ape","rabbit","hare","rat","mouse","squirrel","bat","whale","dolphin","shark","fish","salmon","trout","eel","frog","toad","snake","lizard","turtle","crocodile","eagle","hawk","falcon","owl","crow","raven","sparrow","dove","pigeon","duck","goose","swan","chicken","rooster","hen","parrot","bee","wasp","ant","spider","fly","beetle","butterfly","moth","worm","snail","world","earth","land","ground","soil","dirt","mud","clay","sand","dust","rock","stone","pebble","boulder","cliff","mountain","hill","valley","plain","field","meadow","forest","wood","jungle","swamp","marsh","desert","island","coast","shore","beach","cave","pit","hole","lake","pond","river","stream","creek","spring","waterfall","sea","ocean","wave","tide","current","bay","harbor","ice","glacier","sky","cloud","rain","storm","thunder","lightning","wind","breeze","snow","frost","hail","fog","mist","dew","rainbow","sun","moon","star","dawn","sunrise","sunset","dusk","twilight","day","night","shadow","darkness","light","tree","branch","trunk","root","bark","leaf","twig","bush","shrub","vine","grass","weed","flower","blossom","petal","seed","nut","fruit","berry","grain","wheat","corn","rice","bean","herb","moss","fern","thorn","stump","log","food","meal","feast","bread","cake","dough","flour","salt","pepper","sugar","honey","oil","butter","cheese","milk","cream","egg","meat","beef","pork","lamb","soup","stew","broth","sauce","spice","wine","beer","ale","water","tea","juice","vinegar","metal","iron","steel","copper","bronze","gold","silver","tin","lead","glass","brick","leather","fur","wool","silk","cotton","cloth","fabric","thread","string","rope","chain","wire","wax","tar","pitch","dye","ink","paint","paper","tool","knife","blade","sword","spear","arrow","bow","axe","hammer","saw","needle","pin","hook","plow","shovel","pick","chisel","anvil","forge","wheel","cart","wagon","sled","oar","paddle","net","trap","shield","armor","helmet","house","home","hut","cabin","tent","shelter","hall","palace","castle","fort","tower","temple","church","shrine","barn","stable","mill","workshop","market","shop","inn","tavern","prison","tomb","grave","wall","fence","gate","door","window","roof","floor","ceiling","stair","bridge","road","path","trail","street","alley","tunnel","box","barrel","basket","bag","sack","pouch","jar","pot","bowl","cup","plate","dish","bucket","tray","shelf","table","chair","bench","bed","cradle","pillow","blanket","mat","rug","curtain","mirror","lamp","candle","torch","lantern","clothes","shirt","coat","cloak","robe","dress","skirt","pants","belt","boot","shoe","sandal","hat","cap","hood","crown","ring","necklace","bracelet","earring","jewel","gem","button","pocket","collar","sleeve","glove","scarf","veil","mask","boat","ship","raft","canoe","sail","mast","anchor","port","dock","saddle","bridle","rein","whip","camp","journey","voyage","time","moment","instant","hour","morning","noon","afternoon","evening","week","month","year","season","summer","autumn","winter","age","era","past","future","beginning","end","birth","death","name","word","voice","speech","language","song","story","tale","poem","riddle","joke","secret","lie","truth","promise","oath","law","rule","custom","right","duty","honor","shame","glory","fame","power","strength","weakness","wealth","poverty","trade","price","debt","gift","reward","punishment","war","peace","battle","victory","defeat","freedom","slavery","justice","mercy","courage","fear","anger","rage","hatred","love","desire","hope","joy","happiness","sorrow","grief","pain","pleasure","pride","envy","greed","pity","trust","doubt","faith","dream","thought","idea","plan","reason","wisdom","knowledge","skill","art","craft","work","labor","rest","sleep","game","dance","music","prayer","curse","blessing","magic","spell","omen","fate","luck","chance","danger","safety","life","soul","spirit","ghost","god","devil","angel","demon","heaven","hell","number","pair","half","part","piece","whole","group","crowd","army","tribe","family","people","nation","kind","type","way","manner","cause","effect","sign","mark","shape","form","size","color","weight","edge","center","middle","side","top","bottom","front","point","line","circle","corner","surface","border","limit","space","place","spot","area","region","country","city","town","village","thing","object","stuff","pile","heap","bundle","knot","crack","gap","slit","notch","scratch","dent","stain","drop","splash","flood","smoke","steam","ash","ember","coal","flame","fire","spark","explosion","noise","sound","echo","silence","smell","taste","touch","sight","pattern","picture","image","map","flag","banner","bell","drum","flute","horn","pipe","whistle","key","lock","coin","treasure","prize","trophy","toy","doll","puppet","dice","card","letter","message","book","scroll","page","list","record","seal","stamp","token","symbol","cross","feather","shell","pearl","ivory","amber","crystal","volcano","canyon","gorge","ridge","slope","peak","summit","crater","reef","lagoon","oasis","steppe","tundra","ravine","plateau","peninsula","continent","delta","strait","planet","comet","meteor","eclipse","constellation","horizon","zenith","panther","jaguar","cheetah","hyena","jackal","coyote","badger","otter","walrus","moose","bison","buffalo","camel","donkey","mule","pony","stallion","mare","colt","calf","kid","pup","kitten","chick","cub","stag","doe","boar","sow","ram","ewe","drake","peacock","crane","stork","heron","pelican","gull","albatross","vulture","condor","robin","finch","lark","thrush","nightingale","cuckoo","woodpecker","kingfisher","magpie","jay","starling","swallow","swift","quail","pheasant","grouse","turkey","ostrich","penguin","flamingo","cobra","viper","python","iguana","gecko","chameleon","salamander","newt","tadpole","crab","lobster","shrimp","oyster","clam","squid","octopus","jellyfish","starfish","scorpion","centipede","cricket","grasshopper","dragonfly","firefly","ladybug","cockroach","mosquito","tick","flea","leech","coral","sponge","oak","pine","birch","maple","willow","elm","cedar","palm","bamboo","cactus","orchid","rose","lily","tulip","daisy","sunflower","lotus","ivy","clover","mushroom","fungus","algae","lichen","reed","kelp","seaweed","acorn","pinecone","coconut","fig","olive","grape","apple","pear","plum","peach","cherry","melon","mango","banana","lemon","orange","onion","garlic","potato","carrot","turnip","cabbage","lettuce","cucumber","tomato","pumpkin","squash","ginger","cinnamon","mint","basil","sage","thyme","lavender","snack","crumb","morsel","portion","slice","loaf","crust","pastry","pie","pudding","jam","jelly","syrup","gravy","marinade","seasoning","relish","pickle","sausage","bacon","ham","jerky","fat","marrow","kidney","hide","antler","tusk","claw","talon","hoof","paw","tail","wing","fin","scale","gill","beak","mane","cathedral","monastery","fortress","citadel","keep","dungeon","moat","drawbridge","battlement","turret","dome","arch","pillar","column","beam","rafter","threshold","hearth","chimney","oven","well","cistern","aqueduct","sewer","drain","gutter","cellar","attic","balcony","porch","courtyard","garden","orchard","vineyard","pasture","corral","pen","cage","kennel","pier","wharf","lighthouse","watchtower","monument","statue","fountain","plaza","arena","stage","altar","pliers","tongs","bellows","crucible","ladle","sieve","funnel","comb","brush","broom","mop","rake","hoe","scythe","sickle","flail","loom","spindle","bobbin","thimble","awl","file","rasp","clamp","lever","pulley","wedge","compass","sundial","hourglass","calendar","abacus","quill","chalk","slate","tablet","parchment","manuscript","diary","journal","almanac","encyclopedia","harp","lute","lyre","fiddle","violin","guitar","cymbal","gong","trumpet","tuba","organ","melody","rhythm","harmony","chord","tune","verse","chorus","ballad","hymn","anthem","lullaby","dirge","painting","portrait","sculpture","mosaic","tapestry","fresco","sketch","mural","gallery","theater","costume","ballet","opera","navy","fleet","regiment","battalion","brigade","troop","legion","militia","cavalry","infantry","archer","scout","spy","general","commander","rank","siege","ambush","raid","invasion","conquest","rebellion","revolt","revolution","mutiny","treason","alliance","treaty","truce","ceasefire","surrender","exile","refugee","captive","hostage","ransom","loot","plunder","spoil","medal","casualty","massacre","slaughter","kingdom","empire","republic","state","province","county","district","realm","domain","throne","scepter","court","council","senate","assembly","parliament","election","vote","decree","edict","charter","constitution","citizen","noble","peasant","serf","vassal","regent","heir","dynasty","clan","guild","order","brotherhood","sisterhood","colony","settlement","outpost","frontier","territory","embassy","envoy","ambassador","diplomat","idol","relic","ritual","ceremony","sacrifice","offering","chant","prophecy","oracle","vision","miracle","sin","virtue","redemption","salvation","damnation","paradise","underworld","afterlife","reincarnation","ancestor","prophet","saint","martyr","pilgrim","crusade","heresy","doctrine","scripture","myth","legend","fable","parable","mind","memory","instinct","habit","talent","genius","madness","sanity","conscience","will","ambition","obsession","passion","devotion","loyalty","betrayal","revenge","grudge","jealousy","contempt","disgust","horror","terror","panic","anxiety","despair","melancholy","nostalgia","longing","ecstasy","bliss","serenity","contentment","gratitude","sympathy","compassion","empathy","indifference","apathy","boredom","curiosity","amazement","confusion","clarity","illusion","delusion","hallucination","nightmare","fantasy","reality","existence","consciousness","identity","self","ego","reputation","dignity","integrity","hypocrisy","money","currency","fortune","profit","loss","tax","toll","tribute","dowry","inheritance","estate","property","acre","harvest","surplus","famine","drought","plague","epidemic","loan","interest","contract","deed","receipt","inventory","cargo","goods","merchandise","commodity","luxury","industry","factory","mine","quarry","length","width","height","depth","distance","measure","amount","quantity","total","sum","count","score","dozen","hundred","thousand","million","fraction","degree","angle","proportion","ratio","balance","science","theory","experiment","discovery","invention","method","system","process","technique","formula","equation","proof","evidence","fact","data","result","conclusion","hypothesis","principle","concept","category","class","species","genus","element","compound","mixture","solution","reaction","force","energy","heat","pressure","gravity","motion","speed","velocity","frequency","vibration"],"V":["go","come","walk","run","rush","hurry","crawl","climb","jump","leap","fall","drop","fly","swim","dive","float","sink","slide","slip","roll","spin","turn","twist","bend","stretch","reach","cross","pass","enter","leave","return","arrive","depart","follow","lead","chase","flee","escape","wander","roam","drift","march","charge","retreat","advance","stand","sit","lie","kneel","lean","hang","rise","lift","raise","lower","put","set","place","lay","move","carry","bring","take","send","throw","catch","pick","pull","push","drag","hold","grip","grab","seize","release","shake","wave","swing","toss","pour","spill","scatter","gather","collect","stack","pile","wrap","fold","spread","do","make","build","create","destroy","break","crush","smash","tear","rip","cut","chop","slice","carve","scrape","scratch","dig","drill","bore","pound","hammer","forge","shape","mold","press","squeeze","grind","mill","polish","sharpen","split","crack","snap","pop","explode","collapse","work","labor","toil","rest","plant","sow","harvest","reap","plow","water","feed","tend","herd","milk","shear","hunt","fish","trap","cook","bake","brew","roast","boil","fry","stew","dry","smoke","pickle","salt","mix","stir","knead","weave","sew","knit","dye","paint","draw","write","sculpt","repair","mend","see","look","watch","gaze","stare","glance","peek","notice","spot","observe","hear","listen","smell","sniff","taste","touch","feel","sense","perceive","think","know","believe","doubt","wonder","remember","forget","learn","teach","study","understand","realize","recognize","imagine","dream","plan","decide","choose","guess","suppose","expect","hope","wish","want","need","desire","prefer","mean","intend","say","speak","talk","tell","ask","answer","reply","call","shout","yell","scream","cry","whisper","sing","chant","hum","read","name","describe","explain","warn","promise","swear","confess","deny","argue","debate","agree","refuse","order","command","beg","plead","praise","blame","thank","greet","welcome","farewell","give","receive","share","trade","buy","sell","pay","owe","lend","borrow","steal","rob","offer","accept","reject","invite","visit","join","meet","unite","divide","separate","help","serve","protect","guard","save","rescue","defend","attack","fight","strike","hit","kick","punch","stab","shoot","wound","kill","murder","spare","surrender","conquer","rule","govern","obey","rebel","betray","forgive","punish","reward","judge","accuse","arrest","free","imprison","love","hate","like","fear","worry","trust","respect","admire","envy","pity","mourn","grieve","celebrate","enjoy","suffer","endure","bear","tolerate","laugh","smile","weep","sigh","moan","groan","be","become","seem","appear","vanish","disappear","exist","live","die","survive","grow","shrink","expand","change","begin","start","stop","end","finish","continue","last","remain","stay","wait","happen","occur","eat","drink","swallow","chew","bite","lick","suck","spit","breathe","blow","cough","sneeze","yawn","sleep","wake","open","close","shut","lock","unlock","light","burn","glow","shine","flash","melt","freeze","steam","wet","wash","clean","scrub","rinse","wipe","sweep","fill","empty","cover","uncover","hide","reveal","show","bury","squat","crouch","bow","nod","shrug","wink","blink","frown","grin","gasp","pant","choke","strangle","drown","bleed","heal","recover","faint","stumble","trip","stagger","limp","hobble","dash","sprint","gallop","trot","creep","sneak","prowl","stalk","pounce","lunge","dodge","duck","swerve","halt","pause","hover","soar","glide","plunge","emerge","surface","submerge","farm","garden","cultivate","irrigate","fertilize","graft","prune","trim","mow","thresh","winnow","graze","breed","slaughter","butcher","tan","cure","ferment","distill","extract","refine","smelt","temper","weld","rivet","bolt","screw","glue","cement","plaster","whitewash","tile","thatch","timber","quarry","excavate","mine","prospect","survey","measure","calculate","design","draft","blueprint","discuss","negotiate","persuade","convince","deceive","flatter","mock","ridicule","insult","humiliate","compliment","encourage","discourage","advise","suggest","recommend","propose","announce","declare","proclaim","preach","lecture","recite","narrate","translate","interpret","signal","gesture","beckon","summon","dismiss","introduce","present","represent","symbolize","imply","hint","conceal","confide","gossip","rumor","slander","testify","witness","vow","pledge","dedicate","devote","sacrifice","honor","commemorate","lament","console","adore","cherish","treasure","crave","yearn","ache","throb","sting","itch","tingle","shiver","tremble","quake","shudder","startle","shock","stun","amaze","astonish","fascinate","annoy","irritate","infuriate","terrify","horrify","disgust","charm","enchant","bewitch","haunt","torment","torture","oppress","liberate","inspire","motivate","depress","overwhelm","exhaust","refresh","satisfy","disappoint","reign","administer","legislate","enforce","regulate","tax","fine","banish","exile","pardon","decree","appoint","elect","crown","abdicate","resign","overthrow","usurp","conspire","plot","scheme","ally","merge","annex","colonize","occupy","secede","resist","submit","comply","defy","challenge","rival","compete","dominate","subordinate","invent","devise","compose","construct","assemble","erect","demolish","ruin","wreck","shatter","splinter","crumble","decay","rot","corrode","erode","dissolve","evaporate","condense","crystallize","solidify","liquefy","ignite","kindle","smother","extinguish","quench","douse","scorch","char","wither","bloom","sprout","germinate","ripen","mature","age","renew","restore","preserve","conserve","waste","squander","deplete","replenish","attempt","succeed","fail","achieve","accomplish","master","practice","rehearse","perform","execute","manage","handle","control","direct","guide","steer","navigate","explore","search","seek","track","trace","locate","identify","classify","sort","arrange","organize","store","pack","load","unload","deliver","distribute","supply","provide","equip","arm","disarm","fortify","besiege","bombard","ambush","raid","plunder","pillage","loot","ransack","patrol","scout","spy","infiltrate","sabotage","withdraw","evacuate","abandon","desert","strand","maroon","salvage"],"ADJ":["big","small","large","tiny","huge","vast","tall","short","long","wide","narrow","thick","thin","flat","round","square","straight","curved","sharp","blunt","deep","shallow","high","low","hard","soft","rough","smooth","wet","dry","hot","cold","warm","cool","heavy","light","strong","weak","tough","brittle","solid","hollow","dense","loose","tight","stiff","flexible","sticky","slippery","dull","red","blue","green","yellow","black","white","brown","gray","orange","purple","pink","golden","silver","dark","bright","pale","vivid","faded","old","young","new","ancient","fresh","ripe","raw","rotten","broken","whole","clean","dirty","pure","mixed","empty","full","open","closed","alive","dead","healthy","sick","wounded","scarred","blind","deaf","mute","lame","sweet","bitter","sour","salty","spicy","bland","rich","mild","pungent","fragrant","foul","loud","quiet","silent","noisy","harsh","gentle","fast","slow","quick","sudden","steady","swift","fierce","violent","calm","still","good","bad","kind","cruel","brave","cowardly","wise","foolish","clever","stupid","honest","false","loyal","faithful","greedy","generous","humble","proud","noble","wicked","holy","evil","just","fair","patient","restless","lazy","busy","careful","careless","bold","shy","stubborn","obedient","wild","tame","free","captive","lonely","crowded","beautiful","ugly","pretty","handsome","plain","strange","familiar","common","rare","special","ordinary","important","worthless","precious","cheap","valuable","useful","useless","easy","difficult","simple","complex","clear","confused","certain","uncertain","true","right","wrong","real","fake","safe","dangerous","lucky","cursed","famous","unknown","secret","obvious","hidden","visible","near","far","close","distant","first","last","next","final","same","different","other","own","only","main","extra","enormous","gigantic","miniature","microscopic","colossal","immense","moderate","average","slim","plump","lean","muscular","frail","robust","sturdy","delicate","fragile","massive","portable","stable","wobbly","crooked","tangled","knotted","woven","braided","striped","spotted","speckled","mottled","scarlet","crimson","azure","emerald","ivory","ebony","amber","turquoise","indigo","maroon","tan","beige","rust","charcoal","transparent","opaque","translucent","glossy","matte","shiny","sparkling","glowing","dim","murky","hazy","misty","foggy","smoky","dusty","sandy","rocky","muddy","icy","snowy","stormy","windy","rainy","sunny","cloudy","tropical","arctic","arid","humid","fertile","barren","lush","verdant","withered","blooming","moldy","stale","cooked","baked","roasted","fried","boiled","steamed","dried","smoked","salted","cured","fermented","pickled","frozen","thawed","melted","liquid","gaseous","powdered","granular","lumpy","coarse","fine","pointed","jagged","serrated","polished","rusty","tarnished","worn","tattered","patched","mended","pristine","immaculate","spotless","filthy","grimy","greasy","oily","soaked","drenched","parched","shriveled","swollen","bloated","inflated","deflated","compressed","expanded","stretched","twisted","bent","warped","dented","cracked","chipped","scratched","branded","marked","unmarked","ornate","elaborate","intricate","crude","refined","elegant","graceful","clumsy","awkward","nimble","agile","sluggish","energetic","vigorous","feeble","mighty","powerful","helpless","vulnerable","invincible","immortal","mortal","divine","sacred","profane","blessed","haunted","enchanted","magical","mundane","exotic","native","foreign","local","domestic","urban","rural","coastal","inland","northern","southern","eastern","western","upper","lower","inner","outer","central","remote","isolated","accessible","forbidden","legendary","mythical","historic","prehistoric","medieval","modern","eternal","temporary","permanent","fleeting","instant","gradual","rapid","chronic","acute","dormant","active","passive","aggressive","defensive","offensive","neutral","hostile","friendly","formal","casual","solemn","festive","secular","public","private","royal","wealthy","impoverished","prosperous","desolate","thriving","declining","rising","falling","growing","shrinking","abundant","scarce","plentiful","meager","ample","sufficient","excessive","extreme","severe","intense","faint","subtle","apparent","concealed","exposed","naked","clothed","armed","unarmed","loaded","occupied","vacant","inhabited","deserted","sparse","scattered","concentrated","diluted","contaminated","poisonous","venomous","harmless","lethal","deadly","fatal","vital","essential","optional","mandatory","voluntary","reluctant","eager","willing","unwilling","ready","unprepared"]};

function rng(a,b){return Math.random()*(b-a)+a;}
function pick(a){return a[Math.floor(Math.random()*a.length)];}
function pickN(a,n){const s=[...a],r=[];for(let i=0;i<n&&s.length;i++){const x=Math.floor(Math.random()*s.length);r.push(s.splice(x,1)[0]);}return r;}

const FLAVORS={
"Random":{desc:"Fully randomized — roll the dice", stops:3,nas:2,fric:3,liq:2,gli:1,vows:5,codas:null,clusters:false,short:false,long:false,minMorph:false,richMorph:false,extra:[],wOver:{}, voice:{pitch:[100,160],Rd:[1.3,2.5],rhythm:"mixed",tempo:1.0,pitchRange:0.15,reduction:false},deriv:"mixed"},
"Harsh":{desc:"Gutturals, closed syllables, short & sharp", stops:6,nas:2,fric:2,liq:1,gli:0,vows:4,codas:true,clusters:false,short:true,long:false,minMorph:false,richMorph:false,extra:["q","ʔ"],wOver:{"*CODA":.5,"*CxCd":1,"MAX":7,"DEP":6,"*VdOb":.5,"SSP":3}, voice:{pitch:[80,120],Rd:[1.0,1.5],rhythm:"stress",tempo:0.95,pitchRange:0.25,reduction:true},deriv:"prefix"},
"Flowing":{desc:"Open syllables, liquids, melodic", stops:2,nas:3,fric:2,liq:3,gli:2,vows:5,codas:false,clusters:false,short:false,long:true,minMorph:false,richMorph:false,extra:[],wOver:{"*CODA":8,"*CxOn":8,"*CxCd":8,"ONSET":1,"MAX":3,"DEP":2}, voice:{pitch:[130,200],Rd:[1.8,2.8],rhythm:"syllable",tempo:0.85,pitchRange:0.2,reduction:false},deriv:"reduplication"},
"Clipped":{desc:"Monosyllables, final devoicing, terse", stops:5,nas:2,fric:3,liq:1,gli:0,vows:4,codas:true,clusters:false,short:true,long:false,minMorph:true,richMorph:false,extra:[],wOver:{"*CODA":.5,"*CxOn":4,"*VdCd":7,"MAX":8,"DEP":7,"IDv":1}, voice:{pitch:[90,140],Rd:[1.2,1.8],rhythm:"stress",tempo:1.15,pitchRange:0.12,reduction:true},deriv:"compound"},
"Polynesian":{desc:"CV only, tiny inventory, very long words", stops:2,nas:2,fric:1,liq:1,gli:0,vows:5,codas:false,clusters:false,short:false,long:true,minMorph:false,richMorph:false,extra:[],wOver:{"*CODA":10,"*CxOn":10,"*CxCd":10,"ONSET":1,"MAX":2,"DEP":1}, voice:{pitch:[140,210],Rd:[2.0,3.0],rhythm:"mora",tempo:0.8,pitchRange:0.1,reduction:false},deriv:"reduplication"},
"Slavic":{desc:"Consonant clusters, case-heavy, rich morphology", stops:5,nas:3,fric:4,liq:2,gli:1,vows:5,codas:true,clusters:true,short:false,long:false,minMorph:false,richMorph:true,extra:[],wOver:{"*CODA":.5,"*CxOn":1,"*CxCd":1,"SSP":2,"MAX":7,"DEP":6,"AGRv":4}, voice:{pitch:[85,145],Rd:[1.2,2.0],rhythm:"stress",tempo:1.0,pitchRange:0.2,reduction:true},deriv:"suffix"},
"Semitic":{desc:"3-vowel system, gutturals, CVC roots", stops:4,nas:2,fric:5,liq:2,gli:1,vows:3,codas:true,clusters:false,short:true,long:false,minMorph:false,richMorph:false,extra:["q","ʔ","x"],wOver:{"*CODA":1,"*CxOn":2,"MAX":7,"DEP":5,"AGRp":5}, voice:{pitch:[90,130],Rd:[1.0,1.6],rhythm:"stress",tempo:1.05,pitchRange:0.22,reduction:false},deriv:"template"},
"Punchy":{desc:"All stops, staccato, minimal", stops:6,nas:1,fric:1,liq:1,gli:0,vows:3,codas:true,clusters:false,short:true,long:false,minMorph:true,richMorph:false,extra:[],wOver:{"*CODA":1,"*CxOn":3,"MAX":8,"DEP":7,"*VdOb":2}, voice:{pitch:[80,130],Rd:[1.0,1.4],rhythm:"stress",tempo:1.25,pitchRange:0.18,reduction:true},deriv:"compound"},
"Nasal":{desc:"Nasal-heavy, prenasalized stops, assimilation", stops:4,nas:4,fric:2,liq:2,gli:1,vows:5,codas:true,clusters:false,short:false,long:false,minMorph:false,richMorph:false,extra:["ɲ"],wOver:{"AGRp":8,"IDp":1.5,"*CODA":2}, voice:{pitch:[120,180],Rd:[1.6,2.4],rhythm:"syllable",tempo:0.9,pitchRange:0.15,reduction:false},deriv:"prefix"},
};

function genSyl(vows,cons,coda,cluster){
let s="";
if(Math.random()<0.85)s+=pick(cons);
if(cluster&&s&&Math.random()<0.25){const liq=cons.filter(c=>"lrjw".includes(c));if(liq.length)s+=pick(liq);}
s+=pick(vows);
if(coda&&Math.random()<0.55)s+=pick(cons.filter(c=>!"hjw".includes(c)));
return s;
}
function genWd(vows,cons,coda,cluster,nSyl){
let w="";for(let i=0;i<nSyl;i++)w+=genSyl(vows,cons,coda&&(i===nSyl-1||Math.random()<0.3),cluster&&i===0);return w;}

function generateLanguage(flavorKey){
const fk=flavorKey||pick(Object.keys(FLAVORS));
const F=FLAVORS[fk];

// Build inventory
let cons=[...pickN(C_STOPS,Math.min(F.stops,6)),...pickN(C_NASAL,Math.min(F.nas,3)),...pickN(C_FRIC,Math.min(F.fric,7)),...pickN(C_LIQ,Math.min(F.liq,2)),...pickN(C_GLIDE,Math.min(F.gli,2))];
F.extra.forEach(c=>{if(!cons.includes(c))cons.push(c);});
const vows=pickN(ALL_V,F.vows);
const coda=F.codas===null?Math.random()<0.5:F.codas;
const cluster=F.clusters;

// Weights
const w={};CON.forEach(c=>{w[c.name]=c.type==="M"?rng(0.5,5):rng(2.5,6.5);});
Object.assign(w,F.wOver);
Object.keys(w).forEach(k=>{w[k]=Math.round(w[k]*10)/10;});

const wordOrder=pick(["SVO","SOV","VSO"]);
const hasCase=F.richMorph?true:F.minMorph?false:Math.random()<0.55;
const cases=hasCase?{NOM:pick(["","",genSyl(vows,cons,false,false)]),ACC:genSyl(vows,cons,false,false),DAT:genSyl(vows,cons,false,false)}:null;
const pluralSuffix=F.minMorph?pick(vows):genSyl(vows,cons,coda,false);

// ─── Pronouns: 6 forms (1sg, 2sg, 3sg, 1pl, 2pl, 3pl) ───
const pronouns={
"1sg":genWd(vows,cons,coda,false,1),
"2sg":genWd(vows,cons,coda,false,1),
"3sg":genWd(vows,cons,coda,false,1),
"1pl":genWd(vows,cons,coda,false,pick([1,2])),
"2pl":genWd(vows,cons,coda,false,pick([1,2])),
"3pl":genWd(vows,cons,coda,false,pick([1,2])),
};

// ─── Verb agreement: suffix per person/number ───
// Some languages have full paradigms, some partial, some none
const agreeType=F.minMorph?"none":F.richMorph?"full":pick(["none","partial","full"]);
const agreeParadigm={};
if(agreeType==="full"){
["1sg","2sg","3sg","1pl","2pl","3pl"].forEach(p=>{agreeParadigm[p]=genSyl(vows,cons,false,false);});
} else if(agreeType==="partial"){
// Only 3sg and maybe 1sg are marked, rest are zero
agreeParadigm["3sg"]=genSyl(vows,cons,false,false);
agreeParadigm["1sg"]=Math.random()<0.5?genSyl(vows,cons,false,false):"";
["2sg","1pl","2pl","3pl"].forEach(p=>{agreeParadigm[p]="";});
}

// ─── Tense × Aspect ───
// Tense: past/present/future. Aspect: perfective/imperfective (and optionally progressive)
const tenses={PRS:pick(["","",genSyl(vows,cons,false,false)]),PST:F.minMorph?pick(cons)+pick(vows):genSyl(vows,cons,coda,false),FUT:genSyl(vows,cons,false,false)};
const hasAspect=F.minMorph?false:Math.random()<0.7;
const aspects=hasAspect?{
PFV:pick(["",genSyl(vows,cons,false,false)]),  // perfective (completed)
IPFV:genSyl(vows,cons,false,false),              // imperfective (ongoing/habitual)
PROG:Math.random()<0.4?genSyl(vows,cons,false,false):null, // progressive (optional)
}:null;

// ─── Noun classes / grammatical gender ───
const nClassCount=F.minMorph?0:F.richMorph?pick([3,4,5]):pick([0,0,2,2,3]);
const nClasses=[];
const classNames=["I","II","III","IV","V"];
const classSemantics=[
["man","woman","child","father","mother","brother","sister","king","queen","warrior","hunter","friend","enemy","leader","hero","elder","knight","priest"], // human
["dog","cat","horse","wolf","bear","lion","eagle","bird","fish","snake","deer","fox","cow","pig","sheep","goat","whale","elephant"], // animate
["tree","flower","grass","forest","river","mountain","sea","lake","rain","storm","wind","fire","sun","moon","star","cloud","earth","water"], // natural
["sword","house","stone","bread","gold","ring","boat","wheel","crown","shield","arrow","cup","book","door","wall","bridge","road","tower"], // inanimate
["war","peace","love","fear","dream","truth","death","life","hope","joy","pain","anger","wisdom","faith","honor","courage","freedom","beauty"], // abstract
];
const hasDet=F.minMorph?false:Math.random()<0.5;
for(let ci=0;ci<nClassCount;ci++){
nClasses.push({
name:classNames[ci],
marker:genSyl(vows,cons,false,false),
adjAgree:genSyl(vows,cons,false,false),
detForm:hasDet?genSyl(vows,cons,false,false):"",
pronoun:genWd(vows,cons,coda,false,1), // 3rd person pronoun for this class
semantics:new Set(classSemantics[ci]||[]),
});
}
// Assign each noun a class
function assignNounClass(meaning){
if(!nClasses.length)return null;
// Check semantic match first
for(let ci=0;ci<nClasses.length;ci++){
if(nClasses[ci].semantics.has(meaning))return ci;
}
// Arbitrary assignment based on hash
let h=0;for(let i=0;i<meaning.length;i++)h=(h*31+meaning.charCodeAt(i))|0;
return Math.abs(h)%nClasses.length;
}

// ─── Relative clause strategy ───
const relStrategy=wordOrder==="SOV"?"prenominal":wordOrder==="VSO"?pick(["postnominal","prenominal"]):pick(["postnominal","postnominal","prenominal"]);
const relativizer=genSyl(vows,cons,false,false); // relative particle/pronoun

// ─── Adpositions (prepositions or postpositions, correlated with word order) ───
const adpType=wordOrder==="SOV"?"post":wordOrder==="VSO"?"pre":pick(["pre","post"]);
const adpositions={
"in":genSyl(vows,cons,false,false),
"on":genSyl(vows,cons,false,false),
"to":genSyl(vows,cons,false,false),
"from":genSyl(vows,cons,coda,false),
"with":genSyl(vows,cons,coda,false),
"for":genSyl(vows,cons,false,false),
"near":genSyl(vows,cons,false,false),
"under":genSyl(vows,cons,false,false),
"over":genSyl(vows,cons,false,false),
"between":genSyl(vows,cons,false,false),
};

const adjBefore=Math.random()<0.5;
const detWord=hasDet?genSyl(vows,cons,false,false):"";

// Negation particle or prefix
const negType=pick(["particle","prefix"]);
const negWord=genSyl(vows,cons,false,false);
const negPrefix=genSyl(vows,cons,false,false);
// Possession suffix
const possSuffix=genSyl(vows,cons,false,false);
// Question particle (sentence-final or initial)
const qParticle=genSyl(vows,cons,false,false);
const qPosition=pick(["final","initial"]);
// Copula
const copula=genWd(vows,cons,coda,false,1);
// Derivational affixes
const derivStrategy=F.deriv==="mixed"?pick(["suffix","prefix","reduplication","compound","template"]):F.deriv;
const derivAffixes={
agent:genSyl(vows,cons,coda,false),
abstract:genSyl(vows,cons,false,false),
adjective:genSyl(vows,cons,false,false),
place:genSyl(vows,cons,false,false),
instrument:genSyl(vows,cons,coda,false),
prefix_agent:genSyl(vows,cons,false,false),
prefix_abstract:genSyl(vows,cons,false,false),
prefix_place:genSyl(vows,cons,false,false),
};
// Templatic patterns for Semitic-style: CaCiC, maCCuC, etc.
const templates={
agent:[pick(vows),pick(vows),pick(vows)],       // e.g. CaCiC
abstract:[pick(vows),pick(vows)],                 // e.g. CuCaC
place:["ma",pick(vows)],                          // e.g. maCCaC
instrument:["mi",pick(vows)],                     // e.g. miCCaC
};

// Derive a word from a base using the language's strategy
// Returns {ipa, desc} where desc explains the derivation
function deriveWord(baseIPA,role){
if(derivStrategy==="suffix"){
const suf=role==="agent"?derivAffixes.agent:role==="abstract"?derivAffixes.abstract:role==="adjective"?derivAffixes.adjective:role==="place"?derivAffixes.place:derivAffixes.instrument;
return{ipa:baseIPA+suf,desc:`${baseIPA}+-${suf}`};
}
if(derivStrategy==="prefix"){
const pre=role==="agent"?derivAffixes.prefix_agent:role==="abstract"?derivAffixes.prefix_abstract:role==="adjective"?derivAffixes.adjective:derivAffixes.prefix_place;
return{ipa:pre+baseIPA,desc:`${pre}-+${baseIPA}`};
}
if(derivStrategy==="reduplication"){
// Partial reduplication: copy first syllable
const firstSyl=baseIPA.length>=2?baseIPA.slice(0,2):baseIPA;
if(role==="agent"||role==="instrument") return{ipa:firstSyl+baseIPA,desc:`RED(${firstSyl})+${baseIPA}`};
if(role==="abstract") return{ipa:baseIPA+firstSyl,desc:`${baseIPA}+RED(${firstSyl})`};
if(role==="place") return{ipa:firstSyl+baseIPA+pick(vows),desc:`RED+${baseIPA}+V`};
// adjective: full reduplication
return{ipa:baseIPA+baseIPA,desc:`${baseIPA}~${baseIPA}`};
}
if(derivStrategy==="compound"){
// Compound with a generic morpheme
const head=role==="agent"?pick(["man","one"]):role==="place"?pick(["land","home"]):role==="abstract"?pick(["way","thing"]):pick(["stuff","kind"]);
const headItem=lexicon.N.find(n=>n.meaning===head);
const headIPA=headItem?headItem.ipa:genSyl(vows,cons,coda,false);
return{ipa:baseIPA+headIPA,desc:`${baseIPA}+${headIPA}(${head})`};
}
if(derivStrategy==="template"){
// Extract consonants from base, apply vowel template
const consonants=baseIPA.split("").filter(c=>!ALL_V.includes(c));
const tmpl=role==="agent"?templates.agent:role==="abstract"?templates.abstract:role==="place"?templates.place:templates.instrument;
let result="";
let ci=0;
// Interleave consonants with template vowels
for(let ti=0;ti<tmpl.length;ti++){
if(ci<consonants.length)result+=consonants[ci++];
result+=tmpl[ti];
}
while(ci<consonants.length)result+=consonants[ci++];
if(result.length<2)result=baseIPA+derivAffixes.agent; // fallback
return{ipa:result,desc:`root(${consonants.join("")})+pattern(${tmpl.join("")})`};
}
return{ipa:baseIPA+derivAffixes.agent,desc:"derived"};
}

const sylD=F.short?[1,1,1,2]:F.long?[2,2,3,3,4]:[1,1,2,2,3];
const adjD=F.short?[1,1]:[1,2];

const lexicon={N:[],V:[],ADJ:[]};
const used={N:new Set(),V:new Set(),ADJ:new Set()};
const addLex=(cat,n,dist)=>{const pool=MEANINGS[cat].filter(m=>!used[cat].has(m));for(let i=0;i<n&&pool.length;i++){const meaning=pool.splice(Math.floor(Math.random()*pool.length),1)[0];used[cat].add(meaning);lexicon[cat].push({meaning,ipa:genWd(vows,cons,coda,cluster,pick(dist))});}};
addLex("N",MEANINGS.N.length,sylD);addLex("V",MEANINGS.V.length,sylD);addLex("ADJ",MEANINGS.ADJ.length,adjD);

// ─── Productive derivation: semantic roles, not English word pairs ───
// Each base word can derive into related meanings through the language's strategy
const DERIV_RULES=[
// V→N agent: "one who Vs"
{from:"V",to:"N",role:"agent",pairs:[["hunt","hunter"],["fight","fighter"],["lead","leader"],["teach","teacher"],["build","builder"],["farm","farmer"],["weave","weaver"],["write","writer"],["sing","singer"],["dance","dancer"],["speak","speaker"],["rule","ruler"],["trade","trader"],["bake","baker"],["heal","healer"],["swim","swimmer"],["climb","climber"],["dream","dreamer"],["work","worker"],["paint","painter"],["explore","explorer"],["guard","guardian"],["sail","sailor"],["cook","cook"],["drive","driver"],["brew","brewer"],["spy","spy"]]},
// V→N instrument: "thing used to V"
{from:"V",to:"N",role:"instrument",pairs:[["cut","blade"],["dig","shovel"],["grind","mill"],["plow","plow"],["hammer","hammer"],["lock","key"],["light","lamp"],["shelter","shelter"],["trap","trap"],["brew","brewery"]]},
// V→N place: "place where one Vs"  
{from:"V",to:"N",role:"place",pairs:[["trade","market"],["pray","temple"],["sleep","bedroom"],["cook","kitchen"],["forge","smithy"],["brew","brewery"],["study","school"],["govern","court"],["imprison","prison"],["bury","grave"]]},
// ADJ→N abstract: "state of being ADJ"
{from:"ADJ",to:"N",role:"abstract",pairs:[["dark","darkness"],["bright","brightness"],["kind","kindness"],["cruel","cruelty"],["wise","wisdom"],["foolish","folly"],["weak","weakness"],["strong","strength"],["brave","bravery"],["free","freedom"],["happy","happiness"],["sad","sadness"],["holy","holiness"],["good","goodness"],["beautiful","beauty"],["proud","pride"],["lonely","loneliness"],["safe","safety"],["deep","depth"],["wide","width"],["long","length"],["high","height"],["warm","warmth"],["cold","coldness"],["true","truth"],["just","justice"],["calm","peace"]]},
// N→ADJ: "having quality of N"
{from:"N",to:"ADJ",role:"adjective",pairs:[["king","royal"],["god","divine"],["ghost","ghostly"],["blood","bloody"],["storm","stormy"],["stone","stony"],["ice","icy"],["gold","golden"],["silver","silvery"],["water","watery"],["fire","fiery"],["night","nocturnal"],["earth","earthen"],["heaven","heavenly"],["war","warlike"],["death","deadly"],["poison","poisonous"],["mountain","mountainous"],["forest","sylvan"]]},
// N→N domain/collective: "realm/domain of N"
{from:"N",to:"N",role:"place",pairs:[["king","kingdom"],["lord","domain"],["friend","fellowship"],["child","childhood"],["brother","brotherhood"],["slave","slavery"],["priest","priesthood"],["citizen","citizenship"],["noble","nobility"],["knight","order"]]},
];

for(const rule of DERIV_RULES){
for(const[baseMeaning,derivedMeaning] of rule.pairs){
const baseItem=lexicon[rule.from].find(x=>x.meaning===baseMeaning);
if(baseItem&&!used[rule.to].has(derivedMeaning)){
const d=deriveWord(baseItem.ipa,rule.role);
lexicon[rule.to].push({meaning:derivedMeaning,ipa:d.ipa,derived:{from:baseMeaning,type:rule.role,base:baseItem.ipa,strategy:derivStrategy,desc:d.desc}});
used[rule.to].add(derivedMeaning);
}
}
}

const name=genWd(vows,cons,coda&&Math.random()<0.3,false,pick([2,3]));

// Voice parameters — fixed per language
const vp = F.voice;
const voiceParams = {
pitch: vp.pitch[0] + Math.random() * (vp.pitch[1] - vp.pitch[0]),
Rd: vp.Rd[0] + Math.random() * (vp.Rd[1] - vp.Rd[0]),
rhythm: vp.rhythm,
tempo: vp.tempo * (0.9 + Math.random() * 0.2),
pitchRange: vp.pitchRange,
reduction: vp.reduction,
};

return{name:name.charAt(0).toUpperCase()+name.slice(1),weights:w,vowels:vows,consonants:cons,allowCoda:coda,wordOrder,cases,pluralSuffix,pronouns,agreeType,agreeParadigm,tenses,hasAspect,aspects,nClasses,nClassCount,assignNounClass,adjBefore,hasDet,detWord,negType,negWord,negPrefix,possSuffix,qParticle,qPosition,copula,relStrategy,relativizer,adpType,adpositions,derivAffixes,derivStrategy,templates,lexicon,style:fk,voiceParams};
}

// ═══════════════════════════════════════════════════════════════════════════════
// MORPHOLOGY + SENTENCE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

function inflN(L,n,cas,pl){
let u=n.ipa;
// Noun class marker
if(L.nClassCount>0){
const ci=L.assignNounClass(n.meaning);
if(ci!==null&&L.nClasses[ci])u+=L.nClasses[ci].marker;
}
if(pl)u+=L.pluralSuffix;
if(L.cases&&cas&&L.cases[cas])u+=L.cases[cas];
return u;
}

// Verb inflection: stem + aspect + tense + person/number agreement
function inflV(L,v,tense,person,aspect){
let u=v.ipa;
// Aspect (before tense)
if(L.hasAspect&&L.aspects&&aspect&&L.aspects[aspect])u+=L.aspects[aspect];
if(tense&&L.tenses[tense])u+=L.tenses[tense];
if(L.agreeType!=="none"&&person&&L.agreeParadigm[person])u+=L.agreeParadigm[person];
return u;
}

// Adjective with class agreement
function inflAdj(L,adj,nounMeaning){
let u=adj.ipa;
if(L.nClassCount>0){
const ci=L.assignNounClass(nounMeaning);
if(ci!==null&&L.nClasses[ci])u+=L.nClasses[ci].adjAgree;
}
return u;
}

// Get class-specific pronoun or determiner
function classPronoun(L,nounMeaning){
if(L.nClassCount>0){
const ci=L.assignNounClass(nounMeaning);
if(ci!==null&&L.nClasses[ci]&&L.nClasses[ci].pronoun)return L.nClasses[ci].pronoun;
}
return L.pronouns["3sg"];
}

function classDet(L,nounMeaning){
if(L.nClassCount>0){
const ci=L.assignNounClass(nounMeaning);
if(ci!==null&&L.nClasses[ci]&&L.nClasses[ci].detForm)return L.nClasses[ci].detForm;
}
return L.detWord;
}

// Build a relative clause: "the man who killed the wolf"
function buildRelClause(L,headNoun,verb,objNoun,w){
const relW=buildWord(L.relativizer,w);
const vUF=inflV(L,verb,"PST","3sg","PFV");
const vW=buildWord(vUF,w);
const oUF=inflN(L,objNoun,L.cases?"ACC":null,false);
const oW=buildWord(oUF,w);
const hUF=inflN(L,headNoun,null,false);
const hW=buildWord(hUF,w);

const relPart={sf:relW.sf.replace(/./g,""),role:"rel",gloss:"REL"};
const verbPart={sf:vW.sf.replace(/./g,""),role:"verb",gloss:verb.meaning+".PST"};
const objPart={sf:oW.sf.replace(/./g,""),role:"noun",gloss:objNoun.meaning};
const headPart={sf:hW.sf.replace(/./g,""),role:"noun",gloss:headNoun.meaning};

let words;
if(L.relStrategy==="prenominal"){
// [obj V REL] head — "wolf killed REL man"
words=[objPart,verbPart,relPart,headPart];
} else {
// head [REL V obj] — "man REL killed wolf"
words=[headPart,relPart,verbPart,objPart];
}
const morphs=[
{label:headNoun.meaning,uf:hUF,sf:hW.sf,stem:headNoun.ipa,affixes:hUF.slice(headNoun.ipa.length),alts:hW.alts},
{label:verb.meaning,uf:vUF,sf:vW.sf,stem:verb.ipa,affixes:vUF.slice(verb.ipa.length),alts:vW.alts},
{label:objNoun.meaning,uf:oUF,sf:oW.sf,stem:objNoun.ipa,affixes:oUF.slice(objNoun.ipa.length),alts:oW.alts},
];
return{words,morphs,english:`the ${headNoun.meaning} who ${IRREG_PAST[verb.meaning]||verb.meaning+"ed"} the ${objNoun.meaning}`};
}

function negateV(L,vUF){return L.negType==="prefix"?(L.negPrefix+vUF):vUF;}
function possN(L,n,cas){let u=n.ipa+L.possSuffix;if(L.cases&&cas&&L.cases[cas])u+=L.cases[cas];return u;}

// Build adpositional phrase
function buildPP(L,adp,noun,w){
const adpIPA=L.adpositions[adp]||L.adpositions["in"];
const nUF=inflN(L,noun,L.cases?"DAT":null,false);
const nW=buildWord(nUF,w);
const adpW=buildWord(adpIPA,w);
if(L.adpType==="post"){
// Postposition: noun + adp
return{
words:[
{sf:nW.sf.replace(/./g,""),role:"noun",gloss:noun.meaning,alts:nW.alts},
{sf:adpW.sf.replace(/./g,""),role:"adp",gloss:adp,alts:adpW.alts}
],
english:`${adp} the ${noun.meaning}`,
morphs:[{label:noun.meaning,uf:nUF,sf:nW.sf,stem:noun.ipa,affixes:nUF.slice(noun.ipa.length),alts:nW.alts}]
};
} else {
// Preposition: adp + noun
return{
words:[
{sf:adpW.sf.replace(/./g,""),role:"adp",gloss:adp,alts:adpW.alts},
{sf:nW.sf.replace(/./g,""),role:"noun",gloss:noun.meaning,alts:nW.alts}
],
english:`${adp} the ${noun.meaning}`,
morphs:[{label:noun.meaning,uf:nUF,sf:nW.sf,stem:noun.ipa,affixes:nUF.slice(noun.ipa.length),alts:nW.alts}]
};
}
}

// English pronoun mapping
const EN_PRON={"1sg":"I","2sg":"you","3sg":"he","1pl":"we","2pl":"you","3pl":"they"};
const EN_PRON_OBJ={"1sg":"me","2sg":"you","3sg":"him","1pl":"us","2pl":"you","3pl":"them"};
const EN_PRON_POSS={"1sg":"my","2sg":"your","3sg":"his","1pl":"our","2pl":"your","3pl":"their"};

function findAlternations(uf,sf,w){
const ufSegs=parseIPA(uf);
if(!ufSegs.length)return[];
const tableau=evalUF(ufSegs,w);
if(!tableau.length)return[];
const winner=tableau[0];
const ufIPA=uf;const sfIPA=sf.replace(/./g,"");
if(ufIPA===sfIPA)return[];
const faithful=tableau.find(c=>c.ipa.replace(/./g,"")===ufIPA);
if(!faithful)return[{type:"changed",from:ufIPA,to:sfIPA,reason:"phonological optimization"}];
const alts=[];
CON.forEach(c=>{
const wV=winner.vi[c.name]||0;const fV=faithful.vi[c.name]||0;
if(fV>wV&&c.type==="M")alts.push({constraint:c.name,saved:fV-wV});
});
const drivers=alts.filter(a=>a.saved).sort((a,b)=>b.saved-a.saved).slice(0,2);
const reason=drivers.length?drivers.map(d=>`${d.constraint}`).join(", "):"constraint interaction";
return[{type:"changed",from:ufIPA,to:sfIPA,reason}];
}

function buildWord(uf,w){const sf=qe(uf,w);return{uf,sf,alts:findAlternations(uf,sf,w)};}

const SENT_TYPES=["transitive","transitive","intransitive","copular","possession","negated","question","pp-trans","pp-intrans","pronoun-trans","relative"];
const PP_ADPS=["in","on","to","from","with","near","under"];
const PLACE_NOUNS=["forest","mountain","river","house","cave","city","village","temple","field","sea","lake","desert","garden","tower","market","road","bridge"];

function generateSentence(L,w){
const type=pick(SENT_TYPES);
const tense=pick(["PRS","PST","FUT"]);
const aspect=L.hasAspect?pick(["PFV","IPFV"]):null;
const useDet=L.hasDet&&Math.random()<.5;
const useAdj=Math.random()<.3;
const usePronoun=type==="pronoun-trans"||Math.random()<0.3;
const person=pick(["1sg","2sg","3sg","1pl","3pl"]);
const sp=person.endsWith("pl");
const subj=pick(L.lexicon.N);
const adj=useAdj?pick(L.lexicon.ADJ):null;
let words=[], english="", morphBreakdown=[];

const buildSubj=(cas)=>{
if(usePronoun){
const proIPA=L.pronouns[person];let proUF=proIPA;
if(L.cases&&cas&&L.cases[cas])proUF+=L.cases[cas];
const proW=buildWord(proUF,w);
morphBreakdown.push({label:EN_PRON[person],uf:proUF,sf:proW.sf,stem:proIPA,affixes:proUF.slice(proIPA.length),alts:proW.alts});
return[{sf:proW.sf.replace(/./g,""),role:"pron",gloss:person,alts:proW.alts}];
}
const np=[];
if(useDet&&L.hasDet){const di=classDet(L,subj.meaning);if(di){const dW=buildWord(di,w);np.push({sf:dW.sf.replace(/./g,""),role:"det",gloss:"the"});}}
const nUF=inflN(L,subj,cas,sp);const nW=buildWord(nUF,w);
if(adj){
const aUF=inflAdj(L,adj,subj.meaning);const aW=buildWord(aUF,w);
if(L.adjBefore)np.push({sf:aW.sf.replace(/./g,""),role:"adj",gloss:adj.meaning+(L.nClassCount?".CL":""),alts:aW.alts});
np.push({sf:nW.sf.replace(/./g,""),role:"noun",gloss:subj.meaning+(sp?".PL":"")+(cas?"."+cas:""),alts:nW.alts});
if(!L.adjBefore)np.push({sf:aW.sf.replace(/./g,""),role:"adj",gloss:adj.meaning+(L.nClassCount?".CL":""),alts:aW.alts});
morphBreakdown.push({label:adj.meaning,uf:aUF,sf:aW.sf,stem:adj.ipa,affixes:aUF.slice(adj.ipa.length),alts:aW.alts});
} else np.push({sf:nW.sf.replace(/./g,""),role:"noun",gloss:subj.meaning+(sp?".PL":"")+(cas?"."+cas:""),alts:nW.alts});
morphBreakdown.push({label:subj.meaning,uf:nUF,sf:nW.sf,stem:subj.ipa,affixes:nUF.slice(subj.ipa.length),alts:nW.alts});
return np;
};
const buildObj=(noun,cas)=>{const nUF=inflN(L,noun,cas,false);const nW=buildWord(nUF,w);morphBreakdown.push({label:noun.meaning,uf:nUF,sf:nW.sf,stem:noun.ipa,affixes:nUF.slice(noun.ipa.length),alts:nW.alts});return[{sf:nW.sf.replace(/./g,""),role:"noun",gloss:noun.meaning+(cas?"."+cas:""),alts:nW.alts}];};
const buildVerb=(verb)=>{const vUF=inflV(L,verb,tense,person,aspect);const vW=buildWord(vUF,w);const ag=aspect?"."+aspect:"";morphBreakdown.push({label:verb.meaning,uf:vUF,sf:vW.sf,stem:verb.ipa,affixes:vUF.slice(verb.ipa.length),alts:vW.alts});return{sf:vW.sf.replace(/./g,""),role:"verb",gloss:verb.meaning+"."+tense+ag+(L.agreeType!=="none"?"."+person:""),alts:vW.alts};};
const subjEn=usePronoun?EN_PRON[person]:(useDet?"the ":"")+(adj?adj.meaning+" ":"")+(sp?subj.meaning+"s":subj.meaning);
const aspEn=aspect==="IPFV"?" (ongoing)":"";
const verbEn=(verb,t)=>t==="FUT"?"will "+verb.meaning:t==="PST"?(IRREG_PAST[verb.meaning]||verb.meaning+"ed"):(person==="3sg"?(verb.meaning.endsWith("s")?verb.meaning+"es":verb.meaning+"s"):verb.meaning);
const order=(sNP,vW,oNP,pp)=>{const ppW=pp?pp.words:[];if(L.wordOrder==="SVO")return[...sNP,vW,...oNP,...ppW];if(L.wordOrder==="SOV")return[...sNP,...oNP,...ppW,vW];return[vW,...sNP,...oNP,...ppW];};

if(type==="transitive"||type==="pronoun-trans"){
const verb=pick(L.lexicon.V);const obj=pick(L.lexicon.N.filter(n=>n!==subj))||pick(L.lexicon.N);
const sNP=buildSubj(L.cases?"NOM":null);const vW=buildVerb(verb);const oNP=buildObj(obj,L.cases?"ACC":null);
words=order(sNP,vW,oNP);english=`${subjEn} ${verbEn(verb,tense)} ${obj.meaning}${aspEn}.`;
} else if(type==="intransitive"){
const verb=pick(L.lexicon.V);const sNP=buildSubj(L.cases?"NOM":null);const vW=buildVerb(verb);
words=L.wordOrder==="VSO"?[vW,...sNP]:[...sNP,vW];english=`${subjEn} ${verbEn(verb,tense)}${aspEn}.`;
} else if(type==="copular"){
const predAdj=pick(L.lexicon.ADJ);const sNP=buildSubj(L.cases?"NOM":null);
const copUF=inflV(L,{ipa:L.copula,meaning:"be"},tense,person,aspect);const copW=buildWord(copUF,w);
morphBreakdown.push({label:"be",uf:copUF,sf:copW.sf,stem:L.copula,affixes:copUF.slice(L.copula.length),alts:copW.alts});
const predW=buildWord(predAdj.ipa,w);
words=[...sNP,{sf:copW.sf.replace(/./g,""),role:"verb",gloss:"be."+tense},{sf:predW.sf.replace(/./g,""),role:"adj",gloss:predAdj.meaning}];
const beEn=tense==="FUT"?"will be":tense==="PST"?(sp?"were":"was"):(person==="1sg"?"am":sp?"are":"is");
english=`${subjEn} ${beEn} ${predAdj.meaning}.`;
} else if(type==="possession"){
const possessed=pick(L.lexicon.N.filter(n=>n!==subj))||pick(L.lexicon.N);
const pUF=possN(L,subj,L.cases?"NOM":null);const pW=buildWord(pUF,w);
const dUF=inflN(L,possessed,L.cases?"ACC":null,false);const dW=buildWord(dUF,w);
morphBreakdown.push({label:subj.meaning+".POSS",uf:pUF,sf:pW.sf,stem:subj.ipa,affixes:pUF.slice(subj.ipa.length),alts:pW.alts});
morphBreakdown.push({label:possessed.meaning,uf:dUF,sf:dW.sf,stem:possessed.ipa,affixes:dUF.slice(possessed.ipa.length),alts:dW.alts});
words=[{sf:pW.sf.replace(/./g,""),role:"noun",gloss:subj.meaning+".POSS"},{sf:dW.sf.replace(/./g,""),role:"noun",gloss:possessed.meaning}];
english=`${subj.meaning}'s ${possessed.meaning}`;
} else if(type==="negated"){
const verb=pick(L.lexicon.V);const obj=pick(L.lexicon.N.filter(n=>n!==subj))||pick(L.lexicon.N);
let vUF=inflV(L,verb,tense,person,aspect);vUF=negateV(L,vUF);const vW=buildWord(vUF,w);
const sNP=buildSubj(L.cases?"NOM":null);
morphBreakdown.push({label:"NEG."+verb.meaning,uf:vUF,sf:vW.sf,stem:verb.ipa,affixes:vUF.slice(verb.ipa.length),alts:vW.alts});
const oNP=buildObj(obj,L.cases?"ACC":null);
const verbWord={sf:vW.sf.replace(/./g,""),role:"verb",gloss:"NEG."+verb.meaning+"."+tense};
if(L.negType==="particle"){const negW=buildWord(L.negWord,w);const negPart={sf:negW.sf.replace(/./g,""),role:"neg",gloss:"NEG"};words=L.wordOrder==="SVO"?[...sNP,negPart,verbWord,...oNP]:L.wordOrder==="SOV"?[...sNP,...oNP,negPart,verbWord]:[negPart,verbWord,...sNP,...oNP];}
else words=order(sNP,verbWord,oNP);
english=`${subjEn} does not ${verb.meaning} ${obj.meaning}.`;
} else if(type==="question"){
const verb=pick(L.lexicon.V);const obj=pick(L.lexicon.N.filter(n=>n!==subj))||pick(L.lexicon.N);
const sNP=buildSubj(L.cases?"NOM":null);const vW=buildVerb(verb);const oNP=buildObj(obj,L.cases?"ACC":null);
const qW=buildWord(L.qParticle,w);const qPart={sf:qW.sf.replace(/./g,""),role:"q",gloss:"Q"};
const core=order(sNP,vW,oNP);words=L.qPosition==="initial"?[qPart,...core]:[...core,qPart];
english=`Does ${subjEn.toLowerCase()} ${verb.meaning} ${obj.meaning}?`;
} else if(type==="pp-trans"||type==="pp-intrans"){
const verb=pick(L.lexicon.V);const adp=pick(PP_ADPS);
const placeNoun=L.lexicon.N.find(n=>PLACE_NOUNS.includes(n.meaning))||pick(L.lexicon.N);
const pp=buildPP(L,adp,placeNoun,w);morphBreakdown.push(...pp.morphs);
const sNP=buildSubj(L.cases?"NOM":null);const vW=buildVerb(verb);
if(type==="pp-trans"){const obj=pick(L.lexicon.N.filter(n=>n!==subj&&n!==placeNoun))||pick(L.lexicon.N);const oNP=buildObj(obj,L.cases?"ACC":null);words=order(sNP,vW,oNP,pp);english=`${subjEn} ${verbEn(verb,tense)} ${obj.meaning} ${pp.english}${aspEn}.`;}
else{const ppW=pp.words;words=L.wordOrder==="VSO"?[vW,...sNP,...ppW]:L.wordOrder==="SOV"?[...sNP,...ppW,vW]:[...sNP,vW,...ppW];english=`${subjEn} ${verbEn(verb,tense)} ${pp.english}${aspEn}.`;}
} else if(type==="relative"){
// "The [man who killed the wolf] saw the bird"
const relVerb=pick(L.lexicon.V);const relObj=pick(L.lexicon.N.filter(n=>n!==subj))||pick(L.lexicon.N);
const rel=buildRelClause(L,subj,relVerb,relObj,w);
morphBreakdown.push(...rel.morphs);
const mainVerb=pick(L.lexicon.V);const mainObj=pick(L.lexicon.N.filter(n=>n!==subj&&n!==relObj))||pick(L.lexicon.N);
const vW=buildVerb(mainVerb);const oNP=buildObj(mainObj,L.cases?"ACC":null);
// Subject is the relative clause NP
if(L.wordOrder==="SVO")words=[...rel.words,vW,...oNP];
else if(L.wordOrder==="SOV")words=[...rel.words,...oNP,vW];
else words=[vW,...rel.words,...oNP];
english=`${rel.english} ${verbEn(mainVerb,tense)} ${mainObj.meaning}${aspEn}.`;
english=english.charAt(0).toUpperCase()+english.slice(1);
}

english=(english||"").charAt(0).toUpperCase()+english.slice(1);
return{words,type,surfaceLine:words.map(x=>x.sf).join(" "),romanLine:words.map(x=>romanize(x.sf)).join(" "),english,glossLine:words.map(x=>x.gloss).join(" "),morphBreakdown,hasAlternations:morphBreakdown.some(m=>m.alts&&m.alts.length>0)};
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGLISH → CONLANG TRANSLATOR
// ═══════════════════════════════════════════════════════════════════════════════
const ARTICLES=new Set(["the","a","an","this","that","these","those"]);
const EN_TO_PERSON={"i":"1sg","me":"1sg","my":"1sg","you":"2sg","your":"2sg","he":"3sg","him":"3sg","his":"3sg","she":"3sg","her":"3sg","it":"3sg","its":"3sg","we":"1pl","us":"1pl","our":"1pl","they":"3pl","them":"3pl","their":"3pl"};
const SKIP_WORDS=new Set(["the","a","an","this","that","these","those","is","are","am","was","were","be","do","does","did","not","very","really","also","just","then","so","but","and","or","if","when","while","because","of","about"]);
const EN_ADPOSITIONS=new Set(["in","on","to","from","with","for","near","under","over","between","at","by","into","onto","through","across","along","around","behind","beside","beneath","above","below","against","among","within","without","upon","toward","towards"]);
const BE_FORMS=new Set(["is","are","am","was","were","be"]);
const PLURAL_MAP={"children":"child","women":"woman","men":"man","fish":"fish","deer":"deer","wolves":"wolf","knives":"knife","leaves":"leaf","mice":"mouse","geese":"goose","teeth":"tooth","feet":"foot","foxes":"fox","horses":"horse","snakes":"snake","bears":"bear","lambs":"lamb","birds":"bird","stars":"star","trees":"tree","eyes":"eye","bones":"bone","seeds":"seed","paths":"path","houses":"house","rivers":"river","mountains":"mountain","stones":"stone","hands":"hand","dogs":"dog","cats":"cat","rats":"rat","goats":"goat","cows":"cow","pigs":"pig","lions":"lion","eagles":"eagle","owls":"owl","frogs":"frog","ants":"ant","bees":"bee","roots":"root","flowers":"flower","grains":"grain","hearts":"heart","heads":"head","arms":"arm","legs":"leg","swords":"sword","shields":"shield","boats":"boat","ropes":"rope","wheels":"wheel","doors":"door","walls":"wall","roofs":"roof","floors":"floor","beds":"bed","chairs":"chair","tables":"table","cups":"cup","pots":"pot","baskets":"basket","cloths":"cloth","threads":"thread","needles":"needle","rings":"ring","drums":"drum","flutes":"flute","songs":"song","words":"word","names":"name","voices":"voice","dreams":"dream","deaths":"death","lives":"life","wars":"war","kings":"king","queens":"queen","friends":"friend","enemies":"enemy","mothers":"mother","fathers":"father","brothers":"brother","sisters":"sister","babies":"baby","villages":"village","cities":"city","islands":"island","seas":"sea","lakes":"lake","forests":"forest","deserts":"desert","caves":"cave","bridges":"bridge","roads":"road","gates":"gate","towers":"tower","fields":"field","gardens":"garden","shadows":"shadow","lights":"light","nights":"night","days":"day","dawns":"dawn","storms":"storm","flames":"flame","waves":"wave","clouds":"cloud","eggs":"egg","arrows":"arrow","spears":"spear","bows":"bow","axes":"axe","hammers":"hammer","bells":"bell","flags":"flag","maps":"map","books":"book","stories":"story","laws":"law","gods":"god","ghosts":"ghost","spirits":"spirit","souls":"soul","gifts":"gift","trades":"trade","works":"work","feasts":"feast","fights":"fight","prayers":"prayer","curses":"curse","blessings":"blessing","colors":"color","shapes":"shape","sounds":"sound","smells":"smell","tastes":"taste","times":"time","places":"place","things":"thing","ways":"way","ends":"end","homes":"home","secrets":"secret"};

function depluralize(w){
if(PLURAL_MAP[w])return{base:PLURAL_MAP[w],pl:true};
if(w.endsWith("ies"))return{base:w.slice(0,-3)+"y",pl:true};
if(w.endsWith("ves"))return{base:w.slice(0,-3)+"fe",pl:true};
if(w.endsWith("es"))return{base:w.slice(0,-2),pl:true};
if(w.endsWith("s")&&!w.endsWith("ss"))return{base:w.slice(0,-1),pl:true};
return{base:w,pl:false};
}

const PAST_TO_BASE={"saw":"see","ate":"eat","ran":"run","gave":"give","took":"take","slept":"sleep",
"sang":"sing","made":"make","fell":"fall","grew":"grow","flew":"fly","swam":"swim",
"broke":"break","held":"hold","threw":"throw","burnt":"burn","drank":"drink","knew":"know",
"cut":"cut","found":"find","dug":"dig","hid":"hide","pulled":"pull","pushed":"push",
"called":"call","hunted":"hunt","walked":"walk","sat":"sit","stood":"stand","lay":"lie",
"jumped":"jump","climbed":"climb","crawled":"crawl","danced":"dance","fought":"fight",
"killed":"kill","died":"die","lived":"live","breathed":"breathe","spoke":"speak","heard":"hear",
"smelled":"smell","tasted":"taste","touched":"touch","felt":"feel","thought":"think",
"dreamed":"dream","dreamt":"dream","remembered":"remember","forgot":"forget","learned":"learn",
"taught":"teach","read":"read","wrote":"write","counted":"count","built":"build",
"planted":"plant","cooked":"cook","washed":"wash","cleaned":"clean","dried":"dry",
"filled":"fill","poured":"pour","mixed":"mix","tied":"tie","wrapped":"wrap","opened":"open",
"closed":"close","turned":"turn","bent":"bend","folded":"fold","tore":"tear","crushed":"crush",
"ground":"grind","carved":"carve","wove":"weave","sewed":"sew","painted":"paint","drew":"draw",
"played":"play","worked":"work","rested":"rest","waited":"wait","watched":"watch",
"followed":"follow","led":"lead","carried":"carry","dropped":"drop","picked":"pick",
"chose":"choose","tried":"try","wanted":"want","needed":"need","loved":"love","hated":"hate",
"feared":"fear","hoped":"hope","wished":"wish","asked":"ask","told":"tell","showed":"show",
"helped":"help","saved":"save","lost":"lose","won":"win","traded":"trade","stole":"steal",
"shared":"share","joined":"join","left":"leave","returned":"return","arrived":"arrive",
"began":"begin","ended":"end","finished":"finish","changed":"change","moved":"move",
"stopped":"stop","started":"start","sent":"send","brought":"bring","kept":"keep",
"put":"put","set":"set","hung":"hang","lit":"light","blew":"blow","shook":"shake",
"struck":"strike","bit":"bite","kicked":"kick","scratched":"scratch","hit":"hit",
"caught":"catch","chased":"chase","escaped":"escape","crossed":"cross","entered":"enter",
"reached":"reach","passed":"pass"};

function parseVerb(w){
if(PAST_TO_BASE[w])return{base:PAST_TO_BASE[w],tense:"PST"};
if(w.endsWith("ed")){
if(w.endsWith("ied"))return{base:w.slice(0,-3)+"y",tense:"PST"};
const b1=w.slice(0,-2);const b2=w.slice(0,-1);// "called"→"call", "made"→handled above
return{base:b1.endsWith("e")?b1:b2.endsWith("e")?b2:b1,tense:"PST"};
}
if(w.endsWith("ing")){const b=w.slice(0,-3);return{base:b.endsWith("e")?b:b,tense:"PRS"};}
if(w.endsWith("es")&&!w.endsWith("ses"))return{base:w.slice(0,-2),tense:"PRS"};
if(w.endsWith("s")&&!w.endsWith("ss"))return{base:w.slice(0,-1),tense:"PRS"};
return{base:w,tense:"PRS"};
}

function findInLex(lex,cat,meaning){
let item=lex[cat].find(x=>x.meaning===meaning);
if(item)return item;
return null;
}
// Search all categories as fallback
function findAnyLex(lex,meaning){
for(const c of["N","V","ADJ"]){const item=lex[c].find(x=>x.meaning===meaning);if(item)return item;}
return null;
}

function translateEnglish(input,L,w){
const raw=input.toLowerCase().replace(/[.!?,;:'"]/g,"").trim();
if(!raw)return null;
let tokens=raw.split(/\s+/);

// Detect tense from auxiliaries
let tense="PRS";
const willIdx=tokens.indexOf("will");
if(willIdx>=0){tense="FUT";tokens.splice(willIdx,1);}
if(tokens.includes("did")){tense="PST";tokens=tokens.filter(t=>t!=="did");}
tokens=tokens.filter(t=>t!=="not"&&t!=="does"&&t!=="do");

// Detect hasDet and strip articles
let hasDet=false;
tokens=tokens.filter(t=>{if(ARTICLES.has(t)){hasDet=true;return false;}return true;});

// Find adpositions in the input and extract PP
let ppAdp=null,ppTokens=[];
for(let i=0;i<tokens.length;i++){
const mapped=tokens[i]==="at"?"in":tokens[i]==="by"?"near":tokens[i]==="into"?"in":tokens[i]==="onto"?"on":tokens[i]==="through"?"in":tokens[i]==="across"?"over":tokens[i]==="toward"||tokens[i]==="towards"?"to":tokens[i];
if(EN_ADPOSITIONS.has(tokens[i])&&L.adpositions[mapped]){
ppAdp=mapped;
ppTokens=tokens.slice(i+1).filter(t=>!ARTICLES.has(t));
tokens=tokens.slice(0,i);
break;
}
}

// Find the verb
let verbIdx=-1,verbBase="",verbTense=tense;
for(let i=0;i<tokens.length;i++){
if(SKIP_WORDS.has(tokens[i])||EN_TO_PERSON[tokens[i]])continue;
const pv=parseVerb(tokens[i]);
if(findInLex(L.lexicon,"V",pv.base)){verbIdx=i;verbBase=pv.base;if(tense==="PRS")verbTense=pv.tense;break;}
if(findInLex(L.lexicon,"V",tokens[i])){verbIdx=i;verbBase=tokens[i];break;}
}

// Parse a token list into an NP, handling pronouns properly
const parseNP=(toks,cas)=>{
let adj=null,noun=null,pl=false,person=null;
for(const t of toks){
if(SKIP_WORDS.has(t))continue;
// Check if it's a pronoun
if(EN_TO_PERSON[t]){
person=EN_TO_PERSON[t];
pl=person.endsWith("pl");
continue;
}
// Check adjective
const adjItem=findInLex(L.lexicon,"ADJ",t);
if(adjItem){adj=adjItem;continue;}
// Check noun (possibly plural)
const dp=depluralize(t);
const nItem=findInLex(L.lexicon,"N",dp.base)||findInLex(L.lexicon,"N",t);
if(nItem){noun=nItem;pl=dp.pl;continue;}
}
// Build the conlang form
if(person&&L.pronouns[person]){
// Use the language's pronoun
let proUF=L.pronouns[person];
if(L.cases&&cas&&L.cases[cas])proUF+=L.cases[cas];
const sf=qe(proUF,w);
return{noun:null,adj,pl,uf:proUF,sf,cas,person,isPronoun:true,proIPA:L.pronouns[person]};
}
if(!noun&&toks.length){
// Last resort: find anything
for(const t of toks){
if(SKIP_WORDS.has(t)||EN_TO_PERSON[t])continue;
const dp=depluralize(t);
noun=findInLex(L.lexicon,"N",dp.base)||findAnyLex(L.lexicon,dp.base)||findAnyLex(L.lexicon,t);
if(noun)break;
}
}
let uf=noun?noun.ipa:"";
if(pl&&uf)uf+=L.pluralSuffix;
if(L.cases&&cas&&L.cases[cas]&&uf)uf+=L.cases[cas];
const sf=uf?qe(uf,w):"";
return{noun,adj,pl,uf,sf,cas,person:pl?"3pl":"3sg",isPronoun:false};
};

// Word-by-word fallback if no verb found
if(verbIdx<0){
const results=tokens.filter(t=>!SKIP_WORDS.has(t)).map(t=>{
if(EN_TO_PERSON[t]){const p=EN_TO_PERSON[t];const sf=qe(L.pronouns[p]||"",w);return{sf:sf.replace(/./g,""),role:"pron",gloss:p,found:!!L.pronouns[p]};}
const dp=depluralize(t);
const item=findInLex(L.lexicon,"N",dp.base)||findInLex(L.lexicon,"V",t)||findInLex(L.lexicon,"ADJ",t)||findAnyLex(L.lexicon,dp.base)||findAnyLex(L.lexicon,t);
if(item){const sf=qe(item.ipa,w);return{sf:sf.replace(/./g,""),role:"noun",gloss:item.meaning,found:true};}
return{sf:"?",role:"?",gloss:t,found:false};
});
return{words:results,surfaceLine:results.map(r=>r.sf).join(" "),romanLine:results.map(r=>romanize(r.sf)).join(" "),glossLine:results.map(r=>r.gloss).join(" "),partial:true,morphBreakdown:[]};
}

const subjTokens=tokens.slice(0,verbIdx);
const objTokens=tokens.slice(verbIdx+1);

const subjNP=parseNP(subjTokens,"NOM");
const objNP=parseNP(objTokens,"ACC");

// Verb with person agreement
const verbItem=findInLex(L.lexicon,"V",verbBase);
let vUF=verbItem?verbItem.ipa:"";
if(verbTense&&L.tenses[verbTense])vUF+=L.tenses[verbTense];
const person=subjNP.person||"3sg";
if(L.agreeType!=="none"&&L.agreeParadigm[person])vUF+=L.agreeParadigm[person];
const vSF=qe(vUF,w);

const morphBreakdown=[];

// Build subject words
let sNPwords=[];
if(subjNP.isPronoun){
sNPwords.push({sf:subjNP.sf.replace(/./g,""),role:"pron",gloss:subjNP.person});
morphBreakdown.push({label:subjNP.person,uf:subjNP.uf,sf:subjNP.sf,stem:subjNP.proIPA,affixes:subjNP.uf.slice(subjNP.proIPA.length)});
} else {
const detSF=hasDet&&L.hasDet?qe(L.detWord,w):null;
if(detSF)sNPwords.push({sf:detSF.replace(/./g,""),role:"det",gloss:"the"});
if(subjNP.adj){
const aSF=qe(subjNP.adj.ipa,w);
if(L.adjBefore)sNPwords.push({sf:aSF.replace(/./g,""),role:"adj",gloss:subjNP.adj.meaning});
if(subjNP.sf)sNPwords.push({sf:subjNP.sf.replace(/./g,""),role:"noun",gloss:(subjNP.noun?.meaning||"?")+(subjNP.pl?".PL":"")});
if(!L.adjBefore)sNPwords.push({sf:aSF.replace(/./g,""),role:"adj",gloss:subjNP.adj.meaning});
} else if(subjNP.sf){
sNPwords.push({sf:subjNP.sf.replace(/./g,""),role:"noun",gloss:(subjNP.noun?.meaning||"?")+(subjNP.pl?".PL":"")});
}
if(subjNP.noun)morphBreakdown.push({label:subjNP.noun.meaning,uf:subjNP.uf,sf:subjNP.sf,stem:subjNP.noun.ipa,affixes:subjNP.uf.slice(subjNP.noun.ipa.length)});
}

// Verb word
const verbWord={sf:vSF.replace(/./g,""),role:"verb",gloss:(verbItem?.meaning||"?")+"."+verbTense+(L.agreeType!=="none"?"."+person:"")};
if(verbItem)morphBreakdown.push({label:verbItem.meaning,uf:vUF,sf:vSF,stem:verbItem.ipa,affixes:vUF.slice(verbItem.ipa.length)});

// Object words
let oNPwords=[];
if(objNP.sf){
oNPwords.push({sf:objNP.sf.replace(/./g,""),role:"noun",gloss:(objNP.noun?.meaning||"?")+(objNP.pl?".PL":"")});
if(objNP.noun)morphBreakdown.push({label:objNP.noun.meaning,uf:objNP.uf,sf:objNP.sf,stem:objNP.noun.ipa,affixes:objNP.uf.slice(objNP.noun.ipa.length)});
}

// PP if found
let ppWords=[];
if(ppAdp&&ppTokens.length){
const ppNP=parseNP(ppTokens,"DAT");
const adpIPA=L.adpositions[ppAdp];
const adpSF=qe(adpIPA,w);
if(ppNP.sf){
if(L.adpType==="post"){
ppWords=[{sf:ppNP.sf.replace(/./g,""),role:"noun",gloss:ppNP.noun?.meaning||"?"},{sf:adpSF.replace(/./g,""),role:"adp",gloss:ppAdp}];
} else {
ppWords=[{sf:adpSF.replace(/./g,""),role:"adp",gloss:ppAdp},{sf:ppNP.sf.replace(/./g,""),role:"noun",gloss:ppNP.noun?.meaning||"?"}];
}
if(ppNP.noun)morphBreakdown.push({label:ppNP.noun.meaning,uf:ppNP.uf,sf:ppNP.sf,stem:ppNP.noun.ipa,affixes:ppNP.uf.slice(ppNP.noun.ipa.length)});
}
}

// Word order
let allWords;
if(L.wordOrder==="SVO")allWords=[...sNPwords,verbWord,...oNPwords,...ppWords];
else if(L.wordOrder==="SOV")allWords=[...sNPwords,...oNPwords,...ppWords,verbWord];
else allWords=[verbWord,...sNPwords,...oNPwords,...ppWords];

return{
words:allWords,
surfaceLine:allWords.map(x=>x.sf).join(" "),
romanLine:allWords.map(x=>romanize(x.sf)).join(" "),
glossLine:allWords.map(x=>x.gloss).join(" "),
partial:allWords.some(x=>x.sf==="?"),
morphBreakdown,
};
}

// ═══════════════════════════════════════════════════════════════════════════════
// NARRATIVE GENERATOR — connected multi-sentence stories
// ═══════════════════════════════════════════════════════════════════════════════

const STORY_TEMPLATES=[
{name:"The Hunt",steps:[
{type:"intro",pattern:"{det} {adj} {hero} walked to {det} {place}."},
{type:"event",pattern:"{pro} saw {det} {adj2} {animal} near {det} {place2}."},
{type:"event",pattern:"{det} {animal} was {adj3}."},
{type:"action",pattern:"{pro} hunted {det} {animal}."},
{type:"result",pattern:"{pro} carried {det} {animal} to {det} {place}."},
]},
{name:"The Journey",steps:[
{type:"intro",pattern:"{det} {hero} lived in {det} {adj} {place}."},
{type:"event",pattern:"One day {pro} walked from {det} {place} to {det} {place2}."},
{type:"event",pattern:"{det} {place2} was {adj2}."},
{type:"action",pattern:"{pro} found {det} {adj3} {object} near {det} {place2}."},
{type:"result",pattern:"{pro} carried {det} {object} to {det} {place}."},
]},
{name:"The Battle",steps:[
{type:"intro",pattern:"{det} {adj} {hero} fought {det} {enemy} near {det} {place}."},
{type:"event",pattern:"{det} {enemy} was {adj2} and {adj3}."},
{type:"action",pattern:"{det} {hero} struck {det} {enemy} with {det} {weapon}."},
{type:"result",pattern:"{det} {enemy} fell."},
{type:"result",pattern:"{det} {hero} was brave."},
]},
{name:"The Discovery",steps:[
{type:"intro",pattern:"{pro} walked to {det} {adj} {place}."},
{type:"event",pattern:"{pro} saw {det} {adj2} {object} under {det} {place2}."},
{type:"event",pattern:"{det} {object} was {adj3}."},
{type:"action",pattern:"{pro} took {det} {object}."},
{type:"result",pattern:"{pro} gave {det} {object} to {det} {hero2}."},
]},
{name:"The Storm",steps:[
{type:"intro",pattern:"{det} {adj} {hero} lived near {det} {place}."},
{type:"event",pattern:"A {adj2} storm came from {det} {place2}."},
{type:"event",pattern:"{det} wind was {adj3}."},
{type:"action",pattern:"{det} {hero} hid in {det} {place}."},
{type:"result",pattern:"{det} storm passed."},
{type:"result",pattern:"{det} {hero} was safe."},
]},
{name:"The Gift",steps:[
{type:"intro",pattern:"{det} {hero} loved {det} {hero2}."},
{type:"action",pattern:"{pro} made {det} {adj} {object} for {det} {hero2}."},
{type:"event",pattern:"{det} {object} was {adj2}."},
{type:"result",pattern:"{pro} gave {det} {object} to {det} {hero2}."},
{type:"result",pattern:"{det} {hero2} was happy."},
]},
];

function generateNarrative(L,w){
const template=pick(STORY_TEMPLATES);
const lex=L.lexicon;

// Pick story elements
const people=["man","woman","child","king","queen","warrior","hunter","farmer","priest","elder","knight","healer","thief","merchant"];
const animals=["wolf","bear","lion","eagle","snake","deer","fox","hawk","boar","tiger"];
const places=["forest","mountain","river","cave","village","temple","sea","lake","desert","field","tower","bridge","garden","island"];
const objects=["sword","ring","stone","shield","crown","gem","arrow","book","key","treasure","gold","pearl"];
const adjs=["old","brave","dark","big","strong","wise","beautiful","ancient","holy","wild","fierce","noble","proud"];

const findN=(pool)=>{for(const m of pool){const it=findInLex(lex,"N",m);if(it)return it;}return pick(lex.N);};
const findA=(pool)=>{for(const m of pool){const it=findInLex(lex,"ADJ",m);if(it)return it;}return pick(lex.ADJ);};

const hero=findN(people.sort(()=>Math.random()-0.5));
const hero2=findN(people.filter(p=>p!==hero.meaning).sort(()=>Math.random()-0.5));
const animal=findN(animals.sort(()=>Math.random()-0.5));
const place=findN(places.sort(()=>Math.random()-0.5));
const place2=findN(places.filter(p=>p!==place.meaning).sort(()=>Math.random()-0.5));
const object=findN(objects.sort(()=>Math.random()-0.5));
const weapon=findN(["sword","spear","axe","arrow","hammer","knife"].sort(()=>Math.random()-0.5));
const adj1=findA(adjs.sort(()=>Math.random()-0.5));
const adj2=findA(adjs.filter(a=>a!==adj1.meaning).sort(()=>Math.random()-0.5));
const adj3=findA(adjs.filter(a=>a!==adj1.meaning&&a!==adj2.meaning).sort(()=>Math.random()-0.5));
const enemy=findN(["wolf","bear","lion","snake","enemy","thief","warrior"].sort(()=>Math.random()-0.5));

const person="3sg";
const slots={hero,hero2,animal,place,place2,object,weapon,enemy,adj:adj1,adj2,adj3};

// Generate each sentence from template
const sentences=[];
let usedHeroFull=false; // first mention uses full NP, then pronouns

for(const step of template.steps){
let eng=step.pattern;
// Replace {det} with article
eng=eng.replace(/{det}/g,"the");
// Replace {pro} with "he/she" (pronoun for hero)
eng=eng.replace(/{pro}/g,usedHeroFull?"he":"the "+hero.meaning);
// Replace slots
for(const[k,v] of Object.entries(slots)){
if(typeof v==="object"&&v.meaning){
eng=eng.replace(new RegExp("\{"+k+"\}","g"),v.meaning);
}
}
// Clean up
eng=eng.replace(/\s+/g," ").trim();
eng=eng.charAt(0).toUpperCase()+eng.slice(1);

// Translate to conlang
const translated=translateEnglish(eng,L,w);
if(translated){
  sentences.push({english:eng,...translated});
}
if(!usedHeroFull)usedHeroFull=true;

}

// Combine all surface forms for speaking
const fullSurface=sentences.map(s=>s.surfaceLine).join("  ");
const fullRoman=sentences.map(s=>s.romanLine).join("  ");

return{
title:template.name,
hero:hero.meaning,
sentences,
fullSurface,
fullRoman,
};
}
// ═══════════════════════════════════════════════════════════════════════════════
const K={bg:"#0e1016",card:"#161921",bdr:"#252a36",bdrHi:"#4a6fa5",
txt:"#b0b6c4",dim:"#555c6d",bri:"#dce0ea",
acc:"#6b9fd4",mark:"#d49a5b",fth:"#5bb88a",win:"#e2b94e",err:"#d46060",
morph:"#b07dd4",sent:"#d4707a"};
const mono="'JetBrains Mono','Fira Code','SF Mono','Menlo',monospace";
const th={padding:"3px 2px",borderBottom:"2px solid #252a36",textAlign:"center",color:"#555c6d",fontSize:9,fontWeight:600};
const td={padding:"3px 2px",borderBottom:"1px solid #252a3620"};

// ═══════════════════════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App(){
const[flavor,setFlavor]=useState("Random");
const[lang,setLang]=useState(()=>generateLanguage("Random"));
const[weights,setWeights]=useState(()=>lang.weights);
const[sentences,setSentences]=useState([]);
const[showW,setShowW]=useState(false);
const[showLex,setShowLex]=useState(false);
const[showDetail,setShowDetail]=useState(null);
const[rawInput,setRawInput]=useState("");
const[mode,setMode]=useState("lang");
const[transInput,setTransInput]=useState("");
const[transResults,setTransResults]=useState([]);
const[speaking,setSpeaking]=useState(false);
const[showVoice,setShowVoice]=useState(false);
const[voiceParams,setVoiceParams]=useState(()=>lang.voiceParams||{pitch:130,Rd:1.8,rhythm:"mixed",tempo:1.0,pitchRange:0.15,reduction:false});
const[narratives,setNarratives]=useState([]);
const[expandedNar,setExpandedNar]=useState(null);

const speak=useCallback(async(text)=>{
if(speaking)return;
setSpeaking(true);
try{const dur=await speakIPA(text,1.0,voiceParams);setTimeout(()=>setSpeaking(false),(dur||1)*1000+100);}
catch(e){console.error(e);setSpeaking(false);}
},[speaking,voiceParams]);

const newLang=useCallback((fl)=>{
const f=fl||flavor;setFlavor(f);
const l=generateLanguage(f);setLang(l);setWeights(l.weights);setSentences([]);setShowDetail(null);setTransResults([]);setVoiceParams(l.voiceParams);setNarratives([]);setExpandedNar(null);
},[flavor]);

const addSentence=useCallback(()=>{setSentences(p=>[generateSentence(lang,weights),...p].slice(0,25));},[lang,weights]);
const addMany=useCallback(()=>{const b=[];for(let i=0;i<5;i++)b.push(generateSentence(lang,weights));setSentences(p=>[...b,...p].slice(0,30));},[lang,weights]);

const tableau=useMemo(()=>{if(mode!=="raw"||!rawInput)return[];const uf=parseIPA(rawInput);return uf.length?evalUF(uf,weights):[];},[mode,rawInput,weights]);

const Card=({children,s})=><div style={{background:K.card,border:`1px solid ${K.bdr}`,borderRadius:10,padding:"12px 14px",marginBottom:10,...(s||{})}}>{children}</div>;
const Label=({children,color})=><div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:color||K.dim,marginBottom:5}}>{children}</div>;
const Pill=({active,children,color,...p})=><span{...p}style={{display:"inline-block",padding:"5px 10px",borderRadius:18,fontSize:11,fontWeight:active?600:400,border:`1px solid ${active?(color||K.bdrHi):K.bdr}`,background:active?(color||K.acc)+"18":"transparent",color:active?(color||K.acc):K.dim,cursor:"pointer",whiteSpace:"nowrap",...(p.style||{})}}>{children}</span>;
const Btn=({children,color,...p})=><span{...p}style={{display:"inline-block",padding:"7px 14px",borderRadius:18,fontSize:12,fontWeight:600,background:(color||K.acc)+"20",color:color||K.acc,border:`1px solid ${(color||K.acc)}40`,cursor:"pointer",...(p.style||{})}}>{children}</span>;
const Tag=({children,color})=><span style={{padding:"2px 8px",borderRadius:10,background:(color||K.acc)+"15",color:color||K.acc,fontSize:11}}>{children}</span>;
const SpeakBtn=({text})=><span onClick={(e)=>{e.stopPropagation();speak(text);}} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:28,height:28,borderRadius:14,background:speaking?K.dim+"30":K.acc+"20",color:speaking?K.dim:K.acc,border:`1px solid ${speaking?K.dim:K.acc}40`,cursor:speaking?"wait":"pointer",fontSize:14,flexShrink:0}}>▶</span>;

return(
<div style={{background:K.bg,color:K.txt,minHeight:"100vh",fontFamily:"'IBM Plex Sans',system-ui,sans-serif",fontSize:13,maxWidth:540,margin:"0 auto",padding:"8px 10px 60px"}}>

  <div style={{textAlign:"center",padding:"12px 0 6px"}}>
    <div style={{fontSize:17,fontWeight:700,color:K.bri}}>Language Simulator</div>
    <div style={{fontSize:10,color:K.dim,fontFamily:mono}}>phonology · morphology · syntax</div>
  </div>

  <div style={{display:"flex",gap:5,justifyContent:"center",marginBottom:10}}>
    <Pill active={mode==="lang"} onClick={()=>setMode("lang")}>Language</Pill>
    <Pill active={mode==="story"} onClick={()=>setMode("story")}>Stories</Pill>
    <Pill active={mode==="trans"} onClick={()=>setMode("trans")}>Translate</Pill>
    <Pill active={mode==="raw"} onClick={()=>setMode("raw")}>Raw IPA</Pill>
  </div>

  {mode==="lang"&&<>
    {/* Flavor picker */}
    <Card>
      <Label color={K.win}>Language flavor</Label>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
        {Object.entries(FLAVORS).map(([k,v])=>
          <Pill key={k} active={flavor===k} color={K.win} onClick={()=>{setFlavor(k);newLang(k);}} style={{fontSize:10,padding:"4px 8px"}}>
            {k}
          </Pill>
        )}
      </div>
      <div style={{fontSize:11,color:K.dim,fontStyle:"italic"}}>{FLAVORS[flavor]?.desc}</div>
    </Card>

    <div style={{textAlign:"center",marginBottom:10}}>
      <Btn color={K.win} onClick={()=>newLang()}>✦ Regenerate</Btn>
    </div>

    {/* Language overview */}
    <Card s={{borderColor:K.win+"40"}}>
      <div style={{fontSize:16,fontWeight:700,color:K.win,fontFamily:mono,marginBottom:4}}>{lang.name}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:5,fontSize:11,marginBottom:8}}>
        <Tag color={K.acc}>{lang.wordOrder}</Tag>
        <Tag color={K.morph}>{lang.cases?"case":"no case"}</Tag>
        <Tag color={K.fth}>{lang.agreeType==="full"?"full agree":lang.agreeType==="partial"?"partial agree":"no agree"}</Tag>
        <Tag color={K.mark}>adj {lang.adjBefore?"before":"after"} N</Tag>
        <Tag color={K.dim}>{lang.adpType}positions</Tag>
        <Tag color={K.sent}>{lang.style}</Tag>
        <Tag color={K.dim}>{lang.voiceParams?.rhythm}-timed</Tag>
        <Tag color={K.morph}>{lang.derivStrategy||"suffix"} deriv.</Tag>
        {lang.nClassCount>0&&<Tag color={K.morph}>{lang.nClassCount} noun classes</Tag>}
        {lang.hasAspect&&<Tag color={K.fth}>aspect</Tag>}
        <Tag color={K.dim}>{lang.relStrategy} REL</Tag>
      </div>

      <Label>Phonemes ({lang.consonants.length}C + {lang.vowels.length}V)</Label>
      <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:8}}>
        {lang.consonants.map(c=><span key={c} style={{fontFamily:mono,fontSize:13,color:K.bri,background:K.bg,border:`1px solid ${K.bdr}`,borderRadius:4,padding:"2px 5px"}}>{c}</span>)}
        {lang.vowels.map(v=><span key={v} style={{fontFamily:mono,fontSize:13,color:K.fth,background:K.bg,border:`1px solid ${K.bdr}`,borderRadius:4,padding:"2px 5px"}}>{v}</span>)}
      </div>

      <Label color={K.morph}>Morphology</Label>
      <div style={{fontSize:11,fontFamily:mono,lineHeight:1.8}}>
        <div>plural: <span style={{color:K.fth}}>-{lang.pluralSuffix}</span></div>
        {lang.cases&&<div>NOM <span style={{color:K.fth}}>{lang.cases.NOM?"-"+lang.cases.NOM:"∅"}</span> · ACC <span style={{color:K.fth}}>-{lang.cases.ACC}</span> · DAT <span style={{color:K.fth}}>-{lang.cases.DAT}</span></div>}
        <div>PRS <span style={{color:K.fth}}>{lang.tenses.PRS?"-"+lang.tenses.PRS:"∅"}</span> · PST <span style={{color:K.fth}}>-{lang.tenses.PST}</span> · FUT <span style={{color:K.fth}}>-{lang.tenses.FUT}</span></div>
        {lang.agreeType!=="none"&&<div>agree ({lang.agreeType}): {Object.entries(lang.agreeParadigm||{}).filter(([_,v])=>v).map(([k,v])=><span key={k}>{k}:<span style={{color:K.fth}}>-{v}</span> </span>)}</div>}
        {lang.hasDet&&<div>det: <span style={{color:K.fth}}>{lang.detWord}</span></div>}
        <div>neg: <span style={{color:K.fth}}>{lang.negType==="particle"?lang.negWord+" (particle)":lang.negPrefix+"- (prefix)"}</span></div>
        <div>Q: <span style={{color:K.fth}}>{lang.qParticle} ({lang.qPosition})</span> · copula: <span style={{color:K.fth}}>{lang.copula}</span></div>
        {lang.hasAspect&&<div>aspect: PFV <span style={{color:K.fth}}>{lang.aspects?.PFV?"-"+lang.aspects.PFV:"∅"}</span> · IPFV <span style={{color:K.fth}}>-{lang.aspects?.IPFV}</span>{lang.aspects?.PROG?<span> · PROG <span style={{color:K.fth}}>-{lang.aspects.PROG}</span></span>:null}</div>}
        <div>relative: <span style={{color:K.fth}}>{lang.relativizer}</span> ({lang.relStrategy})</div>
      </div>
      {lang.nClassCount>0&&<>
        <Label color={K.morph}>Noun classes ({lang.nClassCount})</Label>
        <div style={{fontSize:11,fontFamily:mono,lineHeight:1.6}}>
          {lang.nClasses.map((cl,ci)=><div key={ci}>
            Class {cl.name}: marker <span style={{color:K.fth}}>-{cl.marker}</span> · adj <span style={{color:K.fth}}>-{cl.adjAgree}</span> · pron <span style={{color:K.fth}}>{qe(cl.pronoun,weights).replace(/\./g,"")}</span>
            {cl.detForm&&<span> · det <span style={{color:K.fth}}>{cl.detForm}</span></span>}
          </div>)}
        </div>
      </>}
      <Label color={K.morph}>Pronouns</Label>
      <div style={{fontSize:11,fontFamily:mono,lineHeight:1.6,display:"flex",flexWrap:"wrap",gap:6}}>
        {Object.entries(lang.pronouns||{}).map(([p,ipa])=>{
          const sf=qe(ipa,weights);
          return <span key={p}><span style={{color:K.dim}}>{p}:</span> <span style={{color:K.fth}}>{sf.replace(/\./g,"")}</span></span>;
        })}
      </div>
      <Label color={K.morph}>Adpositions ({lang.adpType}positions)</Label>
      <div style={{fontSize:11,fontFamily:mono,lineHeight:1.6,display:"flex",flexWrap:"wrap",gap:6}}>
        {Object.entries(lang.adpositions||{}).map(([en,ipa])=>{
          const sf=qe(ipa,weights);
          return <span key={en}><span style={{color:K.dim}}>{en}:</span> <span style={{color:K.fth}}>{sf.replace(/\./g,"")}</span></span>;
        })}
      </div>
      <Label color={K.morph}>Derivation — {lang.derivStrategy||"suffix"}</Label>
      <div style={{fontSize:11,fontFamily:mono,lineHeight:1.8}}>
        {(lang.derivStrategy||"suffix")==="suffix"&&<>
          <div>V→N agent: stem<span style={{color:K.fth}}>+-{lang.derivAffixes?.agent}</span></div>
          <div>ADJ→N abstract: stem<span style={{color:K.fth}}>+-{lang.derivAffixes?.abstract}</span></div>
          <div>N→ADJ: stem<span style={{color:K.fth}}>+-{lang.derivAffixes?.adjective}</span></div>
        </>}
        {(lang.derivStrategy||"")==="prefix"&&<>
          <div>V→N agent: <span style={{color:K.fth}}>{lang.derivAffixes?.prefix_agent}-</span>+stem</div>
          <div>ADJ→N abstract: <span style={{color:K.fth}}>{lang.derivAffixes?.prefix_abstract}-</span>+stem</div>
        </>}
        {(lang.derivStrategy||"")==="reduplication"&&<>
          <div>Agent/instrument: <span style={{color:K.fth}}>RED(first syl)</span>+stem</div>
          <div>Abstract: stem+<span style={{color:K.fth}}>RED(first syl)</span></div>
          <div>Adjective: <span style={{color:K.fth}}>full reduplication</span></div>
        </>}
        {(lang.derivStrategy||"")==="compound"&&<>
          <div>Agent: stem+<span style={{color:K.fth}}>"man/one"</span></div>
          <div>Place: stem+<span style={{color:K.fth}}>"land/home"</span></div>
          <div>Abstract: stem+<span style={{color:K.fth}}>"way/thing"</span></div>
        </>}
        {(lang.derivStrategy||"")==="template"&&<>
          <div>Root consonants + vowel patterns</div>
          <div>Agent: C<span style={{color:K.fth}}>{lang.templates?.agent?.join("")}</span>C</div>
          <div>Abstract: C<span style={{color:K.fth}}>{lang.templates?.abstract?.join("")}</span>C</div>
          <div>Place: <span style={{color:K.fth}}>{lang.templates?.place?.join("")}</span>CC</div>
        </>}
      </div>
    </Card>

    {/* Speaker / Voice */}
    <Card>
      <div onClick={()=>setShowVoice(!showVoice)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
        <Label color={K.acc}>Speaker voice</Label>
        <span style={{fontSize:11,color:K.dim}}>{showVoice?"▾":"▸"}</span>
      </div>
      {!showVoice&&<div style={{fontSize:10,color:K.dim}}>
        {Math.round(voiceParams.pitch)}Hz · {voiceParams.Rd<1.5?"tense":voiceParams.Rd<2.2?"modal":"breathy"} · {voiceParams.rhythm}-timed · {voiceParams.tempo<0.9?"slow":voiceParams.tempo>1.1?"fast":"medium"}
      </div>}
      {showVoice&&<div style={{marginTop:6}}>
        {[
          {key:"pitch",label:"Pitch",min:60,max:250,step:5,fmt:v=>`${Math.round(v)} Hz — ${v<100?"very deep":v<130?"deep":v<160?"medium":v<200?"high":"very high"}`},
          {key:"tempo",label:"Speed",min:0.6,max:1.5,step:0.05,fmt:v=>`${v.toFixed(2)}x — ${v<0.8?"very slow":v<0.95?"slow":v<1.1?"medium":v<1.25?"fast":"very fast"}`},
          {key:"Rd",label:"Voice quality",min:0.8,max:3.2,step:0.1,fmt:v=>`${v.toFixed(1)} — ${v<1.3?"pressed/tense":v<1.8?"modal/clear":v<2.4?"relaxed":v<2.8?"breathy":"very breathy"}`},
          {key:"pitchRange",label:"Expressiveness",min:0.05,max:0.35,step:0.02,fmt:v=>`${(v*100).toFixed(0)}% — ${v<0.1?"monotone":v<0.18?"restrained":v<0.25?"expressive":"dramatic"}`},
        ].map(({key,label,min,max,step,fmt})=>(
          <div key={key} style={{marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
              <span style={{fontSize:10,fontWeight:600,color:K.txt}}>{label}</span>
              <span style={{fontSize:9,color:K.dim,fontFamily:mono}}>{fmt(voiceParams[key])}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={voiceParams[key]}
              onChange={e=>setVoiceParams(vp=>({...vp,[key]:parseFloat(e.target.value)}))}
              style={{width:"100%",height:4,appearance:"auto",accentColor:K.acc}}/>
          </div>
        ))}
        <div style={{marginBottom:6}}>
          <div style={{fontSize:10,fontWeight:600,color:K.txt,marginBottom:4}}>Rhythm</div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {["stress","syllable","mora"].map(r=>
              <Pill key={r} active={voiceParams.rhythm===r} color={K.acc} onClick={()=>setVoiceParams(vp=>({...vp,rhythm:r}))} style={{fontSize:10,padding:"3px 8px"}}>
                {r}-timed
              </Pill>
            )}
          </div>
          <div style={{fontSize:9,color:K.dim,marginTop:3}}>
            {voiceParams.rhythm==="stress"?"Big duration contrast — stressed syllables long, unstressed short and reduced (English, Arabic, Russian)":
             voiceParams.rhythm==="syllable"?"Even syllable timing — all syllables similar length (Spanish, French, Swahili)":
             "Each mora gets equal time — very even, measured cadence (Japanese, Hawaiian)"}
          </div>
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center",marginBottom:4}}>
          <span onClick={()=>setVoiceParams(vp=>({...vp,reduction:!vp.reduction}))}
            style={{width:16,height:16,borderRadius:3,border:`1px solid ${K.bdr}`,background:voiceParams.reduction?K.acc:K.bg,cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,color:K.bri}}>
            {voiceParams.reduction?"✓":""}
          </span>
          <span style={{fontSize:10,color:K.txt}}>Vowel reduction</span>
          <span style={{fontSize:9,color:K.dim}}>— unstressed vowels become schwa-like</span>
        </div>
        <div style={{marginTop:6,display:"flex",gap:6}}>
          <Btn color={K.dim} onClick={()=>setVoiceParams(lang.voiceParams)}>Reset to language default</Btn>
        </div>
      </div>}
    </Card>

    {/* Lexicon */}
    <Card>
      <div onClick={()=>setShowLex(!showLex)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
        <Label>Lexicon ({lang.lexicon.N.length+lang.lexicon.V.length+lang.lexicon.ADJ.length})</Label>
        <span style={{fontSize:11,color:K.dim}}>{showLex?"▾":"▸"}</span>
      </div>
      {showLex&&<div style={{fontSize:11,fontFamily:mono,lineHeight:1.7}}>
        {["N","V","ADJ"].map(cat=><div key={cat} style={{marginBottom:6}}>
          <span style={{color:K.mark,fontSize:9,fontWeight:700}}>{cat}</span>
          <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
            {lang.lexicon[cat].map(item=>{const sf=qe(item.ipa,weights);return <span key={item.meaning} style={{display:"inline"}}>
              <span style={{color:item.derived?K.morph:K.bri}}>{sf.replace(/\./g,"")}</span>
              <span style={{color:K.acc,fontStyle:"italic",fontSize:10}}> {romanizeWord(sf)}</span>
              <span style={{color:K.dim,fontSize:9}}> '{item.meaning}'</span>
              {item.derived&&<span style={{color:K.dim,fontSize:8}}> ←{item.derived.desc}</span>}
            </span>;})}
          </div>
        </div>)}
      </div>}
    </Card>

    {/* Weights */}
    <Card>
      <div onClick={()=>setShowW(!showW)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
        <Label>Constraint weights</Label>
        <span style={{fontSize:11,color:K.dim}}>{showW?"▾":"▸"}</span>
      </div>
      {showW&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1px 8px",marginTop:4}}>
        {CON.map(c=><div key={c.name} style={{display:"flex",alignItems:"center",gap:3,padding:"2px 0"}}>
          <span style={{fontSize:9,fontFamily:mono,color:c.type==="M"?K.mark:K.fth,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
          <input type="number" step="0.5" min="0" max="20" value={weights[c.name]??c.dw}
            onChange={e=>setWeights(w=>({...w,[c.name]:Math.max(0,parseFloat(e.target.value)||0)}))}
            style={{background:K.bg,border:`1px solid ${K.bdr}`,borderRadius:3,color:K.bri,width:42,textAlign:"right",padding:"2px 3px",fontSize:11,fontFamily:mono,outline:"none"}}/>
        </div>)}
      </div>}
    </Card>

    {/* Sentences */}
    <Card>
      <Label color={K.sent}>Sentences</Label>
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        <Btn color={K.sent} onClick={addSentence}>+ Sentence</Btn>
        <Btn color={K.sent} onClick={addMany}>+ 5</Btn>
      </div>

      {sentences.map((s,si)=>(
        <div key={si} onClick={()=>setShowDetail(showDetail===si?null:si)}
          style={{padding:"8px 10px",marginBottom:6,borderRadius:8,background:K.bg,border:`1px solid ${K.bdr}`,cursor:"pointer"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
            <SpeakBtn text={s.surfaceLine}/>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontFamily:mono,color:K.bri,fontWeight:600,marginBottom:1,lineHeight:1.4,wordBreak:"break-word"}}>
                {s.surfaceLine}
              </div>
              <div style={{fontSize:13,color:K.acc,fontStyle:"italic",marginBottom:2,lineHeight:1.3,wordBreak:"break-word"}}>
                {s.romanLine}
              </div>
              <div style={{fontSize:12,color:K.fth,marginBottom:2,lineHeight:1.3}}>
                &ldquo;{s.english}&rdquo;
              </div>
              <div style={{fontSize:10,color:K.dim,fontFamily:mono,wordBreak:"break-word"}}>
                {s.glossLine}
              </div>
            </div>
          </div>
          {showDetail===si&&<div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${K.bdr}`}}>
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:9,padding:"2px 6px",borderRadius:8,background:K.acc+"15",color:K.acc}}>{s.type||"transitive"}</span>
              {s.hasAlternations&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:8,background:K.err+"15",color:K.err}}>has phonological changes</span>}
            </div>
            <div style={{fontSize:10,color:K.dim,marginBottom:4}}>Morphology:</div>
            {s.morphBreakdown.map((m,mi)=>(
              <div key={mi} style={{marginBottom:4}}>
                <div style={{fontSize:11,fontFamily:mono,display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{color:K.dim,minWidth:44}}>{m.label}</span>
                  <span style={{color:K.win}}>{m.stem}</span>
                  {m.affixes&&<span style={{color:K.morph}}>+{m.affixes}</span>}
                  <span style={{color:K.dim}}>→</span>
                  <span style={{color:K.dim}}>/{m.uf}/</span>
                  <span style={{color:K.dim}}>→</span>
                  <span style={{color:m.alts&&m.alts.length?K.err:K.fth,fontWeight:600}}>[{m.sf}]</span>
                </div>
                {m.alts&&m.alts.map((a,ai)=>(
                  <div key={ai} style={{fontSize:9,color:K.err,marginLeft:50,marginTop:1}}>
                    ⚡ /{a.from}/ → [{a.to}] — {a.reason}
                  </div>
                ))}
              </div>
            ))}
            <div style={{fontSize:10,color:K.dim,marginTop:6,marginBottom:4}}>Words:</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {s.words.map((w,wi)=>(
                <div key={wi} style={{background:K.card,border:`1px solid ${K.bdr}`,borderRadius:6,padding:"4px 8px",textAlign:"center"}}>
                  <div style={{fontSize:13,fontFamily:mono,fontWeight:600,color:w.role==="verb"?K.sent:w.role==="adj"?K.mark:w.role==="det"?K.dim:K.bri}}>{w.sf.replace(/\./g,"")}</div>
                  <div style={{fontSize:10,color:K.acc,fontStyle:"italic"}}>{romanizeWord(w.sf)}</div>
                  <div style={{fontSize:8,color:K.dim}}>{w.gloss}</div>
                </div>
              ))}
            </div>
          </div>}
        </div>
      ))}
      {!sentences.length&&<div style={{fontSize:11,color:K.dim,textAlign:"center",padding:8}}>Tap + to generate sentences in {lang.name}</div>}
    </Card>
  </>}

  {/* ═══ STORY MODE ═══ */}
  {mode==="story"&&<>
    <Card>
      <Label color={K.win}>Narratives in {lang.name}</Label>
      <p style={{fontSize:11,color:K.dim,margin:"0 0 8px",lineHeight:1.5}}>
        Generate connected multi-sentence stories. Each story tracks a protagonist through several events, using pronouns for subsequent references and the language's full grammar.
      </p>
      <div style={{display:"flex",gap:6,marginBottom:6}}>
        <Btn color={K.win} onClick={()=>{
          const n=generateNarrative(lang,weights);
          setNarratives(prev=>[n,...prev].slice(0,10));
        }}>✦ Generate Story</Btn>
      </div>
    </Card>

    {narratives.map((nar,ni)=>(
      <Card key={ni} s={{background:K.bg,border:`1px solid ${K.bdr}`}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <SpeakBtn text={nar.fullSurface}/>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:K.win}}>{nar.title}</div>
            <div style={{fontSize:9,color:K.dim}}>protagonist: {nar.hero} · {nar.sentences.length} sentences</div>
          </div>
        </div>

        {nar.sentences.map((s,si)=>(
          <div key={si} onClick={()=>setExpandedNar(expandedNar===ni*100+si?null:ni*100+si)}
            style={{padding:"6px 8px",marginBottom:4,borderRadius:6,background:K.card,border:`1px solid ${K.bdr}`,cursor:"pointer"}}>
            <div style={{fontSize:13,fontFamily:mono,color:K.bri,fontWeight:600,marginBottom:1,lineHeight:1.4,wordBreak:"break-word"}}>
              {s.surfaceLine}
            </div>
            <div style={{fontSize:11,color:K.acc,fontStyle:"italic",marginBottom:1,wordBreak:"break-word"}}>
              {s.romanLine}
            </div>
            <div style={{fontSize:11,color:K.fth,marginBottom:1}}>
              &ldquo;{s.english}&rdquo;
            </div>
            <div style={{fontSize:9,color:K.dim,fontFamily:mono,wordBreak:"break-word"}}>
              {s.glossLine}
            </div>
            {expandedNar===ni*100+si&&s.morphBreakdown&&s.morphBreakdown.length>0&&(
              <div style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${K.bdr}`}}>
                {s.morphBreakdown.map((m,mi)=>(
                  <div key={mi} style={{fontSize:10,fontFamily:mono,marginBottom:2,display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{color:K.dim,minWidth:40}}>{m.label}</span>
                    <span style={{color:K.win}}>{m.stem}</span>
                    {m.affixes&&<span style={{color:K.morph}}>+{m.affixes}</span>}
                    <span style={{color:K.dim}}>→</span>
                    <span style={{color:K.fth,fontWeight:600}}>[{m.sf}]</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Full text block */}
        <div style={{marginTop:6,padding:"6px 8px",borderRadius:6,background:K.card,border:`1px solid ${K.bdr}22`}}>
          <div style={{fontSize:10,color:K.dim,marginBottom:3}}>Full text:</div>
          <div style={{fontSize:12,fontFamily:mono,color:K.bri,lineHeight:1.6,wordBreak:"break-word"}}>
            {nar.fullSurface}
          </div>
          <div style={{fontSize:11,color:K.acc,fontStyle:"italic",lineHeight:1.5,marginTop:4,wordBreak:"break-word"}}>
            {nar.fullRoman}
          </div>
        </div>
      </Card>
    ))}

    {!narratives.length&&<Card>
      <div style={{fontSize:11,color:K.dim,textAlign:"center",padding:12}}>
        Tap "Generate Story" to create a connected narrative in {lang.name}.
      </div>
    </Card>}
  </>}

  {/* ═══ TRANSLATE MODE ═══ */}
  {mode==="trans"&&<>
    <Card>
      <Label color={K.acc}>English → {lang.name}</Label>
      <textarea value={transInput} onChange={e=>setTransInput(e.target.value)}
        placeholder="Type English... e.g. The big wolf eats fish"
        rows={2}
        style={{background:K.bg,border:`1px solid ${K.bdr}`,borderRadius:6,color:K.bri,fontSize:14,fontFamily:"inherit",width:"100%",padding:"8px 10px",outline:"none",resize:"vertical",boxSizing:"border-box",marginBottom:8}}/>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
        <Btn color={K.acc} onClick={()=>{
          if(!transInput.trim())return;
          const r=translateEnglish(transInput,lang,weights);
          if(r)setTransResults(p=>[{input:transInput,...r},...p].slice(0,20));
        }}>Translate</Btn>
        <Btn color={K.dim} onClick={()=>setTransResults([])}>Clear</Btn>
      </div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
        {["The wise queen gave the golden ring","I hunted wolves in the forest","She will build a strong bridge near the river","We fought the enemy with swords","He sees the old mountain from the tower","They found the hidden treasure under the stone","The brave hunter killed the lion","Birds fly over the dark sea","The child sleeps in the house","You walked to the ancient temple"].map(ex=>
          <span key={ex} onClick={()=>setTransInput(ex)} style={{fontSize:10,color:K.dim,cursor:"pointer",padding:"3px 7px",borderRadius:10,border:`1px solid ${K.bdr}`,background:K.bg}}>
            {ex}
          </span>
        )}
      </div>
    </Card>

    {transResults.map((r,ri)=>(
      <Card key={ri} s={{background:K.bg,border:`1px solid ${K.bdr}`}}>
        <div style={{fontSize:11,color:K.dim,marginBottom:4}}>{r.input}</div>
        <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
          <SpeakBtn text={r.surfaceLine}/>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontFamily:mono,color:K.bri,fontWeight:600,marginBottom:1,wordBreak:"break-word"}}>
              {r.surfaceLine}
            </div>
            <div style={{fontSize:13,color:K.acc,fontStyle:"italic",marginBottom:2,wordBreak:"break-word"}}>
              {r.romanLine}
            </div>
            <div style={{fontSize:10,color:K.dim,fontFamily:mono,marginBottom:4,wordBreak:"break-word"}}>
              {r.glossLine}
            </div>
          </div>
        </div>
        {r.partial&&<div style={{fontSize:10,color:K.err,marginBottom:4}}>⚠ Some words not found — showing best effort</div>}
        {r.morphBreakdown.length>0&&<div style={{borderTop:`1px solid ${K.bdr}`,paddingTop:6,marginTop:4}}>
          {r.morphBreakdown.map((m,mi)=>(
            <div key={mi} style={{fontSize:11,fontFamily:mono,marginBottom:2,display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
              <span style={{color:K.dim,minWidth:44}}>{m.label}</span>
              <span style={{color:K.win}}>{m.stem}</span>
              {m.affixes&&<span style={{color:K.morph}}>+{m.affixes}</span>}
              <span style={{color:K.dim}}>→</span>
              <span style={{color:K.fth,fontWeight:600}}>[{m.sf}]</span>
            </div>
          ))}
        </div>}
        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
          {r.words.map((w,wi)=>(
            <div key={wi} style={{background:K.card,border:`1px solid ${K.bdr}`,borderRadius:6,padding:"4px 8px",textAlign:"center"}}>
              <div style={{fontSize:13,fontFamily:mono,fontWeight:600,color:w.role==="verb"?K.sent:w.role==="adj"?K.mark:w.role==="det"?K.dim:K.bri}}>{w.sf}</div>
              <div style={{fontSize:10,color:K.acc,fontStyle:"italic"}}>{romanize(w.sf)}</div>
              <div style={{fontSize:8,color:K.dim}}>{w.gloss}</div>
            </div>
          ))}
        </div>
      </Card>
    ))}

    {!transResults.length&&<Card>
      <div style={{fontSize:11,color:K.dim,textAlign:"center",padding:12}}>
        Type an English sentence and tap Translate.<br/>
        Uses the current {lang.name} lexicon ({lang.lexicon.N.length} nouns, {lang.lexicon.V.length} verbs, {lang.lexicon.ADJ.length} adjectives).
      </div>
    </Card>}
  </>}

  {mode==="raw"&&<>
    <Card>
      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
        <span style={{color:K.dim,fontSize:20,fontFamily:mono}}>/</span>
        <input value={rawInput} onChange={e=>setRawInput(e.target.value)}
          style={{background:"transparent",border:"none",color:K.bri,fontSize:20,fontFamily:mono,outline:"none",width:140,padding:0}} placeholder="type IPA..."/>
        <span style={{color:K.dim,fontSize:20,fontFamily:mono}}>/</span>
        <span style={{color:K.dim}}>→</span>
        {tableau[0]&&<span style={{fontSize:20,fontWeight:700,color:K.win,fontFamily:mono}}>[{tableau[0].ipa}]</span>}
      </div>
    </Card>
    {tableau.length>0&&<Card>
      <Label>Tableau ({tableau.length})</Label>
      <div style={{overflowX:"auto",margin:"0 -14px",padding:"0 14px"}}>
        <table style={{borderCollapse:"collapse",width:"100%",fontSize:10,fontFamily:mono}}>
          <thead><tr>
            <th style={th}></th><th style={{...th,textAlign:"left"}}>Form</th><th style={{...th,textAlign:"right"}}>H</th>
            {CON.map(c=><th key={c.name} style={{...th,color:c.type==="M"?K.mark+"99":K.fth+"99",fontSize:7,writingMode:"vertical-rl",height:44,whiteSpace:"nowrap",padding:"2px 0"}}>{c.name}</th>)}
          </tr></thead>
          <tbody>
            {tableau.slice(0,10).map((c,i)=>{const w=i===0;return(
              <tr key={c.ipa+i} style={{background:w?K.win+"0c":"transparent"}}>
                <td style={{...td,color:K.win,fontWeight:700,width:14,fontSize:12}}>{w?"☞":""}</td>
                <td style={{...td,fontWeight:w?700:400,color:w?K.win:K.bri,whiteSpace:"nowrap"}}>[{c.ipa}]</td>
                <td style={{...td,textAlign:"right",color:w?K.win:K.dim,fontWeight:600}}>{c.h.toFixed(1)}</td>
                {CON.map(con=>{const v=c.vi[con.name]||0;return(
                  <td key={con.name} style={{...td,textAlign:"center",color:v?K.err:K.dim+"25",fontWeight:v?600:400,fontSize:10,padding:"3px 1px"}}>
                    {v?"*".repeat(Math.min(v,3))+(v>3?v:""):"·"}
                  </td>);})}
              </tr>);})}
          </tbody>
        </table>
      </div>
    </Card>}
  </>}
</div>

);
}