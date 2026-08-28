// ── Tuning archetypes — Martin-selected pitch vocabulary ─────────────────
//
// Measured scales that actually work for human ears and for the sample bank.
// Derived peoples never read `musicTraditions.js` (bench only); they score
// THIS catalog from spectrum, capacity, and society. See docs/martin-effect.md.
import { FAMILIES } from "./musicInstruments.js";
import { dissonanceCurve, minimaOf } from "./musicTuning.js";
import { bandFit, etErr, pickAmong, stepSpread } from "./martin.js";

const D = (cents, prom = 1) => ({ cents, ratio: Math.pow(2, cents / 1200), prom, found: true });

/**
 * Pre-approved tuning families. No culture names in tags — only properties the
 * mechanism can read (harmonic vs inharmonic, capacity band, ET tolerance…).
 */
export const TUNING_ARCHETYPES = [
  {
    id: "pythagoreanPent", family: "pentatonic", label: "five-tone cycle-of-fifths",
    frame: 1200, scale: [0, 204, 408, 702, 906], finalIdx: 0,
    harmonic: true, minCap: 4, maxCap: 7, equalSpread: 0.12, sampleEt: 0.55, wild: false,
    provenance: "三分損益 construction; Chinese bench",
  },
  {
    id: "anhemitonicPent", family: "pentatonic", label: "five-tone without semitones",
    frame: 1200, scale: [0, 200, 400, 700, 900], finalIdx: 0,
    harmonic: true, minCap: 4, maxCap: 8, equalSpread: 0.18, sampleEt: 0.85, wild: false,
    provenance: "generic anhemitonic pentatonic class",
  },
  {
    id: "highlandPipe", family: "pipe-diatonic", label: "measured chanter scale",
    frame: 1200, scale: [0, 197, 341, 495, 700, 890, 1010], finalIdx: 0,
    harmonic: true, minCap: 6, maxCap: 10, equalSpread: 0.28, sampleEt: 0.45, wild: false,
    provenance: "measured Highland pipe; Celtic bench",
  },
  {
    id: "yaman", family: "raga-frame", label: "just shruti heptatonic",
    frame: 1200, scale: [0, 112, 316, 498, 702, 814, 1018], finalIdx: 0,
    harmonic: true, minCap: 6, maxCap: 9, equalSpread: 0.32, sampleEt: 0.35, wild: false,
    provenance: "Hindustani Yaman; bench",
  },
  {
    id: "maqamRast", family: "maqam-frame", label: "neutral-third maqām frame",
    frame: 1200, scale: [0, 112, 386, 498, 702, 814, 1088], finalIdx: 0,
    harmonic: true, minCap: 6, maxCap: 10, equalSpread: 0.38, sampleEt: 0.3, wild: false,
    provenance: "maqām Rast; Arabic bench",
  },
  {
    id: "flamencoPhrygian", family: "maqam-frame", label: "Phrygian with raised third",
    frame: 1200, scale: [0, 112, 386, 498, 702, 814, 996], finalIdx: 0,
    harmonic: true, minCap: 5, maxCap: 9, equalSpread: 0.36, sampleEt: 0.4, wild: false,
    provenance: "Andalusian; flamenco bench",
  },
  {
    id: "pelog", family: "metallophone", label: "bronze pélog set",
    frame: 1200, scale: [0, 120, 258, 539, 675, 785, 1088], finalIdx: 0,
    harmonic: false, minCap: 5, maxCap: 9, equalSpread: 0.35, sampleEt: 0.15, wild: false,
    provenance: "Central Javanese pélog averages; gamelan bench",
  },
  {
    id: "slendro", family: "metallophone", label: "near-equal five-tone bronze",
    frame: 1200, scale: [0, 239, 462, 709, 937], finalIdx: 0,
    harmonic: false, minCap: 4, maxCap: 7, equalSpread: 0.08, sampleEt: 0.25, wild: false,
    provenance: "Javanese slendro class averages",
  },
  {
    id: "westAfricanEqui7", family: "metallophone", label: "seven-step balafon division",
    frame: 1200, scale: [0, 171, 343, 514, 686, 857, 1029], finalIdx: 0,
    harmonic: false, minCap: 6, maxCap: 10, equalSpread: 0.04, sampleEt: 0.2, wild: false,
    provenance: "Mande balafon; West African bench",
  },
  {
    id: "miyakoBushi", family: "pentatonic", label: "in-scale Japanese pentatonic",
    frame: 1200, scale: [0, 90, 498, 702, 792], finalIdx: 0,
    harmonic: true, minCap: 4, maxCap: 7, equalSpread: 0.45, sampleEt: 0.5, wild: false,
    provenance: "miyako-bushi; Japanese bench",
  },
  {
    id: "diatonicMajor", family: "diatonic", label: "major mode on equal grid",
    frame: 1200, scale: [0, 200, 400, 500, 700, 900, 1100], finalIdx: 0,
    harmonic: true, minCap: 7, maxCap: 12, equalSpread: 0.26, sampleEt: 0.95, wild: false,
    provenance: "common-practice major; European bench grid",
  },
  {
    id: "naturalMinor", family: "diatonic", label: "natural minor on equal grid",
    frame: 1200, scale: [0, 200, 300, 500, 700, 800, 1000], finalIdx: 0,
    harmonic: true, minCap: 7, maxCap: 12, equalSpread: 0.28, sampleEt: 0.9, wild: false,
    provenance: "diatonic minor class",
  },
  {
    id: "twelveTet", family: "chromatic", label: "twelve equal semitones",
    frame: 1200, scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100], finalIdx: 0,
    harmonic: true, minCap: 9, maxCap: 14, equalSpread: 0.02, sampleEt: 1, wild: false,
    provenance: "equal temperament; high-literacy keyboard path",
  },
  {
    id: "harmonicMinor", family: "diatonic", label: "harmonic minor raised seventh",
    frame: 1200, scale: [0, 200, 300, 500, 700, 800, 1100], finalIdx: 0,
    harmonic: true, minCap: 6, maxCap: 10, equalSpread: 0.34, sampleEt: 0.75, wild: false,
    provenance: "Balkan / Central Asian harmonic minor class",
  },
  {
    id: "wholeTone", family: "chromatic", label: "six equal whole tones",
    frame: 1200, scale: [0, 200, 400, 600, 800, 1000], finalIdx: 0,
    harmonic: true, minCap: 5, maxCap: 8, equalSpread: 0.02, sampleEt: 0.95, wild: false,
    provenance: "whole-tone division; timbre-ambiguous traditions",
  },
  {
    id: "limitedTwo", family: "limited", label: "two-pitch didjeridu class",
    frame: 1200, scale: [0, 386], finalIdx: 0,
    harmonic: true, minCap: 1, maxCap: 3, equalSpread: 1, sampleEt: 0.4, wild: false,
    provenance: "yidaki measurement; Aboriginal bench",
  },
  // wildInharmonic reserved for a future probe arm — metallophone outliers use pélog/slendro in v1
];

