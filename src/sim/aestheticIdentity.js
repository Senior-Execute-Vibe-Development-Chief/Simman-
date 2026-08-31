// ── Aesthetic identity — one people's look + taste bundle ───────────────────
//
// Unifies the three aesthetic layers for a creator or culture:
//   look   — carried via ancMix / optional lookOverride (Rail A + Rail B)
//   dress  — local envelope (climate × materials × wealth)
//   built  — local envelope
//   taste  — culture genome expressing WITHIN the envelopes
//
// Pure + deterministic. No save fields, no UI, no sim wiring.

import { styleOf, lookOf, dressOf, builtOf, formatStyleLine } from "./peopleStyle.js";
import {
  foundTasteGenome, mutateTasteGenome, blendTasteGenome,
  expressTaste, tasteFingerprint, formatTasteLine,
} from "./styleTaste.js";

/** Abstract founding axes — bias taste genome at culture genesis. */
export const AESTHETIC_AXES = [
  "ornament", "austerity", "colour", "pattern", "regal", "pastoral", "arid",
];

/**
 * foundAestheticIdentity(seed, axes) — seed a culture's aesthetic genome.
 * Look still resolves from ancestry when ctx carries ancMix; taste is always here.
 */
export function foundAestheticIdentity(seed, axes = {}) {
  const bias = {};
  for (const k of AESTHETIC_AXES) if (axes[k] != null) bias[k] = axes[k];
  return {
    seed: seed >>> 0,
    axes: bias,
    taste: foundTasteGenome(seed, bias),
    lookOverride: null,
  };
}

export function mutateAestheticIdentity(identity, seed, strength = 1) {
  return {
    ...identity,
    taste: mutateTasteGenome(identity.taste, seed, strength),
  };
}

/** Weighted blend for culMix (shareB = weight on b). */
export function blendAestheticIdentity(a, b, shareB) {
  const w = shareB < 0 ? 0 : shareB > 1 ? 1 : shareB;
  return {
    seed: a.seed,
    axes: a.axes,
    taste: blendTasteGenome(a.taste, b.taste, w),
    lookOverride: a.lookOverride,
  };
}

/**
 * Resolve look for an identity + context.
 * lookOverride wins; else ancMix/world; else ctx.homeland; else null.
 */
export function lookForIdentity(ctx, identity) {
  if (identity && identity.lookOverride) return identity.lookOverride;
  return lookOf(ctx);
}

/**
 * expressAesthetic(ctx, identity) → full aesthetic phenotype.
 * ctx: tile climate, materials, wealth, ancMix, world, homeland, …
 * identity: from foundAestheticIdentity (taste genome required).
 */
export function expressAesthetic(ctx, identity) {
  const look = lookForIdentity(ctx, identity);
  const dress = dressOf(ctx);
  const built = builtOf(ctx);
  const envelope = { look, dress, built };
  const taste = identity && identity.taste
    ? expressTaste(envelope, identity.taste)
    : { dress: {}, built: {} };
  return { look, dress, built, taste };
}

/** Envelope + taste in one call (alias for creator previews). */
export function aestheticOf(ctx, identity) {
  return expressAesthetic(ctx, identity);
}

export function aestheticFingerprint(aesthetic) {
  if (!aesthetic) return "";
  const l = aesthetic.look;
  const lookBits = l
    ? [
      l.skin?.toFixed(2), l.hairHue?.toFixed(2), l.epicanthic?.toFixed(2),
      l.noseBridge?.toFixed(2), l.jawWidth?.toFixed(2),
    ].join(",")
    : "none";
  const d = aesthetic.dress;
  const dressBits = d
    ? [d.fibre, d.cut, d.layers, d.sleeve, d.lower, d.headdress, d.bodyArt].join(",")
    : "";
  const b = aesthetic.built;
  const builtBits = b
    ? [b.wall, b.roofForm, b.verticality, b.sacredForm, b.fortification, b.interior].join(",")
    : "";
  const tasteBits = tasteFingerprint({ dress: aesthetic.taste?.dress, built: aesthetic.taste?.built });
  return [lookBits, dressBits, builtBits, tasteBits].join("|");
}

export function formatAestheticLine(aesthetic) {
  if (!aesthetic) return "";
  const style = formatStyleLine({ dress: aesthetic.dress, built: aesthetic.built });
  const taste = formatTasteLine(aesthetic.taste);
  const look = aesthetic.look
    ? `look skin=${aesthetic.look.skin?.toFixed(2)} hue=${aesthetic.look.hairHue?.toFixed(2)}`
    : "";
  return [look, style, taste].filter(Boolean).join(" · ");
}
