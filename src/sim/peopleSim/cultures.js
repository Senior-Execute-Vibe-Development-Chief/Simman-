// ── Cultures: peoples as persistent entities ──
//
// A culture is a people — a named identity with its own naming language,
// carried BY population. Settlements hold a top-k culture MIXTURE
// (s.culMix = [[cultureId, share], ...], shares summing to 1, dominant
// first) so conquest does not change who lives somewhere: a captured city
// keeps its people, and only generations of assimilation shift the mix.
//
// Genesis: each cradle founds a culture. Lineage: new settlements carry
// their parent's (or knowledge-donor's) culture. Drift: an isolated
// overseas colony that loses living contact with its homeland diverges
// into a daughter culture; subject peoples assimilate slowly toward
// their ruler's culture at a rate set by the state's organization.
//
// Cultures never die — a people can fade from every mixture, but the
// record (and its history) persists.

import { foundLanguage, branchLanguage, driftLanguage, borrowFrom, getLanguage, langWord, langPlaceName, langRealmName, langPersonName, langDynastyName } from "../language.js";
import { hash32, entityRng } from "./rng.js";
import { logEvent } from "./events.js";
import { getPolity } from "./entities.js";
import { forEachNear } from "./spatialGrid.js";

export const CULTURE_INTERVAL = 150;      // ticks between assimilation/divergence passes (≈ polity cadence)
// Language standardizes FAST enough to flip a core province within a realm's
// lifetime (realms rise and fall — too slow and the political map churns before
// any tongue consolidates, so the Languages map never pulls away from Peoples).
const ASSIM_RATE = 0.05;                  // per-pass share shift of SPEECH toward the prestige language (×org, ×distFactor)
const CULTURE_LAG = 0.10;                 // ethnic identity assimilates at only this fraction of the language rate (people lag tongue by generations)
const DIVERGE_AFTER = 6000;               // ticks of overseas isolation before a colony's culture diverges
// Political ethnogenesis: a people fragments along durable STATE lines even WITHOUT
// isolation — the post-Roman Latin world becoming France/Spain/Italy, rather than
// one connected megapeople. (Without this, a well-connected landmass never loses
// contact, so the whole Mediterranean rim reads as a single people — the inverse
// of reality, where connectivity made it the most ethnically varied region.)
const ETHNO_AFTER    = 9000;              // ticks a region must sit under its own durable, language-shifted state before its people forks
const ETHNO_LANG_MIN = 0.5;              // …and at least this share already speaking that state's prestige tongue
const ETHNO_MIN_BLOC = 3;                // …and be a real region (≥ this many settlements), not a lone town
const MIX_K = 4;                          // mixture components kept per settlement (rest folds into dominant)

export function culturesOf(world) {
  return world.cultures || (world.cultures = new Map());
}
export function getCulture(world, id) {
  return id != null && id >= 0 && world.cultures ? world.cultures.get(id) || null : null;
}

// A culture's tongue is a LIVING entity (world.languages, language.js):
// it drifts, branches when peoples diverge, and borrows under contact.
export function languageOf(world, culture) {
  let l = getLanguage(world, culture.languageId);
  if (!l) {
    l = foundLanguage(world, { seed: culture.langSeed });
    culture.languageId = l.id;
  }
  return l;
}

/** Coin a name in this culture's tongue; the per-culture counter keeps
 *  names order-independent and (within a world) collision-free. */
export function nameFor(world, culture, kind, base) {
  const lang = languageOf(world, culture);
  const n = culture.nameCounter++;
  if (kind === "realm") return langRealmName(lang, n, base);
  if (kind === "person") return langPersonName(lang, n, base === "f");
  if (kind === "dynasty") return langDynastyName(lang, n, base);
  if (kind === "settlement") return langPlaceName(lang, n);
  return langWord(lang, n);
}