function ensembleHarmonic(insts, power, refJ) {
  const vibs = new Set(insts.map(i => (FAMILIES[i.fam] || {}).vib).filter(Boolean));
  const harmonicVib = vibs.has("string") || vibs.has("air");
  const inharmonicVib = vibs.has("bar") || vibs.has("plate") || vibs.has("tongue");
  const refVib = (FAMILIES[(insts[refJ] || {}).fam] || {}).vib;
  const metallophoneRef = refVib === "bar" || refVib === "plate" || refVib === "tongue";
  return {
    harmonic: power === 1 && harmonicVib,
    inharmonic: power >= 2 || inharmonicVib,
    metallophoneRef,
    fixedPitch: insts.some(i => (FAMILIES[i.fam] || {}).pitchBy === "fixed" && i.cap >= 3),
  };
}

/** How well roughness minima align with an archetype's degree template. */
function physFit(mins, arch) {
  if (!mins.length) return 0.5;
  let hit = 0, tot = 0;
  for (const c of arch.scale) {
    if (c <= 0) continue;
    tot++;
    const r = Math.pow(2, c / 1200);
    let best = Infinity;
    for (const m of mins) best = Math.min(best, Math.abs(1200 * Math.log2(m.ratio / r)));
    hit += Math.max(0, 1 - best / 180);
  }
  return tot ? hit / tot : 0.5;
}

