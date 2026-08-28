// ── The music genome: what a people plays, and why ───────────────────────
//
// Same shape as the emblem genome (docs/emblems.md): a heritable style
// vector, EXPRESSED through what the world allows, drifting with lineage and
// recombining on contact. What makes music different from heraldry is how
// little of it is in the vector — most of a tradition's character is forced
// by things the world already decides:
//
//   materials  ← biome + geology + crafts          (what can be built at all)
//   spectra    ← the physics of those bodies       (musicInstruments.js)
//   tuning     ← roughness minima of those spectra (musicTuning.js — the spine)
//   rhythm     ← the LANGUAGE's own prosody        (languagePhonetics.prosodyOf)
//   melody     ← tuning + tone + breath declination
//   texture    ← surplus, stratification, literacy
//   form       ← literacy (oral formula vs written development)
//   occasion   ← what is happening to these people right now
//
// The genome proper is only the residue: the free choices left once physics
// and society have had their say. That ordering is deliberate — it is what
// keeps two peoples with the same endowment from sounding identical, without
// letting a random vector overrule a physical constraint.
//
// Nothing here is wired into the world sim. Like the Language Lab, this is a
// standalone derivation the Music Lab drives; the sim stays silent.
import { hash32 } from "./peopleSim/rng.js";
import { MATERIALS, FAMILIES, makeInstrument } from "./musicInstruments.js";
import { ensembleSpectrum, deriveScale, deriveMode, finalsOf, LENGTH_POWER } from "./musicTuning.js";
import { prosodyOf } from "./languagePhonetics.js";

// ── biomes: what grows and what can be dug ───────────────────────────────
// Availability, not presence — the roll below decides. Mirrors the classes
// the world's own biogeography already assigns (biomeClass.js, resourceGen.js).
export const BIOMES = {
  tundra:   { label: "tundra",            org: ["hide", "horn"], min: ["stone"], p: { hide: 1, horn: .8, timber: .15, stone: .5, clay: .2 } },
  taiga:    { label: "boreal forest",     org: ["timber", "hide"], min: ["iron"], p: { timber: 1, hide: .8, horn: .5, stone: .4, clay: .3 } },
  temperate:{ label: "temperate forest",  org: ["timber", "hide"], min: ["copper", "iron"], p: { timber: 1, hide: .9, horn: .6, clay: .7, stone: .6, silk: .35 } },
  steppe:   { label: "grass steppe",      org: ["hide", "horn"], min: ["copper"], p: { hide: 1, horn: 1, timber: .2, clay: .5, stone: .4 } },
  medit:    { label: "dry woodland",      org: ["timber", "hide"], min: ["copper", "tin", "stone"], p: { timber: .8, hide: .8, horn: .6, clay: .8, stone: .9, reed: .3 } },
  desert:   { label: "desert",            org: ["hide"], min: ["stone", "precious"], p: { hide: .7, horn: .5, stone: .9, clay: .5, reed: .15, timber: .05 } },
  savanna:  { label: "savanna",           org: ["hide", "gourd"], min: ["iron"], p: { hide: 1, horn: .9, gourd: .9, timber: .5, clay: .6, stone: .4 } },
  tropical: { label: "tropical forest",   org: ["bamboo", "timber", "gourd"], min: ["tin", "precious"], p: { bamboo: 1, timber: .9, gourd: .8, hide: .5, clay: .6, reed: .4 } },
  delta:    { label: "river delta",       org: ["reed", "timber"], min: ["clay"], p: { reed: 1, clay: 1, timber: .5, hide: .7, gourd: .4, silk: .3, stone: .2 } },
  highland: { label: "highland",          org: ["hide", "timber"], min: ["stone", "copper", "tin", "iron", "precious"], p: { stone: 1, hide: .9, horn: .8, timber: .6, clay: .4 } },
};

// gut and silk are made things, not found ones — they need a herd or a craft
const DERIVED_MAT = { gut: (e) => e.hide };

/**
 * Found a people: a place, an endowment, crafts, a society, and a tongue.
 * These are the INPUTS the music falls out of — the Lab shows every one of
 * them so the causal chain stays legible.
 */