export function foundCulture(world, { origin, parentCultureId = -1, divergence = 0.5, branchFromLangId = -1 } = {}) {
  const reg = culturesOf(world);
  const id = world._nextCultureId || 1;
  world._nextCultureId = id + 1;
  const langSeed = hash32(world.seed || 1, "lang", id);
  // The FAMILY (stock): the cradle ancestor this people descends from. A
  // "people" here is an ETHNOLINGUISTIC group (shared tongue, names, identity)
  // — not a genetic race; its family is the broad stock it branched from (the
  // Indo-European / Bantu / Semitic level), so the Peoples view nests
  // people-within-family the way real ethnography does.
  const parentRec = parentCultureId >= 0 ? getCulture(world, parentCultureId) : null;
  const rootCultureId = parentRec ? (parentRec.rootCultureId ?? parentRec.id) : id;
  const c = {
    id, langSeed, languageId: -1,
    name: null,
    parentCultureId, rootCultureId,
    // how far this people stands from its parent at founding (1 for a root) —
    // a deep branch carries its own gods, a near dialect shares the parent's
    divergence: parentCultureId >= 0 ? divergence : 1,
    originSettlementId: origin ? origin.id : -1,
    foundedStep: world.step | 0,
    nameCounter: 1,
    hue: (id * 137.508) % 360,            // golden-angle spread
  };
  // The tongue: an isolated daughter BRANCHES from its PARENT people's tongue (a
  // dialect hardening into a language); a politically-forked nation branches the
  // PRESTIGE language it already speaks (branchFromLangId — Old French hardening
  // out of the realm's Latin); a root people gets a fresh one.
  const parent = getCulture(world, parentCultureId);
  const branchBase = branchFromLangId >= 0 ? getLanguage(world, branchFromLangId)
                   : (parent ? languageOf(world, parent) : null);
  const lang = branchBase ? branchLanguage(world, branchBase, divergence) : foundLanguage(world, { seed: langSeed });
  c.languageId = lang.id;
  // A culture names ITSELF in its own tongue (endonym) — and never shares
  // another people's name (collisions read as bugs, not history).
  let nm = langWord(lang, 0), tries = 1;
  const taken = new Set([...reg.values()].map(x => x.name));
  while (taken.has(nm) && tries < 12) nm = langWord(lang, tries++);
  c.name = nm;
  reg.set(id, c);
  logEvent(world, "culture.born", {
    culture: id, cultureName: c.name,
    parent: parentCultureId, parentName: parentCultureId >= 0 ? (getCulture(world, parentCultureId) || {}).name : undefined,
    s: origin ? origin.id : -1,
    x: origin ? origin.pos.x | 0 : undefined, y: origin ? origin.pos.y | 0 : undefined,
  });
  return c;
}

// The family (stock) a people belongs to: walk up to the cradle ancestor.
export function familyOf(world, cultureId) {
  let cul = getCulture(world, cultureId);
  if (!cul) return -1;
  if (cul.rootCultureId != null) return cul.rootCultureId;
  let hops = 0;
  while (cul.parentCultureId >= 0 && hops++ < 16) {
    const up = getCulture(world, cul.parentCultureId);
    if (!up) break; cul = up;
  }
  return cul.id;
}
// The culture whose FOLK FAITH a people practises: walk up the lineage to
// the first "anchor" — a root, or a branch divergent enough to have grown its
// own gods (FOLK_SPLIT). So near dialects share a broad ancestral religion
// (the faith map stays broad), but a deeply-diverged people — or an
// independent origin — worships on its own (the user's Europe-vs-Nile case).
const FOLK_SPLIT = 0.5;
export function folkAnchorOf(world, cultureId) {
  let cul = getCulture(world, cultureId);
  if (!cul) return cultureId;
  let hops = 0;
  while (hops++ < 24) {
    if (cul.parentCultureId < 0 || (cul.divergence ?? 1) >= FOLK_SPLIT) return cul.id;
    const up = getCulture(world, cul.parentCultureId);
    if (!up) return cul.id;
    cul = up;
  }
  return cul.id;
}
export function familyName(world, cultureId) {
  const root = getCulture(world, familyOf(world, cultureId));
  if (!root) return "?";
  // a family is named for its stock with a "-ic" stem (Velaric, Kuvic…) —
  // only strip a trailing vowel from longer names, so short roots like "Ga"
  // and "Go" don't both collapse to the same "Gic".
  const base = root.name.length > 4 ? root.name.replace(/(a|e|i|o|u|ia|ua)$/i, "") : root.name;
  return base + "ic";
}

