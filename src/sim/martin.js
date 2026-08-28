// ── The Martin Effect — shared archetype selection ───────────────────────
//
// Human-facing cultural output (music, language texture, emblems, names…)
// emerges by SCORING pre-approved archetype families from world state — never
// by naming a people or place. See `docs/martin-effect.md` and CLAUDE.md.
//
// This module is the mechanical core every domain reuses: score candidates,
// pick deterministically among near-ties, expose what was chosen for the Lab.
import { hash32 } from "./peopleSim/rng.js";

/** Kill-switch for probes: `MARTIN=0 node tools/...` */
export const MARTIN_ON = !(typeof process !== "undefined" && process.env?.MARTIN === "0");

/**
 * Domains that use Martin selection. Each registers a catalog + scorer;
 * music is first; language/emblems/names follow the same contract.
 * @type {Record<string, { label: string, doc: string }>}
 */
export const MARTIN_DOMAINS = {
  tuning: { label: "pitch vocabulary", doc: "docs/music-archetypes-plan.md" },
  language: { label: "typology frame", doc: "docs/language-typology-completion-spec.md" },
  emblem: { label: "vexillological grammar", doc: "docs/emblems.md" },
  name: { label: "onomastic stratum", doc: "docs/martin-effect.md" },
};

/** 1 inside [min,max], falling off outside — no hard cliff. */
export function bandFit(value, min, max) {
  if (min > max) [min, max] = [max, min];
  if (value >= min && value <= max) return 1;
  if (value < min) return Math.max(0, 1 - (min - value) / Math.max(1, min));
  return Math.max(0, 1 - (value - max) / Math.max(1, max));
}

/** Coefficient of variation of step sizes within a frame — low ≈ equal division. */
export function stepSpread(cents, frameCents = 1200) {
  if (cents.length < 2) return 0;
  const steps = [];
  for (let i = 1; i < cents.length; i++) steps.push(cents[i] - cents[i - 1]);
  steps.push(frameCents - cents[cents.length - 1]);
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  if (mean < 1) return 0;
  const var_ = steps.reduce((s, x) => s + (x - mean) ** 2, 0) / steps.length;
  return Math.sqrt(var_) / mean;
}

/** Mean distance in cents from each degree to nearest ET semitone — playback cost. */
export function etErr(cents) {
  if (!cents.length) return 0;
  return cents.reduce((s, c) => s + Math.abs(c - Math.round(c / 100) * 100), 0) / cents.length;
}

/**
 * Deterministic pick among top-scoring items. `tag` namespaces the hash per domain.
 * Returns the winner, its score, and the full ranking for the Lab.
 */
export function pickAmong(items, scoreOf, { seed = 0, tag = "pick", epsilon = 0.05, topK = 4 } = {}) {
  const ranked = items
    .map(item => ({ item, score: scoreOf(item) }))
    .sort((a, b) => b.score - a.score || String(itemId(a.item)).localeCompare(String(itemId(b.item))));
  const best = ranked[0]?.score ?? -Infinity;
  const pool = ranked.filter(r => r.score >= best - epsilon).slice(0, topK);
  const pick = pool[hash32(seed >>> 0, "martin", tag) % pool.length] || ranked[0];
  return { picked: pick?.item ?? null, score: pick?.score ?? best, ranked };
}

function itemId(item) {
  return item?.id ?? item?.key ?? "";
}
