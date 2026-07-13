// ── the areal simulation: a linguistic history in miniature ────────────────
//
// A population of tongues spawns, then BREEDS, EVOLVES, SPREADS and DIES —
// the dress rehearsal for wiring languages into the world sim. Everything
// here drives the same public APIs the sim will drive (foundLanguage /
// branchLanguage / driftLanguage / borrowFrom / adoptScriptFrom), and every
// event fires from STATE, never from the era number:
//
//   · a community grown past cohesion SPLITS (branch — population threshold)
//   · prestige flows DOWNHILL: words are borrowed from the bigger neighbour,
//     and a much bigger neighbour's SCRIPT is adopted whole (spread)
//   · a community starved below viability DIES, absorbed by its neighbour
//   · sound change accumulates steadily in every living tongue (evolve)
//
// THE INTEGRATION SEAM: the population/position model below is a test
// harness standing in for the world sim's real state. When the sim wires
// in, culture populations replace `pop`, trade/faith adjacency replaces
// `pos`, and the sim's own events call the same four verbs — the
// thresholds keep their meaning (cohesion, prestige, viability), only the
// state feeding them becomes real. Nothing else changes.
//
// Deterministic: one seeded stream per (seed, era); JSON-roundtrip-safe
// (lineage state is plain data; language records already roundtrip).

import { hash32 } from "./peopleSim/rng.js";
import { foundLanguage, branchLanguage, driftLanguage, borrowFrom } from "./language.js";
import { adoptScriptFrom, scriptOf } from "./languageScript.js";
import { applyReference } from "./languageRefs.js";

const mkRng = (seed) => {
  let s = seed >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  r.int = (n) => (r() * n) | 0;
  return r;
};

// stand-in dynamics constants — each names a real condition, not a tuning:
const SPLIT_AT = 1.7;    // cohesion ceiling: a community this far past par splits
const DIE_AT = 0.3;      // viability floor: below a third of par the community dissolves
const BORROW_OVER = 1.4; // prestige differential that starts words flowing downhill
const ADOPT_OVER = 2.2;  // the hegemon gap: a neighbour this dominant exports its script
const MATTHEW = 0.15;    // network effect: bigger communities absorb speakers faster
const CAP = 16;          // harness bound on living lineages (the sim's map is its own bound)

/** Spawn a history: `roots` is a list of shape kinds — "english", "russian",
 *  "mandarin" (pinned reference shapes) or "random". → hist */
export function foundHistory(seed, roots) {
  const world = { seed: seed >>> 0, step: 0, languages: new Map(), _nextLanguageId: 1 };
  const hist = { seed: seed >>> 0, era: 0, world, lineages: [], events: [] };
  roots.forEach((kind, i) => {
    const lang = foundLanguage(world, { seed: hash32(seed, "hist:root", i) >>> 0 });
    if (kind !== "random") applyReference(lang, kind);
    hist.lineages.push({
      id: lang.id, lang, kind, parent: null, bornEra: 0, deadEra: null,
      pop: 1, pos: i / roots.length + (hash32(seed, "hist:pos", i) % 1000) / 12000,
    });
    hist.events.push({ era: 0, type: "spawn", id: lang.id, kind });
  });
  return hist;
}

const living = (hist) => hist.lineages.filter(L => L.deadEra === null);
const circDist = (a, b) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
function nearest(hist, L) {
  let best = null, bd = Infinity;
  for (const N of living(hist)) {
    if (N === L) continue;
    const d = circDist(L.pos, N.pos);
    if (d < bd) { bd = d; best = N; }
  }
  return best;
}

/** One era: populations shift (zero-sum — communities compete), then every
 *  event that the new state licenses fires. Returns the events of this era. */
export function stepHistory(hist) {
  hist.era++;
  const era = hist.era;
  const world = hist.world;
  const rng = mkRng(hash32(hist.seed, "hist:era", era));
  const alive = living(hist);
  const before = hist.events.length;
  // fortunes shift, zero-sum: one community's rise is its neighbours' shade
  // — with the Matthew effect (a bigger community absorbs speakers faster),
  // which is what actually produces hegemons and dying tongues. A LONE
  // community has no one to compete with: its walk runs free (so a
  // single-root history can still grow past cohesion and split — a review
  // caught the renormalization pinning it to par forever), and a zero
  // total must not NaN-poison the pool.
  for (const L of alive) L.pop *= Math.exp((rng() - 0.5) * 0.7 + MATTHEW * Math.log(Math.max(L.pop, 1e-6)));
  const total = alive.reduce((a, L) => a + L.pop, 0);
  if (alive.length >= 2 && total > 0) for (const L of alive) L.pop *= alive.length / total;
  for (const L of [...alive]) {
    if (L.deadEra !== null) continue;
    // EVOLVE: sound change accumulates steadily in every living tongue
    if (rng() < 0.65) { driftLanguage(world, L.lang); hist.events.push({ era, type: "drift", id: L.id }); }
    // BREED: a community grown past cohesion splits into two
    if (L.pop >= SPLIT_AT && living(hist).length < CAP) {
      world.step += 100;
      const child = branchLanguage(world, L.lang, 0.3 + rng() * 0.4);
      const K = {
        id: child.id, lang: child, kind: L.kind, parent: L.id, bornEra: era, deadEra: null,
        pop: L.pop * 0.4, pos: (L.pos + (rng() - 0.5) * 0.12 + 1) % 1,
      };
      L.pop *= 0.6;
      hist.lineages.push(K);
      hist.events.push({ era, type: "branch", id: child.id, from: L.id });
    }
    // SPREAD: prestige flows downhill from the bigger nearest neighbour
    const N = nearest(hist, L);
    if (N) {
      const ratio = N.pop / Math.max(0.01, L.pop);
      if (ratio > BORROW_OVER && rng() < 0.5) {
        borrowFrom(world, L.lang, N.lang);
        hist.events.push({ era, type: "borrow", id: L.id, from: N.id });
      }
      // the hegemon exports its whole script — unless this tongue's script
      // is pinned scenario data (a reference shape keeps its costume)
      if (ratio > ADOPT_OVER && !L.lang.prof.script && rng() < 0.35) {
        const mine = scriptOf(L.lang), theirs = scriptOf(N.lang);
        if (mine && theirs && mine.styleSeed !== theirs.styleSeed) {
          adoptScriptFrom(L.lang, N.lang);
          hist.events.push({ era, type: "adopt", id: L.id, from: N.id });
        }
      }
      // DIE: starved below viability, absorbed by the neighbour
      if (L.pop < DIE_AT) {
        L.deadEra = era;
        N.pop += L.pop;
        hist.events.push({ era, type: "death", id: L.id, into: N.id });
      }
    }
  }
  return hist.events.slice(before);
}

/** Convenience: spawn + run `eras` eras in one call. */
export function runHistory(seed, roots, eras) {
  const hist = foundHistory(seed, roots);
  for (let i = 0; i < eras; i++) stepHistory(hist);
  return hist;
}

/** The ancestor chain of a lineage, root-first (for the Lab's family view). */
export function ancestryOf(hist, id) {
  const byId = new Map(hist.lineages.map(L => [L.id, L]));
  const chain = [];
  let cur = byId.get(id);
  while (cur) { chain.unshift(cur); cur = cur.parent !== null ? byId.get(cur.parent) : null; }
  return chain;
}