// ── population mixture helpers ───────────────────────────────────────────
export function dominantCulture(s) {
  return s.culMix && s.culMix.length ? s.culMix[0][0] : (s.cultureId ?? -1);
}

function normalizeMix(mix) {
  mix.sort((a, b) => b[1] - a[1]);
  if (mix.length > MIX_K) {   // fold the tail into the dominant share
    let tail = 0;
    for (let i = MIX_K; i < mix.length; i++) tail += mix[i][1];
    mix.length = MIX_K;
    mix[0][1] += tail;
  }
  let sum = 0;
  for (const e of mix) sum += e[1];
  if (sum > 0 && Math.abs(sum - 1) > 1e-9) for (const e of mix) e[1] /= sum;
  return mix;
}

/** Shift `frac` of a settlement's people toward culture `cid`. */
export function mixToward(s, cid, frac) {
  if (cid == null || cid < 0 || !(frac > 0)) return;
  if (!s.culMix) s.culMix = [[s.cultureId ?? cid, 1]];
  const mix = s.culMix;
  const scale = 1 - frac;
  let entry = null;
  for (const e of mix) { e[1] *= scale; if (e[0] === cid) entry = e; }
  if (entry) entry[1] += frac; else mix.push([cid, frac]);
  normalizeMix(mix);
  s.cultureId = mix[0][0];
}

// ── language layer (a settlement's SPOKEN tongue, separate from its people) ──
// Language is its OWN population layer (s.langMix = [[languageId, share],...]),
// not a 1:1 readout of the people. It begins as the people's own tongue, but
// shifts FASTER than ethnic identity under state prestige: a conquered province
// comes to speak its ruler's (the capital's) language while remaining its own
// people for generations. So the Languages map shows realm-spanning prestige
// tongues crossing the slower ethnic (Peoples) map — the way Latin, Arabic,
// Turkish and English each spread across many distinct peoples in reality.
export function dominantLanguage(s) {
  return s.langMix && s.langMix.length ? s.langMix[0][0] : -1;
}
/** The languageId a culture natively carries (its own tongue). */
export function langIdOfCulture(world, cultureId) {
  const cul = getCulture(world, cultureId);
  return cul ? languageOf(world, cul).id : -1;
}
/** Share of a settlement's speakers using language `lid` (0 if none). */
function langShareOf(s, lid) {
  if (lid < 0 || !s.langMix) return 0;
  for (const e of s.langMix) if (e[0] === lid) return e[1];
  return 0;
}
/** Shift `frac` of a settlement's SPEAKERS toward language `lid`. */
export function mixLangToward(s, lid, frac) {
  if (lid == null || lid < 0 || !(frac > 0)) return;
  if (!s.langMix || !s.langMix.length) { s.langMix = [[lid, 1]]; return; }
  const mix = s.langMix, scale = 1 - frac;
  let entry = null;
  for (const e of mix) { e[1] *= scale; if (e[0] === lid) entry = e; }
  if (entry) entry[1] += frac; else mix.push([lid, frac]);
  normalizeMix(mix);
}
/** Seed a settlement's spoken language from its dominant people, if unset. */
export function seedLangFromCulture(world, s) {
  if (s.langMix && s.langMix.length) return;
  const lid = langIdOfCulture(world, dominantCulture(s));
  if (lid >= 0) s.langMix = [[lid, 1]];
}

/** Initialize a newborn settlement's culture (and spoken tongue) from its founder stock. */
export function seedCulture(world, s, cultureId) {
  s.cultureId = cultureId ?? -1;
  s.culMix = cultureId != null && cultureId >= 0 ? [[cultureId, 1]] : [];
  if (!s.faithMix) s.faithMix = [];
  // spoken language starts as the founding people's tongue; it diverges later
  // from the people under state prestige (above) — they are separate layers.
  const lid = cultureId != null && cultureId >= 0 ? langIdOfCulture(world, cultureId) : -1;
  s.langMix = lid >= 0 ? [[lid, 1]] : [];
}