export function foundPeople(seed, lang, pin = {}) {
  const s = seed >>> 0;
  const roll = (tag) => hash32(s, "people", tag) / 4294967296;
  const biomeIds = Object.keys(BIOMES);
  const biome = pin.biome || biomeIds[Math.floor(roll("bio") * biomeIds.length) % biomeIds.length];
  const B = BIOMES[biome];

  // endowment: the biome's own probabilities, plus a geology roll for metals
  const have = {};
  for (const [mat, p] of Object.entries(B.p)) have[mat] = roll("m" + mat) < p;
  for (const ore of ["copper", "tin", "iron", "precious"]) {
    have[ore] = B.min.includes(ore) ? roll("o" + ore) < 0.75 : roll("o" + ore) < 0.16;
  }
  for (const [mat, fn] of Object.entries(DERIVED_MAT)) have[mat] = have[mat] || !!fn(have);
  have.bronze = !!(have.copper && have.tin);
  Object.assign(have, pin.have || {});

  // crafts — the same knowledge axes the world sim carries
  const dev = pin.dev ?? (0.15 + roll("dev") * 0.8);
  const kn = (tag, w) => Math.max(0, Math.min(1, dev * w + (roll(tag) - 0.5) * 0.3));
  const know = pin.know || {
    metallurgy: have.bronze || have.iron ? kn("kmet", 1.05) : kn("kmet", 0.35),
    construction: kn("kcon", 1), organization: kn("korg", 1),
    agriculture: kn("kagr", 1), mobility: kn("kmob", 0.9), navigation: kn("knav", 0.8),
  };
  // society — the dials that decide who plays together and how many
  const soc = pin.soc || {
    surplus: Math.min(1, know.agriculture * 0.7 + roll("sur") * 0.45),
    urban: Math.min(1, know.organization * 0.8 + roll("urb") * 0.35),
    strat: Math.min(1, know.organization * 0.6 + roll("str") * 0.5),
    literacy: Math.max(0, Math.min(1, know.organization * 1.1 - 0.25 + (roll("lit") - 0.5) * 0.35)),
  };
  // creed — the faith axes the sim already tracks, in the same −1..1 sense
  const creed = pin.creed || {
    militancy: (roll("mil") - 0.5) * 2, exclusivity: (roll("exc") - 0.5) * 2, asceticism: (roll("asc") - 0.5) * 2,
  };
  return { seed: s, biome, biomeLabel: B.label, have, know, soc, creed, dev, lang, name: pin.name || null };
}

// What a maker wants out of a material depends on what the body does with
// it: a struck idiophone is its ring, a tube is just a tube. COST is how far
// a substance has to travel to a workshop — ore has to be found, smelted and
// traded; cane grows outside.
const MAT_COST = { bronze: 1, iron: 0.85, silver: 1.1, stone: 0.45, wood: 0.2, bamboo: 0.1, reed: 0.08,
  // bone is the cheapest thing a herding or hunting people owns: it is left
  // over from a beast killed for something else, and unlike gut it needs no
  // curing before it can be cut
  clay: 0.15, gourd: 0.1, hide: 0.2, gut: 0.3, silk: 0.7, horn: 0.25, bone: 0.15 };
function matScore(struck, matId, jitter, strat = 0) {
  const m = MATERIALS[matId], cost = MAT_COST[matId] ?? 0.5;
  // a stratified society spends on display: the same cane pipe gets made in
  // silver at a court and in cane in a village
  return (struck ? m.decay / 9 : 1 - cost) + strat * cost * 0.8 + jitter * 0.35;
}

// ── what they can build ──────────────────────────────────────────────────
/** Materials the endowment and crafts actually put in a maker's hands. */
export function materialsOf(people) {
  const out = [];
  for (const [id, m] of Object.entries(MATERIALS)) {
    const has = m.needs.every(n => people.have[n]);
    if (!has) continue;
    // working metal takes metallurgy; casting bronze takes more than beating copper
    if ((id === "bronze" || id === "iron" || id === "silver") && people.know.metallurgy < 0.25) continue;
    out.push(id);
  }
  return out;
}

