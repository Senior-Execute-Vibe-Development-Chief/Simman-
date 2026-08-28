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
//   tuning     ← archetype match on those spectra (musicArchetypes.js)
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
import { MATERIALS, FAMILIES, makeInstrument, melodicCapacity, CARRIES } from "./musicInstruments.js";
import { ensembleSpectrum, deriveScale, deriveMode, finalsOf, LENGTH_POWER } from "./musicTuning.js";
import { applyTuningArchetype, ARCHETYPE_TUNING_ON, matchTuningArchetype } from "./musicArchetypes.js";
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
  // Heterophony needs enough players that doubling the line is audible as
  // several versions, not as mud — size >= 4 handed it to almost every
  // settled people and stacked elab + het + voice on the same degrees.
  const kind = size >= 7 && people.soc.literacy > 0.6 ? "polyphony"
    : size >= 5 ? "heterophony"
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
  // AND "CANNOT BE RETUNED" IS A PROPERTY, not a list of four family names.
  // `pitchBy: "fixed"` means one resonator per pitch — the next note is a
  // different object, so there is nothing to slide along and nothing to lip.
  // That is the definition, and this test used to be the names barSet, bell,
  // gong and lamella, written when the table held fourteen families. It now
  // holds twenty-two: a santur, a koto, a raft of panpipes and a sheng are all
  // exactly as un-retunable as a cast bar set and every one of them was
  // invisible here. The body also has to specify pitches at all — a rattle and
  // a pair of clappers are fixed in the same sense and have nothing to offer a
  // tuning.
  const isFixed = (i) => (FAMILIES[i.fam] || {}).pitchBy === "fixed" && i.cap >= 3;
  const refI = insts.findIndex(isFixed);
  const refJ = refI >= 0 ? refI : insts.findIndex(i => i.cap >= 3);
  const tuneW = insts.map((i, k) => i.weight * (k === refJ ? 5 : 1));
  // AND THE SINGER IS IN THIS ROOM TOO.
  //
  // `makeVoice` states the case in its own comment and this line did not act on
  // it: a culture's ear is calibrated on the spectrum it hears most, and the
  // spectrum it hears most is a human throat. The singer was added to the
  // ensemble that decides the FRAME, for exactly that reason, and octave
  // equivalence stopped being negotiable. Then the degrees — the part a
  // listener actually names — went on being decided by the built bodies alone.
  //
  // The consequence is measurable and it is what gets reported by ear. Judged
  // across five peoples: the two that sound wrong have 1 of 4 and 0 of 3 of
  // their degrees on a ratio anyone has a name for, the two that sound right
  // have 4 of 4 and 2 of 4. The curve's DEPTH separated none of them — 0.193 to
  // 0.226 across all five — so this is not about how much consonance structure
  // there is, it is about whether the structure is one a human ear shares. A
  // spectrum with no octave in it has no fifth either, and a scale derived from
  // it lands between every note a listener knows.
  //
  // One member's weight, the same as for the frame, and that limit is the
  // point: it must not be able to outvote the ensemble. A gamelan's degrees
  // still come from its metal — that is the whole premise, and pelog is not a
  // just scale — but they are chosen by people who can also sing.
  // ONE SINGER, AND DELIBERATELY THE SAME ONE FOR EVERY PEOPLE — which is a
  // known cost, recorded here because two ways of varying it were tried and
  // both were worse.
  //
  // A flat 220 Hz means every culture hears the same throat, so every culture
  // finds its consonances in the same places and the corpus converges: 24% of
  // modes distinct across 240 peoples. Real voices differ and this engine
  // derives by how much, so giving each people its own seemed obviously right.
  // Measured, it is not. Reading the pitch off `voiceRange`'s floor the way
  // `ensembleSpectrum` reads a body's — floor times 1.5 — drops the singer a
  // fifth below the instruments, and roughness is critical-band dependent, so
  // it is not the same measurement: stranded pitches went from 11 to 139 and
  // peoples with a fifth from 94% to 63%. Keeping the register and moving it
  // only by `f0k`, the +-15% the language model actually knows, still cost 89%
  // of degrees standing in a dip down to 81%.
  //
  // The reason is the mechanism working: the singer pulls the minima ONTO the
  // simple ratios precisely by being harmonic and in the ensemble's register.
  // Moving them adds error, not variety. Whatever restores the world's variety
  // has to come from the bodies, which is where the differences between real
  // traditions come from anyway — not from detuning the one thing every people
  // shares.
  const voiceHere = Array.from({ length: 10 }, (_, i) => ({ f: 220 * (i + 1), a: Math.pow(0.82, i) }));
  const spec = ensembleSpectrum(insts, tuneW)
    .concat(voiceHere.map(p2 => ({ f: p2.f, a: p2.a * 0.34 })));
  // …but the reference's authority is over WHERE THE DEGREES SIT, not over
  // whether the octave exists. What interval a people's music repeats at is a
  // question about everything they actually play, at the shares they play it
  // in — so the frame is read off the plain radiating ensemble. (See the note
  // in deriveScale: with the reference amplified into this decision too, one
  // minority bar set could put a string-and-pipe culture's octave at a minor
  // sixth, in 12 peoples out of 100.)
  // …AND THE ENSEMBLE INCLUDES THE SINGER. Every people in this world has a
  // voice — `instrumentariumOf` says so in as many words, and `ensembleFor`
  // gives one to every piece — and the voice was the one member missing from
  // this spectrum, because it is not a body anyone builds and so never
  // appeared in the list of bodies.
  //
  // It matters here more than anywhere, because what this spectrum decides is
  // the FRAME: the interval a people's music repeats at. A bar set genuinely
  // has no octave — its partials run 1 : 2.756 : 5.404 and nothing reinforces
  // 2 : 1 — so a metal-led ensemble asked on its own where to repeat answers
  // somewhere else entirely. Measured, ten peoples in a hundred and fifty-nine
  // came back repeating at 911, 987 or 1004 cents, and five of those are the
  // five whose music measures worst in the whole corpus: folding a line into a
  // body's range across a 911-cent frame moves its pitch class by 289 cents
  // every time it wraps, so two instruments an octave apart were not playing
  // the same note.
  //
  // Real metallophone traditions repeat at the octave regardless, and the
  // reason is not in the metal. Octave equivalence is a fact about EARS, and
  // it comes from the harmonic series of the voice — which every gamelan
  // player also owns. So the singer joins the ensemble that decides this, at
  // one member's weight, and cannot be outvoted by a body nobody can sing.
  const voiceSpec = voiceHere;
  const radiated = ensembleSpectrum(insts, insts.map(i => i.weight))
    .concat(voiceSpec.map(p2 => ({ f: p2.f, a: p2.a * 0.34 })));
  // how many pitches the ensemble can actually sound: the best-endowed
  // melodic body sets the ceiling. A six-hole pipe tradition stays pentatonic
  // because of the pipe, not because anyone chose pentatonicism.
  const melodic = insts.filter(i => i.cap >= 3);
  // HOW MANY PITCHES A BODY OFFERS INSIDE ONE FRAME, which is not how many it
  // has — and `cap` is how many it has. The difference is the whole of why a
  // koto tradition is pentatonic: `rangeOf`'s own comment says a seven-bar
  // balafon covers an octave and a thirteen-string koto two and a half, so
  // those thirteen strings are five to the octave, not thirteen.
  //
  // Handing the raw count to `deriveScale` asked for nine degrees in an octave
  // from ensembles whose widest body offered six. Measured on seed 1041, that
  // produced 0 158 315 443 597 718 837 960 1079 — a chromatic ladder, from
  // which no subset is a mode.
  //
  // How the count converts depends on how the body chooses its pitches, which
  // this file already models:
  //   "hole"  — fixed apertures. The fingerings give this many pitches in a
  //             register and then REPEAT on the overblow, so the count is
  //             already per frame. A six-hole pipe tradition stays pentatonic
  //             because of the pipe, exactly as claimed.
  //   "stop"  — one length shortened by a finger. The stops are spread along
  //             the whole compass, so a fourteen-stop neck over 2.2 octaves
  //             offers 6.4 in one of them.
  //   "fixed" — one resonator per pitch, and the maker cuts as many as the
  //             scale has. Such a body is BUILT to the scale: it reflects the
  //             density rather than bounding it, and so it does not vote.
  // (The conversion is in octaves rather than frames. Since the singer joined
  // the frame spectrum, 118 peoples in 120 repeat at one.)
  const perFrame = (i) => {
    const f = FAMILIES[i.fam] || {};
    if (f.pitchBy === "hole") return i.cap;
    if (f.pitchBy === "stop" && f.span) return i.cap / f.span;
    return 0;
  };
  const offered = melodic.length ? Math.max(0, ...melodic.map(perFrame)) : 0;
  // Where nothing bounds it — an ensemble of bars and lyres, every one of them
  // built to whatever scale the people already had — the spectrum and the gap
  // rule decide between them, which is what `deriveScale` does when `cap` is
  // not the binding constraint.
  const cap = offered > 0 ? Math.round(offered) : 9;
  // a literate tradition with fixed-pitch instrument SETS regularizes its
  // steps; an oral one keeps the ratios it found
  // A FIXED-PITCH SET MAKES A TUNING STABLE, NOT EQUAL — and this term said
  // equal. Owning a bar set contributed 0.25 all by itself, which is the whole
  // of the -0.25 offset, so ANY people who had cast a set of bars was pulled
  // toward equal division of their frame no matter how little else they had:
  // measured, 78% of peoples had a nonzero pull, mean 0.232, and it slid every
  // degree 8 to 20 cents off the dip it had just been chosen for. Which is
  // exactly the fault a listener reports — a vertical line that no longer
  // stands in a dip — arriving after all the work of finding the dip.
  //
  // Two things wrong with it. Equal division is "the ANSWER written down", in
  // the words of the invention loop that was rewritten to stop producing it,
  // so one half of this system removes equal temperament as a mechanism while
  // the other re-imposes it at the end. And a set of cast bars is the archetype
  // of a FIXED tuning, not an equal one: slendro is near-equal at 0.06 relative
  // spread and pelog is the most unequal thing on the bench at 0.35, and both
  // are played on bronze that cannot be retuned.
  //
  // What actually equalises a tuning is wanting to play the same thing from
  // more than one starting degree — which is why keyboards and written notation
  // drove temperament and why traditions that never move their tonic never
  // needed it. Of the drivers here, literacy and a standardising administration
  // are that; the metal is not. (`fixedSets` was also still the two family
  // names `barSet` and `bell`, the same list `isFixed` above stopped using.)
  const pull = Math.max(0, Math.min(0.85, people.soc.literacy * 0.5 + people.know.organization * 0.2 - 0.25));
  // AND THE BODY THE SCALE IS CUT FROM is the one everybody tunes to — the
  // same instrument chosen just above, for the same reason. Where its timbre
  // offers no consonance to find, what is left is its GEOMETRY: how its pitch
  // answers to its own length, which is 1/L for a string or a bore and 1/L²
  // for a bar. See `cutPitches`.
  const refFam = FAMILIES[(insts[refJ] || insts[0] || {}).fam] || {};
  const power = LENGTH_POWER[refFam.vib] ?? 1;
  const rawScale = deriveScale(spec, { cap: Math.min(cap, 9), pull, frameSpec: radiated, power });
  const scale = ARCHETYPE_TUNING_ON
    ? applyTuningArchetype(rawScale, matchTuningArchetype({
      spec, radiated, cap: Math.min(cap, 9), pull, power, insts, seed: people.seed, refJ,
    }))
    : rawScale;
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
  // WHICH BODY WILL STATE THE TUNE. `ensembleFor` decides this every bar, by
  // exactly this rule — capability is a threshold and centrality is the ranking
  // — and the melody's compass is a property of that body, so the same rule has
  // to be answerable here. One note long enough for the body to be judged on is
  // the tradition's own grid step: a beat over its subdivision.
  const noteSecs = (60 / Math.max(1, rhythm.tempo)) / Math.max(1, rhythm.div || 2);
  const carrier = insts.filter(i => melodicCapacity(i, noteSecs) > CARRIES)
    .sort((a, b) => b.weight - a.weight)[0] || null;
  const modeCents = modeIdx.map(i => scale.degrees[i].cents);
  const modeSteps = modeCents.slice(1).map((c, i) => c - modeCents[i]).concat([scale.frame.cents - modeCents[modeCents.length - 1]]);
  return {
    people, insts, spec, scale, rhythm, texture, form,
    // which body everybody tuned to — read by `ensembleFor`, because the
    // instrument that cannot follow anyone else is usually the one that states
    // the melody
    tuneRef: refJ >= 0 ? refJ : null,
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
      // COMPASS, in MODE STEPS — the smaller of two things, and it was neither.
      //
      // The old line rolled 0.7 to 1.05 FRAMES off the mode's size, which is
      // narrower than a person naturally sings and narrower than every tradition
      // on the bench: measured over 240 peoples, the derived line lived in four
      // degrees where the pinned ones spread over 5.5 to 8.3, and inside a band
      // that small there are so few intervals available that the same ones keep
      // coming back — figure reuse ran 0.10 against the bench's 0.02 to 0.07.
      // A tune that shuffles inside a fifth and repeats itself is what "wanders
      // and goes nowhere" sounds like, and the comment above the line already
      // said "an octave and a bit" while the code said less than an octave.
      //
      // What actually bounds a melody is TWO limits, and a tune takes whichever
      // bites first:
      //
      //   THE BODY. A nine-fingering chanter has nine notes, so a pipe tune has
      //   a compass of nine notes — which is why Irish fiddle tunes stay inside
      //   the pipe compass on an instrument that could go half an octave further
      //   either way. `cap` is that pitch count and this file already calls it
      //   "the melodic body sets the ceiling".
      //
      //   WHAT READS AS ONE TUNE. Roughly a tenth to a twelfth — 1.4 to 1.6
      //   octaves — beyond which a line stops being heard as one shape and
      //   starts being heard as wandering. This was first written down here as
      //   the SINGER's comfortable compass, and that was wrong: it is the same
      //   bound whether or not anybody opens their mouth. The evidence is the
      //   bench itself. Five of its seven entries are led by a guqin, a sitār,
      //   an oud and a koto, every one of which reaches two octaves or more,
      //   and every one of them declares a reach inside this band anyway. Not
      //   one of those numbers is a singer's. What limits them is a listener.
      //
      // Checked against all seven pinned traditions, which declare their reach
      // as data: every one falls inside min(cap, 1.4-1.6 frames), and the pipes
      // — the only body-bound entry — land on exactly their nine.
      reach: Math.max(3, Math.round(Math.min(
        carrier ? carrier.cap : modeIdx.length * 2,
        modeIdx.length * (1.4 + roll("tess") * 0.22)))),
    },
    cap, pull,
  };
}