// ── the periodic culture pass ───────────────────────────────────────────
// Two SEPARATE layers move here, at different speeds — which is what keeps the
// Languages map from being a recolour of the Peoples map:
//   • LANGUAGE (s.langMix) standardizes toward the capital's prestige tongue,
//     pulled by the state's ORGANIZATION/literacy and decaying with transport
//     distance from the capital (heartland fast, marches slow). A conquered
//     province adopts its ruler's language across the whole realm.
//   • PEOPLE (s.culMix) — ethnic identity — assimilates toward the ruling people
//     FAR more slowly, and only as fast as the language has ALREADY shifted, so
//     identity LAGS the tongue by generations (the Irish stayed Irish speaking
//     English; Gaul spoke Latin long before it felt Roman).
// Divergence: an overseas colony out of living contact with its own people for
// DIVERGE_AFTER ticks becomes a NEW people with a NEW tongue (daughter culture).
const LANG_DRIFT_EVERY = 2600;     // ≈ ticks between sound changes per tongue
export function updateCultures(world) {
  // ── living languages: slow sound change; borrowing under contact ──
  if (world.cultures) {
    for (const cul of world.cultures.values()) {
      const lang = languageOf(world, cul);
      const due = (cul._lastDrift ?? cul.foundedStep) + LANG_DRIFT_EVERY / (world._dt || 1);
      if (world.step >= due) {
        cul._lastDrift = world.step;
        const before = langWord(lang, 1);
        driftLanguage(world, lang);
        logEvent(world, "language.shift", { culture: cul.id, cultureName: cul.name,
          was: before, now: langWord(lang, 1) });
      }
    }
    // contact: a settlement whose population is a real MIXTURE of two
    // peoples lets the larger group's tongue borrow from the smaller's.
    for (const s of world.settlements) {
      if (s.mode !== "settled" || !s.culMix || s.culMix.length < 2) continue;
      if (s.culMix[1][1] < 0.25) continue;
      if ((s._lastBorrow ?? 0) + 6000 / (world._dt || 1) > world.step) continue;
      const a = getCulture(world, s.culMix[0][0]), b = getCulture(world, s.culMix[1][0]);
      if (!a || !b) continue;
      s._lastBorrow = world.step;
      borrowFrom(world, languageOf(world, a), languageOf(world, b));
    }
  }
  // (Called every _ivl(CULTURE_INTERVAL) ticks — the interval stretches with
  // SIM_GRANULARITY, so per-pass rates below stay calibrated per history-time.)
  // refresh each polity's culture from its capital's dominant people, and read
  // off the capital's prestige LANGUAGE (the standardization target for the realm)
  const capLangByCountry = new Map();
  if (world.countries) {
    for (const c of world.countries.values()) {
      const p = getPolity(world, c.id);
      if (p && c.capital) p.cultureId = dominantCulture(c.capital);
      if (c.capital) { seedLangFromCulture(world, c.capital); capLangByCountry.set(c.id, dominantLanguage(c.capital)); }
    }
  }
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    if (!s.culMix || !s.culMix.length) continue;
    seedLangFromCulture(world, s);                 // ensure a spoken-language layer exists

    // ── state prestige: the LANGUAGE shifts, then the PEOPLE slowly follow ──
    if (s.countryId >= 0) {
      const ctry = world.countries && world.countries.get(s.countryId);
      const capS = ctry && ctry.capital;
      const org = capS && capS.knowledge ? (capS.knowledge.organization || 0) : 0;
      // Transport-distance decay: _capCost is the capital-relative transport cost
      // stamped by the polity pass (conquest.js), in the realm's grip units
      // (holdReach). A province AT the edge of reach standardizes at ~half rate;
      // one well beyond it (a far march, an overseas holding, the wrong side of a
      // range) barely at all — the heartland Latinizes, the frontier keeps its speech.
      const reach = ctry ? Math.max(8, ctry.holdReach || ctry.range || 20) : 20;
      const cost = s._capCostId === s.countryId ? s._capCost : reach;   // stale / unstamped → assume mid-reach
      const x = isFinite(cost) ? cost / reach : 6;                      // unreachable ⇒ far out on the curve (tiny pull)
      const distFactor = 1 / (1 + x * x);                              // 1 at the capital, 0.5 at the edge, →0 in the marches

      // LANGUAGE → the capital's prestige tongue (the visible, faster layer). This
      // is what flattens a dialect continuum into a STEP at a political border, and
      // spreads a conqueror's language across its subject peoples ("a language is a
      // dialect with an army and a navy").
      const capLang = capLangByCountry.has(s.countryId) ? capLangByCountry.get(s.countryId) : -1;
      if (capLang >= 0 && langShareOf(s, capLang) < 1) {
        mixLangToward(s, capLang, ASSIM_RATE * (0.4 + org) * distFactor);
      }

      // PEOPLE → the ruling people, but only AS FAST AS the tongue has already
      // shifted (langShare) and at a fraction (CULTURE_LAG) of the language rate, so
      // ethnic identity TRAILS the language by generations and the Peoples map stays
      // distinct from the Languages map (a conquered people keeps its name long
      // after it adopts the ruler's speech).
      const p = getPolity(world, s.countryId);
      const stateCul = p ? p.cultureId : -1;
      if (stateCul >= 0 && capLang >= 0 && dominantCulture(s) !== stateCul) {
        const langShare = langShareOf(s, capLang);
        if (langShare > 0) mixToward(s, stateCul, ASSIM_RATE * CULTURE_LAG * (0.4 + org) * distFactor * langShare);
      }
    }

    // divergence: ANY community out of living contact with its own people
    // becomes a people of its own in time (overseas colonies fastest —
    // an ocean is the sharpest isolator).
    if (!s._diverged) {
      const myCul = dominantCulture(s);
      let contact = false;
      if (s._tradeReach) {
        for (const pid of s._tradeReach.keys()) {
          const peer = world._byId && world._byId.get(typeof pid === "number" ? pid : +pid);
          if (peer && peer.mode === "settled" && dominantCulture(peer) === myCul && peer.id !== s.id) { contact = true; break; }
        }
      }
      if (!contact && s._seaReach) {
        for (const pid of s._seaReach.keys()) {
          const peer = world._byId && world._byId.get(typeof pid === "number" ? pid : +pid);
          if (peer && peer.mode === "settled" && dominantCulture(peer) === myCul && peer.id !== s.id) { contact = true; break; }
        }
      }
      if (contact) { s._isolatedSince = undefined; continue; }
      if (s._isolatedSince === undefined) { s._isolatedSince = world.step; continue; }
      const divAfter = (s._isColony ? DIVERGE_AFTER : DIVERGE_AFTER * 2.2) / (world._dt || 1);
      if (world.step - s._isolatedSince > divAfter) {
        const parent = getCulture(world, myCul);
        const daughter = foundCulture(world, { origin: s, parentCultureId: myCul,
          divergence: s._isColony ? 0.85 : 0.6 });
        // language relationship is implicit: daughter seeds a fresh tongue,
        // history records the lineage (parentCultureId + culture.born event)
        seedCulture(world, s, daughter.id);
        s._diverged = true;
        // the new people's homeland: same-stock neighbours join the daughter
        forEachNear(world, s.pos.x, s.pos.y, 16, (nb) => {
          if (nb !== s && nb.mode === "settled" && dominantCulture(nb) === myCul) {
            seedCulture(world, nb, daughter.id);
            nb._diverged = true;
          }
        });
        logEvent(world, "culture.diverged", {
          culture: daughter.id, cultureName: daughter.name,
          parent: myCul, parentName: parent ? parent.name : undefined,
          s: s.id, sName: s.name, polity: s.countryId,
        });
      }
    }
  }

  // ── political ethnogenesis: a people fragments along DURABLE state lines ──
  // The isolation path above needs a community to lose ALL living contact, so a
  // big, well-connected landmass (the Mediterranean rim) never splits and reads as
  // one megapeople. But peoples also differentiate WITHOUT isolation, along
  // POLITICS: a region held by its own durable state, away from its people's
  // demographic core and already speaking that state's prestige tongue, hardens
  // over generations into a NEW people centred on the state — France/Spain/Italy
  // out of the post-Roman Latin world. Transient conquest forks nothing (the timer
  // resets the moment a region rejoins its core or its realm collapses); only
  // sustained distinct statehood does. The largest block keeps the parent identity;
  // each durably-separated block becomes its own nation, speaking a branch of the
  // tongue it adopted — so the Peoples map fragments boldly while the Languages map
  // shows the daughters as one family (French/Spanish/Italian are all Romance).
  if (world.countries && world.countries.size) {
    // each people's CORE country = where most of it lives; that block stays the parent
    const core = new Map();          // cultureId → { country, pop }
    const popCC = new Map();         // `cid|country` → pop
    for (const s of world.settlements) {
      if (s.mode !== "settled" || s.countryId < 0) continue;
      const cid = dominantCulture(s); if (cid < 0) continue;
      const key = cid + "|" + s.countryId;
      const pop = (popCC.get(key) || 0) + Math.max(1, s.people || 0);
      popCC.set(key, pop);
      const c0 = core.get(cid);
      if (!c0 || pop > c0.pop) core.set(cid, { country: s.countryId, pop });
    }
    // per-settlement durability timer for "exiled from the core + language-shifted",
    // tallying the (people, country) blocks that have stayed that way long enough
    const blocs = new Map();         // `cid|country` → { cid, k, seed, n }
    for (const s of world.settlements) {
      if (s.mode !== "settled" || s.countryId < 0 || s._diverged) continue;
      const cid = dominantCulture(s); if (cid < 0) continue;
      const cc = core.get(cid), k = s.countryId;
      const capLang = capLangByCountry.has(k) ? capLangByCountry.get(k) : -1;
      const shifted = capLang >= 0 && langShareOf(s, capLang) >= ETHNO_LANG_MIN;
      if (!cc || k === cc.country || !shifted) { s._ethnoSince = undefined; continue; }   // at home / not yet shifted → no clock
      if (s._ethnoSince === undefined) { s._ethnoSince = world.step; continue; }
      if (world.step - s._ethnoSince <= ETHNO_AFTER / (world._dt || 1)) continue;
      const key = cid + "|" + k;
      let b = blocs.get(key); if (!b) blocs.set(key, b = { cid, k, seed: s, n: 0 });
      b.n++;
    }
    // fork each substantial, timed-out block into ONE new people
    for (const b of blocs.values()) {
      if (b.n < ETHNO_MIN_BLOC) continue;
      const parent = getCulture(world, b.cid);
      const daughter = foundCulture(world, { origin: b.seed, parentCultureId: b.cid,
        divergence: 0.55, branchFromLangId: capLangByCountry.get(b.k) });
      // convert the whole same-(people, country) block — gather BEFORE mutating
      const members = [];
      for (const s of world.settlements) if (s.mode === "settled" && s.countryId === b.k && dominantCulture(s) === b.cid) members.push(s);
      for (const s of members) { seedCulture(world, s, daughter.id); s._ethnoSince = undefined; }
      logEvent(world, "culture.diverged", {
        culture: daughter.id, cultureName: daughter.name,
        parent: b.cid, parentName: parent ? parent.name : undefined,
        s: b.seed.id, sName: b.seed.name, polity: b.k,
      });
    }
  }
}

/** The culture a brand-new settlement inherits at a given site: its
 *  parent's, else the knowledge-donor's, else a fresh frontier culture. */
export function inheritCultureAt(world, donor) {
  if (donor && donor.culMix && donor.culMix.length) return dominantCulture(donor);
  return -1;
}

// Deterministic per-culture rng hook for later systems (faith rolls, drift)
export function cultureRng(world, cultureId, system) {
  return entityRng(world, system + ".cul", cultureId);
}