/**
 * The instrumentarium: every body this people can make, with a WEIGHT for how
 * central it is to their sound. Weight is the mechanism that decides whose
 * spectrum dominates the tuning — a people with one prized cast-bronze set
 * and a few pipes tunes to the bronze.
 */
export function instrumentariumOf(people) {
  const mats = new Set(materialsOf(people));
  const roll = (tag) => hash32(people.seed, "inst", tag) / 4294967296;
  const out = [];
  for (const [famId, fam] of Object.entries(FAMILIES)) {
    // craft gates: can they build this kind of body at all?
    let ok = true;
    for (const [axis, need] of Object.entries(fam.needs || {})) if ((people.know[axis] ?? 0) < need) ok = false;
    if (!ok) continue;
    const body = (fam.body || []).filter(m => mats.has(m));
    if (!body.length) continue;
    if (fam.frame && !fam.frame.some(m => mats.has(m))) continue;
    // Pick the body material by what the family actually needs from it. A
    // tube's material barely changes its spectrum, so a pipe gets made of
    // whatever is nearest to hand — cane, cane, always cane. A struck
    // idiophone is nothing BUT its material's ring, so a people that can
    // work metal will spend metal on it and on nothing else. That single
    // distinction is why traditions end up mixing bronze with bamboo rather
    // than casting everything they own.
    const struck = fam.kind === "struck" || famId === "lamella";
    const pick = body.sort((a, b) => matScore(struck, b, roll(famId + b), people.soc.strat) - matScore(struck, a, roll(famId + a), people.soc.strat))[0];
    const inst = makeInstrument(famId, pick, (fam.frame || []).find(m => mats.has(m)), people.seed, 0, people.know);
    // Centrality: what sits at the middle of a tradition is what can carry
    // its music (pitch reach), what cost something to make (prized material,
    // hard craft), and what a court can pay to keep. Scores are relative —
    // normalized below — so every people has a real core and a real fringe.
    // HOW WELL IT IS PLAYED is not how well it was made. A player good enough
    // to have a flat, economical technique is a specialist, and a specialist
    // is somebody the surplus has to feed — the same constraint that decides
    // how many kinds of instrument a tradition can keep at all.
    inst.skill = Math.max(0, Math.min(1, 0.3 + 0.45 * people.soc.surplus + 0.35 * people.soc.urban));
    const costly = MATERIALS[pick].needs.some(n => ["copper", "tin", "iron", "precious"].includes(n));
    inst.raw = 0.5 * Math.min(1, fam.cap / 12)
      + (costly ? 0.6 : 0)
      + (fam.needs && Object.keys(fam.needs).length ? 0.35 : 0)
      + people.soc.strat * 0.3
      + roll("w" + famId) * 0.6;
    out.push(inst);
  }

  // a people with nothing else always has its own body: clapping, stamping,
  // and the voice — never an empty ensemble
  // A people with nothing to build with is not an empty ensemble — and it is
  // not a hide drum on a wooden frame either, which is what this used to
  // fabricate for four cultures in three hundred, every one of which had no
  // timber. What needs no material at all is the body: somebody sings and
  // somebody claps.
  if (!out.length) { const c = makeInstrument("claps", "none", null, people.seed, 0, people.know); c.raw = 1; out.push(c); }
  const maxRaw = Math.max(...out.map(i => i.raw)) || 1;
  for (const i of out) i.weight = Math.max(0.12, i.raw / maxRaw);
  out.sort((a, b) => b.weight - a.weight);

  // A TRADITION IS NARROWER THAN A CAPABILITY. Being able to build a body is
  // not the same as keeping one: every instrument type in living use needs
  // makers who know it and players who practise it, and both are specialists
  // somebody has to feed. So breadth scales with surplus and town life, and a
  // people keeps the bodies it is best at — which is what gives a tradition a
  // recognisable handful of instruments instead of a museum of everything.
  const breadth = Math.max(2, Math.min(7, Math.round(2.2 + people.soc.surplus * 2.4 + people.soc.urban * 2.2)));
  // BREADTH IS A COUNT OF SPECIALISTS, so a body that needs no specialist must
  // not be counted against it. Nobody apprentices to make a pair of sticks, a
  // notched bone or a gourd with seeds in it, and nobody has to be fed to
  // play one — which is exactly why every culture on earth has one however
  // thin its surplus. Counting them in took the drum from half of all peoples
  // to an eighth, because a body available to everybody kept winning slots
  // from bodies that are actually central.
  const madeByHand = (i) => {
    const f = FAMILIES[i.fam] || {};
    return !(f.needs && Object.keys(f.needs).length) && i.cap <= 1;
  };
  const kept = out.filter(i => !madeByHand(i)).slice(0, breadth);
  // coverage: whatever else it drops, a tradition keeps something that can
  // carry a tune and something that can keep time, if it can make them at all
  const ensure = (pred) => {
    if (kept.some(pred)) return;
    const found = out.find(i => !madeByHand(i) && pred(i));
    if (found && kept.length) kept[kept.length - 1] = found;
  };
  ensure(i => i.cap >= 5);
  // AND A STRETCHED MEMBRANE, if they can make one. This asked for a drum BY
  // NAME, which is a list where a physical class belongs — but the class is
  // worth guaranteeing, because a membrane is the loudest low sound available
  // to anybody without metallurgy, and that is why every people on earth that
  // can stretch a hide does.
  ensure(i => (FAMILIES[i.fam] || {}).vib === "membrane");
  // …and one thing nobody had to be trained to make. Hands qualify and need
  // no material, so this never comes back empty — which is what guarantees
  // every people something that can keep time.
  const plain = out.filter(madeByHand);
  if (plain.length) kept.push(plain[0]);
  return kept.sort((a, b) => b.weight - a.weight);
}