export function scoreTuningArchetype(arch, ctx) {
  const { cap, pull, insts, power, spec, refJ } = ctx;
  const ens = ensembleHarmonic(insts, power, refJ);
  if (arch.wild && !ens.metallophoneRef) return -1;
  const n = arch.scale.length;
  const spread = stepSpread(arch.scale, arch.frame);
  const err = etErr(arch.scale);

  let s = 0;
  s += 0.32 * physFit(ctx.mins, arch);
  s += 0.18 * bandFit(cap, arch.minCap, arch.maxCap);
  s += 0.14 * bandFit(n, Math.max(3, cap - 1), cap + 2);
  s += 0.12 * (1 - Math.min(1, Math.abs(spread - arch.equalSpread * (0.35 + pull * 0.65)) / 0.35));
  s += 0.08 * arch.sampleEt * (1 - err / 55);
  if (arch.harmonic && ens.harmonic) s += 0.14;
  if (!arch.harmonic && ens.metallophoneRef) s += 0.16;
  if (arch.harmonic && ens.metallophoneRef && !arch.wild) s -= 0.12;
  if (!arch.harmonic && ens.harmonic && !ens.metallophoneRef) s -= 0.06;
  if (arch.wild && ens.metallophoneRef) s += 0.04;
  if (pull > 0.55 && arch.sampleEt > 0.7) s += 0.06 * pull;
  if (ens.fixedPitch && !arch.harmonic) s += 0.05;
  return s;
}

export function matchTuningArchetype(ctx) {
  const { seed = 0, spec } = ctx;
  const mins = minimaOf(dissonanceCurve(spec)).filter(m => m.ratio > 1.02 && m.ratio < 1.95);
  const scoredCtx = { ...ctx, mins };
  const viable = TUNING_ARCHETYPES.filter(a => scoreTuningArchetype(a, scoredCtx) >= 0);
  const { picked, score, ranked } = pickAmong(
    viable.length ? viable : TUNING_ARCHETYPES,
    a => scoreTuningArchetype(a, scoredCtx),
    { seed, tag: "tuning", epsilon: 0.04, topK: 4 },
  );
  return { archetype: picked, score, ranked: ranked.slice(0, 6) };
}

/** Replace free-crawled degrees with the winning archetype; keep physics curve. */
export function applyTuningArchetype(rawScale, match) {
  const arch = match.archetype;
  const frame = { ratio: Math.pow(2, arch.frame / 1200), cents: arch.frame, prom: 1 };
  const degrees = arch.scale.map((c, i) => D(c, arch.scale.length - i));
  return {
    ...rawScale,
    degrees,
    frame,
    derivedBy: `martin:${arch.id}`,
    tetErr: etErr(arch.scale),
    martin: {
      id: arch.id,
      family: arch.family,
      label: arch.label,
      score: match.score,
      provenance: arch.provenance,
      finalIdx: arch.finalIdx ?? 0,
    },
  };
}

/** Snap a frequency to the nearest scale degree (all octaves) — for sample playback. */
export function quantizeToScaleHz(freq, music, tonicHz = 220) {
  if (!(freq > 0) || !music?.scale?.degrees?.length) return freq;
  const degs = music.scale.degrees;
  const frame = music.scale.frame?.ratio || 2;
  let best = freq, bestD = Infinity;
  for (let o = -4; o <= 4; o++) {
    const fo = Math.pow(frame, o);
    for (const d of degs) {
      const hz = tonicHz * fo * d.ratio;
      const dist = Math.abs(Math.log2(freq / hz));
      if (dist < bestD) { bestD = dist; best = hz; }
    }
  }
  return best;
}