// ── rhythm, straight out of the language ─────────────────────────────────
// Speech rhythm predicts musical rhythm: the durational variability of a
// culture's speech shows up in its instrumental themes (this is a measured
// cross-linguistic result, not an assumption — and the Lab measures the
// generated music's nPVI so you can check it holds here too).
const METERS = {
  stress:   [[4, "duple"], [3, "triple"], [6, "compound"], [4, "duple"]],
  syllable: [[4, "duple"], [5, "additive"], [7, "additive"], [3, "triple"]],
  even:     [[4, "duple"], [2, "duple"], [4, "duple"], [6, "compound"]],
};
export function rhythmOf(people, insts) {
  const pros = people.lang ? prosodyOf(people.lang) : { rhythm: "even", rate: 1, reduce: 0, stressGain: 1.1 };
  const roll = (tag) => hash32(people.seed, "rhy", tag) / 4294967296;
  const cls = pros.rhythm;
  const [beats, meterKind] = METERS[cls][Math.floor(roll("met") * 4) % 4];
  const hasTimekeeper = insts.some(i => i.fam === "drum" || i.fam === "frameDrum");
  return {
    cls, beats, meterKind,
    // stress-timed speech → long-short pairs; syllable-timed → near-equal
    swing: cls === "stress" ? 0.18 + pros.reduce * 0.34 : cls === "even" ? 0.06 : 0,
    // a strong grid plus a dedicated timekeeper is what lets a line push
    // against the beat at all
    syncopation: (cls === "stress" ? 0.4 : cls === "syllable" ? 0.22 : 0.1) * (hasTimekeeper ? 1 : 0.35),
    accent: pros.stressGain,
    // Pulse sits near the body's own preferred rate. Spontaneous motor tempo
    // — the rate people tap, walk and rock at unprompted — clusters around
    // 100–120 beats a minute across populations, and music entrains to it;
    // that is the anchor, scaled by how fast this tongue is spoken.
    tempo: Math.round(100 * pros.rate * (cls === "syllable" ? 1.06 : 1)),
    density: cls === "syllable" ? 0.8 : cls === "stress" ? 0.55 : 0.65,
  };
}
/** Normalized pairwise variability index — the measure the speech/music
 *  rhythm literature compares languages with. Computed, never assumed. */
export function nPVI(durs) {
  if (durs.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < durs.length; i++) s += Math.abs(durs[i] - durs[i - 1]) / ((durs[i] + durs[i - 1]) / 2);
  return (100 * s) / (durs.length - 1);
}

// ── texture and form ─────────────────────────────────────────────────────
export function textureOf(people, insts) {
  // every player in an ensemble is someone not farming, so ensemble size is
  // a surplus question before it is a musical one
  const size = Math.max(1, Math.round(0.6 + people.soc.surplus * 3.6 + people.soc.urban * 2.6));
  const sustains = insts.some(i => i.kind === "sustain");
  const kind = size >= 6 && people.soc.literacy > 0.6 ? "polyphony"
    : size >= 4 ? "heterophony"
    : size >= 2 && sustains ? "drone"
    : "monophony";
  return {
    size, kind, sustains,
    // an austere creed strips ornament; a court with sustaining instruments
    // and time on its hands piles it on
    ornament: Math.max(0, Math.min(1, 0.4 - people.creed.asceticism * 0.3 + people.soc.strat * 0.3 + (sustains ? 0.12 : 0))),
    // stratification splits a court manner from a village one
    courtly: people.soc.strat,
  };
}
export function formOf(people) {
  const lit = people.soc.literacy;
  // oral traditions build from formula and repetition because that is what
  // memory affords; notation is what buys long, non-repeating structure
  return {
    literate: lit > 0.5,
    sections: lit > 0.72 ? 4 : lit > 0.5 ? 3 : 2,
    repetition: Math.max(0.15, 1 - lit * 0.8),
    development: Math.max(0, (lit - 0.45) * 1.6),
    phrasePerSection: lit > 0.5 ? 4 : 2,
  };
}

// ── the whole derivation ─────────────────────────────────────────────────
export function musicOf(people) {
  const insts = instrumentariumOf(people);
  // An ensemble tunes to the instruments that CANNOT be retuned in the
  // moment. A cast bar set or a founded bell is fixed the day it is made;
  // a flute is lipped, a string is stopped, a voice follows. So the fixed-
  // pitch bodies are the tuning reference and everyone else bends to them —
  // which is why a tradition built around struck metal ends up with metal's
  // consonances, and one built around pipes ends up with the harmonic series.
  // The reference is ONE instrument, not a class: the most central body that
  // cannot be adjusted mid-performance. Everyone else tunes to it and so
  // contributes only lightly to what the tradition counts as consonant.
  const FIXED = new Set(["barSet", "bell", "gong", "lamella"]);
  const refI = insts.findIndex(i => FIXED.has(i.fam));
  const refJ = refI >= 0 ? refI : insts.findIndex(i => i.cap >= 3);
  const tuneW = insts.map((i, k) => i.weight * (k === refJ ? 5 : 1));
  const spec = ensembleSpectrum(insts, tuneW);
  // …but the reference's authority is over WHERE THE DEGREES SIT, not over
  // whether the octave exists. What interval a people's music repeats at is a
  // question about everything they actually play, at the shares they play it
  // in — so the frame is read off the plain radiating ensemble. (See the note
  // in deriveScale: with the reference amplified into this decision too, one
  // minority bar set could put a string-and-pipe culture's octave at a minor
  // sixth, in 12 peoples out of 100.)
  const radiated = ensembleSpectrum(insts, insts.map(i => i.weight));
  // how many pitches the ensemble can actually sound: the best-endowed
  // melodic body sets the ceiling. A six-hole pipe tradition stays pentatonic
  // because of the pipe, not because anyone chose pentatonicism.
  const melodic = insts.filter(i => i.cap >= 3);
  const cap = melodic.length ? Math.max(...melodic.map(i => i.cap)) : 3;
  // a literate tradition with fixed-pitch instrument SETS regularizes its
  // steps; an oral one keeps the ratios it found
  const fixedSets = insts.some(i => i.fam === "barSet" || i.fam === "bell");
  const pull = Math.max(0, Math.min(0.85, people.soc.literacy * 0.5 + (fixedSets ? 0.25 : 0) + people.know.organization * 0.2 - 0.25));
  // AND THE BODY THE SCALE IS CUT FROM is the one everybody tunes to — the
  // same instrument chosen just above, for the same reason. Where its timbre
  // offers no consonance to find, what is left is its GEOMETRY: how its pitch
  // answers to its own length, which is 1/L for a string or a bore and 1/L²
  // for a bar. See `cutPitches`.
  const refFam = FAMILIES[(insts[refJ] || insts[0] || {}).fam] || {};
  const power = LENGTH_POWER[refFam.vib] ?? 1;
  const scale = deriveScale(spec, { cap: Math.min(cap, 9), pull, frameSpec: radiated, power });
  // The mode: what they actually sing out of the scale they found. Its size
  // is bounded twice over — by how much scale material exists and how much
  // theory the tradition can carry (a written tradition sustains a larger
  // mode than an oral one), and by the FRAME itself, since a mode needs steps
  // wide enough to hear as separate degrees and a narrow frame simply has no
  // room for many of them.
  const roomInFrame = Math.max(3, Math.floor(scale.frame.cents / 150));
  const modeSize = Math.max(4, Math.min(7, roomInFrame,
    Math.round(3.6 + scale.degrees.length * 0.17 + people.soc.literacy * 1.4)));
  // how stepwise this people's melody is — the same value `melody.step` below
  // takes, computed here because the MODE is chosen partly by how much its
  // steps matter, and that is what stepwise motion means
  const stepShare = 0.62 + (hash32(people.seed, "mus", "step") / 4294967296) * 0.26;
  const modeIdx = deriveMode(spec, scale.degrees, modeSize, scale.frame.ratio, stepShare);
  const rhythm = rhythmOf(people, insts);
  const texture = textureOf(people, insts);
  const form = formOf(people);

  // The structural degrees — where phrases start and land — are the members
  // of the MODE the roughness curve ranked most consonant. The scale ranks
  // itself; the mode inherits that ranking.
  const ranked = modeIdx.map((si, mi) => ({ mi, prom: scale.degrees[si].prom === Infinity ? 1e9 : scale.degrees[si].prom }))
    .sort((a, b) => b.prom - a.prom).map(r => r.mi);
  const tone = people.lang ? (people.lang.prof.tone | 0) : 0;
  const roll = (tag) => hash32(people.seed, "mus", tag) / 4294967296;
  const leadWind = insts.some(i => i.drive === "breath" || i.drive === "reed") && roll("lead") < 0.6;
  const modeCents = modeIdx.map(i => scale.degrees[i].cents);
  const modeSteps = modeCents.slice(1).map((c, i) => c - modeCents[i]).concat([scale.frame.cents - modeCents[modeCents.length - 1]]);
  return {
    people, insts, spec, scale, rhythm, texture, form,
    mode: { idx: modeIdx, cents: modeCents, steps: modeSteps, size: modeIdx.length,
      finals: finalsOf(modeCents, scale.frame.cents) },
    melody: {
      structural: ranked.slice(0, Math.max(2, Math.round(modeIdx.length * 0.5))),
      // phrases descend because subglottal pressure falls across a breath —
      // the same declination the speech engine already applies to f0
      descent: 0.55 + roll("desc") * 0.3,
      // a breath bounds a phrase; a string does not
      breathBound: leadWind || texture.kind === "monophony",
      phraseBeats: (leadWind ? 4 : 6) + (form.literate ? 2 : 0),
      // a tone language cannot set a syllable against its own lexical tone
      toneBound: tone > 0, toneDepth: tone === 2 ? 1.4 : tone === 1 ? 1.15 : 1,
      step: stepShare,                        // stepwise vs leaping motion
      // a breath-led line arches harder than a string-led one, because the
      // arch IS the breath
      arch: (leadWind || texture.kind === "monophony" ? 0.5 : 0.34) + roll("arch") * 0.22,
      // Compass, in MODE steps. Melodies live inside roughly an octave and a
      // bit — the range a voice covers comfortably and an instrument is built
      // around. A line free to roam two and a half frames reads as erratic
      // rather than as a tune.
      reach: Math.max(3, Math.round(modeIdx.length * (0.7 + roll("rng") * 0.35))),
    },
    cap, pull,
  };
}
